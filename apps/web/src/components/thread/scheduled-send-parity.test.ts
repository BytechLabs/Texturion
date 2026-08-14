/**
 * #233 — the send-later vocabulary is identical on web, Android and iOS.
 *
 * WHY A TEST AND NOT A CODE REVIEW. These sentences live in TypeScript, Kotlin
 * and Swift; nothing connects them, and a wording fix applied to one is
 * invisible in the other two. That already happened once in this repo — the
 * media-refused roster shipped with five sentences while the product had seven,
 * because two arms were added to all three clients and nobody touched the list.
 *
 * The stakes are higher here than for most copy. Every sentence below is the
 * product telling somebody that a text they wrote is NOT going to their
 * customer, which `docs/DECISIONS.md` makes binding: "silent disappearance is
 * the one unacceptable option". A client that says nothing, or says something
 * softer than the others, breaks that rule while looking fine.
 *
 * The check runs in BOTH directions. The roster must appear in every client
 * (drift out), and every reason a client knows about must be on the roster
 * (drift in) — the second is what would have caught the media-refused gap.
 */
import { readFileSync } from "node:fs";
import { copyWithCatalogue } from "@/lib/parity/client-catalogue";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  SCHEDULED_HOLD_REASONS,
  SCHEDULED_SEND_COPY,
  scheduledClockProvenance,
  scheduledReasonRecovers,
} from "@loonext/shared";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

const SOURCES: Record<string, string> = {
  android: join(
    REPO_ROOT,
    "apps/android/app/src/main/kotlin/com/loonext/android/core/scheduled/ScheduledSend.kt",
  ),
  ios: join(REPO_ROOT, "apps/ios/Loonext/Core/ScheduledSend.swift"),
};

/**
 * #228 moved Android's sentences out of `ScheduledSend.kt` and into the shared
 * catalogue, so a source-only read reports every hold reason as missing —
 * failing this guard on work that improved the thing it guards.
 *
 * Source AND catalogue, not one or the other: the migration is file-by-file, so
 * some copy on a screen has moved while the rest is still inline.
 */
const ANDROID_CATALOGUES = [
  join(
    REPO_ROOT,
    "apps/android/app/src/main/kotlin/com/loonext/android/core/i18n/DomainStrings.kt",
  ),
];

/**
 * This test's own keys. `DomainStrings.kt` also holds the contact clock lines,
 * the number-access notes and the carrier registration steps; handing all of
 * that to the reverse-direction assertion below would read every one of them as
 * a hold reason nobody declared.
 */
const ANDROID_KEYS = ["domain.scheduledHold", "domain.scheduled", "domain.sendLater"];

const IOS_CATALOGUES = [
  join(REPO_ROOT, "apps/ios/Loonext/Core/I18n/DomainStrings.swift"),
];

const read = (path: string) => {
  if (path.endsWith(".kt")) {
    return copyWithCatalogue(path, ANDROID_CATALOGUES, "kotlin", ANDROID_KEYS);
  }
  if (path.endsWith(".swift")) {
    return copyWithCatalogue(path, IOS_CATALOGUES, "swift", ANDROID_KEYS);
  }
  return readFileSync(path, "utf8");
};

