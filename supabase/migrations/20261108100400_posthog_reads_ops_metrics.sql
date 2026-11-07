-- D146 / D147: the state of record PostHog's dashboards read.
--
-- The call, message and storage events say what happened. What is true right
-- now (which calls are still open, how many bytes the buckets hold) lives in
-- this database, and PostHog reads it live through its own Postgres source.
-- These views are what that source reads, and `posthog_reader` is its login.
-- Nothing of ours schedules the read or keeps any state: a view is computed
-- when PostHog queries it.
--
-- WHAT A VIEW MAY CARRY. Identifiers PostHog already holds (the workspace uuid
-- every workspace event is sent under, a call's own uuid and its session id),
-- states, directions, timings, counts and byte totals. No number, name, body,
-- object path, payload, recording or transcript. posthog_reader.test.sql holds
-- every view in the schema to that, including views added later.
--
-- WHY SECURITY BARRIER. As with ops_diag: the views run with their owner's
-- rights, which is how posthog_reader reads them with no grant on the tables
-- under them, and a barrier stops a function in the reader's own query from
-- seeing rows a view's filter excludes.
--
-- THE LOGIN HAS NO PASSWORD HERE. A migration is public. The founder sets the
-- password once in production and enters it in PostHog's source form
-- (docs/MONITORING.md, "Postgres source"); until then the role cannot log in.

create schema if not exists ops_metrics;
revoke all on schema ops_metrics from public;
comment on schema ops_metrics is
  'D146: aggregate and non-personal views PostHog''s Postgres source reads, as posthog_reader.';

-- A call the record still shows open: no outcome, and the call engine's mirror
-- not yet terminal. The API hangs up any call open past two hours, and the
-- stale-call sweep gives one with no outcome after four hours "missed".
create view ops_metrics.calls_in_progress with (security_barrier = true) as
select
  c.id              as call_id,
  c.call_session_id,
  c.company_id      as workspace_id,
  c.direction,
  c.state,
  c.started_at,
  c.answered_at,
  extract(epoch from now() - c.started_at)::int as seconds_running
from public.calls c
where c.outcome is null
  and (c.state is null or c.state not like 'ended_%');

-- A call that should have finished on the record and has not:
--   open_past_ceiling      still open fifteen minutes after the two-hour
--                          ceiling at which the API hangs it up;
--   ended_without_outcome  the engine ended it, and the outcome write was lost
--                          for longer than the sweep's five minutes.
create view ops_metrics.stuck_calls with (security_barrier = true) as
select
  c.id              as call_id,
  c.call_session_id,
  c.company_id      as workspace_id,
  c.direction,
  c.state,
  c.started_at,
  c.answered_at,
  extract(epoch from now() - c.started_at)::int as seconds_running,
  case when c.state like 'ended_%' then 'ended_without_outcome' else 'open_past_ceiling' end as reason
from public.calls c
where c.outcome is null
  and (
    (c.state like 'ended_%' and c.started_at < now() - interval '15 minutes')
    or ((c.state is null or c.state not like 'ended_%')
        and coalesce(c.answered_at, c.created_at) < now() - interval '135 minutes')
  );

-- Every bucket's bytes, from the object metadata the Storage API writes. The
-- sum is what Supabase counts against the plan's included storage.
create view ops_metrics.storage_in_use with (security_barrier = true) as
select
  o.bucket_id,
  count(*)::bigint                                          as objects,
  coalesce(sum((o.metadata ->> 'size')::bigint), 0)::bigint as bytes
from storage.objects o
group by o.bucket_id;

-- Bytes added per UTC day over 90 days, by bucket, counting the objects that
-- are still stored: a deleted object leaves its day's total.
create view ops_metrics.storage_added_by_day with (security_barrier = true) as
select
  (o.created_at at time zone 'UTC')::date                   as day,
  o.bucket_id,
  count(*)::bigint                                          as objects,
  coalesce(sum((o.metadata ->> 'size')::bigint), 0)::bigint as bytes
from storage.objects o
where o.created_at >= now() - interval '90 days'
group by 1, 2;

-- Texts per hour over 35 days by direction and current status, from the
-- record, so the dashboard has history from before the message events.
create view ops_metrics.message_counts_by_hour with (security_barrier = true) as
select
  date_trunc('hour', m.created_at)           as hour,
  m.direction,
  m.status,
  count(*)::int                              as messages,
  coalesce(sum(m.segments), 0)::int          as segments
from public.messages m
where m.direction in ('inbound', 'outbound')
  and m.created_at >= now() - interval '35 days'
group by 1, 2, 3;

-- Nothing here is for a browser, and the schema grants no client USAGE either.
revoke all on all tables in schema ops_metrics from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The login. Created only if absent: roles belong to the cluster, so a local
-- `supabase db reset` finds the previous run's role still there. A role made
-- after 20261031100000 has no TEMP.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'posthog_reader') then
    create role posthog_reader with
      login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls
      connection limit 5;
  end if;
end $$;

-- Defaults for an honest client, like agent_diag's: PostHog's queries read a
-- few small views, so each bound is generous for them and short for anything
-- else. The controls are the absent grants and the connection limit.
alter role posthog_reader set default_transaction_read_only = on;
alter role posthog_reader set statement_timeout = '30s';
alter role posthog_reader set idle_in_transaction_session_timeout = '30s';
alter role posthog_reader set transaction_timeout = '60s';
alter role posthog_reader set search_path = ops_metrics;

grant usage on schema ops_metrics to posthog_reader;
grant select on all tables in schema ops_metrics to posthog_reader;
