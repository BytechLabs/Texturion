/**
 * Pure logic for the credential-change flows (D18 / APP-FEATURES-V2 §1.5–1.6),
 * separated from the React form so the branching is unit-testable.
 *
 * PASSWORD CHANGE (§1.6): Supabase "Secure password change" is ON — it requires
 * reauthentication only when the session is older than 24h. Two-path handling:
 *   - Fresh session (or OAuth-only "Set a password"): updateUser({ password })
 *     succeeds directly.
 *   - Stale session: updateUser({ password }) fails asking for reauth →
 *     reauthenticate() emails a 6-digit nonce → updateUser({ password, nonce }).
 * The client can't reliably know the session age up front, so we ATTEMPT the
 * direct update and branch on the error code (`needsReauth`); the form then
 * collects the nonce and retries. This keeps a fresh session to one click.
 *
 * EMAIL CHANGE (§1.5): updateUser({ email }) with Supabase "Secure email change"
 * ON — confirmation is emailed to BOTH the old and new address; the change
 * commits only when both are confirmed. No nonce, no app-side mirror.
 */

/** Supabase error codes that mean "we need a fresh reauth nonce first". */
const REAUTH_REQUIRED_CODES = new Set([
  "reauthentication_needed",
  "reauthentication_required",
]);

/**
 * Given the error returned by `updateUser({ password })`, decide whether the
 * form should now run `reauthenticate()` and re-submit with a nonce (§1.6).
 * Reads the Supabase error `code` (falls back to a message sniff for older
 * SDKs that only set the message).
 */
export function needsReauth(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && REAUTH_REQUIRED_CODES.has(code)) return true;
  const message = (error as { message?: unknown }).message;
  return (
    typeof message === "string" &&
    /reauthentication/i.test(message) &&
    /require|need/i.test(message)
  );
}

/** The 6-digit reauthentication nonce Supabase emails (§1.6). */
const NONCE_PATTERN = /^\d{6}$/;

/** Trim + validate the reauth nonce the user pastes from their email. */
export function isValidNonce(nonce: string): boolean {
  return NONCE_PATTERN.test(nonce.trim());
}

export type PasswordSubmitPlan =
  | { kind: "update" } // fresh session: single updateUser call
  | { kind: "reauth_then_update"; nonce: string }; // stale: nonce required

/**
 * Decide how to submit a password change given the current form state: whether
 * we've already learned a reauth is required (`reauthRequested`) and, if so,
 * the nonce the user entered. Returns null when a required nonce is missing or
 * malformed (the form should surface a field error, not call Supabase).
 */
export function planPasswordSubmit(input: {
  reauthRequested: boolean;
  nonce: string;
}): PasswordSubmitPlan | null {
  if (!input.reauthRequested) return { kind: "update" };
  const nonce = input.nonce.trim();
  if (!isValidNonce(nonce)) return null;
  return { kind: "reauth_then_update", nonce };
}

/**
 * Whether a new email differs from the current one (normalized). An unchanged
 * email is a no-op the form should block before calling Supabase (§1.5), so we
 * never fire a pointless "confirm from both inboxes" email.
 */
export function isEmailChanged(
  current: string | null | undefined,
  next: string,
): boolean {
  const a = (current ?? "").trim().toLowerCase();
  const b = next.trim().toLowerCase();
  return b.length > 0 && a !== b;
}
