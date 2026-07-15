/**
 * Marketing/app host split (D27) — the pure decision table the middleware
 * applies before any auth work. loonext.com serves ONLY marketing; the app
 * origin serves ONLY the product; unset appOrigin (dev/CI) or an unknown host
 * (previews) disables the split entirely.
 */
import { describe, expect, it } from "vitest";

import {
  decideBlogRoute,
  decideHostRedirect,
  isAppSurfacePath,
} from "./hosts";

const APP = "https://app.loonext.com";
const BLOG = "https://blog.loonext.com";

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

  it.each(["/", "/pricing", "/legal/terms", "/for/plumbers", "/compare/heymarket", "/canada"])(
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

describe("decideBlogRoute — blog subdomain (#130)", () => {
  const route = (host: string | null, pathname: string, search = "") =>
    decideBlogRoute({ host, pathname, search, blogOrigin: BLOG });

  it("serves the index at the blog host root", () => {
    expect(route("blog.loonext.com", "/")).toEqual({
      kind: "rewrite",
      pathname: "/blog",
    });
  });

  it("maps a registered post slug at the root onto the /blog route", () => {
    expect(route("blog.loonext.com", "/how-to-text-quotes-to-customers")).toEqual({
      kind: "rewrite",
      pathname: "/blog/how-to-text-quotes-to-customers",
    });
    expect(route("blog.loonext.com", "/rss.xml")).toEqual({
      kind: "rewrite",
      pathname: "/blog/rss.xml",
    });
  });

  it("passes already-/blog-prefixed paths through unchanged (defensive)", () => {
    expect(route("blog.loonext.com", "/blog")).toBeNull();
    expect(route("blog.loonext.com", "/blog/some-post")).toBeNull();
  });

  it("bounces marketing paths (the shared chrome's links) to the canonical site", () => {
    expect(route("blog.loonext.com", "/pricing")).toEqual({
      kind: "redirect",
      url: "https://loonext.com/pricing",
    });
    expect(route("blog.loonext.com", "/legal/fair-use")).toEqual({
      kind: "redirect",
      url: "https://loonext.com/legal/fair-use",
    });
    expect(route("blog.loonext.com", "/features", "?utm_source=rss")).toEqual({
      kind: "redirect",
      url: "https://loonext.com/features?utm_source=rss",
    });
  });

  it("bounces unknown slugs to the canonical site (which 404s them)", () => {
    expect(route("blog.loonext.com", "/not-a-real-post")).toEqual({
      kind: "redirect",
      url: "https://loonext.com/not-a-real-post",
    });
  });

  it("bounces app-surface paths too; the marketing host hops them onward", () => {
    expect(route("blog.loonext.com", "/login")).toEqual({
      kind: "redirect",
      url: "https://loonext.com/login",
    });
  });

  it("is case-insensitive on the host", () => {
    expect(route("BLOG.loonext.com", "/how-to-text-quotes-to-customers")).toEqual({
      kind: "rewrite",
      pathname: "/blog/how-to-text-quotes-to-customers",
    });
  });

  it("does nothing off the blog host, or when unconfigured/misconfigured", () => {
    expect(route("loonext.com", "/pricing")).toBeNull();
    expect(route("app.loonext.com", "/inbox")).toBeNull();
    expect(route(null, "/")).toBeNull();
    expect(
      decideBlogRoute({
        host: "blog.loonext.com",
        pathname: "/",
        search: "",
        blogOrigin: undefined,
      }),
    ).toBeNull();
    expect(
      decideBlogRoute({
        host: "blog.loonext.com",
        pathname: "/",
        search: "",
        blogOrigin: "not-a-url",
      }),
    ).toBeNull();
  });
});
