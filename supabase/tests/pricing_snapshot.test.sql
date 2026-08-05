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

-- #277: paying, and PAUSED — `active`, still on Pro, invoiced a holding fee
-- instead of $79. Inserted separately from the block above because the pause
-- columns are the only thing that distinguishes it, and a reader of PS277-1
-- should be able to see the whole fixture without scrolling past three
-- unrelated ones.
insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_started_at, subscription_status, plan, current_period_start,
   paused_at, paused_price_cents)
values
  ('52000000-0000-4000-8000-0000000000c4'::uuid, 'Winter Crew',
   '52000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(),
   now() - interval '90 days', 'active', 'pro', now() - interval '5 days',
   now() - interval '10 days', 500);

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

-- ===========================================================================
-- PS277-1. A PAUSED workspace is reported as paused, with what it actually
-- pays.
--
-- The pause fee is the one price that is not in the repository — the founder
-- provisions it in Stripe — so a caller that cannot read it from the row has
-- nothing to fall back on but the plan's list price. That fallback is the
-- defect: it renders the cohort with ~90% less revenue and an unchanged number
-- and 10DLC campaign cost as the most profitable one in the report.
--
-- Both columns are asserted. `paused_at` alone would let the fee go missing
-- (the caller would guess), and the fee alone would not say WHICH rows are a
-- pause rather than a mis-mirrored plan.
-- ===========================================================================
do $$
declare
  v_paused_at timestamptz;
  v_cents     integer;
  v_plan      text;
  v_status    text;
begin
  select paused_at, paused_price_cents, plan, subscription_status
    into v_paused_at, v_cents, v_plan, v_status
    from public.api_pricing_snapshot()
   where company_id = '52000000-0000-4000-8000-0000000000c4'::uuid;

  -- Present at all: a pause leaves the status `active`, so a snapshot that
  -- filtered the cohort out would hide the rows this report is read for.
  if v_status is distinct from 'active' or v_plan is distinct from 'pro' then
    raise exception
      'PS277-1: a paused workspace is missing from the snapshot (status %, plan %)',
      v_status, v_plan;
  end if;
  if v_paused_at is null then
    raise exception
      'PS277-1: the snapshot does not report that this workspace is paused — '
      'the caller can only value it at its plan''s list price';
  end if;
  if v_cents is distinct from 500 then
    raise exception
      'PS277-1: the pause fee reported as %, expected 500', v_cents;
  end if;
end $$;

-- ===========================================================================
-- PS277-2. An UNPAUSED workspace reports null, so the caller can tell them
-- apart.
--
-- A constant is not a signal. If `paused_at` came back non-null for everybody
-- the caller would value the whole book at a holding fee, which fails in the
-- opposite direction and just as quietly.
-- ===========================================================================
do $$
declare
  v_paused_at timestamptz;
  v_cents     integer;
begin
  select paused_at, paused_price_cents into v_paused_at, v_cents
    from public.api_pricing_snapshot()
   where company_id = '52000000-0000-4000-8000-0000000000c1'::uuid;
  if v_paused_at is not null or v_cents is not null then
    raise exception
      'PS277-2: an unpaused workspace reports paused_at % / fee %',
      v_paused_at, v_cents;
  end if;
end $$;

-- ===========================================================================
-- PS525-1. The COST side of a paused workspace: it still carries its US 10DLC
-- campaign, and the snapshot says so.
--
-- The campaign fee is charged monthly whether or not a single message is sent,
-- and a paused workspace sends none — so its metered `provider_cost_cents` is
-- ~$0 while its real cost is the number rent plus that fee. A report built on
-- metered usage alone renders it as the highest-margin row in the book, which
-- is the #277 defect arriving from the cost side after the revenue side was
-- fixed.
--
-- The pause deliberately does NOT deactivate the campaign — that would cost the
-- customer another 3-7 business day carrier wait on their return — so this flag
-- reading true through a pause is the truth, not a leak.
-- ===========================================================================
do $$
declare
  v_us      boolean;
  v_paused  timestamptz;
  v_numbers bigint;
begin
  select us_texting_enabled, paused_at, numbers_used
    into v_us, v_paused, v_numbers
    from public.api_pricing_snapshot()
   where company_id = '52000000-0000-4000-8000-0000000000c4'::uuid;

  if v_paused is null then
    raise exception 'PS525-1: fixture is not paused — the test proves nothing';
  end if;
  if v_us is not true then
    raise exception
      'PS525-1: a paused workspace with US texting on reports us_texting_enabled '
      '% — the caller cannot see the recurring campaign fee it is paying, and '
      'the lowest-margin cohort renders as the highest', v_us;
  end if;
  -- The other half of the fixed cost. Zero here would silently drop the number
  -- rent from every margin in the report.
  if v_numbers is null then
    raise exception 'PS525-1: numbers_used is null, so number rent cannot be priced';
  end if;
end $$;

-- ===========================================================================
-- PS525-2. A workspace WITHOUT US texting reports false, so the caller can
-- tell them apart.
--
-- A constant is not a signal. If the column came back true for everybody, every
-- Canada-only workspace would be charged an imaginary $10/mo in the margin
-- report and read as unprofitable — failing in the opposite direction and just
-- as quietly.
-- ===========================================================================
do $$
declare v_us boolean;
begin
  update public.companies set us_texting_enabled = false
   where id = '52000000-0000-4000-8000-0000000000c1'::uuid;

  select us_texting_enabled into v_us from public.api_pricing_snapshot()
   where company_id = '52000000-0000-4000-8000-0000000000c1'::uuid;
  if v_us is not false then
    raise exception
      'PS525-2: a workspace with US texting off reports us_texting_enabled %', v_us;
  end if;
end $$;

rollback;
