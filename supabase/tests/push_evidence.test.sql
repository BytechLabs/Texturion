-- D142: push_attempts and ring_beacons hold evidence about a ring, never
-- anything personal, for fourteen days, and only while the member exists.
--
-- Each property is a schema property, so each is proved by trying to break it.
--
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/push_evidence.test.sql
-- Runs in one transaction and ROLLS BACK.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email)
values ('d1a80000-0000-4000-8000-000000000001', 'owner@push-evidence.test'),
       ('d1a80000-0000-4000-8000-000000000004', 'tech@push-evidence.test'),
       ('d1a80000-0000-4000-8000-000000000005', 'stranger@push-evidence.test');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values ('d1a80000-0000-4000-8000-000000000002', 'Evidence Co',
        'd1a80000-0000-4000-8000-000000000001', 'CA', '613', now());

insert into public.company_members (company_id, user_id, role)
values ('d1a80000-0000-4000-8000-000000000002', 'd1a80000-0000-4000-8000-000000000001', 'owner'),
       ('d1a80000-0000-4000-8000-000000000002', 'd1a80000-0000-4000-8000-000000000004', 'member');

-- One well-formed row of each, the shape the API writes.
create function pg_temp.attempt(
  p_user uuid,
  p_at timestamptz default now(),
  p_response_class text default 'accepted'
) returns void
language sql
as $$
  insert into public.push_attempts
    (company_id, user_id, call_session_id, purpose, channel, platform, priority,
     response_class, http_status, latency_ms, target_id, attempted_at)
  values ('d1a80000-0000-4000-8000-000000000002', p_user, 'v3:pe-session-1',
          'ring', 'fcm', 'android', 'high', p_response_class, 200, 140,
          'd1a80000-0000-4000-8000-0000000000f1', p_at);
$$;

create function pg_temp.beacon(
  p_user uuid,
  p_at timestamptz default now(),
  p_os text default 'android-15',
  p_permissions jsonb default '{"notifications":"granted","microphone":"denied"}'::jsonb,
  p_session text default 'v3:pe-session-1'
) returns void
language sql
as $$
  insert into public.ring_beacons
    (company_id, user_id, auth_session_id, call_session_id, platform, stage,
     app_version, os, permissions, standby_bucket, power_save, created_at)
  values ('d1a80000-0000-4000-8000-000000000002', p_user,
          'd1a80000-0000-4000-8000-0000000000e1', p_session, 'android',
          'ringing_shown', '1.42.0', p_os, p_permissions, 'rare', false, p_at);
$$;

-- ===========================================================================
-- PE-1. Both tables exist, are deny-by-default, and grant nothing to a client.
-- ===========================================================================
do $$
declare
  v_missing text;
  v_leaked  text;
begin
  select string_agg(t, ', ') into v_missing
    from unnest(array['push_attempts', 'ring_beacons']) t
   where not exists (select 1 from pg_tables p
                      where p.schemaname = 'public' and p.tablename = t and p.rowsecurity);
  if v_missing is not null then
    raise exception 'PE-1 FAILED: missing or without RLS: %', v_missing;
  end if;
  select string_agg(distinct table_name || ':' || grantee, ', ') into v_leaked
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('push_attempts', 'ring_beacons')
     and grantee in ('anon', 'authenticated', 'PUBLIC');
  if v_leaked is not null then
    raise exception 'PE-1 FAILED: client grants present: %', v_leaked;
  end if;
  raise notice 'PE-1 PASSED: both tables are service-role only, with RLS on';
end $$;

