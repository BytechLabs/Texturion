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
 *     state changed, so a known-bad number does not mail us every morning
 *     until somebody starts ignoring the mailbox.
 *   - 'watch' emails US. 'degraded' also becomes a banner the customer sees.
 *     A maybe-degraded warning on a thin sample is how a false alarm turns
 *     into a cancellation, so the customer only ever hears the confident one.
 *   - RECOVERY is announced too. A number that came back is the only evidence
 *     that a remediation worked, and it closes the loop on an alert somebody
 *     is still worrying about.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import { renderEmailHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";

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

const STATE_RANK: Record<string, number> = { healthy: 0, watch: 1, degraded: 2 };

/** Did this transition make things worse? Recovery reads differently. */
function isWorsening(row: HealthTransition): boolean {
  return (STATE_RANK[row.state] ?? 0) > (STATE_RANK[row.was] ?? 0);
}

export async function runNumberHealthJob(
  env: Env,
  _now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<HealthTransition[]> {
  const { data, error } = await db.rpc("api_assess_number_health");
  if (error) throw new Error(`number health assessment failed: ${error.message}`);

  const transitions = (data ?? []) as HealthTransition[];
  if (transitions.length === 0) return transitions;

  const worse = transitions.filter(isWorsening);
  const better = transitions.filter((row) => !isWorsening(row));

  const line = (row: HealthTransition) => {
    const rate = row.delivery_rate === null ? "?" : `${Math.round(row.delivery_rate * 100)}%`;
    const base =
      row.baseline_rate === null ? "no baseline" : `was ${Math.round(row.baseline_rate * 100)}%`;
    return `  ${row.number_e164 ?? row.phone_number_id}: ${row.was} → ${row.state} — ${rate} (${base})${row.detail ? `; ${row.detail}` : ""}`;
  };

  const parts: string[] = [];
  if (worse.length > 0) {
    parts.push(
      `${worse.length} number(s) got worse:\n${worse.map(line).join("\n")}`,
      "",
      "A number that has been labelled does not recover on its own — the " +
        "registry paperwork takes days, so the useful moment to start is now " +
        "rather than when the customer calls. docs/NUMBER-REPUTATION.md has " +
        "the remediation path.",
    );
  }
  if (better.length > 0) {
    parts.push(
      `${better.length} number(s) recovered:\n${better.map(line).join("\n")}`,
      "",
      "Worth reading even though it is good news: a recovery is the only " +
        "evidence any remediation actually worked.",
    );
  }

  const degraded = transitions.filter((row) => row.state === "degraded").length;
  const text = parts.join("\n");

  await sendEmail(env, {
    to: [env.OPS_ALERT_EMAIL ?? "support@loonext.com"],
    subject:
      degraded > 0
        ? `[ops] ${degraded} number(s) now DEGRADED — customers can see this`
        : `[ops] number health changed for ${transitions.length} number(s)`,
    text,
    html: renderEmailHtml(text),
  });

  return transitions;
}
