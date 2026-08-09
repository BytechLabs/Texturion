import { createMiddleware } from "hono/factory";

import type { AppEnv } from "../context";

/**
 * #586 — security response headers for the API Worker, which had none at all.
 *
 * Measured on the wire against production rather than inferred, because the absence
 * of a module is not something a code search surfaces. On 2026-08-09 neither
 * `GET /health` (200) nor `GET /v1/conversations` (401) carried `Cache-Control`,
 * `X-Content-Type-Options`, `Referrer-Policy` or an HSTS header, with or without a
 * bearer token, and Cloudflare added none of them in front. The web Worker sends a
 * full set from `apps/web/src/lib/observability/security-headers.ts`; this side had
 * no analogue, and the only two places in `apps/api/src` that touched a response
 * header at all were the public-link guard and the app-release endpoint.
 *
 * ## What is here and what is deliberately not
 *
 * `Cache-Control` is the one that matters and the reason this is not just hygiene.
 * An authenticated `/v1` response is one customer's conversations, and nothing marked
 * it non-storable — a shared cache or an intermediary would have been within its
 * rights to keep a copy. It is the DEFAULT here rather than a fixed value, because
 * two routes legitimately differ and a well-meaning blanket header would have broken
 * one of them silently (see below).
 *
 * `nosniff` is cheap and worth having: JSON carrying customer content, served without
 * it, is one browser quirk away from being treated as something else.
 *
 * `Referrer-Policy: no-referrer` rather than the web's `strict-origin-when-cross-origin`.
 * An API has no pages and no links, so there is no navigation that should ever carry
 * a referrer anywhere; the strictest value costs nothing here.
 *
 * NOT `X-Frame-Options`, `Content-Security-Policy: frame-ancestors` or
 * `Cross-Origin-Opener-Policy`. All three govern rendering, and nothing this Worker
 * returns is rendered — they would be a longer header list that reads as more
 * protection without being any.
 *
 * ## HSTS, and the thing that turned out not to be true
 *
 * The apex sends `includeSubDomains; preload`, and the assumption was that this host
 * was therefore covered. Half right. `includeSubDomains` does cover `api.loonext.com`
 * — but only for a browser that has already been to the apex, which is not true of a
 * fresh client or a non-browser caller.
 *
 * The `preload` half is not true at all: `preload` in a header is an ELIGIBILITY
 * ASSERTION, not membership, and checking the actual list on 2026-08-09
 * (`hstspreload.org/api/v2/status?domain=loonext.com`) returned `"status": "unknown"`
 * — the domain has never been submitted. Written down here so the next person does
 * not re-derive it from our own header, which is exactly what makes this one easy to
 * get wrong.
 *
 * So this host sends its own, and without `preload`: asserting eligibility we have
 * not claimed is the same mistake one level down.
 */
export const API_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  // Two years with subdomains, matching the apex, minus `preload` — see above.
  // Browsers ignore HSTS on plain-HTTP responses, so local dev is unaffected.
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
};

/**
 * What an API response is, unless it says otherwise: one customer's data, for one
 * customer, kept by nobody.
 */
export const DEFAULT_CACHE_CONTROL = "private, no-store";

/**
 * Apply the headers to every response, without overwriting a route that has decided
 * for itself.
 *
 * SET-IF-ABSENT IS THE WHOLE DESIGN. Two routes deliberately send a different
 * `Cache-Control` and both are correct:
 *
 *   - the public-link guard sends `no-store, private` (its own spelling, same
 *     meaning) alongside the robots and referrer headers a shared page needs;
 *   - the app-release endpoint sends `public, max-age=300` on purpose, because every
 *     client reads the update policy on every cold start and that is the difference
 *     between a free lookup and a database round trip per launch.
 *
 * A blanket `private, no-store` would have made the second one uncacheable and
 * nothing would have failed — just a quiet per-launch cost, which is precisely the
 * kind of regression a default introduces and nobody attributes.
 */
export function securityHeaders() {
  return createMiddleware<AppEnv>(async (c, next) => {
    await next();
    for (const [key, value] of Object.entries(API_SECURITY_HEADERS)) {
      if (!c.res.headers.has(key)) c.res.headers.set(key, value);
    }
    if (!c.res.headers.has("Cache-Control")) {
      c.res.headers.set("Cache-Control", DEFAULT_CACHE_CONTROL);
    }
  });
}
