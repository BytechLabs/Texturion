-- [#231] audit_log assertion suite — the append-only guarantee, retention, and
-- the history-screen read path (supabase/migrations/20260726000200_audit_log.sql).
--
-- The point of this table is that it cannot be edited. An audit log a customer
-- (or an attacker holding their session) can rewrite reads as evidence while
-- being anything but, so the guarantee lives in the DATABASE and is asserted
-- here rather than in application code.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/audit_log.test.sql
--
-- The whole suite runs in one transaction and ROLLS BACK. Self-contained
-- fixtures with a distinct 'a1' id prefix so the file runs standalone OR after
-- the other suites in one psql session.
--   owner     = a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1
--   company A = a1a1a1a1-a1a1-4a1a-8a1a-a1a100000001
--   company B = a1a1a1a1-a1a1-4a1a-8a1a-a1a100000002  (isolation control)

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1','audit-owner@test.local');

insert into public.companies (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('a1a1a1a1-a1a1-4a1a-8a1a-a1a100000001','Audit Co A',
   'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1','US','415', now()),
  ('a1a1a1a1-a1a1-4a1a-8a1a-a1a100000002','Audit Co B',
   'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1','US','415', now());

-- ---------------------------------------------------------------------------
-- AL-1. Security posture, matching every other api_*/claim_* function:
--       SECURITY DEFINER, empty search_path, EXECUTE denied to end-user roles
--       and granted to service_role only.
-- ---------------------------------------------------------------------------
do $$
declare
  fn_name text; fn regprocedure; is_secdef boolean; cfg text[];
begin
  foreach fn_name in array array[
    'api_list_audit_log', 'api_prune_audit_log', 'audit_log_is_append_only'
  ] loop
    select p.oid::regprocedure, p.prosecdef, p.proconfig
      into fn, is_secdef, cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname=fn_name;
    if fn is null then raise exception 'AL-1 FAILED: public.% missing', fn_name; end if;
    if is_secdef is distinct from true then raise exception 'AL-1 FAILED: % must be SECURITY DEFINER', fn_name; end if;
    if cfg is null or not ('search_path=' = any(cfg) or 'search_path=""' = any(cfg)) then
      raise exception 'AL-1 FAILED: % must pin an empty search_path (got %)', fn_name, cfg;
    end if;
    if has_function_privilege('anon', fn, 'execute')
       or has_function_privilege('authenticated', fn, 'execute') then
      raise exception 'AL-1 FAILED: anon/authenticated must not EXECUTE %', fn_name;
    end if;
  end loop;
  raise notice 'AL-1 PASSED: audit_log function security posture';
end $$;

-- ---------------------------------------------------------------------------
-- AL-2. APPEND-ONLY, enforced by the database for EVERY role. This is the
--       whole guarantee: a log that the application merely promises not to
--       edit is not evidence of anything.
-- ---------------------------------------------------------------------------
do $$
declare
  v_company uuid := 'a1a1a1a1-a1a1-4a1a-8a1a-a1a100000001';
  v_actor   uuid := 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
  v_updated boolean := false;
  v_deleted boolean := false;
begin
  insert into public.audit_log (company_id, actor_user_id, action, target_type, target_id, after)
  values (v_company, v_actor, 'member.deactivated', 'member', 'm-1', '{"active":false}');

  begin
    update public.audit_log set action = 'nothing.happened' where company_id = v_company;
    v_updated := true;   -- reached only if the trigger let it through
  exception when others then
    null;
  end;
  if v_updated is distinct from false then raise exception 'AL-2 FAILED: audit_log accepted an UPDATE'; end if;

  begin
    delete from public.audit_log where company_id = v_company;
    v_deleted := true;
  exception when others then
    null;
  end;
  if v_deleted is distinct from false then raise exception 'AL-2 FAILED: audit_log accepted a DELETE'; end if;

  -- The row is untouched, which is the only acceptable outcome.
  if not exists (
    select 1 from public.audit_log
     where company_id = v_company and action = 'member.deactivated'
  ) then
    raise exception 'AL-2 FAILED: the original row did not survive';
  end if;

  raise notice 'AL-2 PASSED: audit_log refuses UPDATE and DELETE';
end $$;

-- ---------------------------------------------------------------------------
-- AL-3. Retention is the ONE exception, and it can only reach past the window.
--       An unbounded log is an unbounded bill; a retention job that could
--       delete anything else would undo AL-2.
-- ---------------------------------------------------------------------------
do $$
declare
  v_company uuid := 'a1a1a1a1-a1a1-4a1a-8a1a-a1a100000001';
  v_pruned int;
begin
  insert into public.audit_log (company_id, action, target_type, occurred_at)
  values (v_company, 'settings.changed', 'company', now() - interval '400 days');

  -- Inside the window: nothing goes.
  v_pruned := public.api_prune_audit_log(now() - interval '365 days', 100);
  if v_pruned is distinct from 1 then
    raise exception 'AL-3 FAILED: pruned % rows past the window (want 1)', v_pruned;
  end if;
  -- The recent row from AL-2 is still there.
  if not exists (select 1 from public.audit_log where company_id = v_company) then
    raise exception 'AL-3 FAILED: retention removed a row inside the window';
  end if;

  -- And the relaxation does not leak past the function: a plain DELETE in the
  -- same transaction still raises.
  begin
    delete from public.audit_log where company_id = v_company;
    raise exception 'AL-3 FAILED: DELETE worked after a prune ran';
  exception when restrict_violation then
    null;
  end;

  raise notice 'AL-3 PASSED: retention prunes past the window and nothing else';
end $$;

-- ---------------------------------------------------------------------------
-- AL-4. api_list_audit_log: tenant-scoped, newest-first, filterable, and
--       keyset-paginated. A filter that silently does nothing is worse than an
--       error — the reader believes they looked and found nothing.
-- ---------------------------------------------------------------------------
insert into public.companies (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values ('a1a1a1a1-a1a1-4a1a-8a1a-a1a100000003','Audit Co C',
        'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1','US','415', now());

do $$
declare
  -- A company of its own, so the rows above cannot shift the ordering here.
  v_c uuid := 'a1a1a1a1-a1a1-4a1a-8a1a-a1a100000003';
  v_b uuid := 'a1a1a1a1-a1a1-4a1a-8a1a-a1a100000002';
  v_actor uuid := 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
  v_count int; v_first text; v_ts timestamptz; v_id uuid;
begin
  insert into public.audit_log (company_id, actor_user_id, action, target_type, occurred_at) values
    (v_c, v_actor, 'number_access.changed', 'phone_number', now() - interval '3 hours'),
    (v_c, null,     'billing.plan_changed', 'company',      now() - interval '2 hours'),
    (v_c, v_actor, 'contacts.exported',     'company',      now() - interval '1 hour'),
    (v_b, v_actor, 'member.invited',        'invite',       now() - interval '1 hour');

  -- Newest first, and another tenant's row is never visible from here.
  select count(*) into v_count from public.api_list_audit_log(v_c, 100);
  if v_count is distinct from 3 then
    raise exception 'AL-4 FAILED: C sees % rows (want 3)', v_count;
  end if;
  if exists (
    select 1 from public.api_list_audit_log(v_c, 100) where action = 'member.invited'
  ) then
    raise exception 'AL-4 FAILED: another company''s row leaked in';
  end if;

  select action into v_first from public.api_list_audit_log(v_c, 1);
  if v_first is distinct from 'contacts.exported' then
    raise exception 'AL-4 FAILED: newest-first broken (got %)', v_first;
  end if;

  -- Filters actually narrow.
  select count(*) into v_count
    from public.api_list_audit_log(v_c, 100, p_action => 'billing.plan_changed');
  if v_count is distinct from 1 then
    raise exception 'AL-4 FAILED: action filter returned % rows', v_count;
  end if;
  select count(*) into v_count
    from public.api_list_audit_log(v_c, 100, p_actor => v_actor);
  if v_count is distinct from 2 then
    raise exception 'AL-4 FAILED: actor filter returned % rows (want 2)', v_count;
  end if;
  -- A system row (null actor) is NOT attributed to a person by the filter.
  if exists (
    select 1 from public.api_list_audit_log(v_c, 100, p_actor => v_actor)
     where action = 'billing.plan_changed'
  ) then
    raise exception 'AL-4 FAILED: a system row matched an actor filter';
  end if;
  select count(*) into v_count
    from public.api_list_audit_log(v_c, 100, p_since => now() - interval '90 minutes');
  if v_count is distinct from 1 then
    raise exception 'AL-4 FAILED: since filter returned % rows', v_count;
  end if;

  -- Keyset paging: the second page starts strictly after the first row.
  select occurred_at, id into v_ts, v_id from public.api_list_audit_log(v_c, 1);
  select action into v_first
    from public.api_list_audit_log(v_c, 1, p_cursor_ts => v_ts, p_cursor_id => v_id);
  if v_first is distinct from 'billing.plan_changed' then
    raise exception 'AL-4 FAILED: keyset page 2 started at % (want billing.plan_changed)', v_first;
  end if;

  raise notice 'AL-4 PASSED: audit_log read path scopes, filters and pages';
end $$;

rollback;
