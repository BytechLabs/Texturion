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

import { inboxEn } from "@/i18n/sections/inbox";
import { stripComments } from "@/test/source-tree";

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

/**
 * #228: web's own sentences (the ones NOT coming from `SATISFACTION_COPY`) now
 * live in the catalogue, so web is checked against its card + the shared module
 * + these values. The phones are unchanged — they are still the two hand-ports
 * the guard exists for.
 *
 * The VALUES, not the section file's text, and found by breaking it: the key
 * `satisfactionAsked:` contains the fragment "Asked", so a reworded label
 * matched its own identifier and this stayed green. A copy guard reads copy.
 */
const WEB_COPY = Object.values(inboxEn).join("\n");

/**
 * #228 moved ANDROID's sentences into a catalogue of `"key" to "value"` pairs,
 * the same shape web's are in. Only iOS still writes them at the card.
 */
const ANDROID_CATALOGUE = join(
  REPO_ROOT,
  "apps/android/app/src/main/kotlin/com/loonext/android/core/i18n/InboxStrings.kt",
);

/**
 * The Kotlin catalogue's VALUES.
 *
 * Keys stripped, for the reason recorded below for web: `inbox.satisfactionAsked`
 * contains the fragment "Asked", so reading the file whole would let an
 * identifier satisfy a copy check while the label beside it had been reworded.
 * Comment lines go for the same reason.
 */
function kotlinCatalogueValues(text: string): string {
  return text
    .replace(/"inbox\.[A-Za-z0-9_]+"\s*to\s*/g, "")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*");
    })
    .join("\n");
}

const ANDROID_COPY = kotlinCatalogueValues(readFileSync(ANDROID_CATALOGUE, "utf8"));

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
  // #519: `stripComments` rather than a local regex. Every copy of that regex
  // opened a block comment at any `/*`, including one inside a string literal,
  // and blanked the file from there to the next `*/`.
  return stripComments(readFileSync(path, "utf8"));
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
    expect(WEB_COPY.length).toBeGreaterThan(1000);
    expect(ANDROID_COPY.length).toBeGreaterThan(1000);
  });

  it("carries every card sentence on every client, verbatim", () => {
    const missing: string[] = [];
    // Web is checked against its card PLUS the shared module it imports, and
    // the phones against their cards alone. That asymmetry is the arrangement
    // working rather than a hole in it: web has no hand-port, so a sentence it
    // renders from `SATISFACTION_COPY` is by construction the canonical one.
    // What this guard is actually for is the two ports that could drift.
    //
    // COMMENTS ARE STRIPPED, and that is not tidiness. Found by breaking this:
    // web's "Asked" was satisfied by a docblock in the shared module — *"Asked,
    // nobody answered yet"* — so renaming the card's label to "Requested" left
    // this green. Before #228 the card ALSO held the literal, so the hole was
    // covered by accident; moving the word to the catalogue made the comment
    // the only thing holding it up. It is the same defect #519 found across
    // this file's siblings, on the copy half rather than the code half.
    const shared = codeOnly(SOURCES.shared);
    for (const platform of CLIENTS) {
      // Web is the shared module + the catalogue's values, and NOT its own
      // source: the card calls `t("inbox.satisfactionAsked")`, whose key
      // contains the fragment "Asked", so including the file made a reworded
      // label match its own identifier. Android now reads the same way, off its
      // own catalogue (#228); iOS keeps its whole file, because that is still
      // where its strings are.
      const text =
        platform === "web"
          ? `${shared}\n${WEB_COPY}`
          : platform === "android"
            ? ANDROID_COPY
            : codeOnly(SOURCES[platform]);
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
