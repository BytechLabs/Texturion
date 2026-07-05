/**
 * Marketing/app host split (D27) as a pure function, unit-testable without
 * Next request machinery — the middleware's FIRST gate.
 *
 * One Next app, one Worker, two hostnames:
 *   loonext.app (+ www)  → the marketing site ONLY
 *   app.loonext.app      → the product (app/auth/onboarding) ONLY
 *
 * The split activates only when NEXT_PUBLIC_APP_ORIGIN is set (production).
 * Unset — local dev, CI, previews — every route stays reachable on one origin
 * and this module returns null for everything. Requests from a host matching
 * NEITHER origin (workers.dev previews, custom setups) also pass through.
 *
 * Marketing pages keep linking to the app with relative paths (/login,
 * /signup — see APP_LINKS): on the marketing host the middleware hops them to
 * the app origin, so no component knows about hostnames. www canonicalizes to
 * the apex for free.
 */
import { SITE_URL } from "@/lib/marketing/site";
import { isAuthPage, isProtectedPath } from "@/lib/auth/redirects";

/**
 * App-surface paths beyond the protected + auth sets: the recovery/invite
 * pages (reachable signed-out), the Supabase callback, the Stripe Checkout
 * return target, and the /join signup alias.
 */
const EXTRA_APP_PREFIXES = [
  "/update-password",
  "/invite",
  "/auth",
  "/dashboard",
  "/join",
] as const;

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Every path that belongs on the app host (everything else is marketing). */
export function isAppSurfacePath(pathname: string): boolean {
  return (
    isProtectedPath(pathname) ||
    isAuthPage(pathname) ||
    EXTRA_APP_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))
  );
}

/**
 * Decide the cross-host redirect (an absolute URL) for a request, or null to
 * pass through. Never throws: a malformed appOrigin disables the split rather
 * than breaking every request.
 */
export function decideHostRedirect(args: {
  host: string | null;
  pathname: string;
  search: string;
  appOrigin: string | undefined;
}): string | null {
  const { host, pathname, search, appOrigin } = args;
  if (!appOrigin || !host) return null;

  let appHost: string;
  let appBase: string;
  try {
    const parsed = new URL(appOrigin);
    appHost = parsed.host.toLowerCase();
    appBase = parsed.origin;
  } catch {
    return null; // misconfigured origin → no gating, never a broken site
  }
  const marketingHost = new URL(SITE_URL).host.toLowerCase();
  const requestHost = host.toLowerCase();

  if (requestHost === appHost) {
    // The portal's root is the For-You home (the auth middleware bounces
    // signed-out visitors to /login from there).
    if (pathname === "/") return `${appBase}/for-you`;
    if (isAppSurfacePath(pathname)) return null;
    // Marketing (or unknown) path on the app host → the canonical site.
    return `${SITE_URL}${pathname}${search}`;
  }

  if (requestHost === marketingHost || requestHost === `www.${marketingHost}`) {
    if (isAppSurfacePath(pathname)) return `${appBase}${pathname}${search}`;
    // www → apex canonicalization (SEO: one canonical marketing origin).
    if (requestHost !== marketingHost) return `${SITE_URL}${pathname}${search}`;
    return null;
  }

  return null; // unknown host (previews, tunnels) → untouched
}
