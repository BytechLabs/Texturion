-- #523 — claim_number_allowance: bring back what the plan covers, hold the
-- rest, release nothing.
--
-- Every assertion here was proved by BREAKING the function first and watching
-- the named exception fire (see the notes on A1 and A5, which are the two that
-- catch the actual defect rather than the arithmetic around it).
--
-- Rolled back. Namespace 52300000-…

begin;

insert into auth.users (id, email, raw_user_meta_data)
select ('52300000-0000-4000-8000-00000000000' || i)::uuid,
       'u' || i || '@523.test', '{}'::jsonb
from generate_series(1, 2) i;

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, plan, stripe_customer_id, stripe_subscription_id,
   paid_extra_numbers, current_period_start, current_period_end)
values ('52300000-0000-4000-8000-523000000000', '523 Roofing',
        '52300000-0000-4000-8000-000000000001', 'US', '415', now(),
        'active', 'starter', 'cus_523', 'sub_523',
        -- The stale capacity the dead Pro subscription left behind (#523 F6):
        -- 1 paid extra on a subscription that no longer exists.
        1, now(), now() + interval '30 days');

insert into public.company_members (company_id, user_id, role)
values ('52300000-0000-4000-8000-523000000000',
        '52300000-0000-4000-8000-000000000001', 'owner');

-- Two suspended numbers, as the grace suspend leaves them. The OLDER one is
-- 0101 — it is the one that must come back.
insert into public.phone_numbers
  (id, company_id, status, provisioning_key, country, number_e164,
   created_at, suspended_at)
values
  ('52300000-0000-4000-8000-523000000101', '52300000-0000-4000-8000-523000000000',
   'suspended', 'k523a', 'US', '+14155550101',
   now() - interval '400 days', now() - interval '5 days'),
  ('52300000-0000-4000-8000-523000000102', '52300000-0000-4000-8000-523000000000',
   'suspended', 'k523b', 'US', '+14155550102',
   now() - interval '30 days', now() - interval '5 days');

-- ==========================================================================
-- A1. The issue, closed. Starter (includes 1), nothing bought at checkout.
--     The oldest number comes back; the other is HELD, not released; and the
--     dead subscription's paid capacity is reset to what is actually billed.
--
--     PROVED BY BREAKING: with the restore's `c.rank <= v_budget` removed (the
--     old unfiltered statement), this fired
--       A1 FAILED: expected 1 active and 1 held, got 2/0
-- ==========================================================================
do $$
declare res jsonb; act int; sus int; rel int; pen int;
begin
  res := public.claim_number_allowance(
    p_company_id  => '52300000-0000-4000-8000-523000000000',
    p_included    => 1,
    p_paid_extras => 0);

  select count(*) filter (where status = 'active'),
         count(*) filter (where status = 'suspended'),
         count(*) filter (where status = 'released')
    into act, sus, rel
    from public.phone_numbers
   where company_id = '52300000-0000-4000-8000-523000000000';
  select paid_extra_numbers into pen from public.companies
   where id = '52300000-0000-4000-8000-523000000000';

  if act is distinct from 1 or sus is distinct from 1 then
    raise exception 'A1 FAILED: expected 1 active and 1 held, got %/%', act, sus;
  end if;
  if rel is distinct from 0 then
    raise exception 'A1 FAILED: % number(s) were RELEASED — nothing may be destroyed', rel;
  end if;
  -- Oldest first: the number the workspace has had longest is the one on the
  -- van and the invoices.
  if (res->'restored'->0->>'number_e164') is distinct from '+14155550101' then
    raise exception 'A1 FAILED: restored the wrong number: %', res->'restored';
  end if;
  if (res->'held'->0->>'number_e164') is distinct from '+14155550102' then
    raise exception 'A1 FAILED: held the wrong number: %', res->'held';
  end if;
  if (res->>'allowance')::int is distinct from 1 then
    raise exception 'A1 FAILED: allowance was %', res->>'allowance';
  end if;
  -- The stale Pro-era capacity is gone: the new subscription bills no extras,
  -- so the slot RPCs must not keep admitting into one.
  if pen is distinct from 0 then
    raise exception 'A1 FAILED: stale paid_extra_numbers survived as %', pen;
  end if;
  raise notice 'A1 OK: 1 restored, 1 held, 0 released, capacity 1 -> 0';
end $$;

