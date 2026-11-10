/**
 * #691 — the part of "delete forever" that destroys something.
 *
 * Objects first, then rows, the walk `retention-enforce.ts` takes: the rows are
 * where the storage paths live, so dropping them first would leave a customer's
 * photo or voice in a bucket with nothing pointing at it. A removal that fails
 * throws BEFORE any row changes, so the next run finds the same paths and tries
 * again instead of stranding them.
 *
 * Shared by the daily job (an item that has sat in the Trash 30 days) and the
 * "Delete forever" route, so both erase the same things in the same order.
 *
 * What stays is decided in SQL (`api_purge_trash_item`): billing counters on the
 * message and call rows, `call_records`, `usage_events` and `opt_outs` are never
 * read or written here.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import type { Env } from "../env";

export type TrashKind = "message" | "conversation" | "call" | "voicemail";

export const TRASH_KINDS: readonly TrashKind[] = [
  "message",
  "conversation",
  "call",
  "voicemail",
];

/** Items per run. A backlog drains over the next days rather than in one request. */
const MAX_ITEMS_PER_RUN = 200;

/** Objects per Storage call. */
const REMOVE_BATCH = 100;

export type PurgeOutcome =
  | { outcome: "purged"; companyId: string }
  | { outcome: "not_found" }
  | { outcome: "legal_hold" };

export async function purgeTrashItem(
  db: SupabaseClient,
  kind: TrashKind,
  id: string,
  actorUserId: string | null,
  /**
   * The caller's workspace and number deny-list (#106), or omitted for the daily
   * job. Passed to BOTH calls so an item outside either is neither emptied from
   * storage nor erased from the database.
   */
  scope: { companyId: string; hiddenNumberIds: string[] | null } | null = null,
): Promise<PurgeOutcome> {
  const { data: pathRows, error: pathError } = await db.rpc(
    "api_trash_object_paths",
    {
      p_kind: kind,
      p_id: id,
      p_company_id: scope?.companyId ?? null,
      p_hidden_number_ids: scope?.hiddenNumberIds ?? null,
    },
  );
  if (pathError) {
    throw new Error(`trash object scan failed: ${pathError.message}`);
  }

  const byBucket = new Map<string, string[]>();
  for (const row of (pathRows ?? []) as { bucket: string; path: string }[]) {
    const list = byBucket.get(row.bucket) ?? [];
    list.push(row.path);
    byBucket.set(row.bucket, list);
  }
  for (const [bucket, paths] of byBucket) {
    for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
      const { error } = await db.storage
        .from(bucket)
        .remove(paths.slice(i, i + REMOVE_BATCH));
      if (error) {
        throw new Error(`trash ${bucket} remove failed: ${error.message}`);
      }
    }
  }

  const { data, error } = await db.rpc("api_purge_trash_item", {
    p_kind: kind,
    p_id: id,
    p_actor: actorUserId,
    p_company_id: scope?.companyId ?? null,
    p_hidden_number_ids: scope?.hiddenNumberIds ?? null,
  });
  if (error) throw new Error(`trash purge failed: ${error.message}`);

  const result = (data ?? {}) as {
    outcome?: string;
    company_id?: string;
  };
  if (result.outcome === "purged" && result.company_id) {
    return { outcome: "purged", companyId: result.company_id };
  }
  if (result.outcome === "legal_hold") return { outcome: "legal_hold" };
  return { outcome: "not_found" };
}

export interface PurgeTrashSummary {
  due: number;
  purged: number;
  failed: number;
}

/**
 * The daily sweep: everything that has been in the Trash 30 days. A workspace on
 * legal hold is excluded in SQL (`api_trash_due`), so a hold stops destruction
 * rather than being skipped in a loop. One item's failure never stops the rest.
 */
export async function purgeTrash(
  env: Env,
  _now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<PurgeTrashSummary> {
  const summary: PurgeTrashSummary = { due: 0, purged: 0, failed: 0 };
  const { data, error } = await db.rpc("api_trash_due", {
    p_limit: MAX_ITEMS_PER_RUN,
  });
  if (error) throw new Error(`trash due scan failed: ${error.message}`);

  const failures: unknown[] = [];
  for (const row of (data ?? []) as { kind: TrashKind; id: string }[]) {
    summary.due += 1;
    try {
      const result = await purgeTrashItem(db, row.kind, row.id, null);
      if (result.outcome === "purged") summary.purged += 1;
    } catch (cause) {
      summary.failed += 1;
      failures.push(cause);
      console.error(
        `trash purge failed for ${row.kind} ${row.id}:`,
        cause instanceof Error ? (cause.stack ?? cause.message) : String(cause),
      );
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `trash purge: ${failures.length} item(s) failed`,
    );
  }
  return summary;
}
