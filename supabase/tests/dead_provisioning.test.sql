-- #526 — close_out_dead_provisioning: close out the rows that are not numbers,
-- and NOTHING else.
--
-- The reason this file is long is #526 R2. The predicate this function replaced
-- had six filters and every single one of them could be deleted with the whole
-- TypeScript suite still green — including `number_e164 is null`, the one whose
-- removal hands a customer's working phone number back to a carrier that
-- reassigns it (#413). A filter that only fails in combination with another is
-- not guarded, so every row below is one column away from being a ghost, and
-- that column is the filter it proves.
--
-- Each assertion was proved by BREAKING the named clause and watching it fire;
-- the observed message is recorded on the assertion.
--
-- Rolled back. Namespace 52600000-…

begin;

insert into auth.users (id, email, raw_user_meta_data)
select ('52600000-0000-4000-8000-00000000000' || i)::uuid,
       'u' || i || '@526.test', '{}'::jsonb
from generate_series(1, 3) i;

-- A — the workspace this is about: cancelled, sitting in the grace window with
-- one real number on hold and a drawer full of rows that never became numbers.
insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, canceled_at, plan, stripe_customer_id,
   stripe_subscription_id, paid_extra_numbers)
values ('52600000-0000-4000-8000-52600000000a', '526 Roofing',
        '52600000-0000-4000-8000-000000000001', 'US', '415', now(),
        'canceled', now() - interval '5 days', 'starter', 'cus_526a', 'sub_526a', 0),
-- B — a DIFFERENT cancelled workspace. Its ghost proves the company filter: a
-- close-out that leaks across tenants is the worst version of this bug.
       ('52600000-0000-4000-8000-52600000000b', '526 Fencing',
        '52600000-0000-4000-8000-000000000002', 'US', '416', now(),
        'canceled', now() - interval '5 days', 'starter', 'cus_526b', 'sub_526b', 0),
-- C — LIVE and paying, with a row that looks exactly like a ghost. It is not
-- one: the 15-minute retry cron still owns it, or its owner is being shown the
-- "Choose a number" remediation. This is the row the subscription gate protects.
       ('52600000-0000-4000-8000-52600000000c', '526 Paving',
        '52600000-0000-4000-8000-000000000003', 'US', '417', now(),
        'active', null, 'starter', 'cus_526c', 'sub_526c', 0);

insert into public.company_members (company_id, user_id, role)
values ('52600000-0000-4000-8000-52600000000a',
        '52600000-0000-4000-8000-000000000001', 'owner'),
       ('52600000-0000-4000-8000-52600000000b',
        '52600000-0000-4000-8000-000000000002', 'owner'),
       ('52600000-0000-4000-8000-52600000000c',
        '52600000-0000-4000-8000-000000000003', 'owner');

-- `porting_status` is null for every row but the port (the table's own
-- source/porting_status consistency constraint).
insert into public.phone_numbers
  (id, company_id, status, source, provisioning_key, country, number_e164,
   telnyx_phone_number_id, telnyx_order_id, provisioning_lease_until,
   porting_status, created_at)
