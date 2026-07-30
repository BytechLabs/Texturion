/**
 * [#249] Prove the data comes back, and time it.
 *
 *   node scripts/ops/backup-drill.mjs
 *   node scripts/ops/backup-drill.mjs --container supabase_db_Loonext
 *   node scripts/ops/backup-drill.mjs --keep       # leave the restored DB for poking
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS AND WHAT IT DOES *NOT* CLAIM.
 *
 * `docs/deploy/08-operations.md` §6 said "confirm PITR is enabled" and "use the
 * dashboard to restore to a timestamp". That is a plan, not a capability: an
 * untested backup is a belief, and the first exercise of a belief is always
 * during the worst hour of the company's life.
 *
 * This drill exercises the LOGICAL path end to end — dump, restore into a
 * scratch database, verify — and times every phase, so "how long does our data
 * take to come back, and does it come back intact?" has a measured answer
 * instead of a hope.
 *
 * IT IS NOT A PITR DRILL. Restoring Supabase's point-in-time backup into a
 * fresh project is a dashboard action with a cost, and only the founder can do
 * it. `docs/DISASTER-RECOVERY.md` says so plainly rather than letting this
 * script imply coverage it does not have. What this DOES cover is the half
 * that fails silently: a dump that will not restore, a constraint that only
 * bites on reload, an extension the target lacks, row counts that do not match.
 *
 * Runs against the LOCAL Supabase container by default. Pointing it at
 * production would put a full dump on the founder's laptop and read-load on
 * the live database to learn something the local schema answers just as well.
 */
import { execFileSync } from "node:child_process";

import { fail, parseArgs } from "./lib.mjs";

const args = parseArgs();
const container = typeof args.container === "string" ? args.container : "supabase_db_Loonext";
const keep = args.keep === true;
const SCRATCH_DB = "restore_drill";

/** Run inside the database container, returning stdout. */
function inContainer(command, { input, quiet } = {}) {
  try {
    return execFileSync("docker", ["exec", "-i", container, "sh", "-c", command], {
      input,
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
      stdio: quiet ? ["pipe", "pipe", "pipe"] : ["pipe", "pipe", "inherit"],
    });
  } catch (cause) {
    fail(`command failed in ${container}: ${command}\n  ${String(cause.message ?? cause)}`);
  }
}

function sql(database, statement) {
  return inContainer(
    `psql -U postgres -d ${database} -tAc ${JSON.stringify(statement)}`,
    { quiet: true },
  ).trim();
}

/** Seconds, to one decimal — the unit an RTO is argued in. */
function since(startedAt) {
  return ((Date.now() - startedAt) / 1000).toFixed(1);
}

console.log(`\n  Backup restore drill — container ${container}\n`);

// Confirm the container is actually there before timing anything.
inContainer("pg_dump --version", { quiet: true });

// ---------------------------------------------------------------------------
// 1. What we are trying to get back.
// ---------------------------------------------------------------------------

// BASE TABLE only, and views counted separately. The unfiltered count included
// the `task_map_rows` view and reported it as a table, while the per-table row
// comparison below only ever covered base tables — so the drill record said "66
// tables verified" when 65 were compared and one was a view that holds no rows
// of its own. A recovery record that overstates its own coverage by one is the
// kind of small inaccuracy that makes a reader distrust the rest of it.
const tableCount = Number(
  sql(
    "postgres",
    "select count(*) from information_schema.tables " +
      "where table_schema='public' and table_type='BASE TABLE'",
  ),
);
const viewCount = Number(
  sql(
    "postgres",
    "select count(*) from information_schema.tables " +
      "where table_schema='public' and table_type='VIEW'",
  ),
);
const rowCount = Number(
  sql(
    "postgres",
    "select coalesce(sum(n_live_tup), 0) from pg_stat_user_tables where schemaname='public'",
  ),
);
const functionCount = Number(
  sql(
    "postgres",
    "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'",
  ),
);

console.log(
  `  Source: ${tableCount} base tables (+${viewCount} views), ~${rowCount} rows, ` +
    `${functionCount} functions\n`,
);

// ---------------------------------------------------------------------------
// 2. Dump.
// ---------------------------------------------------------------------------

const dumpStart = Date.now();
inContainer(
  // Custom format: the shape a real recovery uses, because it restores in
  // parallel and can be reordered. A plain SQL dump would time differently and
  // would not exercise pg_restore at all.
  "pg_dump -U postgres -d postgres -F c -f /tmp/drill.dump",
  { quiet: true },
);
const dumpSeconds = since(dumpStart);
const dumpBytes = Number(inContainer("stat -c %s /tmp/drill.dump", { quiet: true }).trim());