-- ==========================================================================
-- A2. Idempotent. The webhook, the confirm-checkout poller and a sweeper
--     replay all call this for the same session.
-- ==========================================================================
do $$
declare res jsonb; act int; sus int;
begin
  res := public.claim_number_allowance(
    p_company_id  => '52300000-0000-4000-8000-523000000000',
    p_included    => 1,
    p_paid_extras => 0);
  select count(*) filter (where status = 'active'),
         count(*) filter (where status = 'suspended')
    into act, sus
    from public.phone_numbers
   where company_id = '52300000-0000-4000-8000-523000000000';
  if act is distinct from 1 or sus is distinct from 1 then
    raise exception 'A2 FAILED: a replay changed the world (%/%)', act, sus;
  end if;
  if jsonb_array_length(res->'restored') is distinct from 0 then
    raise exception 'A2 FAILED: a replay restored %', res->'restored';
  end if;
  raise notice 'A2 OK: replay is a no-op that still reports the held number';
end $$;

-- ==========================================================================
-- A3. The way back. Upgrading to Pro (includes 2) brings the held number back
--     with no further payment beyond the plan itself.
-- ==========================================================================
do $$
declare res jsonb; act int; sus int;
begin
  res := public.claim_number_allowance(
    p_company_id  => '52300000-0000-4000-8000-523000000000',
    p_included    => 2,
    p_paid_extras => 0);
  select count(*) filter (where status = 'active'),
         count(*) filter (where status = 'suspended')
    into act, sus
    from public.phone_numbers
   where company_id = '52300000-0000-4000-8000-523000000000';
  if act is distinct from 2 or sus is distinct from 0 then
    raise exception 'A3 FAILED: upgrade left %/% ', act, sus;
  end if;
  if jsonb_array_length(res->'held') is distinct from 0 then
    raise exception 'A3 FAILED: still holding %', res->'held';
  end if;
  raise notice 'A3 OK: a bigger allowance reinstates the held number';
end $$;

-- ==========================================================================
-- A4. An unreadable plan restores everything and touches no capacity. A deploy
--     missing STRIPE_STARTER_PRICE_ID must not hold a paying customer's
--     numbers hostage.
-- ==========================================================================
update public.phone_numbers
   set status = 'suspended', suspended_at = now()
 where company_id = '52300000-0000-4000-8000-523000000000';
update public.companies set paid_extra_numbers = 3
 where id = '52300000-0000-4000-8000-523000000000';

do $$
declare res jsonb; act int; pen int;
begin
  res := public.claim_number_allowance(
    p_company_id  => '52300000-0000-4000-8000-523000000000',
    p_included    => null,
    p_paid_extras => 0);
  select count(*) filter (where status = 'active') into act
    from public.phone_numbers
   where company_id = '52300000-0000-4000-8000-523000000000';
  select paid_extra_numbers into pen from public.companies
   where id = '52300000-0000-4000-8000-523000000000';
  if act is distinct from 2 then
    raise exception 'A4 FAILED: expected every number back, got % active', act;
  end if;
  if (res->>'plan_known')::boolean then
    raise exception 'A4 FAILED: reported plan_known on a null plan';
  end if;
  if pen is distinct from 3 then
    raise exception 'A4 FAILED: an unreadable plan rewrote capacity to %', pen;
  end if;
  raise notice 'A4 OK: unreadable plan restores all, writes no capacity';
end $$;

-- ==========================================================================
-- A5. The #110 raise fence. A billed figure ABOVE the stored capacity, with no
--     epoch (or a stale one), is refused — the allowance is then computed from
--     the stored capacity, so we hold one MORE rather than hand out a free
--     number.
--
--     PROVED BY BREAKING: with the fence's `p_expected_epoch <> v_epoch` term
--     dropped so a stale epoch passed, this fired
--       A5 FAILED: a stale epoch raised capacity to 2
-- ==========================================================================
update public.phone_numbers
   set status = 'suspended', suspended_at = now()
 where company_id = '52300000-0000-4000-8000-523000000000';
update public.companies
   set paid_extra_numbers = 0, paid_capacity_epoch = 7
 where id = '52300000-0000-4000-8000-523000000000';

