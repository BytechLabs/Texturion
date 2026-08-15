/**
 * #319 — the pre-cutover checklist says the same thing on every client.
 *
 * These four sentences are the only in-product warning that cancelling the old
 * service early "can release the number back to the carrier", which is the one
 * way a customer genuinely loses the number their business runs on. A crew
 * comparing the phone in the van against the laptop in the office must not read
 * two different versions of that, and a client that quietly drops an item is
 * the failure that costs somebody their number.
 *
 * The copy lives in three languages with nothing connecting them, so this reads
 * all three sources. Same guard shape as `response-time-parity.test.ts`, for
 * the same reason: Kotlin and Swift are not runnable from this suite, and the
 * drift being caught is somebody editing one and not the other two.
 *
 * Whitespace is normalised before comparing because each language wraps a long
 * literal differently: Kotlin and Swift concatenate across lines, TypeScript
 * does not. The wrap is formatting; the sentence is the contract.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

/** #228: the Android SCREEN, which still owns the state gate. */
const ANDROID_SCREEN = join(
  REPO_ROOT,
  "apps/android/app/src/main/kotlin/com/loonext/android/features/settings/PortCards.kt",
);

/** The iOS SCREEN, for the same reason — iOS moved its copy out too. */
const IOS_SCREEN = join(
  REPO_ROOT,
  "apps/ios/Loonext/Features/Settings/PortCards.swift",
);

/*
 * A LIST per client, because #228 did not move every client's copy to the same
 * place. Android's whole checklist went to the catalogue; iOS moved only the
 * HEADING and still declares the four items as literals in `preCutoverSteps`.
 * Reading one file per client would have made this guard pass on a client that
 * had lost half its checklist, which is the failure it exists to catch.
 */
const SOURCES: Record<string, readonly string[]> = {
  // #248: the TypeScript definition moved to the shared package, which is where
  // a contract three clients depend on belongs — `copy.ts` re-exports it, so
  // every call site on web is unchanged. This path follows the definition; the
  // guard is unaffected, because what it checks is that all three languages say
  // the same sentences and that is still hand-kept on two of them.
  /*
   * #228: web's copy moved into its catalogue, exactly as Android's and iOS's
   * did below. `porting.ts` names the keys now, so reading it asks whether a
   * file holds sentences it no longer holds — and this guard checks that all
   * three say the same words, which is a question about where the words are.
   */
  web: [join(REPO_ROOT, "apps/web/src/i18n/sections/settingsMore.ts")],
  /*
   * #228: Android's copy moved into the string catalogue, so the screen file no
   * longer contains these sentences — it contains the KEYS that reach them.
   * This guard follows the copy, exactly as it followed the TypeScript
   * definition into the shared package above.
   *
   * The catalogue is read whole rather than resolved key-by-key: what #319
   * protects is that the SENTENCES exist and are in order, and both facts are
   * as true of a catalogue as they were of a Composable.
   *
   * iOS followed, so all three now point at wherever the words actually live.
   * Its state gate moved to `IOS_SCREEN` for the same reason Android's did.
   */
  android: [
    join(
      REPO_ROOT,
      "apps/android/app/src/main/kotlin/com/loonext/android/core/i18n/SettingsMoreStrings.kt",
    ),
  ],
  ios: [
    join(REPO_ROOT, "apps/ios/Loonext/Core/I18n/SettingsMoreStrings.swift"),
    IOS_SCREEN,
  ],
};

/**
 * Where each client's ORDER is decided, which is not always where its words are.
 *
 * Both phones build the checklist from an array of KEYS in their screen file and
 * resolve each against the catalogue. So the screen file is what orders the list
 * and the catalogue is just a dictionary — its entries could be alphabetised
 * tomorrow without changing a pixel. Web still declares the four items in order
 * in the shared module, so for web the two are the same file.
 */
const ORDER_SOURCES: Record<string, readonly string[]> = {
  web: SOURCES.web,
  android: [ANDROID_SCREEN],
  ios: [IOS_SCREEN],
};

/**
 * The four items in the order they must appear, in whatever each client's
 * ordering source actually names them by.
 *
 * "Keep your old service active" is the only one whose cost is unrecoverable —
 * a customer who skips it can lose the number — so it leads, and nothing may
 * push it down into the place people stop reading.
 */
const ORDERED_ANCHORS: Record<string, readonly string[]> = {
  web: [
    "Keep your old service active.",
    "Export your message history.",
    "Tell the crew the switch date.",
    "Expect texting to trail calls.",
  ],
  android: [
    "settingsMore.cutoverKeepOld",
    "settingsMore.cutoverExport",
    "settingsMore.cutoverTellCrew",
    "settingsMore.cutoverTextsTrail",
  ],
  ios: [
    "settingsMore.cutoverKeepOld",
    "settingsMore.cutoverExport",
    "settingsMore.cutoverTellCrew",
    "settingsMore.cutoverTextsTrail",
  ],
};

/**
 * Source with cross-line string concatenation folded away, so a sentence split
 * over two lines in Kotlin or Swift still matches the one written whole in TS.
 */
