/**
 * [#251] The hot queries at realistic volume, measured rather than assumed.
 *
 *   node scripts/ops/query-load.mjs
 *   node scripts/ops/query-load.mjs --conversations 50000 --messages 200000
 *   node scripts/ops/query-load.mjs --keep      # leave the fixture for EXPLAIN
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS ANSWERS, AND WHAT IT DELIBERATELY DOES NOT.
 *
 * This script owns ONE axis: *"their behaviour on a workspace with 50,000
 * conversations and 200,000 messages is unmeasured — and index behaviour on
 * realistic data volumes is not something unit tests can tell us."* Index
 * behaviour at volume is a property of Postgres and the schema, not of the
 * network, so a local database with the same migrations answers it exactly.
 *
 * Other committed harnesses now cover local webhook contention, Realtime
 * delivery, and Durable Object structure. None of those local lower bounds —
 * and nothing here — claims the managed pooler ceiling, hosted Realtime
 * ceiling, deployed DO latency/co-tenancy, or compute cost. `docs/CAPACITY.md`'s
 * acceptance matrix keeps those distinctions explicit.
 *
 * ---------------------------------------------------------------------------
 * LOCAL-ONLY BY CONSTRUCTION.
 *
 * It writes hundreds of thousands of rows, so it must be impossible to point at
 * production. It talks to the `supabase_db_Loonext` docker container directly,
 * exactly as `dev-seed.mjs` does: there is no connection string to mistype and
 * no environment variable that could redirect it. If the container is not
 * running, it fails rather than falling back to anything.
 *
 * The fixture lives in its own company and is dropped at the end unless
 * `--keep`. Dropping is by company id, so it cannot touch a developer's own
 * seeded workspace.
 */
import { execFileSync } from "node:child_process";

import { volumeCleanupSql, volumeFixtureSql } from "../load/volume-fixture.mjs";

const CONTAINER = "supabase_db_Loonext";

/** One throwaway workspace, fixed so a crashed run can be cleaned up by hand. */
const COMPANY = "51000000-0000-4000-8000-000000000251";
const OWNER = "51000000-0000-4000-8000-00000000025a";
const NUMBER = "51000000-0000-4000-8000-00000000025b";

