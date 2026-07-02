/**
 * MMS media handling (SPEC §7, §8): validation limits, Supabase Storage
 * paths in the private `mms-media` bucket, attachment rows, and the signed
 * URLs handed to Telnyx for outbound media.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "../http/errors";
import type { AttachmentSummary } from "./types";

export const MMS_BUCKET = "mms-media";

/** Outbound media constraints (SPEC §7): max 3 items, ≤1 MB decoded each. */
export const OUTBOUND_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
] as const;
export const MAX_OUTBOUND_MEDIA_BYTES = 1024 * 1024;
export const MAX_OUTBOUND_MEDIA_ITEMS = 3;

/**
 * Inbound media constraints: the `mms-media` bucket's allowed MIME types and
 * 5 MB file limit (storage migration). Must stay in sync with the bucket row.
 */
export const INBOUND_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;
export const MAX_INBOUND_MEDIA_BYTES = 5 * 1024 * 1024;

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
 * Decode and validate the outbound media array per the SPEC §7 422 rules:
 * max 3 items, `content_type` ∈ jpeg|png|gif (already zod-enforced by the
 * route schema), each decoded payload ≤ 1 MB and valid base64.
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
    const contentType = OUTBOUND_MEDIA_TYPES.find(
      (allowed) => allowed === item.content_type,
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
    return {
      contentType,
      bytes: Uint8Array.from(binary, (char) => char.charCodeAt(0)),
    };
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
