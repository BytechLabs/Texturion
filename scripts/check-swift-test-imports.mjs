#!/usr/bin/env node
/**
 * A Swift test that names an app type must import the app.
 *
 *   node scripts/check-swift-test-imports.mjs
 *
 * ---------------------------------------------------------------------------
 * WHY
 *
 * There is no Swift compiler on the machine this repo is developed on — the
 * only build is CI's `Gate / iOS`, and a round trip to it is roughly fifteen
 * minutes. So the cheap classes of Swift mistake are worth catching here, and
 * this is one of the cheapest.
 *
 * Not every test file imports the app, ON PURPOSE. `CancelOneActionTests` reads
 * `BillingSection.swift` as TEXT and asserts things about its shape — what sits
 * above the button that leaves, what may switch it off. It imports XCTest and
 * nothing else, and that independence is the point: it cannot be satisfied by a
 * value the app computes, only by the source saying what it says.
 *
 * Which makes it exactly the file somebody adds `AppStrings.en["…"]` to while
 * repointing an assertion at the catalogue. That happened during #228's iOS
 * sweep and was caught by rereading rather than by tooling; the version before
 * it was caught cost a CI cycle to a positional argument label.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS CHECKED
 *
 * The app's own top-level type names are collected from `apps/ios/Loonext`, and
 * any test file that names one without `@testable import Loonext` fails. The
 * vocabulary is DERIVED rather than listed, so a type added next year is
 * covered without anybody remembering this file exists.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const APP = "apps/ios/Loonext";
const TESTS = "apps/ios/LoonextTests";

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.name.endsWith(".swift")) out.push(path);
  }
  return out;
}

/** `enum AppStrings {`, `struct Foo:`, `final class Bar {` … */
const DECLARES = /\b(?:final\s+)?(?:public\s+|internal\s+)?(?:enum|struct|class|actor|protocol)\s+([A-Z][A-Za-z0-9_]*)/g;

const appTypes = new Set();
for (const file of walk(APP)) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(DECLARES)) appTypes.add(match[1]);
}

if (appTypes.size < 50) {
  console.error(
    `Swift test imports: only ${appTypes.size} app type(s) found — the ` +
      "declaration pattern stopped matching, so this guard is reading nothing.",
  );
  process.exit(1);
}

/*
 * Names that are NOT the app's, however they look.
 *
 * `XCTestCase` and friends come from XCTest, and Foundation's own types appear
 * in any file. Matching those would fail every test file in the repository,
 * which is the crying-wolf version of this check.
 */
const NOT_OURS = new Set([
  "XCTestCase", "XCTest", "XCTAssert", "Date", "Data", "URL", "UUID", "Calendar",
  "TimeZone", "String", "Int", "Double", "Bool", "Error", "Task", "Set", "Array",
  "Dictionary", "Result", "Locale", "Decimal", "Range", "Optional",
]);

/**
 * Capitalised identifiers that are CODE, with string literals removed first.
 *
 * The first draft counted quotes in the preceding 200 characters to guess
 * whether a match sat inside a literal, and every one of its three findings was
 * false: source-scan tests name app types constantly, but inside the needles
 * they search for (`"private struct CancelCard: View {"`) and inside failure
 * messages. A window-based guess cannot tell those from a real reference.
 *
 * So the state is TRACKED, per line, character by character. Swift escapes with
 * a backslash, and a line comment after code is dropped once we know we are not
 * inside a literal — which is the same reason the whole-line filter above is not
 * enough on its own.
 */
function identifiersOutsideStrings(text) {
  const found = [];
  for (const line of text.split("\n")) {
    let code = "";
    let inString = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (inString) {
        if (char === "\\") i += 1;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === "/" && line[i + 1] === "/") break; // trailing comment
      code += char;
    }
    for (const match of code.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)) {
      found.push(match[1]);
    }
  }
  return found;
}

const findings = [];
let inspected = 0;

for (const file of walk(TESTS)) {
  const source = readFileSync(file, "utf8");
  if (/@testable\s+import\s+Loonext/.test(source)) continue;
  inspected += 1;

  // Comments dropped: a docblock naming a type is not a reference to it. The
  // locale-forwarding guard learned this by flagging its own explanation.
  const code = source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*");
    })
    .join("\n");

  const used = new Set();
  for (const name of identifiersOutsideStrings(code)) {
    if (NOT_OURS.has(name) || !appTypes.has(name)) continue;
    used.add(name);
  }

  if (used.size > 0) {
    findings.push(
      `${file.replace(/\\/g, "/")} names ${[...used].slice(0, 4).join(", ")}` +
        `${used.size > 4 ? ` and ${used.size - 4} more` : ""} but does not ` +
        "`@testable import Loonext`",
    );
  }
}

if (findings.length > 0) {
  console.error("\nA Swift test names an app type it has not imported:\n");
  for (const finding of findings) console.error(`  ${finding}`);
  console.error(
    "\nEither add the import, or — if the file is a source scan whose " +
      "independence from the module is the point — assert on the text instead.\n",
  );
  process.exit(1);
}

console.log(
  `Swift test imports: ${inspected} test file(s) without the app import name ` +
    `none of its ${appTypes.size} types.`,
);
