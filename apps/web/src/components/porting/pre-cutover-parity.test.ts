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

const SOURCES: Record<string, string> = {
  // #248: the TypeScript definition moved to the shared package, which is where
  // a contract three clients depend on belongs — `copy.ts` re-exports it, so
  // every call site on web is unchanged. This path follows the definition; the
  // guard is unaffected, because what it checks is that all three languages say
  // the same sentences and that is still hand-kept on two of them.
  web: join(REPO_ROOT, "packages/shared/src/porting.ts"),
  /*
   * #228: Android's copy moved into the string catalogue, so the screen file no
   * longer contains these sentences — it contains the KEYS that reach them.
   * This guard follows the copy, exactly as it followed the TypeScript
   * definition into the shared package above.
   *
   * The catalogue is read whole rather than resolved key-by-key: what #319
   * protects is that the SENTENCES exist and are in order, and both facts are
   * as true of a catalogue as they were of a Composable. iOS has not been
   * extracted yet and still holds its literals inline.
   */
  android: join(
    REPO_ROOT,
    "apps/android/app/src/main/kotlin/com/loonext/android/core/i18n/SettingsMoreStrings.kt",
  ),
  ios: join(REPO_ROOT, "apps/ios/Loonext/Features/Settings/PortCards.swift"),
};

/**
 * Source with cross-line string concatenation folded away, so a sentence split
 * over two lines in Kotlin or Swift still matches the one written whole in TS.
 */
function flattened(path: string): string {
  return readFileSync(path, "utf8")
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
    for (const [platform, path] of Object.entries(SOURCES)) {
      const text = flattened(path);
      expect(
        text.indexOf("Keep your old service active."),
        platform,
      ).toBeLessThan(text.indexOf("Export your message history."));
      expect(
        text.indexOf("Export your message history."),
        platform,
      ).toBeLessThan(text.indexOf("Tell the crew the switch date."));
      expect(
        text.indexOf("Tell the crew the switch date."),
        platform,
      ).toBeLessThan(text.indexOf("Expect texting to trail calls."));
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
    const ios = readFileSync(SOURCES.ios, "utf8");
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