values
  -- ── The three ghosts. Every one of them has no number, and all three ate
  --    the allowance a resubscribe settles against. ───────────────────────
  -- G1: the original — a search that found nothing, nothing bought, nothing left.
  ('52600000-0000-4000-8000-526000000101', '52600000-0000-4000-8000-52600000000a',
   'provision_failed', 'provisioned', 'k526-g1', 'US',
   null, null, null, null, null, now() - interval '10 days'),
  -- G2: the transport/5xx branch's row. `recordProvisionFailure` keeps the order
  -- id on purpose (clearing it could strand an order that still succeeds), and
  -- #523's close-out therefore walked past it forever.
  ('52600000-0000-4000-8000-526000000102', '52600000-0000-4000-8000-52600000000a',
   'provision_failed', 'provisioned', 'k526-g2', 'US',
   null, null, 'order-still-maybe', null, null, now() - interval '9 days'),
  -- G3: a saga that died mid-flight. Its 180-second lease expired days ago and
  -- nothing cleared it; `provisioning_lease_until is null` could not see this.
  ('52600000-0000-4000-8000-526000000103', '52600000-0000-4000-8000-52600000000a',
   'provisioning', 'provisioned', 'k526-g3', 'US',
   null, null, null, now() - interval '2 days', null, now() - interval '8 days'),

  -- ── One column away from a ghost, each. ─────────────────────────────────
  -- K1: it HAS a number. Releasing it would hand +14155550101 back to the
  -- carrier — and free it from phone_numbers_e164_uq, which is what lets
  -- another workspace be sold it.
  ('52600000-0000-4000-8000-526000000201', '52600000-0000-4000-8000-52600000000a',
   'provisioning', 'provisioned', 'k526-k1', 'US',
   '+14155550101', null, null, null, null, now() - interval '7 days'),
  -- K2: no number_e164 yet, but a Telnyx phone-number resource we own and pay
  -- for. Closing it out orphans a number nothing points at any more.
  ('52600000-0000-4000-8000-526000000202', '52600000-0000-4000-8000-52600000000a',
   'provisioning', 'provisioned', 'k526-k2', 'US',
   null, 'pn-526-k2', null, null, null, now() - interval '6 days'),
  -- K3: an open PORT. It sits exactly like a ghost for the whole multi-week
  -- transfer, and the port saga is the only thing entitled to end it.
  ('52600000-0000-4000-8000-526000000203', '52600000-0000-4000-8000-52600000000a',
   'provisioning', 'ported', 'k526-k3', 'US',
   null, null, null, null, 'submitted', now() - interval '5 days'),
  -- K4: a keep-your-number text enablement, mid carrier review.
  ('52600000-0000-4000-8000-526000000204', '52600000-0000-4000-8000-52600000000a',
   'provisioning', 'hosted', 'k526-k4', 'US',
   null, null, null, null, null, now() - interval '4 days'),
  -- K5: SUSPENDED with no number recorded. The status list is what keeps this
  -- row alive, and a suspended row is the held set `claim_number_allowance`
  -- brings back — widening the list here is how a hold becomes a release.
  ('52600000-0000-4000-8000-526000000205', '52600000-0000-4000-8000-52600000000a',
   'suspended', 'provisioned', 'k526-k5', 'US',
   null, null, null, null, null, now() - interval '3 days'),
  -- K6: ACTIVE. Same reasoning as K5 from the other end of the status list.
  ('52600000-0000-4000-8000-526000000206', '52600000-0000-4000-8000-52600000000a',
   'active', 'provisioned', 'k526-k6', 'US',
   null, null, null, null, null, now() - interval '2 days'),
  -- K7: a saga is holding the lease RIGHT NOW. Its terminal write lands in
  -- seconds and would resurrect a row we had just closed out.
  ('52600000-0000-4000-8000-526000000207', '52600000-0000-4000-8000-52600000000a',
   'provisioning', 'provisioned', 'k526-k7', 'US',
   null, null, null, now() + interval '2 minutes', null, now() - interval '1 day'),
  -- The real, working number this whole feature exists to protect. Held while
  -- the workspace is cancelled; it must come back when they resubscribe.
  ('52600000-0000-4000-8000-526000000208', '52600000-0000-4000-8000-52600000000a',
   'suspended', 'provisioned', 'k526-real', 'US',
   '+14155550199', 'pn-526-real', null, null, null, now() - interval '400 days'),

  -- B's ghost — the other tenant.
  ('52600000-0000-4000-8000-526000000301', '52600000-0000-4000-8000-52600000000b',
   'provision_failed', 'provisioned', 'k526-b1', 'US',
   null, null, null, null, null, now() - interval '10 days'),

  -- C's in-flight purchase. Identical in every column to G1.
  ('52600000-0000-4000-8000-526000000401', '52600000-0000-4000-8000-52600000000c',
   'provision_failed', 'provisioned', 'k526-c1', 'US',
   null, null, null, null, null, now() - interval '10 days');

