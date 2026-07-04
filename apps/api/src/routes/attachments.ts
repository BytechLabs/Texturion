/**
 * Attachment routes (SPEC §7; D19 / APP-FEATURES-V2 §2; TASKS.md T1.2/T4).
 *
 *   POST /v1/attachments        M — GENERIC note/task upload (D19). Multipart:
 *        `owner_type` ('note'|'task'), `owner_id`, `file`. Verifies membership
 *        (middleware) + that the owner note/task belongs to the caller's
 *        company; enforces the 25 MB ceiling, the MIME allow-list, and re-checks
 *        content-type FROM THE BYTES (never trusts the client); enforces the
 *        soft per-owner cap of 10. Streams the bytes to the private `attachments`
 *        bucket with the sb_secret_ key, inserts the row, writes a
 *        note_/task_attachment_added event, returns the row (201). This is the
 *        ONLY attachment-upload route — task attachments are `owner_type='task'`
 *        rows here, NOT a task-specific table/route.
 *   GET  /v1/attachments        M — list a single owner's live attachments
 *        (`?owner_type=&owner_id=`), company-scoped, newest-first { data }.
 *   GET  /v1/attachments/:id/url M — mint a short-lived signed Storage URL.
 *        Serves GENERIC (note/task) attachments AND the existing MMS
 *        `message_attachments` (the MMS path is kept intact): the id is looked
 *        up in the generic `attachments` table first, then falls back to
 *        `message_attachments` — one route, three sources (D19: "there is no
 *        /v1/task-attachments/:id/url").
 *
 * The MMS send/ingest path (messaging/media.ts, message_attachments, mms-media
 * bucket) is untouched.
 */
import { Hono } from "hono";

import { requireRole } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import {
  ATTACHMENTS_BUCKET,
  ATTACHMENT_SIGNED_URL_TTL_SECONDS,
  assertAllowedType,
  attachmentStoragePath,
  bytesMatchDeclaredType,
  MAX_ATTACHMENTS_PER_OWNER,
  MAX_ATTACHMENT_BYTES,
  OWNER_TYPES,
  type OwnerType,
} from "./core/attachments";
import {
  insertConversationEvents,
  type ConversationEventRow,
  type ConversationEventType,
} from "./core/events";
import { assertBodyWithinLimit, pathUuid, unwrap } from "./core/http";

const MMS_BUCKET = "mms-media";
const MMS_TTL_SECONDS = 3600;

// Whole-request ceiling for the upload route: one 25 MB file + generous
// multipart overhead. Checked from Content-Length BEFORE formData() buffers
// the body (SPEC §10 DoS posture); the per-file byte check below remains the
// authoritative gate.
const MAX_UPLOAD_BODY_BYTES = MAX_ATTACHMENT_BYTES + 1024 * 1024;

/** Columns the generic attachment row API returns (never storage_path). */
const ATTACHMENT_COLUMNS =
  "id,owner_type,owner_id,conversation_id,file_name,content_type," +
  "size_bytes,created_at";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Db = ReturnType<typeof getDb>;

/**
 * Resolve the owning note/task and its conversation for company-scoped
 * authorization + the denormalized `conversation_id` (D19 §2.1). A note owner
 * is a `messages` row with direction='note'; a task owner is a `tasks` row.
 * Returns null when the owner is missing or outside the company (→ the route
 * 404s, hiding cross-tenant existence).
 */
async function resolveOwner(
  db: Db,
  companyId: string,
  ownerType: OwnerType,
  ownerId: string,
): Promise<{ conversationId: string } | null> {
  if (ownerType === "note") {
    const rows = unwrap<{ conversation_id: string; direction: string }[]>(
      await db
        .from("messages")
        .select("conversation_id,direction")
        .eq("company_id", companyId)
        .eq("id", ownerId)
        .limit(1),
      "note owner lookup",
    );
    const note = rows[0];
    if (!note || note.direction !== "note") return null;
    return { conversationId: note.conversation_id };
  }
  const rows = unwrap<{ conversation_id: string; deleted_at: string | null }[]>(
    await db
      .from("tasks")
      .select("conversation_id,deleted_at")
      .eq("company_id", companyId)
      .eq("id", ownerId)
      .limit(1),
    "task owner lookup",
  );
  const task = rows[0];
  if (!task || task.deleted_at !== null) return null;
  return { conversationId: task.conversation_id };
}

export const attachmentsRoutes = new Hono<AppEnv>();

