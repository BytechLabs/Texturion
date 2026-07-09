/**
 * 80%/100% usage alerts (SPEC §2, §8, §9; #12 storage arms; #16 egress arm):
 * when a company crosses 80% or 100% of a budget, email the owner + active
 * admins — exactly once per (company, period, metric, threshold), gated by the
 * `usage_alerts` ledger PK. Six metrics: outbound `segments` vs the plan's
 * INCLUDED quota (never the cap); `mms_storage` + `attachment_storage` vs
 * their #12 storage budgets; `voice_minutes` vs the plan's call-forwarding
 * allowance; `mms_messages` vs the plan's included outbound picture messages;
 * and `egress` vs the #16 signed-URL download allowance. Runs from the hourly
 * cron right after the usage re-reporter (§11 idempotency style: work is
 * selected by state — sums vs the ledger — never by "last run" bookkeeping),
 * so re-runs and overlaps can never double-send.
 */
import { billingRecipients } from "./recipients";
import { effectiveStorageBudgets } from "./company-modules";
import { egressAllowanceBytes } from "../attachments/egress";
import {
  PLAN_INCLUDED_SEGMENTS,
  PLAN_MMS_INCLUDED,
  PLAN_VOICE_MINUTES,
  type PlanId,
} from "./plans";
import { getDb } from "../db";
import { toHtml } from "../email/html";
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
  | "mms_storage"
  | "attachment_storage"
  | "voice_minutes"
  | "mms_messages"
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
 * #12 storage-budget alert copy. MMS media is HELD when full (customer text
 * still lands — cap-and-drop only sheds the picture); attachment uploads are
 * PAUSED when full (the owner deletes files to free space). The copy states
 * exactly which happens so nobody is surprised by a dropped picture.
 */
