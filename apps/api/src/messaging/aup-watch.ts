/**
 * #303: the shape of each workspace's day of sending, for an AUP breach to be
 * noticed before a carrier notices it.
 *
 * `/legal/aup` exists and acceptance is mandatory at company creation. For a
 * messaging provider, carrier filtering and account-level action land on the
 * whole sending pool, so one abusive workspace is billed to every other
 * customer's deliverability (#235).
 *
 * It reports. It never acts: a crew after a storm looks statistically like a
 * spammer, and suspending the wrong one costs them their business. Each
 * workspace's signals go to PostHog as one `aup_signals` event, and the
 * "Limits and rates" alert there holds the thresholds and asks a person to
 * look (D146).
 *
 * Behavioural, never content: `api_aup_signals` returns counts and ratios
 * only, and the event carries no workspace name.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import type { Env } from "../env";
import { captureEvent } from "../observability/capture";

export interface AupSignals {
  company_id: string;
  sent_24h: number;
  baseline_daily: number;
  fresh_ratio: number;
  opt_outs_24h: number;
  /** Outbound rejected by a carrier as spam in the window. */
  spam_blocks_24h: number;
}

const count = (value: unknown) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Daily. One event per workspace that sent, or tried to send, in the last 24
 * hours, under the workspace's own id.
 */
export async function runAupSignalsJob(
  env: Env,
  _now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<number> {
  const { data, error } = await db.rpc("api_aup_signals", {
    p_baseline_days: 14,
  });
  if (error) throw new Error(`aup signals read failed: ${error.message}`);

  const rows = (data ?? []) as Partial<AupSignals>[];
  const sent = rows.flatMap((row) => {
    if (typeof row.company_id !== "string") return [];
    const signals: Omit<AupSignals, "company_id"> = {
      sent_24h: count(row.sent_24h),
      baseline_daily: count(row.baseline_daily),
      fresh_ratio: count(row.fresh_ratio),
      opt_outs_24h: count(row.opt_outs_24h),
      spam_blocks_24h: count(row.spam_blocks_24h),
    };
    return [captureEvent(env, "aup_signals", row.company_id, { ...signals })];
  });
  await Promise.all(sent);
  return sent.length;
}
