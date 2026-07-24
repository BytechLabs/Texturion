/**
 * MMS media handling (SPEC §7, §8): validation limits, Supabase Storage
 * paths in the private `mms-media` bucket, attachment rows, and the signed
 * URLs handed to Telnyx for outbound media.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MMS_MAX_MEDIA_BYTES,
  MMS_MAX_MEDIA_ITEMS,
  MMS_OUTBOUND_MEDIA_TYPES,
  canonicalMmsType,
} from "@loonext/shared";

import { ApiError } from "../http/errors";
import { EXECUTABLE_SNIFF, sniffContentType } from "../routes/core/attachments";
import type { AttachmentSummary } from "./types";

export const MMS_BUCKET = "mms-media";

/**
 * Outbound media constraints (SPEC §7, widened by #189): max 3 items, ≤1 MB
 * decoded each. The canonical allow-list lives in @loonext/shared (the client
 * contract); the API enforces it here — these re-exports keep the existing
 * route imports stable.
 */
export const OUTBOUND_MEDIA_TYPES = MMS_OUTBOUND_MEDIA_TYPES;
export const MAX_OUTBOUND_MEDIA_BYTES = MMS_MAX_MEDIA_BYTES;
export const MAX_OUTBOUND_MEDIA_ITEMS = MMS_MAX_MEDIA_ITEMS;

/**
 * Content-Length ceiling for the JSON media routes (POST /v1/messages/send,
 * compose): the decoded per-item cap × ~2 (base64 expansion + whitespace) ×
 * the item cap, plus headroom for the JSON envelope. Used with
 * assertBodyWithinLimit to reject BEFORE c.req.json() buffers the whole body
 * into Worker memory (SPEC §10) — zod's per-item cap runs only after buffering.
 */
export const MAX_OUTBOUND_MEDIA_BODY_BYTES =
  MAX_OUTBOUND_MEDIA_ITEMS * MAX_OUTBOUND_MEDIA_BYTES * 2 + 256 * 1024;

/**
 * Inbound media constraints: carriers deliver the same deliverable set the
 * outbound path sends (#189 — a customer's voice note or contact card is no
 * longer dropped), bounded by the `mms-media` bucket's 5 MB file limit. The
 * type list MUST stay in sync with the bucket row's allowed_mime_types
 * (20260722120000_mms_wider_media.sql); inbound headers are canonicalized
 * (canonicalMmsType) before the check so vendor spellings like audio/x-wav
 * land on the list.
 */
export const INBOUND_MEDIA_TYPES = MMS_OUTBOUND_MEDIA_TYPES;
export const MAX_INBOUND_MEDIA_BYTES = 5 * 1024 * 1024;

/**
 * D30 per-message item cap: at most the first 10 media items of an inbound
 * message are downloaded/stored; the rest are skipped with a warning (the
 * §7 skip idiom — a permanent condition, never retried). Inbound MMS is
 * customer content and is NEVER blocked on a storage budget — this per-message
 * bound (plus the ≤5 MB per item above) is its only limit.
 */
export const MAX_INBOUND_MEDIA_ITEMS = 10;

/** Outbound MMS meters as 3 segments (SPEC §2) — also the send-gate estimate. */
export const MMS_SEGMENTS = 3;

/** 24-hour signed-URL TTL covers Telnyx's fetch + retries (SPEC §8). */
export const OUTBOUND_SIGNED_URL_TTL_SECONDS = 24 * 60 * 60;

/** Bucket-relative object path: {company_id}/{message_id}/{n} (SPEC §6). */
export function mediaStoragePath(
  companyId: string,
  messageId: string,
  index: number,
): string {
  return `${companyId}/${messageId}/${index}`;
}

export interface DecodedMediaItem {
  contentType: (typeof OUTBOUND_MEDIA_TYPES)[number];
  bytes: Uint8Array;
}

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Sentinel for "the bytes are an ISO base-media (ftyp) container" — MP4, M4A,
 * 3GP, and QuickTime all share it, and the brand alone cannot reliably split
 * audio from video, so the match rule accepts any of the declared ISO types.
 */
const ISO_MEDIA_SNIFF = "application/x-iso-media";