do $$
declare res jsonb; pen int; act int;
begin
  res := public.claim_number_allowance(
    p_company_id     => '52300000-0000-4000-8000-523000000000',
    p_included       => 1,
    p_paid_extras    => 2,
    p_expected_epoch => 6);  -- stale: a credit decision ran since
  select paid_extra_numbers into pen from public.companies
   where id = '52300000-0000-4000-8000-523000000000';
  select count(*) filter (where status = 'active') into act
    from public.phone_numbers
   where company_id = '52300000-0000-4000-8000-523000000000';
  if pen is distinct from 0 then
    raise exception 'A5 FAILED: a stale epoch raised capacity to %', pen;
  end if;
  if not (res->>'capacity_fenced')::boolean then
    raise exception 'A5 FAILED: the fence fired silently';
  end if;
  if act is distinct from 1 then
    raise exception 'A5 FAILED: fail-closed should restore 1, restored %', act;
  end if;
  raise notice 'A5 OK: stale raise refused, allowance computed from stored capacity';
end $$;

-- A5b. The same raise WITH the epoch it read is honoured.
do $$
declare res jsonb; pen int; epoch bigint;
begin
  update public.phone_numbers
     set status = 'suspended', suspended_at = now()
   where company_id = '52300000-0000-4000-8000-523000000000';
  select paid_capacity_epoch into epoch from public.companies
   where id = '52300000-0000-4000-8000-523000000000';
  res := public.claim_number_allowance(
    p_company_id     => '52300000-0000-4000-8000-523000000000',
    p_included       => 1,
    p_paid_extras    => 1,
    p_expected_epoch => epoch);
  select paid_extra_numbers into pen from public.companies
   where id = '52300000-0000-4000-8000-523000000000';
  if pen is distinct from 1 or (res->>'allowance')::int is distinct from 2 then
    raise exception 'A5b FAILED: capacity=% allowance=%', pen, res->>'allowance';
  end if;
  raise notice 'A5b OK: a fresh epoch raises capacity and the allowance with it';
end $$;

-- ==========================================================================
-- A6. A row that is neither active nor suspended still occupies the allowance.
--     A number mid-provision (or a ported row) owes us its rent and must not
--     be displaced by one we bring back.
-- ==========================================================================
do $$
declare res jsonb; act int; sus int;
begin
  update public.phone_numbers
     set status = 'suspended', suspended_at = now()
   where company_id = '52300000-0000-4000-8000-523000000000';
  update public.companies set paid_extra_numbers = 0
   where id = '52300000-0000-4000-8000-523000000000';
  insert into public.phone_numbers
    (company_id, status, provisioning_key, country, number_e164, created_at)
  values ('52300000-0000-4000-8000-523000000000', 'provisioning', 'k523c',
          'US', '+14155550103', now());

  res := public.claim_number_allowance(
    p_company_id  => '52300000-0000-4000-8000-523000000000',
    p_included    => 1,
    p_paid_extras => 0);
  select count(*) filter (where status = 'active'),
         count(*) filter (where status = 'suspended')
    into act, sus
    from public.phone_numbers
   where company_id = '52300000-0000-4000-8000-523000000000';
  if act is distinct from 0 or sus is distinct from 2 then
    raise exception 'A6 FAILED: expected the provisioning row to fill the one slot, got %/%', act, sus;
  end if;
  if jsonb_array_length(res->'held') is distinct from 2 then
    raise exception 'A6 FAILED: held reported %', res->'held';
  end if;
  raise notice 'A6 OK: a non-suspended row occupies the allowance';
end $$;

-- ==========================================================================
-- A7. Deny by default (SPEC §6).
-- ==========================================================================
do $$
begin
  if has_function_privilege('authenticated',
       'public.claim_number_allowance(uuid, int, int, bigint, uuid)', 'execute')
     or has_function_privilege('anon',
       'public.claim_number_allowance(uuid, int, int, bigint, uuid)', 'execute') then
    raise exception 'A7 FAILED: claim_number_allowance is reachable from a client role';
  end if;
  if not has_function_privilege('service_role',
       'public.claim_number_allowance(uuid, int, int, bigint, uuid)', 'execute') then
    raise exception 'A7 FAILED: service_role cannot call claim_number_allowance';
  end if;
  raise notice 'A7 OK: service_role only';
end $$;

