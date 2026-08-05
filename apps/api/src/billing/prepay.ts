import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import type { Env } from "../env";
import {
  PLAN_PREPAY_YEAR_CENTS,
  PREPAY_MONTHS,
  isPauseLicensedPrice,
  planForLicensedPrice,
  planPrices,
  prepayYearPrice,
  type PlanId,
} from "./plans";
import { getStripe } from "./stripe";

/**
 * #400 / D107 — a prepaid year, delivered as a discount on the licensed line.
 *
 * The customer buys a one-time price; we apply a 100%-off coupon to the LICENSED
 * subscription item for twelve months. The subscription is otherwise untouched:
 * same id, same monthly period, metered overage and modules still billing. D107
 * records why an annual interval, a customer-balance credit and two
 * subscriptions were each rejected.
 *
 * # The rule that shapes every function here
 *
 * THE STRIPE DISCOUNT IS NOT THE RECORD OF THE ENTITLEMENT. Re-applying the
 * coupon RESTARTS its twelve months, and `confirm-checkout` lets a browser
 * replay a completed session on demand — so one payment could buy unbounded
 * free service. A transient failure does the same by accident, because the
 * webhook sweeper retries five times over ~25 minutes and the last write wins.
 *
 * So the `prepayments` row is the record, taken before Stripe is called, and
 * the discount is a derived projection of it. Everything below reads the row
 * first.
 */

/** Marks a Checkout Session as a prepaid year rather than a subscription. */
export const PREPAY_METADATA_KIND = "prepaid_year";

/** The metadata key carrying it, namespaced so Stripe cannot collide with it. */
export const PREPAY_METADATA_FIELD = "loonext_kind";

/** The plan the pack was bought for, carried on the session. */
export const PREPAY_PLAN_FIELD = "loonext_plan";

/**
 * Is this completed session a prepaid year?
 *
 * Checks OUR metadata, not just `mode`. Mode alone would also claim any future
 * one-time session this product grows, and the failure of guessing wrong is
 * silent money movement rather than an error somebody sees.
 */
export function isPrepayCheckout(session: Stripe.Checkout.Session): boolean {
  return (
    session.mode === "payment" &&
    session.metadata?.[PREPAY_METADATA_FIELD] === PREPAY_METADATA_KIND
  );
}

export type PrepayIneligibleReason =
  | "not_provisioned"
  | "no_subscription"
  | "subscription_unhealthy"
  | "not_activated"
  | "already_prepaid"
  | "plan_change_pending"
  // #277: the workspace's plan is paused. See the gate in prepayEligibility.
  | "workspace_paused";

export interface OpenPrepayment {
  session_id: string;
  plan: PlanId;
  amount_cents: number;
  months_granted: number;
  granted_at: string;
  granted_through: string;
  discount_id: string | null;
}

export interface PrepayEligibility {
  eligible: boolean;
  reason?: PrepayIneligibleReason;
  priceCents?: number;
  /** The window already running, when there is one. */
  open?: OpenPrepayment | null;
}

interface CompanyForPrepay {
  id: string;
  plan: PlanId | null;
  subscription_status: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  /** #277: the seasonal pause. Optional — rows read before the column shipped. */
  paused_at?: string | null;
}

/** The prepaid year currently running for this company, or null. */
export async function openPrepayment(
  db: SupabaseClient,
  companyId: string,
): Promise<OpenPrepayment | null> {
  const { data, error } = await db.rpc("open_prepayment", {
    p_company_id: companyId,
  });
  if (error) throw new Error(`open_prepayment failed: ${error.message}`);
  return (data as OpenPrepayment | null) ?? null;
}

/**
 * Has this workspace ever actually sent a message?
 *
 * D107 and #400's own sequencing insight: the offer appears AFTER activation,
 * never at signup. Asking somebody to pre-pay twelve months before they have
 * sent a single text — on a product that may still be waiting on carrier
 * approval, and that per #352 can be REJECTED — extracts the most at the moment
 * the customer has received the least.
 *
 * The predicate is a literal superset match for the partial index
 * `messages_outbound_accepted_period_idx`, and it is the SAME predicate
 * `captureFirstOutboundSent` uses, so "activated" means one thing here.
 */
