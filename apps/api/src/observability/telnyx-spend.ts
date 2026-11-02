import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import type { Env } from "../env";
import { productionWatchRefusal } from "../environments/policy";
import { productionVoiceProfileIds, readVoiceProfile } from "../telnyx/spend-limit-reads";
import {
  enforcedSpendLimit,
  spendLimitDrift,
  SPEND_ALERT_FRACTION,
  TELNYX_DAILY_SPEND_LIMIT_USD,
} from "../telnyx/spend-limits";
import { opsAlert } from "./ops-alert";
import {
  listMessagingProfiles,
  MAX_PROFILE_PAGES,
  PAGE_SIZE,
  productionProfileIds,
} from "./telnyx-wiring";

/**
 * #642: Telnyx's own daily spend limits on production's profiles, and what is
 * spent against them. Telnyx emails the account owner only after a limit is
 * reached, when new calls and texts are already refused, so the pre-cap alert
 * here is the one that can still act.
 */

const HOUR_MS = 60 * 60 * 1000;

/**
 * A pre-cap condition that persists is re-announced on these UTC hours only.
 * Without it one expensive afternoon would send the same alert every hour
 * until midnight, when Telnyx's day rolls over.
 */
export const SPEND_REMIND_EVERY_HOURS = 6;

export const SPEND_PRECAP_VOICE_KEY = "telnyx-spend-precap-voice";
export const SPEND_PRECAP_MESSAGING_KEY = "telnyx-spend-precap-messaging";
export const SPEND_LIMIT_DRIFT_KEY = "telnyx-spend-limit-drift";
export const MESSAGING_SPEND_CAP_KEY = "telnyx-messaging-spend-cap";

const usd = (amount: number) => `USD ${amount.toFixed(2)}`;

function utcDayStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

// ---------------------------------------------------------------------------
// Spend, from the ledgers the cost model already fills (#216)
// ---------------------------------------------------------------------------

export interface DaySpend {
  voice: number;
  /** Company id to dollars, for companies that spent anything. */
  messaging: Map<string, number>;
}

interface SpendRow {
  kind: string;
  company_id: string | null;
  spend_usd: number | string | null;
}

