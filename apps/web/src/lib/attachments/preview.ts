import {
  MMS_MAX_MEDIA_BYTES,
  MMS_PHOTO_LONG_EDGE,
  MMS_PHOTO_QUALITIES,
  MMS_PHOTO_RESIZE_ROUNDS,
  mmsMediaTypeForFile,
  PREVIEW_JPEG_QUALITY,
  previewDimensions,
  previewIsUseful,
  previewWorthHaving,
} from "@loonext/shared";

/**
 * #240 — make the bounded preview that gets uploaded beside the original.
 *
 * The browser has already decoded this image: the person just picked it, and in
 * most cases is looking at it in the composer's staging strip. So the resize is
 * a few milliseconds of work on a bitmap that already exists, and it saves the
 * whole crew from re-fetching a 25 MB original on every thread scroll.
 *
 * BEST-EFFORT, ALWAYS. Every failure path here returns null and the caller
 * uploads the original alone, which is exactly what happened before this
 * shipped. A browser without `createImageBitmap`, a CMYK JPEG the decoder
 * refuses, a canvas tainted by something unexpected, an out-of-memory on a
 * 100-megapixel panorama — none of those are worth costing somebody the photo
 * they were trying to send from a job site.
 *
 * The numbers (edge, quality, ceilings) live in packages/shared so this, the
 * two phone apps and the Worker that refuses a bad one all agree.
 */

/** The file name a generated preview carries. Cosmetic — the server keys it. */
const PREVIEW_FILE_NAME = "preview.jpg";

/**
 * A downscaled JPEG of `file`, or null when one is not worth making, not
 * possible, or not worth sending.
 */
export async function makeAttachmentPreview(file: File): Promise<File | null> {
  if (!previewWorthHaving(file.type, file.size)) return null;
  if (typeof createImageBitmap !== "function") return null;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // A decoder that will not open the file is also a decoder that cannot tell
    // us the image is broken — the API's byte-sniff is the authority on that,
    // and it is about to see the original anyway.
    return null;
  }

  try {
    const size = previewDimensions(bitmap.width, bitmap.height);
    const blob = await drawToJpeg(bitmap, size);
    if (!blob) return null;
    // A re-encode can genuinely come out bigger than its source — an
    // already-optimised JPEG re-encoded at a fixed quality is the ordinary
    // case — and the server refuses those. Ask before sending rather than
    // earning a 422 on a photo that was perfectly fine.
    if (!previewIsUseful(blob.size, file.size)) return null;
    return new File([blob], PREVIEW_FILE_NAME, { type: "image/jpeg" });
  } catch {
    return null;
  } finally {
    // The decoded bitmap can be tens of megabytes. On a phone browser with four
    // photos staged, not releasing them is the difference between a slow tab
    // and a dead one.
    bitmap.close();
  }
}

export function isHeicImage(file: { name?: string | null; type?: string | null }): boolean {
  return /^image\/hei[cf](?:-sequence)?$/i.test(file.type ?? "") || /\.hei[cf]$/i.test(file.name ?? "");
}

export function needsMmsImageResize(file: File): boolean {
  if (file.size === 0) return false;
  if (isHeicImage(file)) return true;
  if (file.size <= MMS_MAX_MEDIA_BYTES) return false;
  const type = mmsMediaTypeForFile(file);
  return type === "image/jpeg" || type === "image/png" || type === "image/webp";
}

export async function prepareMmsImage(file: File): Promise<File | null> {
  if (typeof createImageBitmap !== "function") return null;
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MMS_PHOTO_LONG_EDGE / Math.max(bitmap.width, bitmap.height));
    let width = Math.max(1, Math.floor(bitmap.width * scale));
    let height = Math.max(1, Math.floor(bitmap.height * scale));
    for (let round = 0; round < MMS_PHOTO_RESIZE_ROUNDS; round += 1) {
      for (const quality of MMS_PHOTO_QUALITIES) {
        const jpeg = await drawToJpeg(bitmap, { width, height }, quality, true);
        if (jpeg && jpeg.size > 0 && jpeg.size <= MMS_MAX_MEDIA_BYTES) {
          const name = `${file.name.replace(/\.[^.]+$/, "")}.jpg`;
          return new File([jpeg], name, { type: "image/jpeg" });
        }
      }
      if (width === 1 && height === 1) break;
      width = Math.max(1, Math.floor(width / 2));
      height = Math.max(1, Math.floor(height / 2));
    }
    return null;
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}

/**
 * Draw the bitmap at `size` and encode it as JPEG.
 *
 * `OffscreenCanvas` where it exists — the resize then never touches the DOM,
 * which matters because this runs while somebody is typing in the composer
 * beside it. A detached `<canvas>` is the fallback for Safari versions without
 * `convertToBlob`.
 */
async function drawToJpeg(
  bitmap: ImageBitmap,
  size: { width: number; height: number },
  quality = PREVIEW_JPEG_QUALITY,
  whiteBackground = false,
): Promise<Blob | null> {
  const canvas = typeof OffscreenCanvas === "function" && typeof OffscreenCanvas.prototype.convertToBlob === "function"
    ? new OffscreenCanvas(size.width, size.height)
    : Object.assign(document.createElement("canvas"), size);
  const context = canvas.getContext("2d");
  if (!context) return null;
  if (whiteBackground) {
    context.fillStyle = "#fff";
    context.fillRect(0, 0, size.width, size.height);
  }
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type: "image/jpeg", quality });
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", quality);
  });
}
