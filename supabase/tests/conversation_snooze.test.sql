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
-- SN-9. THE DEFAULT LIST HIDES WHAT I DEFERRED — AND ONLY FROM ME.
--
-- The schema is only half the feature. If `api_list_conversations` did not
-- default to excluding deferrals, every existing caller would keep showing
-- them and the snooze would be a row in a table that changes nothing. This is
-- the assertion that the DEFAULT — not an opt-in parameter — is exclusion.
--
-- State on arrival here: one deferral, member `a` on conversation `e1`,
-- returning in three days (set in SN-4, survived SN-5 and SN-6).
-- ===========================================================================
do $$
declare
  mine   int;
  theirs int;
  deferred jsonb;
begin
  select count(*) into mine from public.api_list_conversations(
    'da000000-0000-4000-8000-0000000000c1'::uuid,
    'da000000-0000-4000-8000-00000000000a'::uuid, 50);
  if mine <> 0 then
    raise exception
      'SN-9 FAILED: the default list still shows the % thread(s) I deferred. '
      'An opt-in exclusion is not a snooze.', mine;
  end if;

  select count(*) into theirs from public.api_list_conversations(
    'da000000-0000-4000-8000-0000000000c1'::uuid,
    'da000000-0000-4000-8000-00000000000b'::uuid, 50);
  if theirs <> 1 then
    raise exception
      'SN-9 FAILED: my deferral hid the thread from a colleague (% rows). The '
      'conversation is still the crew''s.', theirs;
  end if;

  -- …and 'only' is the "what did I defer" view, carrying the return time and
  -- the reason, so the list can say WHEN it comes back without a second read.
  select * into deferred from public.api_list_conversations(
    'da000000-0000-4000-8000-0000000000c1'::uuid,
    'da000000-0000-4000-8000-00000000000a'::uuid, 50,
    p_snoozed => 'only');
  if deferred is null
     or (deferred->>'id') <> 'da000000-0000-4000-8000-0000000000e1' then
    raise exception 'SN-9 FAILED: the snoozed view does not list the deferral';
  end if;
  if (deferred->>'snoozed_until') is null then
    raise exception
      'SN-9 FAILED: the snoozed view has no return time. "Hidden with no way '
      'to see what you deferred is worse than the problem."';
  end if;

  -- 'all' opts out of the filter entirely — the pre-#293 behaviour, still
  -- reachable for anything that genuinely wants every thread.
  select count(*) into mine from public.api_list_conversations(
    'da000000-0000-4000-8000-0000000000c1'::uuid,
    'da000000-0000-4000-8000-00000000000a'::uuid, 50,
    p_snoozed => 'all');
  if mine <> 1 then
    raise exception 'SN-9 FAILED: p_snoozed => ''all'' dropped a thread anyway';
  end if;

  raise notice 'SN-9 PASSED: hidden from me by default, never from the crew';
end $$;

-- ===========================================================================
-- SN-10. An ELAPSED deferral is back in the default list on its own.
--
-- Same claim as SN-2, made where it is actually observed. Nothing runs to put
-- the thread back: the join simply stops matching, so there is no sweep to be
-- late and no window in which a returned thread is still invisible.
-- ===========================================================================
do $$
declare n int;
begin
  update public.conversation_snoozes
    set until = now() - interval '1 second'
    where user_id = 'da000000-0000-4000-8000-00000000000a'::uuid;

  select count(*) into n from public.api_list_conversations(
    'da000000-0000-4000-8000-0000000000c1'::uuid,
    'da000000-0000-4000-8000-00000000000a'::uuid, 50);
  if n <> 1 then
    raise exception
      'SN-10 FAILED: a thread whose snooze has elapsed is still hidden. It '
      'comes back by itself or the feature loses jobs.';
  end if;
  raise notice 'SN-10 PASSED: it returns on its own, with nothing to run late';
end $$;

-- ===========================================================================
-- SN-11. THE FOCUS QUEUE STOPS COUNTING WHAT I DEFERRED — and only for me.
--
-- #293: "Snoozed threads are excluded from ... the focus queue count, or the
-- metric lies in the other direction." The focus queue is the surface that
-- tells a crew what needs them; a queue where half the items are not
-- actionable today trains people to stop trusting the count.
--
-- Asserted on TRIAGE (unassigned work), because that is the section both
-- members can see at once — which is what makes "only for me" provable rather
-- than merely stated.
-- ===========================================================================
update public.conversations
  set status = 'open', assigned_user_id = null
  where id = 'da000000-0000-4000-8000-0000000000e1'::uuid;

update public.conversation_snoozes
  set until = now() + interval '2 days'
  where user_id = 'da000000-0000-4000-8000-00000000000a'::uuid;

