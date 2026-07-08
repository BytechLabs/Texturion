/**
 * Marketing/app host split (D27) — the pure decision table the middleware
 * applies before any auth work. loonext.com serves ONLY marketing; the app
 * origin serves ONLY the product; unset appOrigin (dev/CI) or an unknown host
 * (previews) disables the split entirely.
 */
import { describe, expect, it } from "vitest";

import { decideHostRedirect, isAppSurfacePath } from "./hosts";

const APP = "https://app.loonext.com";

function decide(host: string | null, pathname: string, search = "") {
  return decideHostRedirect({ host, pathname, search, appOrigin: APP });
}

function decideWith(appOrigin: string | undefined, host: string, pathname: string) {
  return decideHostRedirect({ host, pathname, search: "", appOrigin });
}

describe("isAppSurfacePath", () => {
  it.each([
    "/for-you",
    "/inbox",
    "/inbox/abc-123",
    "/tasks",
    "/contacts",
    "/templates",
    "/settings/numbers",
    "/onboarding/plan",
    "/login",
    "/signup",
    "/reset-password",
    "/update-password",
    "/invite/tok-1",
    "/auth/callback",
    "/dashboard",
    "/join",
  ])("%s is app surface", (path) => {
    expect(isAppSurfacePath(path)).toBe(true);
  });

  it.each(["/", "/pricing", "/legal/terms", "/for/plumbers", "/compare/podium", "/canada"])(
    "%s is marketing",
    (path) => {
      expect(isAppSurfacePath(path)).toBe(false);
    },
  );

  it("prefix-matches whole segments only (no /settingsx false positive)", () => {
    expect(isAppSurfacePath("/settingsx")).toBe(false);
    expect(isAppSurfacePath("/joinery")).toBe(false);
  });
});

describe("decideHostRedirect — marketing host", () => {
  it("hops app-surface paths to the app origin, search preserved", () => {
    expect(decide("loonext.com", "/login", "?next=%2Finbox")).toBe(
      "https://app.loonext.com/login?next=%2Finbox",
    );
    expect(decide("loonext.com", "/signup")).toBe("https://app.loonext.com/signup");
    expect(decide("loonext.com", "/inbox/abc")).toBe("https://app.loonext.com/inbox/abc");
  });

  it("serves marketing paths in place", () => {
    expect(decide("loonext.com", "/")).toBeNull();
    expect(decide("loonext.com", "/pricing")).toBeNull();
    expect(decide("loonext.com", "/legal/messaging")).toBeNull();
  });

  it("canonicalizes www to the apex", () => {
    expect(decide("www.loonext.com", "/pricing")).toBe("https://loonext.com/pricing");
    // www + app path goes straight to the app origin (one hop, not two).
    expect(decide("www.loonext.com", "/login")).toBe("https://app.loonext.com/login");
  });
});

describe("decideHostRedirect — app host", () => {
  it("serves app-surface paths in place", () => {
    expect(decide("app.loonext.com", "/inbox")).toBeNull();
    expect(decide("app.loonext.com", "/login")).toBeNull();
    expect(decide("app.loonext.com", "/onboarding/plan")).toBeNull();
  });

  it("roots the portal at /for-you", () => {
    expect(decide("app.loonext.com", "/")).toBe("https://app.loonext.com/for-you");
  });

  it("sends marketing paths to the canonical site", () => {
    expect(decide("app.loonext.com", "/pricing")).toBe("https://loonext.com/pricing");
    expect(decide("app.loonext.com", "/legal/terms")).toBe("https://loonext.com/legal/terms");
  });
});

describe("decideHostRedirect — split disabled / unknown hosts", () => {
  it("does nothing when appOrigin is unset (dev/CI)", () => {
    expect(decideWith(undefined, "loonext.com", "/login")).toBeNull();
    expect(decideWith(undefined, "app.loonext.com", "/pricing")).toBeNull();
  });

  it("does nothing for hosts matching neither origin (localhost, previews)", () => {
    expect(decide("localhost:3000", "/login")).toBeNull();
    expect(decide("loonext-web.example.workers.dev", "/pricing")).toBeNull();
    expect(decide(null, "/login")).toBeNull();
  });

  it("a malformed appOrigin disables the split instead of breaking requests", () => {
    expect(decideWith("not-a-url", "loonext.com", "/login")).toBeNull();
  });

  it("host matching is case-insensitive", () => {
    expect(decide("Loonext.com", "/login")).toBe("https://app.loonext.com/login");
  });
});
