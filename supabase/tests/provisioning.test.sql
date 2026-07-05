-- Loonext provisioning RPC assertion suite (telnyx track, SPEC §4.2, §4.3, §7).
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/provisioning.test.sql
-- The whole suite runs in one transaction and ROLLS BACK: it never pollutes
-- the local database.

\set ON_ERROR_STOP on

begin;

-- Seed: one auth user, two companies (starter + pro), a sole-prop brand row
-- on a third company.
insert into auth.users (id, email, raw_user_meta_data)
values ('a0000000-0000-4000-8000-000000000001', 'owner@example.com',
        '{"display_name":"Owner"}'::jsonb);

insert into public.companies (id, name, owner_user_id, country, requested_area_code,
                              plan, subscription_status, aup_accepted_at)
values
  ('c0000000-0000-4000-8000-000000000001', 'Starter Co',
   'a0000000-0000-4000-8000-000000000001', 'US', '212', 'starter', 'active', now()),
  ('c0000000-0000-4000-8000-000000000002', 'Pro Co',
   'a0000000-0000-4000-8000-000000000001', 'US', '415', 'pro', 'active', now()),
  ('c0000000-0000-4000-8000-000000000003', 'SoleProp Co',
   'a0000000-0000-4000-8000-000000000001', 'US', '303', 'pro', 'active', now());

insert into public.messaging_registrations (company_id, kind, status, sole_proprietor, data)
values ('c0000000-0000-4000-8000-000000000003', 'brand', 'submitted', true, '{}'::jsonb);

-- ===========================================================================
-- P1. First claim on an empty company → outcome 'created', row provisioning.
-- ===========================================================================
do $$
declare
  result jsonb;
begin
  result := public.provision_number_slot(
    'c0000000-0000-4000-8000-000000000001', 'key-starter-1', '212', 'US', 1);
  if result->>'outcome' <> 'created' then
    raise exception 'P1 FAILED: expected created, got %', result->>'outcome';
  end if;
  if (result->'number'->>'status') <> 'provisioning' then
    raise exception 'P1 FAILED: expected provisioning row, got %', result->'number'->>'status';
  end if;
  if (result->'number'->>'requested_area_code') <> '212' then
    raise exception 'P1 FAILED: requested_area_code not copied';
  end if;
  raise notice 'P1 PASSED: first claim creates a provisioning row';
end $$;

-- ===========================================================================
-- P2. Same provisioning key again → outcome 'exists', SAME row (idempotency).
-- ===========================================================================
do $$
declare
  first_id uuid;
  result   jsonb;
