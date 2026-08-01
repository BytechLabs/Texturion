/**
 * #422 — a chargeback, recorded, flagged and reported.
 *
 * The Stripe webhook handled seven event types and no dispute event was among
 * them; the endpoint was not even subscribed. So a disputed charge left no
 * trace anywhere: Stripe leaves a subscription ACTIVE while one of its charges
 * is disputed, our mirror faithfully copied `active`, and the service went on
 * running — accruing the number rental and the 10DLC campaign cost — for a
 * customer who had told their bank the charge was wrong.
 *
 * THE ARITHMETIC IS WHY IT IS URGENT. A disputed $29 costs $29 clawed back
 * plus Stripe's $15 dispute fee: $44 out on a sale that nets $27.71. One
 * dispute erases about a month and a half of that tenant's contribution while
 * we keep paying their carrier costs.
 *
 * IT DELIBERATELY DOES NOT SUSPEND. A dispute is an accusation, not a verdict
 * — some are a bank being clumsy or a spouse not recognising a line item.
 * Cutting a paying business off from their own customer conversations on the
 * strength of an accusation is a worse mistake than the money. This records,
 * flags and alerts; a human decides. The flag is what makes that decision
 * possible, and there was no way to make it before.
 */
import type Stripe from "stripe";

import { recordAudit } from "../audit/log";
import { getDb } from "../db";
import { revokePrepaidYearForPaymentIntent } from "./prepay";
import { emailLayout } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";
import { getStripe } from "./stripe";

/** Stripe's published dispute fee, in cents, when the event does not carry it. */
const ASSUMED_DISPUTE_FEE_CENTS = 1500;

export async function handleChargeDispute(
  env: Env,
  dispute: Stripe.Dispute,
  eventType: string,
): Promise<void> {
  const db = getDb(env);

  // The payment intent is the only id shared by the charge, the dispute and
  // the invoice's payment records in this SDK — `Charge.invoice` and a
  // top-level `Invoice.charge` do not exist, so keying on either would produce
  // a row that never joins to anything.
  const paymentIntent =
    typeof dispute.payment_intent === "string"
      ? dispute.payment_intent
      : (dispute.payment_intent?.id ?? null);
  const chargeId =
    typeof dispute.charge === "string" ? dispute.charge : (dispute.charge?.id ?? null);

  let companyId: string | null = null;
  let companyName: string | null = null;
  const customerId = await customerIdForDispute(env, dispute, chargeId);
  if (customerId) {
    const { data } = await db
      .from("companies")
      .select("id,name")
      .eq("stripe_customer_id", customerId)
      .limit(1);
    const row = (data ?? [])[0] as { id: string; name: string } | undefined;
    companyId = row?.id ?? null;
    companyName = row?.name ?? null;
  }

  const feeCents = disputeFeeCents(dispute);
  const closed = eventType === "charge.dispute.closed";
  const { data: recorded, error } = await db.rpc("record_billing_dispute", {
    p_dispute_id: dispute.id,
    p_company_id: companyId,
    p_charge_id: chargeId,
    p_payment_intent: paymentIntent,
    p_amount_cents: dispute.amount,
    p_fee_cents: feeCents,
    p_reason: dispute.reason,
    p_status: dispute.status,
    p_opened_at: new Date(dispute.created * 1000).toISOString(),
    p_evidence_due: dispute.evidence_details?.due_by
      ? new Date(dispute.evidence_details.due_by * 1000).toISOString()
      : null,
    p_closed_at: closed ? new Date().toISOString() : null,
  });
  if (error) throw new Error(`record_billing_dispute failed: ${error.message}`);

  // #400/D107: a chargeback the customer WON takes our money back. If a prepaid
  // year was bought with that payment, leaving its 100%-off coupon running
  // would deliver up to ten more free months on top of the clawback and the
  // dispute fee — the largest single loss any of these paths can produce.
  //
  // Only on `lost`: an ongoing dispute may still be won, and revoking a year
  // somebody paid for while we are still arguing about it would punish a
  // customer who turns out to be right.
  if (closed && dispute.status === "lost" && paymentIntent) {
    try {
      const revoked = await revokePrepaidYearForPaymentIntent(
        env,
        db,
        paymentIntent,
        `chargeback_lost:${dispute.id}`,
      );
      if (revoked.outcome === "revoked") {
        console.log(`prepaid year revoked after lost dispute ${dispute.id}`);
      }
    } catch (cause) {
      // Never let this fail the dispute record itself — that row is the alarm,
      // and losing it to a revocation error would hide the chargeback too.
      console.error(`prepaid-year revocation failed for ${dispute.id}: ${String(cause)}`);
    }
  }

  // #345: audited ONLY when the company resolved. `audit_log.company_id` is
  // NOT NULL with a foreign key, and `recordAudit` swallows its own failures
  // into Sentry — so an unguarded call on an unattributable dispute would be a
  // silent hole in exactly the log this issue asks for.
  if (companyId) {
    await recordAudit(db, {
      companyId,
      // Null actor: the documented "system actor (a cron, a provider webhook)"
      // case. Stripe raised this, not a person, and attributing it to whoever
      // happened to own the workspace would put a name on an act nobody here
      // performed.
      actorUserId: null,
      action: "billing.disputed",
      targetType: "company",
      targetId: companyId,
      after: {
        dispute_id: dispute.id,
        amount_cents: dispute.amount,
        reason: dispute.reason,
        status: dispute.status,
      },
    });
  }

  // One email per dispute, on the way in. At this customer count every single
  // one matters, and a RATE would swing wildly on a denominator of a handful —
  // the count is the signal.
  const first = (recorded as { first_seen?: boolean } | null)?.first_seen === true;
  if (first && !closed) {
    await alertFounder(env, dispute, { companyId, companyName, feeCents });
  }
}

