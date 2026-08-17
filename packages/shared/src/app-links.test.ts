import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ANDROID_APP_LINK_PATHS,
  APP_LINK_HOST,
  APP_LINK_SEGMENTS,
  APPLE_APP_LINK_COMPONENTS,
} from "./app-links";

/**
 * #613 — the served claim and the two routers are one list.
 *
 * The defect this issue was filed about is what happens when they are not: iOS
 * declared `applinks:app.loonext.com` in its entitlement, wrote a router for
 * four path shapes, and served no association file — so for the whole life of
 * the feature every tap opened Safari, silently. An unassociated domain looks
 * exactly like an ordinary web link. Nothing logs, nothing warns, and nobody
 * finds out except by noticing the app never opens.
 *
 * Drift is silent in BOTH directions, so both are asserted:
 *
 * - Claimed but unrouted is worse than the original bug. The tap leaves the
 *   browser, enters the app, resolves to nothing, and the reader is left on
 *   whatever screen was last open with no way back to the page they wanted.
 * - Routed but unclaimed is the original bug — built, wired, never switched on.
 *
 * These read the real files rather than a fixture. A fixture would agree with
 * itself forever.
 */

const REPO = join(import.meta.dirname, "..", "..", "..");

const read = (...parts: string[]) =>
  readFileSync(join(REPO, ...parts), "utf8");

/** The first segment of a path pattern: "/inbox/*" and "/inbox/" both give "inbox". */
const firstSegment = (path: string): string =>
  path.replace(/^\//, "").split("/")[0]!;

describe("#613 app links: one list, three files", () => {
  it("claims nothing in Apple's grammar that is not a known surface", () => {
    const claimed = new Set(APPLE_APP_LINK_COMPONENTS.map(firstSegment));
    expect([...claimed].sort()).toEqual([...APP_LINK_SEGMENTS].sort());
  });

  it("claims the same surfaces in Android's grammar", () => {
    // Two grammars for one decision. They are written separately because a
    // manifest cannot express "/calls/*" and Apple cannot express pathPrefix —
    // which is exactly the kind of difference that hides a missing surface.
    const claimed = new Set(
      ANDROID_APP_LINK_PATHS.map((entry) => firstSegment(entry.value)),
    );
    expect([...claimed].sort()).toEqual([...APP_LINK_SEGMENTS].sort());
  });

  it("never claims a bare prefix that would swallow a neighbouring path", () => {
    // pathPrefix="/calls" also matches "/callsomething". Every prefix here ends
    // in a slash; anything exact is declared as a path.
    for (const entry of ANDROID_APP_LINK_PATHS) {
      if (entry.kind === "pathPrefix") {
        expect(entry.value.endsWith("/")).toBe(true);
      }
    }
  });

  it("matches what the Swift router actually resolves", () => {
    // parsePushRoute is hand-written and compares raw segment strings. Reading
    // those literals is the only check available from this side of the fence:
    // Swift compiles in CI alone, so a router that stopped understanding
    // "tasks" would otherwise reach a device before it reached a test.
    const swift = read(
      "apps",
      "ios",
      "Loonext",
      "Features",
      "Push",
      "PushPayload.swift",
    );
    const body = swift.slice(
      swift.indexOf("func parsePushRoute"),
      swift.indexOf("// MARK: - APNs userInfo extraction"),
    );
    expect(body.length).toBeGreaterThan(200);

    const routed = new Set(
      [...body.matchAll(/segments(?:\[0\]|\.first) == "([a-z]+)"/g)].map(
        (match) => match[1]!,
      ),
    );
    // Every surface we take from the browser on iOS must land somewhere.
    for (const segment of APP_LINK_SEGMENTS) {
      expect(routed.has(segment)).toBe(true);
    }
  });

  it("matches what the Kotlin router actually resolves", () => {
    const kotlin = read(
      "apps",
      "android",
      "app",
      "src",
      "main",
      "kotlin",
      "com",
      "loonext",
      "android",
      "MainActivity.kt",
    );
    const body = kotlin.slice(kotlin.indexOf("fun deepLinkFor("));
    expect(body.length).toBeGreaterThan(200);

    const routed = new Set(
      [
        ...body.matchAll(
          /segments(?:\[0\]|\.firstOrNull\(\)) == "([a-z]+)"/g,
        ),
      ].map((match) => match[1]!),
    );
    for (const segment of APP_LINK_SEGMENTS) {
      expect(routed.has(segment)).toBe(true);
    }
  });

  it("leaves settings to the browser, which only one router understands", () => {
    // Android resolves an unrecognised settings section to the HUB rather than
    // to nothing — right for a push we send ourselves, wrong for a link
    // somebody followed: the web has settings pages the app has no screen for,
    // and claiming the prefix answers a specific request with a general screen.
    // iOS does not route settings at all, so claiming it would also split the
    // two apps' behaviour on the same link.
    expect([...APP_LINK_SEGMENTS]).not.toContain("settings");
  });

  it("leaves the customer's quote page with the browser", () => {
    // The sharpest case in the whole list. A homeowner opens /q/<token> from a
    // text; if the crew app is installed on that phone it would swallow the tap
    // and show a login the customer does not have.
    expect(APPLE_APP_LINK_COMPONENTS.some((p) => p.startsWith("/q"))).toBe(
      false,
    );
    expect(
      ANDROID_APP_LINK_PATHS.some((entry) => entry.value.startsWith("/q")),
    ).toBe(false);
  });
});

describe("#613 the manifest and the entitlement carry the same claim", () => {
  const manifest = () =>
    read("apps", "android", "app", "src", "main", "AndroidManifest.xml");

  it("declares an autoVerify filter for the host", () => {
    const xml = manifest();
    expect(xml).toContain('android:autoVerify="true"');
    expect(xml).toContain(`android:host="${APP_LINK_HOST}"`);
    expect(xml).toContain('android:scheme="https"');
  });

  it("declares exactly the shared list, and nothing else", () => {
    const xml = manifest();
    const filter = xml.slice(
      xml.indexOf('<intent-filter android:autoVerify="true">'),
    );
    const body = filter.slice(0, filter.indexOf("</intent-filter>"));
    expect(body.length).toBeGreaterThan(100);

    const declared = [
      ...body.matchAll(/android:(path|pathPrefix)="([^"]+)"/g),
    ].map((match) => `${match[1]}:${match[2]}`);
    const expected = ANDROID_APP_LINK_PATHS.map(
      (entry) => `${entry.kind}:${entry.value}`,
    );
    // Set equality BOTH ways: an extra <data> in the manifest is a path taken
    // from the browser that nobody decided to take.
    expect(declared.sort()).toEqual([...expected].sort());
  });

  it("claims the same host the iOS entitlement does", () => {
    const project = read("apps", "ios", "project.yml");
    expect(project).toContain(`applinks:${APP_LINK_HOST}`);
  });
});
