import type { Locale } from "@loonext/shared";

import { storedBytes } from './stored-bytes';
import type { StorageUsageRow } from './stored-bytes';

import { pushConsequentialNotice } from "./consequential-push";
import { sendBillingEmailGroups, sendLedgered, usageAlertLedger } from "./send-ledgered";
import { billingRecipientsByLocale } from "./recipients";
import { UNIT_COST_CENTS } from "./costs";
import { EGRESS_ALLOWANCE_BYTES } from "../attachments/egress";
import { dialCeilings, INBOUND_ABUSE_TIERS_SEGMENTS, PLAN_INCLUDED_SEGMENTS, PLAN_VOICE_MINUTES, STORAGE_ABUSE_TIERS_GB, voiceSpendingCapSeconds } from './plans';
import type { PlanId } from './plans';
import { getDb } from "../db";
import type { Env } from "../env";
import { captureEvent, captureException } from "../observability/capture";

export type UsageAlertThreshold = 80 | 100;
export const USAGE_ALERT_PERCENTS: readonly UsageAlertThreshold[] = [80, 100];
const SPENDING_CAP_PERCENTS = [90, 100] as const;
const SPENDING_CAP_PATH = "/settings/usage#spending-cap";

type SpendingCapMetric = "segments_cap" | "voice_cap";
type SpendingCapThreshold = (typeof SPENDING_CAP_PERCENTS)[number];

/**
 * The budget a threshold is measured against. `segments` is the per-period
 * outbound quota; the two `*_storage` metrics are the #12 point-in-time storage
 * budgets (their own separate pools). The `metric` column keeps them from
 * colliding at the same (company, period, threshold).
 */
export type UsageAlertMetric =
  | "segments"
  | SpendingCapMetric
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
  // bound. One ledger row per (company, period).
  | "voice_dials"
  // #449: inbound segments — free to the customer, 1.0c to us (#445), and the one
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
  locale?: string | null;
}

/**
 * #449: the tenant's inbound over the 30 days BEFORE the last 30, so whoever
 * reads the event can tell a flood from a busy season without opening a
 * console.
 *
 * Derived by subtraction because `api_period_inbound_segments` counts from a
 * point forward rather than over a range: everything since 60 days ago, minus
 * everything since 30 days ago. Deliberately a rolling window rather than the
 * previous billing period — periods vary in length and a tenant mid-migration
 * may not have a clean previous one, and the comparison only has to be
 * indicative.
 *
 * Returns null rather than throwing: this is context on a warning, and losing
 * the context must never lose the warning.
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
function formatGb(bytes: number, locale: Locale): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (locale === "fr-CA") return `${gb.toLocaleString(locale, { maximumFractionDigits: 1 })} Go`;
  return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
}

function segmentAlertCopy(
  company: ActiveCompanyRow,
  threshold: UsageAlertThreshold,
  included: number,
  used: number,
  env: Env,
  locale: Locale,
): { subject: string; text: string } {
  const usageUrl = `${env.APP_ORIGIN}/settings/usage`;
  if (locale === "fr-CA") {
    const usage = `${company.name} a utilisé ${used} des ${included} segments de texto sortants inclus dans votre forfait pour cette période de facturation.`;
    return threshold === 100
      ? {
        subject: `${company.name} a utilisé tous ses textos inclus`,
        text: `Bonjour,\n\n${usage} Vous pouvez continuer à envoyer des textos. Les segments supplémentaires seront facturés sur votre prochaine facture, jusqu’à votre plafond de dépenses.\n\nConsulter votre utilisation et gérer votre plafond : ${usageUrl}\n\nLoonext`,
      }
      : {
        subject: `${company.name} a utilisé 80 % de ses textos inclus`,
        text: `Bonjour,\n\n${usage} Lorsque le quota est atteint, les segments supplémentaires sont facturés sur votre prochaine facture.\n\nConsulter votre utilisation : ${usageUrl}\n\nLoonext`,
      };
  }
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
 * their stored bytes crossed an unusual absolute tier. Tone matters: the
 * customer email must never read as a warning shot; it is "all good, here's
 * what we noticed, reply if this is just how you work."
 */
