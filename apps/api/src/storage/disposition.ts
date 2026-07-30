/**
 * #317 — whether a signed URL lets the browser RENDER the bytes or makes it save
 * them, decided in ONE place.
 *
 * WHY THIS IS ONE FUNCTION AND NOT A FLAG AT EACH CALL SITE. This product is a
 * conduit between a business and members of the public who are strangers to it:
 * anyone who knows the number can send a file, because the number is printed on a
 * truck. We store it, sign it, and hand it to a tech's phone and the office
 * manager's laptop — so if the file is malicious, we are the delivery mechanism
 * and the customer's antivirus names us.
 *
 * The allow-list plus the magic-byte check already refuse the wrong file TYPE.
 * What they cannot refuse is a malicious file of an ALLOWED type, and the list
 * necessarily includes the formats that carry payloads: PDF, and the OpenXML/ODF
 * family, which are ZIP containers. Forcing a download on those is the cheap half
 * of the mitigation — nothing renders in a privileged origin, and the viewer's own
 * sandbox decides what happens next rather than ours.
 *
 * There are five places that mint a signed URL. When the rule lived at one of
 * them, the other four each had an implicit, undocumented, and silently different
 * answer. `disposition.test.ts` enumerates them from the filesystem so a sixth
 * cannot appear without deciding.
 *
 * HOW IT WORKS ON THE WIRE. supabase-js appends `download` to the signed URL as a
 * query parameter (not a field in the sign request), and Storage turns that into
 * `Content-Disposition: attachment` on the response. Verified against a real
 * Storage server, both directions: with the parameter the response carries the
 * header, without it there is no disposition header at all and the browser decides
 * — which is what inline rendering needs.
 */
import { isAllowedImageType } from "@loonext/shared";

/**
 * Audio types we write OURSELVES and play with `<audio controls>`.
 *
 * Only `audio/mpeg` today: voicemail is stored by `inbound-ring.ts` with that
 * exact type from a Telnyx recording we fetched. This is not a list of audio the
 * public may upload — the attachment allow-list governs that, and it admits no
 * audio at all. Forcing a download here would break voicemail playback on all
 * three clients, replacing a play button with a save dialog.
 */
export const INLINE_AUDIO_TYPES: readonly string[] = ["audio/mpeg"];

/**
 * May the browser render these bytes in place?
 *
 * Inline is the NARROW case and the default is a download, so a type nobody has
 * thought about yet gets the safe answer automatically.
 *
 * An ABSENT or unrecognised type is not inline-safe: a legacy row with no
 * `content_type` gets a download rather than whatever the browser decides to do
 * with unknown bytes. `typeof` rather than a null check because a row that simply
 * lacks the column reads as `undefined`, and an unguarded `.trim()` on that turns
 * a signed-URL mint into a 500 — which it briefly did.
 */
export function rendersInlineSafely(
  contentType: string | null | undefined,
): boolean {
  if (typeof contentType !== "string") return false;
  const type = contentType.trim().toLowerCase();
  // Images: the thread renders a photo of a broken furnace with `<img src>`, and
  // forcing a download would replace the product's most common interaction with a
  // file-save dialog. They are also the lower-risk half — SVG is not in the
  // allow-list, and SVG is the format that actually executes in a document
  // context. A JPEG goes to the browser's image decoder, not its parser.
  return isAllowedImageType(type) || INLINE_AUDIO_TYPES.includes(type);
}

/**
 * The options object to hand `createSignedUrl`, so the decision travels with the
 * mint instead of being a boolean a caller has to remember to invert.
 */
export function dispositionOptions(contentType: string | null | undefined): {
  download: boolean;
} {
  return { download: !rendersInlineSafely(contentType) };
}
