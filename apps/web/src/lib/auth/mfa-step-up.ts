/**
 * #496 — does this session still owe a second factor?
 *
 * The one line of logic behind the whole issue: "When 2fa is enabled it should
 * be used everywhere??? I am able to login without any 2fa codes even though
 * 2fa is enabled."
 *
 * GoTrue's `getAuthenticatorAssuranceLevel()` answers two questions at once —
 * what this session HAS (`currentLevel`) and what it SHOULD have given the
 * factors on the account (`nextLevel`). `signInWithPassword` returns a session
 * at `aal1` for an enrolled account too, and leaves demanding the code to the
 * application. Nothing demanded it, so a factor existed and a password still
 * opened the whole product.
 *
 * Extracted from the login page so the rule is testable without a browser, and
 * so all three arrival points (password, OAuth, a restored session) answer from
 * the same function rather than three lookalike conditions.
 */
export interface AssuranceLevels {
  currentLevel?: string | null;
  nextLevel?: string | null;
}

/**
 * True when the caller must present a code before continuing.
 *
 * Fails OPEN — an absent or unreadable answer lets the person through. That is
 * deliberate and safe, because it is not the security boundary: the API refuses
 * every company-scoped route for an `aal1` session that holds a factor, so the
 * worst case is the gate inside the shell asking instead of the login screen.
 * Failing closed would strand somebody on a login page over a network blip,
 * which is a lockout caused by a check that was never the control.
 */
export function needsStepUp(levels: AssuranceLevels | null | undefined): boolean {
  if (!levels) return false;
  return levels.nextLevel === "aal2" && levels.currentLevel !== "aal2";
}