function psql(sql) {
  return execFileSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAc", sql],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  ).trim();
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = Number(process.argv[i + 1]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const conversations = arg("conversations", 50_000);
const messages = arg("messages", 200_000);
const keep = process.argv.includes("--keep");

console.log(
  `\n  #251 hot-query timings\n` +
    `  target : ${CONTAINER} (local docker; this script cannot reach production)\n` +
    `  volume : ${conversations.toLocaleString()} conversations, ` +
    `${messages.toLocaleString()} messages in ONE workspace\n`,
);

try {
  psql("select 1");
} catch {
  console.error(
    "  x The local Supabase database is not running.\n" +
      "    Start it with `pnpm db:start`, then re-run.\n",
  );
  process.exit(1);
}

function cleanup() {
  psql(`
    ${volumeCleanupSql({ company: COMPANY })}
    delete from auth.users where id = '${OWNER}';
  `);
}

cleanup(); // a previous crashed run leaves rows; start from nothing

console.log("  seeding…");
const seedStarted = Date.now();

// The fixture SQL is shared with the rig driver (../load/volume-fixture.mjs), so
// the two measure the same workspace.
psql(`
  insert into auth.users (id, email)
  values ('${OWNER}', 'load-251@test.local');

  ${volumeFixtureSql({
    company: COMPANY,
    owner: OWNER,
    number: NUMBER,
    e164: "+14155559251",
    areaCode: "415",
    country: "US",
    conversations,
    messages,
    provisioningKey: "load-251",
    companyName: "Load Fixture",
  })}
`);
const seedMs = Date.now() - seedStarted;
console.log(`  seeded in ${(seedMs / 1000).toFixed(1)}s\n`);

/**
 * Each query timed inside Postgres rather than from here, so the number is the
 * query and not the round trip through docker. Run three times and report the
 * best: the first run pays for cold caches, which is a real cost but not the
 * one a capacity plan is about — a busy workspace's pages are warm.
 */
function timeQuery(label, sql) {
  const runs = [];
  for (let i = 0; i < 3; i += 1) {
    const ms = Number(
      psql(`
        do $$ begin perform 1; end $$;
        select round(extract(milliseconds from (clock_timestamp() - t0))::numeric, 1)
          from (select clock_timestamp() as t0) s, lateral (${sql}) q
         limit 1;
      `).split("\n").pop(),
    );
    runs.push(Number.isFinite(ms) ? ms : NaN);
  }
  const best = Math.min(...runs.filter(Number.isFinite));
  return { label, ms: Number.isFinite(best) ? best : null, runs };
}

const results = [
  timeQuery(
    "api_for_you (the post-login landing)",
    `select 1 from public.api_for_you('${COMPANY}', '${OWNER}', now(), 20, null)`,
  ),
  timeQuery(
    "api_list_conversations (inbox, first page)",
    `select 1 from public.api_list_conversations('${COMPANY}', '${OWNER}', 30, null, null, null, false, false, null, null, null, null, null, null)`,
  ),
  timeQuery(
    "api_list_conversations (status=open)",
    `select 1 from public.api_list_conversations('${COMPANY}', '${OWNER}', 30, 'open', null, null, false, false, null, null, null, null, null, null)`,
  ),
  timeQuery(
    "api_list_conversations (search)",
    `select 1 from public.api_list_conversations('${COMPANY}', '${OWNER}', 30, null, null, null, false, false, 'Customer 4', null, null, null, null, null)`,
  ),
];

console.table(
  results.map((r) => ({
    query: r.label,
    "best of 3 (ms)": r.ms ?? "failed",
  })),
);

const failedQueries = results.filter((result) => result.ms === null);
if (failedQueries.length > 0) {
  if (!keep) cleanup();
  throw new Error(
    `No capacity result emitted: ${failedQueries.map((result) => result.label).join(", ")} did not return a timing`,
  );
}

// A page a person waits for. Not a hard budget — this is a report, and the
// number that matters is written into the capacity doc rather than enforced
// here — but a line worth drawing attention to.
const SLOW_MS = 200;
const slow = results.filter((r) => r.ms !== null && r.ms > SLOW_MS);
if (slow.length > 0) {
  console.log(
    `\n  ${slow.length} query(ies) over ${SLOW_MS}ms at this volume. Re-run with\n` +
      `  --keep and EXPLAIN (ANALYZE, BUFFERS) the offender; file the index work\n` +
      `  separately, which is what #251 asks for.\n`,
  );
} else {
  console.log(
    `\n  Every hot query stayed under ${SLOW_MS}ms at this volume.\n`,
  );
}

console.log(
  "CAPACITY_RESULT " +
    JSON.stringify({
      schema: "loonext.capacity.v1",
      scenario: "hot-query-volume",
      environment: "local-postgres",
      tested_bound: {
        conversations,
        messages,
        workspace_count: 1,
      },
      ceiling_reached: false,
      measurements: {
        seed_ms: seedMs,
        attention_threshold_ms: SLOW_MS,
        attention_threshold_exceeded: slow.length > 0,
        queries: Object.fromEntries(
          results.map((result) => [result.label, result.ms]),
        ),
      },
      notes: [
        "Best of three warm local Postgres timings; not production end-to-end latency.",
        "A 200ms attention threshold is not a system ceiling.",
      ],
    }),
);

console.log(
  "  MEASURED HERE: index behaviour on the hot list queries, which is a\n" +
    "  property of Postgres and the schema and therefore identical locally.\n" +
    "  NOT MEASURED HERE: managed pooler/Realtime ceilings, deployed DO\n" +
    "  latency/co-tenancy, honest degradation at overload, or compute cost.\n" +
    "  The dedicated local scenarios and external gaps are in CAPACITY.md.\n",
);

if (keep) {
  console.log(`  --keep: fixture left in place under company ${COMPANY}.\n`);
} else {
  cleanup();
  console.log("  fixture removed.\n");
}
