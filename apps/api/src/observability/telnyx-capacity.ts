import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import type { Env } from "../env";
import { productionWatchRefusal } from "../environments/policy";
import {
  LEGS_PER_ANSWERED_CALL,
  TELNYX_CONCURRENT_CALL_LIMIT,
} from "../telnyx/account-limits";
import { captureEvent, SYSTEM_DISTINCT_ID } from "./capture";

/**
 * #643: can production's calls outgrow Telnyx's concurrent call limit?
 *
 * An inbound call opens one customer leg and rings every member who may take
 * it. If other calls are up at that moment, the ring legs are competing with
 * them for the account's concurrent limit, and the ones Telnyx refuses simply
 * never ring: the customer reaches fewer people, or nobody. Nothing errors
 * loudly, so this reads the numbers and reports them before it can happen.
 *
 * The worst case it prices is the one that matters: the largest ring audience
 * of any number, a new call's own leg, and the most calls that were ever up
 * together in the last 28 days, each holding a customer leg and a member leg.
 * Different numbers' peaks need not coincide, so it is an upper bound. That
 * is the right side to err on for a warning.
 */

export const CAPACITY_GAUGE_KEY = "telnyx-concurrent-legs";

export interface CapacityRead {
  /** Active numbers the audience was taken over. */
  numbers: number;
  /** The most members one inbound call can ring, or has rung in 28 days. */
  largest_audience: number;
  /** The most answered calls up at once in 28 days. */
  peak_concurrent_calls: number;
}

export interface CapacityReport extends CapacityRead {
  limit: number;
  /** Legs the worst case needs at once. */
  legsNeeded: number;
  verdict: "ok" | "at_limit" | "over";
}

/** Legs the worst case holds at once. Pure. */
export function legsNeeded(read: CapacityRead): number {
  return (
    1 +
    read.largest_audience +
    read.peak_concurrent_calls * LEGS_PER_ANSWERED_CALL
  );
}

export function judgeCapacity(
  read: CapacityRead,
  limit: number = TELNYX_CONCURRENT_CALL_LIMIT,
): CapacityReport {
  const needed = legsNeeded(read);
  return {
    ...read,
    limit,
    legsNeeded: needed,
    verdict: needed > limit ? "over" : needed === limit ? "at_limit" : "ok",
  };
}

export async function readCapacity(db: SupabaseClient): Promise<CapacityRead> {
  const { data, error } = await db.rpc("api_voice_capacity_read");
  if (error) throw new Error(`voice capacity read failed: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as Partial<CapacityRead> | undefined;
  const count = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  const numbers = count(row?.numbers);
  const audience = count(row?.largest_audience);
  const peak = count(row?.peak_concurrent_calls);
  if (numbers === null || audience === null || peak === null) {
    throw new Error("voice capacity read returned no usable counts");
  }
  return { numbers, largest_audience: audience, peak_concurrent_calls: peak };
}

/**
 * Daily: the worst case as an `ops_gauge` against the account's concurrent
 * call limit. PostHog's "Limits and rates" alert fires at 70% of it (D146).
 * Null when this is not production, before any read.
 */
export async function runTelnyxCapacityGauge(
  env: Env,
  _now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<CapacityReport | null> {
  const refusal = productionWatchRefusal(env);
  if (refusal !== null) {
    console.log(`telnyx capacity gauge skipped: ${refusal}`);
    return null;
  }

  const report = judgeCapacity(await readCapacity(db));
  console.log(
    `telnyx capacity: ${report.legsNeeded} leg(s) needed against a limit of ${report.limit} ` +
      `(${report.verdict}); largest ring audience ${report.largest_audience}, ` +
      `peak ${report.peak_concurrent_calls} answered call(s) up at once, ` +
      `${report.numbers} active number(s)`,
  );
  await captureEvent(env, "ops_gauge", SYSTEM_DISTINCT_ID, {
    key: CAPACITY_GAUGE_KEY,
    value: report.legsNeeded,
    limit: report.limit,
    unit: "legs",
    largest_audience: report.largest_audience,
    peak_concurrent_calls: report.peak_concurrent_calls,
  });
  return report;
}
