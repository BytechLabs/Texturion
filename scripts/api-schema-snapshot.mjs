#!/usr/bin/env node
/**
 * The public-schema column snapshot the API's tests check selects against (#750).
 *
 * Two production 500s named columns the database did not have (`profiles.email`,
 * `task_map_rows.number`) because every test fake accepted any column. The fakes
 * now refuse a column this snapshot lacks, and a test scans every select the
 * Worker builds against it. Both need the schema without a database, so the
 * schema is kept in `apps/api/src/test/schema-snapshot.json`, generated here from
 * the real local database (built from supabase/migrations).
 *
 *   node scripts/api-schema-snapshot.mjs --write   regenerate from the local DB
 *   node scripts/api-schema-snapshot.mjs --check   fail when the file is stale
 *
 * `--check` runs in the SQL tests job, right after `supabase db reset`, so a
 * migration that changes a column cannot merge without the snapshot following it.
 * Reads only; never changes the database.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const CONTAINER = "supabase_db_Loonext";
const OUT = "apps/api/src/test/schema-snapshot.json";
// #749: the tables whose column defaults are settings, checked against packages/shared/src/setting-defaults.ts.
const DEFAULT_TABLES = ["companies", "notification_prefs", "phone_numbers"]
  .map((name) => `'${name}'`)
  .join(", ");

const QUERY = `
select json_build_object(
  'tables', (
    select coalesce(json_object_agg(t.table_name, json_build_object(
      'kind', case when t.table_type = 'VIEW' then 'view' else 'table' end,
      'columns', (
        select json_agg(c.column_name order by c.column_name)
        from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = t.table_name
      ),
      'computed', (
        select json_agg(distinct p.proname order by p.proname)
        from pg_proc p
        join pg_namespace pn on pn.oid = p.pronamespace and pn.nspname = 'public'
        join pg_class pc on pc.reltype = p.proargtypes[0] and pc.relnamespace = pn.oid
        where p.pronargs = 1 and pc.relname = t.table_name
      )
    ) order by t.table_name), '{}'::json)
    from information_schema.tables t
    where t.table_schema = 'public'
  ),
  'foreignKeys', (
    select coalesce(json_agg(json_build_object(
      'name', con.conname,
      'table', cl.relname,
      'columns', (select json_agg(a.attname order by k.ord)
                  from unnest(con.conkey) with ordinality k(attnum, ord)
                  join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum),
      'refTable', rc.relname
    ) order by cl.relname, con.conname), '[]'::json)
    from pg_constraint con
    join pg_class cl on cl.oid = con.conrelid
    join pg_class rc on rc.oid = con.confrelid
    join pg_namespace n on n.oid = cl.relnamespace and n.nspname = 'public'
    where con.contype = 'f'
  ),
  'defaults', (
    select coalesce(json_object_agg(d.table_name, d.columns order by d.table_name), '{}'::json)
    from (
      select c.table_name,
             json_object_agg(c.column_name, c.column_default order by c.column_name) as columns
      from information_schema.columns c
      where c.table_schema = 'public' and c.table_name in (${DEFAULT_TABLES})
      group by c.table_name
    ) d
  )
)`;

function render() {
  const raw = execFileSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-At", "-c", QUERY],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const schema = JSON.parse(raw);
  // One table and one key per line, so a migration shows up as a small diff.
  const tables = Object.entries(schema.tables).map(
    ([name, t]) =>
      `    ${JSON.stringify(name)}: ${JSON.stringify({ kind: t.kind, columns: t.columns ?? [], computed: t.computed ?? [] })}`,
  );
  const fks = schema.foreignKeys.map((f) => `    ${JSON.stringify(f)}`);
  const defaults = Object.entries(schema.defaults).map(
    ([name, columns]) => `    ${JSON.stringify(name)}: ${JSON.stringify(columns)}`,
  );
  return `{
  "generated": "by scripts/api-schema-snapshot.mjs from the local database built from supabase/migrations; do not edit, run --write (#750)",
  "tables": {
${tables.join(",\n")}
  },
  "foreignKeys": [
${fks.join(",\n")}
  ],
  "defaults": {
${defaults.join(",\n")}
  }
}
`;
}

const mode = process.argv[2];
if (mode !== "--write" && mode !== "--check") {
  console.error("usage: api-schema-snapshot.mjs --write | --check");
  process.exit(2);
}
const next = render();
if (mode === "--write") {
  writeFileSync(OUT, next);
  console.log(`wrote ${OUT}`);
} else {
  const current = readFileSync(OUT, "utf8").replace(/\r\n/g, "\n");
  if (current !== next) {
    console.error(
      `${OUT} is stale: the database built from supabase/migrations differs from it.\n` +
        "Run: node scripts/api-schema-snapshot.mjs --write   (then commit the result)",
    );
    process.exit(1);
  }
  console.log(`${OUT} matches the database`);
}
