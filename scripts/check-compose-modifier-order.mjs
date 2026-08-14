#!/usr/bin/env node
/**
 * [#540] `.size(n.dp).padding(...)` gives a glyph less room than it asked for.
 *
 * Compose applies modifiers OUTSIDE-IN. `.size(15.dp)` fixes the box, and a
 * `.padding(start = 7.dp)` after it eats that space from the INSIDE — so the
 * icon draws in 8dp and the caller reads the line as asking for 15.
 *
 * The failure is entirely visual and entirely silent: it compiles, every test
 * passes, and the picture shows an unrecognisable dot where a clock face should
 * be. It was found by rendering the response-time panel to a PNG and looking at
 * it — the first time anybody could, on a machine with no phone.
 *
 * The fix is always the same and never changes behaviour anywhere else:
 * `.padding(...).size(n.dp)`. Padding on the outside, the box on the inside.
 *
 * A class, not the instance. Two existed when this was written; the second was
 * in a settings row nobody had looked at either.
 *
 * ## What it deliberately does not catch
 *
 * `.size()` followed by padding across a line break, and chains built through a
 * variable. Both are rarer than the one-line form and matching them needs a
 * parser rather than a regex — and a guard that half-parses Kotlin is one that
 * reports things that are fine. This catches the shape people actually type.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "apps/android/app/src/main/kotlin";

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (statSync(full).isFile() && full.endsWith(".kt")) out.push(full);
  }
  return out;
}

const problems = [];
let scanned = 0;

for (const path of walk(ROOT)) {
  scanned += 1;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    // Comments are where this rule is EXPLAINED, so a line that merely quotes
    // the bad shape is not the bad shape.
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    if (/\.size\(\s*[\d.]+\.dp\s*\)\s*\.padding\(/.test(line)) {
      problems.push(
        `${path}:${index + 1} — \`.size(n.dp).padding(...)\` gives the content ` +
          `less room than the size says. Compose applies modifiers outside-in, ` +
          `so the padding is taken from INSIDE the box. Write ` +
          `\`.padding(...).size(n.dp)\`.`,
      );
    }
  });
}

if (problems.length > 0) {
  console.error("Compose modifier order (#540):\n");
  for (const problem of problems) console.error(`  - ${problem}\n`);
  process.exit(1);
}

console.log(
  `Compose modifier order: no size-then-padding chains in ${scanned} Kotlin file(s).`,
);
