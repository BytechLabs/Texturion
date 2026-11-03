import { getDb } from "../db";
import type { Env } from "../env";
import { captureEvent, SYSTEM_DISTINCT_ID } from "../observability/capture";

/**
 * #240 item 2 — the tripwire that decides when storage starts costing us
 * anything at all.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS A TRIPWIRE HERE AND NOT A TIERING IMPLEMENTATION.
 *
 * #240 asked for cold objects to move to a cheaper storage tier. Two findings,
 * both dated 2026-08-04:
 *
 *   1. THE VENDOR CANNOT DO IT. Supabase Storage's S3 compatibility page marks
 *      GetBucketLifecycleConfiguration and PutBucketLifecycleConfiguration
 *      unimplemented, and PutObject's `x-amz-storage-class` unsupported. There
 *      is no lifecycle rule and no storage class to move an object into. The
 *      only way to tier would be a SECOND storage vendor — a new subprocessor
 *      with its own DPA, a second signing path, a second deletion contract to
 *      keep in step with #284 and #227, and a second place for the sweep to be
 *      wrong.
 *
 *   2. THERE IS NOTHING TO TIER. Measured against production the same day: 2
 *      live note attachments totalling 990 KB and 4 MMS media totalling 1.1 MB,
 *      across 3 workspaces — 0.0009 GB against the 100 GB Supabase Pro
 *      includes. Storage costs us nothing, and would keep costing nothing after
 *      a hundred thousand times as much.
 *
 * So the honest engineering answer is not to build it, and the thing worth
 * building instead is the number that says when that answer expires. Without
 * one, "we looked at this and it was not worth it" decays into folklore and
 * somebody re-derives it from scratch in a year — or worse, nobody does, and
 * the first sign is a bill.
 *
 * *This is the same discipline as the carrier-ceiling and inference-location
 * constants: a fact, the date it was checked, and the trigger to check again.*
 */

/**
 * What Supabase Pro includes, in GB. Crossing it is the moment a stored byte
 * starts costing money rather than nothing.
 *
 * Verified on supabase.com/pricing, 2026-08-04. It is the threshold and not an
 * alarm: at 100 GB the overage is ~$0.021/GB-month, so the first month past it
 * costs cents. What matters is that somebody KNOWS, because it is also the
 * moment deduplication and a second storage tier stop costing more than they
 * save.
 */
export const SUPABASE_INCLUDED_STORAGE_GB = 100;
export const SUPABASE_STORAGE_VERIFIED_ON = "2026-08-04";

/**
 * Fleet-wide stored bytes across both attachment tables, live rows only.
 *
 * A separate read from the per-company arm rather than a sum of it: the
 * per-company loop is capped per run (USAGE_ALERTS_BATCH), so adding up what it
 * happened to visit would quietly under-report exactly as the fleet grew past
 * the point where the number matters.
 */
export async function fleetStoredBytes(env: Env): Promise<number> {
  const db = getDb(env);
  const { data, error } = await db.rpc("api_fleet_stored_bytes");
  if (error) {
    throw new Error(`fleet storage read failed: ${error.message}`);
  }
  return Number(data ?? 0);
}

/**
 * Hourly, the fleet's stored bytes as an `ops_gauge` against the included
 * allowance. PostHog's "Limits and rates" alert fires at 70% of it (D146).
 *
 * Deliberately NOT a customer-facing anything: D34 made storage free to the
 * customer and this is our cost, not theirs. Deliberately not a cap either —
 * capping storage is the thing D34 explicitly took off the table. Past the
 * allowance, deduplication and a second storage tier (#240) become worth
 * building; `node scripts/ops/storage-report.mjs` ranks the workspaces
 * carrying it.
 */
export async function sendFleetStorageGauge(env: Env): Promise<number> {
  const gb = (await fleetStoredBytes(env)) / 1024 ** 3;
  const value = Math.round(gb * 1000) / 1000;
  await captureEvent(env, "ops_gauge", SYSTEM_DISTINCT_ID, {
    key: "supabase-storage",
    value,
    limit: SUPABASE_INCLUDED_STORAGE_GB,
    unit: "gb",
  });
  return value;
}
