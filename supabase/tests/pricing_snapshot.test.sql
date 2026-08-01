-- [#255] The pricing reads — assertion suite for
-- supabase/migrations/20260801120000_pricing_snapshot.sql and
-- supabase/migrations/20260801140000_module_movements.sql.
--
-- What is pinned here is the set of judgements that would be silently wrong:
-- who counts as a customer at all, that a prepaid year is reported as collected
-- rather than as list price, and that an add-on attached during checkout is
-- told apart from one attached weeks later. The last is the whole point of the
-- expansion figure — mixed into a total it answers neither question.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/pricing_snapshot.test.sql
--
-- One transaction, rolled back. Fixtures use a '52' id prefix so the file runs
-- standalone OR after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('52000000-0000-4000-8000-00000000000a'::uuid, 'pricing-a@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_started_at, subscription_status, plan, current_period_start)
values
  -- Paying, attached its add-on during checkout.
  ('52000000-0000-4000-8000-0000000000c1'::uuid, 'Signup Attach',
   '52000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(),
   now() - interval '30 days', 'active', 'starter', now() - interval '5 days'),
  -- Paying, attached weeks later and has since dropped it.
  ('52000000-0000-4000-8000-0000000000c2'::uuid, 'Later Attach',
   '52000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(),
   now() - interval '30 days', 'active', 'pro', now() - interval '5 days'),
  -- Never checked out. Not a customer, and a margin for it divides by an
  -- intention.
  ('52000000-0000-4000-8000-0000000000c3'::uuid, 'Never Paid',
   '52000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(),
   null, 'incomplete', 'starter', null);

insert into public.company_modules (company_id, module, enabled_at, disabled_at) values
  ('52000000-0000-4000-8000-0000000000c1'::uuid, 'regions_ca',
   now() - interval '30 days', null),
  ('52000000-0000-4000-8000-0000000000c2'::uuid, 'regions_ca',
   now() - interval '10 days', now() - interval '1 day');

-- ===========================================================================
-- PS255-1. The snapshot covers paying workspaces and nobody else.
-- ===========================================================================
do $$
declare
  v_rows integer;
  v_never integer;
begin
  select count(*) into v_rows from public.api_pricing_snapshot()
   where company_id in (
     '52000000-0000-4000-8000-0000000000c1'::uuid,
     '52000000-0000-4000-8000-0000000000c2'::uuid,
     '52000000-0000-4000-8000-0000000000c3'::uuid);
  if v_rows <> 2 then
    raise exception 'PS255-1: expected 2 paying workspaces, got %', v_rows;
  end if;

  select count(*) into v_never from public.api_pricing_snapshot()
   where company_id = '52000000-0000-4000-8000-0000000000c3'::uuid;
  if v_never <> 0 then
    raise exception 'PS255-1: a workspace that never checked out was reported';
  end if;
end $$;

-- ===========================================================================
-- PS255-2. Enabled modules travel; a DROPPED one does not.
--
-- The snapshot is current state, so a dropped add-on must not be priced as
-- revenue. (Retention asks the opposite question and reads EVER attached —
-- see retention_cohorts.test.sql.)
-- ===========================================================================
do $$
declare
  v_c1 text[];
  v_c2 text[];
begin
  select modules into v_c1 from public.api_pricing_snapshot()
   where company_id = '52000000-0000-4000-8000-0000000000c1'::uuid;
  select modules into v_c2 from public.api_pricing_snapshot()
   where company_id = '52000000-0000-4000-8000-0000000000c2'::uuid;

  if not (v_c1 @> array['regions_ca']) then
    raise exception 'PS255-2: an enabled add-on is missing from the snapshot';
  end if;
  if v_c2 @> array['regions_ca'] then
    raise exception 'PS255-2: a dropped add-on is still being priced as revenue';
  end if;
end $$;

-- ===========================================================================
-- PS255-3. A prepaid year reports what was COLLECTED, not the list price.
--
-- #400/D107: a prepaid workspace invoices its licensed line at $0. Reporting
-- list price would credit revenue nobody is collecting, and mute the one alert
-- that catches a tenant costing more than it pays — for exactly the cohort that
-- has already paid everything it ever will.
-- ===========================================================================
do $$
declare
  v_cents  bigint;
  v_months integer;
begin
  insert into public.prepayments
    (company_id, stripe_session_id, plan, amount_cents, months_granted, granted_at)
  values
    ('52000000-0000-4000-8000-0000000000c1'::uuid, 'cs_test_255', 'starter',
     29000, 12, now());

  select prepaid_cents, prepaid_months into v_cents, v_months
    from public.api_pricing_snapshot()
   where company_id = '52000000-0000-4000-8000-0000000000c1'::uuid;

  if v_cents <> 29000 or v_months <> 12 then
    raise exception 'PS255-3: prepayment reported as % over % months', v_cents, v_months;
  end if;
end $$;

-- ===========================================================================
-- PS255-4. A REVOKED prepayment stops counting.
--
-- Refunded or charged back means the money is gone; continuing to amortise it
-- would report revenue that was returned.
-- ===========================================================================
do $$
declare
  v_cents bigint;
begin
  update public.prepayments set revoked_at = now()
   where company_id = '52000000-0000-4000-8000-0000000000c1'::uuid;

  select prepaid_cents into v_cents from public.api_pricing_snapshot()
   where company_id = '52000000-0000-4000-8000-0000000000c1'::uuid;
  if v_cents <> 0 then
    raise exception 'PS255-4: a revoked prepayment still reports % cents', v_cents;
  end if;
end $$;

-- ===========================================================================
-- PS255-5. Attached at signup and attached later are told apart.
--
-- THE point of the expansion figure. A module attached during checkout is a
-- pricing-page decision; one attached weeks later is the product earning more
-- after it was sold. A total that mixes them answers neither question.
-- ===========================================================================
do $$
declare r record;
begin
  select * into r from public.api_module_movements(90) where module = 'regions_ca';
  if r.attached_at_signup <> 1 then
    raise exception 'PS255-5: at-signup was %, expected 1', r.attached_at_signup;
  end if;
  if r.attached_later <> 1 then
    raise exception 'PS255-5: later was %, expected 1', r.attached_later;
  end if;
  if r.dropped <> 1 then
    raise exception 'PS255-5: dropped was %, expected 1', r.dropped;
  end if;
end $$;

-- ===========================================================================
-- PS255-6. The window bounds the movement report.
-- ===========================================================================
do $$
declare v_rows integer;
begin
  select count(*) into v_rows from public.api_module_movements(1)
   where module = 'regions_ca';
  if v_rows <> 0 then
    raise exception 'PS255-6: a one-day window reported attaches from weeks ago';
  end if;
end $$;

rollback;
