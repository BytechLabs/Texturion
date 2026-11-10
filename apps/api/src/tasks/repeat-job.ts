/**
 * Keeps the next occurrences of schedule repeats created ahead of time (#693).
 *
 * Idempotent and bounded: the SQL function takes at most `BATCH` series per
 * tick, locks each with SKIP LOCKED, and every occurrence insert is keyed on
 * (series, occurrence number), so two overlapping ticks cannot make a job twice.
 * An after-done repeat is not touched here; its completion makes the next one.
 */
import { getDb } from "../db";
import type { Env } from "../env";

const BATCH = 200;

export async function runTaskRepeatsJob(
  env: Env,
  now: Date = new Date(),
): Promise<number> {
  const { data, error } = await getDb(env).rpc("api_materialize_task_repeats", {
    p_limit: BATCH,
    p_now: now.toISOString(),
  });
  if (error) throw new Error(`task repeat run failed: ${error.message}`);
  return typeof data === "number" ? data : 0;
}
