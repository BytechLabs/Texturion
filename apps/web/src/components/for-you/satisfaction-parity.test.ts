/**
 * #313 — the satisfaction copy is identical on web, Android and iOS.
 *
 * Same guard as its neighbour `response-time-parity.test.ts`, and needed more
 * here: these sentences are the ones that say WHY a number is missing, and the
 * failure mode of drift is a crew reading "too few answers" on the laptop and a
 * blank card on the phone, concluding the phone is broken.
 *
 * The copy has a canonical home in `packages/shared/src/satisfaction.ts`, which
 * web imports directly. Android and iOS hand-port it, so the roster below is
 * what stops the port from quietly diverging.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

const SOURCES: Record<string, string> = {
  shared: join(REPO_ROOT, "packages/shared/src/satisfaction.ts"),
  web: join(REPO_ROOT, "apps/web/src/components/for-you/satisfaction-card.tsx"),
  android: join(
    REPO_ROOT,
    "apps/android/app/src/main/kotlin/com/loonext/android/features/foryou/SatisfactionCard.kt",
  ),
  ios: join(REPO_ROOT, "apps/ios/Loonext/Features/ForYou/SatisfactionCard.swift"),
};

/** Sentences that live on the CARD in all three clients. */
const CARD_FRAGMENTS: readonly string[] = [
  "out of 5, from ",
  "the month before",
  "Up from ",
  "Down from ",
  "No month before this one to compare against yet",
  "About the same as the month before",
  "Details",
  "Hide details",
  "Asked",
];

/**
 * The "why there is no number" sentences.
 *
 * Split out because these are the ones a reader sees when something is wrong,
 * which is exactly when two clients disagreeing is most expensive. They are
 * wrapped across lines differently in each language, so the assertion is on
 * distinctive phrases rather than whole paragraphs.
 */
const GAP_FRAGMENTS: readonly string[] = [
  "Too few answers to average yet",
  "Nobody has answered yet",
  "worth reading rather than counting",
  "No finished jobs have been asked about in this window",
  "a few hours after a job is marked done",
  "Per-person scores are off",
  "coaching signal rather than a ",
  "turn it on in Settings",
];

const CLIENTS = ["web", "android", "ios"] as const;

/**
 * The file with its comments removed.
 *
 * LOAD-BEARING, and found by breaking the guards below. Every one of them
 * asserts that a piece of CODE exists — a fixed locale, an explicit rounding
 * mode — and every one of those lines is also explained in a comment directly
 * above it, in the same words. Matching the raw file therefore passed with the
 * code deleted and the comment left behind, which is the most plausible way any
 * of this actually regresses: somebody "simplifies" the expression and leaves
 * the paragraph explaining why it was there.
 */
function codeOnly(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
}

