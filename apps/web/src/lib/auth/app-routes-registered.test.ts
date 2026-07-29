/**
 * #133 regression lock: every page directory in the (app) route group MUST be
 * registered in PROTECTED_PREFIXES. An unregistered route double-fails in
 * production — signed-out visitors are not bounced to /login, and the D27
 * marketing/app host split classifies the path as MARKETING, so
 * app.loonext.com 308s it to the apex where the app shell can never
 * authenticate (an infinite "Loading your workspace"). /calls shipped exactly
 * that way in D37 and was unreachable until #133.
 *
 * The list is derived from the FILESYSTEM so the next new (app) route fails
 * this test until it is registered.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { isAppSurfacePath } from "@/lib/hosts";

import { isProtectedPath } from "./redirects";

const APP_GROUP_DIR = join(__dirname, "..", "..", "app", "(app)");
const AUTH_GROUP_DIR = join(__dirname, "..", "..", "app", "(auth)");

/** Page-route directories of a route group (files and route-group noise
 *  excluded — every current entry that is a directory is a URL segment). */
function routeSegments(groupDir: string): string[] {
  return readdirSync(groupDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function appRouteSegments(): string[] {
  return routeSegments(APP_GROUP_DIR);
}

describe("(app) route registration (#133)", () => {
  it("finds the route group and at least the known surfaces", () => {
    const segments = appRouteSegments();
    expect(segments).toEqual(
      expect.arrayContaining(["inbox", "calls", "for-you"]),
    );
  });

  it("every (app) route is protected (signed-out → /login)", () => {
    for (const segment of appRouteSegments()) {
      expect(
        isProtectedPath(`/${segment}`),
        `/${segment} is an (app) route but not in PROTECTED_PREFIXES — add it (see redirects.ts)`,
      ).toBe(true);
    }
  });

  it("every (app) route lives on the app host (never 308ed to marketing)", () => {
    for (const segment of appRouteSegments()) {
      expect(
        isAppSurfacePath(`/${segment}`),
        `/${segment} would be host-redirected to the marketing origin`,
      ).toBe(true);
    }
  });
});

describe("(auth) route registration (#258)", () => {
  it("finds the route group and at least the known surfaces", () => {
    const segments = routeSegments(AUTH_GROUP_DIR);
    expect(segments).toEqual(
      expect.arrayContaining(["login", "signup", "native-captcha"]),
    );
  });

  // The (app) test above only covered signed-in surfaces; /native-captcha
  // shipped in the (auth) group unregistered and was 308ed to the marketing
  // apex, where Turnstile's hostname check fails and native sign-in hangs.
  it("every (auth) route lives on the app host (never 308ed to marketing)", () => {
    for (const segment of routeSegments(AUTH_GROUP_DIR)) {
      expect(
        isAppSurfacePath(`/${segment}`),
        `/${segment} would be host-redirected to the marketing origin`,
      ).toBe(true);
    }
  });
});