-- ==========================================================================
-- D1. The live workspace is not eligible and nothing of its is touched.
--
--     Run FIRST, before A's close-out, so this proves the gate rather than
--     inheriting A's result.
--
--     PROVED BY BREAKING: with the `v_status is distinct from 'canceled'`
--     guard removed, this fired
--       D1 FAILED: a LIVE workspace's pending number was closed out
-- ==========================================================================
do $$
declare res jsonb; st public.number_status;
begin
  res := public.close_out_dead_provisioning('52600000-0000-4000-8000-52600000000c');

  if (res->>'eligible')::boolean then
    raise exception 'D1 FAILED: a live workspace was reported eligible for close-out';
  end if;
  if jsonb_array_length(res->'closed') <> 0 then
    raise exception 'D1 FAILED: closed % row(s) on a live workspace',
      jsonb_array_length(res->'closed');
  end if;
  select status into st from public.phone_numbers
   where id = '52600000-0000-4000-8000-526000000401';
  if st <> 'provision_failed' then
    raise exception 'D1 FAILED: a LIVE workspace''s pending number was closed out (status %)', st;
  end if;
  raise notice 'D1 OK: a live workspace is never closed out — the row is a purchase, not a ghost';
end $$;

-- ==========================================================================
-- D2. The cancelled workspace IS eligible, and the close-out runs.
--
--     Split from the assertions below on purpose: the named row checks that
--     follow each fail with the name of the clause they guard, and a set
--     comparison that ran first would swallow all of them behind one list of
--     uuids.
-- ==========================================================================
do $$
declare res jsonb;
begin
  res := public.close_out_dead_provisioning('52600000-0000-4000-8000-52600000000a');
  if not (res->>'eligible')::boolean then
    raise exception 'D2 FAILED: a cancelled workspace was reported ineligible';
  end if;
  raise notice 'D2 OK: a cancelled workspace is eligible, and the close-out ran';
end $$;

-- ==========================================================================
-- D3. Nothing that names a number was released — the whole rule, stated once
--     over the table rather than row by row.
--
--     PROVED BY BREAKING: with `number_e164 is null` removed,
--       D3 FAILED: released a row that names a number: +14155550101
--     and with `telnyx_phone_number_id is null` removed,
--       D3 FAILED: released a row that owns a Telnyx number: pn-526-k2
-- ==========================================================================
do $$
declare bad text;
begin
  select number_e164 into bad
    from public.phone_numbers
   where status = 'released' and number_e164 is not null
   limit 1;
  if bad is not null then
    raise exception 'D3 FAILED: released a row that names a number: %', bad;
  end if;

  select telnyx_phone_number_id into bad
    from public.phone_numbers
   where status = 'released' and telnyx_phone_number_id is not null
   limit 1;
  if bad is not null then
    raise exception 'D3 FAILED: released a row that owns a Telnyx number: %', bad;
  end if;
  raise notice 'D3 OK: no row that could name a number was released';
end $$;

