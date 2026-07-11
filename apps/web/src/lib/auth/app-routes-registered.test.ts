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

/** Page-route directories of the (app) group (files and route-group noise
 *  excluded — every current entry that is a directory is a URL segment). */
function appRouteSegments(): string[] {
  return readdirSync(APP_GROUP_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
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
