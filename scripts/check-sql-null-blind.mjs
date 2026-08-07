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
 * from` answers true, and the mutation dies.
 *
 * IT IS NOT ONE TEST'S BUG. The shape is everywhere a suite does
 * `select … into v` and then judges `v`: a query that matched NO ROW leaves
 * `v` NULL, which is precisely the state most defects produce — a row that was
 * not written, a column that was not filled, a trigger that did not fire.
 *
 * ---------------------------------------------------------------------------
 * #528 — WHY THIS IS INVERTED NOW.
 *
 * The first version refused `<>` inside an `if`/`elsif` condition "at paren
 * depth zero" and allowed everything else. It caught the one line it was
 * extracted from, and **five equivalent spellings of the identical defect
 * walked straight past it** — measured by running them, not guessed:
 *
 *   if (r.phone <> '+1') then …        THE SAME LINE, IN BRACKETS. The docblock
 *                                      said "depth zero" meaning the top level
 *                                      of the CONDITION; the code counted depth
 *                                      from the start of the LINE, so the `if (`
 *                                      of a wrapped condition put the operator
 *                                      at depth 1 — where its own rule said to
 *                                      allow it. Bracketing a condition, the
 *                                      most ordinary thing a person might do,
 *                                      turned the guard off.
 *   if r.phone != '+1' then …          `!=` is not a near-equivalent of `<>` in
 *                                      Postgres; it is the same operator with
 *                                      the same three-valued semantics. The
 *                                      scanner only looked for `<` then `>`.
 *   if not (r.phone = '+1') then …     `NOT (NULL = '+1')` is NULL, so the `if`
 *                                      takes the false branch. Different
 *                                      spelling, identical failure.
 *   v := case when r.phone <> '+1' …   a CASE judging a result is not an
 *                                      `if`/`elsif`.
 *   perform 1; if r.phone <> '+1' …    the `^\s*if` anchor missed any `if` that
 *                                      was not the first token on its line.
 *
 * So it stopped enumerating what is FORBIDDEN and states what is PERMITTED
 * instead: **inside an assertion condition the only NULL-safe inequality is
 * `is distinct from`, so it is the only one allowed.**
 *
 * That is not the vocabulary mistake this repository has deleted twice. A word
 * list of suspicious names is open-ended and a sixth entry always arrives; the
 * ways to spell inequality in Postgres are a CLOSED set of three — `<>`, `!=`,
 * and a negated `=` — so refusing all three enumerates the language rather than
 * guessing at intent.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS STILL ALLOWED, and it is why this is not a plain grep.
 *
 * `<>` that CHOOSES ROWS is fine and must stay fine — in a `where` inside a
 * subquery it decides which rows the assertion looks at, and `is distinct from`
 * there would change the question rather than how the answer is judged:
 *
 *     if exists (select 1 from t where origin <> 'reminder') then …
 *
 * So an operator is exempt when some paren enclosing it is a SUBQUERY (a
 * `select` appeared inside that paren before it). Note what that does NOT
 * exempt: a paren wrapped round the condition itself contains no `select`, so
 * `if (a <> b) then` is still refused. That one distinction is the whole of the
 * depth bug above.
 *
 * Comments and string literals are stripped first. The suites discuss `<>` in
 * prose — this very defect is described in two of them — and a guard that flags
 * its own explanation is one somebody switches off.
 *
 * Runs over `supabase/tests/*.sql` only. A migration is product code, where
 * three-valued logic is often exactly what is wanted.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(REPO_ROOT, "supabase/tests");

/**
 * Blank out comments and string bodies, keeping every other byte so an offset
 * still points at its real line. Spaces rather than deletion for exactly that
 * reason: a finding nobody can locate is a finding nobody fixes.
 */
export function stripNoise(sql) {
  let out = "";
  let i = 0;
  let inString = false;
  while (i < sql.length) {
    if (!inString && sql.startsWith("--", i)) {
      while (i < sql.length && sql[i] !== "\n") {
        out += " ";
        i += 1;
      }
      continue;
    }
    if (!inString && sql.startsWith("/*", i)) {
      while (i < sql.length && !sql.startsWith("*/", i)) {
        out += sql[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      out += "  ";
      i += 2;
      continue;
    }
    if (sql[i] === "'") {
      inString = !inString;
      out += "'";
      i += 1;
      continue;
    }
    // A literal can hold `--`, `<>` and `then`; none of it is code.
    out += inString && sql[i] !== "\n" ? " " : sql[i];
    i += 1;
  }
  return blankFunctionBodies(out);
}

/**
 * Blank the body of any `create function … as $$ … $$`, keeping `do $$ … $$`.
 *
 * A suite recreates production functions — `paid_pause.test.sql` defines
 * `company_send_block` so the definition "outlives the test" — and that body is
 * PRODUCT CODE that happens to live in a test file. This guard's rule is about
 * how an assertion JUDGES a value; a function deciding what to return is the
 * case the header already exempts migrations for, and three-valued logic there
 * is frequently the intent.
 *
 * Told apart by the keyword before the dollar-quote rather than by filename:
 * `do $$` is an assertion block, `as $$` after `function` is a definition. Two
 * genuine false positives came from missing this, and a guard that cannot tell
 * an assertion from the code under test is one that gets switched off.
 */
function blankFunctionBodies(sql) {
  let out = sql;
  const tag = /\$([A-Za-z_]*)\$/g;
  let match;
  while ((match = tag.exec(out)) !== null) {
    const open = match.index;
    const delimiter = match[0];
    const close = out.indexOf(delimiter, open + delimiter.length);
    if (close === -1) break;
    // What introduced this block? The nearest of `function` / `do` behind it.
    const preamble = out.slice(Math.max(0, open - 400), open).toLowerCase();
    const isDefinition =
      preamble.lastIndexOf("function") > preamble.lastIndexOf(" do ");
    if (isDefinition) {
      const body = out.slice(open + delimiter.length, close);
      out =
        out.slice(0, open + delimiter.length) +
        body.replace(/[^\n]/g, " ") +
        out.slice(close);
    }
    tag.lastIndex = close + delimiter.length;
  }
  return out;
}

const WORD = /[A-Za-z0-9_]/;

/** Is the keyword at `at` a standalone word rather than part of an identifier? */
function standalone(code, at, length) {
  const before = code[at - 1];
  const after = code[at + length];
  return (
    (before === undefined || !WORD.test(before)) &&
    (after === undefined || !WORD.test(after))
  );
}

/** Every keyword occurrence that opens a condition, in file order. */
function conditionStarts(code) {
  const starts = [];
  for (const keyword of ["elsif", "elseif", "if", "when"]) {
    for (const match of code.matchAll(new RegExp(keyword, "gi"))) {
      if (!standalone(code, match.index, keyword.length)) continue;
      starts.push({ at: match.index + keyword.length, keyword });
    }
  }
  return starts.sort((a, b) => a.at - b.at);
}

/**
 * The condition text from a keyword to its matching `then`.
 *
 * Bounded by `then` because that is what closes a condition in PL/pgSQL. A slice
 * with no `then` before the next statement boundary was not a condition at all
 * — an `if` inside an identifier-ish context, a stray `when` in DDL — so it is
 * skipped rather than run to end of file.
 */
function conditionEnd(code, from) {
  let depth = 0;
  for (let i = from; i < code.length; i += 1) {
    if (code[i] === "(") depth += 1;
    else if (code[i] === ")") depth -= 1;
    else if (depth <= 0 && code.startsWith("then", i) && standalone(code, i, 4)) {
      return i;
    } else if (depth <= 0 && code[i] === ";") return -1;
  }
  return -1;
}

/** Every NULL-blind inequality that JUDGES a value inside one condition. */
function judgeCondition(code, from, to) {
  const found = [];
  // Per-paren-level: has a `select` been seen inside this level yet? Level 0 is
  // the condition itself, which is never a subquery.
  const isSubquery = [false];
  for (let i = from; i < to; i += 1) {
    if (code[i] === "(") {
      isSubquery.push(false);
      continue;
    }
    if (code[i] === ")") {
      if (isSubquery.length > 1) isSubquery.pop();
      continue;
    }
    if (code.startsWith("select", i) && standalone(code, i, 6)) {
      isSubquery[isSubquery.length - 1] = true;
      continue;
    }
    // Choosing rows rather than judging a value — see the header.
    if (isSubquery.some(Boolean)) continue;

    if (code.startsWith("<>", i)) {
      found.push({ at: i, operator: "<>" });
    } else if (code.startsWith("!=", i)) {
      found.push({ at: i, operator: "!=" });
    } else if (code.startsWith("not", i) && standalone(code, i, 3)) {
      // `not (a = b)` — NULL propagates through the NOT and the branch is not
      // taken. Flagged only when the negated expression is a plain comparison of
      // two values; `not exists (…)`, `not found` and `not v` are ordinary.
      let j = i + 3;
      while (j < to && /\s/.test(code[j])) j += 1;
      if (code[j] !== "(") continue;
      let depth = 0;
      let end = to;
      for (let k = j; k < to; k += 1) {
        if (code[k] === "(") depth += 1;
        else if (code[k] === ")") {
          depth -= 1;
          if (depth === 0) {
            end = k;
            break;
          }
        }
      }
      const negated = code.slice(j, end);
      /**
       * NOT EVERY NULL-BLIND `not (…)` IS THIS GUARD'S BUSINESS, and saying so
       * is the difference between a guard and a nag.
       *
       * `not (v = any(arr))` is a MEMBERSHIP test and
       * `not (select flag from t where …)` is a boolean SUBQUERY. Both are
       * genuinely NULL-blind — a NULL array or a missing row makes the whole
       * expression NULL and the branch is not taken — but neither is an
       * inequality, and `is distinct from` cannot be written for either. Their
       * NULL-safe form is `coalesce(…, false)`, which is a different rule with a
       * different message.
       *
       * Flagging them here would attach advice that does not apply to 22 lines
       * that each need something else, and a guard whose remedy does not fit is
       * one people learn to override. They are reported separately (#528) rather
       * than folded in.
       */
      if (/\bselect\b/i.test(negated) || /\bany\s*\(/i.test(negated)) continue;
      for (let k = j; k < end; k += 1) {
        if (
          code[k] === "=" &&
          !"<>!=:".includes(code[k - 1]) &&
          code[k + 1] !== "="
        ) {
          found.push({ at: i, operator: "not (… = …)" });
          break;
        }
      }
    }
  }
  return found;
}

function lineOf(code, at) {
  return code.slice(0, at).split("\n").length;
}

function textAt(code, at) {
  const start = code.lastIndexOf("\n", at) + 1;
  const end = code.indexOf("\n", at);
  return code.slice(start, end === -1 ? undefined : end).trim();
}

/** Every offence in one suite's source. Exported so the guard has its own test. */
export function nullBlindOffences(sql) {
  const code = stripNoise(sql);
  const out = [];
  for (const start of conditionStarts(code)) {
    const end = conditionEnd(code, start.at);
    if (end === -1) continue;
    for (const hit of judgeCondition(code, start.at, end)) {
      out.push({
        line: lineOf(code, hit.at),
        operator: hit.operator,
        text: textAt(code, hit.at),
      });
    }
  }
  return out;
}

// Skip the scan when imported by its own test.
if (process.argv[1] && process.argv[1].endsWith("check-sql-null-blind.mjs")) {
  const offences = [];
  const files = readdirSync(DIR).filter((file) => file.endsWith(".sql"));
  for (const name of files) {
    for (const hit of nullBlindOffences(readFileSync(join(DIR, name), "utf8"))) {
      offences.push(
        `supabase/tests/${name}:${hit.line}: ${hit.operator} — ${hit.text}`,
      );
    }
  }

  if (offences.length > 0) {
    console.error(
      `\n${offences.length} SQL assertion(s) judge a value with an inequality ` +
        "that is NULL — and therefore FALSE — when the value is NULL:\n",
    );
    for (const offence of offences) console.error(`  ${offence}`);
    console.error(
      "\nUse `is distinct from`. It is the only NULL-safe inequality in the " +
        "language, which is why it is the only one allowed here: `<>`, `!=` " +
        "and `not (a = b)` all answer NULL when either side is NULL, so the " +
        "`if` takes the false branch and the assertion waves through the very " +
        "defect it was written for (#248 CL-13, #528).\n" +
        "\nAn inequality that CHOOSES ROWS is not flagged — inside a subquery " +
        "it decides what the assertion looks at rather than how it judges the " +
        "answer.\n",
    );
    process.exit(1);
  }
  console.log(
    `check-sql-null-blind: every assertion in ${files.length} suite(s) judges ` +
      "NULL as a miss.",
  );
}
