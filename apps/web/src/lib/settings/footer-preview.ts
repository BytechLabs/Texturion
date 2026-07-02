/**
 * Client-side mirror of the SPEC §5 first-message identification footer.
 * Byte-for-byte identical to the API's composition
 * (apps/api/src/messaging/send.ts `appendIdentificationFooter`) so the live
 * preview on /settings/workspace shows exactly what the customer receives.
 */

/** The footer line appended once per contact: `— {name}. Reply STOP to opt out`. */
export function identificationFooter(businessName: string): string {
  return `— ${businessName}. Reply STOP to opt out`;
}

/**
 * A first outbound message as the customer's phone renders it: the body,
 * a newline, then the footer — footer alone when the body is empty (the API
 * never sends an empty body, but the preview must not show a stray newline
 * while the input is blank).
 */
export function firstMessagePreview(
  body: string,
  businessName: string,
): string {
  const footer = identificationFooter(businessName);
  return body.length > 0 ? `${body}\n${footer}` : footer;
}