-- ===========================================================================
-- PE-2. Well-formed rows are accepted: the checks refuse shapes, not traffic.
-- ===========================================================================
-- Every OS shape a client sends (RingBeacons.kt, RingBeacons.swift and the
-- web's beacons.ts), so tightening the OS check cannot quietly drop a client.
do $$
declare
  v_os text;
begin
  perform pg_temp.attempt('d1a80000-0000-4000-8000-000000000004');
  perform pg_temp.beacon('d1a80000-0000-4000-8000-000000000004');
  perform pg_temp.beacon('d1a80000-0000-4000-8000-000000000004', now(), null);
  foreach v_os in array array[
    'android-34', 'android-9', 'ios-18', 'ios-17.6.1', 'ios-26.0', 'web',
    'web-macos', 'web-chrome-os', 'web-windows', 'web-android']
  loop
    perform pg_temp.beacon('d1a80000-0000-4000-8000-000000000004', now(), v_os);
  end loop;
  raise notice 'PE-2 PASSED: the shapes the API writes are accepted';
end $$;

-- ===========================================================================
-- PE-3. Anything that could carry a person is refused, and so is a web
-- channel on a phone.
-- ===========================================================================
do $$
declare
  v_case  text;
  v_cases text[] := array[
    'os_number', 'os_digits', 'os_android_digits', 'os_ios_dotted', 'os_web_digits',
    'os_device_name', 'permission_key', 'permission_value', 'permission_shape',
    'session_address', 'session_digits', 'attempt_session_digits',
    'response_class', 'channel_platform'];
  v_accepted text[] := array[]::text[];
begin
  foreach v_case in array v_cases loop
    begin
      case v_case
        when 'os_number' then
          perform pg_temp.beacon('d1a80000-0000-4000-8000-000000000004', now(), '+16135550142');
        when 'os_digits' then
          perform pg_temp.beacon('d1a80000-0000-4000-8000-000000000004', now(), '16135550142');
        when 'os_android_digits' then
          perform pg_temp.beacon('d1a80000-0000-4000-8000-000000000004', now(), 'android-6135550142');
        when 'os_ios_dotted' then
          perform pg_temp.beacon('d1a80000-0000-4000-8000-000000000004', now(), 'ios-613.555.0142');
        when 'os_web_digits' then
          perform pg_temp.beacon('d1a80000-0000-4000-8000-000000000004', now(), 'web-6135550142');
        when 'os_device_name' then
          perform pg_temp.beacon('d1a80000-0000-4000-8000-000000000004', now(), 'web-sams-iphone');
        when 'permission_key' then
          perform pg_temp.beacon('d1a80000-0000-4000-8000-000000000004', now(), 'ios-18',
            '{"contact_name":"granted"}'::jsonb);
        when 'permission_value' then
          perform pg_temp.beacon('d1a80000-0000-4000-8000-000000000004', now(), 'ios-18',
            '{"notifications":"+16135550142"}'::jsonb);
        when 'permission_shape' then
          perform pg_temp.beacon('d1a80000-0000-4000-8000-000000000004', now(), 'ios-18',
            '["granted"]'::jsonb);
        when 'session_address' then
          perform pg_temp.beacon('d1a80000-0000-4000-8000-000000000004', now(), 'ios-18',
            '{}'::jsonb, 'sip:someone@example.com');
        when 'session_digits' then
          perform pg_temp.beacon('d1a80000-0000-4000-8000-000000000004', now(), 'ios-18',
            '{}'::jsonb, '16135550123');
        when 'attempt_session_digits' then
          insert into public.push_attempts
            (company_id, user_id, call_session_id, purpose, channel, platform,
             priority, response_class, latency_ms)
          values ('d1a80000-0000-4000-8000-000000000002',
                  'd1a80000-0000-4000-8000-000000000004', '16135550123',
                  'ring', 'fcm', 'android', 'high', 'accepted', 10);
        when 'response_class' then
          perform pg_temp.attempt('d1a80000-0000-4000-8000-000000000004', now(), 'delivered to Sam');
        when 'channel_platform' then
          insert into public.push_attempts
            (company_id, user_id, purpose, channel, platform, priority,
             response_class, latency_ms)
          values ('d1a80000-0000-4000-8000-000000000002',
                  'd1a80000-0000-4000-8000-000000000004',
                  'alert', 'webpush', 'ios', 'normal', 'accepted', 10);
      end case;
      v_accepted := v_accepted || v_case;
    exception when check_violation then
      null;
    end;
  end loop;
  if cardinality(v_accepted) is distinct from 0 then
    raise exception 'PE-3 FAILED: accepted shape(s) that must be refused: %',
      array_to_string(v_accepted, ', ');
  end if;
  raise notice 'PE-3 PASSED: % personal-shaped value(s) refused by the schema', cardinality(v_cases);
end $$;

-- ===========================================================================
-- PE-4. Only a member's evidence: a row for somebody outside the workspace
-- has no membership to hang from.
-- ===========================================================================
do $$
declare
  v_refused int := 0;
begin
  begin
    perform pg_temp.attempt('d1a80000-0000-4000-8000-000000000005');
  exception when foreign_key_violation then
    v_refused := v_refused + 1;
  end;
  begin
    perform pg_temp.beacon('d1a80000-0000-4000-8000-000000000005');
  exception when foreign_key_violation then
    v_refused := v_refused + 1;
  end;
  if v_refused is distinct from 2 then
    raise exception 'PE-4 FAILED: % of 2 non-member rows were refused', v_refused;
  end if;
  raise notice 'PE-4 PASSED: evidence can only be recorded for a member';
end $$;

-- ===========================================================================
-- PE-5. Fourteen days: an aged row does not survive the next write, and a
-- row inside the window does.
--
-- The aged rows go in with the sweep switched off, which is the state of a
-- row that simply grew old: written in time, then left. The ordinary write
-- after it is what has to remove it.
-- ===========================================================================
do $$
declare
  v_old    int;
  v_recent int;
begin
  execute 'alter table public.push_attempts disable trigger push_attempts_retention';
  execute 'alter table public.ring_beacons disable trigger ring_beacons_retention';
  perform pg_temp.attempt('d1a80000-0000-4000-8000-000000000004', now() - interval '15 days');
  perform pg_temp.attempt('d1a80000-0000-4000-8000-000000000004', now() - interval '13 days');
  perform pg_temp.beacon('d1a80000-0000-4000-8000-000000000004', now() - interval '15 days');
  perform pg_temp.beacon('d1a80000-0000-4000-8000-000000000004', now() - interval '13 days');
  execute 'alter table public.push_attempts enable trigger push_attempts_retention';
  execute 'alter table public.ring_beacons enable trigger ring_beacons_retention';

  perform pg_temp.attempt('d1a80000-0000-4000-8000-000000000004');
  perform pg_temp.beacon('d1a80000-0000-4000-8000-000000000004');

  select count(*) filter (where attempted_at < now() - interval '14 days'),
         count(*) filter (where attempted_at between now() - interval '14 days'
                                                and now() - interval '12 days')
    into v_old, v_recent
    from public.push_attempts
   where company_id = 'd1a80000-0000-4000-8000-000000000002';
  if v_old is distinct from 0 or v_recent is distinct from 1 then
    raise exception 'PE-5 FAILED: push_attempts kept % aged and % in-window row(s), want 0 and 1',
      v_old, v_recent;
  end if;

  select count(*) filter (where created_at < now() - interval '14 days'),
         count(*) filter (where created_at between now() - interval '14 days'
                                              and now() - interval '12 days')
    into v_old, v_recent
    from public.ring_beacons
   where company_id = 'd1a80000-0000-4000-8000-000000000002';
  if v_old is distinct from 0 or v_recent is distinct from 1 then
    raise exception 'PE-5 FAILED: ring_beacons kept % aged and % in-window row(s), want 0 and 1',
      v_old, v_recent;
  end if;
  raise notice 'PE-5 PASSED: both tables drop rows past 14 days on the next write';
end $$;

-- ===========================================================================
-- PE-6. Break-proof for PE-5: the same sequence with the sweep left off keeps
-- the aged row, so PE-5 passed because of the trigger and not by accident.
-- ===========================================================================
do $$
declare
  v_old int;
begin
  execute 'alter table public.push_attempts disable trigger push_attempts_retention';
  perform pg_temp.attempt('d1a80000-0000-4000-8000-000000000004', now() - interval '20 days');
  perform pg_temp.attempt('d1a80000-0000-4000-8000-000000000004');
  select count(*) into v_old from public.push_attempts
   where company_id = 'd1a80000-0000-4000-8000-000000000002'
     and attempted_at < now() - interval '14 days';
  execute 'alter table public.push_attempts enable trigger push_attempts_retention';
  if v_old is distinct from 1 then
    raise exception 'PE-6 FAILED: with the sweep off % aged row(s) remained, want 1', v_old;
  end if;
  raise notice 'PE-6 PASSED: the sweep is the trigger''s doing';
end $$;

-- ===========================================================================
-- PE-7. Erased with the membership: removing the member takes their rows,
-- which is how a workspace purge reaches them. Account deletion keeps the
-- membership and erases them in delete_account (delete_account.test.sql DA-6).
-- ===========================================================================
do $$
declare
  v_left int;
begin
  delete from public.company_members
   where company_id = 'd1a80000-0000-4000-8000-000000000002'
     and user_id = 'd1a80000-0000-4000-8000-000000000004';
  select (select count(*) from public.push_attempts
           where user_id = 'd1a80000-0000-4000-8000-000000000004')
       + (select count(*) from public.ring_beacons
           where user_id = 'd1a80000-0000-4000-8000-000000000004')
    into v_left;
  if v_left is distinct from 0 then
    raise exception 'PE-7 FAILED: % row(s) outlived the membership', v_left;
  end if;
  raise notice 'PE-7 PASSED: a removed member''s evidence goes with them';
end $$;

rollback;
