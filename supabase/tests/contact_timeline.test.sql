-- [#324] The contact timeline — assertion suite for
-- supabase/migrations/20260730140000_contact_timeline.sql.
--
-- The interleaving is the feature, so most of this pins ORDER and MEMBERSHIP:
-- which records belong to a relationship, which do not, and that they come back
-- as one stream rather than three lists a reader has to merge by eye.
--
-- One transaction, rolled back. Fixtures use a 'da' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('da000000-0000-4000-8000-00000000000a'::uuid, 'timeline-owner@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status)
values
  ('da000000-0000-4000-8000-0000000000c1'::uuid, 'Timeline Co',
   'da000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(), 'active'),
  -- A second workspace, to prove the tenant boundary holds.
  ('da000000-0000-4000-8000-0000000000c2'::uuid, 'Other Co',
   'da000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(), 'active');

insert into public.phone_numbers
  (id, company_id, provisioning_key, country, number_e164, status,
   requested_area_code)
values
  ('da000000-0000-4000-8000-0000000000b1'::uuid,
   'da000000-0000-4000-8000-0000000000c1'::uuid, 'timeline-1', 'US',
   '+14155550100', 'active', '415');

insert into public.contacts (id, company_id, phone_e164, name) values
  ('da000000-0000-4000-8000-0000000000a1'::uuid,
   'da000000-0000-4000-8000-0000000000c1'::uuid, '+14155551001', 'Dana Homeowner'),
  -- A different customer entirely; none of their records may leak in.
  ('da000000-0000-4000-8000-0000000000a2'::uuid,
   'da000000-0000-4000-8000-0000000000c1'::uuid, '+14155551002', 'Someone Else');

-- Six conversations for one contact, which is what D7's 30-day rule produces
-- for a customer serviced once a year. Spread across days so the ordering is
-- unambiguous.
-- `conversations_closed_consistency` enforces (status='closed') = (closed_at
-- is not null), so a closed fixture must carry the timestamp.
insert into public.conversations
  (id, company_id, phone_number_id, contact_id, status, is_spam,
   last_message_at, created_at, closed_at)
values
  ('da000000-0000-4000-8000-0000000000e1'::uuid,
   'da000000-0000-4000-8000-0000000000c1'::uuid,
   'da000000-0000-4000-8000-0000000000b1'::uuid,
   'da000000-0000-4000-8000-0000000000a1'::uuid, 'closed', false,
   now() - interval '400 days', now() - interval '400 days',
   now() - interval '400 days'),
  ('da000000-0000-4000-8000-0000000000e2'::uuid,
   'da000000-0000-4000-8000-0000000000c1'::uuid,
   'da000000-0000-4000-8000-0000000000b1'::uuid,
   'da000000-0000-4000-8000-0000000000a1'::uuid, 'open', false,
   now() - interval '2 days', now() - interval '40 days', null),
  -- SPAM: reachable in the inbox's spam view, never part of a relationship.
  ('da000000-0000-4000-8000-0000000000e3'::uuid,
   'da000000-0000-4000-8000-0000000000c1'::uuid,
   'da000000-0000-4000-8000-0000000000b1'::uuid,
   'da000000-0000-4000-8000-0000000000a1'::uuid, 'closed', true,
   now() - interval '5 days', now() - interval '5 days',
   now() - interval '5 days'),
  -- Another customer's thread.
  ('da000000-0000-4000-8000-0000000000e4'::uuid,
   'da000000-0000-4000-8000-0000000000c1'::uuid,
   'da000000-0000-4000-8000-0000000000b1'::uuid,
   'da000000-0000-4000-8000-0000000000a2'::uuid, 'open', false,
   now() - interval '1 day', now() - interval '1 day', null);

insert into public.calls
  (id, company_id, phone_number_id, call_session_id, caller_e164, contact_id,
   conversation_id, outcome, forward_seconds, started_at, caller_name)
values
  ('da000000-0000-4000-8000-0000000000f1'::uuid,
   'da000000-0000-4000-8000-0000000000c1'::uuid,
   'da000000-0000-4000-8000-0000000000b1'::uuid,
   'sess-da-1', '+14155551001',
   'da000000-0000-4000-8000-0000000000a1'::uuid,
   'da000000-0000-4000-8000-0000000000e2'::uuid, 'answered', 240,
   now() - interval '3 days', 'Dana Homeowner');

insert into public.messages
  -- `messages_note_status` requires a status on anything that is not a note,
  -- and `messages_done_consistency` requires done_at and done_by to agree.
  (id, company_id, conversation_id, direction, status, body, created_at,
   done_at, done_by_user_id)
values
  ('da000000-0000-4000-8000-0000000000d1'::uuid,
   'da000000-0000-4000-8000-0000000000c1'::uuid,
   'da000000-0000-4000-8000-0000000000e2'::uuid, 'inbound', 'received',
   'Furnace is making a noise', now() - interval '4 days', null, null),
  ('da000000-0000-4000-8000-0000000000d2'::uuid,
   'da000000-0000-4000-8000-0000000000c1'::uuid,
   'da000000-0000-4000-8000-0000000000e2'::uuid, 'inbound', 'received',
   'Also the vent', now() - interval '4 days', now() - interval '1 day',
   'da000000-0000-4000-8000-00000000000a'::uuid);

insert into public.tasks
  (id, company_id, message_id, conversation_id, title, created_by_user_id,
   due_at, created_at, deleted_at)
values
  ('da000000-0000-4000-8000-00000000000a'::uuid,
   'da000000-0000-4000-8000-0000000000c1'::uuid,
   'da000000-0000-4000-8000-0000000000d1'::uuid,
   'da000000-0000-4000-8000-0000000000e2'::uuid, 'Replace the blower',
   'da000000-0000-4000-8000-00000000000a'::uuid,
   now() + interval '2 days', now() - interval '4 days', null),
  -- Done, derived from the source message.
  ('da000000-0000-4000-8000-00000000000b'::uuid,
   'da000000-0000-4000-8000-0000000000c1'::uuid,
   'da000000-0000-4000-8000-0000000000d2'::uuid,
   'da000000-0000-4000-8000-0000000000e2'::uuid, 'Clean the vent',
   'da000000-0000-4000-8000-00000000000a'::uuid,
   null, now() - interval '6 days', null),
  -- Soft-deleted: must not appear.
  ('da000000-0000-4000-8000-00000000000c'::uuid,
   'da000000-0000-4000-8000-0000000000c1'::uuid,
   'da000000-0000-4000-8000-0000000000d1'::uuid,
   'da000000-0000-4000-8000-0000000000e2'::uuid, 'Deleted task',
   'da000000-0000-4000-8000-00000000000a'::uuid,
   null, now() - interval '7 days', now());

-- ---------------------------------------------------------------------------
-- ONE STREAM, all three kinds, newest first. This is the whole feature: the
-- reader scrolls once instead of merging two blocks by eye.
-- ---------------------------------------------------------------------------
do $$
declare v_kinds text[]; v_count int;
begin
  select array_agg(t->>'kind' order by ord), count(*)
    into v_kinds, v_count
  from (
    select t, row_number() over () as ord
    from public.api_contact_timeline(
      'da000000-0000-4000-8000-0000000000c1'::uuid,
      'da000000-0000-4000-8000-0000000000a1'::uuid) t
  ) s;

  -- 2 conversations (spam excluded) + 1 call + 2 tasks (deleted excluded).
  if v_count is distinct from 5 then
    raise exception 'timeline size: expected 5, got %', v_count;
  end if;
  -- Newest first: conversation (2d) > call (3d) > task (4d) > task (6d)
  -- > conversation (400d).
  if v_kinds is distinct from array['conversation','call','task','task','conversation'] then
    raise exception 'timeline order wrong: %', v_kinds;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- A spam thread is never part of the relationship. It stays in the inbox's
-- spam view; here it would be the one entry that makes the rest untrustworthy.
-- ---------------------------------------------------------------------------
do $$
declare v_count int;
begin
  select count(*) into v_count
  from public.api_contact_timeline(
    'da000000-0000-4000-8000-0000000000c1'::uuid,
    'da000000-0000-4000-8000-0000000000a1'::uuid) t
  where (t->>'id')::uuid = 'da000000-0000-4000-8000-0000000000e3'::uuid;
  if v_count is distinct from 0 then
    raise exception 'a spam conversation entered the timeline';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Another customer's records never appear. Contacts are phone-keyed and this
-- page is per contact; leaking here would be a privacy fault, not a UI one.
-- ---------------------------------------------------------------------------
do $$
declare v_count int;
begin
  select count(*) into v_count
  from public.api_contact_timeline(
    'da000000-0000-4000-8000-0000000000c1'::uuid,
    'da000000-0000-4000-8000-0000000000a1'::uuid) t
  where (t->>'id')::uuid = 'da000000-0000-4000-8000-0000000000e4'::uuid;
  if v_count is distinct from 0 then
    raise exception 'another contact''s conversation entered the timeline';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The tenant boundary. The same contact id read under a DIFFERENT company must
-- return nothing, even though the rows exist.
-- ---------------------------------------------------------------------------
do $$
declare v_count int;
begin
  select count(*) into v_count
  from public.api_contact_timeline(
    'da000000-0000-4000-8000-0000000000c2'::uuid,
    'da000000-0000-4000-8000-0000000000a1'::uuid) t;
  if v_count is distinct from 0 then
    raise exception 'cross-tenant read returned % rows', v_count;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- `done` DERIVES from the source message, exactly as the checklist reads it
-- (D17). A second flag could disagree with the thread; a join cannot.
-- ---------------------------------------------------------------------------
do $$
declare v_done boolean; v_open boolean;
begin
  select (t->>'done')::boolean into v_done
  from public.api_contact_timeline(
    'da000000-0000-4000-8000-0000000000c1'::uuid,
    'da000000-0000-4000-8000-0000000000a1'::uuid) t
  where (t->>'id')::uuid = 'da000000-0000-4000-8000-00000000000b'::uuid;
  select (t->>'done')::boolean into v_open
  from public.api_contact_timeline(
    'da000000-0000-4000-8000-0000000000c1'::uuid,
    'da000000-0000-4000-8000-0000000000a1'::uuid) t
  where (t->>'id')::uuid = 'da000000-0000-4000-8000-00000000000a'::uuid;
  if v_done is not true then
    raise exception 'a task whose message is done read as not done';
  end if;
  if v_open is not false then
    raise exception 'a task whose message is open read as done';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Jump-to-date and pagination are the same operation: "from here backwards".
-- ---------------------------------------------------------------------------
do $$
declare v_count int; v_first text;
begin
  select count(*) into v_count
  from public.api_contact_timeline(
    'da000000-0000-4000-8000-0000000000c1'::uuid,
    'da000000-0000-4000-8000-0000000000a1'::uuid,
    50, now() - interval '5 days',
    -- The id half of the keyset. All-f sorts above any real uuid, so this reads
    -- as "everything strictly older than that instant".
    'ffffffff-ffff-4fff-bfff-ffffffffffff'::uuid) t;
  -- Only the 6-day task and the 400-day conversation are older than that.
  if v_count is distinct from 2 then
    raise exception 'jump-to-date: expected 2 entries, got %', v_count;
  end if;

  select t->>'kind' into v_first
  from public.api_contact_timeline(
    'da000000-0000-4000-8000-0000000000c1'::uuid,
    'da000000-0000-4000-8000-0000000000a1'::uuid,
    1) t;
  if v_first is distinct from 'conversation' then
    raise exception 'limit 1 did not return the newest entry (got %)', v_first;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The call carries its talk time under the name the timeline uses. The column
-- is `forward_seconds` because it is the forward leg's billable seconds and
-- never ring time; renaming it in the projection is deliberate, so pin it.
-- ---------------------------------------------------------------------------
do $$
declare v record;
begin
  select (t->>'talk_seconds')::int as talk, t->>'status' as status
    into v
  from public.api_contact_timeline(
    'da000000-0000-4000-8000-0000000000c1'::uuid,
    'da000000-0000-4000-8000-0000000000a1'::uuid) t
  where t->>'kind' = 'call';
  if v.talk is distinct from 240 then
    raise exception 'call talk_seconds: expected 240, got %', v.talk;
  end if;
  if v.status is distinct from 'answered' then
    raise exception 'call outcome: expected answered, got %', v.status;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- A contact with no history at all returns an empty stream rather than failing.
-- ---------------------------------------------------------------------------
do $$
declare v_count int;
begin
  select count(*) into v_count
  from public.api_contact_timeline(
    'da000000-0000-4000-8000-0000000000c1'::uuid,
    'da000000-0000-4000-8000-0000000000de'::uuid) t;
  if v_count is distinct from 0 then
    raise exception 'unknown contact returned % rows', v_count;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- THE TIE-BREAK, which the first cut got wrong while claiming otherwise.
--
-- The ordering is (occurred_at, id) but the predicate compared only the
-- timestamp, so at a page boundary between two entries sharing an instant the
-- second was skipped by every subsequent page. A call threading a message
-- produces exactly that collision, so it was reachable rather than theoretical.
-- ---------------------------------------------------------------------------
-- A CALL and a CONVERSATION at the same instant, which is the collision the
-- comment describes: a call that threads a message stamps both from the same
-- moment. (Two open conversations cannot share a contact and number —
-- conversations_open_uq enforces D7 — so the cross-kind pair is both the
-- realistic case and the only constructible one.)
insert into public.conversations
  (id, company_id, phone_number_id, contact_id, status, is_spam,
   last_message_at, created_at, closed_at)
values
  ('da000000-0000-4000-8000-0000000000ea'::uuid,
   'da000000-0000-4000-8000-0000000000c1'::uuid,
   'da000000-0000-4000-8000-0000000000b1'::uuid,
   'da000000-0000-4000-8000-0000000000a1'::uuid, 'closed', false,
   now() - interval '200 days', now() - interval '200 days',
   now() - interval '200 days');

insert into public.calls
  (id, company_id, phone_number_id, call_session_id, caller_e164, contact_id,
   conversation_id, outcome, forward_seconds, started_at, caller_name)
values
  ('da000000-0000-4000-8000-0000000000eb'::uuid,
   'da000000-0000-4000-8000-0000000000c1'::uuid,
   'da000000-0000-4000-8000-0000000000b1'::uuid,
   'sess-da-tie', '+14155551001',
   'da000000-0000-4000-8000-0000000000a1'::uuid,
   'da000000-0000-4000-8000-0000000000ea'::uuid, 'answered', 60,
   -- The SAME instant as the conversation above.
   now() - interval '200 days', 'Dana Homeowner');

do $$
declare v_first uuid; v_second uuid; v_ts timestamptz;
begin
  select (t->>'id')::uuid, (t->>'occurred_at')::timestamptz
    into v_first, v_ts
  from public.api_contact_timeline(
    'da000000-0000-4000-8000-0000000000c1'::uuid,
    'da000000-0000-4000-8000-0000000000a1'::uuid, 1,
    (now() - interval '199 days'),
    'ffffffff-ffff-4fff-bfff-ffffffffffff'::uuid) t;

  -- The NEXT page, continuing from that exact key. The twin must appear; with a
  -- timestamp-only predicate it was skipped and unreachable.
  select (t->>'id')::uuid into v_second
  from public.api_contact_timeline(
    'da000000-0000-4000-8000-0000000000c1'::uuid,
    'da000000-0000-4000-8000-0000000000a1'::uuid, 1, v_ts, v_first) t;

  -- PRECISELY the twin, not merely "something". Under the timestamp-only
  -- predicate both twins were excluded and the next page returned an unrelated
  -- OLDER row, so a null/not-equal check alone would have passed against the
  -- very bug this exists to catch.
  if v_second is null then
    raise exception 'the twin sharing a timestamp was skipped at the page boundary';
  end if;
  if v_second = v_first then
    raise exception 'the page boundary repeated a row instead of advancing';
  end if;
  if v_second not in (
    'da000000-0000-4000-8000-0000000000ea'::uuid,
    'da000000-0000-4000-8000-0000000000eb'::uuid
  ) then
    raise exception
      'the page skipped past the tied pair to % — the twin is unreachable', v_second;
  end if;
end $$;

rollback;
