import { describe, expect, it } from "vitest";

import {
  decideAuthRedirect,
  isAuthPage,
  isProtectedPath,
  safeNextPath,
} from "./redirects";

describe("middleware redirect logic (SPEC §10, G12)", () => {
  it("sends signed-out users on app routes to /login with a next target", () => {
    expect(decideAuthRedirect("/inbox/abc-123", false)).toEqual({
      pathname: "/login",
      search: `?next=${encodeURIComponent("/inbox/abc-123")}`,
    });
    expect(decideAuthRedirect("/settings/billing", false)).toEqual({
      pathname: "/login",
      search: `?next=${encodeURIComponent("/settings/billing")}`,
    });
    expect(decideAuthRedirect("/onboarding", false)).toEqual({
      pathname: "/login",
      search: `?next=${encodeURIComponent("/onboarding")}`,
    });
  });

  it("omits the redundant next param for the default landing (/inbox)", () => {
    expect(decideAuthRedirect("/inbox", false)).toEqual({
      pathname: "/login",
      search: "",
    });
  });

  it("bounces signed-in users off the auth pages to /inbox", () => {
    for (const path of ["/login", "/signup", "/reset-password"]) {
      expect(decideAuthRedirect(path, true)).toEqual({
        pathname: "/inbox",
        search: "",
      });
    }
  });

  it("lets signed-in users through to app routes", () => {
    expect(decideAuthRedirect("/inbox", true)).toBeNull();
    expect(decideAuthRedirect("/contacts/42", true)).toBeNull();
    expect(decideAuthRedirect("/onboarding/plan", true)).toBeNull();
  });

  it("guards the new nav routes (/for-you, /tasks) like the rest of the app", () => {
    // Zero dead links (APP-LAYOUT-V2 §1.3): unauthenticated visits redirect to
    // login instead of 404ing; authenticated visits render in-shell.
    expect(decideAuthRedirect("/for-you", false)).toEqual({
      pathname: "/login",
      search: `?next=${encodeURIComponent("/for-you")}`,
    });
    expect(decideAuthRedirect("/tasks", false)).toEqual({
      pathname: "/login",
      search: `?next=${encodeURIComponent("/tasks")}`,
    });
    expect(decideAuthRedirect("/for-you", true)).toBeNull();
    expect(decideAuthRedirect("/tasks", true)).toBeNull();
    expect(isProtectedPath("/for-you")).toBe(true);
    expect(isProtectedPath("/tasks")).toBe(true);
  });

  it("lets signed-out users reach public and dual-state pages", () => {
    expect(decideAuthRedirect("/", false)).toBeNull();
    expect(decideAuthRedirect("/login", false)).toBeNull();
    expect(decideAuthRedirect("/update-password", false)).toBeNull();
    expect(decideAuthRedirect("/invite/abc", false)).toBeNull();
  });

  it("never bounces the recovery/invite pages for signed-in users either", () => {
    expect(decideAuthRedirect("/update-password", true)).toBeNull();
    expect(decideAuthRedirect("/invite/abc", true)).toBeNull();
  });

  it("prefix matching is segment-safe", () => {
    expect(isProtectedPath("/inboxes")).toBe(false);
    expect(isProtectedPath("/inbox")).toBe(true);
    expect(isProtectedPath("/inbox/new")).toBe(true);
    expect(isAuthPage("/login-help")).toBe(false);
    expect(isAuthPage("/login")).toBe(true);
  });

  it("safeNextPath only honors same-origin absolute paths", () => {
    expect(safeNextPath("/inbox/abc")).toBe("/inbox/abc");
    expect(safeNextPath("/settings/billing")).toBe("/settings/billing");
    expect(safeNextPath("/inbox/abc-123")).toBe("/inbox/abc-123");
    expect(safeNextPath("https://evil.example")).toBe("/inbox");
    expect(safeNextPath("//evil.example")).toBe("/inbox");
    expect(safeNextPath(null)).toBe("/inbox");
    expect(safeNextPath("")).toBe("/inbox");
  });

  it("safeNextPath rejects backslash/control-char open-redirect bypasses", () => {
    // The URL parser folds `\` -> `/`, so `/\evil` would resolve to `//evil`
    // (protocol-relative → off-site) when the callback does new URL(next, origin).
    expect(safeNextPath("/\\evil.example")).toBe("/inbox");
    expect(safeNextPath("/\\/evil.example")).toBe("/inbox");
    expect(safeNextPath("/\tevil.example")).toBe("/inbox");
    expect(safeNextPath("/\nevil.example")).toBe("/inbox");
    expect(safeNextPath("/ evil.example")).toBe("/inbox");
  });
});
