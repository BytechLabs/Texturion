/**
 * Shared HTML helpers for every transactional email builder (email-hardening
 * batch). There used to be one private copy of this logic per builder file
 * (grace.ts, usage-alerts.ts, telnyx/emails.ts, messaging/inbound.ts,
 * notifications/*) and the duplication drifted: webhooks/stripe.ts built its
 * paragraph HTML WITHOUT escaping, interpolating the customer-controlled
 * company name straight into markup. Every builder now comes through here so
 * escaping cannot drift again.
 */

/**
 * Escape a string for interpolation into HTML text or double-quoted attribute
 * content. Covers the five characters with meaning in either position.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Minimal paragraph HTML for plain-text email copy: escape EVERYTHING first,
 * then blank lines become paragraph breaks and single newlines become <br>.
 * The text/plain part stays the source of truth; this is only the HTML
 * rendering of the same copy.
 */
export function toHtml(text: string): string {
  return `<p>${escapeHtml(text)
    .replaceAll("\n\n", "</p><p>")
    .replaceAll("\n", "<br>")}</p>`;
}
