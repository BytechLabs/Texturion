/**
 * #581: a retention function that existed, was granted, was documented, and
 * was called by nothing.
 *
 * `api_prune_public_link_access` (#335) was written in the same migration as
 * the table it bounds, revoked from every role but `service_role`, and left
 * without a caller. DEFINING a delete bounds nothing. Until something calls
 * it, the only thing the function bounds is the next reader's suspicion that
 * the table might be growing.
 *
 * `docs/PERSONAL-DATA-INVENTORY.md` §5 publishes a 30-day window for
 * `public_link_access`, and a published window that nothing enforces is not a
 * retention policy: it is a claim. Every row we were still holding past day
 * 30 was one we had told ourselves, in writing, that we had already deleted.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import type { Env } from "../env";

/**
 * The window `docs/PERSONAL-DATA-INVENTORY.md` §5 publishes for
 * `public_link_access`, and therefore the one this job has to keep. The
 * document is what a customer was promised, so the code moves to match it and
 * never the other way round.
 *
 * It is also comfortably longer than anything that reads the table: the only
 * reader is `api_public_link_misses`, which looks back one hour to spot a token
 * enumeration run. Thirty days of history for a one-hour question is already
 * generous, which is why the published number needed no adjusting.
 */
export const PUBLIC_LINK_ACCESS_RETENTION_DAYS = 30;

/**
 * THE RPC TAKES NO LIMIT, unlike `api_prune_audit_log(p_before, p_limit)`, so
 * this job is not batched and there is no remainder to drain: one statement
 * removes everything past the window, or it fails and the next day tries the
 * whole backlog again.
 *
 * That is a deliberate non-change rather than an oversight. Adding a defaulted
 * `p_limit` to its `create or replace` would define a SECOND overload
 * beside the existing one, and a call that passes only the days argument keeps
 * resolving to the old unbounded signature — the fix would ship green and do
 * nothing. Bounding it properly means a new function name or a migration that
 * drops the old signature first, which is migration work and a bigger change
 * than the hole it would close.
 *
 * It is affordable at this table's rate. `public_link_access` is
 * customer-driven and has no ceiling, but its rows are five small columns and the first run after this ships is the only
 * one that ever faces a real backlog — every run after that deletes a single
 * day. If that first statement ever does become too large to hold, the answer
 * is a limited RPC under a new name, not a default parameter on this one.
 */

export async function prunePublicLinkAccess(
  env: Env,
  _now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<number> {
  const { data, error } = await db.rpc("api_prune_public_link_access", {
    p_days: PUBLIC_LINK_ACCESS_RETENTION_DAYS,
  });
  if (error) {
    throw new Error(`public_link_access prune failed: ${error.message}`);
  }

  const deleted = (data as number) ?? 0;
  if (deleted > 0) {
    // Logged, not emailed — the system keeping a published promise is not an
    // event that needs a human. The count belongs in the record anyway, because
    // "how long do you hold that" is a question we have now answered in a
    // document and should be able to evidence.
    console.log(`public_link_access prune deleted ${deleted} row(s)`);
  }
  return deleted;
}
