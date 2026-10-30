#!/usr/bin/env node
/**
 * No real-looking phone number in the rig's tooling, the test harness or the
 * operator docs.
 *
 *   node scripts/check-rig-no-e164.mjs
 *
 * WHY. The repository is public, and the rig works on real numbers: its own
 * lines, robot traces renumbered into fixtures, repro recipes written while a
 * customer's problem is open. A number pasted into any of those
 * is published, and a seed or fixture holding one is a number some later run
 * may text. The only numbers allowed here are the NANP fictional range,
 * 555-0100 to 555-0199, which no carrier assigns in any area code. The rig
 * names its numbers by role (ROBOT-1, DEV-W1) and generates the real list at
 * run time.
 *
 * WHAT IT READS. E.164 (`+14165550123`, and `%2B14165550123` as a query string,
 * form body or URL path carries it) and the written NANP forms (`(416) 555-0123`,
 * `416-555-0123`, `416.555.0123`). A `+1` literal shorter than a full number
 * is a prefix a fixture builds numbers from, and passes only if every digit it
 * has agrees with the fictional range. Bare ten-digit runs are not read: here
 * they are mostly timestamps and ids.
 *
 * LEGACY. A few files predate the rule. They are counted, never quoted, because
 * quoting a real-looking number in this file would publish it again. A count
 * may only fall, and a count that has fallen must be lowered here, so the list
 * cannot go stale while looking current.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Rig and test tooling, the configs and workflows rig values are written
 * into, and the docs operators paste from.
 */
export const SCOPE = [
  /^docs\/RIG\.md$/,
  /^docs\/rig\//,
  /^docs\/deploy\//,
  /^tools\//,
  /^scripts\/rig\//,
  /^scripts\/ops\//,
  /^scripts\/load\//,
  /^scripts\/(?:dev|ci)-[^/]+$/,
  // Its input is a real trace, so its doc comment and its test's sample
  // traces are where a real number would be pasted.
  /^scripts\/trace-to-fixture\.mjs$/,
  /^apps\/api\/src\/calls\/trace-to-fixture\.test\.ts$/,
  /^\.github\//,
  /^apps\/api\/e2e\//,
  /^apps\/api\/src\/test\//,
  /^apps\/api\/src\/telnyx\/test-support\.ts$/,
  /^apps\/(?:api|web)\/wrangler[^/]*\.jsonc$/,
  /^apps\/api\/\.dev\.vars[^/]*\.example$/,
  /^apps\/web\/\.env[^/]*\.example$/,
  /^supabase\/seed[^/]*\.sql$/,
  /^supabase\/config\.toml$/,
];

/** Files that held non-fictional numbers before this check existed. */
export const LEGACY = {
  "apps/api/e2e/golden-ca.e2e.ts": 1,
  "apps/api/e2e/golden-us.e2e.ts": 2,
  "apps/api/e2e/smoke.e2e.ts": 1,
  "apps/api/e2e/webhook-burst.load.ts": 2,
  "apps/api/src/test/messaging-support.ts": 1,
  "scripts/dev-seed.mjs": 18,
  "scripts/ops/query-load.mjs": 1,
};

const BINARY = /\.(?:png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|otf|mp3|wav|ogg|m4a|mp4|keystore|jks|apk|aab)$/i;

// No letter, digit or `+` may touch either end, which keeps base64 and longer
// digit runs out. Anything else may, `/` included: a URL path is where a curl
// in a runbook or an e2e request writes a number. A `%3D` or `\n` escape just
// before one is the text an encoder or a string wrote, not a letter.
const E164 = /(?:\+|%2[Bb])([1-9]\d{7,14})(?![0-9A-Za-z])/g;
const TOUCHING = /[A-Za-z0-9+]$/;
const ESCAPE = /(?:%[0-9A-Fa-f]{2}|\\[nrt])$/;
const WRITTEN = /(?<![\d+])\(?([2-9]\d{2})(?:\)\s?|[-. ])([2-9]\d{2})[-. ](\d{4})(?![\d])/g;

