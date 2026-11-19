#!/usr/bin/env node
/**
 * Public-schema metadata for the API's PostgREST fakes and select checks.
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

const CONTAINER = process.env.LOONEXT_SCHEMA_CONTAINER ?? "supabase_db_Loonext";
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
  'rpc', (
    select coalesce(json_object_agg(f.name, f.signatures order by f.name), '{}'::json)
    from (
      select p.proname as name,
             json_agg((
               select coalesce(json_agg(json_build_object(
                 'name', nullif(p.proargnames[arg.ord], ''),
                 'hasDefault', arg.position > p.pronargs - p.pronargdefaults
               ) order by arg.position), '[]'::json)
               from (
                 select ord, row_number() over (order by ord) as position
                 from generate_series(1, coalesce(cardinality(p.proallargtypes), p.pronargs)) args(ord)
                 where coalesce(p.proargmodes[ord], 'i') in ('i', 'b', 'v')
               ) arg
             ) order by p.oid::regprocedure::text) as signatures
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f'
        and p.prorettype not in ('pg_catalog.trigger'::regtype, 'pg_catalog.event_trigger'::regtype)
      group by p.proname
    ) f
  ),
  'uniqueKeys', (
    select coalesce(json_object_agg(t.name, t.keys order by t.name), '{}'::json)
    from (
      select ix.name, json_agg(ix.columns order by ix.columns::text) as keys
      from (
        select cl.relname as name, (
          select json_agg(a.attname order by a.attname)
          from unnest(i.indkey) with ordinality k(attnum, ord)
          join pg_attribute a on a.attrelid = cl.oid and a.attnum = k.attnum
          where k.ord <= i.indnkeyatts
        ) as columns
        from pg_index i
        join pg_class cl on cl.oid = i.indrelid
        join pg_namespace n on n.oid = cl.relnamespace
        where n.nspname = 'public' and i.indisunique and i.indisvalid and i.indimmediate
          and i.indpred is null and i.indexprs is null
      ) ix
      group by ix.name
    ) t
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
  const rpc = Object.entries(schema.rpc).map(
    ([name, signatures]) => `    ${JSON.stringify(name)}: ${JSON.stringify(signatures)}`,
  );
  const uniqueKeys = Object.entries(schema.uniqueKeys).map(
    ([name, keys]) => `    ${JSON.stringify(name)}: ${JSON.stringify(keys)}`,
  );
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
  "rpc": {
${rpc.join(",\n")}
  },
  "uniqueKeys": {
${uniqueKeys.join(",\n")}
  },
  "defaults": {
${defaults.join(",\n")}
  }
}
`;
}

const { 2: mode } = process.argv;
if (mode !== "--write" && mode !== "--check") {
  console.error("usage: api-schema-snapshot.mjs --write | --check");
  process.exit(2);
}
const next = render();
if (mode === "--write") {
  writeFileSync(OUT, next);
  console.log(`wrote ${OUT}`);
} else {
  const current = readFileSync(OUT, "utf8").replaceAll('\r\n', "\n");
  if (current !== next) {
    console.error(
      `${OUT} is stale: the database built from supabase/migrations differs from it.\n` +
        "Run: node scripts/api-schema-snapshot.mjs --write   (then commit the result)",
    );
    process.exit(1);
  }
  console.log(`${OUT} matches the database`);
}
