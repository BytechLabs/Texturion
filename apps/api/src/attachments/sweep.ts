/**
 * Attachment orphan sweeper (SPEC §11; D19 §2 — "the sweep cron removes the
 * object"; #15/#16 storage-cost hardening). Four idempotent passes per run,
 * each selected by STATE (never "last run" bookkeeping), so re-runs and
 * overlaps are safe and a crash mid-batch just leaves work for the next run:
 *
 *   1. SOFT-DELETED ROWS (D19): DELETE /v1/attachments/:id soft-deletes a row
 *      (`deleted_at` stamped); this pass reclaims the Storage object AND
 *      hard-deletes the row once the grace window has passed.
 *   2. ORPHAN OBJECTS (#15): Storage objects in the attachments bucket with NO
 *      `attachments` row at all — the pre-claim-first ordering's leftovers and
 *      any residual crash debris. Invisible to pass 1 (which selects rows) and
 *      to the D30 accounting (which sums rows), so without this pass they are
 *      unbounded, unaccounted provider spend. Found by the
 *      api_orphan_attachment_objects anti-join, removed via the Storage API.
 *   3. GHOST ROWS (#15): live `attachments` rows whose object never landed
 *      (the claim-first crash window: claim committed, upload never happened).
 *      They hold D30 budget forever and 500 on download; hard-deleting the row
 *      releases both. Found by the api_ghost_attachment_rows anti-join.
 *   4. EGRESS RETENTION (#16): `egress_events` ledger rows older than two full
 *      billing periods are dropped — the alert/cap windows only ever read the
 *      current period, and an unbounded ledger would itself become a database
 *      cost center (cap-and-drop applies to our own tables too).
 *   5/6. THE SAME TWO ANTI-JOINS FOR MMS MEDIA (#263). Passes 2 and 3 cover the
 *      `attachments` bucket ONLY — both RPCs hardcode `bucket_id =
 *      'attachments'` — and text/picture message media lives in a different
 *      bucket (`mms-media`) against a different table (`message_attachments`).
 *      Nothing had ever swept it, so a crashed MMS send left objects that no read
 *      path could reach, no accounting counted (`mms_bytes` sums ROWS), and no
 *      pass would ever reclaim: billed forever. Reachable from both directions of
 *      media, since inbound stores its own copy the same upload-then-insert way.
 *      Pass 6 is the more urgent direction despite being the rarer one — a row
 *      with no object OVER-reports the customer's storage and makes a retry mint
 *      a signed URL Telnyx fetches a 404 from.
 *
 * Why a grace window: a signed download URL minted just before a soft-delete
 * is valid for up to ATTACHMENT_SIGNED_URL_TTL_SECONDS (300s). Waiting past
 * that ceiling means the sweep never yanks an object out from under an
 * in-flight download; the SAME window also guarantees passes 2/3 can never
 * race an in-flight upload (a Worker request lives seconds, not minutes).
 *
 * A pass failure is collected, the remaining passes still run (one broken arm
 * never starves the others), and the run rethrows at the end so the cron
 * still reports failure (Sentry wraps scheduled()). A per-batch Storage
 * failure inside a pass is logged and left retryable, as before.
 */
import * as Sentry from "@sentry/cloudflare";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import type { Env } from "../env";
import { MMS_BUCKET } from "../messaging/media";
import { ATTACHMENTS_BUCKET } from "../routes/core/attachments";

/**
 * Soft-deleted rows must age past the signed-URL TTL (300s) before the object
 * is reclaimed, so an in-flight download can't 404 mid-stream. 15 minutes is a
 * safe margin over that ceiling (and over any in-flight upload for the #15
 * orphan/ghost passes).
 */
export const SWEEP_GRACE_MS = 15 * 60 * 1000;

/** Rows reclaimed per run — bounds a single trigger's work (mirrors the webhook sweep). */
export const SWEEP_BATCH = 100;

/**
 * #16: egress ledger rows older than this are dropped. Two full billing
 * periods (62 days covers the longest pair of months) — the cap and the
 * 80%/100% alerts only ever sum the CURRENT period, so anything older is dead
 * weight; keeping one prior period leaves room for support inspection.
 */