-- ==========================================================================
-- A8. The PURCHASE brings back the number that was PAID for — not the oldest.
--     `POST .../held-numbers/:id/reinstate` buys capacity for one named number
--     at the moment the owner presses its button. Oldest-first would take the
--     money and leave that card saying "on hold".
--
--     PROVED BY BREAKING: with the rank's `case when id = p_prefer_id` term
--     removed (plain oldest-first), this fired
--       A8 FAILED: paid for +14155550102, got back +14155550101
-- ==========================================================================
do $$
declare res jsonb;
begin
  update public.phone_numbers
     set status = 'suspended', suspended_at = now()
   where company_id = '52300000-0000-4000-8000-523000000000'
     and id in ('52300000-0000-4000-8000-523000000101',
                '52300000-0000-4000-8000-523000000102');
  delete from public.phone_numbers
   where company_id = '52300000-0000-4000-8000-523000000000'
     and id not in ('52300000-0000-4000-8000-523000000101',
                    '52300000-0000-4000-8000-523000000102');
  update public.companies
     set paid_extra_numbers = 0, paid_capacity_epoch = 20
   where id = '52300000-0000-4000-8000-523000000000';
  -- One row mid-provision fills the included slot, so the ONE unit of capacity
  -- being bought is the only budget there is — exactly the state a workspace is
  -- in when it presses a held number's button.
  insert into public.phone_numbers
    (company_id, status, provisioning_key, country, number_e164, created_at)
  values ('52300000-0000-4000-8000-523000000000', 'provisioning', 'k523f',
          'US', '+14155550106', now());

  res := public.claim_number_allowance(
    p_company_id     => '52300000-0000-4000-8000-523000000000',
    p_included       => 1,
    p_paid_extras    => 1,
    p_expected_epoch => 20,
    -- The NEWER number: the one whose button was pressed.
    p_prefer_id      => '52300000-0000-4000-8000-523000000102');

  if not (res->>'applied')::boolean then
    raise exception 'A8 FAILED: a deliverable purchase was refused: %', res;
  end if;
  if (res->'restored'->0->>'number_e164') is distinct from '+14155550102' then
    raise exception 'A8 FAILED: paid for +14155550102, got back %',
      res->'restored'->0->>'number_e164';
  end if;
  if jsonb_array_length(res->'restored') is distinct from 1 then
    raise exception 'A8 FAILED: one unit of capacity restored %', res->'restored';
  end if;
  raise notice 'A8 OK: the named number is the one that comes back';
end $$;

-- ==========================================================================
-- A9. ALL OR NOTHING. When the raise would NOT bring the named number back —
--     here because a row mid-provision already fills the bigger allowance —
--     nothing is written: no capacity, no epoch bump, no restore. That is what
--     lets the route charge nothing, which is the whole point: a fenced or
--     undeliverable claim must never leave a paid customer without the number.
--
--     PROVED BY BREAKING: with the all-or-nothing condition forced false (write
--     first, report after), this fired
--       A9 FAILED: reported applied on a purchase it could not deliver
--     and with only the `v_budget < 1` term dropped, the same assertion fired —
--     the capacity and epoch checks below are the second and third lines of the
--     same guard.
-- ==========================================================================
do $$
declare res jsonb; pen int; epoch bigint; before_epoch bigint; act int;
begin
  update public.phone_numbers
     set status = 'suspended', suspended_at = now()
   where company_id = '52300000-0000-4000-8000-523000000000';
  update public.companies
     set paid_extra_numbers = 0, paid_capacity_epoch = 30
   where id = '52300000-0000-4000-8000-523000000000';
  -- Two rows mid-provision: with 1 included + the 1 extra being bought, the
  -- allowance is 2 and both slots are already spoken for.
  insert into public.phone_numbers
    (company_id, status, provisioning_key, country, number_e164, created_at)
  values ('52300000-0000-4000-8000-523000000000', 'provisioning', 'k523d',
          'US', '+14155550104', now()),
         ('52300000-0000-4000-8000-523000000000', 'provisioning', 'k523e',
          'US', '+14155550105', now());
  select paid_capacity_epoch into before_epoch from public.companies
   where id = '52300000-0000-4000-8000-523000000000';

  res := public.claim_number_allowance(
    p_company_id     => '52300000-0000-4000-8000-523000000000',
    p_included       => 1,
    p_paid_extras    => 1,
    p_expected_epoch => before_epoch,
    p_prefer_id      => '52300000-0000-4000-8000-523000000102');

  select paid_extra_numbers, paid_capacity_epoch into pen, epoch
    from public.companies where id = '52300000-0000-4000-8000-523000000000';
  select count(*) filter (where status = 'active') into act
    from public.phone_numbers
   where company_id = '52300000-0000-4000-8000-523000000000';

  if (res->>'applied')::boolean then
    raise exception 'A9 FAILED: reported applied on a purchase it could not deliver';
  end if;
  if pen is distinct from 0 then
    raise exception 'A9 FAILED: an undeliverable purchase still raised capacity to %', pen;
  end if;
  if epoch is distinct from before_epoch then
    raise exception 'A9 FAILED: an undeliverable purchase bumped the epoch to %', epoch;
  end if;
  if act is distinct from 0 then
    raise exception 'A9 FAILED: % number(s) were restored by a refused purchase', act;
  end if;
  if (res->>'capacity')::int is distinct from 0 or (res->>'allowance')::int is distinct from 1 then
    raise exception 'A9 FAILED: reported a capacity/allowance it did not write: %', res;
  end if;
  raise notice 'A9 OK: an undeliverable purchase changes nothing at all';
