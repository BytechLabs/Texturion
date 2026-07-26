/**
 * #231 — audit-log retention, run daily beside the webhook-ledger prune.
 *
 * The log is written on every privileged action for the life of the install.
 * An unbounded log is an unbounded bill, and the cost-protection posture here
 * is the same as everywhere else: cap it, and say so when the cap is doing
 * work.
 *
 * Twelve months is chosen against what the log is FOR. The questions it
 * answers — who removed that contact, who changed the caller ID, what did the
 * person who left take with them — are asked weeks to months after the fact,
 * and a security questionnaire asks for a year. Shorter would make the log
 * technically present and practically useless by the time anyone opens it.
 *
 * Deleting is otherwise impossible: the table's append-only trigger refuses
 * DELETE for every role. `api_prune_audit_log` is the one exception, it is
 * granted to service_role alone, and it can only remove rows already past the
 * window.
 */
import { getDb } from "../db";
import type { Env } from "../env";

/** How long a privileged change stays answerable. See the note above. */
export const AUDIT_RETENTION_DAYS = 365;

/**
 * Per-run ceiling. Comfortably above any plausible day of privileged actions,
 * so a backlog drains over consecutive days instead of one cron run holding a
 * long delete.
 */
const PRUNE_BATCH = 5000;

export async function pruneAuditLog(
  env: Env,
  now: Date = new Date(),
): Promise<void> {
  const db = getDb(env);
  const before = new Date(
    now.getTime() - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await db.rpc("api_prune_audit_log", {
    p_before: before,
    p_limit: PRUNE_BATCH,
  });
  if (error) {
    throw new Error(`audit_log prune failed: ${error.message}`);
  }
  const removed = typeof data === "number" ? data : 0;
  if (removed >= PRUNE_BATCH) {
    // Hit the ceiling: a backlog is still draining. Visible so a log growing
    // faster than one run can trim never stays silent.
    console.log(
      `audit_log prune removed ${removed} rows (batch ceiling — more remain)`,
    );
  }
}
