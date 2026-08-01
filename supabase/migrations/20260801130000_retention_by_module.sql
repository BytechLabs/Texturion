-- #255 — retention, segmented by whether an add-on was ever attached.
--
-- ---------------------------------------------------------------------------
-- THE QUESTION, AND THE TRAP IN IT
--
-- #255 asks for "cohort retention by plan and by module, so we can see whether
-- an attached module actually predicts survival or merely correlates with a
-- customer who was going to stay anyway".
--
-- Plan, country and crew size are already segments here (#327/#370). Module was
-- not, and it is the one with commercial weight: if attaching an add-on
-- predicts survival, the pricing question becomes "how do we get more
-- workspaces to attach one" rather than "what should the plan cost".
--
-- The trap is in the issue's own wording, and it is why this supplies only the
-- SEGMENT and never a verdict. A module attached by a workspace that was always
-- going to stay says nothing about the module. Correlation here is cheap and
-- causation is unavailable at this base size, so the report shows the two rates
-- side by side with their denominators and stops — and `is_small` already marks
-- the rows nobody should read.
--
-- ---------------------------------------------------------------------------
-- "EVER ATTACHED", NOT "ATTACHED NOW"
--
-- Measured on the row's existence regardless of `disabled_at`, deliberately. A
-- workspace that attached the CA module and later dropped it DID attach one,
-- and folding it in with the never-attached would answer a different question:
-- it would compare current state, when what is asked is whether the ACT of
-- attaching predicts anything.
--
-- It also avoids a circularity that would flatter the number. A workspace that
-- churned has its modules disabled on the way out, so "attached now" would mean
-- "still here" and the segment would prove itself.
--
-- ---------------------------------------------------------------------------
-- REPLACING THE WHOLE FUNCTION, WITH BOTH PARAMETERS
--
-- The first draft of this migration declared `(p_weeks integer)` and created a
-- SECOND function rather than replacing the `(p_weeks, p_small_cohort)` one —
-- `create or replace` matches on the argument list, so a shortened signature is
-- a new overload, and every later call became "function is not unique". Stated
-- here because the failure is silent until something calls it.

drop function if exists public.api_retention_cohorts(integer);

create or replace function public.api_retention_cohorts(
  p_weeks int default 12,
  -- Below this, a rate is noise dressed as a measurement. Twenty is the point
  -- at which a single churn moves the figure by less than five points.
  p_small_cohort int default 20
)
returns table (
  cohort_week date,
  segment text,
  segment_value text,
  cohort_size int,
  retained int,
  rate numeric,
  is_small boolean,
  is_approximate boolean
)
language sql
security definer
set search_path = ''
as $$
  with eligible as (
    select
      c.id,
      date_trunc('week', c.subscription_started_at)::date as cohort_week,
      c.subscription_started_at as started_at,
      -- RETAINED = had not cancelled before day 28. `canceled_at` is stamped by
      -- the §9 machinery; a null one has never cancelled. A cancellation dated
      -- ON day 28 counts as retained — the customer paid for that period.
      (c.canceled_at is null
        or c.canceled_at >= c.subscription_started_at + interval '28 days') as retained,
      -- D12 activation: "sends its first outbound SMS AND receives an inbound
      -- reply within 7 days of payment". `first_inbound_reply_at` already
      -- encodes the AND — #281 stamps it only on a reply to a thread we texted,
      -- deliberately, so an inbound on a customer-started thread cannot inflate
      -- it. So the reply timestamp alone is the whole definition.
      (c.first_inbound_reply_at is not null
        and c.first_inbound_reply_at
              <= c.subscription_started_at + interval '7 days') as activated,
      coalesce(c.plan::text, 'none') as plan,
      c.country,
      c.subscription_start_approximate as approximate,
      (select count(*) from public.company_members m
        where m.company_id = c.id and m.deactivated_at is null) > 1 as is_crew,
      -- #255: EVER attached, not attached now. See the header.
      exists (select 1 from public.company_modules cm
               where cm.company_id = c.id) as ever_attached_module
    from public.companies c
    where c.subscription_started_at is not null
      -- Our own workspaces are not customers and would flatter every figure.
      and coalesce(c.is_internal, false) = false
      -- MATURE ONLY: a cohort that has not reached day 28 cannot have churned
      -- at day 28, and including it reports ~100% for the newest weeks.
      and c.subscription_started_at + interval '28 days' <= now()
      and c.subscription_started_at >= now() - make_interval(weeks => p_weeks)
  ),
  -- One row per (cohort, segment, value). Unioned rather than pivoted so a new
  -- segment is one more select and the shape never changes.
  tagged as (
    select cohort_week, retained, approximate, 'all' as segment, 'all' as segment_value from eligible
    union all
    select cohort_week, retained, approximate, 'activated',
           case when activated then 'activated' else 'not activated' end from eligible
    union all
    select cohort_week, retained, approximate, 'plan', plan from eligible
    union all
    select cohort_week, retained, approximate, 'country', country from eligible
    union all
    select cohort_week, retained, approximate, 'crew',
           case when is_crew then 'crew' else 'solo' end from eligible
    union all
    select cohort_week, retained, approximate, 'module',
           case when ever_attached_module then 'attached an add-on'
                else 'no add-on' end from eligible
  )
  select
    t.cohort_week,
    t.segment,
    t.segment_value,
    count(*)::int as cohort_size,
    count(*) filter (where t.retained)::int as retained,
    -- NULL, not 0, when there is nothing to divide: a zero rate and an unknown
    -- rate are different facts and a chart that conflates them lies quietly.
    case when count(*) = 0 then null
         else round(count(*) filter (where t.retained)::numeric / count(*), 4)
    end as rate,
    count(*) < p_small_cohort as is_small,
    bool_or(t.approximate) as is_approximate
  from tagged t
  group by t.cohort_week, t.segment, t.segment_value
  order by t.cohort_week desc, t.segment, t.segment_value;
$$;

comment on function public.api_retention_cohorts is
  'D12 week-4 logo retention by signup cohort, segmented, with cohort size and the caveats attached to each row (#327). Only MATURE cohorts (28 days elapsed) are returned — an immature one reports ~100% and would flatter the average exactly when somebody is looking. is_small marks cohorts too thin to read; is_approximate marks cohorts containing any workspace whose anchor was backfilled from created_at rather than measured. #255 adds the `module` segment: whether an add-on was EVER attached, which is not the same question as whether one is attached now.';

revoke all on function public.api_retention_cohorts(int, int) from public, anon, authenticated;
grant execute on function public.api_retention_cohorts(int, int) to service_role;
