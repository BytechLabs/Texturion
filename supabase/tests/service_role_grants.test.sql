-- JobText service_role grant assertion suite (SPEC §6 — Worker data access).
-- The Worker's sb_secret_ key executes as service_role over PostgREST; direct
-- table operations require explicit DML grants because the no-auto-grant
-- default is kept (20260701030000_service_role_grants.sql provides them).
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with: pnpm run db:test:service-role-grants
-- The whole suite runs in one transaction and ROLLS BACK.

\set ON_ERROR_STOP on

begin;

-- ===========================================================================
-- G1. service_role holds SELECT, INSERT, UPDATE and DELETE on every public
--     table (Worker .from() paths: webhook ledgers, membership lookups,
--     crons, routes).
-- ===========================================================================
do $$
declare
  bad text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and not (
      has_table_privilege('service_role', c.oid, 'SELECT')
      and has_table_privilege('service_role', c.oid, 'INSERT')
      and has_table_privilege('service_role', c.oid, 'UPDATE')
      and has_table_privilege('service_role', c.oid, 'DELETE'));
  if bad is not null then
    raise exception 'G1 FAILED: service_role missing DML privilege on: %', bad;
  end if;
  raise notice 'G1 PASSED: service_role has SELECT/INSERT/UPDATE/DELETE on every public table';
end $$;

-- ===========================================================================
-- G2. service_role holds USAGE and SELECT on every public sequence.
-- ===========================================================================
do $$
declare
  bad text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'S'
    and not (
      has_sequence_privilege('service_role', c.oid, 'USAGE')
      and has_sequence_privilege('service_role', c.oid, 'SELECT'));
  if bad is not null then
    raise exception 'G2 FAILED: service_role missing sequence privilege on: %', bad;
  end if;
  raise notice 'G2 PASSED: service_role has USAGE/SELECT on every public sequence';
end $$;

-- ===========================================================================
-- G3. Default privileges: tables/sequences created by postgres in FUTURE
--     migrations are auto-granted to service_role (no silent regressions).
-- ===========================================================================
do $$
declare
  tbl_ok bool;
  seq_ok bool;
begin
  select coalesce(bool_or(
      d.defaclacl::text like '%service_role=arwd%'
      or d.defaclacl::text like '%service_role=arwdDxtm%'), false)
    into tbl_ok
  from pg_default_acl d
  join pg_roles r on r.oid = d.defaclrole
  join pg_namespace n on n.oid = d.defaclnamespace
  where r.rolname = 'postgres' and n.nspname = 'public' and d.defaclobjtype = 'r';

  select coalesce(bool_or(d.defaclacl::text like '%service_role=rw%'), false)
    into seq_ok
  from pg_default_acl d
  join pg_roles r on r.oid = d.defaclrole
  join pg_namespace n on n.oid = d.defaclnamespace
  where r.rolname = 'postgres' and n.nspname = 'public' and d.defaclobjtype = 'S';

  if not tbl_ok then
    raise exception 'G3 FAILED: no default table DML privilege for service_role on postgres-created public tables';
  end if;
  if not seq_ok then
    raise exception 'G3 FAILED: no default sequence privilege for service_role on postgres-created public sequences';
  end if;
  raise notice 'G3 PASSED: default privileges cover future postgres-created tables and sequences';
end $$;

-- ===========================================================================
-- G4. Functional check as service_role: a real INSERT + SELECT + UPDATE +
--     DELETE round-trip on webhook_events (the webhook ledger the Worker
--     writes on every Telnyx/Stripe delivery) succeeds. Rolled back below.
-- ===========================================================================
do $$
declare
  n int;
begin
  execute 'set local role service_role';

  insert into public.webhook_events (provider, event_id, event_type, payload)
  values ('telnyx', 'grant-test-evt-1', 'message.received', '{}'::jsonb);

  select count(*) into n from public.webhook_events
  where provider = 'telnyx' and event_id = 'grant-test-evt-1';
  if n <> 1 then
    raise exception 'G4 FAILED: service_role SELECT did not see its own insert';
  end if;

  update public.webhook_events set event_type = 'message.finalized'
  where provider = 'telnyx' and event_id = 'grant-test-evt-1';

  delete from public.webhook_events
  where provider = 'telnyx' and event_id = 'grant-test-evt-1';

  execute 'reset role';
  raise notice 'G4 PASSED: service_role can INSERT/SELECT/UPDATE/DELETE webhook_events';
end $$;

-- ===========================================================================
-- G5. Posture regression guard: the service_role grants did NOT leak any
--     privilege to anon / authenticated (deny-by-default stays intact).
-- ===========================================================================
do $$
declare
  bad text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and (
      has_table_privilege('anon', c.oid,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_table_privilege('authenticated', c.oid,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'));
  if bad is not null then
    raise exception 'G5 FAILED: anon/authenticated gained privileges on: %', bad;
  end if;
  raise notice 'G5 PASSED: anon/authenticated still have no table grants in public';
end $$;

rollback;