end $$;

-- ==========================================================================
-- A10. The #110 fence on the PURCHASE path refuses BEFORE the money moves.
--      Charge-then-claim was the defect: the fence fired after Stripe had been
--      told to bill, so the customer paid and the number stayed held. With the
--      claim first, a stale epoch simply means nothing was written and the
--      route has nothing to charge for.
--
--      PROVED BY BREAKING: this assertion is what SENT the `or v_fenced` term
--      to the function. Written first, against a version without it, it fired
--        A10 FAILED: a fenced purchase reported applied
--      because the stored allowance still had room and the claim handed the
--      number over for free — while the route went on to charge for it.
-- ==========================================================================
do $$
declare res jsonb; pen int; act int;
begin
  update public.phone_numbers
     set status = 'suspended', suspended_at = now()
   where company_id = '52300000-0000-4000-8000-523000000000';
  delete from public.phone_numbers
   where company_id = '52300000-0000-4000-8000-523000000000'
     and id not in ('52300000-0000-4000-8000-523000000101',
                    '52300000-0000-4000-8000-523000000102');
  update public.companies
     set paid_extra_numbers = 0, paid_capacity_epoch = 40
   where id = '52300000-0000-4000-8000-523000000000';

  res := public.claim_number_allowance(
    p_company_id     => '52300000-0000-4000-8000-523000000000',
    p_included       => 1,
    p_paid_extras    => 1,
    p_expected_epoch => 39,  -- stale: a credit decision landed since
    p_prefer_id      => '52300000-0000-4000-8000-523000000102');

  select paid_extra_numbers into pen from public.companies
   where id = '52300000-0000-4000-8000-523000000000';
  select count(*) filter (where status = 'active') into act
    from public.phone_numbers
   where company_id = '52300000-0000-4000-8000-523000000000';

  if (res->>'applied')::boolean then
    raise exception 'A10 FAILED: a fenced purchase reported applied';
  end if;
  if not (res->>'capacity_fenced')::boolean then
    raise exception 'A10 FAILED: the fence fired silently';
  end if;
  if pen is distinct from 0 then
    raise exception 'A10 FAILED: a fenced purchase raised capacity to %', pen;
  end if;
  -- Fail closed BOTH ways: the named number is not handed over either.
  if act is distinct from 0 then
    raise exception 'A10 FAILED: a fenced purchase restored % number(s)', act;
  end if;
  raise notice 'A10 OK: the fence refuses before any money can move';
end $$;

-- ==========================================================================
-- A11. A number that is already back cannot be bought a second time. The route
--      checks this too, but a double-press that races the first press past that
--      check must still not spend capacity here.
-- ==========================================================================
do $$
declare res jsonb; pen int;
begin
  update public.phone_numbers
     set status = 'active', suspended_at = null
   where company_id = '52300000-0000-4000-8000-523000000000';
  update public.companies
     set paid_extra_numbers = 0, paid_capacity_epoch = 50
   where id = '52300000-0000-4000-8000-523000000000';

  res := public.claim_number_allowance(
    p_company_id     => '52300000-0000-4000-8000-523000000000',
    p_included       => 1,
    p_paid_extras    => 1,
    p_expected_epoch => 50,
    p_prefer_id      => '52300000-0000-4000-8000-523000000102');

  select paid_extra_numbers into pen from public.companies
   where id = '52300000-0000-4000-8000-523000000000';
  if (res->>'applied')::boolean or pen is distinct from 0 then
    raise exception 'A11 FAILED: bought capacity for a number that was already back (applied=%, capacity=%)',
      res->>'applied', pen;
  end if;
  raise notice 'A11 OK: an already-active number is never charged for again';
end $$;


rollback;
