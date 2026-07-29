/**
 * #335 / D75 — the middleware every public page sits behind.
 *
 * These routes are OUTSIDE the CORS → JWT → company chain that protects /v1.
 * There is no token to verify, no company to scope to, and no member to hold
 * responsible: the caller is a homeowner who has never heard of us, or a
 * script walking the keyspace, and nothing in the request distinguishes them.
 *
 * So the guard does the four things the issue names, in one place, so that the
 * first feature to use it cannot skip one and the fourth cannot do it
 * differently:
 *
 *   1. RATE LIMIT, keyed on IP. There is no account to key on — that is the
 *      point of the surface. This is the only thing standing between a
 *      guessed-URL attempt and unlimited guesses.
 *   2. NOINDEX, on the response and unconditionally. A quote for a named
 *      homeowner turning up in a search result is a breach of somebody who
 *      never agreed to anything with us, and `robots.txt` does not stop a
 *      crawler that already has the URL.
 *   3. NO CACHING BY ANYTHING IN BETWEEN. These pages carry a third party's
 *      address and phone number; a shared cache holding one is the same
 *      disclosure with more copies.
 *   4. ONE FAILURE PAGE FOR EVERY FAILURE. Expired, revoked, spent, wrong
 *      purpose, never existed — the holder is told the same thing, because a
 *      holder who can distinguish them has been handed an oracle.
 */
import type { Context, MiddlewareHandler, Next } from "hono";

import type { AppEnv } from "../context";
import { getEnv } from "../env";

/**
 * Headers every public response carries.
 *
 * `noarchive`/`nosnippet` alongside `noindex`: a search engine that has already
 * fetched a page can surface a cached copy or a snippet of it even after
 * agreeing not to index, and the snippet is where the customer's name would be.
 */
export const PUBLIC_PAGE_HEADERS: Record<string, string> = {
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
  "Cache-Control": "no-store, private",
  "Referrer-Policy": "no-referrer",
};

/** Where the request came from, for the limiter key and the access log. */
export function callerIp(c: Context<AppEnv>): string {
  return (
    c.req.header("CF-Connecting-IP") ??
    c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

/** Cloudflare's country for this request, for enumeration patterns. */
export function callerCountry(c: Context<AppEnv>): string | null {
  const cf = (c.req.raw as { cf?: Record<string, unknown> }).cf;
  const value = cf?.country;
  return typeof value === "string" && value.length === 2 ? value : null;
}

/**
 * Mount on every public route.
 *
 * Applies the headers first — so even a 429 or a crash carries them — then the
 * limit. A rate-limited response that was indexable would be its own leak of
 * which URLs exist.
 */
export function publicLinkGuard(): MiddlewareHandler<AppEnv> {
  return async (c: Context<AppEnv>, next: Next) => {
    for (const [name, value] of Object.entries(PUBLIC_PAGE_HEADERS)) {
      c.header(name, value);
    }

    const env = getEnv(c.env);
    const limiter = env.PUBLIC_LINK_RATE_LIMITER;
    if (limiter) {
      const { success } = await limiter.limit({ key: `public-link:${callerIp(c)}` });
      if (!success) {
        // Deliberately the same body as a bad token. A distinct "slow down"
        // tells a script it is on the right track; this tells it nothing.
        return c.json({ error: { code: "not_found", message: "This link isn't available." } }, 404);
      }
    }

    await next();
  };
}

/**
 * The one response a failed public link ever produces.
 *
 * Exported so no route can invent a second one. Every reason — expired,
 * revoked, spent, wrong purpose, never existed — produces this, because the
 * difference between them is information the holder has not earned.
 */
export function publicLinkNotAvailable(c: Context<AppEnv>) {
  return c.json(
    {
      error: {
        code: "not_found",
        message:
          "This link isn't available. It may have expired, or already been used. " +
          "Ask the business to send you a new one.",
      },
    },
    404,
  );
}
