-- D142 P01: api_ring_success, the hourly ring-success watch's numbers.
-- Suite for supabase/migrations/20261031110000_ring_success_is_counted_not_named.sql.
--
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/ring_success.test.sql
-- One transaction, rolled back. Fixtures use a 'd1a9' id prefix and times
-- relative to now(), which is fixed for the whole transaction.

\set ON_ERROR_STOP on

begin;

-- The function reads the whole fleet, so the fixtures must be all there is.
delete from public.push_attempts;
delete from public.ring_beacons;

insert into auth.users (id, email)
values ('d1a90000-0000-4000-8000-0000000000a1', 'owner@ring-success.test'),
       ('d1a90000-0000-4000-8000-0000000000a2', 'tech@ring-success.test');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values ('d1a90000-0000-4000-8000-0000000000c1', 'Ring Success Co',
        'd1a90000-0000-4000-8000-0000000000a1', 'CA', '613', now());

insert into public.company_members (company_id, user_id, role)
values ('d1a90000-0000-4000-8000-0000000000c1', 'd1a90000-0000-4000-8000-0000000000a1', 'owner'),
       ('d1a90000-0000-4000-8000-0000000000c1', 'd1a90000-0000-4000-8000-0000000000a2', 'member');

-- Owner: a phone (e1, 1.42.0), a tablet (e2, 1.41.0) and an old phone on a
-- build from before ring beacons (e6, 1.30.0).
-- Tech: a phone (e3, 1.43.0), a phone on a new build that never rings (e8,
-- 1.44.0), an iPhone (e4), a browser (e5), and a phone whose push token was
-- registered before sessions were recorded (f7, no session).
insert into public.user_sessions (session_id, user_id, client, app_version)
values ('d1a90000-0000-4000-8000-0000000000e1', 'd1a90000-0000-4000-8000-0000000000a1', 'android', '1.42.0'),
       ('d1a90000-0000-4000-8000-0000000000e2', 'd1a90000-0000-4000-8000-0000000000a1', 'android', '1.41.0'),
       ('d1a90000-0000-4000-8000-0000000000e3', 'd1a90000-0000-4000-8000-0000000000a2', 'android', '1.43.0'),
       ('d1a90000-0000-4000-8000-0000000000e4', 'd1a90000-0000-4000-8000-0000000000a2', 'ios', '2.0.1'),
       ('d1a90000-0000-4000-8000-0000000000e5', 'd1a90000-0000-4000-8000-0000000000a2', 'web', '0.18.2'),
       ('d1a90000-0000-4000-8000-0000000000e6', 'd1a90000-0000-4000-8000-0000000000a1', 'android', '1.30.0'),
       ('d1a90000-0000-4000-8000-0000000000e8', 'd1a90000-0000-4000-8000-0000000000a2', 'android', '1.44.0');

insert into public.device_push_tokens (id, user_id, platform, token, session_id)
values ('d1a90000-0000-4000-8000-0000000000f1', 'd1a90000-0000-4000-8000-0000000000a1', 'android', 'rs-token-phone', 'd1a90000-0000-4000-8000-0000000000e1'),
       ('d1a90000-0000-4000-8000-0000000000f2', 'd1a90000-0000-4000-8000-0000000000a1', 'android', 'rs-token-tablet', 'd1a90000-0000-4000-8000-0000000000e2'),
       ('d1a90000-0000-4000-8000-0000000000f3', 'd1a90000-0000-4000-8000-0000000000a2', 'android', 'rs-token-tech', 'd1a90000-0000-4000-8000-0000000000e3'),
       ('d1a90000-0000-4000-8000-0000000000f4', 'd1a90000-0000-4000-8000-0000000000a2', 'ios', 'rs-token-iphone', 'd1a90000-0000-4000-8000-0000000000e4'),
       ('d1a90000-0000-4000-8000-0000000000f6', 'd1a90000-0000-4000-8000-0000000000a1', 'android', 'rs-token-old', 'd1a90000-0000-4000-8000-0000000000e6'),
       ('d1a90000-0000-4000-8000-0000000000f7', 'd1a90000-0000-4000-8000-0000000000a2', 'android', 'rs-token-legacy', null),
       ('d1a90000-0000-4000-8000-0000000000f8', 'd1a90000-0000-4000-8000-0000000000a2', 'android', 'rs-token-new', 'd1a90000-0000-4000-8000-0000000000e8');

insert into public.push_subscriptions (id, user_id, endpoint, p256dh, auth, session_id)
values ('d1a90000-0000-4000-8000-0000000000f5', 'd1a90000-0000-4000-8000-0000000000a2',
        'https://push.example.invalid/rs', 'rs-p256dh', 'rs-auth',
        'd1a90000-0000-4000-8000-0000000000e5');

