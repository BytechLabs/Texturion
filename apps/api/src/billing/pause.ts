/**
 * #277 — the seasonal pause: keep the number, stop the texting, no 30-day fuse.
 *
 * A trades crew goes quiet for the winter. Their only option today is to
 * cancel, which starts an irreversible 30-day clock on the number printed on
 * the side of their van — and at the end of it the number goes back to the
 * carrier and is given to another business. The product already produces the
 * state they actually want, by accident, for those 30 days: `suspendCompanyNumbers`
 * flips a status in OUR database and never calls Telnyx, so the number, the
 * campaign and the history all stay exactly where they were. A pause is that
 * state, priced, with the deadline removed.
 *
 * THE MECHANISM IS A LICENSED-PRICE SWAP on the same subscription. The
 * subscription stays genuinely `active` in Stripe, so the status mirror stays
 * truthful and change-plan, reconcile and usage all keep working on real data.
 * The three cheaper-looking alternatives were each rejected for failing
 * SILENTLY — see the header of 20260805060000_paid_pause.sql, which is where
 * they are written down because that is where the consequences land.
 *
 * WHAT A PAUSE COSTS US, which is why it cannot be free: the held number's rent
 * plus the recurring 10DLC campaign fee, both of which arrive every month
 * whether or not a single message moves. THE FIGURE IS NOT RESTATED HERE — it
 * is `FIXED_MONTHLY_COST_CENTS` in costs.ts, and a number retyped into a
 * comment is a number that drifts.
 *
 * IT ALREADY HAD. This header used to say "~$1.50-2/mo for the recurring 10DLC
 * campaign ... so roughly $3/mo", from docs/DECISIONS.md. The cost model carries
 * $10/mo for the same campaign, and the two are the same source disagreeing with
 * itself: docs/PRICING-AUDIT.md §4 records "campaign $10/mo (as low as $1.50
 * low-volume)", the pause took the bottom of that range and costs.ts takes the
 * top. Telnyx does not publish 10DLC brand and campaign fees at all
 * (carrier-list-prices.ts), so neither end is verifiable from outside.
 *
 * COSTS.TS WINS, and its own rule is the reason: a table that exists to answer
 * "are we losing money on this tenant" must not UNDER-count. At its figures a
 * paused workspace with one number and a live US campaign costs $11.10/mo, and
 * the pause fee has to clear that plus Stripe's cut — five times the ~$3 this
 * comment used to imply. Whoever prices the pause is entitled to the
 * conservative number rather than the flattering one.
 *
 * WHO WATCHES IT, since the price itself is out of reach of this code: the #85
 * underwater alert already selects paused tenants (overage-warning.ts scans
 * `subscription_status = 'active'`, which a pause deliberately stays) and
 * already adds the campaign fee for them (`fixedMonthlyCostCents` keys on
 * `us_texting_enabled`), and scripts/ops/pricing-report.mjs prints the paused
 * cohort's held-number-and-campaign cost beside what its holding fees collect.
 * So the margin is observed rather than assumed — which matters more here than
 * usual, because #525 lets a workspace ADD a US campaign in the middle of a
 * pause the fee was priced before.
 *
 * The PRICE is not chosen here and is nowhere in this repository — the founder
 * provisions a Stripe price and STRIPE_PAUSE_PRICE_ID names it.
 *
 * INBOUND, DELIBERATELY UNBOUNDED. Inbound costs 1.0c/segment with no
 * offsetting revenue (billing/costs.ts), so a paused number that keeps
 * receiving is real spend against a small fixed fee, and the obvious instinct
 * is to bound it the way MAX_OFFRAMP_REPLIES bounds the off-ramp courtesy.
 * That instinct is wrong here, for a reason costs.ts already states: the
 * segment is received and billed by Telnyx BEFORE any code of ours runs. A cap
 * cannot prevent the cost — it can only throw away the customer's messages
 * after we have already paid for them, which is paying twice, once in money and
 * once in the promise the whole feature is built on ("your history and your
 * messages are waiting for you"). MAX_OFFRAMP_REPLIES is not the precedent it
 * looks like: it bounds our own SENDS, an outbound cost decided at the moment
 * of spending.
 *
 * What DOES apply is #449's inbound abuse ladder (INBOUND_ABUSE_TIERS_SEGMENTS
 * in plans.ts): absolute tiers at $25/$50/$100/$250/$500 of our money that
 * email the customer AND ops and block nothing. It already covers paused
 * workspaces — a pause leaves `subscription_status` active, which is what the
 * alert job selects on — and its first tier fires at 2,500 segments, roughly
 * eight times a plausible pause fee. A quiet winter number does not approach
 * it; one that does is not quiet, and the remedy is the one costs.ts names —
 * suspending the number, which is an abuse call a human makes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Env } from "../env";
import { pauseLicensedPrice, planForLicensedPrice, type PlanId } from "./plans";
import { itemHasDiscount, openPrepayment, type OpenPrepayment } from "./prepay";
import type { Stripe } from "./stripe";

export type PauseIneligibleReason =
  /**
   * The pause cannot bill here. STRIPE_PAUSE_PRICE_ID unset, or set to a price
   * that would charge nothing — see {@link pausePriceSnapshot}. Both are the
   * same answer to the customer: the offer does not exist.
   */
  | "not_provisioned"
  | "no_subscription"
  | "subscription_unhealthy"
  | "already_paused"
  | "plan_change_pending"
  | "already_prepaid"
  | "referral_month_pending"
  /**
   * A prepaid year's coupon is sitting on the licensed item with no
   * `prepayments` row to prove it. See {@link prepaidCouponPending}.
   */
  | "prepaid_coupon_orphaned";

