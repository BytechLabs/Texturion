/**
 * OAuth (Google + Apple) sign-in helpers (D18 / APP-FEATURES-V2 §1.3).
 *
 * The "Continue with Google/Apple" buttons use Supabase Auth's PKCE flow:
 *   supabase.auth.signInWithOAuth({ provider, options: { redirectTo } })
 * The provider redirects back to the Next.js Route Handler GET /auth/callback,
 * which runs exchangeCodeForSession and routes on membership (existing company →
 * /inbox; no company → onboarding, handled by CompanyProvider). See
 * app/auth/callback/route.ts.
 *
 * This module holds the PURE, framework-free pieces (URL construction + next
 * sanitizing) so they are unit-testable without the browser or Supabase.
 *
 * NOTE (deploy runbook, not code): the Google/Apple provider credentials are a
 * Supabase-dashboard config item, NOT shipped in this bundle. Google needs a
 * Cloud OAuth 2.0 Web client (authorized redirect URI = the Supabase project's
 * `…/auth/v1/callback`); Apple needs a Services ID + Sign-in-with-Apple Key +
 * Team ID. Both must list JobText's prod + preview origins in the Supabase Auth
 * redirect allow list. No provider secret ever reaches the browser (D8) — the
 * frontend gets only NEXT_PUBLIC_SUPABASE_URL + publishable key.
 */

import { safeNextPath } from "./redirects";

/** The OAuth providers JobText offers alongside email/password (D18). */
export type OAuthProvider = "google" | "apple";

/** The path the callback Route Handler lives at (apps/web). */
export const AUTH_CALLBACK_PATH = "/auth/callback";

/**
 * Build the `redirectTo` URL for signInWithOAuth: an absolute URL to the
 * callback route on the *current* origin, carrying a sanitized `?next=`. The
 * provider will append `?code=…` (and Supabase merges the query), so the
 * callback receives both `code` and `next`.
 *
 * `next` is passed through `safeNextPath` (same-origin relative path only) here
 * AND re-validated in the route handler — defense in depth against an open
 * redirect (a crafted `redirectTo` that smuggles an off-site `next`).
 */
export function oauthRedirectTo(origin: string, next?: string | null): string {
  const safeNext = safeNextPath(next);
  const url = new URL(AUTH_CALLBACK_PATH, origin);
  url.searchParams.set("next", safeNext);
  return url.toString();
}