attachmentsRoutes.post("/attachments", requireRole("member"), async (c) => {
  const companyId = c.get("companyId");
  const userId = c.get("userId");
  const db = getDb(getEnv(c.env));

  // Declared-size gate BEFORE formData() buffers the whole body (§10).
  assertBodyWithinLimit(c, MAX_UPLOAD_BODY_BYTES);

  let form: FormData;
  try {
    form = await c.req.raw.formData();
  } catch {
    throw new ApiError(
      "validation_failed",
      "Request must be multipart/form-data with owner_type, owner_id, and file.",
    );
  }

  const ownerTypeRaw = form.get("owner_type");
  const ownerType = OWNER_TYPES.find((value) => value === ownerTypeRaw);
  if (!ownerType) {
    throw new ApiError(
      "validation_failed",
      `owner_type: must be one of ${OWNER_TYPES.join(", ")}.`,
    );
  }
  const ownerId = form.get("owner_id");
  if (typeof ownerId !== "string" || !uuidPattern.test(ownerId)) {
    throw new ApiError("validation_failed", "owner_id: must be a UUID.");
  }

  const file = form.get("file");
  if (file === null || typeof file === "string") {
    throw new ApiError("validation_failed", "file: missing file field.");
  }
  const blob = file as File;
  const fileName = blob.name || "file";
  const declaredType = blob.type || "application/octet-stream";

  // Type gate BEFORE reading bytes: reject a disallowed declared type early.
  assertAllowedType(declaredType);

  // Owner must exist in the caller's company (D19 §2.3). 404 hides cross-tenant.
  const owner = await resolveOwner(db, companyId, ownerType, ownerId);
  if (!owner) {
    return errorResponse(c, "not_found", "No such note or task.");
  }

  // Soft per-owner cap of 10 (D19 §2.4) — count live rows first.
  const existing = unwrap<{ id: string }[]>(
    await db
      .from("attachments")
      .select("id")
      .eq("company_id", companyId)
      .eq("owner_type", ownerType)
      .eq("owner_id", ownerId)
      .is("deleted_at", null),
    "attachment count",
  );
  if (existing.length >= MAX_ATTACHMENTS_PER_OWNER) {
    throw new ApiError(
      "validation_failed",
      `owner: at most ${MAX_ATTACHMENTS_PER_OWNER} attachments per ${ownerType}.`,
    );
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new ApiError("validation_failed", "file: is empty.");
  }
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new ApiError(
      "validation_failed",
      `file: exceeds the ${MAX_ATTACHMENT_BYTES}-byte limit.`,
    );
  }
  // Re-validate the type from the bytes (D19 §2.3) — the client-declared type
  // is advisory; a mismatch (e.g. an .exe renamed .pdf) is rejected here.
  if (!bytesMatchDeclaredType(bytes, declaredType)) {
    throw new ApiError(
      "validation_failed",
      "file: content does not match its declared type.",
    );
  }

  const objectPath = attachmentStoragePath({
    companyId,
    ownerType,
    ownerId,
    uuid: crypto.randomUUID(),
    fileName,
  });

  const upload = await db.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(objectPath, bytes.slice().buffer, {
      contentType: declaredType,
      upsert: false, // a fresh uuid per upload — never overwrite
    });
  if (upload.error) {
    throw new Error(`attachment upload failed (${objectPath}): ${upload.error.message}`);
  }

  const inserted = unwrap<Record<string, unknown>[]>(
    await db
      .from("attachments")
      .insert({
        company_id: companyId,
        owner_type: ownerType,
        owner_id: ownerId,
        conversation_id: owner.conversationId,
        storage_path: objectPath,
        file_name: fileName,
        content_type: declaredType,
        size_bytes: bytes.byteLength,
        uploaded_by_user_id: userId,
      })
      .select(ATTACHMENT_COLUMNS),
    "attachment insert",
  );
  const row = inserted[0];
  if (!row) throw new Error("attachment insert returned no row");

  // D22: attachment lifecycle audited on the owner's conversation.
  const addedType: ConversationEventType =
    ownerType === "note" ? "note_attachment_added" : "task_attachment_added";
  const event: ConversationEventRow = {
    company_id: companyId,
    conversation_id: owner.conversationId,
    actor_user_id: userId,
    type: addedType,
    payload: { attachment_id: row.id, file_name: fileName },
  };
  await insertConversationEvents(db, [event]);

  return c.json(row, 201);
});

/**
 * DELETE /v1/attachments/:id (D19) — soft-delete a live note/task attachment:
 * stamp `deleted_at` on the row and audit a note_/task_attachment_removed event.
 * The Storage object is NOT removed here — the D19 sweep cron
 * (sweepDeletedAttachments) hard-deletes the object + row after a grace window,
 * so an in-flight signed URL can't 404 mid-download and the removal is
 * idempotent under retries. Company-scoped (§10): an id outside the caller's
 * company (or already deleted) is `not_found`.
 */
