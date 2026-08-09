import {
  MAX_PREVIEW_BYTES,
  MAX_PREVIEW_FRACTION,
  PREVIEW_WORTH_IT_BYTES,
  isAllowedImageType,
  previewWorthHaving,
} from "@loonext/shared";

import { ApiError } from "../http/errors";
import { bytesMatchDeclaredType } from "../routes/core/attachments";
import { stripImageLocation } from "./location";
import { scanAttachment } from "./scan";

/**
 * #240 item 1 — the bounded preview an uploader sends alongside the original.
 *
 * A note attachment is capped at 25 MB and ten per note (D19 §2.4). A thread
 * with a few of those re-fetches every one of them on every scroll, for every
 * member of the crew, against a fixed 200 GB egress allowance (D34) — and on
 * the tech's own mobile data (#289). The image on screen is a few hundred
 * pixels wide. The bytes are the original.
 *
 * The uploading device already decoded the image — it just showed it to
 * somebody in a picker — so it is the one place in the system where a resize
 * costs nothing. The two alternatives both buy something that would then need
 * capping: a transform API bills per image (Supabase's is "100 origin images
 * included, then $5 per 1000", counted per BILLING PERIOD as of 2026-08-04, so
 * a photo that stays in view costs again every month), and decoding a 25 MB
 * JPEG inside a Worker buys CPU time and a WASM codec in the bundle.
 *
 * ---------------------------------------------------------------------------
 * A CLIENT-SUPPLIED PREVIEW IS A CLIENT-SUPPLIED FILE.
 *
 * Which means it gets the same treatment as one. It is not "the same image,
 * smaller" until we have checked; as far as this Worker is concerned it is an
 * arbitrary blob that arrived with a helpful name, and every gate the original
 * passes it must pass too — allow-list, byte-sniff, and the #317 content scan.
 * The one thing we cannot check is that it DEPICTS the original, and nothing
 * short of decoding both would; what bounds that is that only a member who can
 * already upload to the note can send either.
 *
 * The extra rule on top is the one that makes it a preview rather than a second
 * upload: it must be an image, and it must be materially smaller than what it
 * stands in for. A "preview" the size of its original is a way to store two
 * copies of a 25 MB file and have the thread fetch the wrong one.
 */

/**
 * The ceilings, the worth-it threshold and the "is this worth having" rule all
 * live in packages/shared: the three clients GENERATE these and this Worker
 * refuses them, and two sets of numbers for one contract is how a client ends
 * up producing something the server will not take.
 */
export {
  MAX_PREVIEW_BYTES,
  MAX_PREVIEW_FRACTION,
  PREVIEW_WORTH_IT_BYTES,
  previewWorthHaving,
};

/**
 * The preview's object key: the original's, with a marker segment.
 *
 * Derived from the original rather than given a uuid of its own so the pair is
 * legible in a bucket listing and an orphan is obvious by eye — the sweep's
 * anti-join is the mechanism, but somebody staring at a listing at 2am is the
 * fallback.
 */
export function previewStoragePath(originalPath: string): string {
  const cut = originalPath.lastIndexOf("/");
  const dir = cut === -1 ? "" : originalPath.slice(0, cut + 1);
  const name = cut === -1 ? originalPath : originalPath.slice(cut + 1);
  return `${dir}preview-${name}`;
}

export interface PreviewCandidate {
  bytes: Uint8Array;
  contentType: string;
}

/**
 * Make a client-supplied preview fit to store: check it against the original it
 * claims to stand in for, then take the customer's location out of it.
 *
 * Throws `ApiError` — a bad preview is a bad request, not a silent drop. The
 * caller uploads the original first and only reaches this on a file that was
 * itself accepted, so every message here is about the preview specifically and
 * a client can act on it.
 *
 * #581/13 — WHY THE STRIP LIVES HERE rather than beside the original's.
 *
 * It was beside the original's, and only the original got it: the route stripped
 * the file and stored the derivative with its Exif intact, so D128's promise that a
 * customer's home coordinates never reach the bucket was being kept for one of the
 * two objects we store per photo. Nothing about a phone resizing an image makes it
 * drop the GPS block, and #581/9 later made the preview the object the PUBLIC job
 * photos page serves.
 *
 * Two calls a caller has to remember are one a caller can half-remember. A preview
 * arriving from a client is not usable until both have happened, so both happen
 * here, and the next path that accepts one cannot get this wrong by omission. The
 * name says `accept` rather than `assert` for the same reason: this rewrites the
 * bytes it is given.
 */
export function acceptUploadedPreview(
  preview: PreviewCandidate,
  original: { sizeBytes: number },
): void {
  const type = preview.contentType.trim().toLowerCase();
  if (!isAllowedImageType(type)) {
    throw new ApiError(
      "validation_failed",
      "preview: must be an image in the allowed set.",
    );
  }
  if (preview.bytes.byteLength === 0) {
    throw new ApiError("validation_failed", "preview: is empty.");
  }
  if (preview.bytes.byteLength > MAX_PREVIEW_BYTES) {
    throw new ApiError(
      "validation_failed",
      `preview: exceeds the ${MAX_PREVIEW_BYTES}-byte limit.`,
    );
  }
  if (preview.bytes.byteLength > original.sizeBytes * MAX_PREVIEW_FRACTION) {
    throw new ApiError(
      "validation_failed",
      "preview: must be materially smaller than the file it previews.",
    );
  }
  // The declared type is advisory here for exactly the reason it is advisory on
  // the original: it is a string the client chose.
  if (!bytesMatchDeclaredType(preview.bytes, type)) {
    throw new ApiError(
      "validation_failed",
      "preview: content does not match its declared type.",
    );
  }
  // #317: the same content scan the original gets. A preview is served inline
  // to every member of the crew — being small does not make it safe, and being
  // second does not make it unreachable.
  const scan = scanAttachment(preview.bytes, type);
  if (scan.verdict !== "clean") {
    throw new ApiError("validation_failed", `preview: ${scan.message}`);
  }
  // #294 / D128, and last for the same reason it is last on the original: it
  // rewrites bytes, so it must never run on a file we were going to refuse.
  stripImageLocation(preview.bytes, type);
}

/**
 * #240 item 3 — hex SHA-256 of the uploaded bytes.
 *
 * Web Crypto rather than a library: it is in the Workers runtime already, it is
 * the fastest thing available there, and a hash is the one place a hand-rolled
 * implementation is both easy to get subtly wrong and impossible to notice.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The live attachment already holding these exact bytes, as returned by
 * `api_attachment_by_content`, or null.
 *
 * Parsed rather than cast: this decides whether a 25 MB upload is skipped, and
 * a malformed answer must read as "no twin" — storing a second copy is a wasted
 * object, while pointing a row at a path that came back wrong is a broken
 * photo.
 */
export function parseContentTwin(data: unknown): {
  storage_path: string;
  preview_path: string | null;
  preview_bytes: number | null;
} | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (typeof row.storage_path !== "string" || row.storage_path.length === 0) {
    return null;
  }
  return {
    storage_path: row.storage_path,
    preview_path:
      typeof row.preview_path === "string" ? row.preview_path : null,
    preview_bytes:
      typeof row.preview_bytes === "number" ? row.preview_bytes : null,
  };
}
