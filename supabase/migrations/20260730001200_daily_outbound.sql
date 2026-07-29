-- #457 — count a tenant's outbound sends for a calendar day.
--
-- D59 already has the ceilings and `approachingCarrierCeiling(sentToday,
-- useCase)`, with the same 80% fraction every other alert arm uses. Nothing
-- calls it, because nothing counts a day.
--
-- Every metric we have is per-billing-period (`api_period_segments`) or
-- point-in-time (storage). A daily ceiling needs a daily number, and that is
-- the whole of what was missing.
--
-- ---------------------------------------------------------------------------
-- WHY THIS MATTERS MORE THAN THE POPULATION SUGGESTS.
--
-- The binding ceiling is 2,000 messages/day to T-Mobile on LOW_VOLUME, 1,000
-- for a sole proprietor, and NEITHER can be raised by vetting — the way up is
-- a fresh registration taking days. So a customer who hits it is stuck for
-- days, and today the first signal is sends failing.
--
-- Per D59 it is reachable only by a large single-day batch, so few tenants are
-- at risk. Those few are the growing crews with the most traffic and the most
-- to lose.
--
-- ---------------------------------------------------------------------------
-- SEGMENTS, NOT MESSAGES.
--
-- The carrier counts what it carries. A 300-character text is three segments
-- to T-Mobile and one row here, so counting rows would under-report by exactly
-- the factor that matters for a crew sending long messages — the crew most
-- likely to be near a ceiling in the first place.

create or replace function public.api_daily_outbound(p_since timestamptz)
returns table (
  company_id     uuid,
  use_case       text,
  sent_today     bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.company_id,
    -- The campaign's use case decides which ceiling binds. A sole proprietor
    -- is capped at half the LOW_VOLUME number, so getting this wrong warns the
    -- wrong tenants at the wrong time.
    coalesce(
      (select case when r.sole_proprietor then 'SOLE_PROPRIETOR' else 'LOW_VOLUME' end
         from public.messaging_registrations r
        where r.company_id = m.company_id and r.kind = 'campaign'
        limit 1),
      'LOW_VOLUME'
    ) as use_case,
    -- `segments` is null until the provider settles the send; treat an
    -- unsettled row as one segment rather than zero, because under-counting is
    -- the direction that fails to warn.
    sum(coalesce(m.segments, 1))::bigint as sent_today
  from public.messages m
  where m.direction = 'outbound'
    and m.created_at >= p_since
    -- What we successfully handed off. `failed` is excluded, and the honest
    -- caveat is that some failures (an `unreachable` rejection) did reach a
    -- carrier while others (`not_provisioned`, `opt_out`) never left the
    -- building. Against a 2,000/day ceiling that difference is a rounding
    -- error, and counting refusals would warn crews about traffic that never
    -- landed — the error that teaches people to ignore the warning.
    and m.status in ('queued', 'sent', 'delivered')
  group by m.company_id
  having sum(coalesce(m.segments, 1)) > 0;
$$;

comment on function public.api_daily_outbound(timestamptz) is
  '#457/D59: outbound SEGMENTS per company since a timestamp, with the '
  'campaign use case that decides which daily carrier ceiling binds.';

revoke all on function public.api_daily_outbound(timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_daily_outbound(timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- ONE WARNING PER DAY, ON THE LEDGER EVERY OTHER ALERT USES.
--
-- This arm has to run hourly to be worth anything — a tenant who crosses 80%
-- at 9am and hears about it after the nightly sweep has already hit the
-- ceiling, and the advice ("spread the rest over tomorrow") is worthless once
-- the sends have failed.
--
-- Hourly, though, means re-warning the same crew every hour for the rest of
-- the day: they cross 80%, they keep sending, and every pass sees them still
-- over. So the `usage_alerts` PK does the deduping, with the UTC DAY as the
-- period rather than the billing period. The ceiling resets on UTC midnight,
-- so the day is exactly the window the warning is true for, and tomorrow's
-- batch gets its own warning without any extra bookkeeping.
alter table public.usage_alerts drop constraint if exists usage_alerts_metric_check;
alter table public.usage_alerts add constraint usage_alerts_metric_check check (
  metric = any (array[
    'segments', 'mms_storage', 'attachment_storage', 'voice_minutes',
    'voice_minutes_grandfathered', 'mms_messages', 'egress',
    'cost_projection', 'storage_abuse', 'voice_dials', 'inbound_volume',
    -- #457: the carrier's daily ceiling. Period is the UTC day, not the
    -- billing period — the ceiling resets at UTC midnight.
    'carrier_daily'
  ])
);