describe("#233 every client says the same thing when a text does not go", () => {
  it.each(Object.entries(SOURCES))(
    "%s carries every hold reason, verbatim",
    (platform, path) => {
      const source = read(path);
      const missing = Object.entries(SCHEDULED_HOLD_REASONS)
        .filter(([, sentence]) => !source.includes(sentence))
        .map(([key]) => key);

      expect(
        missing,
        `\n\n${platform} is missing hold-reason copy: ${missing.join(", ")}\n` +
          `Every one of these is the product telling somebody a text is not\n` +
          `going out. A client that stays quiet about one breaks the\n` +
          `disclosure rule in docs/DECISIONS.md while looking fine.\n`,
      ).toEqual([]);
    },
  );

  it.each(Object.entries(SOURCES))(
    "%s carries every send-later sentence, verbatim",
    (platform, path) => {
      // The rest of the surface — picker, quiet-hours warning, confirmations.
      // Rostered for the same reason the hold reasons are: the phone is where
      // somebody schedules a text at 9:40pm, and a client that softens "you
      // can send it anyway, or pick a time in their morning" into a bare
      // refusal has quietly turned #225's warning into a block.
      const source = read(path);
      const missing = Object.entries(SCHEDULED_SEND_COPY)
        .filter(([, sentence]) => !source.includes(sentence))
        .map(([key]) => key);

      expect(
        missing,
        `\n\n${platform} is missing send-later copy: ${missing.join(", ")}\n` +
          `These are shared sentences, not per-platform chrome. Port them\n` +
          `verbatim rather than writing a local version.\n`,
      ).toEqual([]);
    },
  );

  it.each(Object.entries(SOURCES))(
    "%s knows about no reason the roster has not been told about",
    (platform, path) => {
      // The direction that catches drift IN. A reason added to one client and
      // not to the shared table is invisible to a check that only looks for
      // the roster's own entries — which is exactly how the media-refused
      // roster sat two sentences short of the product for weeks.
      //
      // Prose-length string literals only: shorter ones are keys, identifiers
      // and format fragments, and treating those as copy would make this fail
      // on every unrelated edit until somebody deleted it.
      const source = read(path);
      // Every sentence shared/scheduled-send.ts owns, not just the hold
      // reasons: the question this asks is "is this copy accounted for
      // somewhere shared", and the clock provenance lines are — through
      // `scheduledClockProvenance`, which is a second roster rather than a
      // second vocabulary.
      const known = new Set<string>([
        ...Object.values(SCHEDULED_HOLD_REASONS),
        ...Object.values(SCHEDULED_SEND_COPY),
        ...(["contact", "area_code", "company"] as const).map(
          scheduledClockProvenance,
        ),
      ]);
      // Newlines excluded from the class, deliberately. Without that, a match
      // runs from one quote across intervening CODE to a quote lines later,
      // and every such span is a "stranger" — the check fails on files that
      // are correct, which is the fastest way to get a guard deleted.
      const literals = [...source.matchAll(/"([^"\\\n]{40,})"/g)].map((m) => m[1]);

      const strangers = literals.filter((literal) => !known.has(literal));
      expect(
        strangers,
        `\n\n${platform} carries copy the shared roster does not know about:\n` +
          strangers.map((s) => `  ${s}`).join("\n") +
          `\n\nAdd it to SCHEDULED_HOLD_REASONS so the other two clients say it too.\n`,
      ).toEqual([]);
    },
  );

  it("finds real files, so a rename cannot make this vacuous", () => {
    // A path that stopped resolving would make every assertion above pass by
    // checking an empty string.
    for (const [platform, path] of Object.entries(SOURCES)) {
      expect(read(path).length, `${platform} source is empty`).toBeGreaterThan(
        1000,
      );
    }
  });
});

describe("#233 the same reasons recover on every client", () => {
  /**
   * Which reasons the phones treat as recoverable, scraped from the one
   * construct each language uses.
   *
   * Deliberately structural rather than semantic: the point is to notice a
   * reason MOVED between the two lists, and a reason moved is a message that
   * either retries against a STOP forever or gives up on a card that will be
   * fixed tomorrow.
   */
  function recoverableIn(source: string): string[] {
    // Kotlin: the `-> true` arm of a `when`. Swift: the `return true` case of a
    // `switch`. Both put every recoverable key in one comma-separated run.
    const block =
      /(?:"[a-z_]+",\s*)+"[a-z_]+"\s*->\s*true/.exec(source)?.[0] ??
      /case\s+((?:"[a-z_]+",\s*)+"[a-z_]+"):\s*\n\s*return true/.exec(source)?.[1] ??
      "";
    return [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
  }

  const expected = Object.keys(SCHEDULED_HOLD_REASONS)
    .filter((reason) =>
      scheduledReasonRecovers(reason as keyof typeof SCHEDULED_HOLD_REASONS),
    )
    .sort();

  it.each(Object.entries(SOURCES))(
    "%s recovers exactly the reasons the shared rule does",
    (platform, path) => {
      const found = recoverableIn(read(path));
      expect(
        found.length,
        `${platform}: the recoverable list could not be found at all — the ` +
          `scrape above is structural, so a refactor of that switch makes this ` +
          `check silently vacuous rather than failing`,
      ).toBeGreaterThan(0);
      expect(found, `${platform} disagrees about what will clear on its own`)
        .toEqual(expected);
    },
  );
});