-- One ring push per call, `p_count` calls named `<p_prefix>-<n>`, each sent
-- `p_age` before now with `p_latency_ms` of provider latency.
create function pg_temp.pushes(
  p_prefix text, p_count int, p_age interval, p_user uuid, p_target uuid,
  p_platform text, p_latency_ms int default 200,
  p_response_class text default 'accepted', p_purpose text default 'ring'
) returns void
language sql
as $$
  insert into public.push_attempts
    (company_id, user_id, call_session_id, purpose, channel, platform, priority,
     response_class, http_status, latency_ms, target_id, attempted_at)
  select 'd1a90000-0000-4000-8000-0000000000c1', p_user, p_prefix || '-' || n,
         p_purpose, case when p_platform = 'web' then 'webpush' else 'fcm' end,
         p_platform, 'high', p_response_class, 200, p_latency_ms, p_target,
         now() - p_age
    from generate_series(1, p_count) n;
$$;

-- A beacon for calls `<p_prefix>-<p_from..p_to>`, `p_after` past each push's
-- attempted_at. `p_device_clock` puts that time in occurred_at and makes the
-- arrival a minute late, so only the device's clock can make it count.
create function pg_temp.beacons(
  p_prefix text, p_from int, p_to int, p_age interval, p_after interval,
  p_user uuid, p_session uuid, p_platform text, p_version text,
  p_stage text default 'ringing_shown', p_device_clock boolean default false
) returns void
language sql
as $$
  insert into public.ring_beacons
    (company_id, user_id, auth_session_id, call_session_id, platform, stage,
     app_version, occurred_at, created_at)
  select 'd1a90000-0000-4000-8000-0000000000c1', p_user, p_session,
         p_prefix || '-' || n, p_platform, p_stage, p_version,
         case when p_device_clock then now() - p_age + p_after end,
         case when p_device_clock then now() - p_age + p_after + interval '1 minute'
              else now() - p_age + p_after end
    from generate_series(p_from, p_to) n;
$$;

-- Every column of one bucket's row, compared NULL-safely: a NULL where a
-- number belongs is a failure, not a pass.
create function pg_temp.expect_row(
  p_label text, p_platform text, p_version text,
  p_attempts int, p_rang int, p_rate numeric,
  p_baseline_attempts int, p_baseline_rate numeric, p_threshold numeric,
  p_answered int, p_verdict text
) returns void
language plpgsql
as $$
declare
  r record;
begin
  select * into r from rs_result where platform = p_platform and app_version = p_version;
  if not found then
    raise exception '% FAILED: no %/% row: %', p_label, p_platform, p_version,
      (select string_agg(platform || '/' || app_version, ', ') from rs_result);
  end if;
  if (r.attempts, r.rang_in_time, r.ring_rate, r.baseline_attempts, r.baseline_rate,
      r.threshold, r.answered_sessions, r.verdict)
     is distinct from
     (p_attempts, p_rang, p_rate, p_baseline_attempts, p_baseline_rate,
      p_threshold, p_answered, p_verdict) then
    raise exception '% FAILED: %/% = %; want attempts %, rang %, rate %, baseline % at %, threshold %, answered %, verdict %',
      p_label, p_platform, p_version, r, p_attempts, p_rang, p_rate,
      p_baseline_attempts, p_baseline_rate, p_threshold, p_answered, p_verdict;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Android, owner's phone, 1.42.0: 60 attempts in the window, 35 in time.
--   rs-a 1-20    rang 5 s after the push (server arrival time)
--   rs-a 21-30   rang 5 s after by the device's clock, arrived a minute later
--   rs-slow      10 s of provider latency, rang 12 s after attempted_at: in
--                time, because attempted_at is when the send started
--   rs-late      rang 16 s after: late
--   rs-tablet    only the TABLET rang; the phone the push went to never did
--   rs-miss      no beacon at all
-- Plus ten 'gone' pushes, which are not attempts at all.
-- ---------------------------------------------------------------------------
select pg_temp.pushes('v3:rs-a', 30, interval '2 hours',
  'd1a90000-0000-4000-8000-0000000000a1', 'd1a90000-0000-4000-8000-0000000000f1', 'android');
select pg_temp.beacons('v3:rs-a', 1, 20, interval '2 hours', interval '5 seconds',
  'd1a90000-0000-4000-8000-0000000000a1', 'd1a90000-0000-4000-8000-0000000000e1', 'android', '1.42.0');
