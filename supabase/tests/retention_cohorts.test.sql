-- [#327] Week-4 logo retention cohorts — assertion suite for
-- supabase/migrations/20260730130000_retention_cohorts.sql.
--
-- Most of this pins the HONESTY rather than the arithmetic, because that is
-- where #327 says the danger is: "the first misleading number will drive a bad
-- decision, which is worse than having no number." The immature-cohort
-- exclusion in particular would be invisible in review and would report ~100%
-- for the newest weeks — flattering the figure exactly when somebody looks.
--
-- One transaction, rolled back. Fixtures use a 'ca' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('ca000000-0000-4000-8000-00000000000a'::uuid, 'retention-owner@test.local');

-- Every fixture is anchored relative to now() so the suite does not rot, and
-- every one is EXACT (subscription_start_approximate defaults false) unless a
-- case deliberately tests the backfilled path.
create or replace function pg_temp.seed_company(
  p_id uuid,
  p_name text,
  p_started_days_ago int,
  p_canceled_days_after int,      -- null = never cancelled
  p_replied_days_after int,       -- null = never activated
  p_plan text,
  p_country text,
  p_internal boolean default false
) returns void language plpgsql as $$
declare
  v_started timestamptz := now() - make_interval(days => p_started_days_ago);
begin
  insert into public.companies
    (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
     subscription_status, plan, stripe_subscription_id,
     subscription_started_at, canceled_at, first_inbound_reply_at, is_internal)
  values
    (p_id, p_name, 'ca000000-0000-4000-8000-00000000000a'::uuid, p_country,
     '415', now(), 'active', p_plan::plan_id, 'sub_' || p_id::text,
     v_started,
     case when p_canceled_days_after is null then null
          else v_started + make_interval(days => p_canceled_days_after) end,
     case when p_replied_days_after is null then null
          else v_started + make_interval(days => p_replied_days_after) end,
     p_internal);
end;
$$;

-- A mature cohort, 60 days old: four workspaces, one of which churned at day 10.
select pg_temp.seed_company('ca000000-0000-4000-8000-0000000000c1'::uuid,
  'Stayed A',  60, null, 2,    'starter', 'US');
select pg_temp.seed_company('ca000000-0000-4000-8000-0000000000c2'::uuid,
  'Stayed B',  60, null, null, 'starter', 'US');
select pg_temp.seed_company('ca000000-0000-4000-8000-0000000000c3'::uuid,
  'Stayed C',  60, null, 3,    'pro',     'CA');
select pg_temp.seed_company('ca000000-0000-4000-8000-0000000000c4'::uuid,
  'Churned',   60, 10,   null, 'starter', 'US');

-- ---------------------------------------------------------------------------
-- The arithmetic.
-- ---------------------------------------------------------------------------
do $$
declare v record;
begin
  select * into v from public.api_retention_cohorts(52)
   where segment = 'all'
     and cohort_week = date_trunc('week', now() - interval '60 days')::date;
  if v.cohort_size is distinct from 4 then
    raise exception 'cohort size: expected 4, got %', v.cohort_size;
  end if;
  if v.retained is distinct from 3 then
    raise exception 'retained: expected 3, got %', v.retained;
  end if;
  if v.rate is distinct from 0.75 then
    raise exception 'rate: expected 0.7500, got %', v.rate;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- THE ONE THAT MATTERS MOST: an immature cohort is not reported at all.
--
-- A workspace three days old cannot have churned at day 28. Counting it would
-- report 100% for the newest week and pull every blended figure up, which is
-- the "misleading number" #327 warns about — and it would be least visible
-- precisely when the founder checks after shipping something.
-- ---------------------------------------------------------------------------
select pg_temp.seed_company('ca000000-0000-4000-8000-0000000000d1'::uuid,
  'Too New',    3, null, 1, 'starter', 'US');

do $$
declare v_count int;
begin
  select count(*) into v_count from public.api_retention_cohorts(52)
   where cohort_week = date_trunc('week', now() - interval '3 days')::date;
  if v_count is distinct from 0 then
    raise exception 'an immature cohort was reported (% rows)', v_count;
  end if;
end $$;

-- A cohort that has JUST matured is reported — the boundary is inclusive, so
-- day 28 counts rather than day 29.
select pg_temp.seed_company('ca000000-0000-4000-8000-0000000000d2'::uuid,
  'Just Mature', 29, null, 1, 'starter', 'US');

do $$
declare v_count int;
begin
  select count(*) into v_count from public.api_retention_cohorts(52)
   where segment = 'all'
     and cohort_week = date_trunc('week', now() - interval '29 days')::date;
  if v_count is distinct from 1 then
    raise exception 'a matured cohort was not reported (% rows)', v_count;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Cancellation exactly ON day 28 counts as RETAINED: they paid for that period.
-- Off by one here would move the headline number.
-- ---------------------------------------------------------------------------
select pg_temp.seed_company('ca000000-0000-4000-8000-0000000000e1'::uuid,
  'Left day 28', 90, 28, null, 'starter', 'US');
select pg_temp.seed_company('ca000000-0000-4000-8000-0000000000e2'::uuid,
  'Left day 27', 90, 27, null, 'starter', 'US');

do $$
declare v record;
begin
  select * into v from public.api_retention_cohorts(52)
   where segment = 'all'
     and cohort_week = date_trunc('week', now() - interval '90 days')::date;
  if v.cohort_size is distinct from 2 then
    raise exception 'day-28 cohort size: expected 2, got %', v.cohort_size;
  end if;
  if v.retained is distinct from 1 then
    raise exception 'day-28 boundary: expected 1 retained, got %', v.retained;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Activation split — the comparison #327 says is the actual question:
-- "what proportion of ACTIVATED workspaces survive to week four versus
-- non-activated ones."
--
-- D12 defines activation as a reply within SEVEN days of payment, so a reply on
-- day 9 is not activation. That boundary is the whole definition and is easy to
-- get wrong by using "has ever replied".
-- ---------------------------------------------------------------------------
select pg_temp.seed_company('ca000000-0000-4000-8000-0000000000f1'::uuid,
  'Replied day 9', 120, null, 9, 'starter', 'US');

do $$
declare v record;
begin
  select * into v from public.api_retention_cohorts(52)
   where segment = 'activated'
     and cohort_week = date_trunc('week', now() - interval '120 days')::date;
  if v.segment_value is distinct from 'not activated' then
    raise exception 'a day-9 reply counted as activated (got %)', v.segment_value;
  end if;
end $$;

do $$
declare v record;
begin
  -- The 60-day cohort: 2 activated (day 2, day 3), 2 not.
  select * into v from public.api_retention_cohorts(52)
   where segment = 'activated' and segment_value = 'activated'
     and cohort_week = date_trunc('week', now() - interval '60 days')::date;
  if v.cohort_size is distinct from 2 then
    raise exception 'activated split: expected 2, got %', v.cohort_size;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Small cohorts are MARKED, not hidden. #327: "show cohort size next to the
-- rate and refuse to imply precision it does not have."
-- ---------------------------------------------------------------------------
do $$
declare v record;
begin
  select * into v from public.api_retention_cohorts(52)
   where segment = 'all'
     and cohort_week = date_trunc('week', now() - interval '60 days')::date;
  if not v.is_small then
    raise exception 'a 4-workspace cohort was not marked small';
  end if;
  if v.is_approximate then
    raise exception 'a post-boundary cohort was marked approximate';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Our own workspaces are not customers.
-- ---------------------------------------------------------------------------
select pg_temp.seed_company('ca000000-0000-4000-8000-00000000ff01'::uuid,
  'Ours', 200, null, 1, 'pro', 'US', true);

do $$
declare v_count int;
begin
  select count(*) into v_count from public.api_retention_cohorts(52)
   where cohort_week = date_trunc('week', now() - interval '200 days')::date;
  if v_count is distinct from 0 then
    raise exception 'an internal workspace entered a cohort (% rows)', v_count;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- A workspace that never paid has no anchor and cannot be in a cohort. Without
-- this, every free signup would count as churn and understate retention.
-- ---------------------------------------------------------------------------
insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, subscription_started_at)
values
  ('ca000000-0000-4000-8000-00000000ff02'::uuid, 'Never Paid',
   'ca000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(),
   'incomplete', null);