do $$
declare mine jsonb; theirs jsonb;
begin
  select public.api_for_you(
    'da000000-0000-4000-8000-0000000000c1'::uuid,
    'da000000-0000-4000-8000-00000000000a'::uuid,
    now(), 20, null) into mine;
  select public.api_for_you(
    'da000000-0000-4000-8000-0000000000c1'::uuid,
    'da000000-0000-4000-8000-00000000000b'::uuid,
    now(), 20, null) into theirs;

  if jsonb_array_length(mine->'triage'->'conversations') <> 0 then
    raise exception
      'SN-11 FAILED: my focus queue still lists the thread I deferred';
  end if;
  if (mine->'totals'->>'distinct_work')::int <> 0 then
    raise exception
      'SN-11 FAILED: the deferred thread still counts toward distinct_work (%). '
      'The headline number is the one a client renders as "N things need you".',
      mine->'totals'->>'distinct_work';
  end if;

  if jsonb_array_length(theirs->'triage'->'conversations') <> 1 then
    raise exception
      'SN-11 FAILED: my deferral emptied a COLLEAGUE''s queue too. The snooze '
      'is mine; the work is still the crew''s.';
  end if;
  raise notice 'SN-11 PASSED: off my queue, still on theirs';
end $$;

-- ===========================================================================
-- SN-12. A DEFERRAL CANNOT MOVE THE RESPONSE-TIME NUMBERS. Deliberately.
--
-- #293 asks that "snoozed periods do not count against response-time metrics".
-- Read against what #239 actually measures, that turns out to be TRUE ALREADY,
-- and building an exclusion would have made the metric lie:
--
--   #239 measures ONE window per thread — first inbound to first HUMAN reply.
--   A deferral can only overlap that window in one case: a lead somebody
--   deferred WITHOUT EVER ANSWERING IT. And #239 rule 6 exists precisely so a
--   workspace cannot improve its median by setting leads aside — "excluding
--   them would let a workspace improve its median by ignoring more leads,
--   which is the exact behaviour the metric is supposed to expose".
--
--   The case #293 describes — "I''ll get you a price once I''ve spoken to my
--   supplier" — is a thread the crew has ALREADY replied to. Its measurement
--   closed at that reply and no later deferral can touch it.
--
-- So this asserts the invariant instead of implementing a subtraction: the
-- stats are byte-identical with and without an active deferral. If somebody
-- later adds that subtraction, this fails and says why.
-- ===========================================================================
do $$
declare with_snooze jsonb; without_snooze jsonb;
begin
  select public.api_response_time_stats(
    'da000000-0000-4000-8000-0000000000c1'::uuid,
    now() - interval '1 day', now() + interval '1 day') into with_snooze;

  delete from public.conversation_snoozes;

  select public.api_response_time_stats(
    'da000000-0000-4000-8000-0000000000c1'::uuid,
    now() - interval '1 day', now() + interval '1 day') into without_snooze;

  if (with_snooze->>'answered') <> (without_snooze->>'answered')
     or (with_snooze->>'unanswered') <> (without_snooze->>'unanswered')
     or coalesce(with_snooze->>'median_seconds', '')
        <> coalesce(without_snooze->>'median_seconds', '') then
    raise exception
      'SN-12 FAILED: a deferral changed the response-time numbers (% vs %). '
      'Deferring must not be a lever on the metric we sell.',
      with_snooze, without_snooze;
  end if;
  -- …and the thread WAS measured, so this is not passing on an empty set.
  if (with_snooze->>'answered')::int < 1 then
    raise exception
      'SN-12 SETUP FAILED: no answered lead in range, so the comparison above '
      'proved nothing.';
  end if;
  raise notice 'SN-12 PASSED: deferring is not a lever on the response-time metric';
end $$;

-- ===========================================================================
-- SN-13. A PENDING FOLLOW-UP HIDES THE THREAD, exactly like a snooze.
--
-- This is the claim that makes one row with a `kind` the right model rather
-- than a convenience. A quote you are waiting on is not actionable today;
-- if a follow-up did NOT hide the thread, every existing read would need a
-- kind filter and the two would drift the first time somebody added a third
-- surface.
-- ===========================================================================
insert into public.conversation_snoozes
  (company_id, conversation_id, user_id, until, note, kind)
values
  ('da000000-0000-4000-8000-0000000000c1'::uuid,
   'da000000-0000-4000-8000-0000000000e1'::uuid,
   'da000000-0000-4000-8000-00000000000a'::uuid,
   now() + interval '3 days', 'chase the quote', 'follow_up');

do $$
declare listed int; queued jsonb;
begin
  select count(*) into listed from public.api_list_conversations(
    'da000000-0000-4000-8000-0000000000c1'::uuid,
    'da000000-0000-4000-8000-00000000000a'::uuid, 50);
  if listed <> 0 then
    raise exception
      'SN-13 FAILED: a pending follow-up left the thread in the default list. '
      'Every existing read tests `until > now()` and must not need to know '
      'about kinds.';
  end if;

  select public.api_for_you(
    'da000000-0000-4000-8000-0000000000c1'::uuid,
    'da000000-0000-4000-8000-00000000000a'::uuid,
    now(), 20, null) into queued;
  if jsonb_array_length(queued->'follow_ups') <> 0 then
    raise exception
      'SN-13 FAILED: a follow-up fired BEFORE its time. `until <= now()` is '
      'the whole mechanism.';
  end if;
  if (queued->'totals'->>'distinct_work')::int <> 0 then
    raise exception
      'SN-13 FAILED: a pending follow-up counts as work waiting on me today';
  end if;
  raise notice 'SN-13 PASSED: pending, so hidden — and not yet due';