export const EGRESS_RETENTION_MS = 62 * 24 * 60 * 60 * 1000;

interface DeletedAttachmentRow {
  id: string;
  storage_path: string;
}

/**
 * §11 attachment sweeper: run all four reclamation passes (see the module
 * doc). Every pass runs even when an earlier one fails; failures are rethrown
 * together at the end.
 */
export async function sweepDeletedAttachments(env: Env): Promise<void> {
  const db = getDb(env);
  const cutoff = new Date(Date.now() - SWEEP_GRACE_MS).toISOString();

  const passes: readonly (readonly [string, () => Promise<void>])[] = [
    ["soft-deleted rows", () => sweepSoftDeletedRows(db, cutoff)],
    ["orphan objects", () => sweepOrphanObjects(db, cutoff)],
    ["ghost rows", () => sweepGhostRows(db, cutoff)],
    ["egress retention", () => sweepAgedEgressEvents(db)],
    // #263: the same two directions for the mms-media bucket.
    ["orphan mms objects", () => sweepOrphanMmsObjects(db, cutoff)],
    ["ghost mms rows", () => sweepGhostMmsRows(db, cutoff)],
  ];

  const failures: unknown[] = [];
  for (const [, run] of passes) {
    try {
      await run();
    } catch (cause) {
      failures.push(cause);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `attachment sweep failed in ${failures.length} pass${failures.length === 1 ? "" : "es"}`,
    );
  }
}

/**
 * Pass 1 (D19 §2): reclaim the Storage object + row for attachments
 * soft-deleted longer than the grace window ago.
 */
async function sweepSoftDeletedRows(
  db: SupabaseClient,
  cutoff: string,
): Promise<void> {
  const { data, error } = await db
    .from("attachments")
    .select("id,storage_path")
    .not("deleted_at", "is", null)
    .lt("deleted_at", cutoff)
    .order("deleted_at", { ascending: true })
    .limit(SWEEP_BATCH);
  if (error) {
    throw new Error(`attachment sweep query failed: ${error.message}`);
  }

  const rows = (data ?? []) as DeletedAttachmentRow[];
  if (rows.length === 0) return;

  // Remove the Storage objects in one batched call, then hard-delete exactly the
  // rows whose objects we asked Storage to reclaim. remove() is idempotent — an
  // already-gone object is a no-op — so a partial prior run is safe to repeat.
  const paths = rows.map((row) => row.storage_path);
  const { error: removeError } = await db.storage
    .from(ATTACHMENTS_BUCKET)
    .remove(paths);
  if (removeError) {
    // Leave the rows soft-deleted (still selectable) so the next run retries.
    console.error("attachment sweep storage remove failed:", removeError.message);
    Sentry.captureMessage("attachment sweep storage remove failed", "warning");
    return;
  }

  const ids = rows.map((row) => row.id);
  const { error: deleteError } = await db
    .from("attachments")
    .delete()
    .in("id", ids);
  if (deleteError) {
    // Objects are gone but the rows remain: harmless (they point at absent
    // objects) and the next run re-issues an idempotent remove() then deletes.
    throw new Error(`attachment sweep row delete failed: ${deleteError.message}`);
  }
}

/**
 * Pass 2 (#15): garbage-collect bucket objects with no `attachments` row.
 * The anti-join runs in SQL (api_orphan_attachment_objects reads
 * storage.objects); the removal MUST go through the Storage API — deleting
 * the storage.objects row directly would leave the underlying file behind.
 */
async function sweepOrphanObjects(
  db: SupabaseClient,
  cutoff: string,
): Promise<void> {
  const { data, error } = await db.rpc("api_orphan_attachment_objects", {
    p_cutoff: cutoff,
    p_limit: SWEEP_BATCH,
  });
  if (error) {
    throw new Error(`orphan object scan failed: ${error.message}`);
  }
  const paths = (data ?? []) as string[];
  if (paths.length === 0) return;

  const { error: removeError } = await db.storage
    .from(ATTACHMENTS_BUCKET)
    .remove(paths);
  if (removeError) {
    // The objects are still row-less, so the next run re-selects and retries.
    console.error("orphan object remove failed:", removeError.message);
    Sentry.captureMessage("attachment orphan object remove failed", "warning");
  }
}