do $$
declare v_total int; v_anchored int;
begin
  select coalesce(sum(cohort_size), 0) into v_total
    from public.api_retention_cohorts(520) where segment = 'all';
  select count(*) into v_anchored from public.companies
   where subscription_started_at is not null
     and coalesce(is_internal, false) = false
     and subscription_started_at + interval '28 days' <= now();
  if v_total is distinct from v_anchored then
    raise exception 'cohort population % <> anchored mature companies %',
      v_total, v_anchored;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- A backfilled cohort is FLAGGED. The backfill approximates the anchor from
-- created_at, and a reader must never be shown an approximated rate presented
-- as a measured one.
-- ---------------------------------------------------------------------------
insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, plan, stripe_subscription_id, subscription_started_at,
   subscription_start_approximate)
values
  ('ca000000-0000-4000-8000-00000000ff03'::uuid, 'Old Backfilled',
   'ca000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(),
   'active', 'starter', 'sub_old', now() - interval '300 days', true);

do $$
declare v record;
begin
  select * into v from public.api_retention_cohorts(5200)
   where segment = 'all'
     and cohort_week = date_trunc('week', now() - interval '300 days')::date;
  if not v.is_approximate then
    raise exception 'a backfilled cohort was not flagged approximate';
  end if;
end $$;

