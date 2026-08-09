/**
 * Attachment routes (SPEC §7; D19 / D28 / D30; APP-FEATURES-V2 §2).
 *
 *   POST /v1/attachments        M — GENERIC upload, NOTES-ONLY (D28: files
 *        enter through messages and notes only — the standalone task ingress
 *        is removed; `owner_type='task'` is a 422 with plain copy pointing at
 *        the task's notes). Multipart: `owner_type` ('note'), `owner_id`,
 *        `file`. Verifies membership (middleware) + that the owner note
 *        belongs to the caller's company; enforces the 25 MB ceiling, the
 *        MIME allow-list, and re-checks content-type FROM THE BYTES (never
 *        trusts the client); enforces the soft per-owner cap of 10. Atomically
 *        claims the D30 company-wide storage budget FIRST
 *        (claim_attachment_storage: a per-company advisory-lock re-sum + insert
 *        vs the plan's 5/25 GB) — the claim is the sole budget authority (no
 *        check-then-write TOCTOU). Over budget → 409 `conflict` with NOTHING
 *        written anywhere (#15: a rejected upload can never orphan a Storage
 *        object). Only an allowed claim streams the bytes to the private
 *        `attachments` bucket with the sb_secret_ key; an upload failure
 *        releases the claimed row (and the #15 sweep passes reclaim any crash
 *        window). On success writes a note_attachment_added event and returns
 *        the row (201).
 *   GET  /v1/attachments        M — list a single owner's live attachments
 *        (`?owner_type=&owner_id=`, note OR task — legacy task rows keep
 *        reading), company-scoped { data }.
 *   GET  /v1/attachments/:id/url M — mint a short-lived signed Storage URL.
 *        Serves GENERIC (note/legacy-task) attachments AND the existing MMS
 *        `message_attachments` (the MMS path is kept intact): the id is looked
 *        up in the generic `attachments` table first, then falls back to
 *        `message_attachments` — one route, three sources (D19: "there is no
 *        /v1/task-attachments/:id/url"). Every mint atomically claims the
 *        object's size_bytes against the company's #16 monthly egress
 *        allowance (attachments/egress.ts) BEFORE signing — over the allowance
 *        → 402 `usage_cap_reached`; a claim error mints nothing (fail closed).
 *   DELETE /v1/attachments/:id  M — soft-delete a live generic row (note or
 *        legacy task — D28 keeps the delete door open so space can be freed).
 *
 * The MMS send/ingest path (messaging/media.ts, message_attachments, mms-media
 * bucket) is untouched. Inbound MMS is NEVER blocked on the D30 budget — it is
 * bounded per message instead (messaging/media.ts MAX_INBOUND_MEDIA_ITEMS).
 */
import { Hono, type Context } from "hono";
import { z } from "zod";

import {
  assertEgressWithinAllowance,
  assertMintRateWithinLimit,
} from "../attachments/egress";
import {
  MAX_PREVIEW_BYTES,
  acceptUploadedPreview,
  parseContentTwin,
  previewStoragePath,
  sha256Hex,
} from "../attachments/preview";
import { stripImageLocation } from "../attachments/location";
import { scanAttachment } from "../attachments/scan";
import { requireCapability } from "../auth/company";
import {
  requireConversationAccess,
  resolveNumberAccess,
} from "../auth/number-access";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { recordAuditFromRequest } from "../audit/log";
import { ApiError, errorResponse } from "../http/errors";
import { dispositionOptions } from "../storage/disposition";
import {
  ATTACHMENTS_BUCKET,
  ATTACHMENT_SIGNED_URL_TTL_SECONDS,
  assertAllowedType,
  attachmentStoragePath,
  bytesMatchDeclaredType,
  MAX_ATTACHMENTS_PER_OWNER,
  MAX_ATTACHMENT_BYTES,
  OWNER_TYPES,
  UPLOAD_OWNER_TYPES,
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
// #240: the preview rides the same multipart body, so the envelope has to
// have room for it on top of the original and the form's own overhead.
const MAX_UPLOAD_BODY_BYTES =
  MAX_ATTACHMENT_BYTES + MAX_PREVIEW_BYTES + 1024 * 1024;

/** Columns the generic attachment row API returns (never storage_path). */
const ATTACHMENT_COLUMNS =
  "id,owner_type,owner_id,conversation_id,file_name,content_type," +
  "size_bytes,created_at";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Db = ReturnType<typeof getDb>;

/**
 * Resolve the owning note and its conversation for company-scoped
 * authorization + the denormalized `conversation_id` (D19 §2.1). A note owner
 * is a `messages` row with direction='note' — the only upload owner left
 * after D28. Returns null when the owner is missing or outside the company
 * (→ the route 404s, hiding cross-tenant existence).
 */
async function resolveNoteOwner(
  db: Db,
  companyId: string,
  noteId: string,
): Promise<{ conversationId: string } | null> {
  const rows = unwrap<{ conversation_id: string; direction: string }[]>(
    await db
      .from("messages")
      .select("conversation_id,direction")
      .eq("company_id", companyId)
      .eq("id", noteId)
      .limit(1),
    "note owner lookup",
  );
  const note = rows[0];
  if (!note || note.direction !== "note") return null;
  return { conversationId: note.conversation_id };
}



/**
 * Shape of the claim_attachment_storage RPC result (the D30 atomic budget
 * claim, 20260704030000_attach_fixes.sql): `allowed` plus the inserted row when
 * it fit. The route maps allowed=false to the §7 409 conflict.
 */
const storageClaimSchema = z.object({
  allowed: z.boolean(),
  attachment: z.record(z.string(), z.unknown()).nullable().optional(),
});

/** Parse a claim_attachment_storage jsonb result (garbage → 500). */
function parseStorageClaim(data: unknown): z.infer<typeof storageClaimSchema> {
  const result = storageClaimSchema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `claim_attachment_storage returned an unexpected shape: ${result.error}`,
    );
  }
  return result.data;
}

