/**
 * Clear registration identity fields from abandoned drafts after 30 days (#381).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import type { Env } from "../env";

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
