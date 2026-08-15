#!/usr/bin/env node
/**
 * Every catalogue key an iOS screen asks for must exist, in both languages.
 *
 * #228. This guard exists because its absence broke every settings screen and
 * nothing noticed.
 *
 * ---------------------------------------------------------------------------
 * WHAT HAPPENED, since a guard whose reason is forgotten gets deleted.
 *
 * The iOS extraction converted every Settings call site to
 * `AppStrings.translate(appLocale, "settingsMore.…")` and the section defining
 * those keys was never written — 225 keys referenced, none defined. The app
 * displayed the literal text `settingsMore.signOut` where a person expected
 * "Sign out".
 *
 * It shipped silently because `AppStrings.translate` resolves
 *
 *     table(locale)[key] ?? en[key] ?? key
 *
 * A missing key RENDERS ITS OWN NAME. That is a reasonable default for a
 * running app — a screen with one odd label beats a crash — and it means the
 * failure has no runtime signal at all. Nothing throws, nothing logs.
 *
 * Worse, the check that should have noticed got HAPPIER: the hardcoded-string
 * ledger counts literals REMOVED, and a converted-but-undefined key is the
 * absence of a literal. It recorded the breakage as a 408-literal improvement.
 * A ratchet that counts only removals cannot tell deletion from destruction.
 *
 * ---------------------------------------------------------------------------
 * WHY NODE AND NOT XCTest.
 *
 * Android's `AppStringsTest` does this in Kotlin and runs in its own unit
 * tests. The iOS twin would have to be Swift, and Swift compiles in exactly one
 * place in this project — CI's `Gate / iOS`, which is the slowest job and
 * cannot run on a contributor's machine at all. A key/value question needs no
 * compiler, so this asks it where the answer is free.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT CHECKS, and the one thing it deliberately does not.
 *
 *   1. Every key a screen names is defined.       (the defect above)
 *   2. English and French define the SAME keys, both directions, per section.
 *      A French section missing a key falls back to English silently, so a
 *      half-translated screen reads as finished.
 *   3. Both languages interpolate the same {tokens}. A French sentence that
 *      drops {amount} shows a bill with no figure on it — Android's test makes
 *      the same argument and it is the one worth having.
 *   4. It found keys at all. A sweep that greps nothing passes vacuously, which
 *      is how the original defect survived every other check.
 *
 * NOT CHECKED: unused keys. A key can be reached through a variable — six
 * screens hold one in a local `key` and pass it on — so "defined but never
 * seen" is not evidence of anything, and failing on it would punish correct
 * code. Missing is provable; unused is not.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const IOS = join(REPO_ROOT, "apps/ios/Loonext");
const CATALOGUE = join(IOS, "Core/I18n");

/**
 * Both spellings, and across newlines.
 *
 * Screens reach the catalogue through a private `t(_ key:)` wrapper as often as
 * through `AppStrings.translate` directly, and SwiftUI call sites wrap, so the
 * key routinely sits on the line after the paren. A same-line `translate`-only
 * pattern misses roughly two hundred call sites in this app — measured, not
 * assumed, while writing this file.
 */
const CALL = /(?:\bt|translate)\(\s*(?:[^,()]+,\s*)?"([a-zA-Z]\w*\.\w+)"/gs;

/**
 * `messageKey: "common.errNetwork"` — a key that travels as DATA.
 *
 * #228: `ApiError` carries the key of the sentence it wants rather than the
 * sentence, so the renderer can translate it. That reaches the catalogue just
 * as surely as `t(…)` does, and this guard was blind to it — four keys were
 * named at throw sites and defined nowhere, which `translate` answers by
 * returning the key itself. A customer would have read `common.errNetwork`.
 *
 * The same shape the Android twin's `ApiExceptionLocaleTest` walks for. Kept
 * here rather than only in a Swift test because iOS compiles only in CI, and a
 * missing key should fail in a second on a laptop.
 */
const KEY_AS_DATA = /messageKey:\s*"([a-zA-Z]\w*\.\w+)"/g;

/** `"section.key": "value"` — how a Swift catalogue section stores one. */
const DEFINITION = /"([a-zA-Z]\w*\.\w+)"\s*:/g;

/** `{name}` placeholders, which both languages must carry identically. */
const TOKEN = /\{(\w+)\}/g;

function swiftFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return swiftFiles(full);
    return entry.endsWith(".swift") ? [full] : [];
  });
}

const failures = [];

