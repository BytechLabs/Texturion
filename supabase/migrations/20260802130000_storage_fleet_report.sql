-- #240 item 4 — storage and egress as STANDING figures, not alert triggers.
--
-- `usage_alerts`'s `storage_abuse` arm tells the founder that one workspace
-- crossed 25 GB. That is a tripwire, and the issue is explicit that it is not a
-- substitute for measurement: *"we do not have growth rate per workspace,
-- egress per workspace, or cost per active workspace as standing figures.
-- Those are what a pricing conversation (#255) needs."*
--
-- The difference matters in both directions. A tripwire cannot see the
-- workspace at 8 GB growing 2 GB a week — the one that will cross every tier in
-- turn — and it cannot see the fleet-wide shape at all, which is the only view
-- that answers "what does a customer cost us". D34 took caps off the table for
-- storage deliberately; that makes seeing the cost the ONLY remaining control,
-- so it needs to be continuous rather than a thing somebody remembers to ask.
--
-- ONE ROW PER COMPANY, computed. No new table, no trigger, no write on the
-- upload path — the same posture `api_response_time_stats` takes, and for the
-- same reason: a figure derived from the rows that already exist cannot drift
-- from them.
--
-- WHY GROWTH IS A WINDOW RATHER THAN A STORED SERIES. The bytes and their
-- created_at are already in the tables, so "added in the last N days" is a
-- predicate rather than a history to maintain. A stored series would be a
-- second copy of the truth with its own backfill problem, and nothing here
-- needs a shape finer than "is this one accelerating".
create or replace function public.api_storage_fleet(
  p_days  int default 30,
  p_limit int default 200
)
returns table (
  company_id      uuid,
  company_name    text,
  stored_bytes    bigint,
  added_bytes     bigint,
  egress_bytes    bigint,
  -- CENTS, matching `UNIT_COST_CENTS` — whose values are cents even though
  -- some are fractional (storage is 2.1 c/GB/mo). Rounded rather than
  -- truncated: at these rates a whole small workspace is worth a few cents, and
  -- truncating every row toward zero would bias the fleet total downward
  -- exactly where the report is trying to be trusted.
  monthly_cost_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with window_start as (
    select now() - make_interval(days => greatest(p_days, 1)) as since
  ),
  stored as (
    select
      c.id,
      c.name,
      coalesce((
        select sum(a.size_bytes) from public.attachments a
         where a.company_id = c.id and a.deleted_at is null
      ), 0)
      + coalesce((
        select sum(m.size_bytes) from public.message_attachments m
         where m.company_id = c.id
      ), 0) as stored_bytes,
      coalesce((
        select sum(a.size_bytes) from public.attachments a, window_start w
         where a.company_id = c.id and a.deleted_at is null
           and a.created_at >= w.since
      ), 0)
      + coalesce((
        select sum(m.size_bytes) from public.message_attachments m, window_start w
         where m.company_id = c.id and m.created_at >= w.since
      ), 0) as added_bytes,
      coalesce((
        select sum(e.bytes) from public.egress_events e, window_start w
         where e.company_id = c.id and e.created_at >= w.since
      ), 0) as egress_bytes
    from public.companies c
    where c.deleted_at is null
  )
  select
    id,
    name,
    stored_bytes::bigint,
    added_bytes::bigint,
    egress_bytes::bigint,
    -- storageGbMonth 2.1 and egressGb 9, both CENTS per GB (billing/costs.ts:
    -- $0.021/GB/mo and $0.09/GB). Stored bytes are a monthly rent; egress is
    -- what the window actually spent, so the two sum to "what this workspace
    -- costs us in a month that looks like this one".
    round(
      (stored_bytes::numeric / 1073741824) * 2.1
      + (egress_bytes::numeric / 1073741824) * 9
    )::bigint
  from stored
  -- Zero-byte workspaces are the majority and say nothing; a report nobody can
  -- scan is one nobody reads.
  where stored_bytes > 0 or egress_bytes > 0
  order by
    (stored_bytes::numeric / 1073741824) * 2.1
    + (egress_bytes::numeric / 1073741824) * 9 desc
  limit greatest(p_limit, 1);
$$;

comment on function public.api_storage_fleet is
  '#240 item 4: stored bytes, bytes added in the window, egress and derived monthly cost, per workspace, ranked by cost. Standing figures rather than the tripwire `usage_alerts.storage_abuse` provides — D34 took storage caps off the table, which makes seeing the cost the only remaining control. Derived from existing rows, so it cannot drift from them.';

revoke all on function public.api_storage_fleet(int, int)
  from public, anon, authenticated;
grant execute on function public.api_storage_fleet(int, int) to service_role;
