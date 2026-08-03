/**
 * #244 — the on-call copy is identical on web, Android and iOS.
 *
 * Same guard as its neighbours, and the sentence that matters most here is the
 * empty state: "nobody is on call" has to say what that COSTS on every client,
 * or a crew reading the phone concludes the feature is broken while the laptop
 * explains it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

const SOURCES: Record<string, string> = {
  shared: join(REPO_ROOT, "packages/shared/src/on-call.ts"),
  android: join(
    REPO_ROOT,
    "apps/android/app/src/main/kotlin/com/loonext/android/core/oncall/OnCall.kt",
  ),
  ios: join(REPO_ROOT, "apps/ios/Loonext/Core/OnCall.swift"),
};

/** The sentences a crew reads. */
const FRAGMENTS: readonly string[] = [
  "Nobody is on call, so an after-hours call wakes everyone who can see ",
  "Put one person on and the rest get a quiet night.",
  "on call until",
  "If they do not pick it up, everyone else is told a few minutes later.",
  "Only an owner or admin can change who is on call.",
  "Tonight",
  "6pm until 8am tomorrow",
  "This weekend",
  "Friday 6pm until Monday 8am",
  "The next 7 days",
  "Starting now",
];

/** The file with its comments removed — see satisfaction-parity for why. */
function codeOnly(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
}

describe("#244 on-call copy is the same on every client", () => {
  it("reads every source, so a passing run means something", () => {
    for (const [platform, path] of Object.entries(SOURCES)) {
      expect(readFileSync(path, "utf8").length, platform).toBeGreaterThan(1000);
    }
  });

  it("carries every sentence on every client, verbatim", () => {
    const missing: string[] = [];
    for (const [platform, path] of Object.entries(SOURCES)) {
      const text = readFileSync(path, "utf8");
      for (const fragment of FRAGMENTS) {
        if (!text.includes(fragment)) missing.push(`${platform}: ${fragment}`);
      }
    }
    expect(
      missing,
      "These #244 sentences are missing or reworded on some clients:\n  " +
        missing.join("\n  "),
    ).toEqual([]);
  });

  it("agrees on when a shift starts and ends", () => {
    // Three clients agreeing on the words but disagreeing on the HOURS would be
    // worse than disagreeing on both: the card would promise 6pm while the rota
    // started at 5.
    for (const [platform, path] of Object.entries(SOURCES)) {
      const code = codeOnly(path);
      expect(code, platform).toMatch(
        /EVENING_START_HOUR = 18|eveningStartHour = 18/,
      );
      expect(code, platform).toMatch(/MORNING_END_HOUR = 8|morningEndHour = 8/);
    }
  });

  it("resolves the offset with daylight saving on both phones", () => {
    // Android's `rawOffset` and iOS's zone-standard offset both IGNORE daylight
    // saving, which would put every shift out by an hour all summer — a "6pm"
    // window starting at 5pm, silently, half the year, on phones only. Found on
    // the Kotlin card before it shipped, which is why this is pinned rather
    // than left to review.
    const kotlin = codeOnly(
      join(
        REPO_ROOT,
        "apps/android/app/src/main/kotlin/com/loonext/android/features/settings/OnCallCard.kt",
      ),
    );
    expect(kotlin).toContain("getOffset(");
    expect(kotlin).not.toContain("rawOffset");

    const swift = codeOnly(
      join(REPO_ROOT, "apps/ios/Loonext/Features/Settings/OnCallCard.swift"),
    );
    expect(swift).toContain("secondsFromGMT(for:");
  });
});