/** Declared types the ISO (ftyp) container signature is consistent with. */
const ISO_MEDIA_TYPES = new Set([
  "video/mp4",
  "audio/mp4",
  "video/3gpp",
  "audio/3gpp",
  "video/quicktime",
]);

/**
 * Magic-less text formats: the only declarations a null byte-sniff may pass
 * on this ingress. Everything binary (image/audio/video/pdf) must carry its
 * signature.
 */
const TEXT_MEDIA_TYPES = new Set([
  "text/plain",
  "text/vcard",
  "text/x-vcard",
  "text/calendar",
]);

/** True when the buffer starts with the ASCII string at `offset`. */
function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * MMS-specific byte sniff (#189): extends the shared {@link sniffContentType}
 * (executables, images, PDF) with the audio/video/text signatures the widened
 * allow-list needs. AMR is checked FIRST because its magic is literally
 * "#!AMR" — a shebang to the generic sniffer, which would flag it executable.
 */
export function sniffMmsContentType(bytes: Uint8Array): string | null {
  if (asciiAt(bytes, 0, "#!AMR")) return "audio/amr";

  const base = sniffContentType(bytes);
  if (base !== null) return base; // executables, images, pdf, zip, ole

  if (asciiAt(bytes, 0, "ID3")) return "audio/mpeg";
  if (asciiAt(bytes, 0, "OggS")) return "audio/ogg";
  if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WAVE")) return "audio/wav";
  if (asciiAt(bytes, 4, "ftyp")) return ISO_MEDIA_SNIFF;
  if (asciiAt(bytes, 0, "BEGIN:VCARD")) return "text/vcard";
  if (asciiAt(bytes, 0, "BEGIN:VCALENDAR")) return "text/calendar";

  // UTF BOMs mark text before the MPEG frame-sync check below can misread
  // a UTF-16 BOM (FF FE) as an audio frame header.
  if (
    asciiAt(bytes, 0, "\xef\xbb\xbf") ||
    (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) ||
    (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff)
  ) {
    return "text/plain";
  }

  // Raw MPEG audio (no ID3): an 11-bit frame sync. JPEG never reaches here —
  // the base sniff already claimed FF D8 FF.
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return "audio/mpeg";
  }
  return null;
}

/**
 * True when the decoded bytes are consistent with the declared MMS type
 * (D19 §2.3 applied to this ingress, widened by #189):
 *   - executable/script signatures are ALWAYS rejected (AMR's "#!AMR" is
 *     carved out above — every other shebang stays an executable);
 *   - binary declarations (image/audio/video/pdf) must carry a matching
 *     signature — a null sniff is a rejection for them, exactly as strict as
 *     the old image-only rule;
 *   - the ISO (ftyp) container accepts any declared mp4/3gpp/quicktime flavor;
 *   - vCard/calendar bytes accept their own declarations (x-vcard included)
 *     or text/plain;
 *   - a null sniff passes ONLY for the magic-less text declarations.
 */
export function mmsBytesMatchDeclaredType(
  bytes: Uint8Array,
  declared: string,
): boolean {
  const sniffed = sniffMmsContentType(bytes);
  if (sniffed === EXECUTABLE_SNIFF) return false;
  if (sniffed === null) return TEXT_MEDIA_TYPES.has(declared);
  if (sniffed === ISO_MEDIA_SNIFF) return ISO_MEDIA_TYPES.has(declared);
  if (sniffed === "text/vcard") {
    return (
      declared === "text/vcard" ||
      declared === "text/x-vcard" ||
      declared === "text/plain"
    );
  }
  if (sniffed === "text/calendar") {
    return declared === "text/calendar" || declared === "text/plain";
  }
  if (sniffed === "text/plain") return TEXT_MEDIA_TYPES.has(declared);
  return sniffed === declared;
}

/**
 * Decode and validate the outbound media array per the SPEC §7 422 rules
 * (widened by #189): max 3 items, `content_type` in the deliverable MMS set
 * (already zod-enforced by the route schema), each decoded payload ≤ 1 MB and
 * valid base64 — and the decoded BYTES must be consistent with the declared
 * type ({@link mmsBytesMatchDeclaredType}). A renamed executable, an unknown
 * binary blob, or a byte/declaration mismatch is 422'd before anything
 * reaches Storage or gets a 24 h signed URL minted for Telnyx.
 */