/**
 * Stripe's dispute fee, in cents.
 *
 * Read from the balance transactions when present, otherwise assumed at the
 * published $15. Assuming is right here: under-reporting the cost is the one
 * direction that makes the alert less alarming than the truth, and the
 * arithmetic is the whole point of the alert.
 */
function disputeFeeCents(dispute: Stripe.Dispute): number {
  const fromBalance = dispute.balance_transactions?.reduce(
    (total, entry) => total + Math.abs(entry.fee ?? 0),
    0,
  );
  return fromBalance && fromBalance > 0 ? fromBalance : ASSUMED_DISPUTE_FEE_CENTS;
}

/** The Stripe customer behind a dispute, via the charge when not inlined. */
async function customerIdForDispute(
  env: Env,
  dispute: Stripe.Dispute,
  chargeId: string | null,
): Promise<string | null> {
  if (typeof dispute.charge === "object" && dispute.charge?.customer) {
    return typeof dispute.charge.customer === "string"
      ? dispute.charge.customer
      : dispute.charge.customer.id;
  }
  if (!chargeId) return null;
  try {
    const charge = await getStripe(env).charges.retrieve(chargeId);
    if (!charge.customer) return null;
    return typeof charge.customer === "string" ? charge.customer : charge.customer.id;
  } catch (cause) {
    // An unattributable dispute is MORE alarming, not less. The lookup failing
    // must never stop the record or the alert.
    console.error(`dispute ${dispute.id}: charge lookup failed: ${String(cause)}`);
    return null;
  }
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

async function alertFounder(
  env: Env,
  dispute: Stripe.Dispute,
  context: { companyId: string | null; companyName: string | null; feeCents: number },
): Promise<void> {
  const who = context.companyName
    ? `${context.companyName} (${context.companyId})`
    : "AN UNMATCHED CUSTOMER: no company has this Stripe customer id";
  const due = dispute.evidence_details?.due_by
    ? new Date(dispute.evidence_details.due_by * 1000).toISOString().slice(0, 10)
    : "not given";

  const text =
    `A charge was disputed.\n\n` +
    `Workspace: ${who}\n` +
    `Amount: ${dollars(dispute.amount)}\n` +
    `Stripe dispute fee: ${dollars(context.feeCents)}\n` +
    `Total cost: ${dollars(dispute.amount + context.feeCents)}\n` +
    `Reason: ${dispute.reason}\n` +
    `Status: ${dispute.status}\n` +
    `Evidence due by: ${due}\n\n` +
    `The subscription is STILL ACTIVE and the service is STILL RUNNING. ` +
    `Stripe leaves a subscription active while one of its charges is disputed, ` +
    `and we do not suspend on an accusation: a dispute is not a verdict, and ` +
    `cutting a paying business off from their own customer conversations over ` +
    `one would be worse than the money.\n\n` +
    `Whether to keep serving them is your call. The evidence deadline above is ` +
    `when Stripe stops waiting for you to make it.`;

  await sendEmail(env, {
    to: [env.OPS_ALERT_EMAIL ?? "support@loonext.com"],
    subject: `[ops] chargeback: ${dollars(dispute.amount + context.feeCents)} on ${
      context.companyName ?? "an unmatched customer"
    }`,
    text,
    html: emailLayout(
      `<p><strong>A charge was disputed.</strong></p><pre style="white-space:pre-wrap;font-family:inherit;">${text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")}</pre>`,
    ),
  });
}