end $$;

-- ===========================================================================
-- SN-14. WHEN IT COMES DUE, the focus queue says so — with the reason.
--
-- "A quote with no answer is the most valuable thing in the business to be
-- reminded about." Nothing runs to fire this: the row's `until` simply
-- passes, which is why there is no sweep to be late and no reminder lost to
-- a worker that did not run.
-- ===========================================================================
do $$
declare mine jsonb; theirs jsonb; row jsonb;
begin
  update public.conversation_snoozes
    set until = now() - interval '1 minute'
    where kind = 'follow_up';

  select public.api_for_you(
    'da000000-0000-4000-8000-0000000000c1'::uuid,
    'da000000-0000-4000-8000-00000000000a'::uuid,
    now(), 20, null) into mine;
  select public.api_for_you(
    'da000000-0000-4000-8000-0000000000c1'::uuid,
    'da000000-0000-4000-8000-00000000000b'::uuid,
    now(), 20, null) into theirs;

  if jsonb_array_length(mine->'follow_ups') <> 1 then
    raise exception
      'SN-14 FAILED: a due follow-up never reached the focus queue (% rows)',
      jsonb_array_length(mine->'follow_ups');
  end if;
  row := mine->'follow_ups'->0;
  if (row->>'conversation_id') <> 'da000000-0000-4000-8000-0000000000e1' then
    raise exception 'SN-14 FAILED: the wrong conversation came due';
  end if;
  if (row->>'note') <> 'chase the quote' then
    raise exception
      'SN-14 FAILED: the reminder arrived without the reason you gave it. '
      '"Chase this" with no context is a chore; "chase the quote" is a job.';
  end if;
  if (row->>'due_at') is null then
    raise exception 'SN-14 FAILED: no due time on the reminder';
  end if;

  -- It is MINE. A colleague never asked to be reminded of this.
  if jsonb_array_length(theirs->'follow_ups') <> 0 then
    raise exception
      'SN-14 FAILED: my reminder landed on a colleague''s queue too';
  end if;

  -- …and it counts as work, because the whole point is that it needs me.
  if (mine->'totals'->>'follow_ups')::int <> 1 then
    raise exception 'SN-14 FAILED: the due follow-up has no total of its own';
  end if;
  if (mine->'totals'->>'distinct_work')::int < 1 then
    raise exception
      'SN-14 FAILED: a due reminder does not count toward distinct_work, which '
      'is the number a client renders as "N things need you".';
  end if;
  raise notice 'SN-14 PASSED: due, surfaced, with its reason, to one person';
end $$;

-- ===========================================================================
-- SN-15. A CUSTOMER REPLY CANCELS A FOLLOW-UP TOO.
--
-- "Remind me to chase this in three days IF THEY HAVEN'T REPLIED" needs no
-- clause anywhere: the same inbound trigger deletes the row. This asserts
-- that the trigger was never narrowed to one kind — a reminder to chase
-- somebody who has already answered is the product nagging its own customer.
-- ===========================================================================
do $$
declare queued jsonb;
begin
  insert into public.messages
    (id, company_id, conversation_id, direction, status, body)
  values
    ('da000000-0000-4000-8000-0000000000f4'::uuid,
     'da000000-0000-4000-8000-0000000000c1'::uuid,
     'da000000-0000-4000-8000-0000000000e1'::uuid,
     'inbound', 'received', 'Yes, go ahead with the quote.');

  if exists (select 1 from public.conversation_snoozes where kind = 'follow_up')
  then
    raise exception
      'SN-15 FAILED: a follow-up survived the reply it was waiting for';
  end if;

  select public.api_for_you(
    'da000000-0000-4000-8000-0000000000c1'::uuid,
    'da000000-0000-4000-8000-00000000000a'::uuid,
    now(), 20, null) into queued;
  if jsonb_array_length(queued->'follow_ups') <> 0 then
    raise exception 'SN-15 FAILED: the queue still says to chase them';
  end if;
  raise notice 'SN-15 PASSED: they answered, so there is nothing to chase';
end $$;

-- ===========================================================================
-- SN-16. `kind` is closed. An unknown value is a typo, not a third mode.
-- ===========================================================================
do $$
begin
  begin
    insert into public.conversation_snoozes
      (company_id, conversation_id, user_id, until, kind)
    values
      ('da000000-0000-4000-8000-0000000000c1'::uuid,
       'da000000-0000-4000-8000-0000000000e1'::uuid,
       'da000000-0000-4000-8000-00000000000b'::uuid,
       now() + interval '1 day', 'reminder');
    raise exception 'SN-16 FAILED: kind = ''reminder'' was accepted';
  exception
    when check_violation then null;  -- expected
  end;
  raise notice 'SN-16 PASSED: a deferral is a snooze or a follow-up, nothing else';
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
