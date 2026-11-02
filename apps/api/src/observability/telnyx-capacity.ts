import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import type { Env } from "../env";
import { productionWatchRefusal } from "../environments/policy";
import {
  LEGS_PER_ANSWERED_CALL,
  TELNYX_CONCURRENT_CALL_LIMIT,
} from "../telnyx/account-limits";
import { opsAlert } from "./ops-alert";

/**
 * #643: can production's calls outgrow Telnyx's concurrent call limit?
 *
 * An inbound call opens one customer leg and rings every member who may take
 * it. If other calls are up at that moment, the ring legs are competing with
 * them for the account's concurrent limit, and the ones Telnyx refuses simply
 * never ring: the customer reaches fewer people, or nobody. Nothing errors
 * loudly, so this reads the numbers and warns before it can happen.
 *
 * The worst case it prices is the one that matters: the largest ring audience
 * of any number, a new call's own leg, and the most calls that were ever up
 * together in the last 28 days, each holding a customer leg and a member leg.
 * Different numbers' peaks need not coincide, so it is an upper bound. That
 * is the right side to err on for a warning.
 */

export const CAPACITY_KEY = "telnyx-concurrency-capacity";

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
 * Daily. Warns when the worst case reaches or passes the account's concurrent
 * call limit. Null when this is not production, before any read.
 */
export async function runTelnyxCapacityWatch(
  env: Env,
  _now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<CapacityReport | null> {
  const refusal = productionWatchRefusal(env);
  if (refusal !== null) {
    console.log(`telnyx capacity watch skipped: ${refusal}`);
    return null;
  }

  const report = judgeCapacity(await readCapacity(db));
  console.log(
    `telnyx capacity: ${report.legsNeeded} leg(s) needed against a limit of ${report.limit} ` +
      `(${report.verdict}); largest ring audience ${report.largest_audience}, ` +
      `peak ${report.peak_concurrent_calls} answered call(s) up at once, ` +
      `${report.numbers} active number(s)`,
  );
  if (report.verdict === "ok") return report;

  await opsAlert(env, {
    key: CAPACITY_KEY,
    level: report.verdict === "over" ? "error" : "warning",
    summary:
      report.verdict === "over"
        ? "Production's calls can exceed Telnyx's concurrent call limit"
        : "Production's calls can reach Telnyx's concurrent call limit",
    detail:
      `Worst case: 1 customer leg + ${report.largest_audience} ring leg(s) + ` +
      `${report.peak_concurrent_calls} answered call(s) x ${LEGS_PER_ANSWERED_CALL} legs ` +
      `= ${report.legsNeeded}, against a limit of ${report.limit}. ` +
      "Past the limit Telnyx refuses ring legs, so a customer reaches fewer members than " +
      "the crew has, or none.",
    action:
      "Either shrink the ring audience (number access levels, or who has a telephony " +
      "credential), or raise the account's level in portal.telnyx.com (Account Levels) and " +
      "then set TELNYX_CONCURRENT_CALL_LIMIT in apps/api/src/telnyx/account-limits.ts and " +
      "docs/deploy/04-telnyx.md section 9 to the new limit.",
  });
  return report;
}
