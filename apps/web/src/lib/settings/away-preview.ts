/**
 * Live preview of an owner-authored away message (FEATURE-GAPS Step 1). Reuses
 * the SAME canonical merge substituter the server applies at send time
 * (@loonext/shared), so the preview is exactly what ships. A representative
 * sample contact stands in for {first_name}.
 */
import {
  applyMergeFields,
  formatNanpNumber,
  MERGE_FIELD_SAMPLES,
} from "@loonext/shared";

/** The sample name used to show {first_name} resolving in a preview. */
export const SAMPLE_FIRST_NAME = "Dana";

/**
 * Render the away message as a customer would receive it: {first_name} uses a
 * sample name, {business_name} uses the company name. Empty/unknown tokens
 * degrade cleanly, byte-for-byte with the server.
 */
export function previewAwayMessage(
  message: string,
  businessName: string,
): string {
  return applyMergeFields(message, {
    contactName: SAMPLE_FIRST_NAME,
    businessName,
  });
}

/**
 * Render the missed-call text-back as the caller would receive it. Unlike the
 * away reply, the server sends this with NO contact name (a missed call is
 * usually a brand-new caller — apps/api missed-call.ts passes contactName:
 * null), so a typed {first_name} is dropped here exactly as it is on the wire.
 */
export function previewMissedCallText(
  message: string,
  businessName: string,
): string {
  return applyMergeFields(message, {
    contactName: null,
    businessName,
  });
}

/**
 * #274 — a TEMPLATE preview, which is a different job from the away reply's.
 *
 * An away message can only ever carry the two original tokens: it is sent by
 * the system with no member and no booked visit behind it. A saved reply is
 * written by a person for a real conversation, so all seven can appear, and the
 * preview has to show each one resolving — an unresolved {address} renders as
 * nothing, which is indistinguishable from a token that does not work.
 *
 * The samples come from @loonext/shared so all three clients teach the same
 * thing. The business name and number are the REAL ones, because those are
 * facts the workspace already knows about itself and a placeholder there would
 * be less honest than the truth.
 */
export function previewTemplate(
  message: string,
  businessName: string,
  ourNumber: string | null,
): string {
  return applyMergeFields(message, {
    ...MERGE_FIELD_SAMPLES,
    businessName,
    ourNumber: ourNumber === null ? null : formatNanpNumber(ourNumber),
  });
}
