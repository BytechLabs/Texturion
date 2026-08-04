#!/usr/bin/env node
/**
 * #238 - text on the phones scales with the reader's setting.
 *
 * `docs/ACCESSIBILITY.md` used to state, from a scan somebody ran by hand, that
 * iOS "partly" scaled: 225 semantic styles did, and 134 fixed-point
 * `.system(size:)` call sites were unconfirmed. Both halves were wrong, and
 * wrong in the direction that flatters us. `Font.custom(_:size:)` does not
 * scale either, and the brand kit is built on it, so the real exposure was 723
 * call sites rather than 134. The string `relativeTo:` did not appear anywhere
 * in the iOS app.
 *
 * That is the shape this whole issue is about: a claim made to buyers, derived
 * from a specification and a one-off scan, with nothing that fails when it
 * stops being true. A hand scan is a photograph, and it goes stale on the next
 * commit.
 *
 * WHAT FAILS THE BUILD:
 *
 *   iOS      A font built at a literal point size with no scaling behind it.
 *            Both APIs that take a raw size are non-scaling, so both are
 *            refused outside the one file that implements the scaling.
 *   Android  A text size expressed in `dp`. `sp` carries the reader's font
 *            scale and `dp` does not, and the two are one character apart.
 *
 * DELIBERATELY NOT CHECKED: whether the result is legible, whether layouts
 * survive 200%, or whether a screen reader can drive the flow. Those need a
 * device and a person, and are recorded as unverified in the statement rather
 * than approximated here. This checks the mechanism, which is the part that
 * regresses silently.
 *
 * Usage:  node scripts/check-native-a11y.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const IOS_ROOT = join("apps", "ios");
const ANDROID_ROOT = join("apps", "android");

/**
 * The one file allowed to name a raw point size: it is what turns a raw size
 * into a scaling one. An allowance rather than a suppression comment, so
 * widening it is a visible edit to this file.
 */
const IOS_SCALING_IMPL = join("apps", "ios", "Loonext", "Theme", "DesignSystem.swift");

function sourceFiles(dir, extension, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "build" || entry === ".build" || entry === "DerivedData") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, extension, out);
    else if (entry.endsWith(extension)) out.push(full);
  }
  return out;
}

/**
 * Comment lines are prose, not code.
 *
 * Without this, documenting why a call site moved off `.system(size:)` fails
 * the guard that asked for the move, which leaves an author choosing between
 * explaining the change and passing the check. Only whole-line comments are
 * stripped, so a real declaration is still caught however it is annotated.
 */
function isComment(line, marker) {
  return new RegExp(`^\\s*(${marker}|\\*)`).test(line);
}

const failures = [];

/* -------------------------------------------------------------------------- */
/* iOS: no font at a literal size without a text style behind it.             */
/* -------------------------------------------------------------------------- */

// `.system(size:)` never scales. `.custom(_:size:)` never scales either, and
// only its `relativeTo:` overload does, so the bare form is the offence and the
// three-argument form is the fix.
const IOS_RAW_SYSTEM = /\.system\(size:/;
const IOS_CUSTOM = /\.custom\([^)]*\bsize:/;

for (const file of sourceFiles(IOS_ROOT, ".swift")) {
  if (file === IOS_SCALING_IMPL) continue;
  readFileSync(file, "utf8")
    .split(/\r?\n/)
    .forEach((line, index) => {
      if (isComment(line, "//")) return;
      const where = `${file}:${index + 1}`;
      if (IOS_RAW_SYSTEM.test(line)) {
        failures.push(`${where}  .system(size:) does not scale - use Font.scaled(_:weight:design:)`);
      }
      if (IOS_CUSTOM.test(line) && !line.includes("relativeTo:")) {
        failures.push(
          `${where}  .custom(_:size:) without relativeTo: does not scale - use Font.golos/.display`,
        );
      }
    });
}

/* -------------------------------------------------------------------------- */
/* Android: text sizes are sp, never dp.                                      */
/* -------------------------------------------------------------------------- */

// `fontSize = 14.dp` compiles (both are Dp/TextUnit-adjacent enough to slip
// past review) and pins the text at one size for everybody. `lineHeight` is
// included because a scaled font inside an unscaled line box clips.
const ANDROID_DP_TEXT = /\b(fontSize|lineHeight|letterSpacing)\s*=\s*[^,)\n]*\b\d+(?:\.\d+)?\.dp\b/;

for (const file of sourceFiles(ANDROID_ROOT, ".kt")) {
  readFileSync(file, "utf8")
    .split(/\r?\n/)
    .forEach((line, index) => {
      if (isComment(line, "//")) return;
      if (ANDROID_DP_TEXT.test(line)) {
        failures.push(`${file}:${index + 1}  text size in dp does not scale - use sp`);
      }
    });
}

/* -------------------------------------------------------------------------- */

if (failures.length) {
  console.error(`\ncheck-native-a11y: ${failures.length} non-scaling text size(s)\n`);
  for (const failure of failures) console.error(`  ${failure}`);
  console.error(
    "\nText that ignores the OS font setting is unreadable for the reader who " +
      "changed it, and there is no in-app override to fall back on.\n",
  );
  process.exit(1);
}

console.log("check-native-a11y: all native text sizes scale with the OS setting.");
