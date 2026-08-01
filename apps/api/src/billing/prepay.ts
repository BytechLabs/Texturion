import type Stripe from "stripe";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Env } from "../env";
import { PLAN_PREPAY_YEAR_CENTS, prepayYearPrice, type PlanId } from "./plans";
import { getStripe } from "./stripe";

/**
 * #400 / D106 — a year bought up front, held as Stripe customer credit.
 *
 * # The shape, in one paragraph
 *
 * The customer pays ten months' money once through a `mode: "payment"` Checkout
 * Session. On completion we credit their Stripe customer by the amount actually
 * collected, and every existing MONTHLY invoice draws that credit down before
 * touching a card. Nothing about the subscription changes: allowances still
 * reset monthly, the overage cap is still enforced monthly, proration and
 * downgrade schedules are untouched.
 *
 * D106 records why the obvious alternative — a twelve-month billing interval —
 * is wrong for this product. The short version: Stripe subscriptions carry one
 * interval for every item, ours carry metered overage and a period-scoped
 * spend cap, so an annual period lets a busy January exhaust the year's
 * allowance and then throttle the workspace until December. We would have taken
 * a year's money and stopped the product working.
 *
 * # Why the grant is claimed in Postgres first
 *
 * `customers.createBalanceTransaction` is NOT idempotent, and this product's
 * Stripe webhook re-dispatches any event whose handler threw, on every
 * five-minute sweeper run — `stripe.test.ts` pins that contract on purpose. A
 * credit granted just before a later throw would be granted again on the retry,
 * and again, silently. So the `prepayments` row is taken FIRST, keyed on the
 * session id; a second delivery finds it and stops. If Stripe then refuses, the
 * claim is withdrawn so the retry can genuinely try again.
 *
 * That is the same claim-then-withdraw shape the $29 US registration fee
 * already uses, rather than a new invention.
 */

/** Marks a Checkout Session as a prepaid year rather than a subscription. */
export const PREPAY_METADATA_KIND = "prepay";

/** The metadata key carrying it. Namespaced so it cannot collide with Stripe's. */
export const PREPAY_METADATA_FIELD = "loonext_kind";

/**
 * Is this completed session a prepaid year?
 *
 * Checks the metadata rather than only `mode`, because mode alone would claim
 * any future one-time Checkout Session this product grows — and the failure it
 * would cause is silent money movement, not an error.
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
  | "not_activated";

export interface PrepayEligibility {
  eligible: boolean;
  reason?: PrepayIneligibleReason;
  /** The list price, in cents. Present whenever the catalog has one. */
  priceCents?: number;
}

interface CompanyForPrepay {
  id: string;
  plan: PlanId | null;
  subscription_status: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}

/**
 * Has this workspace ever actually sent a message?
 *
 * D106's rule, and #400's own sequencing insight: the offer appears AFTER
 * activation, never at signup. Asking somebody to pre-pay twelve months before
 * they have sent a single text — on a product that may still be waiting on
 * carrier approval, and that per #352 can be REJECTED — extracts the most at
 * the moment the customer has received the least.
 *
 * The predicate is a literal superset match for the partial index
 * `messages_outbound_accepted_period_idx (company_id, created_at) WHERE
 * direction='outbound' AND telnyx_message_id IS NOT NULL`, so this is a
 * one-tuple index probe. It is also the SAME predicate `captureFirstOutboundSent`
 * uses, so "activated" means one thing in this product rather than two.
 *
 * Deliberately not a stored column: a timestamp on `companies` would need a
 * backfill for every workspace that has already sent, and would cost a column
 * on the hottest route in the product to answer a question one screen asks.
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
 * May this workspace be offered a prepaid year, and at what price?
 *
 * The unhealthy-subscription gate is not defensive tidiness. `StatusNotices`
 * already owns the past_due and unpaid states at the top of the billing page,
 * and an offer rendered beside them would be selling a year to somebody whose
 * card just failed — which is both tasteless and the least likely money in the
 * product to actually clear.
 */
