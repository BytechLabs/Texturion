#!/usr/bin/env node
/**
 * [#556] The two phones cap a reading measure at the same width, in one place
 * each.
 *
 * ## What this found
 *
 * Android decides window width ONCE: `Shell.kt` wraps every tab's content in
 * `contentMaxWidth()`, so a new tab inherits the cap by construction. iOS
 * decided it PER SCREEN, by hand — the pair
 * `.frame(maxWidth: 640).frame(maxWidth: .infinity)` written out seven times
 * across five files, each with its own copy of the #180 comment.
 *
 * `ForYouTab` was the one that had never had it, and nothing could have said
 * so. A rule repeated by hand is one a new screen can silently omit, and the
 * omission is invisible until somebody opens the app on an iPad.
 *
 * ## The two things it checks
 *
 * 1. THE NUMBER AGREES. A cap of 640 on one phone and 600 on the other is two
 *    products disagreeing about how wide a sentence may be — and the drift
 *    would happen in a file nobody reads next to the one being changed.
 *
 * 2. NOBODY RETYPES THE RULE. A hand-written `frame(maxWidth: <the cap>)` in
 *    iOS feature code is refused, with the modifier named. Not a style
 *    preference: the second `.frame(maxWidth: .infinity)` is what CENTRES the
 *    capped content, and half the idiom typed from memory is content pinned to
 *    the leading edge on an iPad — which looks like a bug and reads like a
 *    decision.
 *
 * Other widths are none of its business. `AuthScreens` caps a form at 440 and a
 * Composer control at 160, and both are deliberate; only the shared reading
 * measure belongs to one definition.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ANDROID_WINDOW =
  "apps/android/app/src/main/kotlin/com/loonext/android/ui/common/WindowSize.kt";
const IOS_MEASURES = "apps/ios/Loonext/Theme/Measures.swift";
const IOS_FEATURES = "apps/ios/Loonext/Features";

const problems = [];

/** `val DefaultContentMaxWidth: Dp = 640.dp` → 640 */
function androidCap() {
  const source = readFileSync(ANDROID_WINDOW, "utf8");
  const match = /DefaultContentMaxWidth:\s*Dp\s*=\s*([\d.]+)\.dp/.exec(source);
  return match ? Number(match[1]) : null;
}

/** `static let max: CGFloat = 640` inside `enum ContentWidth` → 640 */
function iosCap() {
  const source = readFileSync(IOS_MEASURES, "utf8");
  const block = /enum ContentWidth \{([\s\S]*?)\n\}/.exec(source);
  if (!block) return null;
  const match = /static let max:\s*CGFloat\s*=\s*([\d.]+)/.exec(block[1]);
  return match ? Number(match[1]) : null;
}

const android = androidCap();
const ios = iosCap();

if (android === null || ios === null) {
  problems.push(
    `cannot read the content cap from ${android === null ? ANDROID_WINDOW : IOS_MEASURES}` +
      ` — this guard has lost its subject and is no longer checking anything.`,
  );
} else if (android !== ios) {
  problems.push(
    `Android caps content at ${android}dp and iOS at ${ios}pt. One reading ` +
      `measure, two numbers: the same sentence wraps differently on the two ` +
      `phones and nobody would think to look in the other file.`,
  );
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (statSync(full).isFile() && full.endsWith(".swift")) out.push(full);
  }
  return out;
}

if (ios !== null) {
  const retyped = new RegExp(`\\.frame\\(maxWidth:\\s*${ios}\\)`);
  for (const path of walk(IOS_FEATURES)) {
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .forEach((line, index) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (retyped.test(line)) {
          problems.push(
            `${path}:${index + 1} — the shared reading measure, retyped. Use ` +
              `\`.contentMaxWidth()\`: the second \`.frame(maxWidth: .infinity)\` ` +
              `is what centres it, and half the idiom typed from memory pins ` +
              `content to the leading edge on an iPad.`,
          );
        }
      });
  }
}

if (problems.length > 0) {
  console.error("Content width must be one rule on both phones (#556):\n");
  for (const problem of problems) console.error(`  - ${problem}\n`);
  process.exit(1);
}

console.log(
  `Content width: both phones cap at ${android}, and no iOS surface retypes it.`,
);
