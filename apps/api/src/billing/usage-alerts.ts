/**
 * 80%/100% usage alerts (SPEC §2, §8, §9; #12 storage arms; #16 egress arm):
 * when a company crosses 80% or 100% of a budget, email the owner + active
 * admins — exactly once per (company, period, metric, threshold), gated by the
 * `usage_alerts` ledger PK. Five static metrics: outbound `segments` vs the
 * plan's INCLUDED quota (never the cap); `mms_storage` + `attachment_storage`
 * vs their #12 storage budgets; `voice_minutes` vs the plan's call-forwarding
 * allowance; and `egress` vs the #16 signed-URL download allowance. (#103: no
 * `mms_messages` arm — pictures meter as segments now.) Runs from the hourly
 * cron right after the usage re-reporter (§11 idempotency style: work is
 * selected by state — sums vs the ledger — never by "last run" bookkeeping),
 * so re-runs and overlaps can never double-send.
 */
import { billingRecipients } from "./recipients";
import { EGRESS_ALLOWANCE_BYTES } from "../attachments/egress";
import {
  PLAN_INCLUDED_SEGMENTS,
  PLAN_VOICE_MINUTES,
  type PlanId,
  STORAGE_ABUSE_TIERS_GB,
} from "./plans";
import { getDb } from "../db";
import { renderEmailHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";

/** Ledger-backed thresholds (SPEC §6 `usage_alerts.threshold in (80,100)`). */
export type UsageAlertThreshold = 80 | 100;
export const USAGE_ALERT_THRESHOLDS: readonly UsageAlertThreshold[] = [80, 100];

/**
 * The budget a threshold is measured against. `segments` is the per-period
 * outbound quota; the two `*_storage` metrics are the #12 point-in-time storage
 * budgets (their own separate pools). The `metric` column keeps them from
 * colliding at the same (company, period, threshold).
 */
export type UsageAlertMetric =
  | "segments"
  // "mms_storage" / "attachment_storage" retired with the storage budgets
  // (#121) — historic ledger rows keep those values (the DB CHECK still
  // allows them), we just never write them again. The one storage arm left
  // is the absolute-tier abuse alert below.
  | "storage_abuse"
  | "voice_minutes"
  // "mms_messages" retired with the Picture-messages module (#103) — historic
  // ledger rows keep the value (the DB CHECK still allows it), we just never
  // write it again.
  | "egress"
  // #85/#92: dynamic overage warning — one ledger row per (company, period).
  | "cost_projection";

export interface ActiveCompanyRow {
  id: string;
  name: string;
  plan: PlanId;
  current_period_start: string;
}

/** "5 GB" / "2.3 GB" for the storage-alert copy. */
function formatGb(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
}

function segmentAlertCopy(
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
        `billing period. That's all ${included} included in your plan. ` +
        `Messages keep sending normally; extra segments are now billed as ` +
        `overage on your next invoice, up to your overage cap.\n\n` +
        `See usage and manage your cap: ${usageUrl}\n\nLoonext`,
    };
  }
  return {
    subject: `${company.name} has used 80% of its included messages`,
    text:
      `Hi,\n\n${company.name} has used ${used} of the ${included} outbound ` +
      `message segments included in your plan this billing period. Once the ` +
      `included quota is used up, extra segments are billed as overage on ` +
      `your next invoice.\n\n` +
      `See usage: ${usageUrl}\n\nLoonext`,
  };
}

/**
 * #121 storage-abuse copy (replaces the retired budget alerts): storage is
 * free and NOTHING blocks — this is a friendly heads-up to the customer that
 * their stored bytes crossed an unusual absolute tier, and a parallel ops
 * note so a human can look. Tone matters: the customer email must never read
 * as a warning shot; it is "all good, here's what we noticed, reply if this
 * is just how you work."
 */
