/**
 * Cookie options for every @supabase/ssr client, in its own module.
 *
 * Separate from `browser.ts` because middleware imports it, and middleware runs
 * on the edge: reaching into the browser module would pull `createBrowserClient`
 * into that bundle to read one object.
 *
 * THREE writers, and all three must pass this. The browser client, the
 * server client, and the middleware client each write the session cookie, and
 * `Secure` is not part of a cookie's identity — so a writer that omits it
 * REPLACES the secure cookie the others set, last write wins. Middleware is the
 * one that matters most: `getUser()` is normally the first to notice an expired
 * access token, so it rewrites the cookie about once an hour. Two of three was
 * therefore not a partial fix, it was no fix — the flag would be absent for most
 * of the cookie's life.
 */
import type { CookieOptions } from "@supabase/ssr";

/**
 * Attributes every Supabase auth-cookie write uses (#581). Declared beside the
 * browser client because that is the writer nothing downstream can correct —
 * sign-in and every client-side refresh write these cookies with
 * `document.cookie`, so no Worker or response header gets a say — and imported
 * by `server.ts` (and owed to the middleware client) so the writers agree.
 *
 * `secure` is the point. @supabase/ssr 0.12.0's `DEFAULT_COOKIE_OPTIONS` is
 * `Path=/; SameSite=Lax; Max-Age=400d` and sets no `Secure` at all, while the
 * cookie value is the serialized session — the REFRESH token, not just the
 * hour-long access token. HSTS carries the transport, but `preload` in a header
 * is an eligibility claim rather than proof of list membership, and the two LESS
 * sensitive cookies in this repo (`jt-company`, `loonext.consent`) already set
 * Secure by hand. The session cookie was the one left out.
 *
 * Unconditional, unlike those two, which read `location.protocol`: these cookies
 * are written from three runtimes and two of them (Server Components / Route
 * Handlers, and middleware) have no `location`. `Secure` is not part of a
 * cookie's identity, so a writer that omits it DOWNGRADES what the others set —
 * it has to be one constant. `next dev` is unaffected: `http://localhost` is a
 * trustworthy origin, so browsers accept and send Secure cookies there.
 *
 * No `maxAge`, deliberately. The library re-pins the set path to
 * `DEFAULT_COOKIE_OPTIONS.maxAge` AFTER spreading ours, so a shorter lifetime
 * passed here is silently discarded; the 400-day cookie outliving the 365-day
 * HSTS pin closes by raising `Strict-Transport-Security`
 * (lib/observability/security-headers.ts), not from this object.
 *
 * No `name` either — it becomes the auth `storageKey`, so setting one renames
 * the cookie and signs every existing session out.
 */
export const SUPABASE_COOKIE_OPTIONS: CookieOptions = { secure: true };
