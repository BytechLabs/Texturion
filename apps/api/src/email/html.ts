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
 * The address a human actually reads (#252).
 *
 * Deliberately a constant here rather than an env var: it appears in the
 * footer of every transactional email, so a missing or mistyped variable would
 * silently ship the void this exists to close. It matches
 * `apps/web/src/lib/marketing/business.ts`'s SUPPORT_EMAIL, which is where the
 * customer-facing copy says the same thing.
 */
const SUPPORT_EMAIL = "support@loonext.com";

/**
 * Wrap already-built body HTML in Loonext's shared transactional-email layout
 * (#88): a centered, single-column, table-based container with the Loonext
 * wordmark, readable typography, and a quiet footer. Deliberately email-client
 * safe — tables + INLINE styles only (Gmail/Outlook strip <style>/<head> CSS),
 * a light background, system fonts, and the Paper & Olive brand (#206): ink
 * #191B14 text, #3A430F links (AA at 16px), and the wordmark rule — "Loonext" in
 * SemiBold with ONLY the second o in olive, as a text span, never an image.
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
    `<body style="margin:0;padding:0;background-color:#F3F3EE;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F3F3EE;width:100%;">` +
    `<tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background-color:#FDFDF9;border:1px solid #E8E8E0;border-radius:12px;">` +
    // Wordmark header: Golos Text SemiBold when available, second o olive (#206).
    `<tr><td style="padding:28px 32px 4px 32px;font-family:'Golos Text',${EMAIL_FONT};">` +
    `<span style="font-size:20px;font-weight:600;letter-spacing:-0.02em;color:#191B14;">Lo<span style="color:#66801F;">o</span>next</span>` +
    `</td></tr>` +
    // Body copy.
    `<tr><td style="padding:4px 32px 8px 32px;font-family:${EMAIL_FONT};font-size:16px;line-height:1.6;color:#191B14;">` +
    bodyHtml +
    `</td></tr>` +
    // Quiet footer.
    `<tr><td style="padding:20px 32px 28px 32px;border-top:1px solid #F0F0E8;font-family:${EMAIL_FONT};font-size:13px;line-height:1.5;color:#6E7163;">` +
    `This is a service message about your Loonext account.<br>` +
    // #252: every one of these is sent from a no-reply address, and a customer
    // replying to it was replying into a void — which from their side is
    // indistinguishable from being ignored. Naming the address that IS read is
    // the cheap half of that fix and does not depend on any inbox routing we
    // would have to verify first: the worst case is somebody writes to a
    // monitored address instead of an unmonitored one.
    `Replies to this address are not read — write to ` +
    `<a href="mailto:${SUPPORT_EMAIL}" style="color:#3A430F;">${SUPPORT_EMAIL}</a>` +
    ` and a person will answer.<br>` +
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
    // #362/#238: #3A430F, not the #66801F wordmark olive. A link is 16px body
    // text, so it needs 4.5:1 — olive is 4.41:1 on this card and fails. The
    // wordmark above keeps #66801F because at 20px/600 it is large text, where
    // the bar is 3:1. Same palette, two different bars.
    '<a href="$1" style="color:#3A430F;text-decoration:underline;">$1</a>',
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