// --- 1 and 4: every key a screen names is defined ---------------------------

const defined = new Set();
for (const file of swiftFiles(CATALOGUE)) {
  for (const [, key] of readFileSync(file, "utf8").matchAll(DEFINITION)) {
    defined.add(key);
  }
}

const used = new Map();
for (const file of swiftFiles(IOS)) {
  if (file.replaceAll("\\", "/").includes("/Core/I18n/")) continue;
  const relative = file.slice(IOS.length + 1).replaceAll("\\", "/");
  const source = readFileSync(file, "utf8");
  // Both ways a key reaches the catalogue: named at a call, or carried as data
  // on an error that is rendered later.
  for (const pattern of [CALL, KEY_AS_DATA]) {
    for (const [, key] of source.matchAll(pattern)) {
      if (!used.has(key)) used.set(key, new Set());
      used.get(key).add(relative);
    }
  }
}

if (used.size < 300) {
  failures.push(
    `only ${used.size} catalogue keys found in the iOS app. This sweep is ` +
      `supposed to see hundreds — a low count means the patterns stopped ` +
      `matching, not that the app stopped translating.`,
  );
}
if (defined.size < 300) {
  failures.push(`only ${defined.size} keys defined across the catalogue sections.`);
}

for (const [key, screens] of [...used].sort()) {
  if (!defined.has(key)) {
    failures.push(
      `${key} is asked for by ${[...screens].sort().join(", ")} and defined ` +
        `nowhere. It will render as its own name.`,
    );
  }
}

// --- 2 and 3: the two languages agree, per section --------------------------

for (const file of swiftFiles(CATALOGUE)) {
  const source = readFileSync(file, "utf8");
  const name = file.slice(CATALOGUE.length + 1).replaceAll("\\", "/");
  const maps = { en: new Map(), fr: new Map() };

  // Each surface is its own `private let …En` / `…Fr` map, so the language is
  // read off the binding rather than guessed from position in the file.
  for (const match of source.matchAll(
    /private let \w+?(En|Fr)\s*:\s*\[String: String\]\s*=\s*\[([\s\S]*?)\n\]/g,
  )) {
    const side = match[1] === "En" ? "en" : "fr";
    // Fold Swift's leading-plus concatenation so a sentence split across lines
    // is measured whole — otherwise every long string looks token-free.
    const body = match[2].replace(/"\s*\+\s*"/g, "");
    /*
     * The value pattern must survive an ESCAPED QUOTE. `settings.callerIdConfirm`
     * is `"Update your caller ID to \"{name}\"?"` — a naive `"[^"]*"` stops at
     * the `\"` and captures a value with no token in it, so this guard's first
     * run reported four token mismatches that were all its own. Both languages
     * carried `{name}` the whole time.
     */
    const STRING = String.raw`"(?:[^"\\]|\\.)*"`;
    const entries = new RegExp(
      String.raw`"([a-zA-Z]\w*\.\w+)"\s*:\s*((?:${STRING}\s*)+)`,
      "g",
    );
    for (const entry of body.matchAll(entries)) {
      maps[side].set(entry[1], entry[2]);
    }
  }

  if (maps.en.size === 0 && maps.fr.size === 0) continue;

  for (const key of maps.en.keys()) {
    if (!maps.fr.has(key)) failures.push(`${name}: ${key} has English and no French.`);
  }
  for (const key of maps.fr.keys()) {
    if (!maps.en.has(key)) failures.push(`${name}: ${key} has French and no English.`);
  }
  for (const [key, english] of maps.en) {
    const french = maps.fr.get(key);
    if (french === undefined) continue;
    const left = [...english.matchAll(TOKEN)].map((m) => m[1]).sort().join(",");
    const right = [...french.matchAll(TOKEN)].map((m) => m[1]).sort().join(",");
    if (left !== right) {
      failures.push(
        `${name}: ${key} interpolates {${left || "nothing"}} in English and ` +
          `{${right || "nothing"}} in French. A sentence that drops a token ` +
          `shows a figure-less bill or a nameless greeting.`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("iOS catalogue keys:\n");
  for (const failure of failures.slice(0, 40)) console.error(`  - ${failure}`);
  if (failures.length > 40) console.error(`  … and ${failures.length - 40} more.`);
  process.exit(1);
}

console.log(
  `iOS catalogue: ${used.size} keys asked for across the app, ${defined.size} ` +
    `defined, both languages agreeing.`,
);