-- ==========================================================================
-- D4. Each protected row, by the one column that protects it. Stated
--     individually so that deleting ONE clause fails with the name of the
--     clause, not with a count.
--
--     PROVED BY BREAKING, one clause at a time:
--       * `source = 'provisioned'`  → D4 FAILED: the open port K3 was closed out
--       * the status list widened   → D4 FAILED: the held number K5 was closed out
--       * the lease bound removed   → D4 FAILED: a saga's live row K7 was closed out
-- ==========================================================================
do $$
declare st public.number_status;
begin
  select status into st from public.phone_numbers
   where id = '52600000-0000-4000-8000-526000000201';
  if st = 'released' then
    raise exception 'D4 FAILED: K1 — a row holding +14155550101 was closed out';
  end if;

  select status into st from public.phone_numbers
   where id = '52600000-0000-4000-8000-526000000202';
  if st = 'released' then
    raise exception 'D4 FAILED: K2 — a row owning Telnyx number pn-526-k2 was closed out';
  end if;

  select status into st from public.phone_numbers
   where id = '52600000-0000-4000-8000-526000000203';
  if st = 'released' then
    raise exception 'D4 FAILED: the open port K3 was closed out';
  end if;

  select status into st from public.phone_numbers
   where id = '52600000-0000-4000-8000-526000000204';
  if st = 'released' then
    raise exception 'D4 FAILED: the hosted enablement K4 was closed out';
  end if;

  select status into st from public.phone_numbers
   where id = '52600000-0000-4000-8000-526000000205';
  if st = 'released' then
    raise exception 'D4 FAILED: the held number K5 was closed out';
  end if;

  select status into st from public.phone_numbers
   where id = '52600000-0000-4000-8000-526000000206';
  if st = 'released' then
    raise exception 'D4 FAILED: the active number K6 was closed out';
  end if;

  select status into st from public.phone_numbers
   where id = '52600000-0000-4000-8000-526000000207';
  if st = 'released' then
    raise exception 'D4 FAILED: a saga''s live row K7 was closed out';
  end if;

  select status into st from public.phone_numbers
   where id = '52600000-0000-4000-8000-526000000208';
  if st <> 'suspended' then
    raise exception 'D4 FAILED: the workspace''s real held number is now %', st;
  end if;
  raise notice 'D4 OK: every row one column away from a ghost survived, for that column''s reason';
end $$;

-- ==========================================================================
-- D5. The other tenant's ghost is untouched.
--
--     PROVED BY BREAKING: with `company_id = p_company_id` replaced by
--     `company_id is not null`,
--       D5 FAILED: another workspace's row was closed out (status released)
-- ==========================================================================
do $$
declare st public.number_status;
begin
  select status into st from public.phone_numbers
   where id = '52600000-0000-4000-8000-526000000301';
  if st <> 'provision_failed' then
    raise exception 'D5 FAILED: another workspace''s row was closed out (status %)', st;
  end if;
  raise notice 'D5 OK: the close-out never crosses a tenant boundary';
end $$;

