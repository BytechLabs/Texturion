/**
 * [#249] How big is production, and how long does getting it out of there take?
 *
 *   node scripts/ops/prod-dump-scale.mjs
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS SEPARATELY FROM backup-drill.mjs.
 *
 * The drill proves the data comes back and times it — against LOCAL. #249's
 * write-up flagged its own caveat: "the drill ran against local, where the
 * schema is identical but the data volume is not... it should be re-run against
 * a production-sized restore before anyone quotes the RTO in earnest."
 *
 * That caveat has two halves, and only one of them needs production. How long a
 * restore takes is a function of the bytes, which local measures fine. How many
 * bytes there ARE, and how long they take to come OUT of the managed database
 * over the network, only production can answer. This answers exactly that.
 *
 * NOTHING IS WRITTEN TO DISK, DELIBERATELY. The dump is piped straight into a
 * byte counter inside the database container and discarded. A full production
 * dump at rest on a developer's laptop is customer message bodies and phone
 * numbers sitting somewhere with no retention policy and no encryption story,
 * and the only thing it would buy over this is a restore timing that local
 * already measures per byte. So the bytes are counted in flight and thrown away.
 *
 * IT IS STILL NOT A PITR DRILL. Restoring Supabase's own backup into a fresh
 * project is a dashboard action with a cost, and PITR is off anyway
 * (verify-backup-posture.mjs). docs/DISASTER-RECOVERY.md says so plainly.
 *
 * READ-ONLY against production. pg_dump takes no locks that block writes and
 * this script issues no DDL and no DML. There is no code path here that can
 * write to production.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { fail, parseArgs } from "./lib.mjs";

const args = parseArgs();
const container =
  typeof args.container === "string" ? args.container : "supabase_db_Loonext";

/**
 * The CLI-only production credentials, from the commented block in
 * apps/api/.dev.vars (same source verify-backup-posture.mjs documents), or the
 * environment if it is already carrying them.
 *
 * Read here rather than taken as an argument so the password never appears in a
 * shell history, a process list, or a CI log.
 */
