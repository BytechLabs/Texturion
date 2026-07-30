-- [#339] App version reporting and the update policy — assertion suite for
-- supabase/migrations/20260730000100_app_version.sql.
--
-- The issue's devil's advocate names the real danger, and it is the floor:
-- "blocking a plumber's business line because they are two versions behind,
-- while they are standing in a customer's basement, is a worse outcome than
-- most of the bugs it would protect them from — and if the floor is ever
-- misconfigured, it locks out every user at once with no way in to fix it".
--
-- So most of what is pinned here is about NOT locking people out: that a
-- malformed version can never read as newer, that a floor above the
-- recommended version is refused outright, that a missing header never erases
-- what we already knew, and that the blast radius is computed before the
-- decision rather than discovered after it.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/app_version.test.sql
--
-- One transaction, rolled back. Fixtures use a 'bd' id prefix so the file
-- runs standalone OR after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('bd000000-0000-4000-8000-00000000000a'::uuid, 'ver-a@test.local'),
  ('bd000000-0000-4000-8000-00000000000b'::uuid, 'ver-b@test.local');

-- ---------------------------------------------------------------------------
-- version_key: the comparison every other assertion rests on.
-- ---------------------------------------------------------------------------

do $$
begin
  -- The string-compare trap, which is the whole reason this function exists.
  if not (public.version_key('1.10.0') > public.version_key('1.9.0')) then
    raise exception '1.10.0 must be newer than 1.9.0 — string ordering says otherwise';
  end if;

  -- Shorter versions pad with zeros rather than sorting arbitrarily.
  if not (public.version_key('2') = public.version_key('2.0.0.0')) then
    raise exception '2 and 2.0.0.0 must compare equal';
  end if;
  if not (public.version_key('1.2.3') > public.version_key('1.2')) then
    raise exception '1.2.3 must be newer than 1.2';
  end if;

  -- Anything unparseable is NULL, never a number. A version that compared as
  -- newer by accident would silently exempt a client from every floor.
  if public.version_key('1.2.3-beta') is not null then
    raise exception 'a suffixed version must not parse';
  end if;
  if public.version_key('not-a-version') is not null then
    raise exception 'garbage must not parse';
  end if;
  if public.version_key(null) is not null then
    raise exception 'null must not parse';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The policy table ships inert.
-- ---------------------------------------------------------------------------

do $$
declare
  v_rows int;
  v_set  int;
begin
  select count(*), count(minimum_version) into v_rows, v_set
    from public.app_release_policy;

  if v_rows <> 3 then
    raise exception 'expected one policy row per platform, found %', v_rows;
  end if;
  -- The mechanism exists and demands nothing until somebody decides otherwise.
  if v_set <> 0 then
    raise exception 'migration must ship with every floor NULL, found % set', v_set;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- A floor above the ask is refused by the database itself.
-- ---------------------------------------------------------------------------

do $$
begin
  begin
    update public.app_release_policy
       set recommended_version = '1.2.0', minimum_version = '1.5.0'
     where platform = 'ios';
    raise exception 'a minimum above the recommended version must be rejected';
  exception
    when check_violation then null;  -- expected
  end;
end $$;

-- ---------------------------------------------------------------------------
-- The version rides the authorize round trip.
-- ---------------------------------------------------------------------------

do $$
declare
  v_session uuid := 'bd000000-0000-4000-8000-0000000000c1'::uuid;
  v_user    uuid := 'bd000000-0000-4000-8000-00000000000a'::uuid;
  v_got     text;
begin
  perform public.api_authorize_request(
    v_user, v_session, null, 'ios', 'CFNetwork', 'CA', 'ON', 'Toronto', '1.4.0'
  );

  select app_version into v_got from public.user_sessions where session_id = v_session;
  if v_got is distinct from '1.4.0' then
    raise exception 'first sight must record the version, got %', coalesce(v_got, '<null>');
  end if;

  -- A request with no header must not erase what we already learned. The
  -- update branch is throttled to two minutes, so age the row to reach it.
  update public.user_sessions
     set last_seen_at = now() - interval '10 minutes'
   where session_id = v_session;

  perform public.api_authorize_request(
    v_user, v_session, null, 'ios', 'CFNetwork', 'CA', 'ON', 'Toronto', null
  );
  select app_version into v_got from public.user_sessions where session_id = v_session;
  if v_got is distinct from '1.4.0' then
    raise exception 'a missing header must not clear a known version, got %',
      coalesce(v_got, '<null>');
  end if;

  -- An upgrade must move the number, or the adoption curve can never rise.
  update public.user_sessions
     set last_seen_at = now() - interval '10 minutes'
   where session_id = v_session;

  perform public.api_authorize_request(
    v_user, v_session, null, 'ios', 'CFNetwork', 'CA', 'ON', 'Toronto', '1.5.0'
  );
  select app_version into v_got from public.user_sessions where session_id = v_session;
  if v_got is distinct from '1.5.0' then
    raise exception 'an upgrade must overwrite, got %', coalesce(v_got, '<null>');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Adding the version parameter did not drop what the function already carried.
--
-- This is a scar. `create or replace` does NOT replace a function whose
-- argument list differs — it creates an overload, so the first attempt at this
-- migration left two `api_authorize_request`s and made every eight-argument
-- call ambiguous. The fix (drop the old signature) then exposed the second
-- half: this function had been extended by #314 to carry the workspace's MFA
-- posture, and a full-body rewrite silently dropped it.
--
-- Both faults were invisible to the app's own tests and would have shipped as
-- "nobody can authenticate" and "MFA enforcement quietly stopped".
-- ---------------------------------------------------------------------------

do $$
declare
  v_count int;
  v_keys  text;
begin
  select count(*) into v_count
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'api_authorize_request';
  if v_count <> 1 then
    raise exception
      'expected exactly ONE api_authorize_request, found % — a defaulted '
      'parameter added by create-or-replace makes every shorter call ambiguous',
      v_count;
  end if;

  -- Every key the callers read must still be present (#236 session state,
  -- #314 MFA posture, #339 came later and adds none of its own).
  select string_agg(k, ',' order by k) into v_keys
    from jsonb_object_keys(
      public.api_authorize_request(
        'bd000000-0000-4000-8000-00000000000a'::uuid,
        'bd000000-0000-4000-8000-0000000000e1'::uuid,
        null, 'web', null, null, null, null, '1.0.0'
      )
    ) as k;

  if v_keys is distinct from 'member,mfa,session_new,session_revoked' then
    raise exception
      'the authorization answer lost a key it used to carry: %', v_keys;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- A malformed header degrades to "unknown" and never costs a session.
-- ---------------------------------------------------------------------------

do $$
declare
  v_session uuid := 'bd000000-0000-4000-8000-0000000000c2'::uuid;
  v_user    uuid := 'bd000000-0000-4000-8000-00000000000b'::uuid;
  v_got     text;
  v_result  jsonb;
begin
  -- The header is attacker-controlled and the column carries a CHECK. If the
  -- RPC passed it through raw, this call would raise and take an authenticated
  -- request down with it.
  v_result := public.api_authorize_request(
    v_user, v_session, null, 'android', 'okhttp', null, null, null,
    '9.9.9; drop table users'
  );

  if (v_result->>'session_revoked')::boolean then
    raise exception 'a malformed version must not revoke the session';
  end if;

  select app_version into v_got from public.user_sessions where session_id = v_session;
  if v_got is not null then
    raise exception 'a malformed version must be stored as NULL, got %', v_got;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The blast radius is computed before the floor lands, not after.
-- ---------------------------------------------------------------------------

do $$
declare
  v_user   uuid := 'bd000000-0000-4000-8000-00000000000a'::uuid;
  v_result jsonb;
begin
  -- Start from a known population. The blocks above deliberately left sessions
  -- behind (including one with a NULL version, from the malformed-header
  -- case), and this assertion is arithmetic — it has to be about rows this
  -- block controls, or it drifts every time a test is added above it.
  delete from public.user_sessions;

  insert into public.user_sessions (session_id, user_id, client, app_version, last_seen_at)
  values
    ('bd000000-0000-4000-8000-0000000000d1'::uuid, v_user, 'android', '1.0.0', now()),
    ('bd000000-0000-4000-8000-0000000000d2'::uuid, v_user, 'android', '2.0.0', now()),
    -- The un-upgraded population: no version at all. These are BLOCKED by any
    -- floor, and counting them as safe would be the misconfiguration that
    -- locks out everyone at once.
    ('bd000000-0000-4000-8000-0000000000d3'::uuid, v_user, 'android', null, now()),
    -- Long gone; must not inflate the count into paralysis.
    ('bd000000-0000-4000-8000-0000000000d4'::uuid, v_user, 'android', '1.0.0',
     now() - interval '90 days');

  v_result := public.api_set_release_policy('android', '2.0.0', '2.0.0', 'Security fix', 'https://x/y', v_user);

  if (v_result->>'blocked_sessions')::int <> 2 then
    raise exception 'expected 2 blocked live sessions (1.0.0 and the unknown), got %',
      v_result->>'blocked_sessions';
  end if;
  if (v_result->>'active_sessions')::int <> 3 then
    raise exception 'expected 3 active sessions in the window, got %',
      v_result->>'active_sessions';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Reading the policy, including for a platform nobody configured.
-- ---------------------------------------------------------------------------

do $$
declare
  v_policy jsonb;
begin
  v_policy := public.api_app_release_policy('android');
  if v_policy->>'minimum_version' <> '2.0.0' then
    raise exception 'the android floor should read back, got %', v_policy::text;
  end if;
  if v_policy->>'message' <> 'Security fix' then
    raise exception 'the reason must travel with the demand';
  end if;

  -- An unknown platform gets a well-formed answer with no demands. A client
  -- that cannot parse the response must never become a client that blocks
  -- itself.
  v_policy := public.api_app_release_policy('symbian');
  if v_policy is null or v_policy->>'minimum_version' is not null then
    raise exception 'an unknown platform must answer with no demands, got %',
      coalesce(v_policy::text, '<null>');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The adoption curve.
-- ---------------------------------------------------------------------------

do $$
declare
  v_top     text;
  v_unknown bigint;
begin
  -- Ordinality for the same reason `geocode_fair_share.test.sql` GF-3 needs it:
  -- "sorts first" is the claim, and a bare `limit 1` does not make it. Nothing
  -- reorders a filtered function scan today, so this one passes either way — but
  -- it passes by luck, and the day somebody joins this to `user_sessions` for a
  -- richer assertion it starts picking a row at random, intermittently, in CI
  -- only. Saying what "first" means costs one line.
  select q.version into v_top
    from public.api_version_distribution(30)
         with ordinality as q(platform, version, sessions, users, ord)
   where q.platform = 'android'
   order by q.ord
   limit 1;
  if v_top is distinct from '2.0.0' then
    raise exception 'newest version must sort first, got %', coalesce(v_top, '<null>');
  end if;

  -- The un-upgraded population is a bucket, not a rounding error. It is the
  -- single number this whole feature exists to watch fall.
  select sessions into v_unknown
    from public.api_version_distribution(30)
   where platform = 'android' and version is null;
  if v_unknown is distinct from 1 then
    raise exception 'sessions with no known version must be reported, got %',
      coalesce(v_unknown::text, '<null>');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Grants: everything that writes stays service_role.
-- ---------------------------------------------------------------------------

do $$
declare
  v_leak text;
begin
  select string_agg(p.proname, ', ') into v_leak
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'api_set_release_policy', 'api_version_distribution',
       'api_app_release_policy', 'version_key'
     )
     and (
       has_function_privilege('anon', p.oid, 'execute')
       or has_function_privilege('authenticated', p.oid, 'execute')
     );

  if v_leak is not null then
    raise exception 'these must not be reachable by anon/authenticated: %', v_leak;
  end if;
end $$;

rollback;
