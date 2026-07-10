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
       'public.provision_number_slot(uuid,text,text,text,int,text,int)', 'execute') then
    raise exception 'P8 FAILED: anon can execute provision_number_slot';
  end if;
  if has_function_privilege('authenticated',
       'public.provision_number_slot(uuid,text,text,text,int,text,int)', 'execute') then
    raise exception 'P8 FAILED: authenticated can execute provision_number_slot';
  end if;
  if not has_function_privilege('service_role',
       'public.provision_number_slot(uuid,text,text,text,int,text,int)', 'execute') then
    raise exception 'P8 FAILED: service_role cannot execute provision_number_slot';
  end if;
  raise notice 'P8 PASSED: execute is service-role-only';
end $$;

-- ===========================================================================
-- P9. claim_provisioning_lease (§4.3 double-order fail-safe): claims once,
--     BLOCKS while held, re-claims after expiry. The block-while-held case is
--     the whole point — the per-row lock that stops the webhook racing
--     confirm-checkout from placing a second number_order for one paid slot.
-- ===========================================================================
do $$
declare
  v_row_id uuid;
  r jsonb;
begin
  insert into public.phone_numbers (company_id, status, provisioning_key, country)
  values ('c0000000-0000-4000-8000-000000000001', 'provisioning', 'lease-key-1', 'US')
  returning id into v_row_id;

  r := public.claim_provisioning_lease(v_row_id, 180);
  if r is null then raise exception 'P9 FAILED: first claim returned null'; end if;
  if (r->>'id')::uuid <> v_row_id then raise exception 'P9 FAILED: wrong row returned'; end if;

  r := public.claim_provisioning_lease(v_row_id, 180);
  if r is not null then
    raise exception 'P9 FAILED: a held lease was re-claimed (the double-order window)';
  end if;

  update public.phone_numbers set provisioning_lease_until = now() - interval '1 minute'
    where id = v_row_id;
  r := public.claim_provisioning_lease(v_row_id, 180);
  if r is null then raise exception 'P9 FAILED: expired lease not re-claimable'; end if;

  raise notice 'P9 PASSED: lease claims, blocks while held, re-claims after expiry';
end $$;

-- ===========================================================================
-- P10. claim_order_idempotency_key (§4.3 backstop): COALESCE returns ONE stable
--      key across calls (so a replayed order POST collapses to a single Telnyx
--      order), and mints a fresh key once the old one is cleared.
-- ===========================================================================
do $$
declare
  v_row_id uuid;
  k1 text; k2 text;
begin
  insert into public.phone_numbers (company_id, status, provisioning_key, country)
  values ('c0000000-0000-4000-8000-000000000001', 'provisioning', 'idem-key-1', 'US')
  returning id into v_row_id;

  k1 := public.claim_order_idempotency_key(v_row_id);
  k2 := public.claim_order_idempotency_key(v_row_id);
  if k1 is null then raise exception 'P10 FAILED: no key returned'; end if;
  if k1 <> k2 then raise exception 'P10 FAILED: key not stable (% vs %)', k1, k2; end if;

  -- Cleared (the OrderDeadError / taken-fallback path) → a fresh reorder mints
  -- a NEW key rather than replaying a dead/rejected order.
  update public.phone_numbers set telnyx_order_idempotency_key = null where id = v_row_id;
  if public.claim_order_idempotency_key(v_row_id) = k1 then
    raise exception 'P10 FAILED: a cleared key was not regenerated';
  end if;

  raise notice 'P10 PASSED: idempotency key is stable, and regenerated after clear';
end $$;

-- ===========================================================================
-- P11. Both fail-safe RPCs are service-role-only (SPEC §6 RLS posture).
-- ===========================================================================
do $$
begin
  if has_function_privilege('anon', 'public.claim_provisioning_lease(uuid,int)', 'execute')
     or has_function_privilege('authenticated', 'public.claim_provisioning_lease(uuid,int)', 'execute')
     or has_function_privilege('anon', 'public.claim_order_idempotency_key(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.claim_order_idempotency_key(uuid)', 'execute') then
    raise exception 'P11 FAILED: anon/authenticated can execute a fail-safe RPC';
  end if;
  if not has_function_privilege('service_role', 'public.claim_provisioning_lease(uuid,int)', 'execute')
     or not has_function_privilege('service_role', 'public.claim_order_idempotency_key(uuid)', 'execute') then
    raise exception 'P11 FAILED: service_role cannot execute a fail-safe RPC';
  end if;
  raise notice 'P11 PASSED: fail-safe RPCs are service-role-only';
end $$;

-- ===========================================================================
-- P12. Issue #75 (explicit number action): a chosen_number_e164 is persisted
--      onto the new row so the §4.3 saga orders that exact number; a malformed
--      chosen number is rejected loudly before any slot is claimed.
-- ===========================================================================
do $$
declare
  result jsonb;
