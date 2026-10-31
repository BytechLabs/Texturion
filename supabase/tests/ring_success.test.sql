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

-- Owner: a phone (session e1, app 1.42.0) and a tablet (session e2, 1.41.0).
-- Tech: a phone on 1.43.0 (session e3), an iPhone (e4) and a browser (e5).
insert into public.user_sessions (session_id, user_id, client, app_version)
values ('d1a90000-0000-4000-8000-0000000000e1', 'd1a90000-0000-4000-8000-0000000000a1', 'android', '1.42.0'),
       ('d1a90000-0000-4000-8000-0000000000e2', 'd1a90000-0000-4000-8000-0000000000a1', 'android', '1.41.0'),
       ('d1a90000-0000-4000-8000-0000000000e3', 'd1a90000-0000-4000-8000-0000000000a2', 'android', '1.43.0'),
       ('d1a90000-0000-4000-8000-0000000000e4', 'd1a90000-0000-4000-8000-0000000000a2', 'ios', '2.0.1'),
       ('d1a90000-0000-4000-8000-0000000000e5', 'd1a90000-0000-4000-8000-0000000000a2', 'web', null);

insert into public.device_push_tokens (id, user_id, platform, token, session_id)
values ('d1a90000-0000-4000-8000-0000000000f1', 'd1a90000-0000-4000-8000-0000000000a1', 'android', 'rs-token-phone', 'd1a90000-0000-4000-8000-0000000000e1'),
       ('d1a90000-0000-4000-8000-0000000000f2', 'd1a90000-0000-4000-8000-0000000000a1', 'android', 'rs-token-tablet', 'd1a90000-0000-4000-8000-0000000000e2'),
       ('d1a90000-0000-4000-8000-0000000000f3', 'd1a90000-0000-4000-8000-0000000000a2', 'android', 'rs-token-tech', 'd1a90000-0000-4000-8000-0000000000e3'),
       ('d1a90000-0000-4000-8000-0000000000f4', 'd1a90000-0000-4000-8000-0000000000a2', 'ios', 'rs-token-iphone', 'd1a90000-0000-4000-8000-0000000000e4');

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

-- ---------------------------------------------------------------------------
-- Android, owner's phone, 1.42.0: 40 attempts in the window.
--   1-20  rang 5 s after the push (server arrival time)
--   21-30 rang 5 s after by the device's clock, arrived a minute later
--   31-35 latency 10 s, rang 10 s after attempted_at: 20 s after the push
--         left, so late. Counting from attempted_at would call them in time.
--   36-40 only the TABLET rang; the phone the push went to never did.
-- Plus ten 'gone' pushes, which are not attempts at all.
-- ---------------------------------------------------------------------------
select pg_temp.pushes('v3:rs-a', 30, interval '2 hours',
  'd1a90000-0000-4000-8000-0000000000a1', 'd1a90000-0000-4000-8000-0000000000f1', 'android');
select pg_temp.beacons('v3:rs-a', 1, 20, interval '2 hours', interval '5 seconds',
  'd1a90000-0000-4000-8000-0000000000a1', 'd1a90000-0000-4000-8000-0000000000e1', 'android', '1.42.0');
select pg_temp.beacons('v3:rs-a', 21, 30, interval '2 hours', interval '5 seconds',
  'd1a90000-0000-4000-8000-0000000000a1', 'd1a90000-0000-4000-8000-0000000000e1', 'android', '1.42.0',
  'ringing_shown', true);

select pg_temp.pushes('v3:rs-late', 5, interval '3 hours',
  'd1a90000-0000-4000-8000-0000000000a1', 'd1a90000-0000-4000-8000-0000000000f1', 'android', 10000);
select pg_temp.beacons('v3:rs-late', 1, 5, interval '3 hours', interval '10 seconds',
  'd1a90000-0000-4000-8000-0000000000a1', 'd1a90000-0000-4000-8000-0000000000e1', 'android', '1.42.0');

select pg_temp.pushes('v3:rs-tablet', 5, interval '4 hours',
  'd1a90000-0000-4000-8000-0000000000a1', 'd1a90000-0000-4000-8000-0000000000f1', 'android');
select pg_temp.beacons('v3:rs-tablet', 1, 5, interval '4 hours', interval '3 seconds',
  'd1a90000-0000-4000-8000-0000000000a1', 'd1a90000-0000-4000-8000-0000000000e2', 'android', '1.41.0');

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

-- Android baseline, 3 days ago: 100 attempts, 95 rang.
select pg_temp.pushes('v3:rs-base', 100, interval '3 days',
  'd1a90000-0000-4000-8000-0000000000a1', 'd1a90000-0000-4000-8000-0000000000f1', 'android');
select pg_temp.beacons('v3:rs-base', 1, 95, interval '3 days', interval '4 seconds',
  'd1a90000-0000-4000-8000-0000000000a1', 'd1a90000-0000-4000-8000-0000000000e1', 'android', '1.42.0');

-- Android, tech's phone, 1.43.0: 30 attempts, all rang. Its version comes
-- from the session alone, because these beacons carry none.
select pg_temp.pushes('v3:rs-b', 30, interval '6 hours',
  'd1a90000-0000-4000-8000-0000000000a2', 'd1a90000-0000-4000-8000-0000000000f3', 'android');
select pg_temp.beacons('v3:rs-b', 1, 30, interval '6 hours', interval '2 seconds',
  'd1a90000-0000-4000-8000-0000000000a2', 'd1a90000-0000-4000-8000-0000000000e3', 'android', null);

-- Android, a channel row that no longer exists and no beacon: 'unknown'.
select pg_temp.pushes('v3:rs-u', 3, interval '7 hours',
  'd1a90000-0000-4000-8000-0000000000a2', 'd1a90000-0000-4000-8000-0000000000ff', 'android');

