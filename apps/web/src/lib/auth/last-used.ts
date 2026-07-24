/**
 * Which way you signed in last, remembered on this device.
 *
 * An account can hold Google and a password at once, and months later nobody
 * remembers which one they used — so people guess, fail, and reach for a
 * password reset they never needed. A quiet "Last used" marker on the method
 * that worked removes the guess.
 *
 * Stored in localStorage, per device, and it holds ONLY the method name: no
 * email, no token, nothing that identifies the person. A shared computer shows
 * a hint about the last sign-in on that browser, which is the same thing the
 * browser's own autofill already reveals, and it is only ever a hint — every
 * method stays available and nothing is pre-filled from it.
 */
export type LastUsedMethod = "google" | "password";

const KEY = "loonext.last-sign-in";

/** Remember the method that just worked. Never throws (private mode, quota). */
export function rememberSignInMethod(method: LastUsedMethod): void {
  try {
    window.localStorage.setItem(KEY, method);
  } catch {
    // A browser with storage disabled simply gets no hint.
  }
}

/** The method last used on this device, or null when unknown. */
export function readSignInMethod(): LastUsedMethod | null {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === "google" || value === "password" ? value : null;
  } catch {
    return null;
  }
}
