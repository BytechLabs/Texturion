/**
 * Which paths belong to the product (app, auth, onboarding) rather than the
 * marketing site. The D27 host split in lib/hosts.ts routes on it, and the
 * browser telemetry boot reads it to tell the app from a marketing page. It
 * imports nothing heavier than the auth path lists, so client code can use it.
 */
import { isAuthPage, isProtectedPath } from "@/lib/auth/redirects";

/**
 * App-surface paths beyond the protected + auth sets: the recovery/invite
 * pages (reachable signed-out), the Supabase callback, the Stripe Checkout
 * return target, the /join signup alias, and the native clients' Turnstile
 * page — /native-captcha MUST stay on app.loonext.com because the site key
 * validates the widget's hostname and both mobile WebViews hard-code the app
 * host (#258).
 */
const EXTRA_APP_PREFIXES = [
  "/update-password",
  "/invite",
  "/auth",
  "/dashboard",
  "/join",
  "/native-captcha",
  // #559: a shared job-photos link (D75). Here rather than in
  // PROTECTED_PREFIXES, deliberately — the person opening it is a homeowner with
  // no account, and protecting it would bounce them to /login. What this fixes
  // is that the API mints the URL on the app host and, being on neither list, it
  // was 308ed to the marketing apex — where it picked up an hour of shared-cache
  // TTL and kept opening after the crew revoked it.
  "/photos",
  // #224: the payment page a homeowner opens (D75). Here for exactly the same
  // reason /photos is: the person opening it has no account, so
  // PROTECTED_PREFIXES would bounce them to /login — and the API mints the URL
  // on the app host, so without this it would 308 to the marketing apex and
  // pick up an hour of shared-cache TTL on a page that has to stop opening the
  // moment the bill is paid.
  "/pay",
  // The website button's live preview, framed by Settings on the app host. On
  // neither list it was 308ed to the marketing apex, which only lets itself
  // frame its pages, so Settings showed "loonext.com refused to connect".
  "/widget-preview",
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
