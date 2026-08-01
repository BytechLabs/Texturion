import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import type { Env } from "../env";
import {
  PLAN_PREPAY_YEAR_CENTS,
  PREPAY_MONTHS,
  planForLicensedPrice,
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
  | "plan_change_pending";

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
  const licensed = licensedItemOf(env, subscription);
  if (!licensed) {
    throw new Error(
      `Prepay session ${session.id}: subscription ${subscriptionId} carries no licensed item.`,
    );
  }

  const couponId = env.STRIPE_PREPAID_YEAR_COUPON_ID;
  if (!couponId) {
    throw new Error(`Prepay session ${session.id}: no prepaid-year coupon configured.`);
  }

  // Already carrying it — a resume whose Stripe write actually landed. Stamp
  // and stop rather than applying it again, which would restart the year.
  if (!itemHasDiscount(licensed, couponId)) {
    await stripe.subscriptions.update(
      subscriptionId,
      {
        items: [
          {
            id: licensed.id,
            discounts: [{ coupon: couponId }],
          } as Stripe.SubscriptionUpdateParams.Item,
        ],
      },
      { idempotencyKey: `prepay_grant:${session.id}` },
    );
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
