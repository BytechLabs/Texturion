/**
 * 80%/100% usage alerts (SPEC §2, §8, §9): when a company's current-period
 * outbound segments cross 80% or 100% of the plan's INCLUDED quota (never the
 * cap), email the owner + active admins — exactly once per (company, period,
 * threshold), gated by the `usage_alerts` ledger PK. Runs from the hourly
 * cron right after the usage re-reporter (§11 idempotency style: work is
 * selected by state — usage_events sums vs the ledger — never by "last run"
 * bookkeeping), so re-runs and overlaps can never double-send.
 */
import { billingRecipients } from "./recipients";
import { PLAN_INCLUDED_SEGMENTS, type PlanId } from "./plans";
import { getDb } from "../db";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";

/** Ledger-backed thresholds (SPEC §6 `usage_alerts.threshold in (80,100)`). */
export type UsageAlertThreshold = 80 | 100;
export const USAGE_ALERT_THRESHOLDS: readonly UsageAlertThreshold[] = [80, 100];

interface ActiveCompanyRow {
  id: string;
  name: string;
  plan: PlanId;
  current_period_start: string;
}

function alertCopy(
  company: ActiveCompanyRow,
  threshold: UsageAlertThreshold,
  included: number,
  used: number,
  env: Env,
): { subject: string; text: string } {
  const usageUrl = `${env.APP_ORIGIN}/settings/usage`;
  if (threshold === 100) {
    return {
      subject: `${company.name} has used all ${included} included messages this period`,
      text:
        `Hi,\n\n${company.name} has used ${used} outbound message segments this ` +
        `billing period — that's all ${included} included in your plan. ` +
        `Messages keep sending normally; extra segments are now billed as ` +
        `overage on your next invoice, up to your overage cap.\n\n` +
        `See usage and manage your cap: ${usageUrl}\n\n— JobText`,
    };
  }
  return {
    subject: `${company.name} has used 80% of its included messages`,
    text:
      `Hi,\n\n${company.name} has used ${used} of the ${included} outbound ` +
      `message segments included in your plan this billing period. Once the ` +
      `included quota is used up, extra segments are billed as overage on ` +
      `your next invoice.\n\n` +
      `See usage: ${usageUrl}\n\n— JobText`,
  };
}

function toHtml(text: string): string {
  const escaped = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<p>${escaped.replaceAll("\n\n", "</p><p>").replaceAll("\n", "<br>")}</p>`;
}

/**
 * Insert the `(company_id, period_start, threshold)` ledger row FIRST and only
 * send when the insert actually landed (the grace-notice pattern, §11).
 * Returns whether this call sent the email.
 */
async function recordAndSendUsageAlert(
  env: Env,
  company: ActiveCompanyRow,
  threshold: UsageAlertThreshold,
  included: number,
  used: number,
): Promise<boolean> {
  const db = getDb(env);
  const { data, error } = await db
    .from("usage_alerts")
    .upsert(
      {
        company_id: company.id,
        period_start: company.current_period_start,
        threshold,
      },
      {
        onConflict: "company_id,period_start,threshold",
        ignoreDuplicates: true,
      },
    )
    .select("company_id");
  if (error) {
    throw new Error(`usage_alerts insert failed: ${error.message}`);
  }
  if (!data || data.length === 0) return false; // ledger says already sent

  // Operational email: owner + active admins, bypasses notification_prefs (§8).
  const to = await billingRecipients(env, company.id, db);
  if (to.length === 0) return false;
  const { subject, text } = alertCopy(company, threshold, included, used, env);
  await sendEmail(env, { to, subject, text, html: toHtml(text) });
  return true;
}

/**
 * Hourly usage-alert check (SPEC §9 metering pipeline tail): for every active
 * company with a live billing period, sum the period's `usage_events` (the
 * app-side source of truth — same `api_period_segments` RPC as GET /v1/usage)
 * and send each crossed-threshold alert through the ledger.
 */
export async function runUsageAlertsJob(env: Env): Promise<void> {
  const db = getDb(env);
  const { data, error } = await db
    .from("companies")
    .select("id,name,plan,current_period_start")
    .eq("subscription_status", "active")
    .not("plan", "is", null)
    .not("current_period_start", "is", null)
    .is("deleted_at", null);
  if (error) {
    throw new Error(`active companies lookup failed: ${error.message}`);
  }

  const failures: unknown[] = [];
  for (const company of (data ?? []) as ActiveCompanyRow[]) {
    try {
      const { data: sum, error: sumError } = await db.rpc(
        "api_period_segments",
        {
          p_company_id: company.id,
          p_since: company.current_period_start,
        },
      );
      if (sumError) {
        throw new Error(`usage sum failed: ${sumError.message}`);
      }
      const used = Number(sum);
      const included = PLAN_INCLUDED_SEGMENTS[company.plan];

      for (const threshold of USAGE_ALERT_THRESHOLDS) {
        // Integer math: 80% of 500 = 400 segments, no float edge.
        if (used * 100 >= included * threshold) {
          await recordAndSendUsageAlert(env, company, threshold, included, used);
        }
      }
    } catch (cause) {
      // One broken tenant must not starve the rest; rethrown below so the
      // cron run still reports failure (Sentry wraps scheduled()).
      failures.push(cause);
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `usage-alert job failed for ${failures.length} compan${failures.length === 1 ? "y" : "ies"}`,
    );
  }
}
