import { getDb } from "../db";
import type { Env } from "../env";
import { deployEnv } from "./mode";

/**
 * D142: the rig serves only once its database says it is the rig.
 *
 * The SQL destination gate is on only where the database setting
 * `loonext.deploy_env` is `rig`, so production, which never sets it, is
 * untouched. The same test makes it fail open on the rig: `supabase db reset`
 * recreates the database without its ALTER DATABASE settings, and a pooled
 * connection opened before they were set never sees them. Nothing in the
 * database can notice that, so the API asks, through the same PostgREST it
 * writes through, before it serves a request or runs a cron. Durable Object
 * alarms are not asked; the app's own destination gate and the guard still
 * stand in front of every send they make.
 */

/**
 * A confirmed answer is trusted for a minute per isolate, so a reset is caught
 * within a minute and an ordinary request pays nothing. A refusal is never
 * remembered, so the rig recovers on the first request after its bootstrap
 * has run.
 */
const CONFIRMED_FOR_MS = 60_000;

const confirmedAt = new WeakMap<Env, number>();

/** Null means serve. Outside the rig the database is never asked. */
export async function rigDatabaseRefusal(env: Env, now = Date.now()): Promise<string | null> {
  if (deployEnv(env) !== "rig") return null;
  const confirmed = confirmedAt.get(env);
  if (confirmed !== undefined && now - confirmed < CONFIRMED_FOR_MS) return null;

  let posture: unknown;
  try {
    const { data, error } = await getDb(env).rpc("rig_database_posture");
    if (error) return "rig mode could not read the database's posture";
    posture = data;
  } catch {
    return "rig mode could not read the database's posture";
  }

  const refusal = postureRefusal(posture);
  if (refusal === null) confirmedAt.set(env, now);
  else confirmedAt.delete(env);
  return refusal;
}

function postureRefusal(posture: unknown): string | null {
  const { deploy_env: setting, endpoints } = (posture ?? {}) as {
    deploy_env?: unknown;
    endpoints?: unknown;
  };
  if (setting !== "rig") {
    return "the rig's database does not set loonext.deploy_env to rig, so its destination gate is off";
  }
  if (typeof endpoints !== "number" || endpoints < 1) {
    return "the rig's database lists no usable loonext.rig_endpoints";
  }
  return null;
}