select pg_temp.beacons('v3:rs-a', 21, 30, interval '2 hours', interval '5 seconds',
  'd1a90000-0000-4000-8000-0000000000a1', 'd1a90000-0000-4000-8000-0000000000e1', 'android', '1.42.0',
  'ringing_shown', true);

select pg_temp.pushes('v3:rs-slow', 5, interval '3 hours',
  'd1a90000-0000-4000-8000-0000000000a1', 'd1a90000-0000-4000-8000-0000000000f1', 'android', 10000);
select pg_temp.beacons('v3:rs-slow', 1, 5, interval '3 hours', interval '12 seconds',
  'd1a90000-0000-4000-8000-0000000000a1', 'd1a90000-0000-4000-8000-0000000000e1', 'android', '1.42.0');

select pg_temp.pushes('v3:rs-late', 5, interval '210 minutes',
  'd1a90000-0000-4000-8000-0000000000a1', 'd1a90000-0000-4000-8000-0000000000f1', 'android');
select pg_temp.beacons('v3:rs-late', 1, 5, interval '210 minutes', interval '16 seconds',
  'd1a90000-0000-4000-8000-0000000000a1', 'd1a90000-0000-4000-8000-0000000000e1', 'android', '1.42.0');

select pg_temp.pushes('v3:rs-tablet', 5, interval '4 hours',
  'd1a90000-0000-4000-8000-0000000000a1', 'd1a90000-0000-4000-8000-0000000000f1', 'android');
select pg_temp.beacons('v3:rs-tablet', 1, 5, interval '4 hours', interval '3 seconds',
  'd1a90000-0000-4000-8000-0000000000a1', 'd1a90000-0000-4000-8000-0000000000e2', 'android', '1.41.0');

select pg_temp.pushes('v3:rs-miss', 15, interval '270 minutes',
  'd1a90000-0000-4000-8000-0000000000a1', 'd1a90000-0000-4000-8000-0000000000f1', 'android');

select pg_temp.pushes('v3:rs-gone', 10, interval '5 hours',
  'd1a90000-0000-4000-8000-0000000000a1', 'd1a90000-0000-4000-8000-0000000000f1', 'android',
  200, 'gone');

-- Not ring pushes, or not in the window: none of these may be counted.
select pg_temp.pushes('v3:rs-alert', 10, interval '2 hours',
  'd1a90000-0000-4000-8000-0000000000a1', 'd1a90000-0000-4000-8000-0000000000f1', 'android',
  200, 'accepted', 'alert');
select pg_temp.pushes('v3:rs-fresh', 10, interval '20 seconds',
  'd1a90000-0000-4000-8000-0000000000a1', 'd1a90000-0000-4000-8000-0000000000f1', 'android');
select pg_temp.pushes('v3:rs-ancient', 10, interval '9 days',
  'd1a90000-0000-4000-8000-0000000000a1', 'd1a90000-0000-4000-8000-0000000000f1', 'android');

-- Android baseline, 3 days ago: 100 judged attempts, 95 rang. Beside them, 50
-- to the pre-beacon build and 20 to the sessionless token, none of which may
-- reach the baseline.
select pg_temp.pushes('v3:rs-base', 100, interval '3 days',
  'd1a90000-0000-4000-8000-0000000000a1', 'd1a90000-0000-4000-8000-0000000000f1', 'android');
select pg_temp.beacons('v3:rs-base', 1, 95, interval '3 days', interval '4 seconds',
  'd1a90000-0000-4000-8000-0000000000a1', 'd1a90000-0000-4000-8000-0000000000e1', 'android', '1.42.0');
select pg_temp.pushes('v3:rs-oldbase', 50, interval '3 days',
  'd1a90000-0000-4000-8000-0000000000a1', 'd1a90000-0000-4000-8000-0000000000f6', 'android');
select pg_temp.pushes('v3:rs-legacybase', 20, interval '3 days',
  'd1a90000-0000-4000-8000-0000000000a2', 'd1a90000-0000-4000-8000-0000000000f7', 'android');

-- Android, tech's phone, 1.43.0: 30 attempts, all rang. Its version comes
-- from the session alone, because these beacons carry none.
select pg_temp.pushes('v3:rs-b', 30, interval '6 hours',
  'd1a90000-0000-4000-8000-0000000000a2', 'd1a90000-0000-4000-8000-0000000000f3', 'android');
select pg_temp.beacons('v3:rs-b', 1, 30, interval '6 hours', interval '2 seconds',
  'd1a90000-0000-4000-8000-0000000000a2', 'd1a90000-0000-4000-8000-0000000000e3', 'android', null);

