import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import type { Env } from "../env";
import { productionWatchRefusal } from "../environments/policy";
import {
  listMessagingProfiles,
  productionVoiceProfileIds,
  readVoiceProfile,
} from "../telnyx/spend-limit-reads";
import {
  enforcedSpendLimit,
  MESSAGING_SPEND_LIMIT_CODE,
  TELNYX_DAILY_SPEND_LIMIT_USD,
} from "../telnyx/spend-limits";
import { captureEvent, opsNotice, SYSTEM_DISTINCT_ID } from "./capture";

/**
 * #642: Telnyx's own daily spend limits on production's profiles, and what is
 * spent against them, sent to PostHog as gauges (D146). The "Limits and rates"
 * alert there fires at 70% of a limit, and when a limit is gone or below the
 * floor; Telnyx emails the account owner once a limit is reached.
 */

export const MESSAGING_SPEND_CAP_KEY = "telnyx-messaging-spend-cap";

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
// The gauges
// ---------------------------------------------------------------------------

export interface SpendGauge {
  key: "telnyx-spend-voice" | "telnyx-spend-messaging";
  /** Today's spend in USD, from the cost ledger, which trails Telnyx's own meter. */
  value: number;
  /** The enforced daily limit, or null when none is. */
  limit: number | null;
  unit: "usd";
  /** The least a production limit may be, so the alert can tell a lowered one. */
  floor: number;
}

const roundUsd = (amount: number) => Math.round(amount * 100) / 100;

/** The tightest enforced limit across production's outbound voice profiles. */
async function voiceLimit(env: Env): Promise<number | null> {
  const limits: number[] = [];
  for (const id of await productionVoiceProfileIds(env)) {
    const reading = await readVoiceProfile(env, id);
    const enforced = reading.limit === null ? null : enforcedSpendLimit(reading.limit);
    if (enforced === null) return null;
    limits.push(enforced);
  }
  return limits.length > 0 ? Math.min(...limits) : null;
}

/**
 * The messaging profile closest to trouble: one with no enforced limit or a
 * limit below the floor first, otherwise the one with the largest share of its
 * limit spent today. One gauge rather than one per profile keeps the volume
 * flat as workspaces are added.
 */
async function messagingGauge(
  env: Env,
  db: SupabaseClient,
  spend: Map<string, number>,
): Promise<Pick<SpendGauge, "value" | "limit"> | null> {
  const { data, error } = await db
    .from("companies")
    .select("id,telnyx_messaging_profile_id")
    .not("telnyx_messaging_profile_id", "is", null);
  if (error) throw new Error(`messaging profile read failed: ${error.message}`);
  const companies = (data ?? []) as { id: string; telnyx_messaging_profile_id: string }[];
  if (companies.length === 0) return null;

  const profiles = await listMessagingProfiles(env);
  let worst: { value: number; limit: number | null; rank: number } | null = null;
  for (const company of companies) {
    const profile = profiles.get(company.telnyx_messaging_profile_id);
    const limit = profile === undefined ? null : enforcedSpendLimit(profile);
    const value = spend.get(company.id) ?? 0;
    const rank =
      limit === null || limit < TELNYX_DAILY_SPEND_LIMIT_USD ? Number.POSITIVE_INFINITY : value / limit;
    if (worst === null || rank > worst.rank) worst = { value, limit, rank };
  }
  return worst === null ? null : { value: worst.value, limit: worst.limit };
}

/**
 * Hourly. Production only: the limits and the spend are production's, so
 * anywhere else this returns null before any read.
 */
export async function runTelnyxSpendGauges(
  env: Env,
  now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<SpendGauge[] | null> {
  const refusal = productionWatchRefusal(env);
  if (refusal !== null) {
    console.log(`telnyx spend gauges skipped: ${refusal}`);
    return null;
  }

  const spend = await readDaySpend(db, utcDayStart(now), now);
  const gauges: SpendGauge[] = [
    {
      key: "telnyx-spend-voice",
      value: roundUsd(spend.voice),
      limit: await voiceLimit(env),
      unit: "usd",
      floor: TELNYX_DAILY_SPEND_LIMIT_USD,
    },
  ];
  const messaging = await messagingGauge(env, db, spend.messaging);
  if (messaging !== null) {
    gauges.push({
      key: "telnyx-spend-messaging",
      value: roundUsd(messaging.value),
      limit: messaging.limit,
      unit: "usd",
      floor: TELNYX_DAILY_SPEND_LIMIT_USD,
    });
  }

  await Promise.all(
    gauges.map((gauge) =>
      captureEvent(env, "ops_gauge", SYSTEM_DISTINCT_ID, { ...gauge }),
    ),
  );
  return gauges;
}

// ---------------------------------------------------------------------------
// The cap being hit
// ---------------------------------------------------------------------------

/**
 * A text was refused because its workspace's messaging profile reached the
 * daily limit: Telnyx answers HTTP 429 with code 40333 until 00:00 UTC. The
 * first refusal of the UTC day is the one that reports it; the failed message
 * rows are what says whether there was one before.
 *
 * The customer-facing failure is left as it is: the text was not sent, and the
 * app says so without naming a vendor limit the customer cannot act on.
 */
export async function noticeMessagingSpendCap(
  env: Env,
  db: SupabaseClient,
  hit: { companyId: string; messageId: string },
  now: Date = new Date(),
): Promise<boolean> {
  const { data, error } = await db
    .from("messages")
    .select("id")
    .eq("company_id", hit.companyId)
    .eq("error_code", MESSAGING_SPEND_LIMIT_CODE)
    .gte("updated_at", utcDayStart(now).toISOString())
    .order("updated_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1);
  if (error) {
    console.error(`spend cap lookup failed: ${error.message}`);
  } else {
    // Each refused send has already saved its own row, so "any other row" would
    // let two simultaneous first refusals each see the other and both stay
    // quiet. Only the earliest row's send speaks.
    const first = (data ?? [])[0] as { id: string } | undefined;
    if (first !== undefined && first.id !== hit.messageId) return false;
  }

  await opsNotice(env, {
    key: MESSAGING_SPEND_CAP_KEY,
    level: "error",
    summary: "Telnyx stopped texts because a messaging profile reached its daily spend limit",
    detail:
      `company ${hit.companyId} reached its daily spend limit (HTTP 429, code 40333). ` +
      "Sends on that profile fail until 00:00 UTC.",
    action:
      "Decide whether the volume is real. If it is a loop, stop it first. If it is real, " +
      "raise that profile's daily limit (docs/deploy/04-telnyx.md section 8 has the call) " +
      "and have the failed messages retried from the thread.",
  });
  return true;
}