/**
 * #317: the response when a reported file is asked for.
 *
 * `forbidden`, not `not_found`. The file plainly exists — the crew can see it
 * in the gallery — and a 404 would read as "we lost your photo", sending
 * somebody to look for a bug instead of telling them what happened. SPEC §7
 * fixes the code set at ten, so this is the honest member of it.
 */
function quarantined(c: Context) {
  return errorResponse(
    c,
    "forbidden",
    "Someone on your team reported this file, so it's on hold. An owner or " +
      "admin can release it.",
  );
}

interface ResolvedAttachment {
  table: "attachments" | "message_attachments";
  quarantinedAt: string | null;
  conversationId: string | null;
  messageId: string | null;
}

/**
 * Find one attachment by id across BOTH tables, the way the mint route does.
 *
 * The two arms exist because a file can arrive two ways — uploaded to a note,
 * or texted in by a customer — and #317 is about the second at least as much
 * as the first. Somebody reporting a file has an id and no idea which table it
 * came from, and should not have to.
 */
async function resolveAttachment(
  db: Db,
  companyId: string,
  id: string,
): Promise<ResolvedAttachment | null> {
  const generic = unwrap<
    { conversation_id: string | null; quarantined_at: string | null }[]
  >(
    await db
      .from("attachments")
      .select("conversation_id,quarantined_at")
      .eq("company_id", companyId)
      .eq("id", id)
      .is("deleted_at", null)
      .limit(1),
    "attachment quarantine lookup",
  );
  if (generic[0]) {
    return {
      table: "attachments",
      quarantinedAt: generic[0].quarantined_at,
      conversationId: generic[0].conversation_id,
      messageId: null,
    };
  }
  const mms = unwrap<{ message_id: string; quarantined_at: string | null }[]>(
    await db
      .from("message_attachments")
      .select("message_id,quarantined_at")
      .eq("company_id", companyId)
      .eq("id", id)
      .limit(1),
    "mms quarantine lookup",
  );
  if (mms[0]) {
    return {
      table: "message_attachments",
      quarantinedAt: mms[0].quarantined_at,
      conversationId: null,
      messageId: mms[0].message_id,
    };
  }
  return null;
}

const reportSchema = z.object({
  /**
   * The reporter's own words, for whoever decides whether to release it.
   * Optional because the report has to be one tap — a required field is how a
   * safety control becomes something people do not bother with.
   */
  note: z.string().trim().max(280).optional(),
});

export const attachmentsRoutes = new Hono<AppEnv>();

/**
 * POST /v1/attachments/:id/report — a member pulls a file back for EVERYONE.
 *
 * The scan (D101) stops what it can recognise and is explicitly not antivirus.
 * When something gets past it, the person who notices is a tech looking at a
 * file that does not smell right, and the only useful thing they can do has to
 * affect the whole workspace: by then it is in the office manager's inbox too.
 *
 * ANY MEMBER, deliberately. This is the fire alarm. Behind owner-only it would
 * mean the person who spotted the problem cannot stop it, which is how you get
 * somebody opening the file to "check" while they wait. It destroys nothing, an
 * owner can reverse it, and both directions are audited.
 */
