#!/usr/bin/env node
/**
 * A SECOND foreign key between two tables breaks every embed between them.
 *
 * PostgREST resolves `companies.select("phone_numbers(...)")` by finding the
 * one relationship between the pair. Give it two and it refuses — not the new
 * relationship, ALL of them:
 *
 *   Could not embed because more than one relationship was found for
 *   'phone_numbers' and 'companies'
 *
 * This is not theoretical and it is not cheap. #232 added
 * `companies.widget_number_id references phone_numbers(id)`, which looked like
 * ordinary hygiene on a column nothing had read yet. `phone_numbers.company_id`
 * already pointed the other way, so eighteen unrelated embeds started failing
 * at once: the E2E suite went red on an inbound carrier webhook and on the
 * number-release cron. Texts stopped arriving because of a settings column.
 *
 * The failure has three properties that make it worth a guard rather than a
 * lesson:
 *
 *   1. It is INVISIBLE in the migration. The diff is one `references` clause.
 *   2. It is UNRELATED to what breaks. Nothing points from the failing webhook
 *      back to the column, and the error names two tables rather than a column.
 *   3. It is EASY TO REINTRODUCE. "This column has no foreign key" reads as an
 *      oversight to every reviewer and every linter.
 *
 * So: a pair of tables that the Worker embeds may have at most ONE foreign key
 * between them, in either direction. If a second one is genuinely needed, the
 * embeds have to carry the `!constraint_name` hint and this list has to say so.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = "supabase/migrations";
const API_SRC = "apps/api/src";

/**
 * Pairs that legitimately carry more than one relationship, with the reason.
 *
 * Empty, and that is the healthy state. An entry here is a promise that every
 * embed across the pair spells its constraint out.
 */
const HINTED_PAIRS = new Set();

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Which table pairs does the Worker actually embed?
// ---------------------------------------------------------------------------
//
// Only pairs that are embedded can break, and limiting the check to them keeps
// this honest: a second FK between two tables nobody embeds is fine, and
// failing on it would train people to add exemptions.
const embedded = new Set();
for (const file of walk(API_SRC).filter((f) => f.endsWith(".ts"))) {
  const source = readFileSync(file, "utf8");
  // `.from("a")` … `.select("...b(...)...")` in the same statement. Read
  // loosely on purpose: a false POSITIVE here only means a pair is checked that
  // did not need to be, which costs nothing.
  for (const match of source.matchAll(
    /\.from\(\s*"([a-z_]+)"\s*\)[\s\S]{0,400}?\.select\(\s*(?:"|`)([\s\S]*?)(?:"|`)\s*[,)]/g,
  )) {
    const root = match[1];
    for (const embed of match[2].matchAll(/([a-z_]+)\s*(!\s*[a-z_]+\s*)?\(/g)) {
      const child = embed[1];
      if (child === root) continue;
      // An embed that NAMES its constraint is already unambiguous — that is
      // the whole fix — so it does not put the pair at risk. Counting it did:
      // the first run reported `messages <-> tasks` on the strength of
      // scheduled-send.ts, which has carried `messages!message_id` for ages.
      // It was still right about the pair, because tasks-export.ts alongside
      // it had no hint and had been failing outright with PGRST201.
      if (embed[2]) continue;
      embedded.add([root, child].sort().join("|"));
    }
  }
}

// ---------------------------------------------------------------------------
// Every foreign key the migrations declare.
// ---------------------------------------------------------------------------
const relationships = new Map();

function note(from, to, where) {
  if (from === to) return;
  const key = [from, to].sort().join("|");
  if (!relationships.has(key)) relationships.set(key, []);
  const seen = relationships.get(key);
  // One relationship can be declared and re-declared across migrations (a drop
  // and recreate); the SAME column pointing at the SAME table is one edge.
  if (!seen.some((entry) => entry.label === where.label)) seen.push(where);
}

for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  // Column-level: `foo_id uuid references public.bar(id)` inside a create/alter
  // whose own table we track by the nearest preceding table name.
  const statements = sql.split(/;\s*\n/);
  for (const statement of statements) {
    const owner =
      statement.match(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_]+)/i)?.[1] ??
      statement.match(/alter\s+table\s+(?:only\s+)?(?:public\.)?([a-z_]+)/i)?.[1];
    if (!owner) continue;
    // A migration that DROPS a constraint is removing an edge, not adding one.
    if (/drop\s+constraint/i.test(statement) && !/references/i.test(statement)) continue;
    // `add column` and `if not exists` sit between the ALTER and the column
    // name; without consuming them the column reads as literally "add", which
    // is how this guard's first run invented a `messages.add` relationship.
    for (const ref of statement.matchAll(
      /^[ \t]*(?:add\s+)?(?:column\s+)?(?:if\s+not\s+exists\s+)?([a-z_]+)\s+[a-z0-9 \t\r\n_()]*?references\s+(?:public\.)?([a-z_]+)/gim,
    )) {
      note(owner, ref[2], { label: `${owner}.${ref[1]}`, file });
    }
    for (const ref of statement.matchAll(
      /foreign\s+key\s*\(\s*([a-z_]+)\s*\)\s*references\s+(?:public\.)?([a-z_]+)/gi,
    )) {
      note(owner, ref[2], { label: `${owner}.${ref[1]}`, file });
    }
  }
}

const problems = [];
for (const pair of embedded) {
  if (HINTED_PAIRS.has(pair)) continue;
  const edges = relationships.get(pair) ?? [];
  if (edges.length > 1) {
    const [a, b] = pair.split("|");
    problems.push(
      `${a} <-> ${b} has ${edges.length} foreign keys (${edges
        .map((e) => e.label)
        .join(", ")}), and the Worker embeds this pair. PostgREST will refuse ` +
        `EVERY embed between them, not just the new one. Drop one of the ` +
        `constraints, or add the "!constraint_name" hint to every embed across ` +
        `the pair and register it in HINTED_PAIRS.`,
    );
  }
}

if (problems.length > 0) {
  console.error("PostgREST embed ambiguity (#232):\n");
  for (const problem of problems) console.error(`  - ${problem}\n`);
  process.exit(1);
}

console.log(
  `PostgREST embeds: ${embedded.size} table pair(s) embedded by the Worker, ` +
    `each with at most one relationship.`,
);
