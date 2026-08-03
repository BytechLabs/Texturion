-- #304 — one definition of "what did this workspace use, between these two
-- instants".
--
-- WHY THIS EXISTS. The usage screen asks three separate questions of three
-- separate tables (usage_events for billed segments, messages for inbound
-- volume, call_records for voice), each with its own `>= p_since` and no upper
-- bound. That was fine while the only window anybody could ask about was "the
-- current period, so far". #304 asks for a bookkeeper's window — a month that
-- has already closed — and a bounded question answered by three unbounded
-- functions is three chances for the export and the screen to disagree about
-- the same workspace.
--
-- So the window becomes the parameter, and both callers ask it here.
--
-- p_to IS NULL means "up to now, open-ended", which is what the live screen
-- wants. It is deliberately not `now()`: a period that has not ended yet must
-- not be trimmed by whichever clock happened to answer, and an explicit NULL
-- says "still running" where a timestamp would quietly claim otherwise.
--
-- THE RECONCILIATION COLUMNS. usage_events.stripe_reported_at is null until
-- the meter row has been reported to Stripe. Splitting the segment total by
-- that column is the difference a bookkeeper would otherwise phone us about:
-- segments we metered in their window that are NOT yet on any Stripe invoice
-- and will land on a later one. We do not store Stripe's invoice, so this is
-- not a restatement of it — it is the ledger's own account of what has been
-- handed over and what has not.

create or replace function public.api_usage_window(
  p_company_id uuid,
  p_from       timestamptz,
  p_to         timestamptz default null
) returns table (
  outbound_segments   bigint,
  inbound_segments    bigint,
  forward_seconds     bigint,
  reported_segments   bigint,
  unreported_segments bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((
      select sum(e.quantity)
      from public.usage_events e
      where e.company_id = p_company_id
        and e.created_at >= p_from
        and (p_to is null or e.created_at <= p_to)
    ), 0)::bigint,
    -- Inbound is visibility only and has never been billed (#12), so it comes
    -- from messages rather than the meter. Segments default to 1 for rows
    -- written before the column existed, matching api_period_inbound_segments.
    coalesce((
      select sum(coalesce(m.segments, 1))
      from public.messages m
      where m.company_id = p_company_id
        and m.direction = 'inbound'
        and m.created_at >= p_from
        and (p_to is null or m.created_at <= p_to)
    ), 0)::bigint,
    -- Both dialed legs, matching the meter that bills them (20260710170000).
    coalesce((
      select sum(cr.billable_seconds)
      from public.call_records cr
      where cr.company_id = p_company_id
        and cr.leg in ('forward', 'out_customer')
        and cr.created_at >= p_from
        and (p_to is null or cr.created_at <= p_to)
    ), 0)::bigint,
    coalesce((
      select sum(e.quantity)
      from public.usage_events e
      where e.company_id = p_company_id
        and e.created_at >= p_from
        and (p_to is null or e.created_at <= p_to)
        and e.stripe_reported_at is not null
    ), 0)::bigint,
    coalesce((
      select sum(e.quantity)
      from public.usage_events e
      where e.company_id = p_company_id
        and e.created_at >= p_from
        and (p_to is null or e.created_at <= p_to)
        and e.stripe_reported_at is null
    ), 0)::bigint
$$;

revoke execute on function public.api_usage_window(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_usage_window(uuid, timestamptz, timestamptz)
  to service_role;
