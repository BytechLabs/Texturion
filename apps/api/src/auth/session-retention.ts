/**
 * #236 — signed-in-device retention, run daily beside the other prunes.
 *
 * `user_sessions` grows by one row per sign-in, forever, and most of those
 * rows are dead within days: a browser signed out, a phone reinstalled, a
 * session revoked. A dead row is evidence for exactly as long as somebody
 * might go looking for it, and after that it is a row nobody will ever read.
 *
 * Ninety days is chosen against what somebody actually asks. "Was that phone
 * still signed in when they left?" gets asked within weeks of somebody
 * leaving; the record that survives longer than that is the audit-log entry
 * (#231, twelve months), which is where the privileged ACTION lives. This
 * table only holds the device rows, and only the live ones are ever shown.
 *
 * Live sessions are never touched at any age — a person who signs in once and
 * stays signed in for a year keeps their row and keeps their access.
 */
import { getDb } from "../db";
import type { Env } from "../env";

/** How long a revoked or ended session stays visible in the record. */
export const SESSION_RETENTION_DAYS = 90;

export async function pruneUserSessions(
  env: Env,
  now: Date = new Date(),
): Promise<void> {
  const db = getDb(env);
  const before = new Date(
    now.getTime() - SESSION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { error } = await db.rpc("api_prune_user_sessions", {
    p_before: before,
  });
  if (error) {
    throw new Error(`user_sessions prune failed: ${error.message}`);
  }
}