export async function prepayEligibility(
  env: Env,
  db: SupabaseClient,
  company: CompanyForPrepay,
): Promise<PrepayEligibility> {
  if (company.plan === null || !company.stripe_subscription_id) {
    return { eligible: false, reason: "no_subscription" };
  }
  const price = prepayYearPrice(env, company.plan);
  if (!price) return { eligible: false, reason: "not_provisioned" };

  const priceCents = PLAN_PREPAY_YEAR_CENTS[company.plan];
  // Only a genuinely healthy subscription. `active` and nothing else: a
  // past_due workspace is one whose payment already failed.
  if (company.subscription_status !== "active") {
    return { eligible: false, reason: "subscription_unhealthy", priceCents };
  }
  if (!(await hasSentOutbound(db, company.id))) {
    return { eligible: false, reason: "not_activated", priceCents };
  }
  return { eligible: true, priceCents };
}

/**
 * The credit still sitting on the customer, in cents.
 *
 * Stripe holds a credit as a NEGATIVE customer balance, so the available credit
 * is the negated balance and a positive balance (money owed to us) reads as
 * zero credit rather than as a negative one.
 *
 * Read from Stripe rather than computed from our own `prepayments` rows on
 * purpose: Stripe is where the drawdown happens, so it is the only place that
 * knows what is left. Our table records what was BOUGHT; it must never be
 * presented as what remains.
 */
export async function prepayCreditCents(
  env: Env,
  customerId: string | null,
): Promise<number> {
  if (!customerId) return 0;
  const customer = await getStripe(env).customers.retrieve(customerId);
  if (customer.deleted) return 0;
  const balance = customer.balance ?? 0;
  return balance < 0 ? -balance : 0;
}

/**
 * Grant the credit for a completed prepayment session. Idempotent.
 *
 * Returns what happened, so the caller can log the duplicate case rather than
 * treating it as a failure — a duplicate is the retry machinery working.
 */
export async function grantPrepayment(
  env: Env,
  db: SupabaseClient,
  session: Stripe.Checkout.Session,
): Promise<{ outcome: "granted" | "duplicate" }> {
  const companyId = session.client_reference_id;
  if (!companyId) {
    throw new Error(`Prepay session ${session.id} has no client_reference_id.`);
  }
  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id;
  if (!customerId) {
    throw new Error(`Prepay session ${session.id} has no customer.`);
  }
  // What was actually COLLECTED, never our list price. A promotion code changes
  // the amount, and crediting the catalog figure for a discounted payment would
  // hand out money we never took.
  const amount = session.amount_total ?? 0;
  if (amount <= 0) {
    throw new Error(`Prepay session ${session.id} collected nothing.`);
  }
  const currency = session.currency ?? "usd";

  const { data: claim, error: claimError } = await db.rpc("claim_prepayment", {
    p_company_id: companyId,
    p_stripe_session_id: session.id,
    p_amount_cents: amount,
    p_currency: currency,
    p_plan: session.metadata?.loonext_plan ?? null,
  });
  if (claimError) {
    throw new Error(`claim_prepayment failed: ${claimError.message}`);
  }
  const outcome = (claim as { outcome?: string } | null)?.outcome;
  if (outcome !== "claimed") return { outcome: "duplicate" };

  try {
    // Negative amount = credit. The idempotency key is belt to the claim's
    // braces: it stops a retry INSIDE this try block from double-crediting
    // before the claim row would have been withdrawn.
    const txn = await getStripe(env).customers.createBalanceTransaction(
      customerId,
      {
        amount: -amount,
        currency,
        description: `Prepaid year (${session.id})`,
      },
      { idempotencyKey: `prepay:${session.id}` },
    );
    const { error: stampError } = await db.rpc("stamp_prepayment", {
      p_stripe_session_id: session.id,
      p_balance_txn: txn.id,
    });
    if (stampError) {
      // The money moved. Losing the stamp is a bookkeeping gap, not a reason to
      // withdraw a claim that would then let a retry credit them twice.
      console.error(`stamp_prepayment failed for ${session.id}: ${stampError.message}`);
    }
    return { outcome: "granted" };
  } catch (cause) {
    // Give the claim back so the sweeper's retry can genuinely try again.
    // Guarded in SQL on `granted_at is null`, so this can never erase a
    // prepayment that actually landed.
    const { error: withdrawError } = await db.rpc("withdraw_prepayment", {
      p_stripe_session_id: session.id,
    });
    if (withdrawError) {
      console.error(
        `withdraw_prepayment failed for ${session.id}: ${withdrawError.message}`,
      );
    }
    throw cause;
  }
}
