import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import type { Env } from "../env";
import { opsAlert } from "./ops-alert";

/**
 * D142 P01: do customers' phones ring?
 *
 * `api_ring_success` (20261031110000) counts the share of ring pushes that
 * became a shown ring within 15 seconds, per platform and app version, over
 * the last 24 hours, against the platform's prior week. The verdict rule lives
 * there rather than here, so every reader gets one answer. Below 30 attempts a
 * row is "insufficient_sample", never a pass; with one production number that
 * is what most rows will say for a long while.
 *
 * Only counts leave the database: platforms, versions, attempts and rates.
 */

export const RING_SUCCESS_VERDICTS = [
  "insufficient_sample",
  "no_baseline",
  "pass",
  "drop",
] as const;

export type RingSuccessVerdict = (typeof RING_SUCCESS_VERDICTS)[number];

export interface RingSuccessRow {
  platform: string;
  app_version: string;
  attempts: number;
  rang_in_time: number;
  ring_rate: number | null;
  baseline_attempts: number;
  baseline_rate: number | null;
  threshold: number | null;
  answered_sessions: number;
  verdict: RingSuccessVerdict;
}

/** One log line per run, the same scrape-friendly shape as CALL_BUDGET. */
export const RING_SUCCESS_PREFIX = "RING_SUCCESS ";

/**
 * A drop that persists is re-announced on these UTC hours only. The window is
 * 24 hours wide and read hourly, so without this one bad afternoon would send
 * the same alert all night.
 */
export const RING_SUCCESS_REMIND_EVERY_HOURS = 6;

const HOUR_MS = 60 * 60 * 1000;

/** The second half of P01, which the evidence cannot answer yet. */
const MEDIA_NOT_MEASURED =
  "not_measured: nothing records whether audio flowed on an answered call";

export async function readRingSuccess(
  db: SupabaseClient,
  at: Date,
): Promise<RingSuccessRow[]> {
  const { data, error } = await db.rpc("api_ring_success", { p_now: at.toISOString() });
  if (error) throw new Error(`ring success read failed: ${error.message}`);
  const rows = (data ?? []) as RingSuccessRow[];
  for (const row of rows) {
    if (!RING_SUCCESS_VERDICTS.includes(row.verdict)) {
      throw new Error(`ring success read returned an unknown verdict: ${String(row.verdict)}`);
    }
  }
  return rows;
}

const percent = (rate: number | null) =>
  rate === null ? "n/a" : `${Math.round(rate * 1000) / 10}%`;

function dropLine(row: RingSuccessRow): string {
  return (
    `${row.platform} ${row.app_version}: ${row.rang_in_time}/${row.attempts} rang ` +
    `within 15 s (${percent(row.ring_rate)}), against ${percent(row.baseline_rate)} ` +
    `over the prior 7 days (n=${row.baseline_attempts}); the alarm is below ` +
    `${percent(row.threshold)}.`
  );
}

export interface RingSuccessReport {
  rows: RingSuccessRow[];
  /** The platforms alerted on this run. */
  alerted: string[];
}

export async function runRingSuccessWatch(
  env: Env,
  now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<RingSuccessReport> {
  const rows = await readRingSuccess(db, now);

  console.log(
    `${RING_SUCCESS_PREFIX}${JSON.stringify({
      schema: "loonext.ring-success.v1",
      at: now.toISOString(),
      media_on_answered: MEDIA_NOT_MEASURED,
      rows,
    })}`,
  );

  const drops = rows.filter((row) => row.verdict === "drop");
  if (drops.length === 0) return { rows, alerted: [] };

  // An hour ago is the same rule over a window one hour older. A drop it did
  // not show is new.
  const before = await readRingSuccess(db, new Date(now.getTime() - HOUR_MS));
  const key = (row: RingSuccessRow) => `${row.platform}\u0000${row.app_version}`;
  const droppedBefore = new Set(
    before.filter((row) => row.verdict === "drop").map(key),
  );
  const reminder = now.getUTCHours() % RING_SUCCESS_REMIND_EVERY_HOURS === 0;

  const alerted: string[] = [];
  for (const platform of [...new Set(drops.map((row) => row.platform))].sort()) {
    const dropped = drops.filter((row) => row.platform === platform);
    const fresh = dropped.some((row) => !droppedBefore.has(key(row)));
    if (!fresh && !reminder) continue;
    alerted.push(platform);
    await opsAlert(env, {
      key: `ring-success-${platform}`,
      level: "error",
      summary: `Fewer ${platform} rings are reaching the phone`,
      detail: dropped.map(dropLine).join("\n"),
      action:
        `Search Workers Logs for ${RING_SUCCESS_PREFIX.trim()} to see every ` +
        `${platform} version with its n, then read ops_diag.ring_beacons as ` +
        "agent_diag for the affected version: rings that stop at push_received " +
        "are the app, rings with no push_received are delivery, and pushes " +
        "with no beacon at all point at the build or the push credential.",
    });
  }
  return { rows, alerted };
}
