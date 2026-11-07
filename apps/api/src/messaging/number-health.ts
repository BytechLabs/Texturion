/**
 * #235 — the daily number-reputation assessment, and who hears about it.
 *
 * We sell a phone number as the product. A carrier or analytics vendor
 * labelling it degrades the customer's whole business, and filtering is silent
 * by construction: the carrier returns a success-looking status and drops the
 * message, so the customer sees "delivered" and the homeowner sees nothing.
 *
 * The SQL does the judging (`api_assess_number_health`) because it is a
 * question about aggregates over the messages table, and pulling those rows
 * into a Worker to count them would move a lot of data to run a GROUP BY.
 * What lives here is the part that needs judgement about PEOPLE:
 *
 *   - only TRANSITIONS are announced. The RPC returns just the numbers whose
 *     state changed, so a known-bad number does not send a notice every
 *     morning until somebody starts ignoring them.
 *   - a number is healthy or degraded, and 'degraded' is also a banner the
 *     customer sees, so only a move into or out of it is news.
 *   - RECOVERY is announced too. A number that came back is the only evidence
 *     that a remediation worked, and it closes the loop on an issue somebody
 *     is still worrying about.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import type { Env } from "../env";
import { opsNotice } from "../observability/capture";

/** One row from api_assess_number_health — a number that changed state. */
interface HealthTransition {
  phone_number_id: string;
  company_id: string;
  number_e164: string | null;
  was: string;
  state: string;
  delivery_rate: number | null;
  baseline_rate: number | null;
  detail: string | null;
}

export async function runNumberHealthJob(
  env: Env,
  _now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<HealthTransition[]> {
  const { data, error } = await db.rpc("api_assess_number_health");
  if (error) throw new Error(`number health assessment failed: ${error.message}`);

  // A number is healthy or degraded, so every transition enters or leaves
  // 'degraded'.
  const transitions = (data ?? []) as HealthTransition[];
  if (transitions.length === 0) return transitions;
  const degraded = transitions.filter((row) => row.state === "degraded");

  const line = (row: HealthTransition) => {
    const rate = row.delivery_rate === null ? "?" : `${Math.round(row.delivery_rate * 100)}%`;
    const base =
      row.baseline_rate === null ? "no baseline" : `was ${Math.round(row.baseline_rate * 100)}%`;
    // The id, never the number: telemetry carries no phone numbers (§10).
    return `phone_number ${row.phone_number_id}: ${row.was} to ${row.state}, ${rate} (${base})${row.detail ? `; ${row.detail}` : ""}`;
  };

  await opsNotice(env, {
    key: "number-health",
    level: degraded.length > 0 ? "error" : "warning",
    summary:
      degraded.length > 0
        ? "A number is now DEGRADED, and its customer can see it"
        : "A number's delivery health recovered",
    detail: transitions.map(line).join("; "),
    action:
      degraded.length > 0
        ? "A labelled number does not recover on its own and the registry paperwork " +
          "takes days, so start now rather than when the customer calls. " +
          "docs/NUMBER-REPUTATION.md has the remediation path."
        : "Nothing to do. A recovery is the only evidence a remediation worked.",
  });

  return transitions;
}
