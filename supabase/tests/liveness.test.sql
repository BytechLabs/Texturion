-- #387 — the liveness ledger: noticing that an expected thing did not happen.
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run: psql -v ON_ERROR_STOP=1 -f supabase/tests/liveness.test.sql
-- The whole suite runs in one transaction and ROLLS BACK.
--
-- What this suite is really guarding: an alerting channel is only worth having
-- if it is believed. Every test below is about the alert being TRUE — not
-- firing on first deploy, not firing every fifteen minutes for a week, not
-- staying silent after a real outage, and not going quiet without saying so.
-- A founder who learns to ignore this mailbox is worse off than one who never
-- had it, because they now think they are covered.

\set ON_ERROR_STOP on

begin;

-- A stand-in for what the Worker passes: two keys, different patience.
create or replace function pg_temp.expectations()
returns jsonb language sql immutable as $$
  select jsonb_build_array(
    jsonb_build_object('key', 'test:fast', 'what', 'The fast thing has not happened.',
                       'every_minutes', 5,  'grace_minutes', 5),
    jsonb_build_object('key', 'test:slow', 'what', 'The slow thing has not happened.',
                       'every_minutes', 60, 'grace_minutes', 60))
$$;

-- ===========================================================================
-- LV-1. A heartbeat records that something happened, and reports that this
--       was NOT a recovery — there was no outage to recover from.
-- ===========================================================================
do $$
declare r jsonb; seen timestamptz;
begin
  r := public.record_heartbeat('test:fast', now());
  select last_seen_at into seen from public.liveness_heartbeats where key = 'test:fast';

  if seen is null then
    raise exception 'LV-1 FAILED: the heartbeat recorded nothing';
  end if;
  if (r->>'recovered')::boolean then
    raise exception 'LV-1 FAILED: a first heartbeat claimed to be a recovery';
  end if;

  raise notice 'LV-1 PASSED: a heartbeat records the occurrence';
end $$;

-- ===========================================================================
-- LV-2. A key that has NEVER been seen is SEEDED, not alerted.
--
--       This is the state of every key the moment this ships. Alerting on it
--       would send the founder a wall of email on the first deploy, about
--       nothing, which is precisely how somebody learns to filter the one
--       channel that exists to be believed.
-- ===========================================================================
do $$
declare r jsonb;
begin
  delete from public.liveness_heartbeats where key in ('test:fast', 'test:slow');

  r := public.api_liveness_check(pg_temp.expectations(), now(), 360);

  if jsonb_array_length(r->'overdue') is distinct from 0 then
    raise exception 'LV-2 FAILED: an unseen key alerted on its first check: %', r->'overdue';
  end if;
  if jsonb_array_length(r->'seeded') is distinct from 2 then
    raise exception 'LV-2 FAILED: expected 2 seeded keys, got %', r->'seeded';
  end if;
  if (select count(*) from public.liveness_heartbeats
       where key in ('test:fast','test:slow')) is distinct from 2 then
    raise exception 'LV-2 FAILED: seeding did not write the rows';
  end if;

  raise notice 'LV-2 PASSED: a never-seen key is seeded quietly, not alerted';
end $$;

-- ===========================================================================
-- LV-3. Overdue means the promised cadence PLUS the grace it was given, and
--       the grace is per-key. At 20 minutes stale the fast thing (5+5) is
--       overdue and the slow one (60+60) is not — one clock must not drag the
--       other with it.
-- ===========================================================================
do $$
declare r jsonb;
begin
  update public.liveness_heartbeats
     set last_seen_at = now() - interval '20 minutes', alerting = false, last_alerted_at = null
   where key in ('test:fast','test:slow');

  r := public.api_liveness_check(pg_temp.expectations(), now(), 360);

  if not (r->'overdue' @> '[{"key":"test:fast"}]'::jsonb) then
    raise exception 'LV-3 FAILED: a 20-minute-stale 5-minute job was not overdue: %', r;
  end if;
  if r->'overdue' @> '[{"key":"test:slow"}]'::jsonb then
    raise exception 'LV-3 FAILED: a 20-minute-stale HOURLY job was reported overdue: %', r;
  end if;
  if not (r->'overdue' @> '[{"key":"test:fast","first_alert":true}]'::jsonb) then
    raise exception 'LV-3 FAILED: the first alert was not marked as the first: %', r;
  end if;

  raise notice 'LV-3 PASSED: overdue respects each key''s own cadence and grace';
end $$;

