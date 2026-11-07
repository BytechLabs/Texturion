-- No SECURITY DEFINER function in public is executable by anon or
-- authenticated, the roles PostgREST gives a browser, except
-- is_company_topic_member, which the realtime topic policies call as the
-- signed-in user. Keep that exception in sync with F7 in
-- supabase/tests/api_functions.test.sql.
--
-- Hosted Supabase's default privileges grant EXECUTE on every function postgres
-- creates in public to anon and authenticated by name, not through PUBLIC. So
-- `revoke ... from public` leaves both roles able to call it, and a drop and
-- create gets the grants back. That is how api_lead_source_report, which
-- returns any workspace's lead sources for a company id it is handed, became
-- callable with the browser key. The Supabase CLI that CI pins creates no such
-- default, so the SQL suite passed while production was exposed.
--
-- Setting the schema defaults here makes every database the same: a new
-- function carries only Postgres's own EXECUTE for PUBLIC (plus service_role),
-- which the usual `revoke ... from public` removes, so F7 fails in CI on any
-- function a browser role can still execute.
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;
alter default privileges for role postgres in schema public
  grant execute on functions to service_role;

-- Trigger functions are included: a trigger fires whatever the inserting role
-- may execute, and calling one directly is refused anyway.
do $$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prosecdef
      and p.proowner = 'postgres'::regrole
      and p.proname <> 'is_company_topic_member'
      and not exists (
        select 1 from pg_catalog.pg_depend d
        where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
      )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
  end loop;
end $$;