function productionDsn() {
  let ref = process.env.SUPABASE_PROJECT_REF?.trim();
  let password = process.env.SUPABASE_DB_PASSWORD?.trim();

  if (!ref || !password) {
    let raw;
    try {
      raw = readFileSync("apps/api/.dev.vars", "utf8");
    } catch {
      fail(
        "No SUPABASE_PROJECT_REF/SUPABASE_DB_PASSWORD in the environment and " +
          "apps/api/.dev.vars is not readable. Run from the repo root.",
      );
    }
    const read = (key) => {
      const match = new RegExp(`^#?\\s*${key}=(.*)$`, "m").exec(raw);
      return match ? match[1].trim().replace(/^["']|["']$/g, "") : null;
    };
    ref = ref || read("SUPABASE_PROJECT_REF");
    password = password || read("SUPABASE_DB_PASSWORD");
  }

  if (!ref || !password) {
    fail(
      "Missing SUPABASE_PROJECT_REF or SUPABASE_DB_PASSWORD. Both are CLI-only " +
        "credentials — see the commented block in apps/api/.dev.vars.",
    );
  }

  // Session pooler: the route that works from a developer machine. Transaction
  // mode would break pg_dump, which needs session-scoped state.
  const host = "aws-0-us-east-1.pooler.supabase.com";
  return `postgresql://postgres.${ref}:${encodeURIComponent(password)}@${host}:5432/postgres`;
}

/**
 * Run a command inside the local database container, which is where a matching
 * pg_dump lives. Using the container's client rather than requiring one on the
 * host is what makes this work on a Windows box with no libpq installed.
 *
 * THE DSN ARRIVES ON STDIN, never in argv. A connection string carrying the
 * production database password in a command line is readable by every process on
 * the box via `ps`, and lands in shell history and in any log that echoes the
 * command. Reading it from the pipe keeps it in the process's own memory.
 *
 * `IFS= read -r` rather than a bare `read` so nothing in the string is treated
 * as a field separator or an escape.
 */
function inContainer(command, { needsDsn = false, quiet = true } = {}) {
  const script = needsDsn ? `IFS= read -r DSN; export DSN; ${command}` : command;
  try {
    return execFileSync("docker", ["exec", "-i", container, "sh", "-c", script], {
      input: needsDsn ? `${dsn}\n` : undefined,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: quiet ? ["pipe", "pipe", "pipe"] : ["pipe", "pipe", "inherit"],
    });
  } catch (cause) {
    // Deliberately does NOT echo the failing command: it would print the DSN
    // back out on the one path where something has already gone wrong.
    fail(`command failed in ${container}: ${String(cause.message ?? cause)}`);
  }
}

const dsn = productionDsn();
console.log("\n  Production dump scale (read-only)\n");

// Confirm the connection before timing anything, so a credential problem is not
// reported as a slow dump.
const serverVersion = inContainer('psql "$DSN" -tAc "select version()"', {
  needsDsn: true,
}).trim();
console.log(`  Server:  ${serverVersion.split(",")[0]}`);

const clientVersion = inContainer("pg_dump --version").trim();
console.log(`  Client:  ${clientVersion}`);
// A client older than the server cannot dump it. Worth saying out loud, because
// the failure mode is a confusing mid-dump error rather than a refusal.
console.log(
  "           (pg_dump must be at or above the server version; mismatches " +
    "fail mid-dump)",
);

// ---------------------------------------------------------------------------
// What is actually there. Also the number that decides whether today's timing
// still means anything a year from now.
// ---------------------------------------------------------------------------

const scale = inContainer(
  `psql "$DSN" -tA -F'|' -c ${JSON.stringify(
    "select " +
      "(select count(*) from information_schema.tables where table_schema='public'), " +
      "(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'), " +
      "(select coalesce(sum(n_live_tup),0)::bigint from pg_stat_user_tables where schemaname='public'), " +
      "pg_database_size(current_database())",
  )}`,
  { needsDsn: true },
).trim();
const [tables, functions, rows, dbBytes] = scale.split("|").map(Number);

console.log(
  `\n  Live:    ${tables} tables, ${functions} functions, ~${rows} rows, ` +
    `${(dbBytes / 1024 / 1024).toFixed(1)} MB on disk`,
);
console.log(
  "           Fewer tables than supabase/migrations implies is EXPECTED: only a\n" +
    "           merged release ships migrations (D50), so production trails main.",
);

// ---------------------------------------------------------------------------
// The dump, streamed to a byte counter and discarded.
// ---------------------------------------------------------------------------

const startedAt = Date.now();
const bytes = Number(
  inContainer('pg_dump -F c --no-owner --no-acl "$DSN" | wc -c', {
    needsDsn: true,
  }).trim(),
);
const seconds = (Date.now() - startedAt) / 1000;

console.log(
  `\n  Dump:    ${seconds.toFixed(1)}s  (${(bytes / 1024 / 1024).toFixed(2)} MB compressed, discarded)`,
);

// The insight this script exists to produce. At a small database the dump time
// is round-trips, not bytes — so quoting a local drill's seconds as the real
// number understates it by an order of magnitude, and quoting THIS number as if
// it scaled with data would overstate it later.
const throughput = bytes / 1024 / Math.max(seconds, 0.001);
console.log(
  `           ~${throughput.toFixed(0)} KB/s over the session pooler. Below a few\n` +
    `           hundred MB this is dominated by network round-trips rather than by\n` +
    `           data volume, so it is close to a FLOOR, not a rate to extrapolate.`,
);

console.log(
  `\n  This is the "get the data out" half only. docs/DISASTER-RECOVERY.md §1\n` +
    `  holds the RTO and §4 the reconciliation that actually dominates it.\n` +
    `  Re-run this when the database passes ~1 GB; the timing above stops\n` +
    `  meaning anything once bytes rather than round-trips set the pace.\n`,
);
