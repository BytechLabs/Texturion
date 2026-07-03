/**
 * Attachment orphan sweeper (SPEC §11; D19 §2 — "the sweep cron removes the
 * object"). The DELETE /v1/attachments/:id route soft-deletes a row
 * (`deleted_at` stamped); this job is what actually reclaims the private
 * `attachments` Storage object AND hard-deletes the row, after a grace window.
 *
 * Why a grace window: a signed download URL minted just before the soft-delete
 * is valid for up to ATTACHMENT_SIGNED_URL_TTL_SECONDS (300s). Waiting past that
 * ceiling means the sweep never yanks the object out from under an in-flight
 * download. SWEEP_GRACE_MS is comfortably longer than that TTL.
 *
 * Idempotent + safe to re-run (like sweepWebhookEvents): work is selected by
 * state (`deleted_at < cutoff`), never by "last run" bookkeeping. The Storage
 * remove() is idempotent (removing an absent object is a no-op), and the row is
 * hard-deleted only after the object removal is issued, so a crash mid-batch
 * just leaves the row for the next run. A per-row Storage failure is logged and
 * the row is left in place (retried next run) — one bad object never starves
 * the batch.
 */
import * as Sentry from "@sentry/cloudflare";

import { getDb } from "../db";
import type { Env } from "../env";
import { ATTACHMENTS_BUCKET } from "../routes/core/attachments";

/**
 * Soft-deleted rows must age past the signed-URL TTL (300s) before the object
 * is reclaimed, so an in-flight download can't 404 mid-stream. 15 minutes is a
 * safe margin over that ceiling.
 */
export const SWEEP_GRACE_MS = 15 * 60 * 1000;

/** Rows reclaimed per run — bounds a single trigger's work (mirrors the webhook sweep). */
export const SWEEP_BATCH = 100;

interface DeletedAttachmentRow {
  id: string;
  storage_path: string;
}

/**
 * §11 attachment sweeper: reclaim the Storage object + row for attachments
 * soft-deleted longer than the grace window ago.
 */
export async function sweepDeletedAttachments(env: Env): Promise<void> {
  const db = getDb(env);
  const cutoff = new Date(Date.now() - SWEEP_GRACE_MS).toISOString();

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
