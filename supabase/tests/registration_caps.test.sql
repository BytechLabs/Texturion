-- Loonext 10DLC registration lifetime-cap suite (#40 / 20260707170000).
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/registration_caps.test.sql
--
-- The whole suite runs in one transaction and ROLLS BACK: it never pollutes
-- the local database. Self-contained fixtures with a distinct 'c7' / 'd7' id
-- prefix so the file runs standalone OR after the other suites in one psql
-- session without id collisions.
--   owner    = c7c7c7c7-c7c7-4c7c-8c7c-c7c7c7c7c7c7
--   company  = d7d7d7d7-d7d7-4d7d-8d7d-d7d7d7d7d7d7
--   rival co = d7d7d7d7-d7d7-4d7d-8d7d-d7d000000099
--   campaign = d7d7d7d7-d7d7-4d7d-8d7d-d7d000000001

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, raw_user_meta_data)
values ('c7c7c7c7-c7c7-4c7c-8c7c-c7c7c7c7c7c7', 'owner@regcaps.test',
        '{"display_name":"Reg Caps Owner"}'::jsonb);

insert into public.companies (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('d7d7d7d7-d7d7-4d7d-8d7d-d7d7d7d7d7d7', 'Reg Caps Plumbing',
   'c7c7c7c7-c7c7-4c7c-8c7c-c7c7c7c7c7c7', 'US', '212', now()),
  ('d7d7d7d7-d7d7-4d7d-8d7d-d7d000000099', 'Reg Caps Rival',
   'c7c7c7c7-c7c7-4c7c-8c7c-c7c7c7c7c7c7', 'US', '303', now());

insert into public.messaging_registrations (id, company_id, kind, status, data)
values ('d7d7d7d7-d7d7-4d7d-8d7d-d7d000000001',
        'd7d7d7d7-d7d7-4d7d-8d7d-d7d7d7d7d7d7', 'campaign', 'rejected', '{}'::jsonb);

-- ===========================================================================
-- RC1. #40 substrate (20260707170000): messaging_registrations gains
--      reactivation_count (int NOT NULL default 0), and
--      bump_registration_counter exists as a service-role-only RPC (never
--      executable by public/anon/authenticated), like the other claim_* RPCs.
-- ===========================================================================
do $$
declare c_type text; c_null boolean; c_default text; leaked text;
begin
  select data_type, is_nullable='YES', column_default into c_type, c_null, c_default
  from information_schema.columns
  where table_schema='public' and table_name='messaging_registrations'
    and column_name='reactivation_count';
  if c_type is null then raise exception 'RC1 FAILED: messaging_registrations.reactivation_count missing'; end if;
  if c_type <> 'integer' then raise exception 'RC1 FAILED: reactivation_count is % (want integer)', c_type; end if;
  if c_null then raise exception 'RC1 FAILED: reactivation_count must be NOT NULL'; end if;
  if c_default <> '0' then raise exception 'RC1 FAILED: reactivation_count default is % (want 0)', c_default; end if;

  perform 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='bump_registration_counter';
  if not found then raise exception 'RC1 FAILED: bump_registration_counter missing'; end if;

  select string_agg(distinct r.rolname, ',') into leaked
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  cross join lateral aclexplode(p.proacl) a
  join pg_roles r on r.oid=a.grantee
  where n.nspname='public' and p.proname='bump_registration_counter'
    and a.privilege_type='EXECUTE'
    and r.rolname in ('public','anon','authenticated');
  if leaked is not null then
    raise exception 'RC1 FAILED: bump_registration_counter leaked EXECUTE to %', leaked;
  end if;

  raise notice 'RC1 PASSED: reactivation_count column + service-role-only bump RPC present';
end $$;

-- ===========================================================================
-- RC2. bump_registration_counter — the atomic guarded increment: counts up to
--      the cap, returns allowed=false AT the cap WITHOUT incrementing, keeps
--      the two budgets independent (a reactivation never drains the review
--      budget or vice versa), refuses a mismatched (row, company) pair, and
--      raises on an unknown counter (never a silent no-op).
-- ===========================================================================
do $$
declare res jsonb; sc int; rc int; ok boolean := false;
begin
  -- Two units of a cap-2 review budget count 1, 2 …
  res := public.bump_registration_counter(
    'd7d7d7d7-d7d7-4d7d-8d7d-d7d000000001',
    'd7d7d7d7-d7d7-4d7d-8d7d-d7d7d7d7d7d7', 'submission_count', 2);
  if (res->>'allowed')::boolean is not true or (res->>'count')::int <> 1 then
    raise exception 'RC2 FAILED: first bump expected allowed/count=1, got %', res;
  end if;
  res := public.bump_registration_counter(
    'd7d7d7d7-d7d7-4d7d-8d7d-d7d000000001',
    'd7d7d7d7-d7d7-4d7d-8d7d-d7d7d7d7d7d7', 'submission_count', 2);
  if (res->>'allowed')::boolean is not true or (res->>'count')::int <> 2 then
    raise exception 'RC2 FAILED: second bump expected allowed/count=2, got %', res;
  end if;
  -- … and the third is refused, leaving the counter AT the cap.
  res := public.bump_registration_counter(
    'd7d7d7d7-d7d7-4d7d-8d7d-d7d000000001',
    'd7d7d7d7-d7d7-4d7d-8d7d-d7d7d7d7d7d7', 'submission_count', 2);
  if (res->>'allowed')::boolean is not false then
    raise exception 'RC2 FAILED: capped bump expected allowed=false, got %', res;
  end if;
  select submission_count, reactivation_count into sc, rc
    from public.messaging_registrations
   where id = 'd7d7d7d7-d7d7-4d7d-8d7d-d7d000000001';
  if sc <> 2 then raise exception 'RC2 FAILED: capped bump incremented past the cap (%)', sc; end if;
  if rc <> 0 then raise exception 'RC2 FAILED: review bumps leaked into reactivation_count (%)', rc; end if;

  -- reactivation_count is its own budget (#40: the post-grace path must not
  -- drain — nor be drained by — the review budget).
  res := public.bump_registration_counter(
    'd7d7d7d7-d7d7-4d7d-8d7d-d7d000000001',
    'd7d7d7d7-d7d7-4d7d-8d7d-d7d7d7d7d7d7', 'reactivation_count', 4);
  if (res->>'allowed')::boolean is not true or (res->>'count')::int <> 1 then
    raise exception 'RC2 FAILED: reactivation bump expected allowed/count=1, got %', res;
  end if;
  select submission_count into sc from public.messaging_registrations
   where id = 'd7d7d7d7-d7d7-4d7d-8d7d-d7d000000001';
  if sc <> 2 then raise exception 'RC2 FAILED: reactivation bump leaked into submission_count (%)', sc; end if;

  -- A mismatched company never increments — backstop for a caller that
  -- skipped the company-scoped load.
  res := public.bump_registration_counter(
    'd7d7d7d7-d7d7-4d7d-8d7d-d7d000000001',
    'd7d7d7d7-d7d7-4d7d-8d7d-d7d000000099', 'submission_count', 100);
  if (res->>'allowed')::boolean is not false then
    raise exception 'RC2 FAILED: cross-company bump expected allowed=false, got %', res;
  end if;
  select submission_count into sc from public.messaging_registrations
   where id = 'd7d7d7d7-d7d7-4d7d-8d7d-d7d000000001';
  if sc <> 2 then raise exception 'RC2 FAILED: cross-company bump incremented (%)', sc; end if;

  -- An unknown counter raises (never a silent no-op)…
  begin
    res := public.bump_registration_counter(
      'd7d7d7d7-d7d7-4d7d-8d7d-d7d000000001',
      'd7d7d7d7-d7d7-4d7d-8d7d-d7d7d7d7d7d7', 'otp_nudged_at', 10);
    raise exception 'RC2 FAILED: unknown counter was accepted';
  exception when others then
    if sqlerrm not like '%unknown counter%' then raise; end if;
    ok := true;
  end;
  if not ok then raise exception 'RC2 FAILED: expected unknown-counter to raise'; end if;

  -- … and so does a nonsensical cap.
  ok := false;
  begin
    res := public.bump_registration_counter(
      'd7d7d7d7-d7d7-4d7d-8d7d-d7d000000001',
      'd7d7d7d7-d7d7-4d7d-8d7d-d7d7d7d7d7d7', 'submission_count', 0);
    raise exception 'RC2 FAILED: cap 0 was accepted';
  exception when others then
    if sqlerrm not like '%p_cap must be >= 1%' then raise; end if;
    ok := true;
  end;
  if not ok then raise exception 'RC2 FAILED: expected cap<1 to raise'; end if;

  raise notice 'RC2 PASSED: bump_registration_counter increments atomically, stops at the cap, keeps budgets independent';
end $$;

rollback;
