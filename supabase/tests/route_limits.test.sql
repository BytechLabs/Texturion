-- Loonext route-abuse-cap assertion suite (launch-audit #31/#38 — migration
-- 20260707160000_route_abuse_caps.sql).
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/route_limits.test.sql
-- The whole suite runs in one transaction and ROLLS BACK: it never pollutes
-- the local database.

\set ON_ERROR_STOP on

begin;

-- Seed: one user — the auth trigger syncs profiles.
insert into auth.users (id, email, raw_user_meta_data)
values ('31313131-3131-4131-8131-313131313131', 'owner@routelimits.test',
        '{"display_name":"Cap Owner"}'::jsonb);

-- ===========================================================================
-- RL1. api_create_company #31 owner cap: the 5th create succeeds, the 6th
--      returns { outcome: owner_cap } and writes NOTHING.
-- ===========================================================================
do $$
declare
  result jsonb;
  i int;
  n int;
begin
  for i in 1..5 loop
    result := public.api_create_company(
      '31313131-3131-4131-8131-313131313131',
      'Cap Co ' || i, 'US', '212', true);
    if (result->>'id') is null then
      raise exception 'RL1 FAILED: create % under the cap was refused: %',
        i, result;
    end if;
  end loop;

  result := public.api_create_company(
    '31313131-3131-4131-8131-313131313131', 'Cap Co 6', 'US', '212', true);
  if result->>'outcome' <> 'owner_cap' or (result->>'limit')::int <> 5 then
    raise exception 'RL1 FAILED: 6th create should be owner_cap, got %', result;
  end if;

  select count(*) into n from public.companies
   where owner_user_id = '31313131-3131-4131-8131-313131313131';
  if n <> 5 then
    raise exception 'RL1 FAILED: expected 5 companies after the cap, got %', n;
  end if;

  raise notice 'RL1 PASSED: api_create_company caps at 5 owned companies';
end $$;

-- ===========================================================================
-- RL2. Soft-deleted companies do not count toward the cap: after deleting
--      one of the 5, a new create succeeds again.
-- ===========================================================================
do $$
declare
  result jsonb;
begin
  update public.companies set deleted_at = now()
   where id = (select id from public.companies
                where owner_user_id = '31313131-3131-4131-8131-313131313131'
                  and deleted_at is null
                limit 1);

  result := public.api_create_company(
    '31313131-3131-4131-8131-313131313131', 'Cap Co Replacement',
    'US', '212', true);
  if (result->>'id') is null then
    raise exception 'RL2 FAILED: create after a soft delete refused: %', result;
  end if;

  raise notice 'RL2 PASSED: soft-deleted companies free an owner-cap slot';
end $$;

-- ===========================================================================
-- RL3. bump_registration_otp_counter #38: increments the brand row up to the
--      cap, then denies; a mismatched company or a campaign row never spends.
-- ===========================================================================
do $$
declare
  cid    uuid;
  other  uuid;
  bid    uuid;
  cmpgn  uuid;
  result jsonb;
  i int;
begin
  select id into cid from public.companies
   where owner_user_id = '31313131-3131-4131-8131-313131313131'
     and deleted_at is null
   limit 1;
  select id into other from public.companies
   where owner_user_id = '31313131-3131-4131-8131-313131313131'
     and deleted_at is null
     and id <> cid
   limit 1;

  insert into public.messaging_registrations
    (company_id, kind, status, sole_proprietor, data)
  values (cid, 'brand', 'submitted', true, '{}'::jsonb)
  returning id into bid;
  insert into public.messaging_registrations
    (company_id, kind, status, sole_proprietor, data)
  values (cid, 'campaign', 'submitted', true, '{}'::jsonb)
  returning id into cmpgn;

  -- Spend the whole budget (cap 3 for the test).
  for i in 1..3 loop
    result := public.bump_registration_otp_counter(bid, cid, 3);
    if (result->>'allowed')::boolean is distinct from true
       or (result->>'count')::int <> i then
      raise exception 'RL3 FAILED: spend % should be allowed with count %, got %',
        i, i, result;
    end if;
  end loop;

  -- Exhausted: denied, counter unchanged.
  result := public.bump_registration_otp_counter(bid, cid, 3);
  if (result->>'allowed')::boolean is distinct from false then
    raise exception 'RL3 FAILED: spend past the cap allowed: %', result;
  end if;
  if (select otp_resend_count from public.messaging_registrations
       where id = bid) <> 3 then
    raise exception 'RL3 FAILED: counter moved past the cap';
  end if;

  -- Wrong company: denied (company scoping backstop), nothing spent.
  result := public.bump_registration_otp_counter(bid, other, 10);
  if (result->>'allowed')::boolean is distinct from false then
    raise exception 'RL3 FAILED: cross-company spend allowed: %', result;
  end if;

  -- A campaign row is never a valid OTP target.
  result := public.bump_registration_otp_counter(cmpgn, cid, 10);
  if (result->>'allowed')::boolean is distinct from false then
    raise exception 'RL3 FAILED: campaign-row spend allowed: %', result;
  end if;

  raise notice 'RL3 PASSED: bump_registration_otp_counter caps the brand OTP budget';
end $$;

-- ===========================================================================
-- RL4. p_cap validation: a non-positive cap is a hard error (fail closed).
-- ===========================================================================
do $$
declare
  bid uuid;
begin
  select id into bid from public.messaging_registrations
   where kind = 'brand' limit 1;
  begin
    perform public.bump_registration_otp_counter(bid, gen_random_uuid(), 0);
    raise exception 'RL4 FAILED: p_cap=0 accepted';
  exception
    when raise_exception then
      if sqlerrm like 'RL4 FAILED%' then raise; end if;
      raise notice 'RL4 PASSED: p_cap must be >= 1';
  end;
end $$;

rollback;

select 'ALL ROUTE-LIMIT TESTS PASSED' as result;