console.log(`  Dump:    ${dumpSeconds}s  (${(dumpBytes / 1024 / 1024).toFixed(1)} MB)`);

// ---------------------------------------------------------------------------
// 3. Restore into a scratch database.
// ---------------------------------------------------------------------------

inContainer(`psql -U postgres -d postgres -c 'drop database if exists ${SCRATCH_DB}'`, {
  quiet: true,
});
inContainer(`psql -U postgres -d postgres -c 'create database ${SCRATCH_DB}'`, { quiet: true });

const restoreStart = Date.now();
// `|| true`: pg_restore exits non-zero on benign ownership/extension notices
// against a scratch database that has no Supabase roles. The verification
// below is what decides whether the restore actually worked — an exit code
// here would fail the drill for reasons a real recovery would not care about.
inContainer(
  `pg_restore -U postgres -d ${SCRATCH_DB} --no-owner --no-privileges /tmp/drill.dump 2>/tmp/drill.err || true`,
  { quiet: true },
);
const restoreSeconds = since(restoreStart);

console.log(`  Restore: ${restoreSeconds}s`);

// ---------------------------------------------------------------------------
// 4. Verify. A restore that ran is not a restore that worked.
// ---------------------------------------------------------------------------

const restoredTables = Number(
  sql(
    SCRATCH_DB,
    "select count(*) from information_schema.tables " +
      "where table_schema='public' and table_type='BASE TABLE'",
  ),
);
const restoredFunctions = Number(
  sql(
    SCRATCH_DB,
    "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'",
  ),
);

// Row counts per table, compared exactly. pg_stat is an estimate, so the
// comparison counts for real on both sides — an off-by-a-table restore is
// exactly the failure a summary number hides.
// Kept on ONE line: the statement is JSON.stringify'd into a `docker exec sh -c`
// argument, and a newline inside it reaches psql as a literal backslash-n.
const PER_TABLE_SQL =
  "select string_agg(t || ':' || c, ',' order by t) from (" +
  "select table_name as t, (xpath('/row/c/text()', " +
  "query_to_xml(format('select count(*) as c from public.%I', table_name), " +
  "false, true, '')))[1]::text::int as c " +
  "from information_schema.tables " +
  "where table_schema = 'public' and table_type = 'BASE TABLE') s";

const perTable = (database) => sql(database, PER_TABLE_SQL);

const sourceRows = perTable("postgres");
const restoredRows = perTable(SCRATCH_DB);

const errors = inContainer("cat /tmp/drill.err || true", { quiet: true }).trim();
const realErrors = errors
  .split("\n")
  .filter((line) => line.includes("error:"))
  // Role grants and extension ownership do not exist in a bare scratch
  // database and would not be part of a real Supabase-to-Supabase recovery.
  .filter((line) => !/role "|does not exist|extension |must be owner|permission denied/i.test(line));

console.log("");
const problems = [];
if (restoredTables !== tableCount) {
  problems.push(`tables: ${tableCount} → ${restoredTables}`);
}
if (restoredFunctions !== functionCount) {
  problems.push(`functions: ${functionCount} → ${restoredFunctions}`);
}
if (sourceRows !== restoredRows) {
  problems.push("row counts differ per table");
}
if (realErrors.length > 0) {
  problems.push(`${realErrors.length} restore error(s)`);
}

if (problems.length === 0) {
  console.log(
    `  ✓ VERIFIED: ${restoredTables} base tables, ${restoredFunctions} functions, ` +
      `every per-table row count matched.`,
  );
} else {
  console.log(`  ✗ PROBLEMS: ${problems.join("; ")}`);
  for (const line of realErrors.slice(0, 10)) console.log(`    ${line}`);
}

const total = (Number(dumpSeconds) + Number(restoreSeconds)).toFixed(1);
console.log(
  `\n  Total data-recovery time: ${total}s for ~${rowCount} rows.\n` +
    `  This is the DATA half of the RTO only. The rest — provisioning a target,\n` +
    `  DNS/secrets, and the reconciliation in docs/DISASTER-RECOVERY.md §4 —\n` +
    `  dominates at this size and is not measured here.\n`,
);

if (!keep) {
  inContainer(`psql -U postgres -d postgres -c 'drop database if exists ${SCRATCH_DB}'`, {
    quiet: true,
  });
  inContainer("rm -f /tmp/drill.dump /tmp/drill.err", { quiet: true });
} else {
  console.log(`  Kept: database "${SCRATCH_DB}" and /tmp/drill.dump inside ${container}.\n`);
}

if (problems.length > 0) process.exit(1);
