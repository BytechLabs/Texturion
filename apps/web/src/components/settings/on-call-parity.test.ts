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
  // #244's banner. The claim label is first person on every client because
  // that is what tapping it means, and "has this" is what stops a second
  // person driving out.
  "Nobody has picked this up yet",
  "I have this",
  "has this",
  "You have this. The rest of the crew has been told.",
  "was told first",
];

/** The file with its comments removed — see satisfaction-parity for why. */
function codeOnly(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
}

/**
 * The banner's own file per client.
 *
 * Keyed to match SOURCES, so `shared` maps to WEB's banner: the shared module
 * plus that component together are the web client's copy, exactly as
 * `OnCall.kt` plus `AlertBanner.kt` are Android's. Keying it "web" would have
 * left the file unread and the guard passing over two clients instead of three
 * — which is what happened on the first run.
 */
const BANNERS: Record<string, string> = {
  shared: join(REPO_ROOT, "apps/web/src/components/thread/alert-banner.tsx"),
  android: join(
    REPO_ROOT,
    "apps/android/app/src/main/kotlin/com/loonext/android/features/thread/AlertBanner.kt",
  ),
  ios: join(REPO_ROOT, "apps/ios/Loonext/Features/Thread/AlertBanner.swift"),
};

describe("#244 on-call copy is the same on every client", () => {
  it("reads every source, so a passing run means something", () => {
    for (const [platform, path] of Object.entries(SOURCES)) {
      expect(readFileSync(path, "utf8").length, platform).toBeGreaterThan(1000);
    }
  });

  it("carries every sentence on every client, verbatim", () => {
    const missing: string[] = [];
    // Each client is checked against its vocabulary file PLUS its banner: the
    // "was told first" fragment is assembled at the call site on every client,
    // because each language interpolates the name differently.
    for (const [platform, path] of Object.entries(SOURCES)) {
      const text =
        readFileSync(path, "utf8") +
        (BANNERS[platform] ? readFileSync(BANNERS[platform], "utf8") : "");
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

  it("makes each banner USE the vocabulary rather than its own words", () => {
    // FOUND BY BREAKING IT. The fragment check above concatenates each
    // client's vocabulary file with its banner, so replacing
    // `OnCall.bannerClaim` in the banner with a hardcoded "Take it" left the
    // constant sitting untouched in the vocabulary file and the whole roster
    // still passed — on all three clients at once.
    //
    // That is the drift this guard is actually for: nobody edits a shared
    // constant to make three clients disagree, they hardcode a string at one
    // call site. So the reference itself is what gets pinned.
    const references: Record<string, string[]> = {
      web: ["ALERT_BANNER_COPY.claim", "ALERT_BANNER_COPY.waiting"],
      android: ["OnCall.BANNER_CLAIM", "OnCall.BANNER_WAITING"],
      ios: ["OnCall.bannerClaim", "OnCall.bannerWaiting"],
    };
    const files: Record<string, string> = {
      web: BANNERS.shared,
      android: BANNERS.android,
      ios: BANNERS.ios,
    };
    for (const [platform, expected] of Object.entries(references)) {
      const code = codeOnly(files[platform]);
      for (const reference of expected) {
        expect(code, `${platform} hardcodes copy instead of ${reference}`).toContain(
          reference,
        );
      }
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
