/**
 * #239 — the response-time copy is identical on web, Android and iOS.
 *
 * The sentences live in three languages with nothing connecting them, and a
 * wording fix applied to one is invisible in the other two. The failure that
 * produces is the #273 one: a crew comparing the phone and the laptop reads two
 * different accounts of the same fortnight and cannot tell which is right.
 *
 * This is the second such guard (see `media-refused-parity.test.ts`). It exists
 * separately rather than folded in because these two sets of sentences change for
 * different reasons.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

const SOURCES: Record<string, string> = {
  web: join(REPO_ROOT, "apps/web/src/components/for-you/response-time-card.tsx"),
  android: join(
    REPO_ROOT,
    "apps/android/app/src/main/kotlin/com/loonext/android/features/foryou/ResponseTimeCard.kt",
  ),
  ios: join(REPO_ROOT, "apps/ios/Loonext/Features/ForYou/ResponseTimeCard.swift"),
};

/**
 * The sentences, as the owner reads them.
 *
 * The arc phrases are fragments because each language interpolates the duration
 * differently; the rest are whole sentences.
 */
const FRAGMENTS: readonly string[] = [
  "when you started",
  "Down from ",
  "Up from ",
  "Your starting point lands once you have been here a fortnight",
  "No answered leads in your first two weeks, so there is nothing to compare",
  "About the same as when you started",
  "to answer a new customer",
  "Slowest 10% of answers",
  "Details",
  "Hide details",
  // #482: the per-number breakdown. The suffix rather than the whole label,
  // because the number itself is interpolated and the arithmetic in front of it
  // is written in three languages — what has to match is the WORD a reader sees
  // next to it, which is the part that could drift into "missed" on one client
  // and "unanswered" on another.
  " unanswered",
];

describe("#239 response-time copy is the same on every client", () => {
  it("reads all three sources, so a passing run means something", () => {
    for (const [platform, path] of Object.entries(SOURCES)) {
      const text = readFileSync(path, "utf8");
      expect(text.length, platform).toBeGreaterThan(1000);
      expect(text, platform).toContain("median_seconds");
    }
  });

  it("carries every fragment on every platform, verbatim", () => {
    const missing: string[] = [];
    for (const [platform, path] of Object.entries(SOURCES)) {
      const text = readFileSync(path, "utf8");
      for (const fragment of FRAGMENTS) {
        if (!text.includes(fragment)) missing.push(`${platform}: ${fragment}`);
      }
    }
    expect(
      missing,
      `These #239 sentences are missing or reworded on some platforms. Change ` +
        `all three together, and update FRAGMENTS here:\n  ` +
        missing.join("\n  "),
    ).toEqual([]);
  });

  it("names the unanswered leak in the singular on every platform", () => {
    // "1 leads nobody answered" is the kind of thing that makes a careful reader
    // stop trusting the rest of the panel.
    for (const [platform, path] of Object.entries(SOURCES)) {
      const text = readFileSync(path, "utf8");
      expect(text, platform).toContain("lead nobody answered");
      expect(text, platform).toContain("leads nobody answered");
    }
  });

  it("asks the shared arc helper on every platform, so the wrong direction is reportable", () => {
    // The check that keeps the good news credible. A client that decides the
    // direction itself is a client that can quietly stop reporting the bad one —
    // and both "Up from" and "Down from" come from this one answer.
    for (const [platform, path] of Object.entries(SOURCES)) {
      const text = readFileSync(path, "utf8");
      expect(text, platform).toMatch(/arcDirection|responseArcDirection/);
      expect(text, platform).toContain("Up from ");
    }
  });
});
