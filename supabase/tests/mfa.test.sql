-- [#314] Second factor — assertion suite for
-- supabase/migrations/20260729000300_mfa.sql.
--
-- The issue's devil's advocate names the real risk, and it is not friction:
-- "a contractor who loses their phone and cannot get into the app has lost
-- their business phone line, and will rightly blame us". So most of what is
-- pinned here is the anti-lockout behaviour — that a grace deadline cannot
-- move under the crew, that recovery codes work exactly once, and that the
-- brute-force floor cannot be raced.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/mfa.test.sql
--
-- One transaction, rolled back. Fixtures use an 'af' id prefix so the file
-- runs standalone OR after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('af000000-0000-4000-8000-00000000000a'::uuid, 'mfa-owner@test.local'),
  ('af000000-0000-4000-8000-00000000000b'::uuid, 'mfa-tech@test.local');

insert into public.companies (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values ('af000000-0000-4000-8000-000000000001','MFA Co',
        'af000000-0000-4000-8000-00000000000a','US','415', now());

insert into public.company_members (id, company_id, user_id, role) values
  ('af000000-0000-4000-8000-000000000010','af000000-0000-4000-8000-000000000001','af000000-0000-4000-8000-00000000000a','owner'),
  ('af000000-0000-4000-8000-000000000011','af000000-0000-4000-8000-000000000001','af000000-0000-4000-8000-00000000000b','member');

-- ===========================================================================
-- 1. Recovery codes: issued as a SET, spent exactly once.
-- ===========================================================================
do $$
declare
  v_user uuid := 'af000000-0000-4000-8000-00000000000b';
  v_n int;
  v jsonb;
begin
  v_n := public.api_mfa_set_recovery_codes(v_user, array['aaa','bbb','ccc']);
  if v_n <> 3 then
    raise exception 'expected 3 codes stored, got %', v_n;
  end if;
  if public.api_mfa_recovery_remaining(v_user) <> 3 then
    raise exception 'remaining count is wrong right after issuing';
  end if;

  v := public.api_mfa_consume_recovery_code(v_user, 'bbb');
  if v ->> 'outcome' <> 'ok' then
    raise exception 'a valid code was refused: %', v;
  end if;
  if (v ->> 'remaining')::int <> 2 then
    raise exception 'remaining did not drop after a burn: %', v;
  end if;

  -- The same code again is not a second chance. A reusable recovery code is a
  -- password with a shorter lifetime and worse ergonomics.
  v := public.api_mfa_consume_recovery_code(v_user, 'bbb');
  if v ->> 'outcome' <> 'no_match' then
    raise exception 'a spent code was accepted a second time: %', v;
  end if;
end $$;

-- Re-issuing replaces the set. A code screenshotted a year ago must stop
-- working, or the count on the screen is a lie.
do $$
declare
  v_user uuid := 'af000000-0000-4000-8000-00000000000b';
  v jsonb;
begin
  perform public.api_mfa_set_recovery_codes(v_user, array['ddd','eee']);
  if public.api_mfa_recovery_remaining(v_user) <> 2 then
    raise exception 're-issuing did not replace the previous set';
  end if;
  v := public.api_mfa_consume_recovery_code(v_user, 'aaa');
  if v ->> 'outcome' <> 'no_match' then
    raise exception 'a code from the PREVIOUS set still worked: %', v;
  end if;
end $$;

-- ===========================================================================
-- 2. The brute-force floor. An attacker with the password grinding recovery
--    codes is trying to turn a stolen password into an MFA bypass, which is
--    the worst outcome this feature can have.
-- ===========================================================================
do $$
declare
  v_user uuid := 'af000000-0000-4000-8000-00000000000a';
  v jsonb;
  i int;
begin
  perform public.api_mfa_set_recovery_codes(v_user, array['zzz']);
  for i in 1..10 loop
    v := public.api_mfa_consume_recovery_code(v_user, 'wrong-' || i);
  end loop;
  if v ->> 'outcome' <> 'no_match' then
    raise exception 'the tenth wrong guess should still read as no_match: %', v;
  end if;

  -- The eleventh is refused before it is even compared.
  v := public.api_mfa_consume_recovery_code(v_user, 'wrong-11');
  if v ->> 'outcome' <> 'locked' then
    raise exception 'grinding was not locked out after ten failures: %', v;
  end if;

  -- And the lock is not a per-code thing: even the RIGHT code is refused
  -- while it holds, or the lockout would be trivially skippable.
  v := public.api_mfa_consume_recovery_code(v_user, 'zzz');
  if v ->> 'outcome' <> 'locked' then
    raise exception 'the lockout let a correct code through: %', v;
  end if;
  if public.api_mfa_recovery_remaining(v_user) <> 1 then
    raise exception 'a locked-out attempt still spent the code';
  end if;
end $$;

-- Enrolling again clears the lockout: the person has just proved control of
-- the account, and carrying a lock across that punishes somebody for having
-- been attacked.
do $$
declare
  v_user uuid := 'af000000-0000-4000-8000-00000000000a';
  v jsonb;
begin
  perform public.api_mfa_set_recovery_codes(v_user, array['fresh']);
  v := public.api_mfa_consume_recovery_code(v_user, 'fresh');
  if v ->> 'outcome' <> 'ok' then
    raise exception 're-enrolling did not clear the lockout: %', v;
  end if;
end $$;

-- ===========================================================================
-- 3. Owner enforcement, and the grace deadline that must not move.
-- ===========================================================================
do $$
declare
  co uuid := 'af000000-0000-4000-8000-000000000001';
  owner uuid := 'af000000-0000-4000-8000-00000000000a';
  tech uuid := 'af000000-0000-4000-8000-00000000000b';
  v jsonb;
  first_deadline timestamptz;
begin
  -- A member cannot impose a security policy on the workspace.
  v := public.api_set_company_mfa(co, tech, true, 14);
  if v ->> 'outcome' <> 'forbidden' then
    raise exception 'a member turned on workspace MFA: %', v;
  end if;

  v := public.api_set_company_mfa(co, owner, true, 14);
  if v ->> 'outcome' <> 'on' then
    raise exception 'the owner could not require MFA: %', v;
  end if;
  first_deadline := (v ->> 'grace_until')::timestamptz;
  if first_deadline is null then
    raise exception 'requiring MFA set no grace deadline at all: %', v;
  end if;

  -- THE ONE THAT MATTERS: re-saving must not move a deadline the crew was
  -- already told. Otherwise every settings save silently extends it, and
  -- "you have until Friday" stops meaning anything.
  v := public.api_set_company_mfa(co, owner, true, 90);
  if (v ->> 'grace_until')::timestamptz <> first_deadline then
    raise exception 'saving again moved the deadline: % -> %',
      first_deadline, v ->> 'grace_until';
  end if;
end $$;

-- Still inside the window: nothing is enforced yet.
do $$
declare v jsonb;
begin
  v := public.company_mfa_posture('af000000-0000-4000-8000-000000000001');
  if (v ->> 'required')::boolean is not true then
    raise exception 'the workspace does not read as requiring MFA: %', v;
  end if;
  if (v ->> 'enforcing')::boolean then
    raise exception 'enforcement started before the grace window ended: %', v;
  end if;
end $$;

-- Past the deadline: now it bites.
do $$
declare v jsonb;
begin
  update public.companies set mfa_grace_until = now() - interval '1 day'
   where id = 'af000000-0000-4000-8000-000000000001';
  v := public.company_mfa_posture('af000000-0000-4000-8000-000000000001');
  if (v ->> 'enforcing')::boolean is not true then
    raise exception 'the grace window passed and nothing is enforced: %', v;
  end if;
end $$;

-- Turning it off clears BOTH columns, so a later re-enable starts a fresh
-- window rather than resurrecting a deadline that passed while it was off.
do $$
declare
  co uuid := 'af000000-0000-4000-8000-000000000001';
  owner uuid := 'af000000-0000-4000-8000-00000000000a';
  v jsonb;
begin
  v := public.api_set_company_mfa(co, owner, false);
  if v ->> 'outcome' <> 'off' then
    raise exception 'the owner could not turn MFA off: %', v;
  end if;
  if (select mfa_required_at is not null or mfa_grace_until is not null
        from public.companies where id = co) then
    raise exception 'turning MFA off left one of the columns set';
  end if;

  v := public.api_set_company_mfa(co, owner, true, 7);
  if (v ->> 'grace_until')::timestamptz <= now() then
    raise exception 're-enabling resurrected an expired deadline: %', v;
  end if;
end $$;

-- ===========================================================================
-- 4. The posture rides the authorization call, so enforcement costs no extra
--    round trip — which is what makes a per-request check affordable at all.
-- ===========================================================================
do $$
declare v jsonb;
begin
  v := public.api_authorize_request(
    p_user_id    => 'af000000-0000-4000-8000-00000000000b',
    p_session_id => null,
    p_company_id => 'af000000-0000-4000-8000-000000000001');
  if v -> 'mfa' is null or v -> 'mfa' = 'null'::jsonb then
    raise exception 'the authorization call reported no MFA posture: %', v;
  end if;
  if (v #>> '{mfa,required}')::boolean is not true then
    raise exception 'the posture does not match the company: %', v;
  end if;

  -- No company named: no workspace policy applies, and saying otherwise would
  -- gate the very routes somebody needs to enrol through.
  v := public.api_authorize_request(
    p_user_id    => 'af000000-0000-4000-8000-00000000000b',
    p_session_id => null,
    p_company_id => null);
  if v -> 'mfa' <> 'null'::jsonb then
    raise exception 'a company-exempt call carried a workspace MFA policy: %', v;
  end if;
end $$;

-- ===========================================================================
-- 4b. [#496] Enrolling IS the demand.
--
--     "When 2fa is enabled it should be used everywhere??? I am able to login
--     without any 2fa codes even though 2fa is enabled."
--
--     The gap: enrolment happens against GoTrue, which signs a password login
--     in at aal1 and leaves demanding the factor to the application — and
--     #314 only demanded it when a WORKSPACE policy said so. Somebody who
--     turned 2FA on for themselves therefore got a factor and no consequence.
--
--     What follows pins the fact the middleware gates on. The MFA Co company
--     above has a policy; this user's is reported independently of it, which
--     is the whole point.
-- ===========================================================================
do $$
declare v jsonb;
begin
  -- No factor at all.
  if public.user_has_verified_mfa('af000000-0000-4000-8000-00000000000b') then
    raise exception 'a user with no factor was reported as enrolled';
  end if;

  -- Started and abandoned. An `unverified` row must NOT be read as a demand:
  -- locking somebody out on the strength of a screen they backed out of is a
  -- lockout with no remedy, because they never got a code or a recovery set.
  insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at)
  values ('af000000-0000-4000-8000-0000000000f1',
          'af000000-0000-4000-8000-00000000000b', 'totp', 'unverified', now(), now());
  if public.user_has_verified_mfa('af000000-0000-4000-8000-00000000000b') then
    raise exception 'an abandoned enrolment was read as a second factor';
  end if;

  -- Verified: now it counts.
  update auth.mfa_factors set status = 'verified'
   where id = 'af000000-0000-4000-8000-0000000000f1';
  if not public.user_has_verified_mfa('af000000-0000-4000-8000-00000000000b') then
    raise exception 'a verified factor was not reported';
  end if;

  -- And it reaches the middleware through the one round trip a request makes.
  v := public.api_authorize_request(
    p_user_id    => 'af000000-0000-4000-8000-00000000000b',
    p_session_id => null,
    p_company_id => 'af000000-0000-4000-8000-000000000001');
  if (v #>> '{mfa,enrolled}')::boolean is not true then
    raise exception 'the authorization call did not carry the enrolment: %', v;
  end if;

  -- The OTHER user in this fixture has no factor, and the same workspace
  -- policy. Enrolment is per-person, and reporting it per-workspace would
  -- demand a code from somebody who has nothing to produce one with.
  v := public.api_authorize_request(
    p_user_id    => 'af000000-0000-4000-8000-00000000000a',
    p_session_id => null,
    p_company_id => 'af000000-0000-4000-8000-000000000001');
  if (v #>> '{mfa,enrolled}')::boolean is not false then
    raise exception 'enrolment leaked from one member to another: %', v;
  end if;

  -- No company named: the whole posture stays null, so the routes that get
  -- somebody OUT of an MFA state are reachable without a code. This is the
  -- anti-lockout property that makes the gate safe to arm at all.
  v := public.api_authorize_request(
    p_user_id    => 'af000000-0000-4000-8000-00000000000b',
    p_session_id => null,
    p_company_id => null);
  if v -> 'mfa' <> 'null'::jsonb then
    raise exception 'a company-exempt call carried an MFA demand: %', v;
  end if;

  delete from auth.mfa_factors where id = 'af000000-0000-4000-8000-0000000000f1';
end $$;

-- ===========================================================================
-- 5. Grants: recovery codes are the bypass path, so nothing here may be
--    reachable from a browser's anon/authenticated key.
-- ===========================================================================
do $$
declare fn text;
begin
  foreach fn in array array[
    'api_mfa_set_recovery_codes', 'api_mfa_consume_recovery_code',
    'api_mfa_recovery_remaining', 'api_set_company_mfa', 'company_mfa_posture',
    -- #496: it reads auth.mfa_factors, so a browser key that could call it
    -- would enumerate who in the world has 2FA switched on.
    'user_has_verified_mfa'
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

\echo 'mfa.test.sql: recovery codes, lockout, grace window, posture, personal enrolment PASSED'

rollback;
