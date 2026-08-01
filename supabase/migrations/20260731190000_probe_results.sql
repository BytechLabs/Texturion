-- #477 — synthetic probes, and the history that makes them worth reading.
--
-- WHY A NEW TABLE RATHER THAN `liveness_heartbeats`. That ledger (#387) answers
-- "did this happen recently", one row per key, overwritten each time. It is the
-- right shape for absence-detection and the wrong one for a status page: an
-- instantaneous reading cannot say "this has been fine for a week" or "this
-- failed twice yesterday", and a page that shows only NOW is a page that cannot
-- tell a blip from an outage.
--
-- THE RULE THIS EXISTS TO SATISFY. DESIGN-DIRECTION v4 §6 / QA gate 6: no
-- operational indicator may render on /status until a real probe backs it. That
-- is why probes are a prerequisite for ever showing service state rather than a
-- nice-to-have — the page currently says out loud that it is written by a
-- person, and it has to keep saying that until this table has something in it.

create table if not exists public.probe_results (
  id         uuid primary key default gen_random_uuid(),
  -- Declared in apps/api/src/observability/probes.ts. Text rather than an enum
  -- so adding a probe is a deploy, not a migration plus a deploy.
  probe      text        not null,
  ok         boolean     not null,
  -- A SHORT code when it failed: "no_token", "status_502", "cap_reached".
  -- Never a message and never a body — this table is read by a public page.
  detail     text        check (detail is null or length(detail) <= 64),
  latency_ms int         check (latency_ms is null or latency_ms >= 0),
  ran_at     timestamptz not null default now()
);

comment on table public.probe_results is
  '#477: one row per synthetic probe run. History, not state — a status page '
  'that shows only NOW cannot tell a blip from an outage.';

comment on column public.probe_results.detail is
  '#477: a short failure CODE, never a message. This table is read by a public '
  'page, so anything that could carry a customer''s number or our internals is '
  'a leak waiting for the first bad day.';

-- The two reads: "how is this probe doing lately" (the page) and "how many
-- billable runs this month" (the ceiling). Both are per-probe, newest first.
create index if not exists probe_results_probe_ran_idx
  on public.probe_results (probe, ran_at desc);

revoke all on public.probe_results from public, anon, authenticated;
grant select, insert, delete on public.probe_results to service_role;

-- ---------------------------------------------------------------------------
-- Retention.
--
-- A probe running hourly writes ~720 rows a month, forever, for a page that
-- shows the last few days. Bounded here rather than by a job, so the bound
-- cannot be forgotten when somebody adds the tenth probe.
-- ---------------------------------------------------------------------------
create or replace function public.prune_probe_results(p_keep_days int default 90)
returns int
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.probe_results
     where ran_at < now() - (greatest(p_keep_days, 1) || ' days')::interval
    returning 1
  )
  select count(*)::int from gone
$$;

revoke execute on function public.prune_probe_results(int) from public, anon, authenticated;
grant execute on function public.prune_probe_results(int) to service_role;

-- ---------------------------------------------------------------------------
-- The billable-run count, for the ceiling.
--
-- Read from the results themselves rather than a counter, so there is nothing
-- to drift and nothing to reset: a probe that ran is a row, and the ceiling
-- counts rows. Counts every ATTEMPT, not just the successes — a failed send can
-- still have reached the carrier and still be billable, so counting only
-- successes would be a ceiling that leaks.
-- ---------------------------------------------------------------------------
create or replace function public.probe_runs_this_month(p_probe text)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
    from public.probe_results
   where probe = p_probe
     and ran_at >= date_trunc('month', now())
$$;

revoke execute on function public.probe_runs_this_month(text) from public, anon, authenticated;
grant execute on function public.probe_runs_this_month(text) to service_role;

-- ---------------------------------------------------------------------------
-- RLS, per SPEC §6's deny-by-default posture (schema.test.sql T1 enforces it).
--
-- No policy is declared, which is the point: the Worker holds the service-role
-- key and bypasses RLS, and nothing else may read this table at all. A browser
-- key reaching it would learn our failure history and its timing — which is
-- reconnaissance, not a status page. What a customer sees on /status is
-- whatever the Worker chooses to publish, never the raw ledger.
-- ---------------------------------------------------------------------------
alter table public.probe_results enable row level security;
