#!/usr/bin/env node
/**
 * [#323] An open issue must not ask for something a decision already refused.
 *
 *   node scripts/check-do-not-build.mjs
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * #229 was filed to build a feature D32 had deliberately deleted. The decision
 * was recorded, the migrations that dropped the schema were named, and the gap
 * analysis marked the section "[WITHDRAWN — do not build]". None of it was
 * visible to whoever filed the issue.
 *
 * #323 names the cause: "this codebase is worked on by many short-lived
 * contexts that cannot hold its history. The decision docs are the only durable
 * memory." A refusal recorded in prose is a refusal nobody finds in time.
 *
 * ---------------------------------------------------------------------------
 * THE TABLE IS THE DATA. THIS IS ONLY THE READER.
 *
 * Every phrase comes from the "Do not build" table in `docs/DECISIONS.md`.
 * Nothing is hardcoded here, deliberately — a list in a script is a second
 * place to keep in sync, which is the failure #323 is about.
 *
 * ---------------------------------------------------------------------------
 * IT WARNS. IT DOES NOT BLOCK.
 *
 * A title match is a strong hint and not a verdict: an issue about *removing*
 * the last traces of a refused feature is legitimate and reads identically to
 * one proposing it. So a hit is reported for a human to judge, and only the
 * `--strict` flag makes it an error — for CI, once the table has been tuned
 * against a real backlog.
 *
 * The devil's advocate in #323 is right that documentation hygiene collapses
 * when it becomes a process. This adds no step to anything: it runs on demand
 * and its whole maintenance cost is one table row per refusal.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";

const DOC = "docs/DECISIONS.md";

/** The table's own heading, so a rename fails loudly rather than silently. */
const HEADING = "## Do not build";

/**
 * Parse the phrases out of the table.
 *
 * Each row's first cell is a comma-separated list of the things refused. They
 * are matched as substrings against an issue title, lowercased — deliberately
 * crude, because the goal is to surface a candidate for a human, not to
 * classify.
 */
export function parseRefusals(markdown) {
  const start = markdown.indexOf(HEADING);
  if (start === -1) {
    throw new Error(
      `${DOC} has no "${HEADING}" section. If it moved, this check is blind — ` +
        `point it at the new heading rather than deleting it.`,
    );
  }
  // Stop at the horizontal rule that ends the section, so a later decision's
  // prose cannot be read as table rows.
  const end = markdown.indexOf("\n---", start);
  const section = markdown.slice(start, end === -1 ? undefined : end);

  const refusals = [];
  for (const line of section.split("\n")) {
    if (!line.startsWith("| ")) continue;
    const cells = line.split("|").map((c) => c.trim());
    // cells[0] is the empty string before the leading pipe.
    const [, what, decidedBy] = cells;
    if (!what || what === "Do not build" || what.startsWith("---")) continue;
    // Split on commas AND colons: a cell reads "Mass texting: broadcasts,
    // blasts, campaigns", and the label before the colon is itself a phrase
    // worth matching. Without this the first item carries the label as a
    // prefix and matches nothing.
    for (const phrase of what.split(/[,:]/)) {
      const cleaned = phrase.replace(/[`"]/g, "").trim().toLowerCase();
      // One- and two-word fragments would match everything.
      if (cleaned.length < 4) continue;
      refusals.push({ phrase: cleaned, decidedBy });
      // The singular too. An issue is titled "send a broadcast", the table
      // says "broadcasts", and a guard that misses that is a guard that
      // misses the case it was written for.
      if (cleaned.endsWith("s") && !cleaned.endsWith("ss")) {
        refusals.push({ phrase: cleaned.slice(0, -1), decidedBy });
      }
    }
  }
  if (refusals.length === 0) {
    throw new Error(
      `${DOC}'s "${HEADING}" table parsed to zero refusals. A guard that ` +
        `matches nothing reports success forever.`,
    );
  }
  return refusals;
}

function openIssues() {
  const raw = execFileSync(
    "gh",
    ["issue", "list", "--state", "open", "--limit", "300", "--json", "number,title"],
    { encoding: "utf8" },
  );
  return JSON.parse(raw);
}

function main() {
  const strict = process.argv.includes("--strict");
  const refusals = parseRefusals(readFileSync(DOC, "utf8"));

  let issues;
  try {
    issues = openIssues();
  } catch {
    // A guard that cannot reach GitHub knows nothing, and passing would say
    // otherwise. Same posture as check-open-lists.mjs.
    console.log(
      "Skipped: could not list issues (is `gh` authenticated?). " +
        "0 issue(s) checked — this is not a pass.",
    );
    return;
  }

  const hits = [];
  for (const issue of issues) {
    const title = issue.title.toLowerCase();
    for (const { phrase, decidedBy } of refusals) {
      if (title.includes(phrase)) {
        hits.push({ issue, phrase, decidedBy });
        break;
      }
    }
  }

  if (hits.length === 0) {
    console.log(
      `Do not build: ${issues.length} open issue(s) checked against ` +
        `${refusals.length} recorded refusal(s); none matched.`,
    );
    return;
  }

  console.log(
    `\nDo not build: ${hits.length} open issue(s) touch something a decision refused.\n` +
      `These are HINTS, not verdicts — an issue about removing the last traces of a\n` +
      `refused feature reads identically to one proposing it.\n`,
  );
  for (const { issue, phrase, decidedBy } of hits) {
    console.log(`  #${issue.number} ${issue.title}`);
    console.log(`     matched "${phrase}" — refused by ${decidedBy}\n`);
  }
  if (strict) process.exit(1);
}

// Only when RUN, never when imported. `parseRefusals` is unit-tested, and a
// test that imports this file must not shell out to `gh` to do it.
if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) main();