-- And a cohort of exact anchors is NOT flagged, however old it is. This is the
-- pair that caught the first design: approximation is a property of the ROW,
-- so a subscription that genuinely started long ago and was measured from
-- Stripe must read as exact rather than being aged into a caveat.
do $$
declare v record;
begin
  select * into v from public.api_retention_cohorts(52)
   where segment = 'all'
     and cohort_week = date_trunc('week', now() - interval '120 days')::date;
  if v.is_approximate then
    raise exception 'an exact 120-day-old cohort was flagged approximate';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The window is honoured: p_weeks bounds how far back the report reaches.
-- ---------------------------------------------------------------------------
do $$
declare v_count int;
begin
  select count(*) into v_count from public.api_retention_cohorts(4)
   where cohort_week = date_trunc('week', now() - interval '120 days')::date;
  if v_count is distinct from 0 then
    raise exception 'a cohort outside the window was returned (% rows)', v_count;
  end if;
end $$;

-- ===========================================================================
-- RC-#255. The `module` segment splits the cohort, and splits it on EVER
-- attached rather than attached now.
--
-- "Attached now" would mean "still here" — a churned workspace has its modules
-- disabled on the way out — and the segment would prove itself.
-- ===========================================================================
do $$
declare
  v_attached integer;
  v_without  integer;
  v_company  uuid;
begin
  -- Give the first eligible workspace an add-on it has since DROPPED.
  select c.id into v_company from public.companies c
   where c.subscription_started_at is not null
     and coalesce(c.is_internal, false) = false
     and c.subscription_started_at + interval '28 days' <= now()
   limit 1;
  if v_company is null then
    raise exception 'RC-255: no eligible workspace in the fixture';
  end if;

  insert into public.company_modules (company_id, module, enabled_at, disabled_at)
  values (v_company, 'regions_ca', now() - interval '60 days', now() - interval '1 day')
  on conflict (company_id, module) do update
    set disabled_at = excluded.disabled_at;

  select coalesce(sum(r.cohort_size), 0) into v_attached
    from public.api_retention_cohorts(52, 20) r
   where r.segment = 'module' and r.segment_value = 'attached an add-on';
  select coalesce(sum(r.cohort_size), 0) into v_without
    from public.api_retention_cohorts(52, 20) r
   where r.segment = 'module' and r.segment_value = 'no add-on';

  -- A DROPPED module still counts as attached: the question is whether the act
  -- of attaching predicts survival, not what is enabled today.
  if v_attached < 1 then
    raise exception 'RC-255: a dropped add-on stopped counting as ever attached';
  end if;

  -- And the segment covers everybody exactly once.
  if v_attached + v_without is distinct from (
      select coalesce(sum(r.cohort_size), 0) from public.api_retention_cohorts(52, 20) r
       where r.segment = 'all') then
    raise exception 'RC-255: the module segment does not cover the cohort exactly once';
  end if;
end $$;

rollback;