attachmentsRoutes.post(
  "/attachments/:id/report",
  requireCapability("conversations.note"),
  async (c) => {
    const id = pathUuid(c, "id");
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));

    const raw = await c.req.json().catch(() => ({}));
    const parsed = reportSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      throw new ApiError("validation_failed", "note: 280 characters at most.");
    }

    const found = await resolveAttachment(db, companyId, id);
    if (!found) return errorResponse(c, "not_found", "No such attachment.");

    // #106: this reads and mutates a file on a conversation, so the
    // number-access gate applies exactly as it does to the mint. Without it a
    // member with no access to a number could quarantine its files by id.
    if (found.conversationId) {
      await assertConversationVisible(db, c, found.conversationId);
    } else if (found.messageId) {
      await assertMmsVisible(db, c, found.messageId);
    }

    // Idempotent. Two techs flagging the same file within a minute of each
    // other is the NORMAL case, and the second one must not get an error for
    // doing the right thing.
    if (!found.quarantinedAt) {
      const stamped = unwrap<{ id: string }[]>(
        await db
          .from(found.table)
          .update({
            quarantined_at: new Date().toISOString(),
            quarantined_by_user_id: c.get("userId"),
            quarantine_note: parsed.data.note ?? null,
          })
          .eq("company_id", companyId)
          .eq("id", id)
          .is("quarantined_at", null)
          .select("id"),
        "attachment quarantine",
      );
      // Losing that race means somebody else quarantined it first, which is
      // the outcome we wanted anyway.
      if (stamped[0]) {
        await recordAuditFromRequest(db, c, {
          companyId,
          action: "attachment.quarantined",
          targetType: "attachment",
          targetId: id,
          after: { table: found.table, note: parsed.data.note ?? null },
        });
      }
    }

    return c.json({ id, quarantined: true });
  },
);

/**
 * POST /v1/attachments/:id/release — an owner or admin decides it was fine.
 *
 * Admin, unlike reporting, and the asymmetry is the point: raising the alarm
 * has to be available to whoever is holding the phone; standing it down is a
 * judgement about risk that belongs with whoever answers for it.
 */
attachmentsRoutes.post(
  "/attachments/:id/release",
  requireCapability("settings.manage"),
  async (c) => {
    const id = pathUuid(c, "id");
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));

    const found = await resolveAttachment(db, companyId, id);
    if (!found) return errorResponse(c, "not_found", "No such attachment.");
    if (found.conversationId) {
      await assertConversationVisible(db, c, found.conversationId);
    } else if (found.messageId) {
      await assertMmsVisible(db, c, found.messageId);
    }

    if (found.quarantinedAt) {
      const cleared = unwrap<{ id: string }[]>(
        await db
          .from(found.table)
          .update({
            quarantined_at: null,
            quarantined_by_user_id: null,
            quarantine_note: null,
          })
          .eq("company_id", companyId)
          .eq("id", id)
          .not("quarantined_at", "is", null)
          .select("id"),
        "attachment release",
      );
      if (cleared[0]) {
        await recordAuditFromRequest(db, c, {
          companyId,
          action: "attachment.released",
          targetType: "attachment",
          targetId: id,
          before: { table: found.table, quarantined_at: found.quarantinedAt },
        });
      }
    }

    return c.json({ id, quarantined: false });
  },
);

