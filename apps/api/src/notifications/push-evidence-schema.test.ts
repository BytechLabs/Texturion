/**
 * D142: the push_attempts and ring_beacons CHECKs accept exactly the words the
 * code writes.
 *
 * Each vocabulary exists twice: as the TypeScript constant the writer uses and
 * as a CHECK that keeps anything personal out of the table. Drift is silent
 * until production, where a word the CHECK lacks refuses every row that uses
 * it, so the evidence for exactly the new case goes missing.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  RING_BEACON_OS_SHAPE,
  RING_BEACON_PERMISSION_STATES,
  RING_BEACON_PERMISSIONS,
  RING_BEACON_STAGES,
  RING_BEACON_STANDBY_BUCKETS,
} from "../routes/ring-beacons";
import {
  PUSH_CHANNELS,
  PUSH_PLATFORMS,
  PUSH_PRIORITIES,
  PUSH_PURPOSES,
  PUSH_RESPONSE_CLASSES,
} from "./push-attempts";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "..", "supabase", "migrations");

/** The migration that creates both tables, found by what it does rather than its name. */
function migration(): { name: string; source: string } {
  const hits = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => ({ name, source: readFileSync(join(MIGRATIONS, name), "utf8") }))
    .filter(({ source }) => source.includes("create table public.push_attempts"));
  expect(hits.map((hit) => hit.name), "exactly one migration creates push_attempts").toHaveLength(1);
  return hits[0];
}

const { source: SOURCE } = migration();

/** The quoted words of the first `in (...)` after `marker`. */
function vocabulary(marker: string): string[] {
  const at = SOURCE.indexOf(marker);
  expect(at, `the migration still contains ${marker}`).toBeGreaterThan(-1);
  const open = SOURCE.indexOf("in (", at);
  const close = SOURCE.indexOf(")", open);
  return [...SOURCE.slice(open, close).matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
}

describe("the push evidence CHECKs match the code that writes them", () => {
  it.each([
    ["push_attempts_purpose", PUSH_PURPOSES],
    ["push_attempts_channel", PUSH_CHANNELS],
    ["push_attempts_platform", PUSH_PLATFORMS],
    ["push_attempts_priority", PUSH_PRIORITIES],
    ["push_attempts_response_class", PUSH_RESPONSE_CLASSES],
    ["ring_beacons_stage", RING_BEACON_STAGES],
    ["ring_beacons_standby_bucket", RING_BEACON_STANDBY_BUCKETS],
    // The route's X-Client set is the same three clients the push targets.
    ["ring_beacons_platform", PUSH_PLATFORMS],
  ] as const)("%s", (constraint, words) => {
    const allowed = vocabulary(`constraint ${constraint} check`);
    expect(allowed.length, "the CHECK was found and read").toBeGreaterThan(0);
    expect([...allowed].sort()).toEqual([...words].sort());
  });

  it("ring beacon permissions: the keys and the states", () => {
    expect(vocabulary("e.key not in (").sort()).toEqual([...RING_BEACON_PERMISSIONS].sort());
    expect(vocabulary("(e.value #>> '{}') not in (").sort()).toEqual(
      [...RING_BEACON_PERMISSION_STATES].sort(),
    );
  });
});

/**
 * The OS column is a shape rather than a word list, so it is held to samples:
 * every form a client sends must pass, and a phone number in any form must
 * not. The pattern must stay plain enough that Postgres and JavaScript read it
 * the same way; push_evidence.test.sql runs the same samples in the database.
 */
describe("the ring beacon OS check", () => {
  function osPattern(): RegExp {
    const at = SOURCE.indexOf("constraint ring_beacons_os check");
    expect(at, "the migration still names the OS check").toBeGreaterThan(-1);
    const match = /os ~ '([^']+)'/.exec(SOURCE.slice(at));
    expect(match, "the OS check is a single regular expression").not.toBeNull();
    return new RegExp(match![1]);
  }

  it.each([
    // RingBeacons.kt: "android-${Build.VERSION.SDK_INT}"
    "android-34",
    "android-9",
    // RingBeacons.swift: "ios-\(UIDevice.current.systemVersion)"
    "ios-18",
    "ios-17.6.1",
    "ios-26.0",
    // beacons.ts webOs(): "web", or "web-" and userAgentData.platform
    "web",
    "web-macos",
    "web-windows",
    "web-linux",
    "web-android",
    "web-chrome-os",
    "web-chromium-os",
    "web-ios",
    "web-unknown",
  ])("accepts %s", (os) => {
    expect(osPattern().test(os)).toBe(true);
  });

  it("is the pattern the route holds the field to", () => {
    // A value the route keeps and the CHECK refuses fails the insert, and the
    // beacon is lost to a 500 instead of losing only its OS.
    expect(RING_BEACON_OS_SHAPE.source).toBe(osPattern().source);
  });

  it.each([
    "+16135550142",
    "16135550142",
    "6135550142",
    "android-6135550142",
    "ios-613.555.0142",
    "web-6135550142",
    "web-sams-iphone",
    "android 34; Pixel 8a",
    "",
  ])("refuses %s", (os) => {
    expect(osPattern().test(os)).toBe(false);
  });
});
