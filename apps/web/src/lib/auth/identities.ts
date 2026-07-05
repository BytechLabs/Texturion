/**
 * Pure derivation of the Settings → Account "Sign-in methods" state from
 * Supabase's `user.identities` array (D18 / APP-FEATURES-V2 §1.8).
 *
 * Supabase attaches one identity per linked provider. Email/password shows up
 * as an identity with `provider === 'email'`; Google/Apple as `'google'` /
 * `'apple'`. Same verified email across them all resolves to ONE auth.users row
 * (Supabase automatic linking) — so this is a read of what's already linked, not
 * a linking manager (manual unlink is out of MVP).
 *
 * Framework-free so it is unit-testable without a live session.
 */

/** The sign-in methods Loonext surfaces, in display order (§1.8). */
export type SignInMethod = "google" | "apple" | "password";

/** The minimal identity shape we read (Supabase UserIdentity is wider). */
export interface IdentityLike {
  provider: string;
  /** Provider identity payload; Apple relay emails live here or on user.email. */
  identity_data?: Record<string, unknown> | null;
}

export interface SignInMethodState {
  method: SignInMethod;
  linked: boolean;
}

/** Supabase's identity provider string for the email/password method. */
const PASSWORD_PROVIDER = "email";

const PROVIDER_BY_METHOD: Record<SignInMethod, string> = {
  google: "google",
  apple: "apple",
  password: PASSWORD_PROVIDER,
};

/**
 * Map the identities array to the three-row present/absent list the Account
 * screen renders (§1.8). Always returns all three methods, in order, each with
 * its linked state — a "status list, not a management console."
 */
export function signInMethods(
  identities: IdentityLike[] | null | undefined,
): SignInMethodState[] {
  const present = new Set(
    (identities ?? []).map((identity) => identity.provider),
  );
  return (["google", "apple", "password"] as const).map((method) => ({
    method,
    linked: present.has(PROVIDER_BY_METHOD[method]),
  }));
}

/**
 * True when the account has NO password identity — an OAuth-only account
 * (§1.6/§1.8). Drives whether the Account screen shows "Set a password" (turns
 * an SSO account into a dual-login account) vs the normal "Change password".
 */
export function isOAuthOnly(
  identities: IdentityLike[] | null | undefined,
): boolean {
  return !(identities ?? []).some(
    (identity) => identity.provider === PASSWORD_PROVIDER,
  );
}

/** Apple's private-relay email domain (`@privaterelay.appleid.com`). */
const APPLE_RELAY_DOMAIN = "privaterelay.appleid.com";

/**
 * True when `email` is an Apple private-relay address (§1.8). Such accounts may
 * have no reachable real inbox, so the Account screen shows the email read-only
 * with a "routed through Apple" note and steers the user to "Set a password"
 * as the reliable desktop-login path rather than offering inline email edit.
 */
export function isApplePrivateRelay(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.lastIndexOf("@");
  if (at === -1) return false;
  return email.slice(at + 1).toLowerCase() === APPLE_RELAY_DOMAIN;
}