function storageAbuseCopy(
  company: ActiveCompanyRow,
  usedBytes: number,
  env: Env,
  locale: Locale,
): { subject: string; text: string } {
  const used = formatGb(usedBytes, locale);
  const usageUrl = `${env.APP_ORIGIN}/settings/usage`;
  if (locale === "fr-CA") {
    return {
      subject: `À propos du stockage de ${company.name}`,
      text: `Bonjour,\n\nLe stockage sur Loonext est gratuit et reste disponible. ${company.name} stocke maintenant environ ${used} de fichiers et de photos, ce qui dépasse l’utilisation habituelle d’une équipe. Si c’est normal pour votre entreprise, vous n’avez rien à faire. Vous trouverez vos fichiers dans vos conversations et pouvez les trier en tout temps.\n\nNotre politique d’utilisation raisonnable prévoit que le stockage serve aux conversations d’une seule entreprise avec sa clientèle. Si nous avons besoin de vous joindre, une personne de notre équipe vous écrira. Vos fichiers ne seront ni bloqués ni supprimés automatiquement.\n\nConsulter votre utilisation : ${usageUrl}\n\nLoonext`,
    };
  }
  return {
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
  locale: Locale,
): { subject: string; text: string } {
  const usageUrl = `${env.APP_ORIGIN}/settings/usage`;
  if (locale === "fr-CA") {
    return threshold === 100
      ? {
        subject: `${company.name} a utilisé toutes ses minutes d’appel incluses`,
        text: `Bonjour,\n\n${company.name} a utilisé les ${includedMinutes} minutes d’appel incluses dans son forfait pour cette période, y compris les appels transférés et sortants. Vous pouvez continuer à appeler. Les minutes supplémentaires coûtent 1 ¢ chacune, jusqu’à votre plafond de dépenses. Au plafond, les appels sont mis en pause jusqu’à la prochaine période et les personnes dont vous manquez l’appel reçoivent toujours votre texto automatique.\n\nConsulter votre utilisation et gérer votre plafond : ${usageUrl}\n\nLoonext`,
      }
      : {
        subject: `${company.name} a utilisé 80 % de ses minutes d’appel incluses`,
        text: `Bonjour,\n\n${company.name} a utilisé ${usedMinutes} des ${includedMinutes} minutes d’appel incluses pour cette période, y compris les appels transférés et sortants. Ensuite, les minutes supplémentaires coûtent 1 ¢ chacune et sont facturées sur votre prochaine facture, jusqu’à votre plafond de dépenses.\n\nConsulter votre utilisation : ${usageUrl}\n\nLoonext`,
      };
  }
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
  locale: Locale,
): { subject: string; text: string } {
  const usageUrl = `${env.APP_ORIGIN}/settings/usage`;
  const allowance = formatGb(allowanceBytes, locale);
  const used = formatGb(usedBytes, locale);
  if (locale === "fr-CA") {
    return threshold === 100
      ? {
        subject: `${company.name} a atteint sa limite de téléchargement`,
        text: `Bonjour,\n\n${company.name} a téléchargé les ${allowance} de fichiers et de photos inclus pour cette période. Les nouveaux téléchargements sont mis en pause jusqu’à la prochaine période. Vos fichiers restent stockés en toute sécurité. Si vous atteignez cette limite pendant votre utilisation habituelle, répondez à ce courriel.\n\nConsulter votre utilisation : ${usageUrl}\n\nLoonext`,
      }
      : {
        subject: `${company.name} approche de sa limite de téléchargement`,
        text: `Bonjour,\n\n${company.name} a téléchargé ${used} des ${allowance} de fichiers et de photos inclus pour cette période. À la limite, les nouveaux téléchargements sont mis en pause jusqu’à la prochaine période et vos fichiers restent stockés en toute sécurité. Si vous atteignez cette limite pendant votre utilisation habituelle, répondez à ce courriel.\n\nConsulter votre utilisation : ${usageUrl}\n\nLoonext`,
      };
  }
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
 *
 * The same landing sends one `usage_threshold_crossed` event under the
 * workspace (`overage_projected` for the cost projection), with `measured`
 * beside it, so PostHog sees each warning once (D146). The arms whose cost is
 * ours rather than the customer's (dials, inbound, the projection) say how
 * much in `measured`.
 */
export async function recordAndSendAlert(
  env: Env,
  company: Pick<ActiveCompanyRow, "id" | "current_period_start" | "locale">,
  metric: UsageAlertMetric,
  threshold: number,
  copy: (locale: Locale) => { subject: string; text: string },
  measured: Record<string, number | null> = {},
  pushCopy?: (locale: Locale) => { subject: string; text: string },
): Promise<boolean> {
  const db = getDb(env);
  return sendLedgered({
    ...usageAlertLedger(db, {
      company_id: company.id,
      period_start: company.current_period_start,
      metric,
      threshold,
    }),
    send: async () => {
      if (pushCopy) {
        await pushConsequentialNotice(env, db, {
          companyId: company.id,
          title: (locale) => pushCopy(locale).subject,
          body: (locale) => pushCopy(locale).text,
          collapseKey: `cap:${company.id}:${metric === "segments_cap" ? "text" : "call"}:${threshold}:${company.current_period_start.slice(0, 10)}`,
          path: SPENDING_CAP_PATH,
        });
      }
      const groups = await billingRecipientsByLocale(db, company.id, company.locale);
      if (groups.size === 0) {
        void captureException(env, "No billing contacts for usage alert", {
          source: "api",
          company_id: company.id,
        });
        return false;
      }

      const key = `usage:${company.current_period_start}:${metric}:${threshold}`;
      if (!await sendBillingEmailGroups(env, db, company.id, key, groups, copy, { critical: pushCopy !== undefined })) return false;
      void captureEvent(
        env,
        metric === "cost_projection" ? "overage_projected" : "usage_threshold_crossed",
        company.id,
        { metric, threshold, ...measured },
      );
      return true;
    },
  });
}

function spendingCapCopy(
  locale: Locale,
  metric: SpendingCapMetric,
  threshold: SpendingCapThreshold,
): { subject: string; text: string } {
  if (locale === "fr-CA") {
    const service = metric === "segments_cap" ? "Textos" : "Appels";
    return threshold === 100
      ? { subject: `${service} en pause`, text: "Votre plafond de dépenses est atteint. Un propriétaire peut le modifier dans les paramètres d’utilisation." }
      : { subject: `${service} près du plafond de dépenses`, text: "Vous avez atteint 90 % du plafond. Le service est mis en pause lorsque le plafond est atteint." };
  }
  const service = metric === "segments_cap" ? "Texting" : "Calling";
  return threshold === 100
    ? { subject: `${service} paused`, text: "You reached the spending cap. An owner can raise it in usage settings." }
    : { subject: `${service} is near the spending cap`, text: "You've reached 90% of the spending cap. Service pauses at the cap." };
}

function recordSpendingCapAlert(
  env: Env,
  company: Pick<ActiveCompanyRow, "id" | "current_period_start" | "locale">,
  metric: SpendingCapMetric,
  threshold: SpendingCapThreshold,
  measured: Record<string, number> = {},
): Promise<boolean> {
  return recordAndSendAlert(
    env,
    company,
    metric,
    threshold,
    (locale) => {
      const copy = spendingCapCopy(locale, metric, threshold);
      return { subject: copy.subject, text: `${copy.text}\n\n${env.APP_ORIGIN}${SPENDING_CAP_PATH}` };
    },
    measured,
    (locale) => spendingCapCopy(locale, metric, threshold),
  );
}

export async function recordSpendingCapRefusal(
  env: Env,
  companyId: string,
  metric: SpendingCapMetric,
): Promise<void> {
  try {
    const { data, error } = await getDb(env)
      .from("companies")
      .select("id,current_period_start,locale")
      .eq("id", companyId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(`spending cap company lookup failed: ${error.message}`);
    if (data?.current_period_start) {
      await recordSpendingCapAlert(env, {
        id: data.id,
        current_period_start: data.current_period_start,
        locale: data.locale,
      }, metric, 100);
    }
  } catch (error) {
    void captureException(env, error, { source: "api", company_id: companyId });
  }
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
    .select("id,name,plan,current_period_start,overage_cap_multiplier,locale")
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
    // Tenants past the cap miss their warnings this run: add checkpoint-resume
    // before the active base outgrows one invocation.
    void captureException(env, "usage-alerts scan hit its per-run cap", {
      source: "cron",
      job: "job:usage-alerts",
      level: "warning",
      extra: { cap: USAGE_ALERTS_BATCH },
    });
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

      for (const threshold of USAGE_ALERT_PERCENTS) {
        // Integer math: 80% of 500 = 400 segments, no float edge.
        if (used * 100 >= included * threshold) {
          await recordAndSendAlert(
            env,
            company,
            "segments",
            threshold,
            (locale) => segmentAlertCopy(company, threshold, included, used, env, locale),
          );
        }
      }

      const multiplier = Number(company.overage_cap_multiplier);
      const capSegments = Math.round(included * multiplier);
      for (const threshold of SPENDING_CAP_PERCENTS) {
        if (capSegments > 0 && used * 100 >= capSegments * threshold) {
          await recordSpendingCapAlert(env, company, "segments_cap", threshold, { used, cap: capSegments });
        }
      }

      // #121 storage-abuse arm (replaces the retired budget arms): storage
      // is free — nothing blocks — but total stored bytes crossing an
      // absolute tier emails the customer (friendly), once per tier per
      // period via the same ledger dedupe. Escalating tiers keep a runaway
      // tenant re-alerting as it doubles.
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
          await recordAndSendAlert(
            env,
            company,
            "storage_abuse",
            tierGb,
            (locale) => storageAbuseCopy(company, totalStoredBytes, env, locale),
            { stored_gb: Math.round((totalStoredBytes / 1024 ** 3) * 10) / 10 },
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
      for (const threshold of USAGE_ALERT_PERCENTS) {
        if (usedVoiceSeconds * 100 >= includedVoiceSeconds * threshold) {
          await recordAndSendAlert(
            env,
            company,
            "voice_minutes",
            threshold,
            (locale) => voiceAlertCopy(
              company,
              threshold,
              includedVoiceMinutes,
              Math.floor(usedVoiceSeconds / 60),
              env,
              locale,
            ),
          );
        }
      }

      const capSeconds = voiceSpendingCapSeconds(company.plan, company.overage_cap_multiplier);
      for (const threshold of SPENDING_CAP_PERCENTS) {
        if (usedVoiceSeconds * 100 >= capSeconds * threshold) {
          await recordSpendingCapAlert(env, company, "voice_cap", threshold, { used: usedVoiceSeconds, cap: capSeconds });
        }
      }

      // #448 dial arm. The voice arm above measures SECONDS, which is exactly
      // what a run of very short calls does not accrue — each dial costs ~10c
      // whatever happens next, so a dialer stuck in a loop reports as
      // comfortably inside its minute allowance while spending real money.
      //
      // The per-dial fee is OUR cost (UNIT_COST_CENTS.voiceTransfer), never
      // billed to the customer, so their copy names no charge; what it costs
      // us travels in the event. #447 is the general form of this: the
      // person who eats the cost is the one who has to be told.
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
          (locale) => locale === "fr-CA" ? {
            subject: `${company.name} : volume d’appels inhabituel`,
            text: `${company.name} a passé ${dials} appels pendant cette période. Vous pouvez continuer à appeler comme d’habitude.\n\nSi ce nombre vous surprend, il est possible qu’un appareil compose des numéros automatiquement. Écrivez-nous et nous regarderons avec vous.`,
          } : {
            subject: `${company.name}: unusual call volume`,
            text:
              `${company.name} has placed ${dials} calls this period.\n\n` +
              `Calling still works. This is a heads-up, not a limit — you can ` +
              `keep calling as normal.\n\nIf that number looks wrong, something ` +
              `may be dialling on its own. Get in touch and we'll look at it ` +
              `with you.`,
          },
          { dials, cost_cents: spentCents, stop_at: lines.stopAt },
        );
      }

      // #449 inbound arm — the one cost centre that has no ceiling and cannot
      // be given one.
      //
      // Inbound is free to the customer and costs us 1.0c a segment (#445). It is not
      // cappable in principle: refusing to receive a customer's texts is
      // refusing the product, and in practice the segment is already received
      // and billed by Telnyx before this Worker runs, so no gate of ours could
      // decline it. Only suspending the number stops it, which is a human's
      // abuse call.
      //
      // It is therefore deliberately NOT enforcement. It is the storage-abuse
      // shape: absolute tiers, the customer told, nothing blocked, so the
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
        // $70 whatever caused it, but the event carries the tenant's own
        // trailing 30 days, which is what says "ten times normal" or "a busy
        // week" at a glance. Best-effort: a failed baseline must not sink the
        // warning that matters.
        const baseline = await trailingInboundBaseline(db, company.id, now);
        await recordAndSendAlert(
          env,
          company,
          "inbound_volume",
          tier,
          (locale) => locale === "fr-CA" ? {
            subject: `À propos des textos que reçoit ${company.name}`,
            text: `Bonjour,\n\n${company.name} a reçu environ ${inbound.toLocaleString(locale)} textos pendant cette période de facturation. C’est beaucoup plus que ce que reçoit une équipe en moyenne. Les textos entrants restent gratuits et disponibles.\n\nSi c’est une période occupée, vous n’avez rien à faire. Si ce volume vous surprend, un numéro vous envoie peut-être le même message à répétition. Nous pouvons vous aider à vérifier.\n\nLoonext`,
          } : {
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
          { inbound_segments: inbound, cost_cents: costCents, trailing_30_days: baseline },
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
      for (const threshold of USAGE_ALERT_PERCENTS) {
        if (usedEgress * 100 >= egressAllowance * threshold) {
          await recordAndSendAlert(
            env,
            company,
            "egress",
            threshold,
            (locale) => egressAlertCopy(company, threshold, egressAllowance, usedEgress, env, locale),
          );
        }
      }
    } catch (error_) {
      // One broken tenant must not starve the rest; rethrown below so the
      // cron run still reports failure.
      failures.push(error_);
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `usage-alert job failed for ${failures.length} compan${failures.length === 1 ? "y" : "ies"}`,
    );
  }
}
