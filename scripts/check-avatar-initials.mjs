#!/usr/bin/env node
/**
 * The two letters in an avatar are computed in exactly three places.
 *
 * ## The defect this exists for
 *
 * #582: they were computed FIVE times and the five did not agree.
 *
 *   - "Ana Maria Rojas" was `AM` on the inbox row and `AR` on the assignee chip
 *     BESIDE IT, so one contact was two people at a glance;
 *   - an unnamed contact displays as its formatted number, so the badge was handed
 *     `(415) 555-0134` and three of the five wore `(5` — including both phones, on
 *     the busiest list in the app;
 *   - only one of the five walked code points, so an emoji or a composed accent came
 *     back as half a character from the other four.
 *
 * One of them had already been fixed once. Its own test says the `(5` case "used to
 * produce `(5`" — the fix landed in one copy and the other four kept doing it.
 *
 * ## What this checks, and what it cannot
 *
 * The rule lives in `packages/shared/src/avatar-initials.ts`. Kotlin and Swift cannot
 * import TypeScript, so each hand-ports it once, and the #376 parity vectors hold
 * those two to the original. Three implementations is the accepted shape here; a
 * FOURTH is the thing that went wrong.
 *
 * So this counts declarations. A new function that computes initials is caught when
 * it is named like one — which is how all five of the originals were written, because
 * there is not much else to call it.
 *
 * It does NOT catch somebody inlining `name.split(" ")[0][0]` at a render site without
 * naming it. That shape is too close to ordinary string handling to match on without
 * a stream of false positives, and a guard people switch off protects nothing. What
 * catches that one is the parity vectors disagreeing, or review.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Where the rule is allowed to exist, and the one declaration each may hold.
 *
 * Named rather than derived: there are three, each in a different language, and the
 * point of the list is that adding a fourth entry is a decision somebody has to make
 * out loud.
 */
const SANCTIONED = [
  {
    file: "packages/shared/src/avatar-initials.ts",
    declaration: /export function avatarInitials\(/g,
    why: "the rule itself; web imports this and never reimplements it",
  },
  {
    file: "apps/android/app/src/main/kotlin/com/loonext/android/ui/common/Ui.kt",
    declaration: /fun initialsOf\(/g,
    why: "the Kotlin hand-port, held to the TypeScript by the #376 parity vectors",
  },
  {
    file: "apps/ios/Loonext/Support/Format.swift",
    declaration: /func initialsOf\(/g,
    why: "the Swift hand-port, held to the TypeScript by the #376 parity vectors",
  },
];

/** Client trees to sweep for an unsanctioned declaration. */
const TREES = [
  { root: "apps/web/src", pattern: /(?:function|const)\s+(avatarInitials|initials)\b/g },
  { root: "apps/android/app/src/main", pattern: /fun\s+(initialsOf|avatarInitials)\b/g },
  { root: "apps/ios/Loonext", pattern: /func\s+(initialsOf|avatarInitials)\b/g },
  { root: "packages/shared/src", pattern: /export function\s+(avatarInitials)\b/g },
];

const SOURCE = /\.(ts|tsx|kt|swift)$/;

function sources(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry).replaceAll("\\", "/");
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (SOURCE.test(full)) out.push(full);
  }
  return out;
}

/** Comments are prose. Explaining the rule must not count as declaring it. */
function stripComments(source) {
  return source
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*(\/\/|\*|\/\/\/).*$/gm, "");
}

const problems = [];
const allowed = new Set(SANCTIONED.map((entry) => entry.file));

// 1. Each sanctioned home still holds exactly one. Checking the callers while
//    exempting the implementation exempts the thing being guarded.
for (const { file, declaration, why } of SANCTIONED) {
  let body;
  try {
    body = stripComments(readFileSync(file, "utf8"));
  } catch {
    problems.push(
      `cannot read ${file} — ${why}. If it moved, update this list; if it is gone, ` +
        `that client has lost the shared rule and is computing initials somewhere else.`,
    );
    continue;
  }
  const found = [...body.matchAll(declaration)].length;
  if (found !== 1) {
    problems.push(
      `${file} declares the rule ${found} time(s), expected exactly 1 — ${why}.`,
    );
  }
}

// 2. Nowhere else declares one.
let scanned = 0;
for (const { root, pattern } of TREES) {
  for (const file of sources(root)) {
    if (allowed.has(file)) continue;
    // A test may name the function it is testing.
    if (/\.test\.(ts|tsx|kt|swift)$|Tests?\.(kt|swift)$/.test(file)) continue;
    scanned += 1;
    const body = stripComments(readFileSync(file, "utf8"));
    for (const match of body.matchAll(new RegExp(pattern.source, "g"))) {
      problems.push(
        `${file} declares its own \`${match[1]}\`. There is one rule for this, in ` +
          `packages/shared/src/avatar-initials.ts — web imports it, and the two ` +
          `phones each hand-port it once. A fifth copy is what #582 was: the same ` +
          `contact wearing different letters on two panes of one screen.`,
      );
    }
  }
}

if (scanned === 0) {
  problems.push(
    `scanned no client sources at all — the tree layout has changed and this guard ` +
      `is checking nothing, so a pass here means nothing.`,
  );
}

if (problems.length > 0) {
  console.error("Avatar initials must be computed in one place per client:\n");
  for (const problem of problems) console.error(`  - ${problem}\n`);
  process.exit(1);
}

console.log(
  `Avatar initials: 1 rule + 2 hand-ports, and no other declaration across ` +
    `${scanned} client source(s).`,
);