export async function readDaySpend(
  db: SupabaseClient,
  since: Date,
  until: Date,
): Promise<DaySpend> {
  const spend: DaySpend = { voice: 0, messaging: new Map() };
  if (until.getTime() <= since.getTime()) return spend;
  const { data, error } = await db.rpc("api_telnyx_spend_since", {
    p_since: since.toISOString(),
    p_until: until.toISOString(),
  });
  if (error) throw new Error(`telnyx spend read failed: ${error.message}`);
  for (const row of (data ?? []) as SpendRow[]) {
    const amount = Number(row.spend_usd ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (row.kind === "voice") spend.voice += amount;
    else if (row.kind === "message" && row.company_id) {
      spend.messaging.set(row.company_id, (spend.messaging.get(row.company_id) ?? 0) + amount);
    }
  }
  return spend;
}

// ---------------------------------------------------------------------------
// The warning before the cap
// ---------------------------------------------------------------------------

export interface SpendFinding {
  scope: "voice" | "messaging";
  /** Messaging only. */
  companyId?: string;
  spent: number;
  limit: number;
  /** The limit is the floor because the live one could not be read or is not enforced. */
  assumed: boolean;
  /** An hour ago, the same scope was under the alert share. */
  fresh: boolean;
}

export interface SpendReport {
  since: string;
  voiceSpent: number;
  findings: SpendFinding[];
  alerted: string[];
}

const share = (finding: SpendFinding) => finding.spent / finding.limit;

async function voiceLimit(env: Env): Promise<{ limit: number; assumed: boolean }> {
  try {
    const limits: number[] = [];
    for (const id of await productionVoiceProfileIds(env)) {
      const enforced = enforcedSpendLimit((await readVoiceProfile(env, id)).limit ?? {});
      if (enforced !== null) limits.push(enforced);
    }
    if (limits.length > 0) return { limit: Math.min(...limits), assumed: false };
  } catch (cause) {
    console.error(
      "telnyx spend watch: voice limit read failed:",
      cause instanceof Error ? cause.message : String(cause),
    );
  }
  return { limit: TELNYX_DAILY_SPEND_LIMIT_USD, assumed: true };
}

/** Every messaging profile's live limit, or an empty map when Telnyx cannot be read. */
async function messagingLimits(env: Env): Promise<Map<string, number>> {
  const limits = new Map<string, number>();
  try {
    const { profiles } = await listMessagingProfiles(env);
    for (const [id, profile] of profiles) {
      const enforced = enforcedSpendLimit(profile);
      if (enforced !== null) limits.set(id, enforced);
    }
  } catch (cause) {
    console.error(
      "telnyx spend watch: messaging limit read failed:",
      cause instanceof Error ? cause.message : String(cause),
    );
  }
  return limits;
}

async function messagingProfilesOf(
  db: SupabaseClient,
  companyIds: string[],
): Promise<Map<string, string>> {
  const profiles = new Map<string, string>();
  if (companyIds.length === 0) return profiles;
  const { data, error } = await db
    .from("companies")
    .select("id,telnyx_messaging_profile_id")
    .in("id", companyIds);
  if (error) throw new Error(`messaging profile read failed: ${error.message}`);
  for (const row of (data ?? []) as { id: string; telnyx_messaging_profile_id: string | null }[]) {
    if (row.telnyx_messaging_profile_id) profiles.set(row.id, row.telnyx_messaging_profile_id);
  }
  return profiles;
}

/**
 * Alert when a day's spend crosses about 70% of a Telnyx limit.
 *
 * The live limit is read from Telnyx only when the day's spend is already near
 * the least a limit may be (the floor), so a quiet hour makes no Telnyx
 * request. Spend is the cost ledger's, which trails a message by its delivery
 * report and covers only legs that resolve to a company, so it can run behind
 * Telnyx's own meter. That is why the share is 70% and not 95%.
 *
 * Null when this is not production, before anything is read.
 */
export async function runTelnyxSpendWatch(
  env: Env,
  now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<SpendReport | null> {
  const refusal = productionWatchRefusal(env);
  if (refusal !== null) {
    console.log(`telnyx spend watch skipped: ${refusal}`);
    return null;
  }

  const dayStart = utcDayStart(now);
  const spend = await readDaySpend(db, dayStart, now);
  const near = TELNYX_DAILY_SPEND_LIMIT_USD * SPEND_ALERT_FRACTION;
  const report: SpendReport = {
    since: dayStart.toISOString(),
    voiceSpent: spend.voice,
    findings: [],
    alerted: [],
  };

  const nearMessaging = [...spend.messaging].filter(([, amount]) => amount >= near);
  if (spend.voice < near && nearMessaging.length === 0) return report;

  const hourAgo = new Date(now.getTime() - HOUR_MS);
  const before = await readDaySpend(db, dayStart, hourAgo);

  if (spend.voice >= near) {
    const { limit, assumed } = await voiceLimit(env);
    if (spend.voice / limit >= SPEND_ALERT_FRACTION) {
      report.findings.push({
        scope: "voice",
        spent: spend.voice,
        limit,
        assumed,
        fresh: before.voice / limit < SPEND_ALERT_FRACTION,
      });
    }
  }

  if (nearMessaging.length > 0) {
    const profiles = await messagingProfilesOf(db, nearMessaging.map(([id]) => id));
    const live = await messagingLimits(env);
    for (const [companyId, spent] of nearMessaging.sort(([a], [b]) => a.localeCompare(b))) {
      const profileLimit = live.get(profiles.get(companyId) ?? "");
      const limit = profileLimit ?? TELNYX_DAILY_SPEND_LIMIT_USD;
      const assumed = profileLimit === undefined;
      if (spent / limit < SPEND_ALERT_FRACTION) continue;
      report.findings.push({
        scope: "messaging",
        companyId,
        spent,
        limit,
        assumed,
        fresh: (before.messaging.get(companyId) ?? 0) / limit < SPEND_ALERT_FRACTION,
      });
    }
  }

  const reminder = now.getUTCHours() % SPEND_REMIND_EVERY_HOURS === 0;
  for (const scope of ["voice", "messaging"] as const) {
    const findings = report.findings.filter((finding) => finding.scope === scope);
    if (findings.length === 0) continue;
    if (!findings.some((finding) => finding.fresh) && !reminder) continue;
    await alertPreCap(env, scope, findings);
    report.alerted.push(scope);
  }

  console.log(
    `telnyx spend: voice ${usd(spend.voice)}, ${spend.messaging.size} messaging profile(s) with spend, ` +
      `${report.findings.length} at or above ${Math.round(SPEND_ALERT_FRACTION * 100)}% of a limit`,
  );
  return report;
}

function findingLine(finding: SpendFinding): string {
  const who = finding.scope === "messaging" ? `company ${finding.companyId}` : "outbound voice profile";
  return (
    `${who}: ${usd(finding.spent)} of ${usd(finding.limit)} today ` +
    `(${Math.round(share(finding) * 100)}%)` +
    (finding.assumed ? `, limit assumed at the floor because Telnyx reported none` : "")
  );
}

async function alertPreCap(
  env: Env,
  scope: "voice" | "messaging",
  findings: SpendFinding[],
): Promise<void> {
  const atCap = findings.some((finding) => share(finding) >= 1);
  const what = scope === "voice" ? "voice" : "messaging";
  await opsAlert(env, {
    key: scope === "voice" ? SPEND_PRECAP_VOICE_KEY : SPEND_PRECAP_MESSAGING_KEY,
    level: atCap ? "error" : "warning",
    summary: atCap
      ? `Telnyx ${what} spend has reached its daily limit`
      : `Telnyx ${what} spend is past ${Math.round(SPEND_ALERT_FRACTION * 100)}% of its daily limit`,
    detail:
      findings.map(findingLine).join("\n") +
      "\n\nTelnyx's day ends at 00:00 UTC. Spend is the cost ledger's, which can trail " +
      "Telnyx's own meter.",
    action:
      scope === "voice"
        ? "Find out whether the spend is real traffic or a loop: Voice > Call Logs in " +
          "portal.telnyx.com, filtered to today, by destination. Real traffic needs the " +
          "outbound voice profile's daily limit raised (record it in docs/deploy/04-telnyx.md " +
          "section 8); a loop needs stopping before the cap refuses every customer's calls."
        : "Find out whether the sends are real: the company id above is a workspace, and its " +
          "messages for today show the volume. Real traffic needs that messaging profile's " +
          "daily limit raised (record it in docs/deploy/04-telnyx.md section 8); a loop needs " +
          "stopping before Telnyx answers 429 / 40333 to that workspace's sends.",
  });
}

// ---------------------------------------------------------------------------
// The cap being hit
// ---------------------------------------------------------------------------

/**
 * A text was refused because its messaging profile reached the daily limit:
 * Telnyx answers HTTP 429 with code 40333, and fires
 * `messaging-profile.spend-limit-reached`. Both land here under one key, so a
 * workspace stopped by its cap is one grouped issue and not a run of generic
 * send failures.
 *
 * The customer-facing failure is left as it is: the text was not sent, and the
 * app says so without naming a vendor limit the customer cannot act on.
 */
export async function alertMessagingSpendCap(
  env: Env,
  hit: { source: "send" | "webhook"; companyId?: string; profileId?: string; detail?: string },
  now: number = Date.now(),
): Promise<boolean> {
  // A capped profile refuses every send until midnight, so one runaway loop
  // arrives here once per attempt. Sentry groups them by key, but each call
  // would also email ops. One alert per profile per half hour, per isolate:
  // best effort by design, since the key and the grouping already hold the
  // whole story.
  const identity = hit.companyId ?? hit.profileId ?? "unknown";
  const last = capAlertedAt.get(identity);
  if (last !== undefined && now - last < CAP_ALERT_EVERY_MS) return false;
  capAlertedAt.set(identity, now);

  const who = hit.companyId
    ? `company ${hit.companyId}`
    : hit.profileId
      ? `messaging profile ${hit.profileId}`
      : "a messaging profile";
  await opsAlert(env, {
    key: MESSAGING_SPEND_CAP_KEY,
    level: "error",
    summary: "Telnyx stopped texts because a messaging profile reached its daily spend limit",
    detail:
      `${who} reached its daily spend limit, seen on a ${hit.source === "send" ? "send (HTTP 429, code 40333)" : "`messaging-profile.spend-limit-reached` webhook"}.` +
      (hit.detail ? `\n${hit.detail.slice(0, 500)}` : "") +
      "\nSends on that profile fail until 00:00 UTC.",
    action:
      "Decide whether the volume is real. If it is a loop, stop it first. If it is real, " +
      "raise that profile's daily limit (docs/deploy/04-telnyx.md section 8 has the call) " +
      "and have the failed messages retried from the thread.",
  });
  return true;
}

const CAP_ALERT_EVERY_MS = 30 * 60 * 1000;
const capAlertedAt = new Map<string, number>();

/** For tests: forget which profiles were alerted. */
export function resetSpendCapThrottle(): void {
  capAlertedAt.clear();
}

/**
 * `messaging-profile.spend-limit-reached`: Telnyx's own notice that a
 * profile's limit was hit. The payload shape is not documented beyond the
 * event name, so the profile id is read from the fields it plausibly carries
 * and the company is looked up from it. A payload with neither still alerts.
 */
export async function handleSpendLimitReachedEvent(
  env: Env,
  payload: unknown,
  db: SupabaseClient = getDb(env),
): Promise<void> {
  const record = (payload ?? {}) as Record<string, unknown>;
  const candidate = record.messaging_profile_id ?? record.profile_id ?? record.id;
  const profileId = typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;

  let companyId: string | undefined;
  if (profileId !== undefined) {
    const { data, error } = await db
      .from("companies")
      .select("id")
      .eq("telnyx_messaging_profile_id", profileId)
      .limit(1);
    if (error) {
      console.error(`spend limit webhook company lookup failed: ${error.message}`);
    } else {
      companyId = (data?.[0] as { id: string } | undefined)?.id;
    }
  }
  await alertMessagingSpendCap(env, { source: "webhook", companyId, profileId });
}

// ---------------------------------------------------------------------------
// Drift
// ---------------------------------------------------------------------------

export interface LimitDrift {
  resource: "outbound_voice_profile" | "messaging_profile";
  id: string;
  problem: string;
}

export interface DriftReport {
  checked: { resource: LimitDrift["resource"]; id: string }[];
  drifted: LimitDrift[];
  unchecked: string[];
}

/**
 * Once a week: is every production profile still carrying a daily spend limit
 * at least as high as the floor? A portal edit or a reset that clears one
 * removes the cap with no error anywhere. A limit raised above the floor is
 * not drift: an operator may have good reason.
 *
 * READ ONLY. Null when this is not production, before any request.
 */
export async function runTelnyxSpendLimitDriftWatch(
  env: Env,
  _now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<DriftReport | null> {
  const refusal = productionWatchRefusal(env);
  if (refusal !== null) {
    console.log(`telnyx spend limit watch skipped: ${refusal}`);
    return null;
  }

  const report: DriftReport = { checked: [], drifted: [], unchecked: [] };

  const voiceIds = await productionVoiceProfileIds(env);
  if (voiceIds.length === 0) {
    report.drifted.push({
      resource: "outbound_voice_profile",
      id: "(none)",
      problem: "neither production connection has an outbound voice profile",
    });
  }
  for (const id of voiceIds) {
    report.checked.push({ resource: "outbound_voice_profile", id });
    const { limit } = await readVoiceProfile(env, id);
    const problem = limit === null ? "Telnyx no longer has the profile" : spendLimitDrift(limit);
    if (problem !== null) report.drifted.push({ resource: "outbound_voice_profile", id, problem });
  }

  const ids = await productionProfileIds(db);
  if (ids.length > 0) {
    const { profiles, truncated } = await listMessagingProfiles(env);
    for (const id of ids) {
      const profile = profiles.get(id);
      if (profile === undefined) {
        if (truncated) {
          report.unchecked.push(
            `messaging profile ${id}: beyond the ${MAX_PROFILE_PAGES * PAGE_SIZE} profiles read`,
          );
        } else {
          report.checked.push({ resource: "messaging_profile", id });
          report.drifted.push({
            resource: "messaging_profile",
            id,
            problem: "Telnyx no longer lists the profile",
          });
        }
        continue;
      }
      report.checked.push({ resource: "messaging_profile", id });
      const problem = spendLimitDrift(profile);
      if (problem !== null) report.drifted.push({ resource: "messaging_profile", id, problem });
    }
  }

  console.log(
    `telnyx spend limits: checked ${report.checked.length} profile(s), ` +
      `${report.drifted.length} drifted` +
      (report.unchecked.length > 0 ? `; unchecked: ${report.unchecked.join("; ")}` : ""),
  );

  if (report.drifted.length > 0) {
    await opsAlert(env, {
      key: SPEND_LIMIT_DRIFT_KEY,
      level: "error",
      summary: `A Telnyx daily spend limit was removed or lowered on ${report.drifted.length} production profile(s)`,
      detail:
        report.drifted.map((d) => `${d.resource} ${d.id}: ${d.problem}`).join("\n") +
        (report.unchecked.length > 0 ? `\nNot checked: ${report.unchecked.join("; ")}` : ""),
      action:
        `Set the profile's daily spend limit back to at least ${usd(TELNYX_DAILY_SPEND_LIMIT_USD)} ` +
        "and enable it. docs/deploy/04-telnyx.md section 8 has the PATCH for each profile type. " +
        "Until then only the app's own caps stand between a bug and the balance.",
    });
  }
  return report;
}