attachmentsRoutes.post("/attachments", requireCapability("conversations.note"), async (c) => {
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
  const ownerType = UPLOAD_OWNER_TYPES.find((value) => value === ownerTypeRaw);
  if (!ownerType) {
    // D28: the standalone task ingress is gone — plain copy points at the two
    // remaining doors. Existing task-owned rows still read/serve/delete.
    if (ownerTypeRaw === "task") {
      throw new ApiError(
        "validation_failed",
        "owner_type: files can't be uploaded to a task anymore — attach them to a note in the task's discussion instead.",
      );
    }
    throw new ApiError(
      "validation_failed",
      `owner_type: must be ${UPLOAD_OWNER_TYPES.join(", ")}.`,
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
  const owner = await resolveNoteOwner(db, companyId, ownerId);
  if (!owner) {
    return errorResponse(c, "not_found", "No such note.");
  }

  // #106: uploading to a note is a note-level action — a member with no access
  // to the owning conversation's number gets the same 404 as a missing note.
  await requireConversationAccess(db, {
    companyId,
    userId,
    role: c.get("role"),
    conversationId: owner.conversationId,
    need: "note",
  });

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

  // #317 — the check above proves the file IS what it says. This one looks at
  // what is INSIDE it, which is a different question and the one the allow-list
  // cannot answer: PDF and the OpenXML/ODF family are on it precisely because
  // people need them, and they are also the formats that carry payloads.
  //
  // Outbound matters as much as inbound here. A compromised member account
  // (#314) can send files to every customer in the workspace from a number
  // those customers trust, and refusing at upload means the object never exists
  // to be sent. The uploader is a person who is right here, so they get the
  // reason and can act on it — unlike the inbound path, where the sender is a
  // stranger and the crew gets a timeline line instead.
  const scan = scanAttachment(bytes, declaredType);
  if (scan.verdict !== "clean") {
    throw new ApiError("validation_failed", `file: ${scan.message}`);
  }

  // #240: the bounded preview the uploader generated, if it sent one.
  //
  // Validated BEFORE the CLAIM, not merely before the upload: the claim
  // inserts the row, so a 422 raised after it would leave a ghost — a row
  // holding accounting for bytes that never landed, waiting on the #15 sweep.
  // A bad preview costs a 422 and nothing else. It is a
  // client-supplied file and gets every gate the original got — the type check, the
  // magic bytes, the size bounds, the malware scan here, and the location strip
  // below. See attachments/preview.ts for why "it is just the same image, smaller"
  // is not something this Worker can know.
  //
  // That sentence was true of everything except the strip for as long as previews
  // have existed (#581/13). Listing the gates rather than claiming "every" one, so
  // the next gate added to the original has somewhere obvious to be missing from.
  const previewField = form.get("preview");
  let preview: { bytes: Uint8Array; contentType: string } | null = null;
  if (previewField !== null && typeof previewField !== "string") {
    const previewBlob = previewField as File;
    preview = {
      bytes: new Uint8Array(await previewBlob.arrayBuffer()),
      contentType: previewBlob.type || "application/octet-stream",
    };
    acceptUploadedPreview(preview, { sizeBytes: bytes.byteLength });
  }

  // #294 / D128 — the customer's home coordinates never reach the bucket.
  //
  // Before the hash, deliberately: two techs photographing the same panel from the
  // same spot produce files that differ only in their GPS timestamps, and hashing
  // first would store both. After the scan, equally deliberately: this rewrites
  // bytes, and it must never run on a file we were going to refuse.
  stripImageLocation(bytes, declaredType);
  // The PREVIEW is stripped too, inside `acceptUploadedPreview` above. #581/13: it
  // was not, so the derivative went to the bucket carrying the coordinates the
  // original had just had removed — and #581/9 had made that derivative the object
  // the PUBLIC photos page serves. It lives in that function rather than as a second
  // call here because two calls a caller has to remember are one a caller can
  // half-remember, which is precisely what happened.

  // #240 item 3 — the same file, stored once.
  //
  // "A 25 MB file forwarded into three threads is 75 MB." Hashed here rather
  // than anywhere later because this is the only moment the bytes are in hand;
  // a hash added afterwards means re-reading every object in the bucket, which
  // is the one thing in this product guaranteed to get large.
  //
  // Company-scoped, always. Cross-tenant sharing would save more and would have
  // one workspace's row serving bytes another uploaded — a bug near the
  // reference counting would then be a data leak rather than a broken image.
  const contentSha256 = await sha256Hex(bytes);
  const { data: twinData, error: twinError } = await db.rpc(
    "api_attachment_by_content",
    { p_company_id: companyId, p_sha256: contentSha256 },
  );
  if (twinError) {
    throw new Error(`attachment content lookup failed: ${twinError.message}`);
  }
  const twin = parseContentTwin(twinData);

  const objectPath = twin?.storage_path ?? attachmentStoragePath({
    companyId,
    ownerType,
    ownerId,
    uuid: crypto.randomUUID(),
    fileName,
  });

  // Claim (account) the row FIRST, then upload (#15 — the reverse ordering
  // left crash-window orphans). #121: storage is FREE, so the claim carries
  // an unbounded budget and can never reject — the RPC is kept for its atomic
  // row-insert + accounting (the abuse-alert cron reads the same sums), and a
  // later cleanup migration may drop its gate entirely. An upload failure
  // still releases the claimed row below, and the #15 sweep passes
  // (sweepDeletedAttachments) garbage-collect any crash window in between.
  const { data: claimData, error: claimError } = await db.rpc(
    "claim_attachment_storage",
    {
      p_company_id: companyId,
      p_owner_type: ownerType,
      p_owner_id: ownerId,
      p_conversation_id: owner.conversationId,
      p_storage_path: objectPath,
      p_file_name: fileName,
      p_content_type: declaredType,
      p_size_bytes: bytes.byteLength,
      p_uploaded_by: userId,
      // #121: unbounded — storage never blocks. Number.MAX_SAFE_INTEGER
      // comfortably exceeds any real sum(size_bytes).
      p_budget_bytes: Number.MAX_SAFE_INTEGER,
    },
  );
  if (claimError) {
    throw new Error(`claim_attachment_storage failed: ${claimError.message}`);
  }
  const claim = parseStorageClaim(claimData);
  if (!claim.allowed) {
    // #121: impossible with the unbounded budget above — treat as internal.
    throw new Error("claim_attachment_storage rejected an unbounded budget");
  }
  if (!claim.attachment) throw new Error("claim_attachment_storage returned no row");

  // #240: nothing to upload when the bytes are already here. The row is real
  // and separate — its own id, owner, name and audit trail — it simply points
  // at an object that already exists, and the sweep's in-use check is what
  // keeps the other row from taking it away.
  const upload = twin
    ? { error: null }
    : await db.storage
        .from(ATTACHMENTS_BUCKET)
        .upload(objectPath, bytes.slice().buffer, {
          contentType: declaredType,
          upsert: false, // a fresh uuid per upload — never overwrite
        });
  if (upload.error) {
    // Release the claim: the row must not hold D30 budget for bytes that never
    // landed. A failed release is reclaimed by the ghost-row sweep pass (#15),
    // so this is best-effort — the upload error is what surfaces either way.
    const release = await db
      .from("attachments")
      .delete()
      .eq("company_id", companyId)
      .eq("id", claim.attachment.id as string);
    if (release.error) {
      console.error(
        `attachment claim release failed (${objectPath}): ${release.error.message}`,
      );
    }
    throw new Error(`attachment upload failed (${objectPath}): ${upload.error.message}`);
  }
  // #240: the preview lands second and is allowed to fail.
  //
  // The original is the file; the preview is a way of serving it cheaply. A
  // storage hiccup on the derivative must not cost somebody the upload they
  // actually made, so a failure here leaves `preview_path` null and the row
  // serves its original — which is exactly what every row did before this
  // shipped. The object is swept as an orphan if it half-landed.
  let previewPath: string | null = twin?.preview_path ?? null;
  // #240: a shared object shares its preview. Reusing the original and
  // uploading a second preview beside it would store one file twice as far as
  // the thread is concerned, which is the bug this is meant to fix wearing a
  // different hat.
  if (twin) {
    const stamp = await db
      .from("attachments")
      .update({
        content_sha256: contentSha256,
        preview_path: twin.preview_path,
        preview_bytes: twin.preview_bytes,
      })
      .eq("company_id", companyId)
      .eq("id", claim.attachment.id as string);
    if (stamp.error) {
      // The row still points at a real object; it has simply lost its preview
      // and its place in the dedup index. It serves its original, like every
      // row did before this shipped.
      console.error(
        `attachment dedup stamp failed (${objectPath}): ${stamp.error.message}`,
      );
      previewPath = null;
    }
  } else if (preview) {
    const target = previewStoragePath(objectPath);
    const previewUpload = await db.storage
      .from(ATTACHMENTS_BUCKET)
      .upload(target, preview.bytes.slice().buffer, {
        contentType: preview.contentType,
        upsert: false,
      });
    if (previewUpload.error) {
      console.error(
        `attachment preview upload failed (${target}): ${previewUpload.error.message}`,
      );
    } else {
      const stamp = await db
        .from("attachments")
        .update({
          preview_path: target,
          preview_bytes: preview.bytes.byteLength,
          content_sha256: contentSha256,
        })
        .eq("company_id", companyId)
        .eq("id", claim.attachment.id as string);
      if (stamp.error) {
        console.error(
          `attachment preview stamp failed (${target}): ${stamp.error.message}`,
        );
      } else {
        previewPath = target;
      }
    }
  } else {
    // No preview to store, but the hash still has to land or this file can
    // never be the twin of the next upload.
    const stamp = await db
      .from("attachments")
      .update({ content_sha256: contentSha256 })
      .eq("company_id", companyId)
      .eq("id", claim.attachment.id as string);
    if (stamp.error) {
      console.error(
        `attachment hash stamp failed (${objectPath}): ${stamp.error.message}`,
      );
    }
  }

  // The RPC returns the FULL row (to_jsonb) — project to the API shape so
  // storage_path (and other internal columns) never leak in the response.
  const full = claim.attachment;
  const row = {
    id: full.id,
    owner_type: full.owner_type,
    owner_id: full.owner_id,
    conversation_id: full.conversation_id,
    file_name: full.file_name,
    content_type: full.content_type,
    size_bytes: full.size_bytes,
    created_at: full.created_at,
    // #240: whether a preview exists, never where it lives — the path is an
    // internal column like storage_path, and the client's only question is
    // which variant to ask the /url route for.
    has_preview: previewPath !== null,
  } as Record<string, unknown>;

  // D22: attachment lifecycle audited on the owner's conversation. Upload is
  // notes-only (D28), so the added event is always the note flavor;
  // task_attachment_added survives only in old rows' history.
  const event: ConversationEventRow = {
    company_id: companyId,
    conversation_id: owner.conversationId,
    actor_user_id: userId,
    type: "note_attachment_added",
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
attachmentsRoutes.delete("/attachments/:id", requireCapability("conversations.note"), async (c) => {
  const id = pathUuid(c, "id");
  const companyId = c.get("companyId");
  const userId = c.get("userId");
  const db = getDb(getEnv(c.env));

  // Resolve the still-live row we own FIRST so the #106 number-access gate runs
  // BEFORE any mutation. owner_id is selected so a legacy task-owned removal can
  // carry task_id in the event payload (the task drawer's activity feed keys on
  // payload->>task_id).
  const live = unwrap<
    {
      id: string;
      owner_type: OwnerType;
      owner_id: string;
      conversation_id: string;
      file_name: string;
    }[]
  >(
    await db
      .from("attachments")
      .select("id,owner_type,owner_id,conversation_id,file_name")
      .eq("company_id", companyId)
      .eq("id", id)
      .is("deleted_at", null)
      .limit(1),
    "attachment lookup",
  );
  const row = live[0];
  if (!row) return errorResponse(c, "not_found", "No such attachment.");

  // #106: deleting an attachment is a note-level action on its conversation —
  // a member with no access to the owning number gets the same not_found the
  // GET/POST siblings return, instead of being able to blind-delete by id.
  await requireConversationAccess(db, {
    companyId,
    userId,
    role: c.get("role"),
    conversationId: row.conversation_id,
    need: "note",
  });

  // Soft-delete only if still live; RETURNING confirms we won the race (a
  // concurrent delete that already stamped it → not_found, idempotent).
  const deleted = unwrap<{ id: string }[]>(
    await db
      .from("attachments")
      .update({ deleted_at: new Date().toISOString() })
      .eq("company_id", companyId)
      .eq("id", id)
      .is("deleted_at", null)
      .select("id"),
    "attachment soft-delete",
  );
  if (!deleted[0]) return errorResponse(c, "not_found", "No such attachment.");

  const removedType: ConversationEventType =
    row.owner_type === "note"
      ? "note_attachment_removed"
      : "task_attachment_removed";
  // A task-owned removal (legacy rows — D28 stopped creating them but kept the
  // delete door open) carries task_id so loadTaskActivity's task_attachment_removed
  // arm — which filters on payload->>task_id — surfaces the deletion in the task
  // drawer's activity feed. For a note, owner_id is a message id (no task_id key).
  const payload: Record<string, unknown> = {
    attachment_id: row.id,
    file_name: row.file_name,
  };
  if (row.owner_type === "task") payload.task_id = row.owner_id;
  const event: ConversationEventRow = {
    company_id: companyId,
    conversation_id: row.conversation_id,
    actor_user_id: userId,
    type: removedType,
    payload,
  };
  await insertConversationEvents(db, [event]);

  return c.body(null, 204);
});

attachmentsRoutes.get("/attachments", requireCapability("conversations.read"), async (c) => {
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
  // #106: an owner's attachments all share one conversation — if that number is
  // hidden from the caller, so is the list (404, indistinguishable from empty).
  // Zero rows leak nothing, so the check only runs when there's something to
  // hide.
  const conversationId = rows[0]?.conversation_id;
  if (typeof conversationId === "string") {
    await requireConversationAccess(db, {
      companyId,
      userId: c.get("userId"),
      role: c.get("role"),
      conversationId,
      need: "read",
    });
  }
  return c.json({ data: rows });
});

attachmentsRoutes.get(
  "/attachments/:id/url",
  requireCapability("conversations.read"),
  async (c) => {
    const id = pathUuid(c, "id");
    const companyId = c.get("companyId");
    const env = getEnv(c.env);
    const db = getDb(env);

    // #261: bound the mint RATE before doing any work for it.
    await assertMintRateWithinLimit(env, companyId, c.get("userId"));

    // #240: which of a row's two objects to sign.
    //
    // The DEFAULT is the preview, and that is the whole point — a thread and a
    // gallery are the callers that render a hundred of these and neither needs
    // the original. `?variant=original` is what a full-size view or a download
    // asks for, so serving the expensive one is a deliberate act by a caller
    // that knows it wants the file rather than a picture of it.
    //
    // Defaulting the other way would have been the safer-looking choice and the
    // wrong one: every existing client would have kept fetching originals and
    // the feature would have shipped inert.
    const wantsOriginal = c.req.query("variant") === "original";

    // Generic (note/task) arm first — the D19 table. Only live rows.
    const generic = unwrap<
      {
        storage_path: string;
        size_bytes: number | null;
        preview_path: string | null;
        preview_bytes: number | null;
        conversation_id: string | null;
        content_type: string | null;
        quarantined_at: string | null;
      }[]
    >(
      await db
        .from("attachments")
        .select(
          "storage_path,size_bytes,preview_path,preview_bytes,conversation_id,content_type,quarantined_at",
        )
        .eq("company_id", companyId)
        .eq("id", id)
        .is("deleted_at", null)
        .limit(1),
      "generic attachment lookup",
    );
    if (generic[0]) {
      // #317: a reported file stops downloading for EVERYONE. The mint is the
      // right place for that because every download in this product goes
      // through one — there is no side door — and mints are short-lived (D19
      // §2.5), so the window on any URL already in flight closes on its own.
      if (generic[0].quarantined_at) return quarantined(c);
      // #106: gate the mint on access to the owning conversation's number —
      // a signed URL is the whole payload, so a hidden number must 404 here.
      await assertConversationVisible(db, c, generic[0].conversation_id);
      // #240: a row with no preview serves its original, which is what every
      // row did before this shipped — nothing uploaded earlier, and nothing
      // uploaded by a client that does not make one, stops working.
      //
      // `?? null` rather than a bare `!== null`: PostgREST omits a column
      // entirely when it has nothing to say about it, so the row arrives with
      // `preview_path` UNDEFINED rather than null — and `undefined !== null` is
      // true, which would sign the string "undefined" as an object key.
      const previewPath = generic[0].preview_path ?? null;
      const servePreview = !wantsOriginal && previewPath !== null;
      const servedPath = servePreview ? previewPath : generic[0].storage_path;
      // The egress claim charges what is actually SERVED. Claiming the
      // original's size for a 200 KB preview would spend a workspace's
      // allowance on bytes that never left, which is the opposite of the point.
      const servedBytes = servePreview
        ? (generic[0].preview_bytes ?? null)
        : generic[0].size_bytes;
      // #16: claim the egress BEFORE signing — over the allowance, no URL.
      await assertEgressWithinAllowance(
        db,
        companyId,
        [
          {
            bucket: ATTACHMENTS_BUCKET,
            path: servedPath,
            sizeBytes: servedBytes,
          },
        ],
        ATTACHMENT_SIGNED_URL_TTL_SECONDS,
      );
      return c.json({
        ...(await signObject(
          db,
          ATTACHMENTS_BUCKET,
          servedPath,
          ATTACHMENT_SIGNED_URL_TTL_SECONDS,
          generic[0].content_type,
        )),
        // Said out loud so a client rendering a lightbox knows whether it is
        // already holding the full-size bytes or needs a second mint.
        variant: servePreview ? "preview" : "original",
      });
    }

    // Fall back to the MMS arm (message_attachments / mms-media) — kept intact.
    // company_id lives on message_attachments so no join is needed; message_id
    // gets us to the conversation for the #106 gate.
    const mms = unwrap<
      {
        storage_path: string;
        size_bytes: number | null;
        message_id: string;
        content_type: string | null;
        quarantined_at: string | null;
      }[]
    >(
      await db
        .from("message_attachments")
        .select("storage_path,size_bytes,message_id,content_type,quarantined_at")
        .eq("company_id", companyId)
        .eq("id", id)
        .limit(1),
      "mms attachment lookup",
    );
    if (mms[0]) {
      if (mms[0].quarantined_at) return quarantined(c);
      // #106: an MMS image on a hidden number must not be signable. Resolve the
      // media's conversation (message → conversation) only when the caller is
      // actually restricted — unrestricted callers skip the extra lookup.
      await assertMmsVisible(db, c, mms[0].message_id);
      // storage_path may carry the legacy `mms-media/` prefix (SPEC §6) — strip it.
      const objectPath = mms[0].storage_path.replace(/^mms-media\//, "");
      // #16: MMS media downloads draw on the same per-company egress pool.
      // Claim on the STRIPED path, which is what the gallery claims on too —
      // the same object must not be charged twice under two spellings (#261).
      await assertEgressWithinAllowance(
        db,
        companyId,
        [{ bucket: MMS_BUCKET, path: objectPath, sizeBytes: mms[0].size_bytes }],
        MMS_TTL_SECONDS,
      );
      // #240: MMS media has no derivative and does not need one. Every
      // inbound item is already ≤1 MB by carrier limit (D28), which is the
      // founder's own re-derivation on the issue: at that size a second object
      // saves a fraction of a fraction and costs a column, an upload and a
      // sweep rule. The original IS the bounded preview here.
      return c.json({
        ...(await signObject(
          db,
          MMS_BUCKET,
          objectPath,
          MMS_TTL_SECONDS,
          mms[0].content_type,
        )),
        variant: "original",
      });
    }

    return errorResponse(c, "not_found", "No such attachment.");
  },
);

/**
 * #106 gate for the `/url` route: 404 the mint when the caller can't see the
 * media's conversation. A null conversation_id (legacy/edge rows) resolves to
 * visible — consistent with the deny-list model (an un-numbered row is never
 * hidden). Owner/admin and no-rules companies short-circuit inside.
 */
async function assertConversationVisible(
  db: Db,
  c: Context<AppEnv>,
  conversationId: string | null,
): Promise<void> {
  if (!conversationId) return;
  await requireConversationAccess(db, {
    companyId: c.get("companyId"),
    userId: c.get("userId"),
    role: c.get("role"),
    conversationId,
    need: "read",
  });
}

/**
 * The MMS flavor of {@link assertConversationVisible}: message_attachments has
 * no conversation_id, so the owning conversation is resolved via the message —
 * but only when the caller is restricted (owner/admin and no-rules companies
 * short-circuit without the extra lookup).
 */
async function assertMmsVisible(
  db: Db,
  c: Context<AppEnv>,
  messageId: string,
): Promise<void> {
  const role = c.get("role");
  if (role === "owner" || role === "admin") return;
  const companyId = c.get("companyId");
  const access = await resolveNumberAccess(db, {
    companyId,
    userId: c.get("userId"),
    role,
  });
  if (access.hiddenNumberIds === null) return; // no rules → nothing hidden

  const rows = unwrap<{ conversation_id: string | null }[]>(
    await db
      .from("messages")
      .select("conversation_id")
      .eq("company_id", companyId)
      .eq("id", messageId)
      .limit(1),
    "mms message lookup",
  );
  await assertConversationVisible(db, c, rows[0]?.conversation_id ?? null);
}

/**
 * Mint one short-lived signed Storage URL and its expiry (D19 §2.5 / §7).
 *
 * #317: the disposition follows the TYPE, which is why `content_type` is selected at
 * both call sites. `dispositionOptions` owns the rule and documents why — anything
 * that is not an allowed image or our own voicemail audio gets
 * `Content-Disposition: attachment`, which is PDF and the OpenXML/ODF family today
 * and automatically the right answer for whatever is added next.
 *
 * Scanning the bytes is the expensive half of #317 and needs a subprocessor
 * decision; this is the half that ships without one.
 */
async function signObject(
  db: Db,
  bucket: string,
  objectPath: string,
  ttlSeconds: number,
  contentType: string | null | undefined,
): Promise<{ url: string; expires_at: string }> {
  const { data, error } = await db.storage
    .from(bucket)
    .createSignedUrl(objectPath, ttlSeconds, dispositionOptions(contentType));
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