begin
  -- Free a slot on Pro Co (P5 filled both) so the chosen-number claim can create.
  update public.phone_numbers set status = 'released', released_at = now()
    where provisioning_key = 'key-pro-2';

  result := public.provision_number_slot(
    'c0000000-0000-4000-8000-000000000002', 'key-chosen-1', '415', 'US', 2, '+14155550142');
  if result->>'outcome' <> 'created' then
    raise exception 'P12 FAILED: expected created, got %', result->>'outcome';
  end if;
  if (result->'number'->>'chosen_number_e164') <> '+14155550142' then
    raise exception 'P12 FAILED: chosen_number_e164 not persisted (got %)',
      result->'number'->>'chosen_number_e164';
  end if;

  begin
    perform public.provision_number_slot(
      'c0000000-0000-4000-8000-000000000002', 'key-chosen-2', '415', 'US', 2, '5551234');
    raise exception 'P12 FAILED: a malformed chosen number was accepted';
  exception
    when raise_exception then
      if sqlerrm like 'P12 FAILED%' then raise; end if;
      raise notice 'P12 PASSED: chosen number persisted; malformed rejected (%)', sqlerrm;
  end;
end $$;

-- ===========================================================================
-- P13. Issue #74 churn cap: a lifetime per-company provision counter blocks
--      release->re-provision cycling. At the cap → 'provision_cap' with NO row
--      inserted; under the cap → 'created' and the counter increments.
-- ===========================================================================
do $$
declare
  result   jsonb;
  v_before int;
