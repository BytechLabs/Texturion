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
 * rendering of the same copy. This is the BODY only — {@link renderEmailHtml}
 * wraps it in the branded layout for a full email.
 */
export function toHtml(text: string): string {
  return `<p>${escapeHtml(text)
    .replaceAll("\n\n", "</p><p>")
    .replaceAll("\n", "<br>")}</p>`;
}

/** The one email font stack (system fonts — no web fonts in email). */
const EMAIL_FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/**
 * Wrap already-built body HTML in Loonext's shared transactional-email layout
 * (#88): a centered, single-column, table-based container with the Loonext
 * wordmark, readable typography, and a quiet footer. Deliberately email-client
 * safe — tables + INLINE styles only (Gmail/Outlook strip <style>/<head> CSS),
 * a light background, system fonts, and brand ink (#10173b) / cobalt (#2740de).
 * These are TRANSACTIONAL messages (account/billing/usage), so it stays clean
 * and trustworthy, with no marketing chrome and no unsubscribe (not required).
 * `bodyHtml` is already escaped/structured by its builder; this only frames it.
 */
export function emailLayout(bodyHtml: string): string {
  return (
    `<!DOCTYPE html>` +
    `<html lang="en"><head>` +
    `<meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light">` +
    `</head>` +
    `<body style="margin:0;padding:0;background-color:#f2f4f8;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f2f4f8;width:100%;">` +
    `<tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background-color:#ffffff;border:1px solid #e6e8ec;border-radius:12px;">` +
    // Wordmark header.
    `<tr><td style="padding:28px 32px 4px 32px;font-family:${EMAIL_FONT};">` +
    `<span style="font-size:20px;font-weight:700;letter-spacing:-0.02em;color:#2740de;">Loonext</span>` +
    `</td></tr>` +
    // Body copy.
    `<tr><td style="padding:4px 32px 8px 32px;font-family:${EMAIL_FONT};font-size:16px;line-height:1.6;color:#10173b;">` +
    bodyHtml +
    `</td></tr>` +
    // Quiet footer.
    `<tr><td style="padding:20px 32px 28px 32px;border-top:1px solid #eef1f5;font-family:${EMAIL_FONT};font-size:13px;line-height:1.5;color:#7a828c;">` +
    `This is a service message about your Loonext account.<br>` +
    `Loonext, flat-rate business texting.` +
    `</td></tr>` +
    `</table></td></tr></table>` +
    `</body></html>`
  );
}

/**
 * Turn bare http(s) URLs in already-escaped body HTML into styled links, so a
 * transactional CTA ("See usage: https://...") is clickable in every client,
 * not just the ones that auto-linkify. Runs on ESCAPED html, so a match stops
 * at the first `<` (the paragraph/break tag after the URL) and query-string
 * `&amp;` entities are carried into the href verbatim (a browser decodes them).
 */
export function linkifyUrls(escapedHtml: string): string {
  return escapedHtml.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" style="color:#2740de;text-decoration:underline;">$1</a>',
  );
}

/**
 * The common case: render plain-text email copy as a full, branded HTML email
 * (paragraph body via {@link toHtml}, URLs linkified, framed by {@link
 * emailLayout}). Callers pass the SAME text as the multipart text/plain part.
 */
export function renderEmailHtml(text: string): string {
  return emailLayout(linkifyUrls(toHtml(text)));
}
