/**
 * End the session on this device, properly, and everywhere it needs ending.
 *
 * ## What was wrong
 *
 * Every client ended a session by calling GoTrue `/logout` and nothing else.
 * That deletes the auth session; it does not touch `user_sessions.revoked_at`
 * and it does not sweep `member_telephony_credentials` — both of those happen
 * only inside `api_revoke_sessions`, which no sign-out path called.
 *
 * Since `api_authorize_request` authorizes on `revoked_at is null` and never
 * checks that the GoTrue session still exists, a captured access token kept full
 * `/v1` read and send for the remainder of its life AFTER the user pressed Sign
 * out. `POST /v1/webrtc/token` made that worse: it is gated on `conversations.send`
 * and nothing session-fresh, so a token used inside its residual life could mint a
 * Telnyx JWT good for up to 24 hours — turning a one-hour API window into a day of
 * voice identity as the business.
 *
 * And it was invisible while it happened: `api_list_user_sessions` inner-joins
 * `auth.sessions`, which `/logout` had just deleted, so the row that needed
 * killing was missing from Settings → Devices. A working remedy existed — sign
 * back in, revoke everything else — and nothing pointed at it.
 *
 * ## Why this is one function rather than a line added in nine places
 *
 * The sequence has to happen in an order — hand back the push subscription, then
 * revoke the session, then clear the credentials the browser holds — and every
 * step but the last needs the session that is being ended. That ordering was
 * already written out by hand at eight call sites, with the push half correct at
 * each and the revoke half missing at all of them. Nine copies of a sequence is
 * how a step goes missing from one of them; `scripts/check-sign-out-path.mjs`
 * fails the build if a tenth appears.
 *
 * Never throws. Nobody may be trapped in an account because the network blipped
 * on the way out — so a failed revoke still signs the browser out locally, and
 * the residual token then expires on its own rather than being cut short. Saying
 * that plainly because it is the one case this does not fully fix.
 */
import { getSupabaseBrowser } from "@/lib/supabase/browser";

import { releasePushOnThisDevice } from "../push/release";

/**
 * How long sign-out will wait for the revoke.
 *
 * Same three seconds and the same reasoning as the push release next door:
 * leaving is not a moment to be held on a spinner over housekeeping. The
 * difference is what a timeout costs — a stalled push release is repaired on the
 * next send, whereas a stalled revoke leaves the token alive until it expires. So
 * the timeout is a deliberate ceiling on how long we make somebody wait, not a
 * belief that it always lands.
 */
const REVOKE_TIMEOUT_MS = 3_000;

export async function endSessionOnThisDevice(
  /** Active workspace, for the X-Company-Id header. Null skips the push half. */
  companyId: string | null,
): ReturnType<ReturnType<typeof getSupabaseBrowser>["auth"]["signOut"]> {
  // Push first, because it is the one whose API call needs a company header and
  // whose failure mode is self-repairing.
  await releasePushOnThisDevice(companyId);
  await Promise.race([
    revokeThisSession(),
    new Promise<void>((resolve) => setTimeout(resolve, REVOKE_TIMEOUT_MS)),
  ]);
  // Returned rather than swallowed, and deliberately not wrapped in a try: two
  // callers (the member menu and the mobile account sheet) read `{ error }` to
  // tell somebody their sign-out did not land, and `signOut()` can also throw on
  // a network failure. Catching either here would put those two back where they
  // were before — still signed in, with nothing on screen saying so.
  return getSupabaseBrowser().auth.signOut();
}

async function revokeThisSession(): Promise<void> {
  try {
    // Loaded on the click rather than with the shell: the API client validates
    // the public env at import time, and every component carrying a sign-out
    // control would otherwise drag that in just to render. Same reason the push
    // release defers its own import.
    const { apiFetch } = await import("@/lib/api/client");
    // No company header — `/v1/sessions/revoke` is about the person, not the
    // workspace, so this works even for somebody signing out of an account with
    // no membership at all (the invite and gate-escape paths).
    await apiFetch<{ sessions: number }>("/v1/sessions/revoke", {
      method: "POST",
      body: { self: true },
    });
  } catch {
    /* Signing out always wins. See the note about the residual token above. */
  }
}
