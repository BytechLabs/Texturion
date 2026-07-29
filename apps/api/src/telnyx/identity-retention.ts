/**
 * #381 — stop holding a stranger's government identifier.
 *
 * The wizard's `business` step collects the owner's legal name, address, and
 * on the no-EIN path the LAST 4 OF THEIR SSN/SIN. Until 4dc1811 that came
 * before the paywall, so every signup that abandoned at checkout left those
 * fields in a draft row for a company that never became a customer.
 *
 * Moving the step behind the paywall stops new ones accumulating. It does
 * nothing about the rows already there — and nothing about somebody who pays,
 * starts the identity form and walks away, which the reorder makes MORE likely
 * rather than less, since the form now sits after the money.
 *
 * PIPEDA and Law 25 both run on collecting no more than necessary and keeping
 * it no longer than necessary. A SIN fragment belonging to somebody who never
 * became a customer fails the second test on any reading.
 *
 * Same principle as #340 (the marketing contact form retaining non-customer
 * PII forever), applied to more sensitive data.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import type { Env } from "../env";

/**
 * How long an abandoned draft keeps its identity fields.
 *
 * Thirty days is long enough that somebody who got distracted mid-signup and
 * came back next month does not retype anything, and short enough that we are
 * not holding a stranger's SIN fragment into a second quarter. It also matches
 * the workspace-closure purge window, so there is one number to remember
 * rather than two.
 */
const RETENTION_DAYS = 30;

export async function runIdentityRetentionJob(
  env: Env,
  _now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<number> {
  const { data, error } = await db.rpc("api_prune_abandoned_identity", {
    p_days: RETENTION_DAYS,
  });
  if (error) throw new Error(`identity retention prune failed: ${error.message}`);

  const cleared = (data as number) ?? 0;
  if (cleared > 0) {
    // Logged rather than emailed. Nothing here needs a human — it is the
    // system doing what it should — but the count is worth having in the
    // record if anybody ever asks how long we hold this.
    console.log(`identity retention: cleared identity fields from ${cleared} abandoned draft(s)`);
  }
  return cleared;
}
