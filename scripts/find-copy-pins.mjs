/**
 * Every pin on a shared module's COPY, before converting it.
 *
 * Three misses this session came from converting a module and only then
 * discovering which phone test compared one of its sentences to something.
 * This asks the question first:
 *
 *   node pins.mjs <module>        # e.g. thread-summary
 *
 * Reports, for the module's own literal sentences:
 *   - tests that read packages/shared/src/<module>.ts by path
 *   - tests (any tree) containing one of its sentences verbatim
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const R = "D:/projects/JobText";
const module = process.argv[2];
if (!module) {
  console.log("usage: node pins.mjs <module-basename>");
  process.exit(1);
}

const source = readFileSync(join(R, "packages/shared/src", `${module}.ts`), "utf8");

/* Sentences worth pinning: long enough that a test would quote them. */
const sentences = [
  ...new Set(
    [...source.matchAll(/"((?:[^"\\]|\\.){12,})"/g)]
      .map((m) => m[1])
      .filter((s) => /[a-z] [a-z]/.test(s) && !s.includes("{") && !/^[a-z]+\./.test(s)),
  ),
];

const TREES = [
  "apps/android/app/src/test",
  "apps/ios/LoonextTests",
  "apps/web/src",
  "apps/api/src",
  "packages/shared/src",
];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      walk(full, out);
    } else if (/\.(kt|swift|ts|tsx)$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = TREES.flatMap((t) => walk(join(R, t)));
const byPath = [];
const bySentence = new Map();

for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const rel = file.replaceAll("\\", "/").replace(`${R}/`, "");
  if (rel === `packages/shared/src/${module}.ts`) continue;

  if (text.includes(`packages/shared/src/${module}.ts`)) byPath.push(rel);

  for (const s of sentences) {
    if (!text.includes(s)) continue;
    if (!bySentence.has(s)) bySentence.set(s, []);
    bySentence.get(s).push(rel);
  }
}

console.log(`--- ${module}.ts: ${sentences.length} sentence(s) worth pinning\n`);
console.log("READS THE FILE BY PATH:");
console.log(byPath.length ? byPath.map((p) => `  ${p}`).join("\n") : "  (none)");
console.log("\nQUOTES A SENTENCE:");
if (bySentence.size === 0) console.log("  (none)");
for (const [s, where] of bySentence) {
  console.log(`  "${s.slice(0, 60)}${s.length > 60 ? "…" : ""}"`);
  for (const w of where) console.log(`      ${w}`);
}