-- Android 1.44.0: a release that never rings and so never sends a beacon.
-- Above the floor, so judged.
select pg_temp.pushes('v3:rs-new', 30, interval '390 minutes',
  'd1a90000-0000-4000-8000-0000000000a2', 'd1a90000-0000-4000-8000-0000000000f8', 'android');

-- Android 1.30.0: a build from before ring beacons. Below the floor (1.41.0,
-- the tablet's), so counted and never judged.
select pg_temp.pushes('v3:rs-old', 30, interval '7 hours',
  'd1a90000-0000-4000-8000-0000000000a1', 'd1a90000-0000-4000-8000-0000000000f6', 'android');

-- Android 'unknown': three pushes to a channel row that no longer exists, and
-- four to the sessionless token, two of which rang on a 1.43.0 build. The two
-- rings must not be filed under 1.43.0 while the two misses are not.
select pg_temp.pushes('v3:rs-u', 3, interval '7 hours',
  'd1a90000-0000-4000-8000-0000000000a2', 'd1a90000-0000-4000-8000-0000000000ff', 'android');
select pg_temp.pushes('v3:rs-legacy', 4, interval '450 minutes',
  'd1a90000-0000-4000-8000-0000000000a2', 'd1a90000-0000-4000-8000-0000000000f7', 'android');
select pg_temp.beacons('v3:rs-legacy', 1, 2, interval '450 minutes', interval '3 seconds',
  'd1a90000-0000-4000-8000-0000000000a2', null, 'android', '1.43.0');

-- iOS: 29 attempts, all rang. One short of a sample.
select pg_temp.pushes('v3:rs-i', 29, interval '8 hours',
  'd1a90000-0000-4000-8000-0000000000a2', 'd1a90000-0000-4000-8000-0000000000f4', 'ios');
select pg_temp.beacons('v3:rs-i', 1, 29, interval '8 hours', interval '6 seconds',
  'd1a90000-0000-4000-8000-0000000000a2', 'd1a90000-0000-4000-8000-0000000000e4', 'ios', '2.0.1');

-- Web: 30 attempts in the window and no history before it.
select pg_temp.pushes('v3:rs-w', 30, interval '9 hours',
  'd1a90000-0000-4000-8000-0000000000a2', 'd1a90000-0000-4000-8000-0000000000f5', 'web');
select pg_temp.beacons('v3:rs-w', 1, 27, interval '9 hours', interval '1 second',
  'd1a90000-0000-4000-8000-0000000000a2', 'd1a90000-0000-4000-8000-0000000000e5', 'web', '0.18.2');

-- Answered: two beacons for one call and one for another are two sessions.
select pg_temp.beacons('v3:rs-a', 1, 2, interval '2 hours', interval '9 seconds',
  'd1a90000-0000-4000-8000-0000000000a1', 'd1a90000-0000-4000-8000-0000000000e1', 'android', '1.42.0',
  'answered');
select pg_temp.beacons('v3:rs-a', 1, 1, interval '2 hours', interval '11 seconds',
  'd1a90000-0000-4000-8000-0000000000a1', 'd1a90000-0000-4000-8000-0000000000e1', 'android', '1.42.0',
  'answered');

create temp table rs_result on commit drop as
  select * from public.api_ring_success(now());

-- ===========================================================================
-- RS-1. Service role only, and nothing in the result can name anyone.
-- ===========================================================================
do $$
declare
  v_fn oid := 'public.api_ring_success(timestamptz)'::regprocedure;
  v_columns text;
begin
  if has_function_privilege('anon', v_fn, 'execute')
     or has_function_privilege('authenticated', v_fn, 'execute') then
    raise exception 'RS-1 FAILED: a client role can execute api_ring_success';
  end if;
  if not has_function_privilege('service_role', v_fn, 'execute') then
    raise exception 'RS-1 FAILED: service_role cannot execute api_ring_success';
  end if;
  -- A NULL acl is the default one, which lets PUBLIC execute.
  if (select p.proacl is null from pg_proc p where p.oid = v_fn)
     or exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                 where p.oid = v_fn and a.grantee = 0) then
    raise exception 'RS-1 FAILED: PUBLIC holds a grant on api_ring_success';
  end if;

  select string_agg(attname || ':' || format_type(atttypid, atttypmod), ', ' order by attnum)
    into v_columns
    from pg_attribute
   where attrelid = 'rs_result'::regclass and attnum > 0 and not attisdropped;
  if v_columns is distinct from
     'platform:text, app_version:text, attempts:integer, rang_in_time:integer, '
     'ring_rate:numeric, baseline_attempts:integer, baseline_rate:numeric, '
     'threshold:numeric, answered_sessions:integer, verdict:text' then
    raise exception 'RS-1 FAILED: result columns changed: %', v_columns;
  end if;
  raise notice 'RS-1 PASSED: service role only; platforms, versions, counts and rates only';