export function decodeOutboundMedia(
  items: { content_type: string; base64: string }[],
): DecodedMediaItem[] {
  if (items.length > MAX_OUTBOUND_MEDIA_ITEMS) {
    throw new ApiError(
      "validation_failed",
      `media: at most ${MAX_OUTBOUND_MEDIA_ITEMS} items allowed.`,
    );
  }
  return items.map((item, index) => {
    const declared = canonicalMmsType(item.content_type);
    const contentType = OUTBOUND_MEDIA_TYPES.find(
      (allowed) => allowed === declared,
    );
    if (!contentType) {
      throw new ApiError(
        "validation_failed",
        `media[${index}].content_type must be one of ${OUTBOUND_MEDIA_TYPES.join(", ")}.`,
      );
    }
    const cleaned = item.base64.replace(/\s+/g, "");
    if (cleaned.length === 0 || cleaned.length % 4 !== 0 || !BASE64_PATTERN.test(cleaned)) {
      throw new ApiError(
        "validation_failed",
        `media[${index}].base64 is not valid base64.`,
      );
    }
    let binary: string;
    try {
      binary = atob(cleaned);
    } catch {
      throw new ApiError(
        "validation_failed",
        `media[${index}].base64 is not valid base64.`,
      );
    }
    if (binary.length > MAX_OUTBOUND_MEDIA_BYTES) {
      throw new ApiError(
        "validation_failed",
        `media[${index}] exceeds ${MAX_OUTBOUND_MEDIA_BYTES} bytes decoded.`,
      );
    }
    if (binary.length === 0) {
      throw new ApiError("validation_failed", `media[${index}] is empty.`);
    }
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    // #35 byte sniff, widened for #189: the bytes must be consistent with the
    // declared type — executables never pass, binary types need their magic,
    // only magic-less text declarations are trusted without one.
    if (!mmsBytesMatchDeclaredType(bytes, contentType)) {
      throw new ApiError(
        "validation_failed",
        `media[${index}] bytes do not match the declared ${contentType}.`,
      );
    }
    return { contentType, bytes };
  });
}

/**
 * Outbound media persistence (SPEC §8): upload each validated item to
 * mms-media/{company_id}/{message_id}/{n}, insert `message_attachments`
 * rows (source_url NULL for outbound), and return the attachment summaries
 * with their storage paths.
 */
export async function uploadOutboundMedia(
  db: SupabaseClient,
  args: { companyId: string; messageId: string; items: DecodedMediaItem[] },
): Promise<{ summaries: AttachmentSummary[]; storagePaths: string[] }> {
  const summaries: AttachmentSummary[] = [];
  const storagePaths: string[] = [];
  for (const [index, item] of args.items.entries()) {
    const path = mediaStoragePath(args.companyId, args.messageId, index);
    const upload = await db.storage
      .from(MMS_BUCKET)
      .upload(path, item.bytes.slice().buffer, {
        contentType: item.contentType,
        upsert: true, // retried sends re-write the same object idempotently
      });
    if (upload.error) {
      throw new Error(`media upload failed (${path}): ${upload.error.message}`);
    }
    const { data, error } = await db
      .from("message_attachments")
      .insert({
        message_id: args.messageId,
        company_id: args.companyId,
        storage_path: path,
        content_type: item.contentType,
        size_bytes: item.bytes.byteLength,
        source_url: null,
      })
      .select("id,content_type,size_bytes");
    if (error) {
      throw new Error(`message_attachments insert failed: ${error.message}`);
    }
    const row = (data ?? [])[0] as AttachmentSummary | undefined;
    if (!row) throw new Error("message_attachments insert returned no row");
    summaries.push(row);
    storagePaths.push(path);
  }
  return { summaries, storagePaths };
}

/**
 * Mint the 24-hour signed URLs Telnyx fetches outbound media from (SPEC §8).
 */
export async function signedMediaUrls(
  db: SupabaseClient,
  storagePaths: string[],
): Promise<string[]> {
  const urls: string[] = [];
  for (const path of storagePaths) {
    const { data, error } = await db.storage
      .from(MMS_BUCKET)
      .createSignedUrl(path, OUTBOUND_SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      throw new Error(
        `signed URL failed (${path}): ${error?.message ?? "no URL returned"}`,
      );
    }
    urls.push(data.signedUrl);
  }
  return urls;
}
