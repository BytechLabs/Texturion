/**
 * #291 — the address list reads the same on web, Android and iOS.
 *
 * The sentence that matters is the primary marker. "Where the van goes" is the
 * whole reason the list is ordered the way it is, and a client that said
 * something else — or nothing — would leave a crew guessing which of forty
 * addresses is the one.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

const SOURCES: Record<string, string> = {
  web: join(REPO_ROOT, "apps/web/src/components/contacts/address-list.tsx"),
  android: join(
    REPO_ROOT,
    "apps/android/app/src/main/kotlin/com/loonext/android/features/contacts/AddressList.kt",
  ),
  ios: join(REPO_ROOT, "apps/ios/Loonext/Features/Contacts/AddressList.swift"),
};

const FRAGMENTS: readonly string[] = [
  "Where the van goes",
  "Make it the main one",
  "Add another address",
  "Unit 4, Billing, the rooftop…",
  "Where the job is",
];

describe("#291 the address list reads the same everywhere", () => {
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
      "These #291 sentences are missing or reworded on some clients:\n  " +
        missing.join("\n  "),
    ).toEqual([]);
  });

  it("names the primary rather than relying on position, on all three", () => {
    // Ordering communicates "which one" only to somebody who already knows the
    // ordering means something. Every client has to say it.
    for (const [platform, path] of Object.entries(SOURCES)) {
      const text = readFileSync(path, "utf8");
      expect(text, platform).toContain("Where the van goes");
      // And it is conditional on the flag, not printed on every row.
      expect(text, platform).toMatch(/is_primary/);
    }
  });
});