function flattened(paths: readonly string[]): string {
  return paths
    .map((path) => readFileSync(path, "utf8"))
    // A space, not a newline: everything below collapses runs of whitespace
    // anyway, and a literal escape here is how this file got a parse error.
    .join(" ")
    // `"…a " +\n  "b…"` and `"…a "\n  + "b…"` both become `"…ab…"`.
    .replace(/"\s*\+\s*\n\s*"/g, "")
    .replace(/"\s*\n\s*\+\s*"/g, "")
    .replace(/\s+/g, " ");
}

/** Every sentence, in the order a reader meets them. */
const LINES: readonly string[] = [
  "Before your number switches",
  "Keep your old service active.",
  "Cancelling before the transfer finishes can release the number back to the carrier, and that is the one way to genuinely lose it.",
  "Export your message history.",
  "The number moves, your old conversations do not.",
  "Tell the crew the switch date.",
  "From that morning, calls and texts arrive in this inbox instead of the old one.",
  "Expect texting to trail calls.",
  "Voice and texting can finish on different clocks, so texts may take an extra day. We will tell you when both are live.",
];

describe("#319 the pre-cutover checklist is the same on every client", () => {
  it("reads all three sources, so a passing run means something", () => {
    for (const [platform, path] of Object.entries(SOURCES)) {
      expect(flattened(path).length, platform).toBeGreaterThan(1000);
    }
  });

  it("carries every line on every platform, verbatim", () => {
    const missing: string[] = [];
    for (const [platform, path] of Object.entries(SOURCES)) {
      const text = flattened(path);
      for (const line of LINES) {
        if (!text.includes(line)) missing.push(`${platform}: ${line}`);
      }
    }
    expect(
      missing,
      `These #319 checklist lines are missing or reworded on some platforms. ` +
        `Change all three together:\n  ` + missing.join("\n  "),
    ).toEqual([]);
  });

  it("leads with the item that can lose them the number", () => {
    // Ordering is the design, not a detail. "Keep your old service active" is
    // the only one whose cost is unrecoverable, so it cannot drift down the
    // list into the place people stop reading.
    //
    // ASKED OF THE FILE THAT ORDERS THE LIST, which is not always the file that
    // holds the words. Once a client's copy moves into a catalogue, the order
    // of entries in that catalogue is AUTHORING order and decides nothing — a
    // dictionary is not a screen. iOS is the case that proved it: its
    // `preCutoverSteps` array is in exactly the right order while its catalogue
    // happened to define "Export" above "Keep your old service active", and
    // this check failed on a screen that was correct.
    //
    // Android passed the old way purely because its catalogue happened to be
    // authored in checklist order. That is luck, not a guarantee, and it would
    // have broken silently the first time somebody sorted the file.
    for (const [platform, anchors] of Object.entries(ORDERED_ANCHORS)) {
      const text = flattened(ORDER_SOURCES[platform]);
      for (let i = 1; i < anchors.length; i += 1) {
        const previous = text.indexOf(anchors[i - 1]);
        const current = text.indexOf(anchors[i]);
        expect(previous, `${platform}: ${anchors[i - 1]} not found`).toBeGreaterThan(-1);
        expect(current, `${platform}: ${anchors[i]} not found`).toBeGreaterThan(-1);
        expect(
          previous,
          `${platform}: "${anchors[i - 1]}" must come before "${anchors[i]}"`,
        ).toBeLessThan(current);
      }
    }
  });


  it("is shown for the same four transfer states everywhere", () => {
    // A client that dropped `in-process` would leave the customers most likely
    // to be sitting and waiting with a status line and no guidance.
    const web = readFileSync(
      join(REPO_ROOT, "apps/web/src/components/settings/port-card.tsx"),
      "utf8",
    );
    for (const status of [
      "submitted",
      "in-process",
      "foc-date-confirmed",
      "activation-in-progress",
    ]) {
      expect(web, `web gate missing ${status}`).toContain(status);
    }
    /*
     * #228: the GATE stayed on the screen while the COPY moved to the
     * catalogue, so this assertion reads the screen and the one above reads the
     * catalogue. Two sources for one client is worth the awkwardness — the two
     * questions are genuinely different, and folding them would mean asserting
     * a state machine against a map of sentences.
     */
    const android = readFileSync(ANDROID_SCREEN, "utf8");
    for (const status of [
      "SUBMITTED",
      "IN_PROCESS",
      "FOC_DATE_CONFIRMED",
      "ACTIVATION_IN_PROGRESS",
    ]) {
      expect(android, `android gate missing ${status}`).toContain(status);
    }
    const ios = readFileSync(IOS_SCREEN, "utf8");
    for (const status of [
      "submitted",
      "inProcess",
      "focDateConfirmed",
      "activationInProgress",
    ]) {
      expect(ios, `ios gate missing ${status}`).toContain(status);
    }
  });

  it("carries no em or en dash, on any platform", () => {
    // Law 6, in rendered copy. Checked against the checklist lines rather than
    // the whole file, because KDoc and doc comments legitimately use dashes.
    for (const line of LINES) {
      expect(line).not.toContain("—");
      expect(line).not.toContain("–");
    }
  });
});
