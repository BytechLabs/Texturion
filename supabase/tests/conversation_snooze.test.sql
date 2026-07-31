-- [#293] Snooze — assertion suite for
-- supabase/migrations/20260731020000_conversation_snooze.sql.
--
-- Most of what is pinned here is one rule, stated by the issue as
-- non-negotiable:
--
--   "A customer reply cancels the snooze immediately. If they text again, the
--    thread is live, no matter what the timer said. Getting this wrong means
--    ignoring a customer who is actively trying to reach you, which is the
--    single worst thing this product can do."
--
-- It lives in a trigger rather than a route handler precisely so that a future
-- ingress path cannot forget it, and these assertions are what make that claim
-- true rather than aspirational.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/conversation_snooze.test.sql
--
-- One transaction, rolled back. Fixtures use a 'da' id prefix so the file runs
-- standalone OR after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('da000000-0000-4000-8000-00000000000a'::uuid, 'snooze-a@test.local'),
  ('da000000-0000-4000-8000-00000000000b'::uuid, 'snooze-b@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('da000000-0000-4000-8000-0000000000c1'::uuid, 'Snooze Plumbing',
   'da000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());

insert into public.company_members (company_id, user_id, role) values
  ('da000000-0000-4000-8000-0000000000c1'::uuid,
   'da000000-0000-4000-8000-00000000000a'::uuid, 'owner'),
  ('da000000-0000-4000-8000-0000000000c1'::uuid,
   'da000000-0000-4000-8000-00000000000b'::uuid, 'member');

insert into public.contacts (id, company_id, phone_e164) values
  ('da000000-0000-4000-8000-0000000000d1'::uuid,
   'da000000-0000-4000-8000-0000000000c1'::uuid, '+15555550140');

insert into public.phone_numbers (id, company_id, status, provisioning_key, country)
values
  ('da000000-0000-4000-8000-0000000000b1'::uuid,
   'da000000-0000-4000-8000-0000000000c1'::uuid, 'active', 'da-snooze', 'US');

insert into public.conversations (id, company_id, contact_id, phone_number_id) values
  ('da000000-0000-4000-8000-0000000000e1'::uuid,
   'da000000-0000-4000-8000-0000000000c1'::uuid,
   'da000000-0000-4000-8000-0000000000d1'::uuid,
   'da000000-0000-4000-8000-0000000000b1'::uuid);

-- ===========================================================================
-- SN-1. A snooze is PER MEMBER: mine must not hide the thread from a colleague
--       who could handle it now.
-- ===========================================================================
insert into public.conversation_snoozes (company_id, conversation_id, user_id, until, note)
values
  ('da000000-0000-4000-8000-0000000000c1'::uuid,
   'da000000-0000-4000-8000-0000000000e1'::uuid,
   'da000000-0000-4000-8000-00000000000a'::uuid,
   now() + interval '2 days', 'waiting on the supplier');

do $$
declare mine int; theirs int;
begin
  select count(*) into mine from public.api_snoozed_conversation_ids(
    'da000000-0000-4000-8000-0000000000c1'::uuid,
    'da000000-0000-4000-8000-00000000000a'::uuid);
  select count(*) into theirs from public.api_snoozed_conversation_ids(
    'da000000-0000-4000-8000-0000000000c1'::uuid,
    'da000000-0000-4000-8000-00000000000b'::uuid);
  if mine <> 1 then
    raise exception 'SN-1 FAILED: the person who deferred it sees % rows', mine;
  end if;
  if theirs <> 0 then
    raise exception
      'SN-1 FAILED: a colleague sees the deferral too (% rows). The snooze is '
      'mine; the conversation is the crew''s.', theirs;
  end if;
  raise notice 'SN-1 PASSED: a deferral is one person''s, not the workspace''s';
end $$;

-- ===========================================================================
-- SN-2. A PAST `until` is already returned — computed, never swept.
--
-- The alternative (a cron that deletes expired rows) has a window in which a
-- thread is still invisible because the sweep has not run. There is no such
-- window here, and this is what says so.
-- ===========================================================================
do $$
declare n int;
begin
  update public.conversation_snoozes
    set until = now() - interval '1 minute'
    where user_id = 'da000000-0000-4000-8000-00000000000a'::uuid;
  select count(*) into n from public.api_snoozed_conversation_ids(
    'da000000-0000-4000-8000-0000000000c1'::uuid,
    'da000000-0000-4000-8000-00000000000a'::uuid);
  if n <> 0 then
    raise exception 'SN-2 FAILED: an elapsed snooze still hides the thread';
  end if;
  -- …and the row is still THERE, so "what did I defer" can explain itself.
  if not exists (
    select 1 from public.conversation_snoozes
    where user_id = 'da000000-0000-4000-8000-00000000000a'::uuid
  ) then
    raise exception 'SN-2 FAILED: the row was deleted rather than elapsed';
  end if;
  update public.conversation_snoozes
    set until = now() + interval '2 days'
    where user_id = 'da000000-0000-4000-8000-00000000000a'::uuid;
  raise notice 'SN-2 PASSED: return is computed, so there is no invisible window';
end $$;

-- ===========================================================================
-- SN-3. THE NON-NEGOTIABLE RULE. An inbound message cancels EVERY member's
--       snooze on that thread, immediately, whatever the timer said.
-- ===========================================================================
insert into public.conversation_snoozes (company_id, conversation_id, user_id, until)
values
  ('da000000-0000-4000-8000-0000000000c1'::uuid,
   'da000000-0000-4000-8000-0000000000e1'::uuid,
   'da000000-0000-4000-8000-00000000000b'::uuid,
   now() + interval '30 days');

do $$
declare n int;
begin
  if (select count(*) from public.conversation_snoozes) <> 2 then
    raise exception 'SN-3 SETUP FAILED: expected two deferrals before the reply';
  end if;

  insert into public.messages
    (id, company_id, conversation_id, direction, status, body)
  values
    ('da000000-0000-4000-8000-0000000000f1'::uuid,
     'da000000-0000-4000-8000-0000000000c1'::uuid,
     'da000000-0000-4000-8000-0000000000e1'::uuid,
     'inbound',
     'received',
     'Any update on that price?');

  select count(*) into n from public.conversation_snoozes;
  if n <> 0 then
    raise exception
      'SN-3 FAILED: % deferral(s) survived a customer reply. A customer '
      'actively trying to reach the business must never be hidden by somebody''s '
      'timer — including a timer set by a DIFFERENT member.', n;
  end if;
  raise notice 'SN-3 PASSED: a customer reply makes the thread live for everyone';
end $$;

-- ===========================================================================
-- SN-4. An OUTBOUND message does not cancel it.
--
-- The crew answering and then deferring again is a deliberate act. Clearing
-- their own snooze on their own reply would undo what they just asked for —
-- and "I'll get you a price on Thursday" is the exact shape of a thread you
-- answer and then defer.
-- ===========================================================================
insert into public.conversation_snoozes (company_id, conversation_id, user_id, until)
values
  ('da000000-0000-4000-8000-0000000000c1'::uuid,
   'da000000-0000-4000-8000-0000000000e1'::uuid,
   'da000000-0000-4000-8000-00000000000a'::uuid,
   now() + interval '3 days');

do $$
begin
  insert into public.messages
    (id, company_id, conversation_id, direction, status, sent_by_user_id, body)
  values
    ('da000000-0000-4000-8000-0000000000f2'::uuid,
     'da000000-0000-4000-8000-0000000000c1'::uuid,
     'da000000-0000-4000-8000-0000000000e1'::uuid,
     'outbound',
     'sent',
     'da000000-0000-4000-8000-00000000000a'::uuid,
     'Checking with my supplier, back to you Thursday.');

  if (select count(*) from public.conversation_snoozes) <> 1 then
    raise exception
      'SN-4 FAILED: our OWN reply cleared the deferral. Answering and then '
      'deferring is the normal case, not a contradiction.';
  end if;
  raise notice 'SN-4 PASSED: our own reply leaves the deferral alone';
end $$;

-- ===========================================================================
-- SN-5. A note does not cancel it either — a note reaches no customer.
-- ===========================================================================
do $$
begin
  insert into public.messages
    (id, company_id, conversation_id, direction, body)
  values
    ('da000000-0000-4000-8000-0000000000f3'::uuid,
     'da000000-0000-4000-8000-0000000000c1'::uuid,
     'da000000-0000-4000-8000-0000000000e1'::uuid,
     'note',
     'Supplier said Thursday.');

  if (select count(*) from public.conversation_snoozes) <> 1 then
    raise exception 'SN-5 FAILED: an internal note cleared a deferral';
  end if;
  raise notice 'SN-5 PASSED: an internal note is not a customer reply';
end $$;

-- ===========================================================================
-- SN-6. The note a person leaves on a deferral renders, so it is bounded.
-- ===========================================================================
do $$
begin
  begin
    update public.conversation_snoozes
      set note = repeat('x', 121)
      where user_id = 'da000000-0000-4000-8000-00000000000a'::uuid;
    raise exception 'SN-6 FAILED: a 121-character note was accepted';
  exception
    when check_violation then null;  -- expected
  end;
  raise notice 'SN-6 PASSED: the deferral note cannot become a payload';
end $$;

-- ===========================================================================
-- SN-7. A deferral cannot outlive what it defers.
--
-- Asserted on a thread with no messages, because `messages.conversation_id` is
-- RESTRICT — a conversation with history cannot be deleted at all, so trying to
-- prove the cascade through one would be testing that constraint instead of
-- this one.
-- ===========================================================================
-- A SECOND contact: D7 allows one open thread per contact/number, so reusing
-- the first would collide with `conversations_open_uq` rather than test this.
insert into public.contacts (id, company_id, phone_e164) values
  ('da000000-0000-4000-8000-0000000000d2'::uuid,
   'da000000-0000-4000-8000-0000000000c1'::uuid, '+15555550141');

insert into public.conversations (id, company_id, contact_id, phone_number_id) values
  ('da000000-0000-4000-8000-0000000000e2'::uuid,
   'da000000-0000-4000-8000-0000000000c1'::uuid,
   'da000000-0000-4000-8000-0000000000d2'::uuid,
   'da000000-0000-4000-8000-0000000000b1'::uuid);

insert into public.conversation_snoozes (company_id, conversation_id, user_id, until)
values
  ('da000000-0000-4000-8000-0000000000c1'::uuid,
   'da000000-0000-4000-8000-0000000000e2'::uuid,
   'da000000-0000-4000-8000-00000000000b'::uuid,
   now() + interval '1 day');

do $$
begin
  delete from public.conversations
    where id = 'da000000-0000-4000-8000-0000000000e2'::uuid;
  if exists (
    select 1 from public.conversation_snoozes
    where conversation_id = 'da000000-0000-4000-8000-0000000000e2'::uuid
  ) then
    raise exception 'SN-7 FAILED: a deferral outlived its conversation';
  end if;
  raise notice 'SN-7 PASSED: a deferral cannot outlive what it defers';
end $$;

-- ===========================================================================
-- SN-8. The read functions are service-role only, like every other api_*.
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
    and p.proname in ('api_snoozed_conversation_ids', 'api_snoozed_conversations')
    and r.rolname in ('anon', 'authenticated', 'public');
  if leaked is not null then
    raise exception 'SN-8 FAILED: snooze reads are callable by %', leaked;
  end if;
  raise notice 'SN-8 PASSED: the Worker holds the membership check, not the client';
end $$;

rollback;
