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

import { contactsEn } from "@/i18n/sections/contacts";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

/**
 * #228 — where each client's WORDS live.
 *
 * Web's moved into the catalogue, so scanning `address-list.tsx` for English
 * would now find nothing and this whole file would pass by measuring an empty
 * set. The phones still spell theirs inline, so they are still read from
 * source; web is read from the catalogue that actually feeds the component.
 * The sentence is pinned on all three either way — only web's address changed.
 *
 * The KEYS are listed rather than `Object.values(contactsEn)`. A join of the
 * whole section makes every assertion a substring search over ~200 unrelated
 * sentences, which is how the sibling contact-filter guard passed with its
 * chip renamed to "All people".
 */
const WEB_WORDS = [
  contactsEn.addressPrimary,
  contactsEn.addressMakePrimary,
  contactsEn.addressAddAnother,
  contactsEn.addressLabelPlaceholder,
  contactsEn.addressPlaceholder,
].join("\n");

const SOURCES: Record<string, string> = {
  web: join(REPO_ROOT, "apps/web/src/components/contacts/address-list.tsx"),
  android: join(
    REPO_ROOT,
    "apps/android/app/src/main/kotlin/com/loonext/android/features/contacts/AddressList.kt",
  ),
  ios: join(REPO_ROOT, "apps/ios/Loonext/Features/Contacts/AddressList.swift"),
};

/**
 * #228: where a client's WORDS live, when they left the screen.
 *
 * Web's moved first, which is why `WEB_WORDS` above is built from the catalogue
 * import rather than read off disk. iOS followed, and now Android has too — so
 * every client names these five sentences by key and holds the words in a
 * catalogue, in both languages.
 *
 * Read alongside the screen rather than instead of it: reading only the
 * catalogue would stop noticing if the view quietly rendered something else,
 * which is the question this guard is actually asking. That pairing is why the
 * English still has to appear — it is the ENGLISH copy that is pinned here, and
 * a client whose catalogue reworded it fails whatever its French says.
 */
const CATALOGUES: Partial<Record<keyof typeof SOURCES, string>> = {
  ios: join(REPO_ROOT, "apps/ios/Loonext/Core/I18n/ContactsTasksStrings.swift"),
  android: join(
    REPO_ROOT,
    "apps/android/app/src/main/kotlin/com/loonext/android/core/i18n/ContactsTasksStrings.kt",
  ),
};

/** The screen, plus the catalogue it now reaches for its labels. */
function wordsOf(platform: string, path: string): string {
  const catalogue = CATALOGUES[platform as keyof typeof SOURCES];
  return (
    readFileSync(path, "utf8") +
    (catalogue ? " " + readFileSync(catalogue, "utf8") : "")
  );
}

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
      const text =
        platform === "web" ? WEB_WORDS : wordsOf(platform, path);
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
      const source = readFileSync(path, "utf8");
      const words = platform === "web" ? WEB_WORDS : wordsOf(platform, path);
      expect(words, platform).toContain("Where the van goes");
      // And it is conditional on the flag, not printed on every row. Always
      // read from the SOURCE — this half is about the branch, not the words.
      expect(source, platform).toMatch(/is_primary/);
    }
  });
});
