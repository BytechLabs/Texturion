-- [#236] Signed-in devices — assertion suite for
-- supabase/migrations/20260729000100_active_sessions.sql.
--
-- The bug this closes is a timing one, so the tests are about WHEN: a phone
-- that has been signed out has to fail its next request, not its next hour.
-- Everything else here exists because a half-done revocation is worse than
-- none — it reads as "handled" while the customer's messages keep arriving on
-- a phone that walked out the door.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/active_sessions.test.sql
--
-- One transaction, rolled back. Fixtures use an 'a5' id prefix so the file
-- runs standalone OR after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('a5000000-0000-4000-8000-00000000000a','sessions-owner@test.local'),
  ('a5000000-0000-4000-8000-00000000000b','sessions-tech@test.local');

insert into public.companies (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values ('a5000000-0000-4000-8000-000000000001','Sessions Co',
        'a5000000-0000-4000-8000-00000000000a','US','415', now());

insert into public.company_members (id, company_id, user_id, role) values
  ('a5000000-0000-4000-8000-000000000010','a5000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-00000000000a','owner'),
  ('a5000000-0000-4000-8000-000000000011','a5000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-00000000000b','member');

-- Two GoTrue sessions for the tech: a phone and a laptop.
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('a5000000-0000-4000-8000-000000000100','a5000000-0000-4000-8000-00000000000b', now() - interval '10 days', now()),
  ('a5000000-0000-4000-8000-000000000101','a5000000-0000-4000-8000-00000000000b', now() - interval '2 days', now());

-- ===========================================================================
-- 1. The hot path records the device the first time it sees it, and says so.
-- ===========================================================================
do $$
declare v jsonb;
begin
  v := public.api_authorize_request(
    p_user_id    => 'a5000000-0000-4000-8000-00000000000b',
    p_session_id => 'a5000000-0000-4000-8000-000000000100',
    p_company_id => 'a5000000-0000-4000-8000-000000000001',
    p_client     => 'android',
    p_user_agent => 'okhttp/4.12.0',
    p_country    => 'CA', p_region => 'Ontario', p_city => 'Toronto');

  if (v ->> 'session_new')::boolean is not true then
    raise exception 'first sight of a session must report session_new: %', v;
  end if;
  if (v ->> 'session_revoked')::boolean then
    raise exception 'a brand-new session must not read as revoked: %', v;
  end if;
  if v #>> '{member,role}' is distinct from 'member' then
    raise exception 'the membership half must answer in the same call: %', v;
  end if;
  if not exists (select 1 from public.user_sessions
                  where session_id = 'a5000000-0000-4000-8000-000000000100'
                    and client = 'android' and ip_city = 'Toronto') then
    raise exception 'the device row was not written';
  end if;
end $$;

-- The SECOND request from the same device is not a new sign-in. Otherwise the
-- new-device email would fire on every single call.
do $$
declare v jsonb;
begin
  v := public.api_authorize_request(
    p_user_id    => 'a5000000-0000-4000-8000-00000000000b',
    p_session_id => 'a5000000-0000-4000-8000-000000000100',
    p_company_id => 'a5000000-0000-4000-8000-000000000001',
    p_client     => 'android');
  if (v ->> 'session_new')::boolean then
    raise exception 'a returning device must not report as new: %', v;
  end if;
end $$;

-- A company the caller is not a member of answers with no member at all — the
-- 403 case — while the session half still reports fine.
do $$
declare v jsonb;
begin
  v := public.api_authorize_request(
    p_user_id    => 'a5000000-0000-4000-8000-00000000000b',
    p_session_id => 'a5000000-0000-4000-8000-000000000100',
    p_company_id => 'a5000000-0000-4000-8000-0000000000ff');
  if v -> 'member' is distinct from 'null'::jsonb then
    raise exception 'a foreign company must resolve to no member: %', v;
  end if;
end $$;

-- ===========================================================================
-- 2. Sign ONE device out. The other keeps working, and only the signed-out
--    device's push registrations go.
-- ===========================================================================
insert into public.user_sessions (session_id, user_id, client)
values ('a5000000-0000-4000-8000-000000000101','a5000000-0000-4000-8000-00000000000b','web')
on conflict (session_id) do nothing;

insert into public.device_push_tokens (id, user_id, platform, token, session_id) values
  ('a5000000-0000-4000-8000-000000000200','a5000000-0000-4000-8000-00000000000b','android','tok-phone','a5000000-0000-4000-8000-000000000100');
insert into public.push_subscriptions (id, user_id, endpoint, p256dh, auth, session_id) values
  ('a5000000-0000-4000-8000-000000000201','a5000000-0000-4000-8000-00000000000b','https://push.test/laptop','p','a','a5000000-0000-4000-8000-000000000101');

do $$
declare v jsonb;
begin
  v := public.api_revoke_sessions(
    p_user_id     => 'a5000000-0000-4000-8000-00000000000b',
    p_session_ids => array['a5000000-0000-4000-8000-000000000100']::uuid[],
    p_actor       => 'a5000000-0000-4000-8000-00000000000b',
    p_reason      => 'self');

  if (v ->> 'sessions')::int is distinct from 1 then
    raise exception 'exactly one session should have been revoked: %', v;
  end if;
  -- The sharpest part of #236: the phone stops receiving customer message
  -- text in a notification.
  if exists (select 1 from public.device_push_tokens
              where id = 'a5000000-0000-4000-8000-000000000200') then
    raise exception 'the revoked device kept its push token';
  end if;
  -- ...and the laptop the person is still using did not lose theirs.
  if not exists (select 1 from public.push_subscriptions
                  where id = 'a5000000-0000-4000-8000-000000000201') then
    raise exception 'signing out one device unsubscribed another';
  end if;
  -- GoTrue's row is gone too, so the refresh token has nothing to refresh
  -- against — revocation is permanent, not a one-request block.
  if exists (select 1 from auth.sessions
              where id = 'a5000000-0000-4000-8000-000000000100') then
    raise exception 'the GoTrue session row survived the revoke';
  end if;
end $$;

-- THE ACCEPTANCE CRITERION: the revoked phone's very next call fails.
do $$
declare v jsonb;
begin
  v := public.api_authorize_request(
    p_user_id    => 'a5000000-0000-4000-8000-00000000000b',
    p_session_id => 'a5000000-0000-4000-8000-000000000100',
    p_company_id => 'a5000000-0000-4000-8000-000000000001');
  if (v ->> 'session_revoked')::boolean is not true then
    raise exception 'a revoked session must fail its NEXT request: %', v;
  end if;
  -- And it learns nothing about the workspace on the way out.
  if v -> 'member' is distinct from 'null'::jsonb then
    raise exception 'a revoked session must not receive a membership: %', v;
  end if;
end $$;

-- The device still signed in is unaffected.
do $$
declare v jsonb;
begin
  v := public.api_authorize_request(
    p_user_id    => 'a5000000-0000-4000-8000-00000000000b',
    p_session_id => 'a5000000-0000-4000-8000-000000000101',
    p_company_id => 'a5000000-0000-4000-8000-000000000001');
  if (v ->> 'session_revoked')::boolean then
    raise exception 'signing out one device signed out another: %', v;
  end if;
end $$;

-- The list shows only what is genuinely live: the revoked phone is gone, the
-- laptop remains.
do $$
declare v jsonb;
begin
  v := public.api_list_user_sessions(array['a5000000-0000-4000-8000-00000000000b']::uuid[]);
  if jsonb_array_length(v) is distinct from 1 then
    raise exception 'the list should hold exactly the one live session: %', v;
  end if;
  if v #>> '{0,session_id}' is distinct from 'a5000000-0000-4000-8000-000000000101' then
    raise exception 'the wrong session survived: %', v;
  end if;
end $$;

-- ===========================================================================
-- 3. A session GoTrue knows about that we have never seen (minted before this
--    shipped) must still die on a sign-out-everywhere. Otherwise the one
--    device most likely to be forgotten is the one that survives.
-- ===========================================================================
insert into auth.sessions (id, user_id, created_at, updated_at)
values ('a5000000-0000-4000-8000-000000000102','a5000000-0000-4000-8000-00000000000b', now() - interval '90 days', now());

do $$
declare v jsonb;
begin
  v := public.api_revoke_sessions(
    p_user_id => 'a5000000-0000-4000-8000-00000000000b',
    p_except  => 'a5000000-0000-4000-8000-000000000101',
    p_actor   => 'a5000000-0000-4000-8000-00000000000b',
    p_reason  => 'sign_out_all');

  if not exists (select 1 from public.user_sessions
                  where session_id = 'a5000000-0000-4000-8000-000000000102'
                    and revoked_at is not null) then
    raise exception 'an unseen GoTrue session survived sign-out-everywhere';
  end if;
  -- "Everywhere ELSE": the browser doing the signing out keeps working.
  if exists (select 1 from public.user_sessions
              where session_id = 'a5000000-0000-4000-8000-000000000101'
                and revoked_at is not null) then
    raise exception 'sign-out-everywhere logged out the device asking';
  end if;
  if not exists (select 1 from public.push_subscriptions
                  where id = 'a5000000-0000-4000-8000-000000000201') then
    raise exception 'sign-out-everywhere took the sparing device''s push with it';
  end if;
end $$;

-- ===========================================================================
-- 4. Offboarding (#276) keeps its entry point, and now lands immediately.
-- ===========================================================================
do $$
declare v int;
begin
  v := public.api_revoke_user_sessions('a5000000-0000-4000-8000-00000000000b');
  if v < 1 then
    raise exception 'offboarding revoked nothing: %', v;
  end if;
  if exists (select 1 from auth.sessions
              where user_id = 'a5000000-0000-4000-8000-00000000000b') then
    raise exception 'a GoTrue session survived offboarding';
  end if;
  if exists (select 1 from public.push_subscriptions
              where user_id = 'a5000000-0000-4000-8000-00000000000b')
     or exists (select 1 from public.device_push_tokens
                 where user_id = 'a5000000-0000-4000-8000-00000000000b') then
    raise exception 'an offboarded person kept a push registration';
  end if;
end $$;

-- ===========================================================================
-- 5. The reaper drops dead rows and never a live one.
-- ===========================================================================
-- Signed in for a year and still going: the row the reaper must not touch.
insert into auth.sessions (id, user_id, created_at, updated_at)
values ('a5000000-0000-4000-8000-000000000103','a5000000-0000-4000-8000-00000000000a', now(), now());
insert into public.user_sessions (session_id, user_id, client, last_seen_at) values
  ('a5000000-0000-4000-8000-000000000103','a5000000-0000-4000-8000-00000000000a','web', now() - interval '400 days'),
  -- Revoked long ago, and nobody will ever ask about it again.
  ('a5000000-0000-4000-8000-000000000104','a5000000-0000-4000-8000-00000000000a','web',
   now() - interval '400 days'),
  -- Ended from the app itself: GoTrue deleted its row, we never heard.
  ('a5000000-0000-4000-8000-000000000105','a5000000-0000-4000-8000-00000000000a','ios',
   now() - interval '400 days');
update public.user_sessions set revoked_at = now() - interval '399 days', revoke_reason = 'self'
 where session_id = 'a5000000-0000-4000-8000-000000000104';

do $$
declare v int;
begin
  v := public.api_prune_user_sessions(now() - interval '90 days');
  if v is distinct from 2 then
    raise exception 'the reaper should have taken exactly the two dead rows: %', v;
  end if;
  -- Live at any age. Somebody who signs in once and stays signed in for a
  -- year keeps their row and keeps their access.
  if not exists (select 1 from public.user_sessions
                  where session_id = 'a5000000-0000-4000-8000-000000000103') then
    raise exception 'the reaper deleted a session that is still signed in';
  end if;
end $$;

-- ===========================================================================
-- 6. Grants: everything here reads auth.sessions, so nothing may be reachable
--    from a browser's anon/authenticated key.
-- ===========================================================================
do $$
declare fn text;
begin
  foreach fn in array array[
    'api_authorize_request', 'api_list_user_sessions', 'api_revoke_sessions',
    'api_revoke_user_sessions', 'api_prune_user_sessions'
  ] loop
    if exists (
      select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = fn
         and (has_function_privilege('anon', p.oid, 'execute')
              or has_function_privilege('authenticated', p.oid, 'execute'))
    ) then
      raise exception '%() is executable by a browser key', fn;
    end if;
  end loop;
end $$;

rollback;
