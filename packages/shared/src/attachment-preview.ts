import { isAllowedImageType } from "./attachment-types";

/**
 * #240 — the bounded preview an uploader generates beside the original.
 *
 * A note attachment is capped at 25 MB and ten per note (D19 §2.4), and the
 * thread re-fetched every one of them on every scroll, for every member of the
 * crew, against a fixed 200 GB egress allowance (D34) — and on the tech's own
 * mobile data (#289). The image on screen is a few hundred pixels wide.
 *
 * The uploading device is the one place in the system where a resize costs
 * nothing: it has already decoded the image, because it just showed it to
 * somebody in a picker. So all three clients make one, which means all three
 * have to agree on when and how big — hence this file rather than three sets of
 * numbers that drift.
 *
 * The API's matching gates live in `apps/api/src/attachments/preview.ts` and
 * import the ceilings from here, so a client cannot generate something the
 * server will refuse.
 */

/**
 * Longest edge of a preview, in pixels.
 *
 * 1600 is sized for the largest place one is shown: a thread image on a desktop
 * at 2x, which is around 1400 px of actual pixels. Going smaller would save
 * bytes nobody would thank us for and put a visibly soft image in front of a
 * tradesperson checking whether the photo shows the right fitting.
 */
export const PREVIEW_MAX_EDGE = 1600;

/**
 * JPEG quality for a generated preview, 0..1.
 *
 * 0.72 is where a downscaled photo stops losing anything a person can see at
 * this size while the file keeps shrinking. Photographs of jobs are exactly the
 * content JPEG is good at.
 */
export const PREVIEW_JPEG_QUALITY = 0.72;

/**
 * Below this, an original is already its own preview.
 *
 * Inbound MMS is capped at 1 MB per item by the carrier (D28), which is the
 * founder's own re-derivation on #240: at that size a derivative saves a
 * fraction of a fraction and costs an object, a column and a round trip. The
 * same reasoning applies to a small note upload.
 */
export const PREVIEW_WORTH_IT_BYTES = 512 * 1024;

/**
 * Hard ceiling on a preview, whatever its original weighs. The server refuses
 * anything larger, so a client that would exceed it must send nothing instead.
 *
 * 400 KB is generous for the job: a 1600px JPEG at the quality above lands
 * around 150-250 KB. The ceiling exists so a client that resizes badly — or not
 * at all — cannot quietly turn the preview path into a second full-size path.
 */
export const MAX_PREVIEW_BYTES = 400 * 1024;

/**
 * A preview must be at most this fraction of its original.
 *
 * Without it a 300 KB original could arrive with a 299 KB "preview": under the
 * ceiling, and saving nothing. Half is a low bar deliberately — a real
 * downscale is 1-2% — because the point is to catch a client that is not
 * resizing at all, not to police how it resizes.
 */
export const MAX_PREVIEW_FRACTION = 0.5;

/**
 * Is a derivative worth having for this file at all?
 *
 * Images only: nothing about a 20 MB PDF gets smaller by making a picture of
 * its first page, because the thread renders a file row rather than a picture.
 * And only images this product actually accepts — a "preview" is a second way
 * into the same bucket, so it must not be a way around the upload allow-list
 * (`image/svg+xml` is denied there because an SVG is an active document).
 */
export function previewWorthHaving(
  contentType: string,
  sizeBytes: number,
): boolean {
  return (
    isAllowedImageType(contentType.trim().toLowerCase()) &&
    sizeBytes > PREVIEW_WORTH_IT_BYTES
  );
}

/**
 * The preview's pixel dimensions for an original of `width` x `height`.
 *
 * Scales the longest edge down to [PREVIEW_MAX_EDGE], preserving aspect ratio,
 * and NEVER scales up — a small image that somehow reaches here keeps its own
 * size rather than being re-encoded larger than it started.
 *
 * Both edges are floored to at least 1: a panorama 8000 x 12 wide would
 * otherwise round its short edge to zero, and a zero-height canvas throws on
 * every platform.
 */
export function previewDimensions(
  width: number,
  height: number,
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 1, height: 1 };
  const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Is a generated preview actually worth sending?
 *
 * The same two rules the server enforces, asked BEFORE the upload so a client
 * that produced a poor result drops it silently rather than earning a 422. A
 * re-encode can genuinely come out bigger than its source — an already-optimised
 * small JPEG re-encoded at a fixed quality is the ordinary case — and the right
 * answer there is to send the original alone.
 */
export function previewIsUseful(
  previewBytes: number,
  originalBytes: number,
): boolean {
  return (
    previewBytes > 0 &&
    previewBytes <= MAX_PREVIEW_BYTES &&
    previewBytes <= originalBytes * MAX_PREVIEW_FRACTION
  );
}
