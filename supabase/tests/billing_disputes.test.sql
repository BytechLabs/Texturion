-- #422 — the chargeback ledger.
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run: psql -v ON_ERROR_STOP=1 -f supabase/tests/billing_disputes.test.sql
-- The whole suite runs in one transaction and ROLLS BACK.
--
-- What this guards: a disputed charge used to leave NO trace at all. Stripe
-- keeps the subscription active while one of its charges is disputed, our
-- mirror copied that faithfully, and the service went on running for a
-- customer who had told their bank the charge was wrong. Everything below is
-- about the record surviving, and surviving in a form somebody can act on.
--
--   owner   = 42200000-0000-4000-8000-000000000001
--   company = 42200000-0000-4000-8000-000000000010

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('42200000-0000-4000-8000-000000000001', 'owner@dispute.test');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, plan, stripe_customer_id)
values ('42200000-0000-4000-8000-000000000010', 'Kettleman Roofing',
        '42200000-0000-4000-8000-000000000001', 'CA', '416', now(),
        'active', 'starter', 'cus_dispute_1');

-- ===========================================================================
-- BD-1. A dispute is recorded and the tenant is flagged, in one call.
--
--       One RPC on purpose: a dispute row without the company flag is a
--       dispute nobody sees, and a flag with no row is a workspace marked with
--       no evidence why.
-- ===========================================================================
do $$
declare r jsonb; c record; d record;
begin
  r := public.record_billing_dispute(
    'dp_1', '42200000-0000-4000-8000-000000000010', 'ch_1', 'pi_1',
    2900, 1500, 'fraudulent', 'warning_needs_response', now(), now() + interval '7 days');

  if not (r->>'first_seen')::boolean then
    raise exception 'BD-1 FAILED: a brand-new dispute was not reported as first seen';
  end if;

  select * into d from public.billing_disputes where stripe_dispute_id = 'dp_1';
  if d.amount_cents <> 2900 or d.fee_cents <> 1500 then
    raise exception 'BD-1 FAILED: amounts wrong (% + %)', d.amount_cents, d.fee_cents;
  end if;
  -- The payment intent is the only id shared by the charge, the dispute and
  -- the invoice's payment records. Losing it makes the row unjoinable.
  if d.stripe_payment_intent_id is distinct from 'pi_1' then
    raise exception 'BD-1 FAILED: the payment intent was not kept';
  end if;

  select * into c from public.companies where id = '42200000-0000-4000-8000-000000000010';
  if c.disputed_at is null then
    raise exception 'BD-1 FAILED: the workspace was not flagged';
  end if;
  -- NOT a subscription_status change: Stripe leaves it active, and mirroring a
  -- fiction into that column would break every consumer of it.
  if c.subscription_status <> 'active' then
    raise exception 'BD-1 FAILED: subscription_status was altered to %', c.subscription_status;
  end if;

  raise notice 'BD-1 PASSED: the dispute is recorded and the tenant flagged';
end $$;

-- ===========================================================================
-- BD-2. An UNATTRIBUTABLE dispute still records.
--
--       A charge we cannot match to a company is MORE alarming than one we
--       can, not less — it may not even be ours. A NOT NULL company_id would
--       have meant the strangest disputes are the ones we silently drop.
-- ===========================================================================
do $$
declare n int;
begin
  perform public.record_billing_dispute(
    'dp_orphan', null, 'ch_x', 'pi_x', 9900, 1500,
    'general', 'needs_response', now());

  select count(*) into n from public.billing_disputes
   where stripe_dispute_id = 'dp_orphan' and company_id is null;
  if n <> 1 then
    raise exception 'BD-2 FAILED: an unattributable dispute was not recorded';
  end if;

  raise notice 'BD-2 PASSED: a dispute we cannot attribute is still recorded';
end $$;

