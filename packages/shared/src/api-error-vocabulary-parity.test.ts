import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ERROR_CODES, INTERNAL_ERROR_CODE } from "./error-codes";
import { CONTACT_IMPORT_ERROR_MESSAGE_KEYS } from "./contact-import";
import { SELF_DOWNGRADE_REQUIRED_MESSAGE_KEY } from "./self-downgrade";

/**
 * #228 — the three clients say the same thing when the server refuses.
 *
 * ## What this is for
 *
 * The API composes its refusals in English. A reader in French gets the CODE's
 * own sentence instead, out of a catalogue each client keeps in its own
 * language — TypeScript on web, Kotlin on Android, Swift on iOS. Three
 * hand-ports of one list.
 *
 * Two ways that rots, and both have happened in this repo already:
 *
 * 1. **A new error code lands with no copy.** `tsc` catches it on web, because
 *    the section is typed as `Record<ErrorCode, string>`. Nothing catches it on
 *    the phones — and their catalogues fail OPEN, so the reader would meet
 *    `apiErrors.some_new_code` on screen, which is worse than the English it
 *    replaced.
 * 2. **A key is added to one client and forgotten on the others.** That is
 *    exactly what happened to the widget snippet: web learned to emit
 *    `data-lang` and both phones kept building the English-only line.
 *
 * ## Both directions, always
 *
 * A key on web and not on iOS is a French reader meeting a raw key. A key on
 * iOS and not on web is a translation of something that no longer exists, which
 * is how a catalogue rots quietly. Subset checks pass on half of that, so every
 * comparison here is set EQUALITY.
 *
 * ## Why it reads source text
 *
 * Kotlin and Swift cannot be imported. What can be read is the file, and the
 * keys are string literals of a fixed shape — which is enough, and is the same
 * approach `widget-snippet-parity.test.ts` takes for the same reason.
 */

const REPO = join(import.meta.dirname, "..", "..", "..");

const CATALOGUES = {
  web: "apps/web/src/i18n/sections/apiErrors.ts",
  android:
    "apps/android/app/src/main/kotlin/com/loonext/android/core/i18n/ApiErrorStrings.kt",
  ios: "apps/ios/Loonext/Core/I18n/ApiErrorStrings.swift",
};

/** Every `apiErrors.*` key a file mentions. */
function keysIn(source: string): Set<string> {
  const found = new Set<string>();
  for (const match of source.matchAll(/"apiErrors\.([A-Za-z0-9_]+)"/g)) {
    found.add(match[1]);
  }
  return found;
}

/**
 * Web writes its keys as bare object properties, not as `"apiErrors.x"`
 * strings, so it is read differently — between the two `= {` openers and their
 * closing braces.
 */
function webKeys(source: string): Set<string> {
  const found = new Set<string>();
  for (const match of source.matchAll(/^ {2}([A-Za-z0-9_]+):/gm)) {
    found.add(match[1]);
  }
  return found;
}

/**
 * The key set every catalogue must carry: one per error code, plus the 5xx
 * reference template. Derived from `ERROR_CODES` rather than written out, so a
 * code added to this package is a failure here on the same commit.
 */
const REQUIRED = new Set<string>([
  ...ERROR_CODES,
  INTERNAL_ERROR_CODE,
  ...CONTACT_IMPORT_ERROR_MESSAGE_KEYS.map((key) =>
    key.slice("apiErrors.".length),
  ),
  SELF_DOWNGRADE_REQUIRED_MESSAGE_KEY.slice("apiErrors.".length),
  "withReference",
]);

const sources = Object.fromEntries(
  Object.entries(CATALOGUES).map(([client, path]) => [
    client,
    readFileSync(join(REPO, path), "utf8"),
  ]),
) as Record<keyof typeof CATALOGUES, string>;

const keys: Record<string, Set<string>> = {
  web: webKeys(sources.web),
  android: keysIn(sources.android),
  ios: keysIn(sources.ios),
};

const sorted = (set: Set<string>) => [...set].sort();

describe("#228 every client can name every refusal", () => {
  it("found all three catalogues, so a passing run means something", () => {
    // The failure mode of every source-reading check: a path that resolves to
    // nothing makes each assertion below vacuously true.
    for (const [client, set] of Object.entries(keys)) {
      expect(set.size, `${client}'s catalogue produced no keys`).toBeGreaterThan(15);
    }
    expect(REQUIRED.size).toBeGreaterThan(15);
  });

  for (const client of Object.keys(CATALOGUES)) {
    it(`${client} has a sentence for every error code, and no extras`, () => {
      expect(
        sorted(keys[client]),
        `${client}'s error vocabulary has drifted from packages/shared. A ` +
          `missing key is not a missing translation — the catalogues fail open, ` +
          `so the reader meets the key's own name on screen.`,
      ).toEqual(sorted(REQUIRED));
    });
  }
});

describe("#228 the French is real French", () => {
  /**
   * The failure a key check cannot see: a French entry copied from the English
   * one type-checks, renders, and is still English. Read as whole files rather
   * than per key, because the three languages quote and wrap differently.
   */
  it("every catalogue carries accented French, not a copy of the English", () => {
    for (const [client, source] of Object.entries(sources)) {
      const accented = source.match(/[éèêàçôûùî]/g) ?? [];
      expect(
        accented.length,
        `${client}'s catalogue has almost no accented characters, which means ` +
          `its French half is probably still English`,
      ).toBeGreaterThan(20);
    }
  });

  it("says Référence rather than Reference in the French template", () => {
    // The one string with a word in both languages that differ by one accent —
    // the likeliest to be pasted across unchanged.
    for (const [client, source] of Object.entries(sources)) {
      expect(source.includes("Référence {id}."), `${client} lost the French reference`).toBe(
        true,
      );
      expect(source.includes("Reference {id}."), `${client} lost the English reference`).toBe(
        true,
      );
    }
  });
});
