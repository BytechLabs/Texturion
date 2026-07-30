-- [#327] D12's second target, made reportable.
--
-- D12 commits to two numbers in writing:
--
--   "Target: 60% of paying signups activated in week 1; week-4 logo retention
--    >= 85%."
--
-- #281 fixed the activation numerator (companies.first_inbound_reply_at). The
-- retention half had nothing at all behind it: the raw material existed —
-- subscription status, cancellations — and nothing joined them into a cohort.
-- So we could not say what week-4 retention was, whether it cleared 85%,
-- whether it was moving, or whether any work in the backlog had touched it.
--
-- ---------------------------------------------------------------------------
-- THE MISSING PIECE WAS AN ANCHOR, NOT A QUERY.
--
-- A cohort needs the date the workspace STARTED PAYING, and no column held it:
--
--   * `created_at`            signup, which precedes payment
--   * `current_period_start`  advances every month, so it cannot anchor anything
--   * the funnel events       live in PostHog, not in Postgres, so they cannot
--                             be joined against subscription dates in SQL
--
-- Hence `subscription_started_at`, stamped once, guarded on null, never moved —
-- the same shape #281 chose for `first_inbound_reply_at` and for the same
-- stated reason: "a stamped column answers it in one indexed write".
--
-- It is stamped from Stripe's own `subscription.start_date` rather than from
-- `now()`. A replayed webhook must not move the anchor, and Stripe's value is
-- the authoritative start regardless of when we hear about it.

alter table public.companies
  add column if not exists subscription_started_at timestamptz;

comment on column public.companies.subscription_started_at is
  'When this workspace first had an ACTIVE subscription — the cohort anchor for D12 week-4 retention (#327). Stamped once from Stripe''s subscription.start_date, guarded on null, never moved: a replayed webhook must not shift a cohort. Null means never paid, and those workspaces are outside every retention figure by definition. Rows that existed before this column was added were backfilled from created_at and carry subscription_start_approximate = true.';

-- Whether THIS row's anchor was guessed. A property of the row, not of the
-- date: a subscription that genuinely started sixty days ago and is stamped
-- from Stripe today is EXACT, and a date-boundary test would call it
-- approximate forever. The first draft did exactly that, and the assertion
-- suite caught it.
alter table public.companies
  add column if not exists subscription_start_approximate boolean not null default false;

comment on column public.companies.subscription_start_approximate is
  'True when subscription_started_at was backfilled from created_at rather than measured from Stripe (#327). Set only by the backfill below; anything stamped by the webhook is exact and keeps the default false. Reported per cohort so a reader is never shown an approximated rate presented as a measured one.';

-- BACKFILL, and the honesty about it belongs here rather than in a comment
-- nobody reads next to a number.
--
-- Existing rows cannot know when they first paid; the event was not recorded.
-- `created_at` is the best available proxy and it is a GOOD one in this
-- product specifically: checkout happens inside onboarding, so signup and first
-- payment are usually minutes apart rather than days. It is still an
-- approximation, and `api_retention_cohorts` marks the affected cohorts so a
-- reader is never shown an approximated rate presented as measured.
update public.companies
   set subscription_started_at = created_at,
       subscription_start_approximate = true
 where subscription_started_at is null
   and stripe_subscription_id is not null;

-- Partial: rows WITHOUT an anchor never appear in a cohort, so indexing them
-- is dead weight.
create index if not exists companies_subscription_started_at_idx
  on public.companies (subscription_started_at)
  where subscription_started_at is not null;

-- ---------------------------------------------------------------------------
-- WEEK-4 LOGO RETENTION, BY COHORT, WITH THE CAVEATS ATTACHED TO THE ROW.
--
-- #327's sharpest requirement is not the number, it is the honesty around it:
--
--   "a 70% week-4 figure from eleven workspaces is not evidence of anything.
--    The report should show cohort size next to the rate and refuse to imply
--    precision it does not have — otherwise the first misleading number will
--    drive a bad decision, which is worse than having no number."
--
-- So every row carries `cohort_size`, `is_small`, and `is_approximate`, and a
-- rate is NULL rather than 0 when there is nothing to divide. A caller cannot
-- read the rate without also receiving what is wrong with it.
--
-- IMMATURE COHORTS ARE EXCLUDED, which matters more than it sounds. A cohort
-- four days old has had no opportunity to churn at week four, so including it
-- would report ~100% and drag the average up exactly when the founder is most
-- likely to be looking. Only cohorts whose 28th day has passed are returned.
-- ---------------------------------------------------------------------------

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
        where m.company_id = c.id and m.deactivated_at is null) > 1 as is_crew
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
  'D12 week-4 logo retention by signup cohort, segmented, with cohort size and the caveats attached to each row (#327). Only MATURE cohorts (28 days elapsed) are returned — an immature one reports ~100% and would flatter the average exactly when somebody is looking. is_small marks cohorts too thin to read; is_approximate marks cohorts containing any workspace whose anchor was backfilled from created_at rather than measured.';

revoke all on function public.api_retention_cohorts(int, int) from public, anon, authenticated;
grant execute on function public.api_retention_cohorts(int, int) to service_role;
