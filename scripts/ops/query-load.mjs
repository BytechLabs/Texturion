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
 * #251 lists five unmeasured axes. Four of them — Durable Object saturation,
 * the Supabase pooler ceiling, realtime fan-out, and webhook burst — are
 * properties of a DEPLOYED system under concurrency, and no local script can
 * speak to them honestly. Claiming otherwise would be the worst outcome here:
 * a capacity number that reads as measured and was guessed.
 *
 * The fifth is different, and it is the one the issue says unit tests cannot
 * reach: *"their behaviour on a workspace with 50,000 conversations and 200,000
 * messages is unmeasured — and index behaviour on realistic data volumes is not
 * something unit tests can tell us."* Index behaviour at volume is a property of
 * Postgres and the schema, not of the network, so a local database with the same
 * migrations answers it exactly.
 *
 * So this measures the queries and says nothing about the rest. The capacity
 * document records both halves, including which numbers do not exist yet.
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
  // Children first: nothing cascades from companies by design (#284 found the
  // same thing for calls), so the fixture is removed in dependency order.
  psql(`
    delete from public.messages where company_id = '${COMPANY}';
    delete from public.conversations where company_id = '${COMPANY}';
    delete from public.contacts where company_id = '${COMPANY}';
    delete from public.phone_numbers where company_id = '${COMPANY}';
    delete from public.company_members where company_id = '${COMPANY}';
    delete from public.companies where id = '${COMPANY}';
    delete from auth.users where id = '${OWNER}';
  `);
}

cleanup(); // a previous crashed run leaves rows; start from nothing

console.log("  seeding…");
const seedStarted = Date.now();

// Generated in bulk with generate_series rather than row by row: seeding
// 200k messages one INSERT at a time takes longer than the measurement it
// exists to support, and nothing about the fixture needs per-row logic.
psql(`
  insert into auth.users (id, email)
  values ('${OWNER}', 'load-251@test.local');

  insert into public.companies
    (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
  values ('${COMPANY}', 'Load Fixture', '${OWNER}', 'US', '415', now());

  insert into public.company_members (company_id, user_id, role)
  values ('${COMPANY}', '${OWNER}', 'owner');

  insert into public.phone_numbers
    (id, company_id, number_e164, status, provisioning_key, country)
  values ('${NUMBER}', '${COMPANY}', '+14155559251', 'active', 'load-251', 'US');

  insert into public.contacts (company_id, phone_e164, name)
  select '${COMPANY}', '+1415' || lpad(g::text, 7, '0'), 'Customer ' || g
    from generate_series(1, ${conversations}) g;

  -- A realistic status mix, including closed, because the inbox's default
  -- filter EXCLUDES closed and an all-open fixture would measure the wrong
  -- selectivity. closed_at is set with it: conversations_closed_consistency
  -- requires the two to agree, which is the schema refusing exactly the kind
  -- of incoherent fixture that produces a flattering benchmark.
  insert into public.conversations
    (company_id, contact_id, phone_number_id, status, closed_at, last_message_at)
  select
    '${COMPANY}', picked.id, '${NUMBER}', picked.status,
    case when picked.status = 'closed' then now() - (picked.n || ' minutes')::interval end,
    now() - (picked.n || ' minutes')::interval
  from (
    select
      ct.id,
      row_number() over (order by ct.id) as n,
      (array['new','open','waiting','closed'])[
        1 + (row_number() over (order by ct.id) % 4)
      ]::public.conversation_status as status
    from public.contacts ct
    where ct.company_id = '${COMPANY}'
  ) picked;

  -- Messages spread across the conversations, so no single thread is
  -- pathological and the per-conversation index is exercised realistically.
  insert into public.messages
    (company_id, conversation_id, direction, status, body, created_at,
     sent_by_user_id)
  with numbered as (
    select id, row_number() over (order by id) as n
      from public.conversations
     where company_id = '${COMPANY}'
  )
  select
    '${COMPANY}', v.id,
    (case when g % 2 = 0 then 'inbound' else 'outbound' end)::public.message_direction,
    (case when g % 2 = 0 then 'received' else 'delivered' end)::public.message_status,
    'Load fixture message ' || g,
    now() - (g || ' seconds')::interval,
    (case when g % 2 = 0 then null else '${OWNER}' end)::uuid
  from generate_series(1, ${messages}) g
  -- JOINED ON A NUMBERED SET, not \`offset (g % n) limit 1\`. That first
  -- version was fine at 5k and never finished at 50k: OFFSET scans linearly,
  -- so every one of 200k messages walked an average of 25k conversation rows.
  -- The seeder for a volume benchmark must not itself be the thing that
  -- degrades with volume.
  join numbered v on v.n = 1 + (g % ${conversations});

  analyze public.conversations;
  analyze public.messages;
  analyze public.contacts;
`);
console.log(`  seeded in ${((Date.now() - seedStarted) / 1000).toFixed(1)}s\n`);

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
  "  MEASURED HERE: index behaviour on the hot list queries, which is a\n" +
    "  property of Postgres and the schema and therefore identical locally.\n" +
    "  NOT MEASURED: Durable Object saturation, the Supabase pooler ceiling,\n" +
    "  realtime fan-out and webhook burst. Those are properties of a deployed\n" +
    "  system under concurrency, and a local script that claimed them would be\n" +
    "  worse than no number at all. See docs/CAPACITY.md.\n",
);

if (keep) {
  console.log(`  --keep: fixture left in place under company ${COMPANY}.\n`);
} else {
  cleanup();
  console.log("  fixture removed.\n");
}
