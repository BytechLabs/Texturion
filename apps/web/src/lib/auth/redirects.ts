/**
 * Middleware redirect policy (G12, SPEC §10) as a pure function so the logic
 * is unit-testable without Next request machinery.
 *
 * - App + onboarding routes require a session → bounce to /login?next=…
 * - Auth pages bounce signed-in users to /for-you (the default landing,
 *   PORTAL-UX §3.1).
 * - /update-password and /invite/[token] are reachable in BOTH states: the
 *   recovery/invite links establish the session client-side after load, so
 *   the middleware must not bounce them.
 */

/** URL prefixes of the (app) route group + onboarding (route groups don't
 *  appear in URLs). EVERY (app) page directory must be listed: an omission
 *  double-fails — signed-out visitors aren't bounced to /login, AND the D27
 *  host split classifies the path as marketing, 308ing app.loonext.com to
 *  the apex where the shell can never authenticate (#133: /calls shipped in
 *  D37 without this registration and was unreachable in production).
 *  app-routes-registered.test.ts derives the list from the filesystem so the
 *  next new route cannot repeat this. */
const PROTECTED_PREFIXES = [
  "/for-you",
  "/inbox",
  "/calls",
  "/tasks",
  "/contacts",
  "/templates",
  "/settings",
  "/onboarding",
] as const;

/** Pages that only make sense signed out. */
const AUTH_PAGES = ["/login", "/signup", "/reset-password"] as const;

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
}

export function isAuthPage(pathname: string): boolean {
  return AUTH_PAGES.some((prefix) => matchesPrefix(pathname, prefix));
}

export interface AuthRedirect {
  pathname: string;
  search: string;
}

/**
 * Decide where (if anywhere) to redirect a request. Returns null when the
 * request should pass through.
 */
export function decideAuthRedirect(
  pathname: string,
  isAuthenticated: boolean,
): AuthRedirect | null {
  if (!isAuthenticated && isProtectedPath(pathname)) {
    const search =
      pathname === "/for-you" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return { pathname: "/login", search };
  }
  if (isAuthenticated && isAuthPage(pathname)) {
    return { pathname: "/for-you", search: "" };
  }
  return null;
}

/**
 * Validate a ?next= target from the URL: only same-origin absolute paths are
 * honored (open-redirect guard). Falls back to /inbox.
 *
 * The WHATWG URL parser treats a backslash as a forward slash, so `/\evil.com`
 * (and `/\/evil.com`) resolve to the protocol-relative `//evil.com` when the
 * callback handler does `new URL(next, origin)` — an off-site redirect. So,
 * beyond the leading-slash / no-`//` check, reject ANY backslash and ANY
 * control char or space (code point <= 0x20: CR/LF/tab/space are stripped by
 * the parser and can re-expose a `//` or a scheme). A genuine same-origin path
 * (`/inbox/abc-123`, `/settings/billing`) has none of these and passes intact.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next) return "/for-you";
  // A single leading slash, but not `//` (protocol-relative).
  if (!next.startsWith("/") || next.startsWith("//")) return "/for-you";
  for (let i = 0; i < next.length; i++) {
    const code = next.charCodeAt(i);
    if (code <= 0x20 || code === 0x5c /* backslash */) return "/for-you";
  }
  return next;
}
