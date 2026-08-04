/**
 * #421 — somebody chose to cancel, and the owner should hear it from us.
 *
 * A portal cancellation arrives as `customer.subscription.updated` with
 * `cancel_at_period_end` newly true. Until now that started a grace countdown
 * and told nobody: `grace.ts` releases the number 30 days later, and a released
 * number goes back to carrier inventory and is reassigned to another business
 * (#413). So an irreversible clock could start on the company's phone number
 * with no notice to the person who owns it.
 *
 * The owner specifically, not the whole crew. This is not operational news
 * everybody needs; it is one person's decision to make and unmake, and paging
 * a crew about their employer's billing would be a different mistake.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import { recordAudit } from "../audit/log";
import { emailLayout } from "../email/html";
import { sendEmail } from "../email/resend";
import { pushConsequentialNotice } from "./consequential-push";
import type { Env } from "../env";

interface CancellingCompany {
  id: string;
  name: string;
  owner_user_id: string;
}

/**
 * Was this update the MOMENT of cancellation, rather than a restatement of it?
 *
 * Stripe re-sends `customer.subscription.updated` for many reasons and each one
 * carries the same `cancel_at_period_end: true` once it is set. Comparing
 * against what we already mirrored is what makes the notice fire once. Without
 * it the owner gets an identical email every time the card is touched, and
 * learns to ignore the one that mattered.
 */
export async function isNewCancellation(
  db: SupabaseClient,
  subscriptionId: string,
  subscription: Stripe.Subscription,
  mirroredStatus: string,
): Promise<boolean> {
  if (subscription.cancel_at_period_end !== true) return false;
  // A subscription already dead is #21's territory, not this one.
  if (mirroredStatus === "canceled") return false;

  const { data, error } = await db
    .from("companies")
    .select("cancel_at_period_end")
    .eq("stripe_subscription_id", subscriptionId)
    .limit(1);
  if (error) {
    // Never let this read decide whether the mirror runs. Failing to know
    // costs a notice; failing the sync would cost the mirror itself.
    console.error(`cancellation notice: prior state unreadable: ${error.message}`);
    return false;
  }
  const prior = (data ?? [])[0] as { cancel_at_period_end?: boolean } | undefined;
  return prior?.cancel_at_period_end !== true;
}

/**
 * Tell the owner, and record who did it.
 *
 * Best-effort by construction: a subscription mirror must never fail because an
 * email did. The mirror is the truth of the account; this is a courtesy on top
 * of it, and one that is worthless if it can take the truth down with it.
 */
export async function noticeCancellation(
  env: Env,
  db: SupabaseClient,
  company: CancellingCompany,
  subscription: Stripe.Subscription,
): Promise<void> {
  try {
    // #345 / #421 ask 4: "who cancelled the subscription" is exactly what the
    // audit log exists to answer. The actor is null because Stripe's hosted
    // portal does not tell us which member clicked — recording the workspace
    // owner would name somebody who may not have done it.
    await recordAudit(db, {
      companyId: company.id,
      actorUserId: null,
      action: "billing.cancellation_scheduled",
      targetType: "company",
      targetId: company.id,
      after: {
        subscription_id: subscription.id,
        cancel_at_period_end: true,
        current_period_end: subscription.items?.data?.[0]?.current_period_end ?? null,
      },
    });
  } catch (cause) {
    console.error(`cancellation audit failed for ${company.id}: ${String(cause)}`);
  }

  try {
    const { data, error } = await db.auth.admin.getUserById(company.owner_user_id);
    if (error || !data.user?.email) return;

    const endsAt = subscription.items?.data?.[0]?.current_period_end;
    const when = endsAt
      ? new Date(endsAt * 1000).toISOString().slice(0, 10)
      : "the end of the current billing period";

    const settingsUrl = `${env.APP_ORIGIN}/settings/billing`;
    // #413: the customer may not understand what release means. The number is
    // the asset the business spent years putting on trucks and invoices, and
    // "your subscription ends" does not convey that it goes to somebody else.
    const text =
      `Someone cancelled the Loonext subscription for ${company.name}.\n\n` +
      `Your plan stays active until ${when}. Nothing is lost before then, and ` +
      `you can undo this yourself in billing settings.\n\n` +
      `What happens if you do not:\n\n` +
      `Thirty days after the plan ends we release your business number. A ` +
      `released number does not sit idle waiting for you — it goes back to the ` +
      `carrier and is given to another business. Customers who text the number ` +
      `on your van, your invoices and your website will reach somebody else, ` +
      `and there is no way for us to get it back.\n\n` +
      `If you meant to cancel, nothing else is needed. If you did not, ` +
      `undo it here: ${settingsUrl}\n\n` +
      `You are getting this because you own this workspace. Admins can manage ` +
      `billing, so it may not have been you.`;

    await sendEmail(env, {
      // #252: critical. Thirty days of runway on it, and if this is the
      // message that gets filtered the next one is already too late.
      critical: true,
      to: [data.user.email],
      subject: `Your Loonext subscription was cancelled — your number is released in 30 days`,
      text,
      html: emailLayout(
        `<p>Someone cancelled the Loonext subscription for <strong>${company.name}</strong>.</p>` +
          `<p>Your plan stays active until <strong>${when}</strong>, and you can undo this yourself.</p>` +
          `<p>Thirty days after the plan ends we release your business number. A released number ` +
          `goes back to the carrier and is given to another business — customers who text the ` +
          `number on your van and your invoices will reach somebody else, and we cannot get it back.</p>` +
          `<p><a href="${settingsUrl}" style="color:#66801F;text-decoration:underline;">Undo the cancellation</a></p>` +
          `<p style="font-size:14px;color:#6E7163;">You are getting this because you own this workspace. ` +
          `Admins can manage billing, so it may not have been you.</p>`,
      ),
    });

    // #252: the FIRST warning, and the one with thirty days of runway still on
    // it — every later notice is a shorter deadline. If this is the one that
    // gets filtered, the customer's next contact with the subject is a number
    // that already belongs to somebody else.
    //
    // Deliberately not collapsed with the day-1/15/27 rungs: this is a
    // different deadline from every one of them, and a shared key would let a
    // later warning erase the notice that still had time to act on.
    await pushConsequentialNotice(env, db, {
      companyId: company.id,
      title: "Your subscription was cancelled — your number goes in 30 days",
      body: "You can undo this yourself. Open Loonext to keep your number.",
      path: "/settings/billing",
      collapseKey: `cancellation:${company.id}`,
    });
  } catch (cause) {
    console.error(`cancellation notice failed for ${company.id}: ${String(cause)}`);
  }
}
