/**
 * Generic note/task attachment storage helpers (D19 / APP-FEATURES-V2 §2).
 *
 * The generic `attachments` table + private `attachments` bucket are the
 * SINGLE storage machinery for note (`owner_type='note'`) and task
 * (`owner_type='task'`) attachments — deliberately parallel to, and separate
 * from, the MMS `message_attachments` / `mms-media` path (which stays intact).
 *
 * Constants here MUST match the schema-track bucket row (25 MB limit, MIME
 * allow-list) — the bucket is the hard ceiling, this is the API-layer gate
 * that rejects before signing/streaming (D19 §2.4).
 */
import { ApiError } from "../../http/errors";

/** Private bucket for note/task attachments (D19 §2.2). Distinct from mms-media. */
export const ATTACHMENTS_BUCKET = "attachments";

/** Per-file ceiling — the bucket `file_size_limit` (D19 §2.4). */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Soft cap: a note/task shouldn't become a dumping ground (D19 §2.4). */
export const MAX_ATTACHMENTS_PER_OWNER = 10;

/** Signed download-URL TTL (D19 §2.5: 60–300s). */
export const ATTACHMENT_SIGNED_URL_TTL_SECONDS = 300;

/** The two owner discriminators the generic table carries (D19). */
export const OWNER_TYPES = ["note", "task"] as const;
export type OwnerType = (typeof OWNER_TYPES)[number];

/**
 * D19 §2.4 MIME allow-list: the realistic tradesperson set — a photo of a part,
 * a quote PDF, a spec sheet. Executables/scripts are rejected BEFORE signing.
 * `image/*` is matched by prefix; everything else is an exact match.
 */
const ALLOWED_EXACT_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
  // Office / OpenDocument (D19 "Office/OpenDocument"):
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
 * True when `contentType` is in the D19 allow-list. Image types match by the
 * `image/` prefix (D19 `image/*`); all others are exact.
 */
export function isAllowedAttachmentType(contentType: string): boolean {
  const type = contentType.trim().toLowerCase();
  if (type.startsWith("image/")) return type.length > "image/".length;
  return ALLOWED_EXACT_TYPES.has(type);
}

/**
 * Reject a declared content-type not in the allow-list at the API boundary
 * (422), before any Storage write (D19 §2.4). Executables/scripts and any
 * unlisted type fall here.
 */
export function assertAllowedType(contentType: string): void {
  if (!isAllowedAttachmentType(contentType)) {
    throw new ApiError(
      "validation_failed",
      `content_type: ${contentType} is not an allowed attachment type.`,
    );
  }
}

/**
 * Sanitize a client-supplied filename for use as the trailing path segment:
 * keep a conservative charset, collapse the rest to '_', strip any path
 * separators (defense against `../` traversal in the object key), and bound
 * the length. Never empty (falls back to 'file').
 */
export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name; // drop any directory parts
  const cleaned = base
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
  return cleaned === "" ? "file" : cleaned;
}

/**
 * Sniff the content-type from the leading bytes (D19 §2.3: "Server re-validates
 * content-type from the bytes, never trusting the client-declared type").
 *
 * Returns a canonical MIME string for the file signatures the allow-list cares
 * about, or `null` when the bytes match no known signature. A `null` is NOT a
 * rejection on its own — many allowed types (text/plain, text/csv, the various
 * OpenXML/ODF payloads that are all ZIP containers) have no distinctive magic
 * beyond ZIP — so the route treats "sniff disagrees with a concrete, different
 * known type" as the reject signal, not "sniff couldn't identify it".
 */
export function sniffContentType(bytes: Uint8Array): string | null {
  const startsWith = (sig: number[], offset = 0): boolean =>
    bytes.length >= offset + sig.length &&
    sig.every((byte, i) => bytes[offset + i] === byte);

  // Images
  if (startsWith([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return "image/png";
  if (startsWith([0x47, 0x49, 0x46, 0x38])) return "image/gif"; // GIF8
  if (
    startsWith([0x52, 0x49, 0x46, 0x46]) && // RIFF
    startsWith([0x57, 0x45, 0x42, 0x50], 8) // WEBP
  )
    return "image/webp";
  // PDF: %PDF
  if (startsWith([0x25, 0x50, 0x44, 0x46])) return "application/pdf";
  // ZIP container (PK\x03\x04) — covers application/zip AND every OpenXML/ODF
  // office doc (all ZIP-based). We can't disambiguate the office subtype from
  // magic alone, so this is reported as the generic zip signature.
  if (startsWith([0x50, 0x4b, 0x03, 0x04])) return "application/zip";
  // Legacy MS Office (OLE compound: D0 CF 11 E0 A1 B1 1A E1)
  if (startsWith([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
    return "application/x-ole-storage";
  return null;
}

/**
 * True when the bytes are consistent with the client-declared type (D19 §2.3).
 * Consistency, not exact equality, because ZIP-container office formats and
 * plain text share signatures:
 *   - a null sniff (no known magic) is accepted — the type is text/office/etc.
 *     with no distinctive header, and the declared type was already allow-listed;
 *   - an image/pdf declaration MUST match the sniffed image/pdf signature;
 *   - a ZIP-based office/zip declaration is accepted when the bytes are a ZIP;
 *   - anything where the sniff names a DIFFERENT concrete media class than the
 *     declaration is rejected (e.g. declared image/png, bytes are a PDF).
 */
export function bytesMatchDeclaredType(
  bytes: Uint8Array,
  declared: string,
): boolean {
  const sniffed = sniffContentType(bytes);
  if (sniffed === null) return true; // no distinctive magic — trust the allow-listed declaration
  const type = declared.trim().toLowerCase();

  if (sniffed.startsWith("image/")) return type === sniffed;
  if (sniffed === "application/pdf") return type === "application/pdf";
  if (sniffed === "application/zip") {
    // Any ZIP-container type: raw zip or an OpenXML/ODF office doc.
    return (
      type === "application/zip" ||
      type.startsWith("application/vnd.openxmlformats-officedocument") ||
      type.startsWith("application/vnd.oasis.opendocument")
    );
  }
  if (sniffed === "application/x-ole-storage") {
    // Legacy Office (.doc/.xls/.ppt) OLE container.
    return (
      type === "application/msword" ||
      type === "application/vnd.ms-excel" ||
      type === "application/vnd.ms-powerpoint"
    );
  }
  return false;
}

/**
 * Deterministic object key under the bucket (D19 §2.2):
 *   {company_id}/{owner_type}/{owner_id}/{uuid}-{safe_filename}
 * company_id is the LEADING segment so a single Storage RLS predicate
 * authorizes the whole tenant tree (D19 §2.3 defense-in-depth).
 * NOTE: this is the object key WITHOUT the `attachments/` bucket prefix — the
 * Storage API takes the key relative to the bucket.
 */
export function attachmentStoragePath(args: {
  companyId: string;
  ownerType: OwnerType;
  ownerId: string;
  uuid: string;
  fileName: string;
}): string {
  return `${args.companyId}/${args.ownerType}/${args.ownerId}/${args.uuid}-${safeFilename(args.fileName)}`;
}
