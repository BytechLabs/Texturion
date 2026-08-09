import { billingCurrencyOf, usdCentsOf, type BillingCurrency } from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import type { Env } from "../env";
import { canChargeIn } from "./checkout-currency";
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
  // #399: a free referral month is unspent on the licensed item, and granting
  // the year would overwrite it. See the gate in prepayEligibility.
  | "referral_month_pending"
  // #277: the workspace's plan is paused. See the gate in prepayEligibility.
  | "workspace_paused"
  // #522: the catalog cannot charge a year in this workspace's currency.
  | "currency_unavailable";

export interface OpenPrepayment {
  session_id: string;
  plan: PlanId;
  amount_cents: number;
  /** #522: what `amount_cents` is IN. Never assume it is the cost model's USD. */
  currency: string;
  months_granted: number;
  granted_at: string;
  granted_through: string;
  discount_id: string | null;
}

export interface PrepayEligibility {
  eligible: boolean;
  reason?: PrepayIneligibleReason;
  priceCents?: number;
  /**
   * #522 — the currency `priceCents` is in, and the one a session would charge.
   *
   * Always present, including on refusals, because a surface that shows the
   * price beside a "not right now" sentence still has to name the money. It is
   * the workspace's own currency whenever the catalog can honour it; when it
   * cannot, the answer is `currency_unavailable` rather than a USD figure
   * dressed as the workspace's own.
   */
  currency: BillingCurrency;
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
  /** #522: what this workspace is billed in. Absent reads as the USD default. */
  billing_currency?: string | null;
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
 *
 * #522 — AND THE CATALOG HAS TO BE ABLE TO CHARGE THE WORKSPACE'S OWN CURRENCY.
 *
 * The year is a ONE-TIME price, and a one-time price with no option for the
 * session's currency does not fail: Stripe bills its base currency. So a
 * Canadian workspace read "$290" — in a product that prints CAD as the bare "$"
 * for exactly this reader — and was charged US$290, on the one screen whose
 * whole job is to take a large payment up front. Every other figure on that
 * screen was already CAD.
 *
 * Probed rather than assumed, for the reason checkout-currency.ts gives at
 * length: filing a currency against a live price is an operator action, and code
 * that assumes somebody has run something breaks in the window before they do.
 * Cached per price per isolate, so the polling surface pays for it once.
 */
export async function prepayEligibility(
  env: Env,
  db: SupabaseClient,
  company: CompanyForPrepay,
  subscription?: Stripe.Subscription | null,
): Promise<PrepayEligibility> {
  const wanted = billingCurrencyOf(company.billing_currency);
  if (company.plan === null || !company.stripe_subscription_id) {
    return { eligible: false, reason: "no_subscription", currency: wanted };
  }
  const price = prepayYearPrice(env, company.plan);
  if (!price || !env.STRIPE_PREPAID_YEAR_COUPON_ID) {
    return { eligible: false, reason: "not_provisioned", currency: wanted };
  }

  // Before any figure is put in the answer, because the figure is meaningless
  // until it is known which money it is in.
  if (!(await canChargeIn(getStripe(env), { wanted, priceId: price }))) {
    // Loud: this is a real gap between what a workspace was promised and what
    // the catalog can take, and closing it is one `stripe:setup` run.
    console.error(
      `prepaid year unavailable in ${wanted}: ${price} carries no such ` +
        `currency — run stripe:setup. Offering nothing rather than a US figure.`,
    );
    return { eligible: false, reason: "currency_unavailable", currency: wanted };
  }
  const priceCents = PLAN_PREPAY_YEAR_CENTS[wanted][company.plan];

  // Only a genuinely healthy subscription. Selling a year beside the past-due
  // notice is both tasteless and the least likely money in the product to clear.
  if (company.subscription_status !== "active") {
    return {
      eligible: false,
      reason: "subscription_unhealthy",
      priceCents,
      currency: wanted,
    };
  }

  // #277: before the claim and before Stripe — see the note above. Also simply
  // the honest answer: a workspace that has stopped for the winter is not the
  // one to ask for twelve months up front.
  if ((company.paused_at ?? null) !== null) {
    return {
      eligible: false,
      reason: "workspace_paused",
      priceCents,
      currency: wanted,
    };
  }

  const open = await openPrepayment(db, company.id);
  if (open) {
    return {
      eligible: false,
      reason: "already_prepaid",
      priceCents,
      currency: wanted,
      open,
    };
  }

  if (subscription?.schedule) {
    return {
      eligible: false,
      reason: "plan_change_pending",
      priceCents,
      currency: wanted,
    };
  }
  /**
   * An unspent referral month is riding the same item this sell would write.
   *
   * `grantPrepaidYear` sends `discounts: [{ coupon }]`, which REPLACES the
   * item's discount array, so granting the year here would silently delete a
   * free month the customer had already earned — and once the coupon is off the
   * item, `referralMonthPending` can no longer tell it was ever there.
   *
   * Refused at the SELL rather than patched at the grant, because the grant runs
   * after the money is taken: by then the only choices are to destroy the month
   * or to stack it on a line already discounted to $0, where a `duration: once`
   * coupon is consumed against a $0 invoice and evaporates anyway. Refusing here
   * costs the customer one billing cycle of waiting and nothing else.
   *
   * `pauseEligibility` has carried this exact gate, with a test, since the
   * referral month shipped; this path had it missing, which is what makes it an
   * omission rather than a policy.
   */
  if (referralMonthPending(env, subscription)) {
    return {
      eligible: false,
      reason: "referral_month_pending",
      priceCents,
      currency: wanted,
    };
  }
  if (!(await hasSentOutbound(db, company.id))) {
    return {
      eligible: false,
      reason: "not_activated",
      priceCents,
      currency: wanted,
    };
  }
  return { eligible: true, priceCents, currency: wanted, open: null };
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

/**
 * Is a #399 referral free month still sitting unspent on the licensed item?
 *
 * ASKED OF STRIPE, NOT OF OUR REFERRAL TABLE, and that is the whole trick. The
 * coupon is `duration: once`, so Stripe DROPS the discount from the item the
 * moment it is applied to an invoice. "The item still carries the coupon" is
 * therefore the same question as "the month has not been spent yet" — a
 * `referrals.referrer_rewarded_at` timestamp answers a different one (it says a
 * month was granted, months ago, and cannot say whether it has since landed).
 *
 * False when the coupon is unprovisioned: with no configured coupon we cannot
 * tell a referral discount from any other, and refusing every pause on a guess
 * would be worse than the money at stake. Nothing pays out in that state either
 * (see rewardSide), so there is no unspent month to protect.
 */
export function referralMonthPending(
  env: Env,
  subscription: Stripe.Subscription | null | undefined,
): boolean {
  const coupon = env.STRIPE_REFERRAL_MONTH_COUPON_ID;
  if (!coupon || !subscription) return false;
  const licensed = licensedItemOf(env, subscription);
  return licensed ? itemHasDiscount(licensed, coupon) : false;
}

/**
 * Is a prepaid year's coupon riding the licensed item with no row behind it?
 *
 * THE SAME HAZARD AS referralMonthPending, FOR THE OTHER COUPON, and the
 * `prepayments` row does not cover it. `openPrepayment` requires `granted_at`,
 * and `grantPrepaidYear` deliberately does NOT throw when `stamp_prepayment`
 * fails — throwing would let the webhook sweeper retry and re-apply a coupon
 * whose twelve months would restart, which is the worst outcome that path has.
 * So a logged stamp failure leaves the discount live on the item and the row
 * ungranted, and `pauseEligibility` sees nothing in the way.
 *
 * A pause then swaps that item's PRICE, and Stripe carries the item's discounts
 * across a price change untouched. The result is a twelve-month 100%-off coupon
 * sitting on the ~$5 holding fee: a genuinely free pause, on a workspace that
 * also burns the year it paid for on a hold. Exactly the harm the
 * `already_prepaid` gate exists to prevent, reached through the one hole that
 * gate cannot see.
 *
 * Asked of STRIPE for the same reason referralMonthPending is: the item either
 * carries the coupon or it does not, and no timestamp of ours can say so once
 * the write that would have stamped it has been lost.
 */
export function prepaidCouponPending(
  env: Env,
  subscription: Stripe.Subscription | null | undefined,
): boolean {
  const coupon = env.STRIPE_PREPAID_YEAR_COUPON_ID;
  if (!coupon || !subscription) return false;
  const licensed = licensedItemOf(env, subscription);
  return licensed ? itemHasDiscount(licensed, coupon) : false;
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
  // A referral month should never still be here — `prepayEligibility` refuses
  // the sell while one is unspent — but the money is already taken by the time
  // this runs, so the race gets a backstop rather than a throw. Carried through
  // instead of replaced: the array write below would delete it, and destroying a
  // month somebody earned is worse than stacking it on a line that is about to
  // be $0 anyway. Logged loudly because reaching this means the sell gate was
  // bypassed and somebody should know which way.
  const referralCoupon = env.STRIPE_REFERRAL_MONTH_COUPON_ID;
  const carriedReferral =
    referralCoupon && itemHasDiscount(licensed, referralCoupon)
      ? [{ coupon: referralCoupon }]
      : [];
  if (carriedReferral.length > 0) {
    console.error(
      `prepay grant for ${session.id}: an unspent referral month was on the ` +
        `licensed item — carried through, but the sell gate should have refused this.`,
    );
  }
  if (!itemHasDiscount(licensed, couponId) || resumePrice !== null) {
    await stripe.subscriptions.update(
      subscriptionId,
      {
        items: [
          {
            id: licensed.id,
            ...(resumePrice ? { price: resumePrice } : {}),
            discounts: [...carriedReferral, { coupon: couponId }],
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
 * The item write that takes an item-level discount OFF.
 *
 * # An empty array does not clear a discount. It is ignored.
 *
 * Both call sites used `discounts: []` and both were silently doing nothing.
 * Stripe's own words for this parameter: "A populated array overwrites the
 * existing discounts. If not specified **or empty array, it leaves the discounts
 * unchanged**. If empty string, it clears them."
 *
 * The Node SDK's form encoder makes it invisible. An empty array is dropped from
 * the request body entirely — `items[0][discounts]` never appears on the wire, so
 * the call succeeds, returns a normal subscription, and changes nothing. The empty
 * STRING encodes as `items[0][discounts]=`, which is the clear.
 *
 * What that cost, before this: a refund or a won chargeback revoked the claim row
 * and left the 100%-off coupon running, delivering up to eleven more free months
 * ON TOP of money we had just given back. D107 names that as the largest single
 * loss any of these paths can produce, and it had been shipped in the one shape
 * that looks exactly like the fix.
 *
 * So there is one function rather than an idiom, and it is the only place in this
 * codebase that spells the clear value.
 */
function clearItemDiscounts(
  stripe: Stripe,
  subscriptionId: string,
  itemId: string,
): Promise<Stripe.Subscription> {
  return stripe.subscriptions.update(subscriptionId, {
    items: [
      {
        id: itemId,
        // "" is the clear. [] is a no-op. See above — this is not a style choice.
        discounts: "",
      } as Stripe.SubscriptionUpdateParams.Item,
    ],
  });
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

  await clearItemDiscounts(stripe, subscriptionId, licensed.id);
  return { outcome: "revoked" };
}

/** What a conversion would pay back. Every figure is in `currency`. */
export interface ConversionPreview {
  session_id: string;
  plan: PlanId;
  currency: string;
  amount_cents: number;
  months_granted: number;
  granted_through: string;
  consumed_months: number;
  credit_cents: number;
}

export interface ConversionResult {
  outcome: "converted" | "noop";
  /** In `currency`. Zero when the year was fully consumed. */
  credit_cents: number;
  currency: string;
  consumed_months: number;
  months_granted: number;
  plan: PlanId | null;
  /** False when the credit was recorded but Stripe did not take it (see below). */
  credited: boolean;
}

/**
 * What a conversion would pay back, without doing it. Null when there is nothing
 * open to convert.
 *
 * #583/D131. The consent step is a refusal that quotes a figure, and the customer
 * agrees to THAT figure — so this reads the same amortisation the conversion writes,
 * from the same place. Two expressions of one rule is how they drift, and here the
 * drift is money.
 */
export async function conversionPreview(
  db: SupabaseClient,
  companyId: string,
): Promise<ConversionPreview | null> {
  const { data, error } = await db.rpc("prepayment_conversion_preview", {
    p_company_id: companyId,
  });
  if (error) {
    throw new Error(`prepayment_conversion_preview failed: ${error.message}`);
  }
  return (data as ConversionPreview | null) ?? null;
}

/**
 * End a prepaid year early, and pay the rest back. #583/D131.
 *
 * `change-plan` refused outright until now, which closed a real money hole and left
 * a crew that outgrows Starter in month three unable to buy Pro for nine months.
 * This is the other half: revoke the coupon, credit the unconsumed value to the
 * customer's Stripe balance, and let the caller reprice the item normally.
 *
 * # Why credit, when D107 rejected credit
 *
 * D107 rejected it for DELIVERING a year: $290 of credit funds ten $29 invoices, so
 * month eleven charges the card and the two free months never exist. Dollars cannot
 * promise a term. At conversion there is no term left to promise — what is owed is
 * the value of months the customer will not take, and value is exactly what dollars
 * are. Re-granting a smaller coupon instead leaves a remainder ($217.50 of Starter
 * buys two whole months of Pro and $59.50 over) and every way of placing that
 * remainder is worse than not having one. D131 has the full comparison.
 *
 * # The order, and which failure it chooses
 *
 *   1. the row, in one transaction: the window closes and the amount owed is
 *      recorded together, so they cannot disagree;
 *   2. the coupon comes off;
 *   3. the credit moves, and is stamped.
 *
 * A failure after (1) leaves a customer at full price who is owed a written-down
 * amount — recoverable, and `prepayments_awaiting_credit` finds it. The reverse
 * ordering would leave a live 100%-off coupon with the entitlement already closed,
 * which is free service nothing is looking for. Over-charging by an amount we
 * recorded beats giving away service we did not.
 *
 * Both Stripe calls carry idempotency keys derived from the prepayment id, so a
 * retried request cannot credit twice even before the `credited_at` guard is
 * reached.
 */
export async function convertPrepaidYear(
  env: Env,
  db: SupabaseClient,
  company: { id: string; stripe_customer_id: string | null },
  toPlan: PlanId,
): Promise<ConversionResult> {
  const { data, error } = await db.rpc("convert_prepayment", {
    p_company_id: company.id,
    p_to_plan: toPlan,
  });
  if (error) throw new Error(`convert_prepayment failed: ${error.message}`);

  const row = data as {
    outcome?: string;
    prepayment_id?: string;
    plan?: PlanId;
    currency?: string;
    credit_cents?: number;
    consumed_months?: number;
    months_granted?: number;
  } | null;

  if (row?.outcome !== "converted" || !row.prepayment_id) {
    return {
      outcome: "noop",
      credit_cents: 0,
      currency: "usd",
      consumed_months: 0,
      months_granted: 0,
      plan: null,
      credited: false,
    };
  }

  const creditCents = row.credit_cents ?? 0;
  const currency = row.currency ?? "usd";
  const result: ConversionResult = {
    outcome: "converted",
    credit_cents: creditCents,
    currency,
    consumed_months: row.consumed_months ?? 0,
    months_granted: row.months_granted ?? 0,
    plan: row.plan ?? null,
    credited: false,
  };

  // (2) The coupon comes off. Same call shape as `revokePrepaidYear` — an empty
  // discounts array is what clears an item-level discount — and it must happen
  // before the caller repoints the price, or the 100%-off would land on the new plan.
  const subscriptionId = await subscriptionIdFor(db, company.id);
  if (subscriptionId) {
    const stripe = getStripe(env);
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const licensed = licensedItemOf(env, subscription);
    if (licensed) {
      await clearItemDiscounts(stripe, subscriptionId, licensed.id);
    }
  }

  // (3) The money. Zero is not an error and is not worth a Stripe call: a year
  // consumed to the last month owes nothing, and asking Stripe to move $0 would
  // either fail or leave a meaningless transaction on the customer's statement.
  if (creditCents <= 0) return result;
  if (!company.stripe_customer_id) {
    // Nothing to credit against. Left for the sweep rather than thrown: the
    // entitlement is already closed, and throwing here would 500 a plan change
    // that has otherwise succeeded.
    console.error(
      `[prepay] converted prepayment ${row.prepayment_id} owes ${creditCents} ` +
        `${currency} but company ${company.id} has no Stripe customer.`,
    );
    return result;
  }

  const stripe = getStripe(env);
  // NEGATIVE is a credit. Stripe's own words: "A negative value is a credit for the
  // customer's balance, and a positive value is a debit." Getting this backwards
  // would BILL the customer the value of their own prepaid year.
  const txn = await stripe.customers.createBalanceTransaction(
    company.stripe_customer_id,
    {
      amount: -creditCents,
      currency,
      description: `Unused portion of a prepaid ${row.plan} year, credited on switching to ${toPlan}.`,
      metadata: { loonext_prepayment_id: row.prepayment_id },
    },
    { idempotencyKey: `prepay-credit:${row.prepayment_id}` },
  );

  const { error: stampError } = await db.rpc("stamp_prepayment_credit", {
    p_prepayment_id: row.prepayment_id,
    p_txn: txn.id,
  });
  if (stampError) {
    throw new Error(`stamp_prepayment_credit failed: ${stampError.message}`);
  }
  return { ...result, credited: true };
}

/**
 * What a prepaid tenant actually pays us per month, in US cents.
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
 *
 * # USD IN THE NAME, because #522 made the unit ambiguous
 *
 * `amount_cents` is what we COLLECTED, in whatever currency we collected it —
 * and since #522 a Canadian workspace can buy its year in CAD. Every cost this
 * figure is compared against (Telnyx, Cloudflare, Supabase) is US-denominated,
 * so handing the comparison CA$39,000/12 as though it were US cents would
 * overstate that tenant's revenue by the whole exchange rate. That is the
 * flattering direction, on the one cohort whose licensed line invoices at $0 —
 * it would mute the alert this figure exists to keep working.
 *
 * `listCents` is already USD (PLAN_MONTHLY_REVENUE_CENTS), so the fallback
 * needs no conversion.
 */
export function amortisedMonthlyUsdCents(
  open: OpenPrepayment | null,
  listCents: number,
): number {
  if (!open || open.months_granted <= 0) return listCents;
  const collected = usdCentsOf(
    open.amount_cents,
    billingCurrencyOf(open.currency),
  );
  return Math.round(collected / open.months_granted);
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