begin
  select id into first_id from public.phone_numbers where provisioning_key = 'key-starter-1';
  result := public.provision_number_slot(
    'c0000000-0000-4000-8000-000000000001', 'key-starter-1', '212', 'US', 1);
  if result->>'outcome' <> 'exists' then
    raise exception 'P2 FAILED: expected exists, got %', result->>'outcome';
  end if;
  if (result->'number'->>'id')::uuid <> first_id then
    raise exception 'P2 FAILED: replay returned a different row';
  end if;
  if (select count(*) from public.phone_numbers
      where company_id = 'c0000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'P2 FAILED: duplicate key created a second row';
  end if;
  raise notice 'P2 PASSED: idempotency-key replay returns the same row';
end $$;

-- ===========================================================================
-- P3. Starter allowance (1) is full → outcome 'plan_limit', no insert.
-- ===========================================================================
do $$
declare
  result jsonb;
begin
  result := public.provision_number_slot(
    'c0000000-0000-4000-8000-000000000001', 'key-starter-2', '212', 'US', 1);
  if result->>'outcome' <> 'plan_limit' then
    raise exception 'P3 FAILED: expected plan_limit, got %', result->>'outcome';
  end if;
  if (select count(*) from public.phone_numbers
      where company_id = 'c0000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'P3 FAILED: plan_limit still inserted a row';
  end if;
  raise notice 'P3 PASSED: count-vs-plan check blocks the 2nd starter number';
end $$;

-- ===========================================================================
-- P4. A released number frees its slot (count is of NON-released rows).
-- ===========================================================================
do $$
declare
  result jsonb;
begin
  update public.phone_numbers
     set status = 'released', released_at = now()
   where provisioning_key = 'key-starter-1';
  result := public.provision_number_slot(
    'c0000000-0000-4000-8000-000000000001', 'key-starter-3', '212', 'US', 1);
  if result->>'outcome' <> 'created' then
    raise exception 'P4 FAILED: expected created after release, got %', result->>'outcome';
  end if;
  raise notice 'P4 PASSED: released rows do not consume the allowance';
end $$;

-- ===========================================================================
-- P5. Pro allowance (2): second number allowed, third blocked.
-- ===========================================================================
do $$
declare
  result jsonb;
begin
  result := public.provision_number_slot(
    'c0000000-0000-4000-8000-000000000002', 'key-pro-1', '415', 'US', 2);
  if result->>'outcome' <> 'created' then
    raise exception 'P5 FAILED: pro 1st number, got %', result->>'outcome';
  end if;
  result := public.provision_number_slot(
    'c0000000-0000-4000-8000-000000000002', 'key-pro-2', '628', 'US', 2);
  if result->>'outcome' <> 'created' then
    raise exception 'P5 FAILED: pro 2nd number, got %', result->>'outcome';
  end if;
  result := public.provision_number_slot(
    'c0000000-0000-4000-8000-000000000002', 'key-pro-3', '628', 'US', 2);
  if result->>'outcome' <> 'plan_limit' then
    raise exception 'P5 FAILED: pro 3rd number should hit plan_limit, got %', result->>'outcome';
  end if;
  raise notice 'P5 PASSED: pro allowance admits 2, blocks the 3rd';
end $$;

-- ===========================================================================
-- P6. §4.2 sole-prop cap: 1 number regardless of plan allowance.
-- ===========================================================================
do $$
declare
  result jsonb;
begin
  result := public.provision_number_slot(
    'c0000000-0000-4000-8000-000000000003', 'key-sole-1', '303', 'US', 2);
  if result->>'outcome' <> 'created' then
    raise exception 'P6 FAILED: sole-prop 1st number, got %', result->>'outcome';
  end if;
  result := public.provision_number_slot(
    'c0000000-0000-4000-8000-000000000003', 'key-sole-2', '303', 'US', 2);
  if result->>'outcome' <> 'sole_prop_cap' then
    raise exception 'P6 FAILED: expected sole_prop_cap, got %', result->>'outcome';
  end if;
  raise notice 'P6 PASSED: sole-prop brands are capped at 1 number';
end $$;

-- ===========================================================================
-- P7. A provisioning key claimed by another company is rejected loudly.
-- ===========================================================================
do $$
begin
  begin
    perform public.provision_number_slot(
      'c0000000-0000-4000-8000-000000000002', 'key-sole-1', '415', 'US', 2);
    raise exception 'P7 FAILED: cross-company key reuse did not raise';
  exception
    when raise_exception then
      if sqlerrm like 'P7 FAILED%' then raise; end if;
      raise notice 'P7 PASSED: cross-company provisioning-key reuse raises (%)', sqlerrm;
  end;
end $$;

-- ===========================================================================
-- P8. EXECUTE is service-role-only (SPEC §6 RLS posture).
-- ===========================================================================
do $$
begin
  if has_function_privilege('anon',
       'public.provision_number_slot(uuid,text,text,text,int)', 'execute') then
    raise exception 'P8 FAILED: anon can execute provision_number_slot';
  end if;
  if has_function_privilege('authenticated',
       'public.provision_number_slot(uuid,text,text,text,int)', 'execute') then
    raise exception 'P8 FAILED: authenticated can execute provision_number_slot';
  end if;
  if not has_function_privilege('service_role',
       'public.provision_number_slot(uuid,text,text,text,int)', 'execute') then
    raise exception 'P8 FAILED: service_role cannot execute provision_number_slot';
  end if;
  raise notice 'P8 PASSED: execute is service-role-only';
end $$;

rollback;