/** True when ten NANP digits, or a prefix of them, sit in 555-0100..0199. */
export function isFictionalNanp(national) {
  if (national.length > 10) return false;
  const pattern = "...55501..";
  return [...national].every((digit, i) => pattern[i] === "." || pattern[i] === digit);
}

/** Every phone-number literal in a text, with whether it is fictional. */
export function findNumbers(text) {
  const lineAt = (index) => text.slice(0, index).split("\n").length;
  const found = [];
  for (const match of text.matchAll(E164)) {
    const before = text.slice(Math.max(0, match.index - 3), match.index);
    if (TOUCHING.test(before) && !ESCAPE.test(before)) continue;
    const digits = match[1];
    const fictional = digits.startsWith("1") && isFictionalNanp(digits.slice(1));
    found.push({ line: lineAt(match.index), fictional });
  }
  for (const match of text.matchAll(WRITTEN)) {
    const fictional = isFictionalNanp(match[1] + match[2] + match[3]);
    found.push({ line: lineAt(match.index), fictional });
  }
  return found.sort((a, b) => a.line - b.line);
}

/** Per-file offending lines, and what the legacy counts say about them. */
export function judge(files, legacy = LEGACY) {
  const failures = [];
  const seen = new Set();
  let literals = 0;
  for (const { file, text } of files) {
    const numbers = findNumbers(text);
    literals += numbers.length;
    const bad = numbers.filter((n) => !n.fictional);
    const allowed = legacy[file] ?? 0;
    seen.add(file);
    if (bad.length > allowed) {
      const lines = [...new Set(bad.map((n) => n.line))].join(", ");
      failures.push(
        `${file} (line ${lines}): ${bad.length} phone number(s) outside 555-0100..0199` +
          (allowed ? `, ${allowed} allowed as legacy` : "") +
          `. Use the fictional range; the rig names real numbers by role`,
      );
    } else if (bad.length < allowed) {
      failures.push(
        `${file}: legacy count is ${allowed} but ${bad.length} remain. Lower LEGACY ` +
          `in scripts/check-rig-no-e164.mjs to ${bad.length}` +
          (bad.length === 0 ? " (delete the entry)" : ""),
      );
    }
  }
  for (const file of Object.keys(legacy)) {
    if (!seen.has(file)) {
      failures.push(`${file} is in LEGACY but is gone or out of scope; delete the entry`);
    }
  }
  return { failures, literals };
}

/** Tracked and new files, never gitignored ones: derived rig configs hold real numbers by design. */
function scopedFiles() {
  const listed = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\n")
    .filter(Boolean);
  return [...new Set(listed)]
    .filter((file) => SCOPE.some((pattern) => pattern.test(file)) && !BINARY.test(file))
    .filter((file) => existsSync(join(REPO_ROOT, file)))
    .sort()
    .map((file) => ({ file, text: readFileSync(join(REPO_ROOT, file), "utf8") }));
}

/** A reader that has gone blind passes everything, so reading nothing fails. */
export function coverage(files) {
  return files.length > 0
    ? []
    : ["No files in scope. This check is reading nothing; fix SCOPE before trusting a pass"];
}

function main() {
  const files = scopedFiles();
  const { failures, literals } = judge(files);
  failures.push(...coverage(files));
  if (failures.length > 0) {
    for (const failure of failures) console.error(`  x ${failure}`);
    console.error(`\ncheck-rig-no-e164: ${failures.length} problem(s).`);
    process.exit(1);
  }
  const legacy = Object.values(LEGACY).reduce((sum, n) => sum + n, 0);
  console.log(
    `check-rig-no-e164: ${files.length} files, ${literals} phone literals, ` +
      `all fictional except ${legacy} legacy in ${Object.keys(LEGACY).length} files.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
