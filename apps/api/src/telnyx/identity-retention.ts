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
    console.log(`identity retention: removed ${cleared} abandoned registration draft(s)`);
  }
  return cleared;
}
