-- [#714] One activity model for every record: assertion suite for
-- supabase/migrations/20261111230000_one_activity_for_every_record.sql.
--
-- What is pinned:
--   RA-1  a text in and a text out are on the conversation AND the contact,
--         with the right actor and a link to the message
--   RA-2  a call with an outcome is on the call, the conversation and the
--         contact; its ended_reason lands on the same row, not a second one
--   RA-3  a contact edit records the field, before and after, and the member
--         who made it; a delete and a restore are recorded
--   RA-4  a merge is one event on each contact; the survivor's inherited
--         fields are not four edits
--   RA-5  task history lands on the task, and a creation and completion also
--         land on the contact
--   RA-6  assigned, tagged, opted out and opted in come from conversation events;
--         a block comes from blocked_senders
--   RA-7  scheduled texts: queued and cancelled
--   RA-8  the read: category filter, keyset pages, not_found for a foreign,
--         deleted or hidden record, and rows on a hidden number are dropped
--   RA-9  grants: only service_role reaches the table and the functions
--   RA-10 a replayed writer adds nothing twice
--
-- One transaction, rolled back. Fixtures use an 'a7' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('a7000000-0000-4000-8000-00000000000a', 'ra-owner@test.local'),
  ('a7000000-0000-4000-8000-00000000000b', 'ra-member@test.local'),
  ('a7000000-0000-4000-8000-00000000000c', 'ra-other@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status)
values
  ('a7000000-0000-4000-8000-0000000000c1', 'Activity Co',
   'a7000000-0000-4000-8000-00000000000a', 'US', '415', now(), 'active'),
  ('a7000000-0000-4000-8000-0000000000c2', 'Other Activity Co',
   'a7000000-0000-4000-8000-00000000000c', 'US', '415', now(), 'active');

insert into public.company_members (company_id, user_id, role) values
  ('a7000000-0000-4000-8000-0000000000c1', 'a7000000-0000-4000-8000-00000000000a', 'owner'),
  ('a7000000-0000-4000-8000-0000000000c1', 'a7000000-0000-4000-8000-00000000000b', 'member'),
  ('a7000000-0000-4000-8000-0000000000c2', 'a7000000-0000-4000-8000-00000000000c', 'owner');

insert into public.phone_numbers
  (id, company_id, provisioning_key, country, number_e164, status) values
  ('a7000000-0000-4000-8000-000000000a01', 'a7000000-0000-4000-8000-0000000000c1', 'ra-vis', 'US', '+12125550201', 'active'),
  ('a7000000-0000-4000-8000-000000000a02', 'a7000000-0000-4000-8000-0000000000c1', 'ra-hid', 'US', '+12125550202', 'active');

insert into public.contacts (id, company_id, phone_e164, name) values
  ('a7000000-0000-4000-8000-000000000b01', 'a7000000-0000-4000-8000-0000000000c1', '+12125550211', 'Jane Visible'),
  ('a7000000-0000-4000-8000-000000000b02', 'a7000000-0000-4000-8000-0000000000c1', '+12125550212', 'Jane Twin'),
  ('a7000000-0000-4000-8000-000000000b03', 'a7000000-0000-4000-8000-0000000000c1', '+12125550213', 'Hank Hidden');

insert into public.conversations
  (id, company_id, contact_id, phone_number_id, status, last_message_at) values
  ('a7000000-0000-4000-8000-000000000c01', 'a7000000-0000-4000-8000-0000000000c1',
   'a7000000-0000-4000-8000-000000000b01', 'a7000000-0000-4000-8000-000000000a01', 'open', now()),
  ('a7000000-0000-4000-8000-000000000c02', 'a7000000-0000-4000-8000-0000000000c1',
   'a7000000-0000-4000-8000-000000000b03', 'a7000000-0000-4000-8000-000000000a02', 'open', now());

\set co  '\'a7000000-0000-4000-8000-0000000000c1\''
\set own '\'a7000000-0000-4000-8000-00000000000a\''
\set mem '\'a7000000-0000-4000-8000-00000000000b\''
\set ct1 '\'a7000000-0000-4000-8000-000000000b01\''
\set ct2 '\'a7000000-0000-4000-8000-000000000b02\''
\set cv  '\'a7000000-0000-4000-8000-000000000c01\''
\set nv  '\'a7000000-0000-4000-8000-000000000a01\''

insert into public.messages (company_id, conversation_id, direction, body, status, sent_by_user_id)
values (:co, :cv, 'inbound', 'hello', 'received', null),
       (:co, :cv, 'outbound', 'hi back', 'sent', :mem);
insert into public.messages (company_id, conversation_id, direction, body, status)
values (:co, :cv, 'note', 'internal', null);

-- RA-1
do $$
declare
  cv uuid := 'a7000000-0000-4000-8000-000000000c01';
  ct uuid := 'a7000000-0000-4000-8000-000000000b01';
  mem uuid := 'a7000000-0000-4000-8000-00000000000b';
begin
  if (select count(*) from public.record_activity
       where record_type = 'conversation' and record_id = cv
         and kind in ('text_in', 'text_out')) is distinct from 2 then
    raise exception 'RA-1 FAILED: the conversation does not have both texts (and only them)';
  end if;
  if (select count(*) from public.record_activity
       where record_type = 'contact' and record_id = ct
         and kind in ('text_in', 'text_out')) is distinct from 2 then
    raise exception 'RA-1 FAILED: the contact does not have both texts';
  end if;
  if not exists (select 1 from public.record_activity
                  where record_id = ct and kind = 'text_out'
                    and actor_type = 'member' and actor_id = mem
                    and source_type = 'message' and conversation_id = cv) then
    raise exception 'RA-1 FAILED: the outbound text has no member actor or message link';
  end if;
  if not exists (select 1 from public.record_activity
                  where record_id = ct and kind = 'text_in' and actor_type = 'customer') then
    raise exception 'RA-1 FAILED: the inbound text is not the customer''s';
  end if;
  if exists (select 1 from public.record_activity where payload::text like '%internal%'
                                                     or payload::text like '%hello%') then
    raise exception 'RA-1 FAILED: a message body leaked into the activity';
  end if;
  raise notice 'RA-1 PASSED: texts';
end $$;

-- RA-2
insert into public.calls
  (id, company_id, phone_number_id, call_session_id, caller_e164, contact_id,
   conversation_id, direction)
values ('a7000000-0000-4000-8000-000000000d01', :co, :nv, 'ra-sess-1', '+12125550211',
        :ct1, :cv, 'inbound');
do $$
declare
  k uuid := 'a7000000-0000-4000-8000-000000000d01';
begin
  if exists (select 1 from public.record_activity where source_id = k) then
    raise exception 'RA-2 FAILED: a call in progress was recorded';
  end if;
  update public.calls set outcome = 'missed' where id = k;
  update public.calls set ended_reason = 'no_answer_in_time' where id = k;
  if (select count(*) from public.record_activity where source_id = k) is distinct from 3 then
    raise exception 'RA-2 FAILED: the call is not on the call, conversation and contact once each';
  end if;
  if not exists (select 1 from public.record_activity
                  where record_type = 'call' and record_id = k and kind = 'call'
                    and payload->>'ended_reason' = 'no_answer_in_time'
                    and payload->>'outcome' = 'missed' and payload->>'direction' = 'inbound') then
    raise exception 'RA-2 FAILED: direction, outcome and ended_reason are not on the row';
  end if;
  update public.calls set outcome = 'voicemail' where id = k;
  if not exists (select 1 from public.record_activity
                  where record_type = 'call' and record_id = k and kind = 'voicemail'
                    and payload->>'outcome' = 'voicemail') then
    raise exception 'RA-2 FAILED: a changed outcome did not refresh the row';
  end if;
  raise notice 'RA-2 PASSED: calls';
end $$;

-- RA-3
update public.contacts
   set name = 'Jane Renamed', updated_by_user_id = :mem
 where id = :ct1;
update public.contacts set deleted_at = now(), deleted_by_user_id = :own where id = :ct1;
update public.contacts set deleted_at = null, updated_by_user_id = :own where id = :ct1;
do $$
declare
  ct uuid := 'a7000000-0000-4000-8000-000000000b01';
begin
  if not exists (select 1 from public.record_activity
                  where record_id = ct and kind = 'edited'
                    and payload = jsonb_build_object('field', 'name',
                          'from', 'Jane Visible', 'to', 'Jane Renamed')
                    and actor_id = 'a7000000-0000-4000-8000-00000000000b') then
    raise exception 'RA-3 FAILED: the edit has no field, before, after or actor';
  end if;
  if not exists (select 1 from public.record_activity
                  where record_id = ct and kind = 'deleted'
                    and actor_id = 'a7000000-0000-4000-8000-00000000000a')
     or not exists (select 1 from public.record_activity
                     where record_id = ct and kind = 'restored') then
    raise exception 'RA-3 FAILED: delete and restore are not both recorded';
  end if;
  if not exists (select 1 from public.record_activity
                  where record_id = ct and kind = 'created') then
    raise exception 'RA-3 FAILED: creation is not recorded';
  end if;
  raise notice 'RA-3 PASSED: contact edits';
end $$;

-- RA-5
insert into public.tasks (id, company_id, title, conversation_id, created_by_user_id)
values ('a7000000-0000-4000-8000-000000000e01', :co, 'Fix the tap', :cv, :own);
update public.tasks set title = 'Fix the tap properly', due_at = now() + interval '1 day'
 where id = 'a7000000-0000-4000-8000-000000000e01';
update public.tasks set done_at = now(), done_by_user_id = 'a7000000-0000-4000-8000-00000000000b'
 where id = 'a7000000-0000-4000-8000-000000000e01';
do $$
declare
  t uuid := 'a7000000-0000-4000-8000-000000000e01';
begin
  if (select count(*) from public.record_activity where record_type = 'task'
        and record_id = t and kind = 'edited') is distinct from 2 then
    raise exception 'RA-5 FAILED: the task title and due edits are not both on the task';
  end if;
  if not exists (select 1 from public.record_activity where record_type = 'task'
                  and record_id = t and kind = 'created')
     or not exists (select 1 from public.record_activity where record_type = 'task'
                     and record_id = t and kind = 'completed') then
    raise exception 'RA-5 FAILED: the task has no creation or completion';
  end if;
  if not exists (select 1 from public.record_activity
                  where record_type = 'contact'
                    and record_id = 'a7000000-0000-4000-8000-000000000b01'
                    and kind = 'task_created' and source_id = t) then
    raise exception 'RA-5 FAILED: the contact does not see the task';
  end if;
  raise notice 'RA-5 PASSED: tasks';
end $$;

-- RA-6
insert into public.conversation_events (company_id, conversation_id, actor_user_id, type, payload)
values
  (:co, :cv, :own, 'assigned', jsonb_build_object('from', null, 'to', 'a7000000-0000-4000-8000-00000000000b')),
  (:co, :cv, :own, 'assigned', jsonb_build_object('from', 'a7000000-0000-4000-8000-00000000000b', 'to', null)),
  (:co, :cv, :own, 'tag_added', jsonb_build_object('tag_id', gen_random_uuid(), 'name', 'VIP')),
  (:co, :cv, null, 'opted_out', jsonb_build_object('source', 'stop_keyword', 'keyword', 'STOP')),
  (:co, :cv, :own, 'opt_out_revoked', jsonb_build_object('phone_e164', '+12125550211')),
  (:co, :cv, :own, 'quote_sent', '{}'::jsonb);
insert into public.blocked_senders (company_id, phone_e164, blocked_by)
values (:co, '+12125550211', :mem);
do $$
declare
  cv uuid := 'a7000000-0000-4000-8000-000000000c01';
  ct uuid := 'a7000000-0000-4000-8000-000000000b01';
begin
  if (select count(*) from public.record_activity where record_type = 'conversation'
        and record_id = cv and kind in ('assigned', 'unassigned', 'tagged')) is distinct from 3 then
    raise exception 'RA-6 FAILED: assigned, unassigned and tagged are not on the conversation';
  end if;
  if not exists (select 1 from public.record_activity where record_id = ct
                  and kind = 'opted_out' and actor_type = 'customer')
     or not exists (select 1 from public.record_activity where record_id = ct
                     and kind = 'opted_in' and actor_type = 'member') then
    raise exception 'RA-6 FAILED: opt out (customer) and opt in (member) are not on the contact';
  end if;
  if exists (select 1 from public.record_activity where record_id = cv
              and source_type = 'conversation_event'
              and kind not in ('assigned', 'unassigned', 'tagged', 'opted_out', 'opted_in', 'edited')) then
    raise exception 'RA-6 FAILED: an event outside the list was recorded';
  end if;
  if not exists (select 1 from public.record_activity where record_id = ct
                  and kind = 'blocked' and actor_id = 'a7000000-0000-4000-8000-00000000000b') then
    raise exception 'RA-6 FAILED: the block is not on the contact';
  end if;
  raise notice 'RA-6 PASSED: conversation events, opt-outs, blocks';
end $$;

-- RA-7
insert into public.scheduled_messages
  (id, company_id, conversation_id, body, send_at, clock_timezone, clock_source,
   status, created_by, origin, expires_at)
values ('a7000000-0000-4000-8000-000000000f01', :co, :cv, 'later', now() + interval '1 hour',
        'UTC', 'company', 'pending', :mem, 'human', now() + interval '2 days');
update public.scheduled_messages set status = 'canceled', canceled_at = now(), canceled_by = :own
 where id = 'a7000000-0000-4000-8000-000000000f01';
do $$
begin
  if (select count(*) from public.record_activity
       where source_id = 'a7000000-0000-4000-8000-000000000f01'
         and record_type = 'contact'
         and kind in ('scheduled_queued', 'scheduled_cancelled')) is distinct from 2 then
    raise exception 'RA-7 FAILED: queued and cancelled are not both on the contact';
  end if;
  if not exists (select 1 from public.record_activity
                  where kind = 'scheduled_cancelled'
                    and actor_id = 'a7000000-0000-4000-8000-00000000000a') then
    raise exception 'RA-7 FAILED: the cancellation does not name who cancelled';
  end if;
  raise notice 'RA-7 PASSED: scheduled texts';
end $$;

-- RA-4: the merge
select public.api_merge_contacts(:co, :ct2, :ct1, :own);
do $$
declare
  a uuid := 'a7000000-0000-4000-8000-000000000b02';
  b uuid := 'a7000000-0000-4000-8000-000000000b01';
begin
  if not exists (select 1 from public.record_activity where record_id = a and kind = 'merged'
                  and payload->>'role' = 'merged_away')
     or not exists (select 1 from public.record_activity where record_id = b and kind = 'merged'
                     and payload->>'role' = 'survivor') then
    raise exception 'RA-4 FAILED: the merge is not on both contacts';
  end if;
  if (select count(*) from public.record_activity where record_id = b and kind = 'edited') > 1 then
    raise exception 'RA-4 FAILED: the merge recorded the inherited fields as edits';
  end if;
  raise notice 'RA-4 PASSED: merge';
end $$;

-- RA-8: the read
do $$
declare
  co uuid := 'a7000000-0000-4000-8000-0000000000c1';
  co2 uuid := 'a7000000-0000-4000-8000-0000000000c2';
  ct uuid := 'a7000000-0000-4000-8000-000000000b01';
  nh uuid := 'a7000000-0000-4000-8000-000000000a02';
  nv uuid := 'a7000000-0000-4000-8000-000000000a01';
  r jsonb;
  r2 jsonb;
  v_ts timestamptz;
  v_id uuid;
  v_n int;
begin
  r := public.api_record_activity(co, 'contact', ct, null, null, 100);
  if r->>'outcome' is distinct from 'ok' or jsonb_array_length(r->'items') < 8 then
    raise exception 'RA-8 FAILED: the contact has too little activity: %', r;
  end if;

  v_n := 0;
  v_n := v_n + jsonb_array_length((public.api_record_activity(co, 'contact', ct, null, 'message', 100))->'items');
  v_n := v_n + jsonb_array_length((public.api_record_activity(co, 'contact', ct, null, 'call', 100))->'items');
  v_n := v_n + jsonb_array_length((public.api_record_activity(co, 'contact', ct, null, 'change', 100))->'items');
  if v_n is distinct from jsonb_array_length(r->'items') then
    raise exception 'RA-8 FAILED: the three filters do not add up to All (% vs %)',
      v_n, jsonb_array_length(r->'items');
  end if;

  -- Keyset pages: walk 3 at a time and see every row exactly once.
  v_n := 0; v_ts := null; v_id := null;
  loop
    r2 := public.api_record_activity(co, 'contact', ct, null, null, 3, v_ts, v_id);
    exit when jsonb_array_length(r2->'items') = 0;
    v_n := v_n + jsonb_array_length(r2->'items');
    v_ts := (r2->'items'->(jsonb_array_length(r2->'items') - 1)->>'occurred_at')::timestamptz;
    v_id := (r2->'items'->(jsonb_array_length(r2->'items') - 1)->>'id')::uuid;
    exit when v_n > 200;
  end loop;
  if v_n is distinct from jsonb_array_length(r->'items') then
    raise exception 'RA-8 FAILED: paging saw % rows, not %', v_n, jsonb_array_length(r->'items');
  end if;

  if (public.api_record_activity(co2, 'contact', ct, null, null, 10))->>'outcome' is distinct from 'not_found'
     or (public.api_record_activity(co, 'contact', gen_random_uuid(), null, null, 10))->>'outcome' is distinct from 'not_found' then
    raise exception 'RA-8 FAILED: a foreign or missing record is not not_found';
  end if;

  -- #106: a hidden number's records are not found, and its rows leave the contact.
  if (public.api_record_activity(co, 'conversation', 'a7000000-0000-4000-8000-000000000c02', array[nh], null, 10))->>'outcome' is distinct from 'not_found' then
    raise exception 'RA-8 FAILED: a hidden conversation is readable';
  end if;
  if (public.api_record_activity(co, 'call', 'a7000000-0000-4000-8000-000000000d01', array[nv], null, 10))->>'outcome' is distinct from 'not_found' then
    raise exception 'RA-8 FAILED: a call on a hidden number is readable';
  end if;
  r2 := public.api_record_activity(co, 'contact', ct, array[nv], null, 100);
  if exists (select 1 from jsonb_array_elements(r2->'items') i
              where i->>'kind' in ('text_in', 'text_out', 'call', 'voicemail')) then
    raise exception 'RA-8 FAILED: rows on a hidden number are on the contact';
  end if;
  if jsonb_array_length(r2->'items') = 0 then
    raise exception 'RA-8 FAILED: hiding a number hid the contact''s own changes too';
  end if;
  raise notice 'RA-8 PASSED: read';
end $$;

-- RA-10: a replayed writer adds nothing
do $$
declare
  v_before bigint;
  m public.messages;
begin
  select count(*) into v_before from public.record_activity;
  for m in select * from public.messages where direction::text <> 'note' loop
    perform public.record_activity_message(m);
  end loop;
  if (select count(*) from public.record_activity) is distinct from v_before then
    raise exception 'RA-10 FAILED: replaying the writer added rows';
  end if;
  raise notice 'RA-10 PASSED: idempotent';
end $$;

-- RA-9: grants
do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.api_record_activity(uuid, text, uuid, uuid[], text, int, timestamptz, uuid)',
    'public.record_activity_add(uuid, text, uuid, text, uuid, text, jsonb, text, uuid, uuid, uuid, timestamptz, text, boolean)',
    'public.record_activity_message(public.messages)',
    'public.record_activity_on_contact()'
  ] loop
    if has_function_privilege('anon', v_sig, 'execute')
       or has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception 'RA-9 FAILED: % is callable by anon or authenticated', v_sig;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.record_activity', 'select')
     or has_table_privilege('authenticated', 'public.record_activity', 'select') then
    raise exception 'RA-9 FAILED: record_activity is readable by anon or authenticated';
  end if;
  if not has_function_privilege('service_role',
       'public.api_record_activity(uuid, text, uuid, uuid[], text, int, timestamptz, uuid)', 'execute') then
    raise exception 'RA-9 FAILED: service_role cannot read';
  end if;
  raise notice 'RA-9 PASSED: grants';
end $$;

-- RA-11: trash and restore
update public.calls set deleted_at = now(), deleted_by_user_id = :mem
 where id = 'a7000000-0000-4000-8000-000000000d01';
update public.calls set deleted_at = null
 where id = 'a7000000-0000-4000-8000-000000000d01';
update public.conversations set deleted_at = now(), deleted_by_user_id = :own where id = :cv;
do $$
begin
  if not exists (select 1 from public.record_activity
                  where record_type = 'call' and record_id = 'a7000000-0000-4000-8000-000000000d01'
                    and kind = 'deleted' and actor_id = 'a7000000-0000-4000-8000-00000000000b')
     or not exists (select 1 from public.record_activity
                     where record_type = 'call' and record_id = 'a7000000-0000-4000-8000-000000000d01'
                       and kind = 'restored') then
    raise exception 'RA-11 FAILED: a trashed and restored call is not recorded';
  end if;
  if not exists (select 1 from public.record_activity
                  where record_type = 'conversation' and kind = 'deleted') then
    raise exception 'RA-11 FAILED: a trashed conversation is not recorded';
  end if;
  -- A trashed thread is not part of the contact's relationship.
  if exists (select 1 from jsonb_array_elements(
        (public.api_record_activity('a7000000-0000-4000-8000-0000000000c1', 'contact',
           'a7000000-0000-4000-8000-000000000b01', null, null, 200))->'items') i
      where i->>'kind' in ('text_in', 'text_out')) then
    raise exception 'RA-11 FAILED: a trashed thread''s texts are still on the contact';
  end if;
  raise notice 'RA-11 PASSED: trash';
end $$;

-- RA-12 (#725): the call machine's steps land on the call's own timeline, under
-- Calls, and nowhere else; the same step twice is one row; another workspace's
-- session id writes nothing.
do $$
declare
  k uuid := 'a7000000-0000-4000-8000-000000000d01';
  co uuid := 'a7000000-0000-4000-8000-0000000000c1';
  mem uuid := 'a7000000-0000-4000-8000-00000000000b';
  steps jsonb := jsonb_build_array(
    jsonb_build_object('kind', 'call_rang', 'at', '2026-11-10T15:00:01Z',
                       'actor_type', 'system', 'payload', jsonb_build_object('user_ids', jsonb_build_array(mem))),
    jsonb_build_object('kind', 'call_declined', 'at', '2026-11-10T15:00:05Z',
                       'actor_user_id', mem, 'payload', '{}'::jsonb),
    jsonb_build_object('kind', 'call_ended', 'at', '2026-11-10T15:00:30Z',
                       'actor_type', 'system',
                       'payload', jsonb_build_object('reason', 'declined_by_everyone', 'seconds', 30)));
  n int;
begin
  if public.record_call_steps(co, 'ra-sess-1', steps) is distinct from 3 then
    raise exception 'RA-12 FAILED: the steps were not written';
  end if;
  perform public.record_call_steps(co, 'ra-sess-1', steps);
  select count(*) into n from public.record_activity
   where record_type = 'call' and record_id = k and kind like 'call\_%';
  if n is distinct from 3 then
    raise exception 'RA-12 FAILED: % step rows after writing the same three twice', n;
  end if;
  if exists (select 1 from public.record_activity
              where record_id = k and kind like 'call\_%' and category <> 'call') then
    raise exception 'RA-12 FAILED: a call step is not filed under Calls';
  end if;
  if exists (select 1 from public.record_activity
              where kind like 'call\_%' and record_type <> 'call') then
    raise exception 'RA-12 FAILED: a call step reached a contact or thread timeline';
  end if;
  if not exists (select 1 from public.record_activity
                  where record_id = k and kind = 'call_declined' and actor_id = mem
                    and actor_type = 'member') then
    raise exception 'RA-12 FAILED: the decline does not name who declined';
  end if;
  if public.record_call_steps('a7000000-0000-4000-8000-0000000000ff', 'ra-sess-1', steps) is distinct from 0 then
    raise exception 'RA-12 FAILED: another workspace wrote onto this call';
  end if;
  if has_function_privilege('authenticated', 'public.record_call_steps(uuid, text, jsonb)', 'execute') then
    raise exception 'RA-12 FAILED: a signed-in user can write call steps';
  end if;
  raise notice 'RA-12 PASSED: call steps';
end $$;

rollback;
