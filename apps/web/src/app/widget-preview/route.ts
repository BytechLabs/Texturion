/**
 * #232 — what the button will actually look like, before it goes on a website.
 *
 * The issue's first build item asks for "copy-paste from Settings with a live
 * preview", and the word doing the work is LIVE. A picture of the widget is a
 * picture that goes stale the first time somebody changes a colour; this loads
 * the same `widget.js` an owner is about to paste, so what they are looking at
 * IS the thing.
 *
 * ## Why a route handler and not a page
 *
 * The preview has to run a script the app's own Content-Security-Policy would
 * eventually refuse. `script-src` is `'self' 'nonce-…' 'strict-dynamic'`, and
 * under `strict-dynamic` the `'self'` is IGNORED — only a nonce'd tag loads. A
 * React page would therefore need the request nonce threaded into a raw script
 * tag, which couples the preview to middleware internals for no gain.
 *
 * A route handler returns its own document with its own policy: `'self'` and
 * nothing else, which is exactly and only what this page needs. It is also why
 * the preview is a separate document rather than an inline mount — `widget.js`
 * attaches itself to `document.body` with fixed positioning, so mounting it in
 * the settings page would float a launcher over the whole app.
 *
 * ## No key, deliberately
 *
 * `data-key` here is the literal string `preview`. The real key is a credential
 * and putting it in a URL would write it into every access log between here and
 * the browser, to show somebody a button they are already looking at. Nothing
 * in this document ever submits: the owner is checking how it LOOKS, and the
 * verify endpoint refuses an unknown key anyway.
 *
 * ## The locale rides in the query string
 *
 * A route handler has no React context to read the reader's language from, and
 * `?lang=` is a fact about the page rather than about the person — nothing
 * identifying goes in this URL. The card passes what it is already rendering
 * in, so the preview does not sit in English inside a French settings page.
 */
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@loonext/shared";

import { CATALOGS } from "@/i18n/catalog";

/**
 * The stand-in page's own styling, held OUTSIDE the markup template.
 *
 * `check-hardcoded-strings` reads text between a `>` and the next `<` as
 * user-facing copy, which it cannot distinguish from a stylesheet sitting
 * inside a template literal — it reported the selectors `html, body` and `body`
 * as strings needing translation. The same heuristic bit widget-snippet.ts.
 * Interpolating a constant leaves nothing between the tags for it to read, and
 * the CSS is more legible on its own anyway.
 */
const PREVIEW_CSS = [
  "html,body{margin:0;height:100%}",
  // A neutral stand-in for a customer's page rather than our own palette: the
  // point is to show the widget against a site that is not ours.
  "body{background:#f4f1ec;color:#5b6157;" +
    "font:14px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif}",
  ".hint{position:absolute;inset:auto auto 12px 14px;margin:0;font-size:12px}",
].join("");

function localeFrom(url: string): Locale {
  const asked = new URL(url).searchParams.get("lang");
  return (LOCALES as readonly string[]).includes(asked ?? "")
    ? (asked as Locale)
    : DEFAULT_LOCALE;
}

/**
 * The catalogue directly, not `makeTranslate`.
 *
 * `i18n/provider.tsx` is a `"use client"` module, so calling its helper from a
 * route handler throws "attempted to call makeTranslate() from the server" —
 * at request time, not at build. `catalog.ts` is plain data and safe on both
 * sides, and this document needs two keys with no interpolation.
 */
const documentFor = (locale: Locale) => {
  const words = CATALOGS[locale].settings as Record<string, string>;
  const t = (key: string) => words[key] ?? key;
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t("widgetPreviewTitle")}</title>
<style>${PREVIEW_CSS}</style>
</head>
<body>
<p class="hint">${t("widgetPreviewHint")}</p>
<script src="/widget.js" data-key="preview" data-lang="${locale}" defer></script>
</body>
</html>`;
};

export function GET(request: Request) {
  return new Response(documentFor(localeFrom(request.url)), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // This document's own policy, not the app's. It loads one same-origin
      // script and nothing else, so it can say so precisely — and saying it
      // here means the preview keeps working when the app's `strict-dynamic`
      // policy stops being report-only.
      "content-security-policy":
        "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; " +
        "img-src 'self' data:; connect-src 'self'; base-uri 'none'; " +
        // Only our own settings page frames this. A preview of somebody's
        // "Text us" button is not sensitive, but a document that anyone may
        // frame is a document somebody will frame over something that is.
        "frame-ancestors 'self'",
      "cache-control": "public, max-age=3600",
    },
  });
}
