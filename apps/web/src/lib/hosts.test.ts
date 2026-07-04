/**
 * Marketing/app host split (D27) — the pure decision table the middleware
 * applies before any auth work. jobtext.app serves ONLY marketing; the app
 * origin serves ONLY the product; unset appOrigin (dev/CI) or an unknown host
 * (previews) disables the split entirely.
 */
import { describe, expect, it } from "vitest";

import { decideHostRedirect, isAppSurfacePath } from "./hosts";

const APP = "https://app.jobtext.app";

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
    expect(decide("jobtext.app", "/login", "?next=%2Finbox")).toBe(
      "https://app.jobtext.app/login?next=%2Finbox",
    );
    expect(decide("jobtext.app", "/signup")).toBe("https://app.jobtext.app/signup");
    expect(decide("jobtext.app", "/inbox/abc")).toBe("https://app.jobtext.app/inbox/abc");
  });

  it("serves marketing paths in place", () => {
    expect(decide("jobtext.app", "/")).toBeNull();
    expect(decide("jobtext.app", "/pricing")).toBeNull();
    expect(decide("jobtext.app", "/legal/messaging")).toBeNull();
  });

  it("canonicalizes www to the apex", () => {
    expect(decide("www.jobtext.app", "/pricing")).toBe("https://jobtext.app/pricing");
    // www + app path goes straight to the app origin (one hop, not two).
    expect(decide("www.jobtext.app", "/login")).toBe("https://app.jobtext.app/login");
  });
});

describe("decideHostRedirect — app host", () => {
  it("serves app-surface paths in place", () => {
    expect(decide("app.jobtext.app", "/inbox")).toBeNull();
    expect(decide("app.jobtext.app", "/login")).toBeNull();
    expect(decide("app.jobtext.app", "/onboarding/plan")).toBeNull();
  });

  it("roots the portal at /for-you", () => {
    expect(decide("app.jobtext.app", "/")).toBe("https://app.jobtext.app/for-you");
  });

  it("sends marketing paths to the canonical site", () => {
    expect(decide("app.jobtext.app", "/pricing")).toBe("https://jobtext.app/pricing");
    expect(decide("app.jobtext.app", "/legal/terms")).toBe("https://jobtext.app/legal/terms");
  });
});

describe("decideHostRedirect — split disabled / unknown hosts", () => {
  it("does nothing when appOrigin is unset (dev/CI)", () => {
    expect(decideWith(undefined, "jobtext.app", "/login")).toBeNull();
    expect(decideWith(undefined, "app.jobtext.app", "/pricing")).toBeNull();
  });

  it("does nothing for hosts matching neither origin (localhost, previews)", () => {
    expect(decide("localhost:3000", "/login")).toBeNull();
    expect(decide("jobtext-web.example.workers.dev", "/pricing")).toBeNull();
    expect(decide(null, "/login")).toBeNull();
  });

  it("a malformed appOrigin disables the split instead of breaking requests", () => {
    expect(decideWith("not-a-url", "jobtext.app", "/login")).toBeNull();
  });

  it("host matching is case-insensitive", () => {
    expect(decide("JobText.app", "/login")).toBe("https://app.jobtext.app/login");
  });
});
