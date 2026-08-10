/**
 * #291 — the contacts filter reads the same on web, Android and iOS.
 *
 * The rule that matters is WHICH FIELDS get offered. Only a dropdown or a
 * yes/no field has a closed set of answers; a serial number does not, and a
 * client that offered one would be offering a text box that returns nothing
 * until it is typed perfectly — which is search, and search already reads it.
 * A client that got this wrong would look like it had more features, not
 * fewer, which is why it needs pinning rather than reviewing.
 *
 * Assertions run against the source with COMMENTS STRIPPED, because the prose
 * explaining each rule contains the rule's own words.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { contactsEn } from "@/i18n/sections/contacts";

import { parityCode } from "./parity-source";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

/**
 * #228 — web's chip labels live in the catalogue now.
 *
 * THE KEYS ARE LISTED, not `Object.values(contactsEn)`. Joining the whole
 * section makes every assertion below a substring search over ~200 unrelated
 * sentences, and "Everyone" appears inside "Everyone in this file agreed to be
 * texted by this business." — so this guard passed with the chip renamed to
 * "All people". Found by making exactly that change. The two keys named here
 * are the two chips this test is about.
 */
const WEB_WORDS = [contactsEn.filterEveryone, contactsEn.notSet].join("\n");

const SOURCES: Record<string, string> = {
  web: join(REPO_ROOT, "apps/web/src/components/contacts/contact-filter.tsx"),
  android: join(
    REPO_ROOT,
    "apps/android/app/src/main/kotlin/com/loonext/android/features/contacts/ContactFilter.kt",
  ),
  ios: join(REPO_ROOT, "apps/ios/Loonext/Features/Contacts/ContactFilter.swift"),
};

const code = parityCode;

describe("#291 the contacts filter reads the same everywhere", () => {
  it("reads every source, so a passing run means something", () => {
    for (const [platform, path] of Object.entries(SOURCES)) {
      expect(code(path).length, platform).toBeGreaterThan(1000);
    }
  });

  it("offers only the kinds with a closed set of answers", () => {
    // A client that also offered `text`, `number` or `date` would be offering
    // a filter that cannot be satisfied from a picker.
    for (const [platform, path] of Object.entries(SOURCES)) {
      const text = code(path);
      expect(text, `${platform}: filters on select`).toContain('"select"');
      expect(text, `${platform}: filters on checkbox`).toContain('"checkbox"');
      for (const kind of ['"text"', '"number"', '"date"']) {
        expect(text, `${platform}: must not offer ${kind}`).not.toContain(kind);
      }
    }
  });

  it("gives a yes/no field yes and no, never its own options list", () => {
    // A checkbox has no `options`, so a client that reused the select branch
    // would render a picker with nothing in it but "Not set".
    for (const [platform, path] of Object.entries(SOURCES)) {
      const text = code(path);
      expect(text, `${platform}: yes/no answers`).toMatch(
        /listOf\("yes", "no"\)|\["yes", "no"\]|value="yes"/,
      );
    }
  });

  it("labels the chips the same way on every client", () => {
    for (const sentence of ["Everyone", "Not set"]) {
      for (const [platform, path] of Object.entries(SOURCES)) {
        const text = platform === "web" ? WEB_WORDS : code(path);
        expect(text, `${platform}: ${sentence}`).toContain(sentence);
      }
    }
  });

  /** Where each client renders the list, and so its empty state. */
  const LIST_SCREENS: Record<string, string> = {
    web: join(REPO_ROOT, "apps/web/src/components/contacts/contacts-table.tsx"),
    android: join(
      REPO_ROOT,
      "apps/android/app/src/main/kotlin/com/loonext/android/features/contacts/ContactsTab.kt",
    ),
    ios: join(REPO_ROOT, "apps/ios/Loonext/Features/Contacts/ContactsTab.swift"),
  };

  it("tells a filtered-empty list it is filtered, on the screen that shows it", () => {
    // Asserted on the LIST SCREEN, not on the filter. Checked against the
    // filter file, this passed with the copy declared and never used —
    // renaming the iOS constant left the words in the source, attached to
    // nothing. The failure it guards against is real and quiet: "they're added
    // automatically when someone texts you" under an active filter reads as
    // having no customers at all.
    for (const [platform, path] of Object.entries(LIST_SCREENS)) {
      const text = code(path);
      const reachesIt =
        text.includes("Nobody matches that yet") ||
        text.includes("CONTACT_FILTER_EMPTY_TITLE") ||
        text.includes("contactFilterEmptyTitle") ||
        // #228: web reaches it through the catalogue key.
        text.includes("contacts.filteredEmptyTitle");
      expect(reachesIt, `${platform}: no filtered-empty state`).toBe(true);
    }
  });

  it("lets the filter be cleared on every client", () => {
    // A filter that cannot be undone is a list somebody has to leave the
    // screen to escape.
    for (const [platform, path] of Object.entries(SOURCES)) {
      const text = code(path);
      expect(text, `${platform}: clears to nothing`).toMatch(
        /onChange\(undefined\)|onChange\(null\)|onChange\(nil\)/,
      );
    }
  });
});