function storageAlertCopy(
  company: ActiveCompanyRow,
  metric: "mms_storage" | "attachment_storage",
  threshold: UsageAlertThreshold,
  budgetBytes: number,
  usedBytes: number,
  env: Env,
): { subject: string; text: string } {
  const usageUrl = `${env.APP_ORIGIN}/settings/usage`;
  const budget = formatGb(budgetBytes);
  const used = formatGb(usedBytes);
  if (metric === "mms_storage") {
    if (threshold === 100) {
      return {
        subject: `${company.name} has reached its picture-message storage limit`,
        text:
          `Hi,\n\n${company.name}'s saved picture messages have reached ${budget}, ` +
          `the picture-message storage included in your plan. New incoming ` +
          `pictures are now held so the bill can't grow past your plan. The ` +
          `text of every message still comes through untouched. Free up space ` +
          `or move to a larger plan to start saving pictures again.\n\n` +
          `See usage: ${usageUrl}\n\nLoonext`,
      };
    }
    return {
      subject: `${company.name} is nearing its picture-message storage limit`,
      text:
        `Hi,\n\n${company.name} has used ${used} of the ${budget} of ` +
        `picture-message storage included in your plan. When it's full, new ` +
        `incoming pictures are held (the message text still comes through). ` +
        `Free up space or move to a larger plan to avoid that.\n\n` +
        `See usage: ${usageUrl}\n\nLoonext`,
    };
  }
  if (threshold === 100) {
    return {
      subject: `${company.name} has reached its file storage limit`,
      text:
        `Hi,\n\n${company.name}'s files attached to notes have reached ${budget}, ` +
        `the file storage included in your plan. New uploads are paused until ` +
        `you delete files you no longer need, or move to a larger plan.\n\n` +
        `See usage: ${usageUrl}\n\nLoonext`,
    };
  }
  return {
    subject: `${company.name} is nearing its file storage limit`,
    text:
      `Hi,\n\n${company.name} has used ${used} of the ${budget} of file ` +
      `storage included in your plan. When it's full, new uploads are paused ` +
      `until you delete files you no longer need.\n\n` +
      `See usage: ${usageUrl}\n\nLoonext`,
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
 * #12 picture-message alert copy. Over the allowance, new sends drop the PICTURE
 * and go out text-only (the customer still gets the message) — the copy says so
 * plainly so a busy shop upgrades before its photos stop going through.
 */
function mmsAlertCopy(
  company: ActiveCompanyRow,
  threshold: UsageAlertThreshold,
  includedMessages: number,
  usedMessages: number,
  env: Env,
): { subject: string; text: string } {
  const usageUrl = `${env.APP_ORIGIN}/settings/usage`;
  if (threshold === 100) {
    return {
      subject: `${company.name} has used all its included picture messages`,
      text:
        `Hi,\n\n${company.name} has sent all ${includedMessages} picture ` +
        `messages included in your plan this billing period. New picture sends ` +
        `now go out as text only (the message still reaches your customer, ` +
        `without the photo), so your messaging bill can't run past your plan. ` +
        `Move to a larger plan to keep sending pictures.\n\n` +
        `See usage: ${usageUrl}\n\nLoonext`,
    };
  }
  return {
    subject: `${company.name} is nearing its picture-message limit`,
    text:
      `Hi,\n\n${company.name} has sent ${usedMessages} of the ${includedMessages} ` +
      `picture messages included in your plan this billing period. Once they're ` +
      `used up, new picture sends go out as text only (the message still reaches ` +
      `your customer, without the photo). Move to a larger plan to avoid that.\n\n` +
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
      `files and pictures included with your plan's storage this billing ` +
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
  threshold: UsageAlertThreshold,
  copy: { subject: string; text: string },
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
    html: toHtml(copy.text),
  });
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

      // #12 storage arms: MMS media + attachment files each have their own
      // budget (separate pools) and their own cap behaviour. Storage is a
      // point-in-time total, so keying by current_period_start re-warns the
      // owner at most once per period while still over — a gentle monthly nudge.
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
      // Effective budgets include the extra_storage add-on when enabled.
      const { attachmentBytes, mmsBytes } = await effectiveStorageBudgets(
        db,
        company.id,
        company.plan,
      );
      const storageArms: {
        metric: "mms_storage" | "attachment_storage";
        used: number;
        budget: number;
      }[] = [
        {
          metric: "mms_storage",
          used: Number(s.mms_bytes),
          budget: mmsBytes,
        },
        {
          metric: "attachment_storage",
          used: Number(s.attachments_bytes),
          budget: attachmentBytes,
        },
      ];
      for (const arm of storageArms) {
        for (const threshold of USAGE_ALERT_THRESHOLDS) {
          if (arm.used * 100 >= arm.budget * threshold) {
            await recordAndSendAlert(
              env,
              company,
              arm.metric,
              threshold,
              storageAlertCopy(
                company,
                arm.metric,
                threshold,
                arm.budget,
                arm.used,
                env,
              ),
            );
          }
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

      // #12 mms arm: warn before the hard cap (send.ts) starts stripping the
      // picture off new sends. Counts the outbound MMS already accepted this
      // period — the same RPC the send-time cap and GET /v1/usage read.
      const { data: mmsUsed, error: mmsError } = await db.rpc(
        "api_period_outbound_mms",
        { p_company_id: company.id, p_since: company.current_period_start },
      );
      if (mmsError) {
        throw new Error(`mms usage failed: ${mmsError.message}`);
      }
      const usedMms = Number(mmsUsed);
      const includedMms = PLAN_MMS_INCLUDED[company.plan];
      for (const threshold of USAGE_ALERT_THRESHOLDS) {
        if (usedMms * 100 >= includedMms * threshold) {
          await recordAndSendAlert(
            env,
            company,
            "mms_messages",
            threshold,
            mmsAlertCopy(company, threshold, includedMms, usedMms, env),
          );
        }
      }

      // #16 egress arm: warn before the hard cap (routes/attachments.ts) starts
      // refusing signed download URLs. The allowance is derived from the SAME
      // effective storage budgets read above (4× their combined size — one
      // source of truth in attachments/egress.ts, shared with the mint route),
      // and the sum is the same RPC window the atomic claim enforces.
      const { data: egressBytes, error: egressError } = await db.rpc(
        "api_period_egress_bytes",
        { p_company_id: company.id, p_since: company.current_period_start },
      );
      if (egressError) {
        throw new Error(`egress usage failed: ${egressError.message}`);
      }
      const usedEgress = Number(egressBytes);
      const egressAllowance = egressAllowanceBytes({ attachmentBytes, mmsBytes });
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