export async function hasSentOutbound(
  db: SupabaseClient,
  companyId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("messages")
    .select("id")
    .eq("company_id", companyId)
    .eq("direction", "outbound")
    .not("telnyx_message_id", "is", null)
    .limit(1);
  if (error) throw new Error(`prepay activation probe failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * May this workspace buy a year, and at what price?
 *
 * The two gates that are not obvious:
 *
 * A SCHEDULE-MANAGED SUBSCRIPTION IS REFUSED, not queued. Stripe rejects item
 * writes while a schedule owns the items, so a grant issued during a pending
 * downgrade fails after five sweeper retries with the money already taken. A
 * 409 naming the pending change is the honest answer, and it is how
 * extra-number buys are already refused.
 *
 * AN OPEN WINDOW IS REFUSED. A second coupon on the same item does not add
 * twelve months to the first — it replaces or stacks unpredictably — so a
 * second purchase is a way to lose the customer's money.
 *
 * #277 — A PAUSED WORKSPACE IS REFUSED HERE, AND HONOURED IN grantPrepaidYear.
 *
 * Every other test in this function passes for a paused workspace: `plan` is
 * still populated (that is what they resume onto) and `subscription_status` is
 * still `active` (the pause is a price swap, not a status). So without this gate
 * a paused customer could buy a year of a plan they are not currently on.
 *
 * But this gate CANNOT be the whole answer, and believing it was is what left a
 * hole worth $790. It runs when the Checkout Session is CREATED. A session stays
 * payable for ~24 hours, and an unpaid prepayment has no row anywhere —
 * `open_prepayment` requires `granted_at`, so `pauseEligibility` cannot see one
 * coming. Open the page, pause, then pay on the tab that is still sitting there,
 * and every check in this file has already passed. The refusal that has to hold
 * in that case is not a refusal at all: the money is ours, so the grant path
 * delivers what it bought. See grantPrepaidYear.
 */
export async function prepayEligibility(
  env: Env,
  db: SupabaseClient,
  company: CompanyForPrepay,
  subscription?: Stripe.Subscription | null,
): Promise<PrepayEligibility> {
  if (company.plan === null || !company.stripe_subscription_id) {
    return { eligible: false, reason: "no_subscription" };
  }
  const price = prepayYearPrice(env, company.plan);
  if (!price || !env.STRIPE_PREPAID_YEAR_COUPON_ID) {
    return { eligible: false, reason: "not_provisioned" };
  }
  const priceCents = PLAN_PREPAY_YEAR_CENTS[company.plan];

  // Only a genuinely healthy subscription. Selling a year beside the past-due
  // notice is both tasteless and the least likely money in the product to clear.
  if (company.subscription_status !== "active") {
    return { eligible: false, reason: "subscription_unhealthy", priceCents };
  }

  // #277: before the claim and before Stripe — see the note above. Also simply
  // the honest answer: a workspace that has stopped for the winter is not the
  // one to ask for twelve months up front.
  if ((company.paused_at ?? null) !== null) {
    return { eligible: false, reason: "workspace_paused", priceCents };
  }

  const open = await openPrepayment(db, company.id);
  if (open) return { eligible: false, reason: "already_prepaid", priceCents, open };

  if (subscription?.schedule) {
    return { eligible: false, reason: "plan_change_pending", priceCents };
  }
  if (!(await hasSentOutbound(db, company.id))) {
    return { eligible: false, reason: "not_activated", priceCents };
  }
  return { eligible: true, priceCents, open: null };
}

/** The licensed item on a subscription, which is the one the discount rides. */
export function licensedItemOf(
  env: Env,
  subscription: Stripe.Subscription,
): Stripe.SubscriptionItem | undefined {
  return subscription.items.data.find(
    (item) => planForLicensedPrice(env, item.price.id) !== null,
  );
}

/**
 * True when this item already carries the given COUPON.
 *
 * Stripe returns an item's discounts as Discount objects, whose own `id` is a
 * discount id (`di_…`) and whose `coupon` holds the coupon we applied. Checking
 * the wrong one of those is not cosmetic: a resume whose Stripe write actually
 * landed would look un-granted, we would apply the coupon again, and re-applying
 * RESTARTS its twelve months. That is the whole hazard this feature is built
 * around, so all three shapes are accepted — expanded, id-only, and a bare
 * string — and only the coupon is compared.
 */
export function itemHasDiscount(
  item: Stripe.SubscriptionItem,
  couponId: string | null,
): boolean {
  if (!couponId) return false;
  const discounts = (item as unknown as { discounts?: unknown[] }).discounts ?? [];
  return discounts.some((d) => {
    if (typeof d === "string") return d === couponId;
    const discount = d as { id?: string; coupon?: string | { id?: string } };
    if (typeof discount.coupon === "string") return discount.coupon === couponId;
    if (discount.coupon?.id) return discount.coupon.id === couponId;
    return discount.id === couponId;
  });
}

export type GrantOutcome = "granted" | "already" | "revoked";

/**
 * Deliver the year for a completed prepayment session. Idempotent.
 *
 * The claim comes FIRST and has three answers rather than two. `resume` is the
 * one that matters: a claim that COMMITS but whose response never reaches the
 * Worker — a lost ack, an evicted isolate — leaves a row with nothing granted,
 * and reporting that as a duplicate is how the first attempt at this feature
 * silently ate a payment. `resume` retries the grant instead.
 *
 * #277 — AND IT HONOURS A PAUSE RATHER THAN THROWING ON ONE. A workspace that
 * paused after opening its Checkout Session (see prepayEligibility for why that
 * is reachable) arrives here with the pause price on its licensed item, so
 * `licensedItemOf` finds nothing. Throwing there was a permanent loss, not a
 * retryable error: `claim_prepayment` has already COMMITTED, so every webhook
 * retry re-enters at outcome `resume` and throws again until the sweeper
 * abandons the row after five attempts — money collected, prepayment row
 * written, no coupon, nobody told.
 *
 * The customer paid for twelve months of their PLAN, so that is what they get:
 * the pause is lifted and the coupon applied in ONE item write, which is also
 * the only ordering that cannot land a twelve-month 100%-off coupon on a ~$5
 * holding fee. Whether they meant to pause and then buy a year, or bought the
 * year and then hit pause on a stale tab, the answer is the same and it is the
 * one they can be told: your year started, your plan is back.
 */
export async function grantPrepaidYear(
  env: Env,
  db: SupabaseClient,
  session: Stripe.Checkout.Session,
): Promise<{ outcome: GrantOutcome }> {
  const companyId = session.client_reference_id;
  if (!companyId) {
    throw new Error(`Prepay session ${session.id} has no client_reference_id.`);
  }
  const plan = session.metadata?.[PREPAY_PLAN_FIELD] as PlanId | undefined;
  if (plan !== "starter" && plan !== "pro") {
    throw new Error(`Prepay session ${session.id} carries no plan.`);
  }
  // What was COLLECTED, never our list price: a promotion code changes the
  // amount, and every downstream figure (the refund conversation, the amortised
  // revenue term) has to use what we actually took.
  const amount = session.amount_total ?? 0;
  if (amount <= 0) throw new Error(`Prepay session ${session.id} collected nothing.`);

  const { data: claim, error: claimError } = await db.rpc("claim_prepayment", {
    p_company_id: companyId,
    p_stripe_session_id: session.id,
    p_plan: plan,
    p_amount_cents: amount,
    p_currency: session.currency ?? "usd",
    p_months: PREPAY_MONTHS,
    // The id a refund or a chargeback will arrive on. `charge.dispute.*`
    // carries a payment intent and nothing else we store, so without this a
    // won chargeback takes the money back and leaves the free months running.
    p_payment_intent:
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : (session.payment_intent?.id ?? null),
  });
  if (claimError) throw new Error(`claim_prepayment failed: ${claimError.message}`);

  const outcome = (claim as { outcome?: string } | null)?.outcome;
  if (outcome === "granted") return { outcome: "already" };
  if (outcome === "revoked") return { outcome: "revoked" };
  if (outcome !== "claimed" && outcome !== "resume") {
    throw new Error(`claim_prepayment returned an unknown outcome: ${outcome}`);
  }

  const stripe = getStripe(env);
  const subscriptionId = await subscriptionIdFor(db, companyId);
  if (!subscriptionId) {
    throw new Error(`Prepay session ${session.id}: company has no subscription.`);
  }
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  let licensed = licensedItemOf(env, subscription);
  // Non-null exactly when this grant is also lifting a pause — see the note on
  // this function. It is the plan the SESSION was created for, which is what the
  // money was priced against; `companies.plan` is deliberately untouched by a
  // pause and holds the same value, so the two agree.
  let resumePrice: string | null = null;
  if (!licensed) {
    const held = subscription.items.data.find(
      (item) => item.price && isPauseLicensedPrice(env, item.price.id),
    );
    if (held) {
      licensed = held;
      resumePrice = planPrices(env, plan).licensed;
    }
  }
  if (!licensed) {
    throw new Error(
      `Prepay session ${session.id}: subscription ${subscriptionId} carries no licensed item` +
        // Names the one shape we cannot recover from, so the founder reading
        // this alert knows it is a provisioning problem and not a Stripe one:
        // with STRIPE_PAUSE_PRICE_ID unset or rotated we cannot tell which item
        // the pause is sitting on, and guessing at "the unmetered one" would
        // convert somebody's Calling add-on into their plan.
        " (a paused subscription reads this way when the pause price is unset).",
    );
  }

  const couponId = env.STRIPE_PREPAID_YEAR_COUPON_ID;
  if (!couponId) {
    throw new Error(`Prepay session ${session.id}: no prepaid-year coupon configured.`);
  }

  // Already carrying it — a resume whose Stripe write actually landed. Stamp
  // and stop rather than applying it again, which would restart the year.
  // A pause still to lift is written regardless: an item that carries the coupon
  // but is still priced at the holding fee is the worst of both states.
  if (!itemHasDiscount(licensed, couponId) || resumePrice !== null) {
    await stripe.subscriptions.update(
      subscriptionId,
      {
        items: [
          {
            id: licensed.id,
            ...(resumePrice ? { price: resumePrice } : {}),
            discounts: [{ coupon: couponId }],
          } as Stripe.SubscriptionUpdateParams.Item,
        ],
        // Only on the resume path, and `none` rather than the pause routes'
        // `create_prorations`: prorating would invoice the balance of the month
        // at the plan price to somebody who has just paid twelve months up
        // front. They owe nothing more for this period; leave it priced as the
        // pause priced it.
        ...(resumePrice ? { proration_behavior: "none" as const } : {}),
      },
      { idempotencyKey: `prepay_grant:${session.id}` },
    );
    if (resumePrice) await clearPauseMirror(db, subscriptionId);
  }

  const grantedThrough = new Date();
  grantedThrough.setUTCMonth(grantedThrough.getUTCMonth() + PREPAY_MONTHS);
  const { error: stampError } = await db.rpc("stamp_prepayment", {
    p_stripe_session_id: session.id,
    p_discount_id: couponId,
    p_granted_through: grantedThrough.toISOString(),
  });
  if (stampError) {
    // The discount is on. Losing the stamp is a bookkeeping gap; throwing here
    // would let the sweeper retry and re-apply the coupon, which RESTARTS the
    // twelve months. Log loudly and keep the year at its real length.
    console.error(`stamp_prepayment failed for ${session.id}: ${stampError.message}`);
  }
  return { outcome: "granted" };
}

/**
 * Clear the pause fact for a subscription this module has just resumed.
 *
 * WHY THIS IS NOT A SECOND PLACE THAT DECIDES WHAT "PAUSED" MEANS.
 * `syncSubscription` in webhooks/stripe.ts is that place, and it cannot be
 * called from here: that module imports this one, so the import would close a
 * cycle. It runs anyway, seconds later, on the `customer.subscription.updated`
 * event our own item write above produces — this write reaches the same
 * conclusion early rather than competing with it, and if they ever disagreed the
 * canonical one runs last and wins.
 *
 * Waiting for that event instead was the alternative, and it is not safe. Until
 * `paused_at` clears, all five SQL send gates still refuse this workspace — so a
 * customer who has just paid for twelve months would sit unable to send a single
 * text, and `POST /v1/billing/resume` would refuse them too, because the
 * subscription no longer carries a pause item to swap back.
 *
 * Best effort, and never fatal: the grant has happened, and a webhook that lands
 * a few seconds later fixes a delay. Throwing here would fail an event whose
 * retry re-enters at `resume` and re-does work that is already correct.
 */
async function clearPauseMirror(
  db: SupabaseClient,
  subscriptionId: string,
): Promise<void> {
  const { error } = await db
    .from("companies")
    .update({ paused_at: null, paused_price_cents: null })
    .eq("stripe_subscription_id", subscriptionId);
  if (error) {
    console.error(
      `prepay resume mirror failed for ${subscriptionId}: ${error.message}`,
    );
  }
}

async function subscriptionIdFor(
  db: SupabaseClient,
  companyId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("companies")
    .select("stripe_subscription_id")
    .eq("id", companyId)
    .limit(1);
  if (error) throw new Error(`companies lookup failed: ${error.message}`);
  return (
    (data?.[0] as { stripe_subscription_id: string | null } | undefined)
      ?.stripe_subscription_id ?? null
  );
}

/**
 * Take the year back when the money goes back.
 *
 * A refund or a won chargeback that left the discount running would deliver ten
 * more free months on top of the clawback — the single largest loss any of
 * these paths can produce.
 */
export async function revokePrepaidYear(
  env: Env,
  db: SupabaseClient,
  sessionId: string,
  reason: string,
): Promise<{ outcome: "revoked" | "noop" }> {
  const { data, error } = await db.rpc("revoke_prepayment", {
    p_stripe_session_id: sessionId,
    p_reason: reason,
  });
  if (error) throw new Error(`revoke_prepayment failed: ${error.message}`);
  const row = data as { outcome?: string; company_id?: string } | null;
  if (row?.outcome !== "revoked" || !row.company_id) return { outcome: "noop" };

  const subscriptionId = await subscriptionIdFor(db, row.company_id);
  if (!subscriptionId) return { outcome: "revoked" };
  const stripe = getStripe(env);
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const licensed = licensedItemOf(env, subscription);
  if (!licensed) return { outcome: "revoked" };

  // An empty discounts array clears item-level discounts.
  await stripe.subscriptions.update(subscriptionId, {
    items: [
      { id: licensed.id, discounts: [] } as Stripe.SubscriptionUpdateParams.Item,
    ],
  });
  return { outcome: "revoked" };
}

/**
 * What a prepaid tenant actually pays us per month, in cents.
 *
 * The cost-vs-revenue projection reads the plan's LIST price, so a prepaid
 * workspace looks like it is paying $29 a month it is not paying — muting the
 * underwater alert for exactly the cohort that has already paid everything it
 * will ever pay. This is the number that replaces it: what we collected,
 * spread over the months it bought.
 *
 * The codebase has fixed this same class of defect twice (grandfathered
 * modules, phantom extra-number revenue), which is why it is a function rather
 * than an inline division somebody forgets.
 */
export function amortisedMonthlyCents(open: OpenPrepayment | null, listCents: number): number {
  if (!open || open.months_granted <= 0) return listCents;
  return Math.round(open.amount_cents / open.months_granted);
}

/**
 * Revoke the year behind a payment intent, if there is one.
 *
 * The entry point for the refund and chargeback paths, which know a payment
 * intent and nothing else about us. A no-op for every ordinary dispute, which
 * is the common case — this is only ever about the one-time year.
 */
export async function revokePrepaidYearForPaymentIntent(
  env: Env,
  db: SupabaseClient,
  paymentIntentId: string,
  reason: string,
): Promise<{ outcome: "revoked" | "noop" }> {
  const { data, error } = await db.rpc("prepayment_for_payment_intent", {
    p_payment_intent: paymentIntentId,
  });
  if (error) {
    throw new Error(`prepayment_for_payment_intent failed: ${error.message}`);
  }
  const sessionId = data as string | null;
  if (!sessionId) return { outcome: "noop" };
  return revokePrepaidYear(env, db, sessionId, reason);
}
