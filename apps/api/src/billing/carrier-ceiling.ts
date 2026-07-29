/**
 * #457 — warn before the carrier ceiling, not after.
 *
 * D59 shipped the ceilings and `approachingCarrierCeiling(sentToday, useCase)`
 * with the same 80% fraction every other alert arm uses. Nothing called it,
 * because nothing counted a tenant's sends for a calendar day — every metric
 * we had was per-billing-period or point-in-time.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS ONE CANNOT BE FIXED BY PAYING US MORE.
 *
 * Every other cap in this product is ours: an overage cap, a storage figure, a
 * plan limit. A customer near one of those can act, and usually the action is
 * a click. This ceiling is the carrier's — 2,000 messages a day to T-Mobile on
 * LOW_VOLUME, 1,000 for a sole proprietor — and **neither can be raised by
 * vetting**. The only way up is a fresh registration taking days.
 *
 * So the warning is not a prompt to upgrade. It is the only chance to *spread
 * the batch over two days* instead of discovering the ceiling when sends start
 * failing, with no remedy for the rest of the week.
 *
 * Per D59 this is reachable only by a large single-day batch, so the
 * population is small. It is also, precisely, the growing crews with the most
 * traffic and the most to lose.
 */
import { approachingCarrierCeiling, dailyCeiling } from "@loonext/shared";
import type { TenDlcUseCase } from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import { renderEmailHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";
import { billingRecipients } from "./recipients";

interface DailyRow {
  company_id: string;
  use_case: string;
  sent_today: number;
}

/**
 * The day the CARRIER counts, not the one the customer feels.
 *
 * Carrier daily limits reset on UTC midnight, so a crew in California sending
 * hard on a Tuesday evening is already spending Wednesday's allowance. Using a
 * local midnight would warn them against the wrong budget — comfortably under
 * their own day's total while genuinely near the carrier's.
 */
function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function runCarrierCeilingJob(
  env: Env,
  now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<number> {
  const { data, error } = await db.rpc("api_daily_outbound", {
    p_since: utcDayStart(now).toISOString(),
  });
  if (error) throw new Error(`daily outbound scan failed: ${error.message}`);

  const dayStart = utcDayStart(now).toISOString();
  let warned = 0;
  for (const row of (data ?? []) as DailyRow[]) {
    const useCase = row.use_case as TenDlcUseCase;
    if (!approachingCarrierCeiling(row.sent_today, useCase)) continue;

    // Claim the day before sending, on the ledger every other alert uses.
    // This arm runs hourly — without the claim, a crew that crosses 80% at
    // nine in the morning is told again every hour until midnight, which
    // reads as panic rather than warning.
    const { data: claimed, error: claimError } = await db
      .from("usage_alerts")
      .upsert(
        {
          company_id: row.company_id,
          period_start: dayStart,
          metric: "carrier_daily",
          threshold: 80,
        },
        { onConflict: "company_id,period_start,metric,threshold", ignoreDuplicates: true },
      )
      .select("company_id");
    if (claimError) {
      console.error(`carrier ceiling claim failed for ${row.company_id}: ${claimError.message}`);
      continue;
    }
    if (!claimed || claimed.length === 0) continue; // already warned today

    const ceiling = dailyCeiling(useCase);
    try {
      const to = await billingRecipients(env, row.company_id, db);
      if (to.length === 0) continue;

      const text =
        `You have sent about ${row.sent_today} texts today, against a daily ` +
        `limit of ${ceiling} that the phone companies set.\n\n` +
        `This one is not a Loonext limit and we cannot raise it for you. ` +
        `Raising it means a fresh carrier registration, which takes days.\n\n` +
        `If you have more to send today, spreading the rest over tomorrow will ` +
        `get every message through. If you send it all now and hit the limit, ` +
        `the remainder will fail and there is nothing either of us can do until ` +
        `the count resets tonight.`;

      await sendEmail(env, {
        to,
        subject: "You're close to the daily texting limit the carriers set",
        text,
        html: renderEmailHtml(text),
      });
      warned += 1;
    } catch (cause) {
      // One tenant's bad address must not stop the rest being warned, and the
      // window this alert is useful in is measured in hours.
      console.error(`carrier ceiling warning failed for ${row.company_id}: ${String(cause)}`);
    }
  }

  return warned;
}
