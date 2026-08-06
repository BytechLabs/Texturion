#!/usr/bin/env node
/**
 * A SQL assertion must not be able to pass because its subject was NULL.
 *
 * #248 CL-13, found by mutation. The consent ledger's writer was changed to
 * stop recording the phone on the row, and the test that exists to catch that
 * PASSED — twice — because it read:
 *
 *     if r.phone_e164 <> '+12125559013' then raise exception ...
 *
 * `NULL <> '+1…'` is NULL, not true, so the `if` took the false branch and the
 * assertion waved through the exact defect it was written for. `is distinct
 * from` answers true, and the mutation dies. Re-proved both ways before this
 * guard was written: with the writer broken, the suite passes under `<>` and
 * fails under `is distinct from`.
 *
 * IT IS NOT ONE TEST'S BUG. The shape is everywhere a suite does
 * `select … into v` and then judges `v`: a query that matched NO ROW leaves
 * `v` NULL, which is precisely the state most defects produce — a row that was
 * not written, a column that was not filled, a trigger that did not fire. 1228
 * comparisons across 103 suites read this way; all of them now use `is distinct
 * from`, which can only ever make an assertion stricter.
 *
 * WHAT THIS REFUSES, and what it deliberately does not:
 *
 *   Refused: `<>` inside an `if` / `elsif` condition at paren depth zero. That
 *   is an assertion judging a result.
 *
 *   Allowed: `<>` anywhere else — a WHERE clause, a subquery inside a
 *   condition, an UPDATE. There it chooses ROWS, and `is distinct from` would
 *   change which rows the test looks at rather than how it judges them. Two
 *   such sites exist today and both are correct as they stand.
 *
 * Runs over `supabase/tests/*.sql` only. A migration is product code, where
 * three-valued logic is often exactly what is wanted.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(REPO_ROOT, "supabase/tests");

const offences = [];
for (const name of readdirSync(DIR).filter((file) => file.endsWith(".sql"))) {
  const lines = readFileSync(join(DIR, name), "utf8").split(/\r?\n/);
  let inCondition = false;
  let depth = 0;
  lines.forEach((line, index) => {
    if (!inCondition && /^\s*(if|elsif|elseif)\b/i.test(line)) {
      inCondition = true;
      depth = 0;
    }
    if (!inCondition) return;
    for (let i = 0; i < line.length; i += 1) {
      if (line[i] === "(") depth += 1;
      else if (line[i] === ")") depth -= 1;
      else if (line[i] === "<" && line[i + 1] === ">" && depth === 0) {
        offences.push(`supabase/tests/${name}:${index + 1}: ${line.trim()}`);
      }
    }
    if (/\bthen\b/i.test(line)) inCondition = false;
  });
}

if (offences.length > 0) {
  console.error(
    `\n${offences.length} SQL assertion(s) compare with \`<>\`, which is NULL — ` +
      "and therefore FALSE — when the value being judged is NULL:\n",
  );
  for (const offence of offences) console.error(`  ${offence}`);
  console.error(
    "\nUse `is distinct from`. A test whose subject came back NULL because the " +
      "row was never written must FAIL, not pass quietly (#248 CL-13).\n",
  );
  process.exit(1);
}
console.log("check-sql-null-blind: every SQL assertion judges NULL as a miss.");