end $$;

-- ===========================================================================
-- RS-2. What counts as an attempt and as a ring in time; a real drop is one.
--   30 + 5 slow + 5 late + 5 tablet + 15 missed = 60, not the gone, alert,
--   last-minute or 9-day pushes. 20 by arrival, 10 by the device clock and the
--   5 slow ones = 35. Baseline 100 at 95%, not the 70 unjudged beside it.
--   t = 0.90; 0.90 - 3 * sqrt(0.09 * (1/60 + 1/100)) = 0.7530.
-- ===========================================================================
do $$
begin
  perform pg_temp.expect_row('RS-2', 'android', '1.42.0',
    60, 35, 0.5833, 100, 0.95, 0.7530, 2, 'drop');
  raise notice 'RS-2 PASSED: gone, non-ring and out-of-window pushes excluded; late and other-device rings not counted; latency not charged twice';
end $$;

-- ===========================================================================
-- RS-3. The version is the session's, whatever happened to the ring.
--   1.43.0 passes on the session's version though its beacons carry none, and
--   the two legacy rings on a 1.43.0 build are not added to it.
--   1.44.0 never sent a beacon and is above the floor: judged, and a drop.
--   0.90 - 3 * sqrt(0.09 * (1/30 + 1/100)) = 0.7127.
-- ===========================================================================
do $$
begin
  perform pg_temp.expect_row('RS-3', 'android', '1.43.0',
    30, 30, 1, 100, 0.95, 0.7127, 0, 'pass');
  perform pg_temp.expect_row('RS-3', 'android', '1.44.0',
    30, 0, 0, 100, 0.95, 0.7127, 0, 'drop');
  raise notice 'RS-3 PASSED: version from the session alone; a silent new build is a drop';
end $$;

-- ===========================================================================
-- RS-4. Pushes that cannot be judged are counted and never judged.
--   1.30.0 is below the floor: 30 missed rings it could never have reported.
--   'unknown' holds the 3 channel-less pushes and all 4 sessionless ones.
-- ===========================================================================
do $$
begin
  perform pg_temp.expect_row('RS-4', 'android', '1.30.0',
    30, 0, 0, 100, 0.95, null, 0, 'not_instrumented');
  perform pg_temp.expect_row('RS-4', 'android', 'unknown',
    7, 2, 0.2857, 100, 0.95, null, 0, 'unattributed');
  raise notice 'RS-4 PASSED: a pre-beacon build and an unknown version are reported with their n and never judged';
end $$;

-- ===========================================================================
-- RS-5. Below 30 is never a pass, and no history is not a pass either.
-- ===========================================================================
do $$
begin
  perform pg_temp.expect_row('RS-5', 'ios', '2.0.1',
    29, 29, 1, 0, null, null, 0, 'insufficient_sample');
  perform pg_temp.expect_row('RS-5', 'web', '0.18.2',
    30, 27, 0.9, 0, null, null, 0, 'no_baseline');

  if (select count(*) from rs_result) is distinct from 7::bigint then
    raise exception 'RS-5 FAILED: % rows, want 7: %', (select count(*) from rs_result),
      (select string_agg(platform || '/' || app_version, ', ') from rs_result);
  end if;
  raise notice 'RS-5 PASSED: 29 attempts is insufficient however good, and no baseline is no verdict';
end $$;

-- ===========================================================================
-- RS-6. A platform with no versioned beacon has no floor, so nothing on it is
-- judged.
-- ===========================================================================
do $$
declare
  v_verdict text;
begin
  update public.ring_beacons set app_version = null where platform = 'ios';
  select r.verdict into v_verdict
    from public.api_ring_success(now()) r
   where r.platform = 'ios' and r.app_version = '2.0.1';
  if v_verdict is distinct from 'not_instrumented' then
    raise exception 'RS-6 FAILED: iOS with no versioned beacon = %, want not_instrumented', v_verdict;
  end if;
  raise notice 'RS-6 PASSED: no beacon with a version, no floor, no verdict';
end $$;

-- ===========================================================================
-- RS-7. An empty fleet is an empty answer, not an error.
-- ===========================================================================
do $$
begin
  delete from public.push_attempts;
  delete from public.ring_beacons;
  if exists (select 1 from public.api_ring_success(now())) then
    raise exception 'RS-7 FAILED: rows from an empty ledger';
  end if;
  raise notice 'RS-7 PASSED: no evidence, no rows';
end $$;

rollback;
