/**
 * #243 — the API keys copy is byte-identical on web, Android and iOS.
 *
 * Its neighbours in this directory assert a LIST of fragments, and that shape
 * is right when a screen's copy is spread through its source. This section's
 * copy is not: all of it lives in one catalogue per client, so the complete
 * answer is available and a sample would be strictly worse. A fragment list is
 * never finished — it agrees with any sentence nobody thought to add to it —
 * and this compares the whole set, both directions, in both languages.
 *
 * It is also what makes the iOS catalogue's DERIVATION honest. That file is
 * generated from the Android one rather than typed, and a generator with a
 * regex bug drops entries silently; this is the thing that would notice.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { apiKeysEn, apiKeysFr } from "@/i18n/sections/apiKeys";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

const ANDROID = join(
  REPO_ROOT,
  "apps/android/app/src/main/kotlin/com/loonext/android/core/i18n/ApiKeysStrings.kt",
);
const IOS = join(REPO_ROOT, "apps/ios/Loonext/Core/I18n/ApiKeysStrings.swift");

/**
 * Glue a wrapped literal back into one sentence, in either dialect.
 *
 * Kotlin puts the `+` at the END of the line; Swift puts it at the START of the
 * continuation. A guard that knows only one of those reports every long
 * sentence on the other client as different, which is the failure the first
 * Android sweep produced.
 */
function joinWrapped(text: string): string {
  return text
    .replace(/"\s*\+\s*\n\s*"/g, "")
    .replace(/"\s*\n\s*\+\s*"/g, "");
}

/** Kotlin `"key" to "value"` pairs, in declaration order. */
function kotlinPairs(text: string): [string, string][] {
  const out: [string, string][] = [];
  const re = /"([^"]+)"\s+to\s*\n?\s*"((?:[^"\\]|\\.)*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(joinWrapped(text)))) out.push([match[1]!, match[2]!]);
  return out;
}

/** Swift `"key": "value"` pairs, in declaration order. */
function swiftPairs(text: string): [string, string][] {
  const out: [string, string][] = [];
  const re = /"([^"]+)"\s*:\s*\n?\s*"((?:[^"\\]|\\.)*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(joinWrapped(text)))) out.push([match[1]!, match[2]!]);
  return out;
}

/**
 * Split a client catalogue into its two languages.
 *
 * Only the FIRST occurrence of a key in each half is taken, because a map
 * literal is read top to bottom and the French half is not an undeclared
 * English one.
 */
function splitLanguages(
  text: string,
  marker: { en: string; fr: string },
  parse: (chunk: string) => [string, string][],
): { en: Map<string, string>; fr: Map<string, string> } {
  const enStart = text.indexOf(marker.en);
  const frStart = text.indexOf(marker.fr);
  expect(enStart, `${marker.en} not found`).toBeGreaterThan(-1);
  expect(frStart, `${marker.fr} not found`).toBeGreaterThan(enStart);
  return {
    en: new Map(parse(text.slice(enStart, frStart))),
    fr: new Map(parse(text.slice(frStart))),
  };
}

/**
 * The web catalogue, keyed the way the phones key it.
 *
 * The web nests its section, so its own key is `intro` where a phone stores
 * `apiKeys.intro`. The prefix is the section name, applied here rather than
 * duplicated into the TypeScript — the phones cannot nest, and the web should
 * not be made to carry the prefix twice just so a test can compare them.
 */
function webMap(source: Record<string, string>): Map<string, string> {
  return new Map(
    Object.entries(source).map(([key, value]) => [`apiKeys.${key}`, value]),
  );
}

const android = splitLanguages(
  readFileSync(ANDROID, "utf8"),
  { en: "override val en", fr: "override val frCA" },
  kotlinPairs,
);
const ios = splitLanguages(
  readFileSync(IOS, "utf8"),
  { en: "en: [", fr: "frCA: [" },
  swiftPairs,
);

const CLIENTS = [
  { name: "android", en: android.en, fr: android.fr },
  { name: "ios", en: ios.en, fr: ios.fr },
] as const;

describe("#243 API key copy is the same product on all three clients", () => {
  it("the web catalogue is not empty, so a broken import cannot pass this", () => {
    // Every assertion below compares against the web. If the import ever
    // resolved to nothing, every one of them would compare two empty sets and
    // report agreement — the shape of a guard that has stopped guarding.
    expect(webMap(apiKeysEn).size).toBeGreaterThan(40);
    expect(webMap(apiKeysFr).size).toBe(webMap(apiKeysEn).size);
  });

  for (const client of CLIENTS) {
    it(`${client.name} holds exactly the web's keys, both languages`, () => {
      const web = [...webMap(apiKeysEn).keys()].sort();
      // Set equality in BOTH directions. A containment check passes when a
      // client grows a key the others never got, which is how one phone ends
      // up quietly saying something the other cannot.
      expect([...client.en.keys()].sort()).toEqual(web);
      expect([...client.fr.keys()].sort()).toEqual(web);
    });

    it(`${client.name} says the same English, word for word`, () => {
      const web = webMap(apiKeysEn);
      const differences: string[] = [];
      for (const [key, expected] of web) {
        const actual = client.en.get(key);
        if (actual !== expected) {
          differences.push(`${key}\n  web: ${expected}\n  ${client.name}: ${actual}`);
        }
      }
      expect(differences.join("\n\n")).toBe("");
    });

    it(`${client.name} says the same French, word for word`, () => {
      // The half that matters more. English drift is visible to whoever wrote
      // it; a French sentence that quietly differs between two devices is seen
      // only by the reader it was translated for, and only as confusion.
      const web = webMap(apiKeysFr);
      const differences: string[] = [];
      for (const [key, expected] of web) {
        const actual = client.fr.get(key);
        if (actual !== expected) {
          differences.push(`${key}\n  web: ${expected}\n  ${client.name}: ${actual}`);
        }
      }
      expect(differences.join("\n\n")).toBe("");
    });
  }

  it("no sentence was left in English on a French screen", () => {
    // The failure this catches is a copy-paste: a French map that carries an
    // English value because somebody duplicated the block and translated most
    // of it. Checked against the whole catalogue rather than a sample, and
    // exempting only what is deliberately identical in both languages.
    const identicalOnPurpose = new Set<string>([
      // Nothing yet. Every sentence on this screen is prose, so any English
      // appearing in the French map is a copy-paste rather than a word that
      // happens to be the same.
    ]);
    const shared: string[] = [];
    for (const [key, english] of webMap(apiKeysEn)) {
      if (identicalOnPurpose.has(key)) continue;
      const french = webMap(apiKeysFr).get(key);
      if (french === english && english.length > 12) shared.push(key);
    }
    expect(shared).toEqual([]);
  });
});