-- ===========================================================================
-- LV-4. It shouts ONCE, then holds its tongue until the re-alert window.
--
--       The checker runs every fifteen minutes. Without this, one stopped cron
--       is ninety-six emails a day, and the ninety-seventh is the one about a
--       different outage that nobody opens.
-- ===========================================================================
do $$
declare r jsonb;
begin
  -- Still overdue, and we just alerted in LV-3.
  r := public.api_liveness_check(pg_temp.expectations(), now(), 360);
  if jsonb_array_length(r->'overdue') is distinct from 0 then
    raise exception 'LV-4 FAILED: it alerted again immediately: %', r->'overdue';
  end if;

  -- Past the re-alert window it speaks up again, because an outage that is
  -- still happening tomorrow is news again tomorrow.
  r := public.api_liveness_check(pg_temp.expectations(), now() + interval '7 hours', 360);
  if not (r->'overdue' @> '[{"key":"test:fast"}]'::jsonb) then
    raise exception 'LV-4 FAILED: a still-broken thing went permanently quiet: %', r;
  end if;
  -- Keyed, not "any entry": seven hours on, the SLOW key is legitimately
  -- overdue for the first time too, so an unkeyed match reads its honest
  -- first_alert and reports a failure that is not one.
  if not (r->'overdue' @> '[{"key":"test:fast","first_alert":false}]'::jsonb) then
    raise exception 'LV-4 FAILED: a repeat alert claimed to be the first: %', r;
  end if;

  raise notice 'LV-4 PASSED: one alert per outage per window, and it does resume';
end $$;

-- ===========================================================================
-- LV-5. A heartbeat during an outage ENDS it and says so.
--
--       The recovery signal is load-bearing: without it the founder is told
--       something broke and never told it came back, so every later alert is
--       read against an unknown baseline. It is also the exact bug the first
--       draft of record_heartbeat had — `returning` on an upsert reports the
--       row AFTER the update, so the flag was always already false.
-- ===========================================================================
do $$
declare r jsonb; still boolean;
begin
  if not (select alerting from public.liveness_heartbeats where key = 'test:fast') then
    raise exception 'LV-5 FAILED: fixture wrong — test:fast should be alerting here';
  end if;

  r := public.record_heartbeat('test:fast', now());

  if not (r->>'recovered')::boolean then
    raise exception 'LV-5 FAILED: the heartbeat that ended the outage did not report it';
  end if;
  select alerting into still from public.liveness_heartbeats where key = 'test:fast';
  if still then
    raise exception 'LV-5 FAILED: still marked alerting after a heartbeat';
  end if;

  -- And a second heartbeat is not a second recovery.
  r := public.record_heartbeat('test:fast', now());
  if (r->>'recovered')::boolean then
    raise exception 'LV-5 FAILED: an ordinary heartbeat claimed to be a recovery';
  end if;

  raise notice 'LV-5 PASSED: a heartbeat ends the outage and reports it exactly once';
end $$;

-- ===========================================================================
-- LV-6. last_seen_at never goes BACKWARDS.
--
--       Cron runs can arrive out of order (a retried invocation, a clock
--       carried in from the trigger). Letting an older stamp win would age a
--       healthy key into a false alarm — and a false alarm costs more than the
--       outage, because it is how this mailbox stops being read.
-- ===========================================================================
do $$
declare before_at timestamptz; after_at timestamptz;
begin
  select last_seen_at into before_at from public.liveness_heartbeats where key = 'test:fast';
  perform public.record_heartbeat('test:fast', before_at - interval '3 hours');
  select last_seen_at into after_at from public.liveness_heartbeats where key = 'test:fast';

  if after_at < before_at then
    raise exception 'LV-6 FAILED: an older heartbeat moved the clock back from % to %',
      before_at, after_at;
  end if;

  raise notice 'LV-6 PASSED: an out-of-order heartbeat cannot age a healthy key';
end $$;

-- ===========================================================================
-- LV-7. Grants. Both functions read and write platform-wide state with no
--       tenant scoping whatsoever, so an authenticated caller reaching either
--       one could read the shape of our whole cron schedule, or silence an
--       alert by forging a heartbeat.
-- ===========================================================================
do $$
declare bad text; rls boolean;
begin
  select string_agg(format('%s→%s', p.proname, g.grantee), ', ') into bad
    from information_schema.role_routine_grants g
    join pg_proc p on p.proname = g.routine_name
   where g.routine_schema = 'public'
     and p.proname in ('record_heartbeat', 'api_liveness_check')
     and g.grantee in ('PUBLIC', 'anon', 'authenticated');
  if bad is not null then
    raise exception 'LV-7 FAILED: liveness functions are reachable: %', bad;
  end if;

  select relrowsecurity into rls from pg_class where oid = 'public.liveness_heartbeats'::regclass;
  if not rls then
    raise exception 'LV-7 FAILED: liveness_heartbeats has RLS disabled';
  end if;

  raise notice 'LV-7 PASSED: the ledger and its functions are service_role only';
end $$;

rollback;
