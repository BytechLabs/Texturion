-- [#581] Realtime topic authorization and session revocation — assertion suite
-- for supabase/migrations/20260812100000_a_revoked_session_cannot_join_a_realtime_topic.sql
-- (and the topic gate it replaces, 20260731010000_presence_topic.sql).
--
-- WHY THIS SUITE IS THE ONLY THING THAT WOULD NOTICE. `is_company_topic_member`
-- is the sole gate on every realtime topic, and it fails in total silence in
-- both directions. Admit too much and a revoked device keeps receiving a
-- customer's messages while the owner has been told it is off — nobody files
-- that bug. Admit too little and `phx_join` is refused, which surfaces as "the
-- inbox stopped updating" and gets blamed on the socket.
--
-- The suite therefore always asserts a REFUSAL against a matching ADMISSION.
-- Nothing here proves anything on its own: `auth.uid()` is null unless a token is
-- presented, so a bare `is false` passes for every input including the ones a
-- real caller would be wrongly granted — the mistake NL-6b in
-- member_number_level.test.sql calls out by name.
--
-- What this pins, in the order it breaks:
--   PT-1  a live session still joins all three topics (the #581 lockout risk)
--   PT-2  a revoked session joins none of them (#581 itself)
--   PT-3  an ABSENT session_id claim is admitted — D66's rule, not a shortcut
--   PT-4  an unplaceable claim lands where an absent one does, without RAISING
--   PT-5  membership still decides, so the gate is an EXTRA test and not the test
--   PT-6  revocation is looked up by session_id alone, and fails closed
--   PT-7  the ACL survived the replace (a drop/recreate regains PUBLIC EXECUTE)
--   PT-8  the policies actually consult it — on READ and on WRITE
--
-- One transaction, rolled back. Fixtures use a '2e' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('2e000000-0000-4000-8000-00000000000a'::uuid, 'pt-owner@test.local'),
  ('2e000000-0000-4000-8000-00000000000c'::uuid, 'pt-member@test.local'),
  ('2e000000-0000-4000-8000-00000000000e'::uuid, 'pt-gone@test.local'),
  ('2e000000-0000-4000-8000-00000000000f'::uuid, 'pt-stranger@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status)
values
  ('2e000000-0000-4000-8000-0000000000c1'::uuid, 'Presence Co',
   '2e000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(), 'active');

insert into public.company_members (company_id, user_id, role, deactivated_at)
values
  ('2e000000-0000-4000-8000-0000000000c1'::uuid,
   '2e000000-0000-4000-8000-00000000000a'::uuid, 'owner', null),
  ('2e000000-0000-4000-8000-0000000000c1'::uuid,
   '2e000000-0000-4000-8000-00000000000c'::uuid, 'member', null),
  -- Offboarded (#276). Their row survives for audit; their topics must not.
  ('2e000000-0000-4000-8000-0000000000c1'::uuid,
   '2e000000-0000-4000-8000-00000000000e'::uuid, 'member', now());

-- Un-ruled, so `member_number_level` answers 'text' and the number topic turns
-- purely on membership and revocation. A ruled number would make a refusal
-- ambiguous — #106 or #581? — and this suite is about the second one.
insert into public.phone_numbers
  (id, company_id, number_e164, status, country, provisioning_key)
values
  ('2e000000-0000-4000-8000-0000000000f1'::uuid,
   '2e000000-0000-4000-8000-0000000000c1'::uuid, '+14155550601', 'active', 'US', 'pt-1');

insert into public.user_sessions
  (session_id, user_id, client, revoked_at, revoked_by, revoke_reason)
values
  -- The member's two devices: the phone an owner just signed out, and the
  -- browser they are still working in.
  ('2e000000-0000-4000-8000-0000000000d1'::uuid,
   '2e000000-0000-4000-8000-00000000000c'::uuid, 'ios', now(),
   '2e000000-0000-4000-8000-00000000000a'::uuid, 'admin'),
  ('2e000000-0000-4000-8000-0000000000d2'::uuid,
   '2e000000-0000-4000-8000-00000000000c'::uuid, 'web', null, null, null),
  -- Live sessions for the two people who are not entitled to the topics at all,
  -- so PT-5's refusals cannot be the revocation gate firing by accident.
  ('2e000000-0000-4000-8000-0000000000d3'::uuid,
   '2e000000-0000-4000-8000-00000000000e'::uuid, 'android', null, null, null),
  ('2e000000-0000-4000-8000-0000000000d4'::uuid,
   '2e000000-0000-4000-8000-00000000000f'::uuid, 'web', null, null, null),
  -- The OWNER's revoked device, borrowed by PT-6.
  ('2e000000-0000-4000-8000-0000000000d5'::uuid,
   '2e000000-0000-4000-8000-00000000000a'::uuid, 'ios', now(),
   '2e000000-0000-4000-8000-00000000000a'::uuid, 'self');

/** Present a token. A null p_session omits the claim entirely, which is the
 *  D66 case — a token minted before GoTrue emitted it — and NOT the same as a
 *  claim naming a session nobody has heard of (PT-4). */
create or replace function pg_temp.present(p_user text, p_session text)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case
      when p_session is null then
        json_build_object('sub', p_user, 'role', 'authenticated')::text
      else
        json_build_object('sub', p_user, 'role', 'authenticated',
                          'session_id', p_session)::text
    end, true);
end $$;

create or replace function pg_temp.company_topic() returns text language sql as $$
  select 'company:2e000000-0000-4000-8000-0000000000c1';
$$;
create or replace function pg_temp.number_topic() returns text language sql as $$
  select pg_temp.company_topic() || ':number:2e000000-0000-4000-8000-0000000000f1';
$$;
create or replace function pg_temp.presence_topic() returns text language sql as $$
  select pg_temp.number_topic() || ':presence';
$$;

/** All three topics the gate admits, so every case is asserted against the whole
 *  surface rather than whichever one was on the reviewer's mind. */
create or replace function pg_temp.all_topics() returns text[] language sql as $$
  select array[pg_temp.company_topic(), pg_temp.number_topic(),
               pg_temp.presence_topic()];
$$;

-- ===========================================================================
-- PT-1. A LIVE SESSION STILL JOINS ALL THREE TOPICS.
--
-- First, because it is the risk #581's fix carries: a revocation gate that reads
-- the claim wrongly — wrong hex case, a lookup keyed on the user as well as the
-- session, a `not exists` that finds any revoked row rather than this one — turns
-- every legitimate join into a refusal and looks exactly like a broken socket.
--
-- Run AS THE `authenticated` ROLE deliberately. That is the role the policies on
-- `realtime.messages` evaluate as, and it is the proof that 20260812120000 could
-- revoke `member_number_level` from `authenticated` without breaking the number
-- topic: the gate is `security definer`, so it reaches the resolver as its owner
-- and the caller needs no grant of its own. NL-7 asserts the ACL; this asserts
-- the consequence.
-- ===========================================================================
do $$
declare v_topic text; v_ok boolean;
begin
  perform pg_temp.present('2e000000-0000-4000-8000-00000000000c',
                          '2e000000-0000-4000-8000-0000000000d2');
  execute 'set local role authenticated';

  foreach v_topic in array pg_temp.all_topics()
  loop
    v_ok := public.is_company_topic_member(v_topic);
    if v_ok is not true then
      raise exception 'PT-1 FAILED: a live session was refused % (returned %)',
        v_topic, v_ok;
    end if;
  end loop;

  execute 'reset role';
  raise notice 'PT-1 PASSED: a live session joins the company, number and '
    'presence topics, as authenticated, with no grant on member_number_level';
exception
  when others then
    execute 'reset role';
    raise;
end $$;

-- ===========================================================================
-- PT-2. A REVOKED SESSION JOINS NONE OF THEM. This is #581.
--
-- Same member, same unexpired token, same company row — only the device differs.
-- Before the fix all three returned true: the gate tested for a non-deactivated
-- `company_members` row and never read `user_sessions.revoked_at`, so after a
-- successful revoke the phone kept opening BRAND-NEW subscriptions while `/v1`
-- 401'd it and its push registrations were already gone. The owner had been told
-- the device was off.
--
-- The presence topic is called out separately below because it is the only
-- client-WRITABLE surface in the system (#302's `presence_topic_write`).
-- ===========================================================================
do $$
declare v_topic text; v_ok boolean;
begin
  perform pg_temp.present('2e000000-0000-4000-8000-00000000000c',
                          '2e000000-0000-4000-8000-0000000000d1');

  foreach v_topic in array pg_temp.all_topics()
  loop
    v_ok := public.is_company_topic_member(v_topic);
    if v_ok is not false then
      raise exception 'PT-2 FAILED: a REVOKED session was admitted to % '
        '(returned %) — revocation reaches /v1 and not realtime', v_topic, v_ok;
    end if;
  end loop;

  raise notice 'PT-2 PASSED: a revoked session is refused every topic, '
    'including the writable presence one';
end $$;

-- ===========================================================================
-- PT-3. AN ABSENT session_id CLAIM IS ADMITTED, and that is D66's rule.
--
-- D66: the claim rides inside the signed access token, so a caller cannot strip
-- it to skip the check — "its absence only ever means a token minted before
-- GoTrue emitted the claim. That is why an absent claim is admitted rather than
-- rejected: failing those closed would sign out every existing customer to
-- defend against something nobody can do."
--
-- `api_authorize_request` encodes exactly that (`if p_session_id is not null`).
-- This gate must not be stricter than the request path it is catching up with,
-- or the fix for #581 becomes a realtime outage for every un-refreshed token.
-- ===========================================================================
do $$
declare v_topic text; v_ok boolean;
begin
  perform pg_temp.present('2e000000-0000-4000-8000-00000000000c', null);

  foreach v_topic in array pg_temp.all_topics()
  loop
    v_ok := public.is_company_topic_member(v_topic);
    if v_ok is not true then
      raise exception 'PT-3 FAILED: a token with no session_id claim was refused '
        '% (returned %) — D66 admits those, and failing them closed locks out '
        'every token minted before the claim existed', v_topic, v_ok;
    end if;
  end loop;

  raise notice 'PT-3 PASSED: an absent session_id claim is admitted, per D66';
end $$;

-- ===========================================================================
-- PT-4. AN UNPLACEABLE CLAIM LANDS WHERE AN ABSENT ONE DOES — WITHOUT RAISING.
--
-- Two shapes, one answer. A well-formed session id with no `user_sessions` row is
-- a session nobody has recorded yet (`api_authorize_request` inserts the row on
-- first sight) or one the daily reaper already pruned; neither is a revocation.
--
-- A MALFORMED claim is the one that must not raise. A cast of arbitrary text to
-- uuid throws, and this function runs inside an RLS predicate — a database error
-- there is a worse failure than a refusal and a far noisier one, which is the
-- reasoning already written down for the topic's own uuid (NL-6). Nothing can
-- actually put garbage in a signed claim; this pins the fail-safe rather than the
-- threat.
-- ===========================================================================
do $$
declare v_topic text; v_ok boolean; v_claim text;
begin
  foreach v_claim in array array[
    '2e000000-0000-4000-8000-0000000000ff',   -- well-formed, no row
    'not-a-session-id',                        -- would raise on a bare cast
    '',                                        -- present and empty
    '2e000000-0000-4000-8000-0000000000d']    -- one character short of d1
  loop
    perform pg_temp.present('2e000000-0000-4000-8000-00000000000c', v_claim);
    foreach v_topic in array pg_temp.all_topics()
    loop
      v_ok := public.is_company_topic_member(v_topic);
      if v_ok is not true then
        raise exception 'PT-4 FAILED: claim % was refused % (returned %)',
          quote_literal(v_claim), v_topic, v_ok;
      end if;
    end loop;
  end loop;

  raise notice 'PT-4 PASSED: an unknown or malformed session_id claim is '
    'admitted and never raises';
end $$;

-- ===========================================================================
-- PT-5. MEMBERSHIP STILL DECIDES. The gate is an EXTRA test, not THE test.
--
-- Every assertion above is satisfied by a function reduced to nothing but the
-- revocation gate — one that admits every caller on earth to every topic as long
-- as their session is not revoked. That was measured, not assumed: replacing the
-- body with the `not exists` block alone leaves PT-1, PT-2, PT-3 and PT-4 all
-- reporting PASSED. A suite that green-lights an open door is worse than no
-- suite, so PT-5 is the one that closes it.
--
-- Asserted with LIVE sessions for two people who are not entitled to the topics,
-- so a refusal here can only be the membership arms and never the new gate.
--
-- (The other structural mistake the fix could make — dropping the parentheses, so
-- `and` binds tighter than `or` and reads as `(gate and company-arm) or
-- number-arm` — is caught by PT-2, which is why PT-2 loops over all three topics
-- rather than checking the company one. Also measured.)
-- ===========================================================================
do $$
declare v_topic text; v_ok boolean; v_who text; v_case record;
begin
  for v_case in
    select * from (values
      -- Offboarded, live session. #276 keeps the row; the topics must go.
      ('2e000000-0000-4000-8000-00000000000e', '2e000000-0000-4000-8000-0000000000d3',
       'an offboarded member'),
      -- Never a member of this company at all.
      ('2e000000-0000-4000-8000-00000000000f', '2e000000-0000-4000-8000-0000000000d4',
       'a stranger')
    ) as t(user_id, session_id, who)
  loop
    perform pg_temp.present(v_case.user_id, v_case.session_id);
    v_who := v_case.who;
    foreach v_topic in array pg_temp.all_topics()
    loop
      v_ok := public.is_company_topic_member(v_topic);
      if v_ok is not false then
        raise exception 'PT-5 FAILED: % with a LIVE session was admitted to % '
          '(returned %) — the topic gate has stopped testing membership',
          v_who, v_topic, v_ok;
      end if;
    end loop;
  end loop;

  raise notice 'PT-5 PASSED: membership still decides — a live stranger and a '
    'live offboarded member are refused all three topics';
end $$;

-- ===========================================================================
-- PT-6. REVOCATION IS LOOKED UP BY session_id ALONE, AND FAILS CLOSED.
--
-- `api_authorize_request` keys on the session and not on (user, session), for the
-- reason D66 gives: the claim is inside a signed token, so it cannot name a
-- session its bearer does not hold. This gate matches that spelling exactly —
-- two spellings of one security question is the drift D79 exists to prevent.
--
-- The consequence, pinned here so it is a decision rather than an accident: a
-- token presenting SOMEBODY ELSE'S revoked session id is refused. Unreachable in
-- production, and the safe direction if the signature ever stops holding.
-- ===========================================================================
do $$
declare v_ok boolean;
begin
  -- The member, presenting the OWNER's revoked device.
  perform pg_temp.present('2e000000-0000-4000-8000-00000000000c',
                          '2e000000-0000-4000-8000-0000000000d5');
  v_ok := public.is_company_topic_member(pg_temp.company_topic());
  if v_ok is not false then
    raise exception 'PT-6 FAILED: a revoked session id belonging to another user '
      'was admitted (returned %)', v_ok;
  end if;

  -- And the owner's own LIVE state is not implicated by their revoked device:
  -- the row is found by session, so one dead device does not end the person.
  perform pg_temp.present('2e000000-0000-4000-8000-00000000000a', null);
  if public.is_company_topic_member(pg_temp.company_topic()) is not true then
    raise exception 'PT-6 FAILED: one revoked device locked the whole person out';
  end if;

  raise notice 'PT-6 PASSED: revocation is per session, matching '
    'api_authorize_request, and an unmatched session id fails closed';
end $$;

-- ===========================================================================
-- PT-7. THE ACL SURVIVED THE REPLACE.
--
-- 20260812100000 uses `create or replace`, which preserves the existing ACL and
-- therefore restates no grant. A DROP and recreate would hand the function back
-- the DEFAULT PUBLIC EXECUTE GRANT, which `anon` and `authenticated` inherit —
-- and this gate reads `auth.uid()`, so a PUBLIC-executable copy is a probe every
-- unauthenticated caller can run against topic strings. That has bitten this repo
-- before, so the posture is asserted rather than assumed.
--
-- `authenticated` MUST keep its grant, unlike `member_number_level`: the policies
-- call THIS function by name as that role (NL-7 explains which is which).
-- ===========================================================================
do $$
declare leaked text;
begin
  select string_agg(distinct r.rolname, ',') into leaked
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(p.proacl) a
  join pg_roles r on r.oid = a.grantee
  where n.nspname = 'public'
    and p.proname = 'is_company_topic_member'
    and a.privilege_type = 'EXECUTE'
    and r.rolname in ('public', 'anon');
  if leaked is not null then
    raise exception 'PT-7 FAILED: is_company_topic_member EXECUTE leaked to % — '
      'a drop/recreate regains the default PUBLIC grant', leaked;
  end if;

  -- A null proacl is the default ACL, which INCLUDES public. Caught explicitly
  -- because aclexplode returns no rows for it, so the query above passes.
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'is_company_topic_member'
      and p.proacl is null
  ) then
    raise exception 'PT-7 FAILED: is_company_topic_member has the DEFAULT acl, '
      'which grants EXECUTE to public';
  end if;

  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(p.proacl) a
    join pg_roles r on r.oid = a.grantee
    where n.nspname = 'public'
      and p.proname = 'is_company_topic_member'
      and a.privilege_type = 'EXECUTE'
      and r.rolname = 'authenticated'
  ) then
    raise exception 'PT-7 FAILED: authenticated cannot execute '
      'is_company_topic_member — every realtime join is denied';
  end if;

  -- Exactly one function of this name. A retyped definition with a different
  -- signature becomes a second overload, and the policies keep calling the old
  -- one — a fix that ships as a silent no-op.
  if (select count(*) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'is_company_topic_member')
     is distinct from 1
  then
    raise exception 'PT-7 FAILED: is_company_topic_member has been overloaded';
  end if;

  raise notice 'PT-7 PASSED: no public/anon EXECUTE, authenticated kept, one '
    'signature only';
end $$;

-- ===========================================================================
-- PT-8. THE POLICIES ACTUALLY CONSULT IT — ON READ AND ON WRITE.
--
-- Everything above tests the function. The function could be perfect and the
-- policies could be reading something else, which is the failure #302 already
-- hit once: presence was silently refused underneath a channel that reported
-- SUBSCRIBED, and nothing surfaced on either side.
--
-- So this asserts through `realtime.messages` itself, as the `authenticated`
-- role, with `realtime.topic()` set the way the realtime server sets it. The
-- WRITE half is the sharper one: `presence_topic_write` is the only policy in
-- this system that lets a client insert, so a revoked handset that can still
-- write is one announcing itself as present on a customer's conversation.
-- ===========================================================================

-- realtime.messages is a committed table, so rows any earlier work published are
-- still there and would be counted. Cleared for the same reason
-- number_scoped_topics.test.sql clears it, and rolled back with everything else.
delete from realtime.messages;

insert into realtime.messages (topic, extension, payload, event, private)
values (pg_temp.presence_topic(), 'presence', '{}'::jsonb, 'presence_diff', true);

do $$
declare v_read int; v_wrote boolean;
begin
  perform set_config('realtime.topic', pg_temp.presence_topic(), true);

  -- The live browser: reads the presence row, and may announce itself.
  perform pg_temp.present('2e000000-0000-4000-8000-00000000000c',
                          '2e000000-0000-4000-8000-0000000000d2');
  execute 'set local role authenticated';
  select count(*) into v_read from realtime.messages;
  if v_read is distinct from 1 then
    raise exception 'PT-8 FAILED: a live session reads % presence row(s) (want 1)',
      v_read;
  end if;
  v_wrote := true;
  begin
    insert into realtime.messages (topic, extension, payload, private)
    values (pg_temp.presence_topic(), 'presence', '{}'::jsonb, true);
  exception when insufficient_privilege then
    v_wrote := false;
  end;
  if v_wrote is distinct from true then
    raise exception 'PT-8 FAILED: a live session cannot track presence';
  end if;
  execute 'reset role';

  -- The revoked phone: sees nothing, and cannot announce itself.
  perform pg_temp.present('2e000000-0000-4000-8000-00000000000c',
                          '2e000000-0000-4000-8000-0000000000d1');
  execute 'set local role authenticated';
  select count(*) into v_read from realtime.messages;
  if v_read is distinct from 0 then
    raise exception 'PT-8 FAILED: a revoked session reads % presence row(s) — '
      'presence names a conversation', v_read;
  end if;
  v_wrote := true;
  begin
    insert into realtime.messages (topic, extension, payload, private)
    values (pg_temp.presence_topic(), 'presence', '{}'::jsonb, true);
  exception when insufficient_privilege then
    v_wrote := false;
  end;
  execute 'reset role';
  if v_wrote is distinct from false then
    raise exception 'PT-8 FAILED: a revoked session WROTE presence — it can still '
      'announce itself on a customer''s conversation';
  end if;

  raise notice 'PT-8 PASSED: the presence policies refuse a revoked session on '
    'read and on write, and admit a live one on both';
exception
  when others then
    execute 'reset role';
    raise;
end $$;

-- ---------------------------------------------------------------------------
-- #576 (1), second half: assurance, not only revocation.
--
--   PT-9   a user with a VERIFIED factor on an aal1 session joins nothing
--   PT-10  the same user at aal2 joins normally
--   PT-11  a user with NO factor at aal1 is untouched, which is most of the
--          product and the reason this cannot be a blanket demand
--   PT-12  an ABSENT aal claim is REFUSED for a factor-holder — the opposite of
--          the session_id rule above, and deliberately so
-- ---------------------------------------------------------------------------

/* Presence with an assurance level. Separate from `pg_temp.present` so the
 * existing cases keep asserting exactly what they asserted before — adding a
 * claim to that helper would have silently changed eight tests. */
create or replace function pg_temp.present_aal(
  p_user text, p_session text, p_aal text
) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case
      when p_aal is null then
        json_build_object('sub', p_user, 'role', 'authenticated',
                          'session_id', p_session)::text
      else
        json_build_object('sub', p_user, 'role', 'authenticated',
                          'session_id', p_session, 'aal', p_aal)::text
    end, true);
end $$;

do $$
declare
  v_owner  text := '2e000000-0000-4000-8000-00000000000a';
  -- A session id NOBODY has heard of, which PT-4 proves is admitted by the
  -- revocation clause. That makes assurance the only variable below: the
  -- owner's seeded device (d5) is revoked, so borrowing it would refuse
  -- for the wrong reason and PT-9 would pass while proving nothing.
  v_sess   text := '2e000000-0000-4000-8000-0000000000d9';
  v_joined boolean;
begin
  -- The owner enrols a factor. `status = 'verified'`, because an abandoned
  -- enrolment leaves an `unverified` row and must demand nothing.
  insert into auth.mfa_factors (id, user_id, friendly_name, factor_type,
                                status, created_at, updated_at)
  values (gen_random_uuid(), v_owner::uuid, 'phone', 'totp',
          'verified', now(), now());

  -- PT-9 — a factor-holder on a password-only session.
  perform pg_temp.present_aal(v_owner, v_sess, 'aal1');
  v_joined := public.is_company_topic_member(pg_temp.company_topic());
  -- `is distinct from false`, not `if v_joined`: the predicate can return NULL,
  -- and a plpgsql `if NULL then` takes the false branch — so a NULL reads as a
  -- refusal and this assertion would pass without the gate doing anything.
  if v_joined is distinct from false then
    raise exception 'PT-9 FAILED: a password-only session joined the company '
      'topic while its owner holds a verified factor. Every /v1 call from that '
      'session is refused, so realtime would be the one way round the step-up.';
  end if;

  -- PT-10 — and the same person, stepped up, is not locked out.
  perform pg_temp.present_aal(v_owner, v_sess, 'aal2');
  v_joined := public.is_company_topic_member(pg_temp.company_topic());
  if v_joined is distinct from true then
    raise exception 'PT-10 FAILED: an aal2 session was refused. The rule is a '
      'step-up demand, not a ban.';
  end if;

  -- PT-12 — an absent aal claim, for somebody who holds a factor.
  --
  -- REFUSED, unlike an absent session_id. GoTrue mints `aal` on every access
  -- token and apps/api/src/auth/jwt.ts reads it on every request, so a token
  -- arriving here without one is not a token we issued.
  perform pg_temp.present_aal(v_owner, v_sess, null);
  v_joined := public.is_company_topic_member(pg_temp.company_topic());
  -- THE ONE THAT CAUGHT IT. Written as `if v_joined` this passed against a
  -- clause using `<>`, because NULL <> 'aal2' is NULL, the whole predicate
  -- yields NULL, and NULL is not true so no exception fired. The mutation
  -- survived and the suite called itself green.
  if v_joined is distinct from false then
    raise exception 'PT-12 FAILED: a token with no aal claim joined while its '
      'owner holds a factor. NULL is distinct from ''aal2'' — if this passes, '
      'the clause was probably written with <>, which yields NULL and takes '
      'the false branch.';
  end if;

  delete from auth.mfa_factors where user_id = v_owner::uuid;

  -- PT-11 — no factor, no demand. This is most of the product.
  perform pg_temp.present_aal(v_owner, v_sess, 'aal1');
  v_joined := public.is_company_topic_member(pg_temp.company_topic());
  if v_joined is distinct from true then
    raise exception 'PT-11 FAILED: a user with NO enrolled factor was refused '
      'at aal1, which is their normal and correct state.';
  end if;

  raise notice 'PT-9..12 PASSED: assurance is demanded of the people who '
    'enrolled and of nobody else, and an unsigned assurance reads as none';
end $$;

rollback;