export interface PauseEligibility {
  eligible: boolean;
  reason?: PauseIneligibleReason;
  /** The prepaid year in the way, when that is the reason. */
  open?: OpenPrepayment | null;
}

export interface CompanyForPause {
  id: string;
  plan: PlanId | null;
  subscription_status: string | null;
  stripe_subscription_id: string | null;
  paused_at: string | null;
  paused_price_cents: number | null;
}

/**
 * May this workspace pause, and why not?
 *
 * The gates that are not obvious:
 *
 * A SCHEDULE-MANAGED SUBSCRIPTION IS REFUSED, not queued. Stripe rejects item
 * writes while a schedule owns the items, so a pause issued during a pending
 * downgrade fails at the Stripe call with the customer already told it worked.
 * A 409 naming the pending change is the honest answer, and it is how prepaid
 * years and extra-number buys are already refused.
 *
 * A PREPAID YEAR IS REFUSED, and this one is money. The prepaid year is a
 * 100%-off coupon riding on the LICENSED ITEM (D107). Swapping that item's
 * price to the pause price moves the coupon onto the pause fee — so the
 * customer would pause for free while burning the months they already paid for,
 * and get back in spring having spent a chunk of a year they never used. There
 * is no version of that we could explain afterwards.
 *
 * AN UNCONSUMED REFERRAL MONTH IS REFUSED, for exactly the same reason and it
 * was missed the first time. #399's free month is also a 100%-off coupon on the
 * licensed item — `duration: once` rather than twelve months, but riding the
 * same line a pause swaps. Without this gate the pause bills $0 while we keep
 * paying FIXED_MONTHLY_COST_CENTS for the held number and the live campaign,
 * and the customer burns a $29/$79 credit on a ~$5 charge. Both harms come out
 * of one omission, which is why the prepaid-year gate alone was not enough.
 *
 * AN UNHEALTHY SUBSCRIPTION IS REFUSED. Past due means a card that is not
 * working, and swapping to a cheaper price does not collect the money already
 * owed; canceled means the 30-day clock is already running, and the answer to
 * that is to resubscribe, not to pause. Both are refused with the remedy named.
 */
export async function pauseEligibility(
  env: Env,
  db: SupabaseClient,
  company: CompanyForPause,
  subscription?: Stripe.Subscription | null,
): Promise<PauseEligibility> {
  // FAILS CLOSED, and first: with no price there is no pause, and there is
  // certainly no free one. A half-provisioned catalog must not give away a
  // number, a campaign and an inbox for nothing.
  if (!pauseLicensedPrice(env)) {
    return { eligible: false, reason: "not_provisioned" };
  }
  if (company.plan === null || !company.stripe_subscription_id) {
    return { eligible: false, reason: "no_subscription" };
  }
  if (company.paused_at !== null) {
    return { eligible: false, reason: "already_paused" };
  }
  if (company.subscription_status !== "active") {
    return { eligible: false, reason: "subscription_unhealthy" };
  }
  if (subscription?.schedule) {
    return { eligible: false, reason: "plan_change_pending" };
  }
  if (referralMonthPending(env, subscription)) {
    return { eligible: false, reason: "referral_month_pending" };
  }
  const open = await openPrepayment(db, company.id);
  if (open) {
    return { eligible: false, reason: "already_prepaid", open };
  }
  // AFTER the row, because the row is the record and this is the backstop for
  // the one case where the record is missing — see prepaidCouponPending.
  if (prepaidCouponPending(env, subscription)) {
    return { eligible: false, reason: "prepaid_coupon_orphaned" };
  }
  return { eligible: true, open: null };
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
  const licensed = planLicensedItem(env, subscription);
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
  const licensed = planLicensedItem(env, subscription);
  return licensed ? itemHasDiscount(licensed, coupon) : false;
}

/** A pause price we are willing to swap onto a subscription, and what it bills. */
export interface PausePrice {
  id: string;
  /** The recurring charge, USD cents. Always > 0 — see below. */
  cents: number;
}

