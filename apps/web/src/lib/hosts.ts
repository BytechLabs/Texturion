/**
 * Marketing/app host split (D27) as a pure function, unit-testable without
 * Next request machinery — the middleware's FIRST gate.
 *
 * One Next app, one Worker, two hostnames:
 *   loonext.com (+ www)  → the marketing site ONLY
 *   app.loonext.com      → the product (app/auth/onboarding) ONLY
 *
 * The split activates only when NEXT_PUBLIC_APP_ORIGIN is set (production).
 * Unset — local dev, CI, previews — every route stays reachable on one origin
 * and this module returns null for everything. Requests from a host matching
 * NEITHER origin (workers.dev previews, custom setups) also pass through.
 *
 * Marketing components link to the app via APP_LINKS (site.ts), which bakes
 * NEXT_PUBLIC_APP_ORIGIN in as an absolute base when set — the Next router
 * must never RSC-prefetch an app path on the marketing host, because the
 * cross-host 30x here is invisible to a CORS preflight (#115). This redirect
 * remains the safety net for typed/bookmarked URLs. www canonicalizes to the
 * apex for free.
 */
import { BLOG_POSTS } from "@/lib/marketing/blog";
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

/** What the middleware should do with a request on the blog host. */
export type BlogRoute =
  | { kind: "rewrite"; pathname: string }
  | { kind: "redirect"; url: string };

/**
 * The blog subdomain (#130): blog.loonext.com serves the blog as its OWN
 * surface, with the posts at the host ROOT (blog.loonext.com/<slug>) instead of
 * a /blog path. Blog content is a REWRITE, not a redirect — the browser URL
 * stays on the subdomain while the app renders the existing
 * app/(marketing)/blog/* routes. The main site's loonext.com/blog keeps working
 * unchanged (canonical URLs stay loonext.com/blog/<slug> until the subdomain is
 * verified live), so this is a purely additive, SEO-safe access path.
 *
 * Everything that is NOT blog content redirects (308) to the canonical site:
 * blog pages render the shared marketing chrome, whose links are root-relative
 * (/pricing, /features, /legal/*) — on the blog host those must bounce to
 * loonext.com, not be rewritten under /blog/* where they 404. App-surface
 * paths take the same bounce; the marketing origin's own host split then hops
 * them to the app origin.
 *
 * Activates only when NEXT_PUBLIC_BLOG_ORIGIN is set (production, once the
 * Cloudflare custom domain + DNS exist). Never throws.
 *
 * Mapping on the blog host:
 *   /               → rewrite /blog        (the index)
 *   /rss.xml        → rewrite /blog/rss.xml
 *   /<known-slug>   → rewrite /blog/<slug>  (slug ∈ BLOG_POSTS registry)
 *   /blog, /blog/*  → unchanged (defensive: already-prefixed passes through)
 *   anything else   → redirect to the canonical site, search preserved
 */
export function decideBlogRoute(args: {
  host: string | null;
  pathname: string;
  search: string;
  blogOrigin: string | undefined;
}): BlogRoute | null {
  const { host, pathname, search, blogOrigin } = args;
  if (!blogOrigin || !host) return null;
  let blogHost: string;
  try {
    blogHost = new URL(blogOrigin).host.toLowerCase();
  } catch {
    return null; // misconfigured origin → no rewrite, never a broken site
  }
  if (host.toLowerCase() !== blogHost) return null;
  if (pathname === "/blog" || pathname.startsWith("/blog/")) return null;
  if (pathname === "/") return { kind: "rewrite", pathname: "/blog" };
  if (pathname === "/rss.xml") {
    return { kind: "rewrite", pathname: "/blog/rss.xml" };
  }
  const slug = pathname.slice(1);
  if (BLOG_POSTS.some((post) => post.slug === slug)) {
    return { kind: "rewrite", pathname: `/blog/${slug}` };
  }
  return { kind: "redirect", url: `${SITE_URL}${pathname}${search}` };
}