-- ==========================================================================
-- D6. The three ghosts DID close out — all three of them.
--
--     The assertions above prove nothing extra was closed; this one proves
--     nothing was MISSED, which is the direction #526 R1 is about.
--
--     PROVED BY BREAKING:
--       * `telnyx_order_id is null` re-added (the #523 predicate) →
--           D6 FAILED: expected G1,G2,G3 closed, got 52600000-…101, …103
--       * the lease bound reverted to `provisioning_lease_until is null` →
--           D6 FAILED: expected G1,G2,G3 closed, got 52600000-…101, …102
-- ==========================================================================
do $$
declare ids text;
begin
  select string_agg(id::text, ',' order by id)
    into ids
    from public.phone_numbers
   where company_id = '52600000-0000-4000-8000-52600000000a'
     and status = 'released';
  if ids is distinct from
     '52600000-0000-4000-8000-526000000101,'
     '52600000-0000-4000-8000-526000000102,'
     '52600000-0000-4000-8000-526000000103' then
    raise exception 'D6 FAILED: expected G1,G2,G3 closed, got %', ids;
  end if;
  raise notice 'D6 OK: every shape with no number in it was closed out, including the two #523 missed';
end $$;

-- ==========================================================================
-- D7. The report says what the table says, and a possibly-live order id
--     survives the close-out — it is the pointer `adoptOrphanNumber` and the
--     reconcile orphan net work from.
-- ==========================================================================
do $$
declare res jsonb;
begin
  -- Read on the OTHER tenant, whose ghost is still open, so the report is read
  -- fresh rather than inferred from a pass that already happened.
  res := public.close_out_dead_provisioning('52600000-0000-4000-8000-52600000000b');
  if jsonb_array_length(res->'closed') <> 1
     or (res->'closed'->0->>'id') <> '52600000-0000-4000-8000-526000000301' then
    raise exception 'D7 FAILED: B''s ghost was not reported closed: %', res->'closed';
  end if;
  if (res->'closed'->0->>'telnyx_order_id') is not null then
    raise exception 'D7 FAILED: reported an order id that was never there: %', res->'closed';
  end if;

  -- `is distinct from`, not `<>`. A NULL on either side makes `<>` NULL, which
  -- is not true, so the raise never fired - the assertion named the exact
  -- property it was protecting and could not fail on the one mutation that
  -- breaks it. Erasing the order id passed this test.
  if (select telnyx_order_id from public.phone_numbers
       where id = '52600000-0000-4000-8000-526000000102')
     is distinct from 'order-still-maybe' then
    raise exception 'D7 FAILED: the close-out erased the order id it was told to keep';
  end if;
  raise notice 'D7 OK: the report names what was closed, and a possibly-live order id survives on the row';
end $$;

-- ==========================================================================
-- D8. Idempotent. The webhook closes out at cancellation and the daily grace
--     job closes out again every day after; the second call must be a no-op,
--     not a second `released_at`.
-- ==========================================================================
do $$
declare res jsonb; stamped timestamptz; again timestamptz;
begin
  select released_at into stamped from public.phone_numbers
   where id = '52600000-0000-4000-8000-526000000101';
  -- The stamp has to EXIST before its stability means anything. Comparing two
  -- reads is vacuous when both are NULL, so dropping `released_at = now()` from
  -- the close-out passed the whole suite: the row was released with no record
  -- of when, and the sweep that reads released_at would never see it.
  if stamped is null then
    raise exception 'D8 FAILED: the close-out released a row without stamping released_at';
  end if;

  res := public.close_out_dead_provisioning('52600000-0000-4000-8000-52600000000a');
  if jsonb_array_length(res->'closed') <> 0 then
    raise exception 'D8 FAILED: a second pass closed % more row(s)',
      jsonb_array_length(res->'closed');
  end if;

  select released_at into again from public.phone_numbers
   where id = '52600000-0000-4000-8000-526000000101';
  if again is distinct from stamped then
    raise exception 'D8 FAILED: released_at was rewritten by a second pass';
  end if;
  raise notice 'D8 OK: the daily pass over an already-closed workspace changes nothing';
end $$;

-- ==========================================================================
-- D9. A ghost created AFTER the cancellation webhook has already run — the
--     saga that finished one second too late — is what the daily job exists
--     for. It closes out on the next pass.
--
--     This is #526 R1's third shape, and the reason a one-shot migration
--     could not have been the answer.
-- ==========================================================================
do $$
declare res jsonb; st public.number_status;
begin
  insert into public.phone_numbers
    (id, company_id, status, source, provisioning_key, country)
  values ('52600000-0000-4000-8000-526000000109',
          '52600000-0000-4000-8000-52600000000a',
          'provision_failed', 'provisioned', 'k526-late', 'US');

  res := public.close_out_dead_provisioning('52600000-0000-4000-8000-52600000000a');
  select status into st from public.phone_numbers
   where id = '52600000-0000-4000-8000-526000000109';
  if st <> 'released' then
    raise exception 'D9 FAILED: a ghost created after the webhook stayed % forever', st;
  end if;
  if (res->'closed'->0->>'id') <> '52600000-0000-4000-8000-526000000109' then
    raise exception 'D9 FAILED: the late ghost was not reported: %', res->'closed';
  end if;
  raise notice 'D9 OK: a ghost created tomorrow is closed out tomorrow';
end $$;

-- ==========================================================================
-- D10. Locked down (SPEC §6). Only the Worker's service role may run this.
-- ==========================================================================
do $$
begin
  if has_function_privilege('authenticated',
       'public.close_out_dead_provisioning(uuid)', 'execute')
     or has_function_privilege('anon',
       'public.close_out_dead_provisioning(uuid)', 'execute') then
    raise exception 'D10 FAILED: a client role can release phone-number rows';
  end if;
  if not has_function_privilege('service_role',
       'public.close_out_dead_provisioning(uuid)', 'execute') then
    raise exception 'D10 FAILED: the Worker cannot call its own close-out';
  end if;
  raise notice 'D10 OK: service_role only';
end $$;

rollback;
