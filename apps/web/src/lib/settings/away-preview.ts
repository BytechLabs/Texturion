/**
 * Live preview of an owner-authored away message (FEATURE-GAPS Step 1). Reuses
 * the SAME canonical merge substituter the server applies at send time
 * (@loonext/shared), so the preview is exactly what ships. A representative
 * sample contact stands in for {first_name}.
 */
import { applyMergeFields } from "@loonext/shared";

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
