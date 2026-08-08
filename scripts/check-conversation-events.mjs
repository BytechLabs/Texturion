#!/usr/bin/env node
/**
 * [#554] The timeline's vocabulary, in SQL and in TypeScript, must be one list.
 *
 *   node scripts/check-conversation-events.mjs
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS.
 *
 * A crew finished a job, we asked the customer how it went, they replied "1",
 * and nobody was told. `job_rated` was inserted by shipped code and had never
 * been added to `conversation_event_type`, so the insert raised
 * `invalid input value for enum`, the function threw, and the caller caught it
 * into `console.error` and returned 200 to the carrier. The score was saved. The
 * timeline row was lost. And `escalatePoorRating` — the whole point of #313 —
 * sat after the throwing call inside the same `try`, so a bad rating never
 * reached the owner. In production, every time, from the day it shipped.
 *
 * `appointment_confirmed` was the same bug, waiting for somebody to save a
 * reminder rule.
 *
 * ---------------------------------------------------------------------------
 * WHY IT CHECKS BOTH DIRECTIONS.
 *
 * The obvious check is "every type the code writes exists in SQL". That alone
 * would not have prevented this, because the code did not write a TYPE — it
 * wrote a string, from an untyped object literal handed straight to PostgREST.
 * The reason it could do that is the OTHER direction: five values existed in the
 * SQL enum and were missing from `ConversationEventType`, so the union was
 * already known to be an incomplete description of the column, and a writer
 * needing one of them had no typed path to take. An incomplete type is a type
 * people route around.
 *
 * So both are failures, and each has its own consequence:
 *
 *   IN TS, NOT IN SQL   an insert that throws at runtime. This is #554.
 *   IN SQL, NOT IN TS   the next writer of that value cannot use
 *                       insertConversationEvents, so it hand-rolls the insert
 *                       and loses tsc as a guard. This is why #554 was possible.
 *
 * ---------------------------------------------------------------------------
 * WHY IT READS THE MIGRATIONS AND NOT A DATABASE.
 *
 * The migrations are what ships. A local database can be ahead of the tree (a
 * hand-applied `alter type` that was never committed is exactly the drift worth
 * failing on) and CI's is rebuilt from these files anyway. Reading the files
 * also means this guard runs with no Docker and no credentials, which is what
 * lets it sit in the cheap guard step rather than the SQL job.
 */
import { readFileSync, readdirSync } from "node:fs";

const MIGRATIONS = "supabase/migrations";
const UNION_FILE = "apps/api/src/routes/core/events.ts";
const ENUM = "conversation_event_type";

/** Every label the migrations give the enum: the CREATE plus every ADD VALUE. */
function labelsFromMigrations() {
  const labels = new Set();
  const files = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const name of files) {
    // Comments are stripped first. Several migrations discuss the enum in prose
    // above the statement that changes it, and a doc block quoting a value it
    // deliberately does NOT add would otherwise be read as adding it.
    const sql = readFileSync(`${MIGRATIONS}/${name}`, "utf8").replace(
      /--[^\n]*/g,
      "",
    );

    // `create type public.conversation_event_type as enum ('a','b', …)`.
    const created = new RegExp(
      `create\\s+type\\s+(?:public\\.)?${ENUM}\\s+as\\s+enum\\s*\\(([^)]*)\\)`,
      "gis",
    );
    for (const match of sql.matchAll(created)) {
      for (const value of match[1].matchAll(/'([a-z0-9_]+)'/gi)) {
        labels.add(value[1]);
      }
    }

    // `alter type public.conversation_event_type add value if not exists 'x';`
    // — `[\s\S]` rather than `.` because two migrations wrap the statement over
    // two lines, and a dot-matches-newline flag on the whole file would let one
    // statement's tail swallow the next one's head.
    const altered = new RegExp(
      `alter\\s+type\\s+(?:public\\.)?${ENUM}\\s+add\\s+value` +
        `(?:\\s+if\\s+not\\s+exists)?\\s*'([a-z0-9_]+)'`,
      "gis",
    );
    for (const match of sql.matchAll(altered)) labels.add(match[1]);
  }
  return labels;
}

/** Every literal in the ConversationEventType union. */
function labelsFromUnion() {
  // COMMENTS COME OUT FIRST, before anything looks for the union's end. The
  // first version of this guard sliced to the first `;` after the declaration
  // and then stripped comments, and one of the union's own doc comments contains
  // a semicolon — so it read a union of ten members, reported the other sixteen
  // as missing, and would have had somebody "fix" a file that was already right.
  const source = readFileSync(UNION_FILE, "utf8").replace(/\/\/[^\n]*/g, "");
  const start = source.indexOf("export type ConversationEventType");
  if (start === -1) {
    fail(`ConversationEventType is gone from ${UNION_FILE}. Point this at it.`);
    return new Set();
  }
  const end = source.indexOf(";", start);
  if (end === -1) {
    fail(`ConversationEventType in ${UNION_FILE} never terminates.`);
    return new Set();
  }
  const body = source.slice(start, end);
  return new Set([...body.matchAll(/"([a-z0-9_]+)"/gi)].map((m) => m[1]));
}

let failures = 0;
function fail(message) {
  failures += 1;
  console.error(`  x ${message}`);
}

const sql = labelsFromMigrations();
const ts = labelsFromUnion();

if (sql.size === 0) {
  fail(
    `No ${ENUM} labels found in ${MIGRATIONS}. This guard is reading nothing, ` +
      `which is worse than not running: fix the parser before trusting a pass.`,
  );
}

for (const label of [...ts].sort()) {
  if (!sql.has(label)) {
    fail(
      `"${label}" is in ConversationEventType but in no migration. Any insert ` +
        `of it raises "invalid input value for enum" at runtime. Add it in its ` +
        `OWN migration — a new enum value cannot be used in the transaction ` +
        `that adds it.`,
    );
  }
}

for (const label of [...sql].sort()) {
  if (!ts.has(label)) {
    fail(
      `"${label}" is in the SQL enum but not in ConversationEventType, so ` +
        `nothing can write it through insertConversationEvents. The next writer ` +
        `will hand an untyped literal to PostgREST and lose tsc as a guard — ` +
        `which is exactly how #554 shipped. Add it to the union in ${UNION_FILE}.`,
    );
  }
}

if (failures > 0) {
  console.error(
    `\n${failures} conversation-event problem(s). #554: a customer's rating was ` +
      `recorded and never mentioned, for months, because these two lists ` +
      `disagreed.\n`,
  );
  process.exit(1);
}

console.log(
  `Conversation events: ${sql.size} enum label(s) in the migrations, and ` +
    `ConversationEventType names exactly the same set.`,
);
