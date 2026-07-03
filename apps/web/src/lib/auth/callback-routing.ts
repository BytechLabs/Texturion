/**
 * Pure routing logic for the OAuth callback Route Handler (D18 /
 * APP-FEATURES-V2 §1.3–1.4), extracted so the branching is unit-testable
 * without Next request/response or a live Supabase client.
 *
 * The handler (app/auth/callback/route.ts) does exactly three things and
 * delegates every *decision* here:
 *   1. Read `code`, `next`, and any provider `error` from the URL.
 *   2. If there's a code and no provider error, exchangeCodeForSession(code).
 *   3. Redirect to the path this module returns.
 *
 * The membership fork (existing company → /inbox; no company → onboarding) is
 * NOT decided here: after the session cookie is set, the app's CompanyProvider
 * already routes a member with zero memberships to /onboarding (see
 * lib/company/provider.tsx). So a *successful* exchange always lands on `next`
 * (default /inbox), and the existing tenancy logic takes it from there — OAuth
 * changes how you authenticate, never how a tenant is created (D18). We never
 * auto-create a company from an OAuth login.
 */

import { safeNextPath } from "./redirects";

/** Where the callback should send a failed OAuth attempt. */
export const OAUTH_ERROR_REDIRECT = "/login?error=oauth";

export interface CallbackInput {
  /** The `?code=` PKCE code, if the provider returned one. */
  code: string | null | undefined;
  /** The sanitized post-login target (default /inbox). */
  next: string | null | undefined;
  /** A provider-side `?error=` (user denied consent, config problem, …). */
  providerError?: string | null;
  /** True iff exchangeCodeForSession succeeded (the handler runs it). */
  exchangeOk?: boolean;
}

/**
 * Decide the final redirect for a callback request.
 *
 * - Provider returned an error, or no `code` at all, or the code exchange
 *   failed → back to /login with a calm `?error=oauth` (§1.3).
 * - Otherwise → the sanitized `next` (same-origin relative path only; default
 *   /inbox). CompanyProvider then forks inbox vs onboarding on membership.
 */
export function resolveCallbackRedirect(input: CallbackInput): string {
  const { code, next, providerError, exchangeOk } = input;

  if (providerError) return OAUTH_ERROR_REDIRECT;
  if (!code) return OAUTH_ERROR_REDIRECT;
  if (exchangeOk === false) return OAUTH_ERROR_REDIRECT;

  return safeNextPath(next);
}