describe("#313 satisfaction copy is the same on every client", () => {
  it("reads every source, so a passing run means something", () => {
    // The failure this prevents: a renamed file makes readFileSync throw or
    // return something tiny, and a roster asserting "contains" over an empty
    // string would pass every check below it.
    for (const [platform, path] of Object.entries(SOURCES)) {
      const text = readFileSync(path, "utf8");
      expect(text.length, platform).toBeGreaterThan(1000);
    }
  });

  it("carries every card sentence on every client, verbatim", () => {
    const missing: string[] = [];
    // Web is checked against its card PLUS the shared module it imports, and
    // the phones against their cards alone. That asymmetry is the arrangement
    // working rather than a hole in it: web has no hand-port, so a sentence it
    // renders from `SATISFACTION_COPY` is by construction the canonical one.
    // What this guard is actually for is the two ports that could drift.
    const shared = readFileSync(SOURCES.shared, "utf8");
    for (const platform of CLIENTS) {
      const text =
        readFileSync(SOURCES[platform], "utf8") +
        (platform === "web" ? shared : "");
      for (const fragment of [...CARD_FRAGMENTS, ...GAP_FRAGMENTS]) {
        if (!text.includes(fragment)) missing.push(`${platform}: ${fragment}`);
      }
    }
    expect(
      missing,
      `These #313 sentences are missing or reworded on some clients. Change ` +
        `all three together, and update the rosters here:\n  ` +
        missing.join("\n  "),
    ).toEqual([]);
  });

  it("gets the singular right on the count that matters", () => {
    // "1 jobs needed a call back" is the kind of thing that makes a careful
    // reader stop trusting the rest of the panel — and this line is the one
    // they are most likely to be reading closely.
    const formatters: Record<string, string> = {
      shared: SOURCES.shared,
      android: join(
        REPO_ROOT,
        "apps/android/app/src/main/kotlin/com/loonext/android/core/format/SatisfactionFormat.kt",
      ),
      ios: join(REPO_ROOT, "apps/ios/Loonext/Core/Format/SatisfactionFormat.swift"),
    };
    for (const [platform, path] of Object.entries(formatters)) {
      const text = readFileSync(path, "utf8");
      expect(text, platform).toContain("1 job ");
      expect(text, platform).toContain("needed a call back");
    }
  });

  it("pins the sample floor and the arc threshold to one number each", () => {
    // Three clients agreeing on the sentences but disagreeing on WHEN to show
    // them is the same failure wearing a different hat: the laptop calls a move
    // an improvement and the phone calls it nothing.
    const shared = codeOnly(SOURCES.shared);
    expect(shared).toContain("SATISFACTION_MIN_SAMPLE = 5");
    expect(shared).toContain("SATISFACTION_ARC_MIN_DELTA = 0.2");

    const kotlin = codeOnly(
      join(
        REPO_ROOT,
        "apps/android/app/src/main/kotlin/com/loonext/android/core/format/SatisfactionFormat.kt",
      ),
    );
    expect(kotlin).toContain("MIN_SAMPLE = 5");
    expect(kotlin).toContain("ARC_MIN_DELTA = 0.2");

    const swift = codeOnly(
      join(REPO_ROOT, "apps/ios/Loonext/Core/Format/SatisfactionFormat.swift"),
    );
    expect(swift).toContain("minSample = 5");
    expect(swift).toContain("arcMinDelta = 0.2");
  });

  it("formats the average in a fixed locale on both phones", () => {
    // The bug this exists for: Kotlin's `String.format` and Swift's
    // `String(format:)` both follow the DEVICE locale, so 4.6 renders as "4,6"
    // across most of Europe. The number would disagree with the laptop on a
    // customer's phone only — invisible here, and exactly the class of drift
    // these guards are for.
    const kotlin = codeOnly(
      join(
        REPO_ROOT,
        "apps/android/app/src/main/kotlin/com/loonext/android/core/format/SatisfactionFormat.kt",
      ),
    );
    expect(kotlin).toContain("Locale.US");

    const swift = codeOnly(
      join(REPO_ROOT, "apps/ios/Loonext/Core/Format/SatisfactionFormat.swift"),
    );
    expect(swift).toContain("en_US_POSIX");
  });

  it("rounds a tie the same way on all three", () => {
    // FOUND IN CI, NOT BY READING THE CODE. `String(format: "%.1f")` is C
    // printf and rounds half to EVEN, so 4.25 printed "4.2" on iOS while
    // `toFixed` and Kotlin's `String.format` both gave "4.3". A tie is not
    // exotic — four 4s and four 5s average exactly 4.25 — and 4.2 on the phone
    // beside 4.3 on the laptop is the small disagreement that costs the panel
    // its credibility.
    //
    // Swift therefore rounds explicitly BEFORE formatting. That step is
    // invisible in review and there is no local Swift compiler here, so this
    // pins it: a well-meaning simplification back to a bare `String(format:)`
    // fails here rather than on a customer's phone.
    const swift = codeOnly(
      join(REPO_ROOT, "apps/ios/Loonext/Core/Format/SatisfactionFormat.swift"),
    );
    expect(swift).toContain("toNearestOrAwayFromZero");

    // And the case itself is pinned in all three unit suites, so the rule is
    // asserted by execution wherever a compiler exists.
    const suites: Record<string, string> = {
      shared: join(REPO_ROOT, "packages/shared/src/satisfaction.test.ts"),
      android: join(
        REPO_ROOT,
        "apps/android/app/src/test/kotlin/com/loonext/android/core/format/SatisfactionFormatTest.kt",
      ),
      ios: join(REPO_ROOT, "apps/ios/LoonextTests/SatisfactionFormatTests.swift"),
    };
    for (const [platform, path] of Object.entries(suites)) {
      const text = readFileSync(path, "utf8");
      expect(text, `${platform} does not pin the 4.25 tie`).toContain("4.25");
      expect(text, platform).toContain("4.3");
    }
  });
});
