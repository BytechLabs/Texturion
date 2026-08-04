import {
  MAX_PREVIEW_BYTES,
  MAX_PREVIEW_FRACTION,
  PREVIEW_WORTH_IT_BYTES,
  isAllowedImageType,
  previewWorthHaving,
} from "@loonext/shared";

import { ApiError } from "../http/errors";
import { bytesMatchDeclaredType } from "../routes/core/attachments";
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
 * Validate a client-supplied preview against the original it claims to stand
 * in for.
 *
 * Throws `ApiError` — a bad preview is a bad request, not a silent drop. The
 * caller uploads the original first and only reaches this on a file that was
 * itself accepted, so every message here is about the preview specifically and
 * a client can act on it.
 */
export function assertUsablePreview(
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
}