-- ===========================================================================
-- BD-3. Stripe redelivers, and updates arrive out of order.
--
--       A later event carrying LESS context must never erase attribution we
--       already made, and a re-delivery must not read as a new dispute — that
--       is what decides whether the founder gets one email or five.
-- ===========================================================================
do $$
declare r jsonb; d record;
begin
  r := public.record_billing_dispute(
    'dp_1', null, 'ch_1', 'pi_1', 2900, 1500,
    'fraudulent', 'under_review', now());

  if (r->>'first_seen')::boolean then
    raise exception 'BD-3 FAILED: a redelivery reported itself as first seen';
  end if;

  select * into d from public.billing_disputes where stripe_dispute_id = 'dp_1';
  if d.company_id is null then
    raise exception 'BD-3 FAILED: a later event with no company erased the attribution';
  end if;
  if d.status <> 'under_review' then
    raise exception 'BD-3 FAILED: status did not advance (%)', d.status;
  end if;
  -- The fee only ever grows: Stripe sometimes reports it late, and taking the
  -- smaller number would under-report what the dispute actually cost.
  if d.fee_cents <> 1500 then
    raise exception 'BD-3 FAILED: fee went backwards to %', d.fee_cents;
  end if;

  raise notice 'BD-3 PASSED: redelivery is idempotent and never loses context';
end $$;

-- ===========================================================================
-- BD-4. Closing a dispute leaves the mark on the workspace.
--
--       Won or lost, this tenant disputed a charge, and that is the fact a
--       human wants months later when deciding whether to keep serving them.
-- ===========================================================================
do $$
declare c record; d record;
begin
  perform public.record_billing_dispute(
    'dp_1', '42200000-0000-4000-8000-000000000010', 'ch_1', 'pi_1', 2900, 1500,
    'fraudulent', 'won', now(), null, now());

  select * into d from public.billing_disputes where stripe_dispute_id = 'dp_1';
  if d.closed_at is null then
    raise exception 'BD-4 FAILED: the dispute did not close';
  end if;

  select * into c from public.companies where id = '42200000-0000-4000-8000-000000000010';
  if c.disputed_at is null then
    raise exception 'BD-4 FAILED: closing cleared the workspace flag';
  end if;

  raise notice 'BD-4 PASSED: a closed dispute still leaves the mark';
end $$;

-- ===========================================================================
-- BD-5. api_dispute_health reports the COST, not just the count.
--
--       The issue's whole argument is arithmetic: $29 clawed back plus a $15
--       fee is $44 out on a sale that nets $27.71. A health report that omits
--       the fee understates the damage by more than half.
-- ===========================================================================
do $$
declare h jsonb;
begin
  h := public.api_dispute_health(now(), 120);

  if (h->>'disputes')::int <> 2 then
    raise exception 'BD-5 FAILED: expected 2 disputes in the window, got %', h->>'disputes';
  end if;
  if (h->>'unattributed')::int <> 1 then
    raise exception 'BD-5 FAILED: the unattributable one was not counted: %', h;
  end if;
  -- 2900 + 9900 amounts, 1500 + 1500 fees.
  if (h->>'cost_cents')::int <> 15800 then
    raise exception 'BD-5 FAILED: cost was % cents, expected 15800 (amounts + fees)', h->>'cost_cents';
  end if;

  -- Outside the window is outside the number.
  update public.billing_disputes set opened_at = now() - interval '400 days';
  h := public.api_dispute_health(now(), 120);
  if (h->>'disputes')::int <> 0 then
    raise exception 'BD-5 FAILED: old disputes leaked into the window: %', h;
  end if;

  raise notice 'BD-5 PASSED: health reports the clawback AND the fee';
end $$;

-- ===========================================================================
-- BD-6. Grants and RLS. This table names which customers charged back, across
--       every tenant — the last thing one company should be able to read
--       about another.
-- ===========================================================================
do $$
declare bad text; rls boolean;
begin
  select string_agg(format('%s→%s', p.proname, g.grantee), ', ') into bad
    from information_schema.role_routine_grants g
    join pg_proc p on p.proname = g.routine_name
   where g.routine_schema = 'public'
     and p.proname in ('record_billing_dispute', 'api_dispute_health')
     and g.grantee in ('PUBLIC', 'anon', 'authenticated');
  if bad is not null then
    raise exception 'BD-6 FAILED: dispute functions are reachable: %', bad;
  end if;

  select relrowsecurity into rls from pg_class where oid = 'public.billing_disputes'::regclass;
  if not rls then
    raise exception 'BD-6 FAILED: billing_disputes has RLS disabled';
  end if;

  raise notice 'BD-6 PASSED: the dispute ledger is service_role only, RLS on';
end $$;

rollback;