function storageAbuseCopy(
  company: ActiveCompanyRow,
  tierGb: number,
  usedBytes: number,
  env: Env,
): { customer: { subject: string; text: string }; ops: { subject: string; text: string } } {
  const used = formatGb(usedBytes);
  const usageUrl = `${env.APP_ORIGIN}/settings/usage`;
  return {
    customer: {
      subject: `A note about ${company.name}'s storage`,
      text:
        `Hi,

Storage on Loonext is free and nothing is paused, so this is ` +
        `just a heads-up: ${company.name} is now storing about ${used} of ` +
        `files and pictures, which is a lot more than a typical crew. If ` +
        `that's simply how you work, great — carry on and ignore this. If it ` +
        `looks surprising, your files are listed under each conversation and ` +
        `you can tidy up any time.

Our fair use policy asks only that ` +
        `storage stays about one business keeping its own customer ` +
        `conversations. If we ever need anything from you, a human will ` +
        `email you personally — nothing automatic will ever block or delete ` +
        `your files.

See usage: ${usageUrl}

Loonext`,
    },
    ops: {
      subject: `[ops] storage abuse tier ${tierGb} GB: ${company.name}`,
      text:
        `Company ${company.name} (${company.id}) crossed the ${tierGb} GB ` +
        `storage tier: ${used} stored (attachments + MMS). Plan: ` +
        `${company.plan}. The customer received the friendly heads-up. ` +
        `Review under the fair-use policy if this keeps escalating.`,
    },
  };
}

/**
 * #12 voice-minutes alert copy. Over the allowance, new inbound calls are NOT
 * forwarded (the caller gets the text-back instead) — the copy says so plainly
 * so a busy owner upgrades before their customers stop getting through.
 */
function voiceAlertCopy(
  company: ActiveCompanyRow,
  threshold: UsageAlertThreshold,
  includedMinutes: number,
  usedMinutes: number,
  env: Env,
): { subject: string; text: string } {
  const usageUrl = `${env.APP_ORIGIN}/settings/usage`;
  if (threshold === 100) {
    return {
      subject: `${company.name} has used all its included call-forwarding minutes`,
      text:
        `Hi,\n\n${company.name} has used all ${includedMinutes} call-forwarding ` +
        `minutes included in your plan this billing period. New incoming calls ` +
        `are no longer forwarded to your cell (callers get your missed-call ` +
        `text instead), so your phone bill can't run past your plan. Move to a ` +
        `larger plan to keep forwarding calls.\n\n` +
        `See usage: ${usageUrl}\n\nLoonext`,
    };
  }
  return {
    subject: `${company.name} is nearing its call-forwarding minutes limit`,
    text:
      `Hi,\n\n${company.name} has used ${usedMinutes} of the ${includedMinutes} ` +
      `call-forwarding minutes included in your plan this billing period. Once ` +
      `they're used up, new incoming calls stop forwarding to your cell (callers ` +
      `get your missed-call text instead). Move to a larger plan to avoid that.\n\n` +
      `See usage: ${usageUrl}\n\nLoonext`,
  };
}

/**
 * #16 download (egress) alert copy. Over the allowance, minting new download
 * links is refused until the period resets — files stay stored and safe; only
 * the download door pauses. The copy says exactly that so nobody fears data
 * loss when a link stops working.
 */
function egressAlertCopy(
  company: ActiveCompanyRow,
  threshold: UsageAlertThreshold,
  allowanceBytes: number,
  usedBytes: number,
  env: Env,
): { subject: string; text: string } {
  const usageUrl = `${env.APP_ORIGIN}/settings/usage`;
  const allowance = formatGb(allowanceBytes);
  const used = formatGb(usedBytes);
  if (threshold === 100) {
    return {
      subject: `${company.name} has used all its included file downloads this period`,
      text:
        `Hi,\n\n${company.name} has downloaded ${allowance} of files and ` +
        `pictures this billing period. That's the full download allowance included ` +
        `with your plan's storage. New downloads are paused until your next ` +
        `period starts so the bill can't grow past your plan; everything stays ` +
        `safely stored in the meantime. If you're hitting this in normal use, ` +
        `just reply to this email.\n\n` +
        `See usage: ${usageUrl}\n\nLoonext`,
    };
  }
  return {
    subject: `${company.name} is nearing its file-download limit for this period`,
    text:
      `Hi,\n\n${company.name} has downloaded ${used} of the ${allowance} of ` +
      `files and pictures in your plan's download allowance this billing ` +
      `period. When it's used up, new downloads pause until the next period ` +
      `starts (everything stays safely stored). If you're hitting this in ` +
      `normal use, just reply to this email.\n\n` +
      `See usage: ${usageUrl}\n\nLoonext`,
  };
}

/**
 * Insert the `(company_id, period_start, metric, threshold)` ledger row FIRST
 * and only send when the insert actually landed (the grace-notice pattern,
 * §11). Returns whether this call sent the email.
 */
