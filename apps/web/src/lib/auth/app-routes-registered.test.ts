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

const APP_DIR = join(__dirname, "..", "..", "app");
const APP_GROUP_DIR = join(APP_DIR, "(app)");
const AUTH_GROUP_DIR = join(APP_DIR, "(auth)");

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

// ---------------------------------------------------------------------------
// #558 — routes that belong to NO group are invisible to everything above
// ---------------------------------------------------------------------------

/**
 * `app/photos/[token]` sits at the top level, in neither `(app)` nor `(auth)`,
 * so both walks above are structurally blind to it. It shipped that way, and
 * with it a page whose URL is a 256-bit secret — which is how that token came to
 * be sent to an analytics vendor in full on every view (#558). Nothing was
 * wrong; nothing was looking.
 *
 * So the top level is enumerated too, and every entry has to be declared here on
 * purpose. The point is not that these are wrong — a public link served from the
 * marketing origin is exactly right — it is that adding one should be a decision
 * somebody wrote down rather than a directory nobody's test could see.
 */
const DECLARED_TOP_LEVEL_ROUTES = [
  // D75 public links: no session, served from the apex, token in the path.
  // A new one here needs a TOKEN_PATH_PREFIXES rule (see scrub.test.ts).
  "photos",
  // #224: the payment page a customer opens. Same shape as /photos and it needs
  // the same TOKEN_PATH_PREFIXES rule — the token in this one opens a page with
  // an amount on it.
  "pay",
  // Invite acceptance and onboarding: pre-workspace, so outside (app).
  "join",
  "onboarding",
  // Supabase's auth callback + the legacy dashboard entry.
  "auth",
  "dashboard",
  // Not pages: handlers and generated assets.
  "api",
  "og",
  "fonts",
  "llms.txt",
  // RFC 9116 disclosure contact. Found by this guard on its first run, which is
  // the point: a dotted directory is invisible to a `ls */` and was invisible to
  // every test in this file.
  ".well-known",
] as const;

describe("#558 top-level routes are declared, not discovered", () => {
  function topLevelRouteSegments(): string[] {
    return readdirSync(APP_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      // Route groups are covered by the walks above.
      .filter((name) => !(name.startsWith("(") && name.endsWith(")")));
  }

  it("finds the top level and the route that prompted this", () => {
    // Loud rather than vacuous: an empty walk would pass the next test by
    // default and read like a clean bill of health.
    const segments = topLevelRouteSegments();
    expect(segments.length).toBeGreaterThan(0);
    expect(segments).toContain("photos");
  });

  it("every top-level route is declared", () => {
    for (const segment of topLevelRouteSegments()) {
      expect(
        DECLARED_TOP_LEVEL_ROUTES as readonly string[],
        `app/${segment} is a top-level route in no route group, so neither the (app) nor the (auth) walk can see it. Add it to DECLARED_TOP_LEVEL_ROUTES with a line saying why it belongs outside both — and if its URL carries a token, add a TOKEN_PATH_PREFIXES rule too (#558).`,
      ).toContain(segment);
    }
  });

  it("declares nothing that has been deleted", () => {
    // A declaration that outlives its directory is a stale permission.
    const segments = topLevelRouteSegments();
    for (const declared of DECLARED_TOP_LEVEL_ROUTES) {
      expect(segments, `app/${declared} no longer exists — drop the declaration`)
        .toContain(declared);
    }
  });
});
