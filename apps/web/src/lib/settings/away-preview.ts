/**
 * Live preview of an owner-authored away message (FEATURE-GAPS Step 1) and of a
 * review ask (Step 2). Both reuse the SAME canonical merge substituter the
 * server applies at send time (@jobtext/shared), so the preview is exactly what
 * ships. A representative sample contact stands in for {first_name}.
 */
import { applyMergeFields } from "@jobtext/shared";

/** The sample name used to show {first_name} resolving in a preview. */
export const SAMPLE_FIRST_NAME = "Dana";

/**
 * Render the away message as a customer would receive it: {first_name} uses a
 * sample name, {business_name} uses the company name, {review_link} is dropped
 * unless a link is supplied (an away message rarely carries one). Empty/unknown
 * tokens degrade cleanly, byte-for-byte with the server.
 */
export function previewAwayMessage(
  message: string,
  businessName: string,
  reviewLink?: string | null,
): string {
  return applyMergeFields(message, {
    contactName: SAMPLE_FIRST_NAME,
    businessName,
    reviewLink: reviewLink ?? null,
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
    reviewLink: null,
  });
}

/**
 * The suggested review-ask TEMPLATE the Reviews settings page shows (raw, with
 * its merge tokens visible) so owners can save it as a template. The one-tap
 * review-ask endpoint was removed — {business_name}/{review_link} merge
 * server-side on every ordinary send instead.
 */
export const DEFAULT_REVIEW_MESSAGE =
  "Thanks for choosing {business_name}! A quick Google review means a lot: {review_link}";
