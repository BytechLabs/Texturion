/**
 * #581 — two retention functions that existed, were granted, were documented,
 * and were called by nothing.
 *
 * `api_prune_public_link_access` (#335) and `prune_probe_results` (#477) were
 * each written in the same migration as the table they bound, each revoked
 * from every role but `service_role`, and each left without a caller. The
 * probe migration even records the intent out loud — "bounded here rather than
 * by a job, so the bound cannot be forgotten when somebody adds the tenth
 * probe" — which is the exact shape of the mistake. DEFINING a delete bounds
 * nothing. Until something calls it, the only thing the function bounds is the
 * next reader's suspicion that the table might be growing.
 *
 * `public_link_access` is the one that cost something real.
 * `docs/PERSONAL-DATA-INVENTORY.md` §5 publishes a 30-day window for it, and a
 * published window that nothing enforces is not a retention policy — it is a
 * claim. Every row we were still holding past day 30 was one we had told
 * ourselves, in writing, that we had already deleted.
 *
 * ONE FILE, TWO JOBS, for the reason #340 and #312 share a file: both tables
 * are diagnostics with no workspace behind them, so neither belongs to a
 * feature anybody would notice growing, and one place to look is one thing to
 * remember. Two JOBS rather than one because their silence means different
 * things (#333) — a stalled link prune is a promise we are quietly breaking,
 * a stalled probe prune is a storage bill.
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
 * Matches the `prune_probe_results` default, deliberately. `/status` renders
 * the last few days, so the window is set by the second question the table
 * answers — "has this been fine for a quarter, or is today the third bad
 * Tuesday" — which a few days of history cannot address at all.
 */
export const PROBE_RESULT_RETENTION_DAYS = 90;

/**
 * NEITHER RPC TAKES A LIMIT, unlike `api_prune_audit_log(p_before, p_limit)`,
 * so neither of these jobs is batched and there is no remainder to drain: one
 * statement removes everything past the window, or it fails and the next day
 * tries the whole backlog again.
 *
 * That is a deliberate non-change rather than an oversight. Adding a defaulted
 * `p_limit` to either `create or replace` would define a SECOND overload
 * beside the existing one, and a call that passes only the days argument keeps
 * resolving to the old unbounded signature — the fix would ship green and do
 * nothing. Bounding these properly means a new function name or a migration
 * that drops the old signature first, which is migration work and a bigger
 * change than the hole it would close.
 *
 * It is affordable at these two tables' rates. `probe_results` takes three
 * probes on a two-hourly trigger, so ~36 rows a day and ~3k at steady state.
 * `public_link_access` is customer-driven and has no such ceiling, but its
 * rows are five small columns and the first run after this ships is the only
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

export async function pruneProbeResults(
  env: Env,
  _now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<number> {
  const { data, error } = await db.rpc("prune_probe_results", {
    p_keep_days: PROBE_RESULT_RETENTION_DAYS,
  });
  if (error) {
    throw new Error(`probe_results prune failed: ${error.message}`);
  }

  const deleted = (data as number) ?? 0;
  if (deleted > 0) {
    console.log(`probe_results prune deleted ${deleted} row(s)`);
  }
  return deleted;
}
