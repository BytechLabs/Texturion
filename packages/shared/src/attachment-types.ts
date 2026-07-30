/**
 * #262 — the attachment image allow-list, in ONE place.
 *
 * There were three lists and they disagreed. The API and the web client both
 * admitted any `image/*` subtype except SVG; the Storage bucket
 * (`supabase/migrations/20260702080000_appv2_attachments_storage.sql`) lists six
 * exact image types. So a scanned invoice saved as `image/tiff`, an `image/avif`
 * photo from a modern phone, or an `image/bmp` screenshot passed the OS picker,
 * passed client validation, passed the API type gate, passed the byte sniff —
 * which has no signature for any of them, so the null-sniff path returns true —
 * claimed a row, and then failed at `storage.upload` with InvalidMimeType.
 *
 * The route deletes the claimed row and throws a plain Error, so the customer
 * got a **500** rather than the 422 the copy is written for: "not an allowed
 * attachment type" was never shown for the one case where it was the truth.
 *
 * A prefix rule cannot be kept in step with an enumerated bucket, so this is the
 * enumeration, and both gates read it. THE BUCKET IS THE SOURCE OF TRUTH: adding
 * a type here without adding it to the bucket recreates the same 500, in the
 * same place, for the new type.
 */

/**
 * Image types the `attachments` bucket accepts, verbatim from its
 * `allowed_mime_types`.
 *
 * Deliberately NOT widened while fixing the bug. Accepting AVIF or TIFF is a
 * product decision with its own consequences (the kind mapping, any future
 * derivative pipeline, and what a carrier will take on the MMS path), and it
 * needs the bucket changed first — an expand-then-accept ordering, not a
 * one-line edit. Narrowing is what turns the 500 into the honest 422 the
 * customer should have been getting all along.
 */
export const ALLOWED_IMAGE_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
];

/** True for an image type the bucket will actually store. */
export function isAllowedImageType(contentType: string): boolean {
  return ALLOWED_IMAGE_TYPES.includes(contentType.trim().toLowerCase());
}

/**
 * The `accept` attribute for a file picker: the exact image types plus the
 * document types, never a bare `image/*`.
 *
 * Not a security control — the API is — but a picker that offers a TIFF is a
 * picker that walks the user into a rejection, which is the half of #262 the
 * customer actually experiences.
 */
export function attachmentAcceptList(
  documentTypes: readonly string[],
): string[] {
  return [...ALLOWED_IMAGE_TYPES, ...documentTypes];
}
