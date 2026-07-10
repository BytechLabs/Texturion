/**
 * Security response headers for every web route (D8 defense in depth).
 *
 * Wired into `next.config.ts` `headers()`. Delivery on Cloudflare Workers
 * (D1): `next build` bakes `headers()` into `routes-manifest.json`, and the
 * OpenNext routing layer applies that manifest on every matched response —
 * `@opennextjs/aws` `core/routingHandler.js` calls
 * `getNextConfigHeaders(event, ConfigHeaders)` and merges the result into the
 * response headers (middleware headers do NOT override them unless
 * `middlewareHeadersOverrideNextConfigHeaders` is opted into). So the set
 * below survives the `@opennextjs/cloudflare` deploy for every
 * document/route/redirect response the Worker serves. The one gap is files
 * served directly from the static-assets binding (`.open-next/assets`:
 * `/_next/static/*` + `public/`), which Cloudflare answers before the Worker
 * runs — those are immutable same-origin subresources with correct MIME
 * types, so none of these headers changes their behavior in a browser.
 */
export const SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  // Clickjacking: no site may frame the app or the marketing pages. The CSP
  // directive is the modern control; X-Frame-Options is the legacy fallback
  // for older engines. A fuller CSP (script-src etc.) needs per-request
  // nonces threaded through Next's inline runtime scripts — tracked as a
  // follow-up, not silently half-shipped here.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  // Never MIME-sniff a response into an executable type.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // HTTPS only, one year, subdomains included (loonext.com and the
  // app/api hosts all terminate TLS at Cloudflare), preload-eligible (#118 —
  // the "strong HSTS" bar: max-age >= 1y + includeSubDomains + preload).
  // Browsers ignore HSTS on plain-HTTP responses, so local `next dev` is
  // unaffected.
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload",
  },
  // Origin isolation (#118): no page here opens popups it needs to script
  // (OAuth, Stripe Checkout, and the billing portal are all redirect flows;
  // repo-wide grep finds zero window.open), so the strictest value is free.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Full URL only to same-origin destinations; origin only cross-origin —
  // conversation/contact UUIDs in paths never leak to third parties.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Deny powerful features nothing in the product uses (the app uses the
  // Contact Picker, clipboard paste, and Web Push — none are governed by
  // these directives).
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];