attachmentsRoutes.delete("/attachments/:id", requireRole("member"), async (c) => {
  const id = pathUuid(c, "id");
  const companyId = c.get("companyId");
  const userId = c.get("userId");
  const db = getDb(getEnv(c.env));

  // Soft-delete only a still-live row we own; RETURNING tells us it existed.
  const deleted = unwrap<
    { id: string; owner_type: OwnerType; conversation_id: string; file_name: string }[]
  >(
    await db
      .from("attachments")
      .update({ deleted_at: new Date().toISOString() })
      .eq("company_id", companyId)
      .eq("id", id)
      .is("deleted_at", null)
      .select("id,owner_type,conversation_id,file_name"),
    "attachment soft-delete",
  );
  const row = deleted[0];
  if (!row) return errorResponse(c, "not_found", "No such attachment.");

  const removedType: ConversationEventType =
    row.owner_type === "note"
      ? "note_attachment_removed"
      : "task_attachment_removed";
  const event: ConversationEventRow = {
    company_id: companyId,
    conversation_id: row.conversation_id,
    actor_user_id: userId,
    type: removedType,
    payload: { attachment_id: row.id, file_name: row.file_name },
  };
  await insertConversationEvents(db, [event]);

  return c.body(null, 204);
});

attachmentsRoutes.get("/attachments", requireRole("member"), async (c) => {
  const companyId = c.get("companyId");
  const ownerTypeRaw = c.req.query("owner_type");
  const ownerType = OWNER_TYPES.find((value) => value === ownerTypeRaw);
  if (!ownerType) {
    throw new ApiError(
      "validation_failed",
      `owner_type: must be one of ${OWNER_TYPES.join(", ")}.`,
    );
  }
  const ownerId = c.req.query("owner_id");
  if (ownerId === undefined || !uuidPattern.test(ownerId)) {
    throw new ApiError("validation_failed", "owner_id: must be a UUID.");
  }

  const db = getDb(getEnv(c.env));
  const rows = unwrap<Record<string, unknown>[]>(
    await db
      .from("attachments")
      .select(ATTACHMENT_COLUMNS)
      .eq("company_id", companyId)
      .eq("owner_type", ownerType)
      .eq("owner_id", ownerId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
    "attachment list",
  );
  return c.json({ data: rows });
});

attachmentsRoutes.get(
  "/attachments/:id/url",
  requireRole("member"),
  async (c) => {
    const id = pathUuid(c, "id");
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));

    // Generic (note/task) arm first — the D19 table. Only live rows.
    const generic = unwrap<{ storage_path: string }[]>(
      await db
        .from("attachments")
        .select("storage_path")
        .eq("company_id", companyId)
        .eq("id", id)
        .is("deleted_at", null)
        .limit(1),
      "generic attachment lookup",
    );
    if (generic[0]) {
      return c.json(await signObject(db, ATTACHMENTS_BUCKET, generic[0].storage_path, ATTACHMENT_SIGNED_URL_TTL_SECONDS));
    }

    // Fall back to the MMS arm (message_attachments / mms-media) — kept intact.
    // company_id lives on message_attachments so no join is needed.
    const mms = unwrap<{ storage_path: string }[]>(
      await db
        .from("message_attachments")
        .select("storage_path")
        .eq("company_id", companyId)
        .eq("id", id)
        .limit(1),
      "mms attachment lookup",
    );
    if (mms[0]) {
      // storage_path may carry the legacy `mms-media/` prefix (SPEC §6) — strip it.
      const objectPath = mms[0].storage_path.replace(/^mms-media\//, "");
      return c.json(await signObject(db, MMS_BUCKET, objectPath, MMS_TTL_SECONDS));
    }

    return errorResponse(c, "not_found", "No such attachment.");
  },
);

/** Mint one short-lived signed Storage URL and its expiry (D19 §2.5 / §7). */
async function signObject(
  db: Db,
  bucket: string,
  objectPath: string,
  ttlSeconds: number,
): Promise<{ url: string; expires_at: string }> {
  const { data, error } = await db.storage
    .from(bucket)
    .createSignedUrl(objectPath, ttlSeconds);
  if (error || !data?.signedUrl) {
    throw new Error(
      `signed URL mint failed (${bucket}/${objectPath}): ${error?.message ?? "no data"}`,
    );
  }
  return {
    url: data.signedUrl,
    expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  };
}
