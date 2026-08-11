import {
  ALLOWED_IMAGE_TYPES,
  DEFAULT_LOCALE,
  isAllowedImageType,
} from "@loonext/shared";

import { makeTranslate, type Translate } from "@/i18n/provider";
/**
 * Client-side note attachment validation (D19 / D28 / APP-FEATURES-V2 §2.4).
 *
 * A calm, pre-flight gate so an over-size or wrong-type file is rejected with a
 * plain sentence BEFORE the multipart round-trip — the API re-validates (and
 * additionally sniffs the bytes), so this is a courtesy check, never the only
 * one. The ceiling + allow-list MUST stay in step with the API's
 * `apps/api/src/routes/core/attachments.ts` (25 MB; images minus SVG + PDF +
 * Office/OpenDocument + text/csv + zip; executables/scripts blocked).
 *
 * D28: uploads are notes-only — files enter through messages (MMS) and notes;
 * the standalone task ingress is gone, so `buildAttachmentForm` builds note
 * bodies exclusively (the API 422s `owner_type='task'`).
 *
 * Pure and dependency-free so it unit-tests without React or the network.
 */

/** Per-file ceiling — mirrors the bucket `file_size_limit` (D19 §2.4). */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Soft per-owner cap — a note/task shouldn't become a dump (D19 §2.4). */
export const MAX_ATTACHMENTS_PER_OWNER = 10;

/**
 * Exact-match MIME allow-list (D19 §2.4), mirroring the API's
 * ALLOWED_EXACT_TYPES. `image/*` is matched by prefix separately.
 */
const ALLOWED_EXACT_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
  // Office / OpenDocument
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
]);

/**
 * The `accept` attribute for the hidden <input type="file">. Not a security
 * control (the API is) — just steers the OS picker toward the allow-list so the
 * common case never trips the error path. Executables aren't offered.
 */
export const ATTACHMENT_ACCEPT = [
  // #262: the exact image types, never a bare `image/*`. A picker that offers a
  // TIFF is a picker that walks the user into a rejection.
  ...ALLOWED_IMAGE_TYPES,
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".odt",
  ".ods",
  ".odp",
].join(",");

/**
 * True when `contentType` is in the D19 allow-list. Image types match by the
 * `image/` prefix — EXCEPT `image/svg+xml`, denied to match the API (an SVG is
 * an active document: scripts/external refs, an XSS vector if ever rendered
 * inline; a tradesperson's photo set never needs SVG). All other types are
 * exact (mirrors the API's `isAllowedAttachmentType`).
 */
export function isAllowedAttachmentType(contentType: string): boolean {
  const type = contentType.trim().toLowerCase();
  // #262: enumerated, from the same shared list the API and the Storage bucket
  // use. The prefix rule this replaces offered the user files the bucket would
  // refuse, and turned their upload into a 500.
  if (isAllowedImageType(type)) return true;
  return ALLOWED_EXACT_TYPES.has(type);
}

/** A validation outcome: either the file is admissible, or a plain reason why not. */
export type AttachmentValidation =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Validate one file against the D19 limits, returning plain-language copy on
 * failure (G10 — precise, calm, no codes). `currentCount` is the owner's live
 * attachment count so the soft cap is enforced client-side too. An empty file
 * is rejected here (the API 422s an empty upload).
 *
 * #228: both LIMITS are interpolated from the constants above rather than
 * written into each sentence. The size one was already wrong in spirit — "over
 * 25 MB" was typed out beside a `MAX_ATTACHMENT_BYTES` that decides it — and
 * two translations each carrying their own number is three places to miss the
 * day the bucket's ceiling moves.
 */
export function validateAttachment(
  file: { name?: string; type?: string; size: number },
  currentCount = 0,
  t: Translate = makeTranslate(DEFAULT_LOCALE),
): AttachmentValidation {
  if (currentCount >= MAX_ATTACHMENTS_PER_OWNER) {
    return {
      ok: false,
      reason: t("thread.attachmentTooMany", {
        count: MAX_ATTACHMENTS_PER_OWNER,
      }),
    };
  }
  if (file.size === 0) {
    return { ok: false, reason: t("thread.attachmentEmpty") };
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      reason: t("thread.attachmentTooBig", {
        megabytes: MAX_ATTACHMENT_BYTES / (1024 * 1024),
      }),
    };
  }
  // Some browsers report an empty type for known-but-unrecognized files; the
  // API sniffs the bytes and is the authority, so only reject a type that is
  // present AND explicitly disallowed (a photo of a part, a quote PDF, a spec
  // sheet all pass — an .exe does not).
  const declared = file.type ?? "";
  if (declared !== "" && !isAllowedAttachmentType(declared)) {
    return { ok: false, reason: t("thread.attachmentTypeBlocked") };
  }
  return { ok: true };
}

/** One rejected file from `partitionAttachmentFiles`, with its plain reason. */
export interface RejectedAttachmentFile<T> {
  file: T;
  reason: string;
}

/**
 * Validate a batch of incoming files (multi-select, drop, paste) against the
 * D19 limits, counting each admission toward the per-owner cap as it goes —
 * so dropping 12 files onto an empty note admits the first 10 and rejects the
 * rest with the cap sentence. `currentCount` is the owner's already-staged or
 * already-uploaded live count. Pure; callers surface `rejected[].reason`
 * (toast/inline) and stage `accepted`.
 */
export function partitionAttachmentFiles<
  T extends { name?: string; type?: string; size: number },
>(
  incoming: readonly T[],
  currentCount = 0,
  t: Translate = makeTranslate(DEFAULT_LOCALE),
): { accepted: T[]; rejected: RejectedAttachmentFile<T>[] } {
  const accepted: T[] = [];
  const rejected: RejectedAttachmentFile<T>[] = [];
  for (const file of incoming) {
    const check = validateAttachment(file, currentCount + accepted.length, t);
    if (check.ok) accepted.push(file);
    else rejected.push({ file, reason: check.reason });
  }
  return { accepted, rejected };
}

/**
 * Build the multipart body for POST /v1/attachments (D19): the three fields the
 * route reads — `owner_type`, `owner_id`, `file`. NOTES-ONLY (D28): the task
 * ingress is removed, so the owner type is pinned to 'note' at the type level —
 * production code can no longer build a doomed task upload. Pure so the upload
 * hook's request shape is unit-testable without React (the HTTP edge is stubbed
 * via an injected fetch). The browser sets the multipart boundary from this
 * FormData.
 */
export function buildAttachmentForm(
  ownerType: "note",
  ownerId: string,
  file: File | Blob,
  /**
   * #240: the bounded preview the browser generated, when it made one. Omitted
   * for a file that does not want one (anything that is not a big image),
   * whenever the resize failed, and whenever the result came out too big to be
   * worth sending — the API treats an absent preview exactly as it did before
   * this shipped and serves the original.
   */
  preview?: File | Blob | null,
): FormData {
  const formData = new FormData();
  formData.append("owner_type", ownerType);
  formData.append("owner_id", ownerId);
  formData.append("file", file);
  if (preview) formData.append("preview", preview);
  return formData;
}