export async function recordAndSendAlert(
  env: Env,
  company: ActiveCompanyRow,
  metric: UsageAlertMetric,
  // 80|100 for the classic percent arms; an absolute GB tier for
  // storage_abuse (#121) — the ledger PK treats it purely as a dedupe key.
  threshold: number,
  copy: { subject: string; text: string },
  /** #121: when set, a second email rides the SAME ledger dedupe to ops
   * (OPS_ALERT_EMAIL, default support@loonext.com — routes to the founder). */
  ops?: { subject: string; text: string },
): Promise<boolean> {
  const db = getDb(env);
  const { data, error } = await db
    .from("usage_alerts")
    .upsert(
      {
        company_id: company.id,
        period_start: company.current_period_start,
        metric,
        threshold,
      },
      {
        onConflict: "company_id,period_start,metric,threshold",
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
  await sendEmail(env, {
    to,
    subject: copy.subject,
    text: copy.text,
    html: renderEmailHtml(copy.text),
  });
  if (ops) {
    await sendEmail(env, {
      to: [env.OPS_ALERT_EMAIL ?? "support@loonext.com"],
      subject: ops.subject,
      text: ops.text,
      html: renderEmailHtml(ops.text),
    });
  }
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
          await recordAndSendAlert(
            env,
            company,
            "segments",
            threshold,
            segmentAlertCopy(company, threshold, included, used, env),
          );
        }
      }

      // #121 storage-abuse arm (replaces the retired budget arms): storage
      // is free — nothing blocks — but total stored bytes crossing an
      // absolute tier emails the customer (friendly) and ops (factual), once
      // per tier per period via the same ledger dedupe. Escalating tiers keep
      // a runaway tenant re-alerting as it doubles.
      const { data: storage, error: storageError } = await db.rpc(
        "api_storage_usage",
        { p_company_id: company.id },
      );
      if (storageError) {
        throw new Error(`storage usage failed: ${storageError.message}`);
      }
      const s = storage as {
        attachments_bytes: number | string;
        mms_bytes: number | string;
      };
      const totalStoredBytes = Number(s.attachments_bytes) + Number(s.mms_bytes);
      for (const tierGb of STORAGE_ABUSE_TIERS_GB) {
        if (totalStoredBytes >= tierGb * 1024 ** 3) {
          const abuse = storageAbuseCopy(company, tierGb, totalStoredBytes, env);
          await recordAndSendAlert(
            env,
            company,
            "storage_abuse",
            tierGb,
            abuse.customer,
            abuse.ops,
          );
        }
      }

      // #12 voice arm: warn before the hard cap (voice-webhook.ts) starts
      // rejecting calls. Threshold math is on SECONDS to avoid a rounding edge;
      // the copy shows whole minutes.
      const { data: voiceSeconds, error: voiceError } = await db.rpc(
        "api_period_voice_seconds",
        { p_company_id: company.id, p_since: company.current_period_start },
      );
      if (voiceError) {
        throw new Error(`voice usage failed: ${voiceError.message}`);
      }
      const usedVoiceSeconds = Number(voiceSeconds);
      const includedVoiceSeconds = PLAN_VOICE_MINUTES[company.plan] * 60;
      for (const threshold of USAGE_ALERT_THRESHOLDS) {
        if (usedVoiceSeconds * 100 >= includedVoiceSeconds * threshold) {
          await recordAndSendAlert(
            env,
            company,
            "voice_minutes",
            threshold,
            voiceAlertCopy(
              company,
              threshold,
              PLAN_VOICE_MINUTES[company.plan],
              Math.floor(usedVoiceSeconds / 60),
              env,
            ),
          );
        }
      }

      // #97/#103: no mms arm — picture messages have no separate cap anymore
      // (each MMS meters as 3 segments, so the `segments` arm above covers it).

      // #16 egress arm: warn before the hard cap (routes/attachments.ts)
      // starts refusing signed download URLs. #121: the allowance is the
      // FIXED per-period pool (attachments/egress.ts EGRESS_ALLOWANCE_BYTES),
      // an anti-abuse cost backstop, no longer derived from storage budgets.
      const { data: egressBytes, error: egressError } = await db.rpc(
        "api_period_egress_bytes",
        { p_company_id: company.id, p_since: company.current_period_start },
      );
      if (egressError) {
        throw new Error(`egress usage failed: ${egressError.message}`);
      }
      const usedEgress = Number(egressBytes);
      const egressAllowance = EGRESS_ALLOWANCE_BYTES;
      for (const threshold of USAGE_ALERT_THRESHOLDS) {
        if (usedEgress * 100 >= egressAllowance * threshold) {
          await recordAndSendAlert(
            env,
            company,
            "egress",
            threshold,
            egressAlertCopy(company, threshold, egressAllowance, usedEgress, env),
          );
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
