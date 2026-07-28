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
import * as Sentry from "@sentry/cloudflare";
import { storedBytes, type StorageUsageRow } from "./stored-bytes";

import { billingRecipients } from "./recipients";
import { UNIT_COST_CENTS } from "./costs";
import { EGRESS_ALLOWANCE_BYTES } from "../attachments/egress";
import {
  dialCeilings,
  INBOUND_ABUSE_TIERS_SEGMENTS,
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
  // "voice_minutes_grandfathered" retired with the module (#134/D42) —
  // historic ledger rows keep the value (the DB CHECK still allows it).
  // "mms_messages" retired with the Picture-messages module (#103) — historic
  // ledger rows keep the value (the DB CHECK still allows it), we just never
  // write it again.
  | "egress"
  // #85/#92: dynamic overage warning — one ledger row per (company, period).
  | "cost_projection"
  // #448: per-dial fees, which the SECONDS-denominated spending cap cannot
  // bound. One ledger row per (company, period) — this is our cost, not the
  // customer's bill, so it goes to ops only.
  | "voice_dials"
  // #449: inbound segments — free to the customer, 0.7c to us, and the one
  // cost that cannot be capped because it is already paid for by the time we
  // see it. Absolute tiers, the storage-abuse shape.
  | "inbound_volume";

export interface ActiveCompanyRow {
  id: string;
  name: string;
  plan: PlanId;
  current_period_start: string;
  /** #448: the dial-count lines scale with the same ceiling the minute cap
   *  uses, so a tenant who raised their cap is not alerted at a tenth of the
   *  point where dialing actually stops. */
  overage_cap_multiplier: number | string | null;
}

/**
 * #449 — the tenant's inbound over the 30 days BEFORE the last 30, so an ops
 * reader can tell a flood from a busy season without opening a console.
 *
 * Derived by subtraction because `api_period_inbound_segments` counts from a
 * point forward rather than over a range: everything since 60 days ago, minus
 * everything since 30 days ago. Deliberately a rolling window rather than the
 * previous billing period — periods vary in length and a tenant mid-migration
 * may not have a clean previous one, and the comparison only has to be
 * indicative.
 *
 * Returns null rather than throwing: this is context on an alert, and losing
 * the context must never lose the alert.
 */
async function trailingInboundBaseline(
  db: ReturnType<typeof getDb>,
  companyId: string,
  now: Date,
): Promise<number | null> {
  try {
    const day = 24 * 60 * 60 * 1000;
    const since60 = new Date(now.getTime() - 60 * day).toISOString();
    const since30 = new Date(now.getTime() - 30 * day).toISOString();
    const [older, recent] = await Promise.all([
      db.rpc("api_period_inbound_segments", {
        p_company_id: companyId,
        p_since: since60,
      }),
      db.rpc("api_period_inbound_segments", {
        p_company_id: companyId,
        p_since: since30,
      }),
    ]);
    if (older.error || recent.error) return null;
    return Math.max(0, Number(older.data) - Number(recent.data));
  } catch {
    return null;
  }
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
 * D36 (#128) voice-minutes alert copy. The allowance is a fair-use line, not
 * a wall: past 100%, extra forwarded minutes bill at 1¢ each up to the
 * owner's spending cap (the same cap that bounds text overage), and only AT
 * the cap does calling pause (callers get the text-back instead). The
 * copy mirrors the segments emails so paid overage never begins unnoticed.
 * (#134/D42: the grandfathered pause-copy variant retired with the module.)
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
      subject: `${company.name} has used all ${includedMinutes} included calling minutes this period`,
      text:
        `Hi,\n\n${company.name} has used all ${includedMinutes} calling ` +
        `minutes included in your plan this billing period (forwarded calls ` +
        `and calls you place, together). Calls keep working normally; extra ` +
        `minutes are now billed at 1¢ each on your next invoice, up to your ` +
        `spending cap. At the cap, calling pauses for the rest of the period ` +
        `and missed callers still get your missed-call text.\n\n` +
        `See usage and manage your cap: ${usageUrl}\n\nLoonext`,
    };
  }
  return {
    subject: `${company.name} has used 80% of its included calling minutes`,
    text:
      `Hi,\n\n${company.name} has used ${usedMinutes} of the ${includedMinutes} ` +
      `calling minutes included in your plan this billing period (forwarded ` +
      `calls and calls you place, together). Once the included minutes are ` +
      `used up, extra minutes are billed at 1¢ each on your next invoice, ` +
      `up to your spending cap.\n\n` +
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
 * Per-run cap on the active-company scan — each company issues ~4 usage RPCs,
 * so this bounds subrequests well under the Workers ceiling and makes the read
 * limit explicit rather than a silent PostgREST 1000-row truncation.
 */
const USAGE_ALERTS_BATCH = 200;

/**
 * Hourly usage-alert check (SPEC §9 metering pipeline tail): for every active
 * company with a live billing period, sum the period's `usage_events` (the
 * app-side source of truth — same `api_period_segments` RPC as GET /v1/usage)
 * and send each crossed-threshold alert through the ledger.
 */
export async function runUsageAlertsJob(
  env: Env,
  /** #449: the cron already passes the scheduled time to every job; this arm
   *  is the first here to need it (the trailing-inbound baseline window). */
  now: Date = new Date(),
): Promise<void> {
  const db = getDb(env);
  const { data, error } = await db
    .from("companies")
    .select("id,name,plan,current_period_start,overage_cap_multiplier")
    .eq("subscription_status", "active")
    .not("plan", "is", null)
    .not("current_period_start", "is", null)
    .is("deleted_at", null)
    // Bounded per-run: each company issues ~4 usage RPCs, so an unbounded active
    // scan would risk the Workers subrequest ceiling / the PostgREST 1000-row
    // silent truncation (tenants past the cap would miss their overage warnings
    // and hit surprise bills) as the base grows.
    .order("id", { ascending: true })
    .limit(USAGE_ALERTS_BATCH);
  if (error) {
    throw new Error(`active companies lookup failed: ${error.message}`);
  }
  if ((data ?? []).length >= USAGE_ALERTS_BATCH) {
    Sentry.captureMessage(
      `usage-alerts scan hit its per-run cap of ${USAGE_ALERTS_BATCH}; tenants past the cap miss overage warnings this run — add checkpoint-resume before the active base outgrows one invocation`,
      "warning",
    );
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
      const totalStoredBytes = storedBytes(storage as StorageUsageRow);
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

      // #12/D36 voice arm: measured against the fair-use ALLOWANCE (like the
      // segments arm), in billed-leg seconds — the same measure the Stripe
      // meter bills and the spending-cap gate reads. Threshold math is on
      // SECONDS to avoid a rounding edge; the copy shows whole minutes.
      // #133: a grandfathered module measures against ITS pause line (the
      // legacy allowance) — before this, a grandfathered tenant hit the
      // pause at 12% of the alert threshold and calls stopped with zero
      // warning, violating the alert-before-the-cap mandate.
      const { data: voiceSeconds, error: voiceError } = await db.rpc(
        "api_period_forward_seconds",
        { p_company_id: company.id, p_since: company.current_period_start },
      );
      if (voiceError) {
        throw new Error(`voice usage failed: ${voiceError.message}`);
      }
      // #134/D42: calling is included on every plan — plan allowances for
      // everyone (the grandfathered arm retired with the module).
      const includedVoiceMinutes = PLAN_VOICE_MINUTES[company.plan];
      const usedVoiceSeconds = Number(voiceSeconds);
      const includedVoiceSeconds = includedVoiceMinutes * 60;
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
              includedVoiceMinutes,
              Math.floor(usedVoiceSeconds / 60),
              env,
            ),
          );
        }
      }

      // #448 dial arm. The voice arm above measures SECONDS, which is exactly
      // what a run of very short calls does not accrue — each dial costs ~10c
      // whatever happens next, so a dialer stuck in a loop reports as
      // comfortably inside its minute allowance while spending real money.
      //
      // Ops only, and no customer copy: the per-dial fee is OUR cost
      // (UNIT_COST_CENTS.voiceTransfer), never billed to the customer, so
      // there is nothing for them to act on and telling them would read as a
      // charge they cannot find. #447 is the general form of this — the person
      // who eats the cost is the one who has to be told.
      const { data: dialCount, error: dialError } = await db.rpc(
        "api_period_forwarded_calls",
        { p_company_id: company.id, p_since: company.current_period_start },
      );
      if (dialError) {
        throw new Error(`dial count failed: ${dialError.message}`);
      }
      const dials = Number(dialCount);
      const lines = dialCeilings(company.plan, company.overage_cap_multiplier);
      if (dials >= lines.alertAt) {
        const spentCents = dials * UNIT_COST_CENTS.voiceTransfer;
        await recordAndSendAlert(
          env,
          company,
          "voice_dials",
          // One row per (company, period): the ledger PK treats the threshold
          // purely as a dedupe key, and there is only one line to cross.
          lines.alertAt,
          {
            subject: `${company.name}: unusual call volume`,
            text:
              `${company.name} has placed ${dials} calls this period.\n\n` +
              `Calling still works. This is a heads-up, not a limit — you can ` +
              `keep calling as normal.\n\nIf that number looks wrong, something ` +
              `may be dialling on its own. Get in touch and we'll look at it ` +
              `with you.`,
          },
          {
            subject: `[ops] ${company.name}: ${dials} dials this period ($${(spentCents / 100).toFixed(2)} in per-dial fees)`,
            text:
              `Company: ${company.name} (${company.id})\n` +
              `Plan: ${company.plan}\n` +
              `Dials this period: ${dials}\n` +
              `Per-dial cost so far: $${(spentCents / 100).toFixed(2)} ` +
              `(${UNIT_COST_CENTS.voiceTransfer}c each)\n` +
              `Alert line: ${lines.alertAt} dials\n` +
              `Calling pauses at: ${lines.stopAt} dials\n\n` +
              `The voice spending cap counts SECONDS and cannot bound this ` +
              `(#448). Short calls accrue ~0 seconds and 10c each, so this ` +
              `tenant can look well inside its minute allowance while this ` +
              `runs. Worth checking for a dialer in a retry loop before it ` +
              `reaches the pause.`,
          },
        );
      }

      // #449 inbound arm — the one cost centre that has no ceiling and cannot
      // be given one.
      //
      // Inbound is free to the customer and costs us 0.7c a segment. It is not
      // cappable in principle: refusing to receive a customer's texts is
      // refusing the product, and in practice the segment is already received
      // and billed by Telnyx before this Worker runs, so no gate of ours could
      // decline it. Only suspending the number stops it, which is a human's
      // abuse call.
      //
      // It is therefore deliberately NOT enforcement. It is the storage-abuse
      // shape: absolute tiers, both audiences told, nothing blocked — so the
      // one unbounded cost in the product stops being invisible.
      //
      // Its own metric, never the notification budget's. That budget is about
      // ATTENTION and merely correlates: a flood into one already-active
      // conversation claims almost no notifications while spending real money,
      // which is exactly the case that would otherwise pass unseen.
      const { data: inboundSum, error: inboundError } = await db.rpc(
        "api_period_inbound_segments",
        { p_company_id: company.id, p_since: company.current_period_start },
      );
      if (inboundError) {
        throw new Error(`inbound segment sum failed: ${inboundError.message}`);
      }
      const inbound = Number(inboundSum);
      for (const tier of INBOUND_ABUSE_TIERS_SEGMENTS) {
        if (inbound < tier) continue;
        const costCents = inbound * UNIT_COST_CENTS.inboundSegment;
        // #449 ask 2: a freeze or a heat wave produces a genuinely huge inbound
        // month (#401), and an alert that cannot tell that from an attack
        // teaches the reader to ignore it. The TRIGGER stays absolute — $70 is
        // $70 whatever caused it — but the ops copy carries the tenant's own
        // trailing 30 days, which is what says "ten times normal" or "a busy
        // week" at a glance. Best-effort: a failed baseline must not sink the
        // alert that matters.
        const baseline = await trailingInboundBaseline(db, company.id, now);
        await recordAndSendAlert(
          env,
          company,
          "inbound_volume",
          tier,
          {
            subject: `A note about the texts coming in to ${company.name}`,
            text:
              `Hi,\n\nNothing is blocked and nothing is charged for this — ` +
              `incoming texts are free on every plan, and they always will ` +
              `be. This is just a heads-up that ${company.name} has received ` +
              `about ${inbound.toLocaleString()} incoming messages this ` +
              `billing period, which is well above what a typical crew sees.` +
              `\n\nIf that is simply a busy season, ignore this and carry ` +
              `on. If it looks surprising, it can be a sign that a number is ` +
              `sending you the same thing over and over, and we can help you ` +
              `look.\n\nLoonext`,
          },
          {
            subject: `[ops] ${company.name}: ${inbound.toLocaleString()} inbound segments ($${(costCents / 100).toFixed(2)})`,
            text:
              `Company: ${company.name} (${company.id})\n` +
              `Plan: ${company.plan}\n` +
              `Inbound this period: ${inbound.toLocaleString()} segments\n` +
              `Our cost: $${(costCents / 100).toFixed(2)} ` +
              `(${UNIT_COST_CENTS.inboundSegment}c each, free to the customer)\n` +
              `Tier crossed: ${tier.toLocaleString()}\n` +
              `Trailing 30 days before this: ${baseline === null ? "unavailable" : baseline.toLocaleString()} segments\n\n` +
              `Inbound cannot be capped — the segment is billed by Telnyx ` +
              `before our webhook runs, so only suspending the number stops ` +
              `it (#449, DECISIONS D50). This is a visibility alert, not a ` +
              `gate; nothing was blocked.\n\n` +
              `Compare against the trailing figure before acting: a storm is ` +
              `many senders, abuse is usually one.`,
          },
        );
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
