-- [#276] Offboarding assertion suite — the atomic deactivate-and-hand-on
-- (supabase/migrations/20260726000300_offboard_member.sql).
--
-- `deactivated_at` was a read filter and nothing more: a leaver's assigned
-- conversations kept pointing at them and their open tasks were owned by
-- nobody who would ever open the app again. The work did not fail loudly, it
-- just stopped, and the first sign was a customer asking why nobody called
-- back. These pin that removing someone always leaves their open work
-- somewhere a person will look, and that finished work keeps its history.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/offboard_member.test.sql
--
-- One transaction, rolled back. Fixtures use an 'of' id prefix so the file
-- runs standalone OR after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('0f000000-0000-4000-8000-00000000000a','offboard-owner@test.local'),
  ('0f000000-0000-4000-8000-00000000000b','offboard-leaver@test.local'),
  ('0f000000-0000-4000-8000-00000000000c','offboard-keeper@test.local');

insert into public.companies (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values ('0f000000-0000-4000-8000-000000000001','Offboard Co',
        '0f000000-0000-4000-8000-00000000000a','US','415', now());

insert into public.company_members (id, company_id, user_id, role) values
  ('0f000000-0000-4000-8000-000000000010','0f000000-0000-4000-8000-000000000001','0f000000-0000-4000-8000-00000000000a','owner'),
  ('0f000000-0000-4000-8000-000000000011','0f000000-0000-4000-8000-000000000001','0f000000-0000-4000-8000-00000000000b','member'),
  ('0f000000-0000-4000-8000-000000000012','0f000000-0000-4000-8000-000000000001','0f000000-0000-4000-8000-00000000000c','member');

insert into public.phone_numbers (id, company_id, status, provisioning_key, country, number_e164)
  values ('0f000000-0000-4000-8000-000000000020','0f000000-0000-4000-8000-000000000001',
          'active','offboard-pk','US','+14155557401');

insert into public.contacts (id, company_id, phone_e164, name)
  values ('0f000000-0000-4000-8000-000000000030','0f000000-0000-4000-8000-000000000001','+14155559901','Dana');

-- Two conversations for the leaver: one still open, one closed last year.
insert into public.conversations
  (id, company_id, contact_id, phone_number_id, assigned_user_id, status, closed_at)
values
  ('0f000000-0000-4000-8000-000000000040','0f000000-0000-4000-8000-000000000001',
   '0f000000-0000-4000-8000-000000000030','0f000000-0000-4000-8000-000000000020',
   '0f000000-0000-4000-8000-00000000000b', 'open', null),
  ('0f000000-0000-4000-8000-000000000041','0f000000-0000-4000-8000-000000000001',
   '0f000000-0000-4000-8000-000000000030','0f000000-0000-4000-8000-000000000020',
   '0f000000-0000-4000-8000-00000000000b', 'closed', now() - interval '200 days');

-- Two messages: one still open, one already done — the tasks below hang off
-- these, and task completion DERIVES from the message (D17).
insert into public.messages
  (id, company_id, conversation_id, direction, body, status, done_at, done_by_user_id)
values
  ('0f000000-0000-4000-8000-000000000050','0f000000-0000-4000-8000-000000000001',
   '0f000000-0000-4000-8000-000000000040','inbound','Gutters?','received', null, null),
  ('0f000000-0000-4000-8000-000000000051','0f000000-0000-4000-8000-000000000001',
   '0f000000-0000-4000-8000-000000000040','inbound','Old job','received',
   now() - interval '100 days', '0f000000-0000-4000-8000-00000000000b');

insert into public.tasks
  (id, company_id, message_id, conversation_id, title, assigned_user_id, created_by_user_id)
values
  ('0f000000-0000-4000-8000-000000000060','0f000000-0000-4000-8000-000000000001',
   '0f000000-0000-4000-8000-000000000050','0f000000-0000-4000-8000-000000000040',
   'Quote the gutters','0f000000-0000-4000-8000-00000000000b','0f000000-0000-4000-8000-00000000000a'),
  ('0f000000-0000-4000-8000-000000000061','0f000000-0000-4000-8000-000000000001',
   '0f000000-0000-4000-8000-000000000051','0f000000-0000-4000-8000-000000000040',
   'Finished job','0f000000-0000-4000-8000-00000000000b','0f000000-0000-4000-8000-00000000000a');

-- ---------------------------------------------------------------------------
-- OF-1. api_member_holdings counts only OPEN work — the thing an owner has to
--       decide about. A closed conversation and a done task need no decision.
-- ---------------------------------------------------------------------------
do $$
declare v jsonb;
begin
  v := public.api_member_holdings(
    '0f000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-00000000000b');
  if (v->>'conversations')::int <> 1 then
    raise exception 'OF-1 FAILED: conversations = % (want 1 — the closed one does not count)', v;
  end if;
  if (v->>'tasks')::int <> 1 then
    raise exception 'OF-1 FAILED: tasks = % (want 1 — the finished one does not count)', v;
  end if;
  raise notice 'OF-1 PASSED: holdings counts only open work';
end $$;

-- ---------------------------------------------------------------------------
-- OF-2. The guards, BEFORE anything is changed: the owner row is immutable,
--       a stranger is not found, and the work cannot be handed to someone who
--       is not on the team (handing a leaver's work to another leaver is the
--       same hole twice).
-- ---------------------------------------------------------------------------
do $$
declare
  v_company uuid := '0f000000-0000-4000-8000-000000000001';
  v jsonb;
begin
  v := public.offboard_member(v_company, '0f000000-0000-4000-8000-000000000010');
  if v->>'outcome' <> 'owner' then
    raise exception 'OF-2 FAILED: owner offboarding returned %', v;
  end if;

  v := public.offboard_member(v_company, '0f000000-0000-4000-8000-0000000000ff');
  if v->>'outcome' <> 'not_found' then
    raise exception 'OF-2 FAILED: unknown member returned %', v;
  end if;

  -- A destination who was never a member.
  v := public.offboard_member(v_company, '0f000000-0000-4000-8000-000000000011',
                              '0f000000-0000-4000-8000-0000000000fe');
  if v->>'outcome' <> 'bad_destination' then
    raise exception 'OF-2 FAILED: stranger destination returned %', v;
  end if;

  -- And the leaver cannot be handed their own work.
  v := public.offboard_member(v_company, '0f000000-0000-4000-8000-000000000011',
                              '0f000000-0000-4000-8000-00000000000b');
  if v->>'outcome' <> 'bad_destination' then
    raise exception 'OF-2 FAILED: self-destination returned %', v;
  end if;

  -- None of that touched the membership row.
  if exists (
    select 1 from public.company_members
     where id = '0f000000-0000-4000-8000-000000000011' and deactivated_at is not null
  ) then
    raise exception 'OF-2 FAILED: a refused offboarding still deactivated the member';
  end if;

  raise notice 'OF-2 PASSED: owner, stranger and bad destinations are refused intact';
end $$;

-- ---------------------------------------------------------------------------
-- OF-3. The real thing: deactivate AND hand the open work to a teammate, in
--       one transaction. Finished work keeps its attribution (#191) — the
--       record of who handled a customer last year is not rewritten to make a
--       leaver disappear.
-- ---------------------------------------------------------------------------
do $$
declare
  v_company uuid := '0f000000-0000-4000-8000-000000000001';
  v_leaver  uuid := '0f000000-0000-4000-8000-00000000000b';
  v_keeper  uuid := '0f000000-0000-4000-8000-00000000000c';
  v jsonb;
begin
  v := public.offboard_member(v_company, '0f000000-0000-4000-8000-000000000011', v_keeper);
  if v->>'outcome' <> 'deactivated' then
    raise exception 'OF-3 FAILED: outcome %', v;
  end if;
  if (v->>'conversations')::int <> 1 or (v->>'tasks')::int <> 1 then
    raise exception 'OF-3 FAILED: moved % (want 1 conversation, 1 task)', v;
  end if;

  -- Deactivated.
  if not exists (
    select 1 from public.company_members
     where id = '0f000000-0000-4000-8000-000000000011' and deactivated_at is not null
  ) then
    raise exception 'OF-3 FAILED: the member was not deactivated';
  end if;

  -- Open work moved; nothing anywhere still points at the leaver as OPEN work.
  if exists (
    select 1 from public.conversations
     where company_id = v_company and assigned_user_id = v_leaver and closed_at is null
  ) then
    raise exception 'OF-3 FAILED: an open conversation still points at the leaver';
  end if;
  if not exists (
    select 1 from public.conversations
     where id = '0f000000-0000-4000-8000-000000000040' and assigned_user_id = v_keeper
  ) then
    raise exception 'OF-3 FAILED: the open conversation did not reach the keeper';
  end if;
  if not exists (
    select 1 from public.tasks
     where id = '0f000000-0000-4000-8000-000000000060' and assigned_user_id = v_keeper
  ) then
    raise exception 'OF-3 FAILED: the open task did not reach the keeper';
  end if;

  -- History is untouched: the closed conversation and the finished task are
  -- still theirs.
  if not exists (
    select 1 from public.conversations
     where id = '0f000000-0000-4000-8000-000000000041' and assigned_user_id = v_leaver
  ) then
    raise exception 'OF-3 FAILED: a CLOSED conversation was rewritten';
  end if;
  if not exists (
    select 1 from public.tasks
     where id = '0f000000-0000-4000-8000-000000000061' and assigned_user_id = v_leaver
  ) then
    raise exception 'OF-3 FAILED: a FINISHED task was rewritten';
  end if;

  raise notice 'OF-3 PASSED: open work moves, finished work keeps its history';
end $$;

-- ---------------------------------------------------------------------------
-- OF-4. The migration path: an ALREADY-deactivated member (someone who left
--       before any of this existed) still has their orphaned work collected —
--       every workspace that has removed anyone has some. Releasing to
--       unassigned is a legitimate destination: the crew picks it up from the
--       shared inbox.
-- ---------------------------------------------------------------------------
do $$
declare
  v_company uuid := '0f000000-0000-4000-8000-000000000001';
  v_keeper  uuid := '0f000000-0000-4000-8000-00000000000c';
  v jsonb;
begin
  -- The keeper now holds what OF-3 handed them; offboard THEM with no
  -- destination and it must come loose rather than follow them out.
  v := public.offboard_member(v_company, '0f000000-0000-4000-8000-000000000012', null);
  if (v->>'conversations')::int <> 1 or (v->>'tasks')::int <> 1 then
    raise exception 'OF-4 FAILED: release moved % (want 1 and 1)', v;
  end if;
  if exists (
    select 1 from public.conversations
     where id = '0f000000-0000-4000-8000-000000000040' and assigned_user_id is not null
  ) then
    raise exception 'OF-4 FAILED: the conversation was not released';
  end if;
  if exists (
    select 1 from public.tasks
     where id = '0f000000-0000-4000-8000-000000000060' and assigned_user_id is not null
  ) then
    raise exception 'OF-4 FAILED: the task was not released';
  end if;

  -- Re-running against an already-deactivated member says so, and is a no-op
  -- for work that has already moved.
  v := public.offboard_member(v_company, '0f000000-0000-4000-8000-000000000012', null);
  if v->>'outcome' <> 'already' then
    raise exception 'OF-4 FAILED: second run returned %', v;
  end if;
  if (v->>'conversations')::int <> 0 or (v->>'tasks')::int <> 0 then
    raise exception 'OF-4 FAILED: second run moved % (want nothing left)', v;
  end if;

  raise notice 'OF-4 PASSED: release works, and re-running is a safe no-op';
end $$;

-- ---------------------------------------------------------------------------
-- OF-5. Session revocation (#236): removing someone ends their sessions, not
--       just their visibility. Deleting the GoTrue rows is what "sign out
--       everywhere" does — the refresh token has nothing left to refresh
--       against.
-- ---------------------------------------------------------------------------
do $$
declare
  v_leaver uuid := '0f000000-0000-4000-8000-00000000000b';
  v_keeper uuid := '0f000000-0000-4000-8000-00000000000c';
  v_deleted int;
begin
  insert into auth.sessions (id, user_id, created_at, updated_at) values
    ('0f000000-0000-4000-8000-000000000070', v_leaver, now(), now()),
    ('0f000000-0000-4000-8000-000000000071', v_leaver, now(), now()),
    ('0f000000-0000-4000-8000-000000000072', v_keeper, now(), now());

  v_deleted := public.api_revoke_user_sessions(v_leaver);
  if v_deleted <> 2 then
    raise exception 'OF-5 FAILED: revoked % sessions (want 2)', v_deleted;
  end if;
  if exists (select 1 from auth.sessions where user_id = v_leaver) then
    raise exception 'OF-5 FAILED: a session survived';
  end if;
  -- And nobody else was signed out.
  if not exists (select 1 from auth.sessions where user_id = v_keeper) then
    raise exception 'OF-5 FAILED: it signed out somebody else too';
  end if;

  raise notice 'OF-5 PASSED: sessions end for that person and nobody else';
end $$;

rollback;