begin
  -- Open Starter Co's slot so the plan-limit check clears first (the cap check
  -- sits after it), and count is authoritative.
  update public.phone_numbers set status = 'released', released_at = now()
    where company_id = 'c0000000-0000-4000-8000-000000000001' and status <> 'released';

  -- At the cap → provision_cap, no insert, echoes the limit.
  update public.companies set number_provision_count = 3
    where id = 'c0000000-0000-4000-8000-000000000001';
  select count(*) into v_before from public.phone_numbers
    where company_id = 'c0000000-0000-4000-8000-000000000001' and status <> 'released';
  result := public.provision_number_slot(
    'c0000000-0000-4000-8000-000000000001', 'key-cap-1', '212', 'US', 1, null, 3);
  if result->>'outcome' <> 'provision_cap' then
    raise exception 'P13 FAILED: expected provision_cap, got %', result->>'outcome';
  end if;
  if (result->>'limit')::int <> 3 then
    raise exception 'P13 FAILED: cap limit not echoed (got %)', result->>'limit';
  end if;
  if (select count(*) from public.phone_numbers
      where company_id = 'c0000000-0000-4000-8000-000000000001' and status <> 'released')
     <> v_before then
    raise exception 'P13 FAILED: a capped call still inserted a row';
  end if;

  -- Under the cap → created, and the lifetime counter increments.
  update public.companies set number_provision_count = 0
    where id = 'c0000000-0000-4000-8000-000000000001';
  result := public.provision_number_slot(
    'c0000000-0000-4000-8000-000000000001', 'key-cap-2', '212', 'US', 1, null, 3);
  if result->>'outcome' <> 'created' then
    raise exception 'P13 FAILED: expected created under cap, got %', result->>'outcome';
  end if;
  if (select number_provision_count from public.companies
      where id = 'c0000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'P13 FAILED: counter did not increment on created';
  end if;

  raise notice 'P13 PASSED: churn cap blocks at limit (no insert), increments on create';
end $$;

-- ===========================================================================
-- P14 (#110). Paid-extra CAPACITY: companies.paid_extra_numbers raises the
--     effective cap inside the slot claim (max = included + paid, read under
--     the company lock), and the plan_limit outcome reports that max.
-- ===========================================================================
do $$
declare
  result  jsonb;
  v_epoch bigint;
begin
  -- Starter Co currently holds 1 non-released number (P1). Included=1 → full.
  result := public.provision_number_slot(
    'c0000000-0000-4000-8000-000000000001', 'key-p14-a', '212', 'US', 1);
  if result->>'outcome' <> 'plan_limit' or (result->>'max')::int <> 1 then
    raise exception 'P14 FAILED: expected plan_limit max 1, got %', result;
  end if;

  -- Buy capacity: the RAISE carries the epoch read before the conclusion…
  select paid_capacity_epoch into v_epoch from public.companies
   where id = 'c0000000-0000-4000-8000-000000000001';
  result := public.sync_paid_extra_capacity(
    'c0000000-0000-4000-8000-000000000001', 1, v_epoch);
  if not (result->>'applied')::boolean then
    raise exception 'P14 FAILED: fresh-epoch raise was refused: %', result;
  end if;
  -- …and the SAME claim now admits (max = 1 included + 1 paid).
  result := public.provision_number_slot(
    'c0000000-0000-4000-8000-000000000001', 'key-p14-b', '212', 'US', 1);
  if result->>'outcome' <> 'created' then
    raise exception 'P14 FAILED: paid capacity did not admit, got %', result->>'outcome';
  end if;

  raise notice 'P14 PASSED: paid_extra_numbers raises the slot cap; plan_limit reports max';
end $$;

-- ===========================================================================
-- P15 (#110). claim_extra_lower: shrinks capacity ONLY above the formula,
--     re-counting under the lock — the serialized credit decision. This is
--     the race replay: once the lower is claimed, an admit sees the shrunk
--     capacity and 409s instead of slipping into the credited slot.
-- ===========================================================================
do $$
declare
  result jsonb;
begin
  -- State from P14: Starter Co holds 2 non-released numbers, paid capacity 1.
  -- Formula: desired = max(0, 2 - 1) = 1 = current capacity → nothing to shrink
  -- (but the epoch still bumps — a credit may follow any claim).
  result := public.claim_extra_lower('c0000000-0000-4000-8000-000000000001', 1);
  if (result->>'allowed')::boolean or (result->>'desired')::int <> 1
     or (result->>'epoch') is null then
    raise exception 'P15 FAILED: expected allowed=false desired=1 with epoch, got %', result;
  end if;

  -- Release one number → count 1 → desired 0 → the claim shrinks capacity.
  update public.phone_numbers set status = 'released'
   where provisioning_key = 'key-p14-b';
  result := public.claim_extra_lower('c0000000-0000-4000-8000-000000000001', 1);
  if not (result->>'allowed')::boolean or (result->>'desired')::int <> 0 then
    raise exception 'P15 FAILED: expected allowed=true desired=0, got %', result;
  end if;
  if (select paid_extra_numbers from public.companies
      where id = 'c0000000-0000-4000-8000-000000000001') <> 0 then
    raise exception 'P15 FAILED: capacity column not shrunk';
  end if;

  -- THE RACE, replayed: with the credit claimed, the admit that would have
  -- slipped into the paid slot now sees max = 1 + 0 and 409s. Never a free
  -- number.
  result := public.provision_number_slot(
    'c0000000-0000-4000-8000-000000000001', 'key-p15-c', '212', 'US', 1);
  if result->>'outcome' <> 'plan_limit' or (result->>'max')::int <> 1 then
    raise exception 'P15 FAILED: post-claim admit not blocked, got %', result;
  end if;

  raise notice 'P15 PASSED: claim_extra_lower serializes the credit; post-claim admits fail closed';
end $$;

-- ===========================================================================
-- P16 (#110). The RAISE FENCE: a capacity raise formed BEFORE a claim (a buy
--     or reconcile sync holding a stale billed conclusion) is refused — the
--     epoch the claim bumped no longer matches. Raises need a fresh epoch;
--     lowers always apply; a raise with NO epoch is never accepted.
-- ===========================================================================
do $$
declare
  result  jsonb;
  v_stale bigint;
begin
  -- Read the epoch (as a buy would), THEN a claim intervenes (bumps it).
  select paid_capacity_epoch into v_stale from public.companies
   where id = 'c0000000-0000-4000-8000-000000000001';
  perform public.claim_extra_lower('c0000000-0000-4000-8000-000000000001', 1);

  -- The stale raise is refused…
  result := public.sync_paid_extra_capacity(
    'c0000000-0000-4000-8000-000000000001', 3, v_stale);
  if (result->>'applied')::boolean then
    raise exception 'P16 FAILED: stale-epoch raise was applied: %', result;
  end if;
  -- …an epoch-less raise is refused…
  result := public.sync_paid_extra_capacity(
    'c0000000-0000-4000-8000-000000000001', 3, null);
  if (result->>'applied')::boolean then
    raise exception 'P16 FAILED: epoch-less raise was applied: %', result;
  end if;
  -- …a LOWER always applies (down-safe, no epoch needed)…
  result := public.sync_paid_extra_capacity(
    'c0000000-0000-4000-8000-000000000001', 0, null);
  if not (result->>'applied')::boolean then
    raise exception 'P16 FAILED: lower was refused: %', result;
  end if;
  -- …and a raise with the FRESH epoch applies.
  result := public.sync_paid_extra_capacity(
    'c0000000-0000-4000-8000-000000000001', 2, (result->>'epoch')::bigint);
  if not (result->>'applied')::boolean
     or (select paid_extra_numbers from public.companies
         where id = 'c0000000-0000-4000-8000-000000000001') <> 2 then
    raise exception 'P16 FAILED: fresh-epoch raise refused: %', result;
  end if;

  raise notice 'P16 PASSED: raises are epoch-fenced; lowers always apply';
end $$;

rollback;
