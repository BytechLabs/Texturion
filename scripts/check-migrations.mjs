#!/usr/bin/env node
/**
 * Guard the one step in the pipeline that cannot be undone.
 *
 * A bad Worker rolls back in seconds (`wrangler rollback`). A migration does
 * not: once `supabase db push` has dropped a column in production, the data is
 * gone. And CI cannot catch it — CI applies migrations to an EMPTY database, so
 * a `drop column` passes every test perfectly and then destroys real rows.
 *
 * So destructive statements have to be DELIBERATE. Any migration containing one
 * must say so:
 *
 *   -- destructive-ok: <why this is safe>
 *
 * That is the whole contract. It does not stop you doing anything; it stops you
 * doing it by accident, and it leaves the reason next to the statement forever.
 *
 * Usage: node scripts/check-migrations.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase/migrations";
const ACK = /--\s*destructive-ok\s*:/i;

/**
 * Migrations that were already APPLIED to production before this guard existed.
 *
 * They are acknowledged here rather than inline because a shipped migration is
 * never edited (D7/D14) — `supabase_migrations.schema_migrations` stores the
 * statements it actually ran, so rewriting the file to satisfy a lint would put
 * the recorded history and the repo out of step, over a comment. Every NEW
 * migration uses the inline `-- destructive-ok:` marker instead.
 */
const GRANDFATHERED = new Map([
  [
    "20260704110000_hard_overage_ceiling.sql",
    "#12 Phase 0.3 — the NOT NULL is the point: a nullable overage_cap_multiplier " +
      "meant 'no cap', i.e. unbounded metered spend on our dollar. The same " +
      "migration backfills existing NULLs (line 22) before adding the constraint " +
      "(line 28), so no row can fail it.",
  ],
  [
    "20260705010000_drop_google_review_link.sql",
    "The Reviews feature was removed from the product (founder: \"we don't need " +
      "that\"). The column was its last artifact — nothing read it, and the " +
      "{review_link} token that resolved from it went in the same wave.",
  ],
  [
    "20260712000200_delete_forwarding.sql",
    "D43/#135 deletion wave, founder-binding (\"No forwarding whatsoever, delete " +
      "all that\"). The webhook had stopped reading these columns in the phase-2 " +
      "rework; the browser is the phone now, so the forward targets were dead data.",
  ],
]);

/**
 * Statements that destroy DATA or take a blocking lock — the things a rollback
 * cannot undo.
 *
 * Deliberately NOT flagged: `drop function|view|trigger|type`. Dropping and
 * recreating a routine to change its signature is the normal idiom here (and
 * this repo does it in ~16 migrations); it changes no rows, and flagging it
 * would train everyone to add the acknowledgement reflexively, which is worse
 * than not checking at all. A guard people ignore is not a guard.
 *
 * `drop policy` IS flagged despite touching no rows: it silently removes a
 * security boundary, and silence is the problem.
 */
const RULES = [
  [/\bdrop\s+table\b/i, "drops a table"],
  [/\balter\s+table\b[\s\S]{0,200}?\bdrop\s+column\b/i, "drops a column"],
  [/\btruncate\b/i, "truncates a table"],
  [/\bdrop\s+(?:policy|publication)\b/i, "drops a security/replication object"],
  [/\balter\s+column\b[\s\S]{0,120}?\bset\s+not\s+null\b/i, "adds NOT NULL to an existing column (fails on existing NULLs)"],
  [/\balter\s+column\b[\s\S]{0,120}?\btype\b/i, "changes a column type (can truncate values)"],
  [/\bdelete\s+from\b(?![\s\S]{0,200}?\bwhere\b)/i, "deletes rows with no WHERE"],
];

/** Strip comments so a rule can't fire on prose describing the change. */
function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const offenders = [];

for (const file of files) {
  if (GRANDFATHERED.has(file)) continue; // already applied; reason recorded above
  const raw = readFileSync(join(DIR, file), "utf8");
  if (ACK.test(raw)) continue; // acknowledged, with the reason in the file
  const sql = stripComments(raw);
  const hits = RULES.filter(([pattern]) => pattern.test(sql)).map(([, why]) => why);
  if (hits.length > 0) offenders.push({ file, hits });
}

// A grandfathered entry for a migration that no longer exists is stale, and a
// stale allowlist quietly stops guarding things.
const missing = [...GRANDFATHERED.keys()].filter((f) => !files.includes(f));
if (missing.length > 0) {
  console.error(
    `Grandfathered migration(s) no longer present — drop them from the list:\n  ${missing.join("\n  ")}`,
  );
  process.exit(1);
}

if (offenders.length === 0) {
  console.log(`${files.length} migrations checked — no unacknowledged destructive statements.`);
  process.exit(0);
}

console.error("Destructive migration(s) without an acknowledgement:\n");
for (const { file, hits } of offenders) {
  console.error(`  ${DIR}/${file}`);
  for (const why of hits) console.error(`      - ${why}`);
}
console.error(
  [
    "",
    "CI applies migrations to an EMPTY database, so these pass every test and",
    "then run against real rows — and a migration cannot be rolled back.",
    "",
    "If it is intended, say so in the migration:",
    "",
    "    -- destructive-ok: <why this is safe>",
    "",
  ].join("\n"),
);
process.exit(1);