/**
 * The configured pause price, read from Stripe, and refused unless it can
 * actually bill.
 *
 * THE PRICE IS PROVISIONED BY HAND IN A DASHBOARD and nothing in this
 * repository chooses it, so the two ways it can be wrong are both silent and
 * both give the product away:
 *
 *   A $0 PRICE is a genuinely free pause that every other guard passes. The
 *   env var is set, `pauseLicensedPrice` returns an id, the swap succeeds, the
 *   subscription is active — and the workspace holds a number and a live 10DLC
 *   campaign (FIXED_MONTHLY_COST_CENTS of ours, every month) against no revenue
 *   at all. It is the exact outcome `not_provisioned` exists to prevent,
 *   reached by a different route.
 *
 *   A TIERED PRICE has no `unit_amount`, so `paused_price_cents` mirrors NULL,
 *   and the #85 cost-vs-revenue projection then values the tenant at the full
 *   plan price — the founder's underwater report renders the paused cohort as
 *   the most profitable customers in the product. That column exists precisely
 *   to stop that, so a price it cannot read is a price we must not pause onto.
 *
 *   A PRICE THAT DOES NOT RECUR MONTHLY quotes a figure beside the word "month"
 *   that is off by twelve. Not an approximation — a different number.
 *
 * All three are refused BEFORE anybody is paused, rather than detected
 * afterwards, because afterwards means unwinding a subscription somebody is
 * living on. `active` goes with them: an archived price still resolves by id and
 * still reads as a real amount, but Stripe refuses to put it on a subscription,
 * and a clean refusal beats a 400 halfway through a swap.
 *
 * ONE READER FOR BOTH ROUTES, deliberately. `GET /v1/billing/pause` quotes this
 * figure and `POST /v1/billing/pause` swaps onto this id; if they judged the
 * catalog separately, the screen would offer a pause the route then refuses —
 * or worse, quote a price the swap does not use.
 *
 * AND THE ONE THING THIS CANNOT PROTECT ANYBODY FROM: rotating or unsetting
 * STRIPE_PAUSE_PRICE_ID while workspaces are paused STRANDS them. A pause is
 * identified by this exact price id sitting on the licensed item, so once it
 * changes we can no longer tell which item to swap back — `POST /resume` refuses
 * forever and there is no in-app way out. It fails on our side of the ledger
 * (they stay blocked from sending; nobody is given service for free), but it is
 * a support conversation per customer. Repricing the EXISTING price in Stripe is
 * safe; issuing a new id means resuming everybody first. This is written down
 * again in docs/deploy/06-env-reference.md, which is what the founder is reading
 * at the moment they could do it.
 */
export async function pausePriceSnapshot(
  env: Env,
  stripe: Stripe,
): Promise<PausePrice | null> {
  const id = pauseLicensedPrice(env);
  // No round trip when the offer does not exist here at all.
  if (!id) return null;
  const price = await stripe.prices.retrieve(id);
  if (!price.active) return null;
  if (price.recurring?.interval !== "month" || price.recurring.interval_count !== 1) {
    return null;
  }
  const cents = price.unit_amount ?? null;
  if (cents === null || cents <= 0) return null;
  return { id, cents };
}

/**
 * The subscription item carrying a PLAN's licensed price — the one a pause
 * swaps away from.
 *
 * Deliberately not "the first item without a meter": a subscription carries
 * module add-ons and extra-number lines that are also unmetered, and swapping
 * the price on one of those would leave the workspace on its full plan while
 * silently converting its Calling add-on into a pause.
 */
export function planLicensedItem(
  env: Env,
  subscription: Stripe.Subscription,
): Stripe.SubscriptionItem | undefined {
  return subscription.items.data.find(
    (item) => item.price && planForLicensedPrice(env, item.price.id) !== null,
  );
}

/**
 * The subscription item carrying the PAUSE price — the one a resume swaps back.
 */
export function pausedLicensedItem(
  env: Env,
  subscription: Stripe.Subscription,
): Stripe.SubscriptionItem | undefined {
  const price = pauseLicensedPrice(env);
  if (!price) return undefined;
  return subscription.items.data.find((item) => item.price?.id === price);
}

/**
 * How a pause and a resume treat the part-month they land in.
 *
 * `create_prorations` — credit the unused plan days, charge the pause days,
 * both settled on the next invoice — rather than `always_invoice` or `none`.
 *
 * `none` would keep the customer's money for plan days they no longer get,
 * which is the version somebody complains about. `always_invoice` issues a
 * document immediately, and for a pause that document is usually a CREDIT: an
 * invoice for a negative amount arriving in the inbox of somebody who just
 * chose to spend less is a support ticket, not a receipt. Prorating quietly
 * onto the next invoice is both fair and the least surprising thing that can
 * happen on a day somebody is trying to stop spending.
 */
export const PAUSE_PRORATION = "create_prorations" as const;
