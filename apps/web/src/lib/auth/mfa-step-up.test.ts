/**
 * #496 — "I am able to login without any 2fa codes even though 2fa is enabled."
 *
 * These are the vectors for the one condition that was missing. The Android and
 * iOS twins ask the server the same question a different way (GET /v1/mfa's
 * `enrolled` + `aal`), and the server's own gate is pinned in
 * apps/api/src/auth/company.test.ts — three checks, because a client-side one
 * alone is a suggestion.
 */
import { describe, expect, it } from "vitest";

import { needsStepUp } from "./mfa-step-up";

describe("needsStepUp", () => {
  it("demands a code from a password login on an enrolled account", () => {
    // THE bug. `signInWithPassword` succeeds at aal1, GoTrue says the account
    // should be at aal2, and before this nothing read the second half.
    expect(needsStepUp({ currentLevel: "aal1", nextLevel: "aal2" })).toBe(true);
  });

  it("lets a session that already presented the code through", () => {
    expect(needsStepUp({ currentLevel: "aal2", nextLevel: "aal2" })).toBe(false);
  });

  it("asks nothing of an account with no factor", () => {
    // The overwhelming majority of sign-ins. A step-up screen here would be a
    // demand nobody can satisfy.
    expect(needsStepUp({ currentLevel: "aal1", nextLevel: "aal1" })).toBe(false);
  });

  it("fails OPEN when the answer is missing", () => {
    // Not the security boundary — the API refuses every company-scoped route
    // for an aal1 session holding a factor, so an unreadable answer costs one
    // redirect, while failing closed would strand somebody on a login page over
    // a network blip.
    expect(needsStepUp(null)).toBe(false);
    expect(needsStepUp(undefined)).toBe(false);
    expect(needsStepUp({})).toBe(false);
    expect(needsStepUp({ currentLevel: null, nextLevel: null })).toBe(false);
  });

  it("does not read a DOWNGRADE as a demand", () => {
    // aal2 now, aal1 wanted: the factor was removed elsewhere (a burnt recovery
    // code does exactly this). Asking for a code that no longer exists would be
    // a locked door with the lock taken off.
    expect(needsStepUp({ currentLevel: "aal2", nextLevel: "aal1" })).toBe(false);
  });
});
