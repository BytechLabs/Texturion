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
  /*
   * The policy, in the order it grew.
   *
   * `frame-ancestors` is clickjacking: no site may frame the app or the
   * marketing pages. X-Frame-Options below is the legacy fallback for older
   * engines.
   *
   * #577 added the three directives that need NO per-request nonce, which is
   * the whole reason they could ship on their own:
   *
   *   base-uri 'self'     an injected `<base href>` silently re-points every
   *                       relative URL on the page — every script src, every
   *                       form target — without touching any of them. It is
   *                       the cheapest way to turn one injected tag into a
   *                       whole-page rewrite, and nothing here sets `<base>`.
   *   object-src 'none'   `<object>`/`<embed>` are plugin content with their
   *                       own execution rules. The product has none; a repo
   *                       scan finds zero tags (the one `object` hit is a
   *                       TypeScript type annotation).
   *   form-action 'self'  stops an injected form POSTing credentials to
   *                       another origin. Verified safe first: every form in
   *                       this app is `method="post"` with NO `action`, so
   *                       they all already submit to their own URL, and the
   *                       Stripe and OAuth flows are redirects rather than
   *                       cross-origin form posts.
   *
   * STILL ABSENT FROM THIS HEADER, deliberately: `script-src`. It needs a
   * per-request nonce, and nothing static can carry one — so it lives in
   * `csp.ts` and is emitted by middleware as a SECOND, report-only header. Two
   * CSP headers are not a compromise: a browser enforces every policy it is
   * given, so if that one is ever dropped the product is exactly as protected
   * as this line makes it.
   *
   * It is not half-shipped here because the only way to make a `script-src`
   * pass on this app without a nonce is `unsafe-inline`, and a policy that
   * permits what it exists to forbid is worse than an honest short one — it
   * reads as protection in every audit that greps for the header.
   */
  {
    key: "Content-Security-Policy",
    value: [
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
      "form-action 'self'",
    ].join("; "),
  },
  { key: "X-Frame-Options", value: "DENY" },
  // Never MIME-sniff a response into an executable type.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // HTTPS only, TWO years, subdomains included (loonext.com and the app/api
  // hosts all terminate TLS at Cloudflare), preload-eligible (#118 — the
  // "strong HSTS" bar: max-age >= 1y + includeSubDomains + preload). Browsers
  // ignore HSTS on plain-HTTP responses, so local `next dev` is unaffected.
  //
  // Two years rather than one because THE PIN HAS TO OUTLIVE THE COOKIE IT IS
  // PROTECTING. The Supabase session cookie has a 400-day lifetime that the
  // library re-pins after our own options are applied, so it cannot be shortened
  // from the client construction — and it carries the refresh token, i.e. the
  // whole session. A 365-day pin left a 35-day window in which a browser that
  // had not revisited would send that cookie over plain HTTP if anything ever
  // stripped the `Secure` flag. Now the pin is the longer of the two, so the
  // cookie can never outlive its own protection.
  //
  // Raising this is close to one-way: a browser that sees it pins for two years
  // and lowering the number only takes effect on its next visit. That is
  // acceptable here because the product is HTTPS-only and has been for its whole
  // life; there is no plain-HTTP surface a pin could break.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // Origin isolation (#118): no page here opens popups it needs to script
  // (OAuth, Stripe Checkout, and the billing portal are all redirect flows;
  // repo-wide grep finds zero window.open), so the strictest value is free.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Full URL only to same-origin destinations; origin only cross-origin —
  // conversation/contact UUIDs in paths never leak to third parties.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Deny powerful features nothing in the product uses, but ALLOW the
  // microphone for our OWN origin (self) — the D43 browser softphone
  // (@telnyx/webrtc) calls getUserMedia({audio:true}) to place/receive calls,
  // and a `microphone=()` policy blocks that with
  // MEDIA_MICROPHONE_PERMISSION_DENIED before any SIP INVITE is sent. `(self)`
  // keeps the mic denied to any embedded third-party frame; camera stays off
  // (audio-only calling). The app's other features (Contact Picker, clipboard
  // paste, Web Push) aren't governed by these directives.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=()",
  },
];