-- iOS: 29 attempts, all rang. One short of a sample.
select pg_temp.pushes('v3:rs-i', 29, interval '8 hours',
  'd1a90000-0000-4000-8000-0000000000a2', 'd1a90000-0000-4000-8000-0000000000f4', 'ios');
select pg_temp.beacons('v3:rs-i', 1, 29, interval '8 hours', interval '6 seconds',
  'd1a90000-0000-4000-8000-0000000000a2', 'd1a90000-0000-4000-8000-0000000000e4', 'ios', '2.0.1');

-- Web: 30 attempts in the window and no history before it.
select pg_temp.pushes('v3:rs-w', 30, interval '9 hours',
  'd1a90000-0000-4000-8000-0000000000a2', 'd1a90000-0000-4000-8000-0000000000f5', 'web');
select pg_temp.beacons('v3:rs-w', 1, 27, interval '9 hours', interval '1 second',
  'd1a90000-0000-4000-8000-0000000000a2', 'd1a90000-0000-4000-8000-0000000000e5', 'web', null);

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
-- RS-2. What counts as an attempt and as a ring in time.
-- ===========================================================================
do $$
declare
  r record;
begin
  select * into r from rs_result where platform = 'android' and app_version = '1.42.0';
  if r is null then
    raise exception 'RS-2 FAILED: no android 1.42.0 row: %',
      (select string_agg(platform || '/' || app_version, ', ') from rs_result);
  end if;
  -- 30 + 5 late + 5 tablet. Not the gone, alert, last-minute or 9-day pushes.
  if r.attempts <> 40 then
    raise exception 'RS-2 FAILED: android 1.42.0 attempts = %, want 40', r.attempts;
  end if;
  -- 20 by arrival, 10 by the device clock. Not the late ones, not the tablet's.
  if r.rang_in_time <> 30 then
    raise exception 'RS-2 FAILED: android 1.42.0 rang_in_time = %, want 30', r.rang_in_time;
  end if;
  if r.ring_rate <> 0.75 then
    raise exception 'RS-2 FAILED: android 1.42.0 ring_rate = %, want 0.75', r.ring_rate;
  end if;
  if r.answered_sessions <> 2 then
    raise exception 'RS-2 FAILED: answered_sessions = %, want 2', r.answered_sessions;
  end if;
  raise notice 'RS-2 PASSED: gone, non-ring and out-of-window pushes excluded; late, latency and other-device rings not counted';
end $$;

-- ===========================================================================
-- RS-3. The baseline is the platform's prior week, and a real drop is one.
-- ===========================================================================
do $$
declare
  r record;
begin
  select * into r from rs_result where platform = 'android' and app_version = '1.42.0';
  if r.baseline_attempts <> 100 or r.baseline_rate <> 0.95 then
    raise exception 'RS-3 FAILED: baseline %/% , want 100 attempts at 0.95',
      r.baseline_attempts, r.baseline_rate;
  end if;
  -- 0.95 - max(0.05, 3 * sqrt(0.95 * 0.05 / 40)) = 0.95 - 0.1034
  if r.threshold <> 0.8466 then
    raise exception 'RS-3 FAILED: threshold = %, want 0.8466', r.threshold;
  end if;
  if r.verdict <> 'drop' then
    raise exception 'RS-3 FAILED: 75%% against a 95%% baseline is %, want drop', r.verdict;
  end if;

  select * into r from rs_result where platform = 'android' and app_version = '1.43.0';
  if r is null or r.attempts <> 30 or r.rang_in_time <> 30 or r.verdict <> 'pass' then
    raise exception 'RS-3 FAILED: android 1.43.0 (version from the session) = %', r;
  end if;
  raise notice 'RS-3 PASSED: drop below the margin, pass above it, version taken from the session';
end $$;

-- ===========================================================================
-- RS-4. Below 30 is never a pass, and no history is not a pass either.
-- ===========================================================================
do $$
declare
  r record;
begin
  select * into r from rs_result where platform = 'ios';
  if r is null or r.attempts <> 29 or r.rang_in_time <> 29 or r.verdict <> 'insufficient_sample'
     or r.threshold is not null then
    raise exception 'RS-4 FAILED: 29 perfect iOS rings = %, want insufficient_sample', r;
  end if;

  select * into r from rs_result where platform = 'android' and app_version = 'unknown';
  if r is null or r.attempts <> 3 or r.rang_in_time <> 0 or r.verdict <> 'insufficient_sample' then
    raise exception 'RS-4 FAILED: a push with no channel and no beacon = %, want unknown/insufficient', r;
  end if;

  select * into r from rs_result where platform = 'web';
  if r is null or r.app_version <> 'unknown' or r.attempts <> 30 or r.rang_in_time <> 27
     or r.baseline_attempts <> 0 or r.baseline_rate is not null or r.verdict <> 'no_baseline' then
    raise exception 'RS-4 FAILED: web with no history = %, want no_baseline', r;
  end if;

  if (select count(*) from rs_result) <> 5 then
    raise exception 'RS-4 FAILED: % rows, want 5: %', (select count(*) from rs_result),
      (select string_agg(platform || '/' || app_version, ', ') from rs_result);
  end if;
  raise notice 'RS-4 PASSED: 29 attempts is insufficient however good, and no baseline is no verdict';
end $$;

-- ===========================================================================
-- RS-5. An empty fleet is an empty answer, not an error.
-- ===========================================================================
do $$
begin
  delete from public.push_attempts;
  delete from public.ring_beacons;
  if exists (select 1 from public.api_ring_success(now())) then
    raise exception 'RS-5 FAILED: rows from an empty ledger';
  end if;
  raise notice 'RS-5 PASSED: no evidence, no rows';
end $$;

rollback;