/**
 * Pass 3 (#15): hard-delete live rows whose Storage object never landed (the
 * claim-first crash window). No object exists, so there is nothing to remove —
 * dropping the row releases the D30 budget it holds and stops the broken
 * attachment from surfacing in lists.
 */
async function sweepGhostRows(db: SupabaseClient, cutoff: string): Promise<void> {
  const { data, error } = await db.rpc("api_ghost_attachment_rows", {
    p_cutoff: cutoff,
    p_limit: SWEEP_BATCH,
  });
  if (error) {
    throw new Error(`ghost row scan failed: ${error.message}`);
  }
  const ids = (data ?? []) as string[];
  if (ids.length === 0) return;

  const { error: deleteError } = await db
    .from("attachments")
    .delete()
    .in("id", ids);
  if (deleteError) {
    throw new Error(`ghost row delete failed: ${deleteError.message}`);
  }
}

/**
 * Pass 4 (#16): drop egress-ledger rows past the retention window so the
 * metering table stays bounded. State-selected and idempotent like the rest.
 */
async function sweepAgedEgressEvents(db: SupabaseClient): Promise<void> {
  const cutoff = new Date(Date.now() - EGRESS_RETENTION_MS).toISOString();
  const { error } = await db
    .from("egress_events")
    .delete()
    .lt("created_at", cutoff);
  if (error) {
    throw new Error(`egress retention delete failed: ${error.message}`);
  }
}

/**
 * Pass 5 (#263): garbage-collect `mms-media` objects with no
 * `message_attachments` row — the mirror of pass 2 for message media.
 *
 * Safe for inbound media as well as outbound: `messaging/inbound.ts` stores its
 * own copy in this bucket at the same {company}/{message}/{n} path before
 * inserting the row, so an object with no row is debris in both directions. The
 * grace cutoff is far longer than a Worker request, so the window between an
 * upload and its row insert is never swept out from under an in-flight send.
 */
async function sweepOrphanMmsObjects(
  db: SupabaseClient,
  cutoff: string,
): Promise<void> {
  const { data, error } = await db.rpc("api_orphan_mms_media_objects", {
    p_cutoff: cutoff,
    p_limit: SWEEP_BATCH,
  });
  if (error) {
    throw new Error(`mms orphan object scan failed: ${error.message}`);
  }
  const paths = (data ?? []) as string[];
  if (paths.length === 0) return;

  const { error: removeError } = await db.storage.from(MMS_BUCKET).remove(paths);
  if (removeError) {
    // Still row-less, so the next run re-selects and retries.
    console.error("mms orphan object remove failed:", removeError.message);
    Sentry.captureMessage("mms orphan object remove failed", "warning");
  }
}

/**
 * Pass 6 (#263): hard-delete `message_attachments` rows whose object is gone.
 *
 * The worse of the two residues, and the reason this direction exists at all:
 * `api_storage_usage` sums these rows into `mms_bytes`, so each one over-reports
 * what the customer is storing, and the retry path mints a signed URL for it that
 * Telnyx fetches a 404 from — a send that fails for a reason nobody can see.
 * Reachable when the #263 unwind removes an object but its row delete fails.
 */
async function sweepGhostMmsRows(
  db: SupabaseClient,
  cutoff: string,
): Promise<void> {
  const { data, error } = await db.rpc("api_ghost_mms_media_rows", {
    p_cutoff: cutoff,
    p_limit: SWEEP_BATCH,
  });
  if (error) {
    throw new Error(`mms ghost row scan failed: ${error.message}`);
  }
  const ids = (data ?? []) as string[];
  if (ids.length === 0) return;

  const { error: deleteError } = await db
    .from("message_attachments")
    .delete()
    .in("id", ids);
  if (deleteError) {
    throw new Error(`mms ghost row delete failed: ${deleteError.message}`);
  }
}
