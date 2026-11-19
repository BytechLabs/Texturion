-- [#691] Deleting messages, conversations, calls and voicemails; the 30-day Trash;
-- the purge. Assertion suite for
-- supabase/migrations/20261110170000_deletion_and_trash.sql.
--
-- Ordered by what each assertion protects:
--
--   DT-1  a trashed message / conversation / call / voicemail is invisible to the
--         read paths, and comes back whole on restore
--   DT-2  a trashed conversation is not reopened or appended to by a new text
--   DT-3  restore never breaks the one-open-thread rule
--   DT-4  tenant isolation and the #106 deny list on every function
--   DT-5  the purge erases content, and no media / recording / transcript /
--         summary survives it
--   DT-6  USAGE AND BILLING ARE UNTOUCHED by trash and purge
--   DT-7  OPT-OUT AND CONSENT EVIDENCE SURVIVE: the row, and the timeline event
--   DT-8  a legal hold stops the erasure but not the delete
--   DT-9  what is due: 30 days, not before; the audit row is content-free
--
-- One transaction, rolled back. Fixtures use a 'dt' id prefix.
-- Phone numbers are in the fictional 555-01xx range.

\set ON_ERROR_STOP on

begin;

do $$
declare
  unclassified text[];
  stale text[];
begin
  with inventory(table_name) as (
    values
      -- api_trash_due and api_purge_trash_item.
      ('calls'), ('contacts'), ('conversations'), ('messages'), ('tasks'), ('task_comments'),
      -- The attachment sweep removes objects and rows after the signed URL grace period.
      ('attachments'),
      -- purgeClosedWorkspaces clears the company profile after closure.
      ('companies'),
      -- Template expiry is a separate decision in #419.
      ('templates')
  ), soft_deleted_tables as (
    select c.table_name::text as table_name
      from information_schema.columns c
      join information_schema.tables t using (table_catalog, table_schema, table_name)
     where c.table_schema = 'public' and c.column_name = 'deleted_at'
       and t.table_type = 'BASE TABLE'
  )
  select
    array_agg(s.table_name order by s.table_name) filter (where i.table_name is null),
    array_agg(i.table_name order by i.table_name) filter (where s.table_name is null)
    into unclassified, stale
    from soft_deleted_tables s
    full join inventory i using (table_name);

  if unclassified is not null or stale is not null then
    raise exception 'Soft-delete retention inventory needs updating. Unclassified: %, stale: %',
      coalesce(unclassified, '{}'), coalesce(stale, '{}');
  end if;
end $$;

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                        created_at, updated_at, aud, role)
values ('d1000000-0000-4000-8000-000000000001', 'trash@test.local', '', now(),
        now(), now(), 'authenticated', 'authenticated')
on conflict (id) do nothing;

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, plan)
values ('d1000000-0000-4000-8000-000000000002', 'Trash Test Co',
        'd1000000-0000-4000-8000-000000000001', 'US', '212', now(), 'active', 'pro'),
       ('d1000000-0000-4000-8000-00000000000b', 'Other Co',
        'd1000000-0000-4000-8000-000000000001', 'US', '213', now(), 'active', 'pro');

insert into public.company_members (company_id, user_id, role)
values ('d1000000-0000-4000-8000-000000000002',
        'd1000000-0000-4000-8000-000000000001', 'owner');

insert into public.phone_numbers
  (id, company_id, number_e164, status, provisioning_key, country)
values ('d1000000-0000-4000-8000-000000000010',
        'd1000000-0000-4000-8000-000000000002', '+12125550110', 'active', 'dt-key-10', 'US'),
       ('d1000000-0000-4000-8000-000000000011',
        'd1000000-0000-4000-8000-000000000002', '+12125550111', 'active', 'dt-key-11', 'US');

insert into public.contacts (id, company_id, phone_e164, name)
values ('d1000000-0000-4000-8000-000000000020',
        'd1000000-0000-4000-8000-000000000002', '+12125550120', 'Dana Delete'),
       ('d1000000-0000-4000-8000-000000000021',
        'd1000000-0000-4000-8000-000000000002', '+12125550121', 'Sam Hidden');

-- The thread under test: Dana, on the visible number, open.
insert into public.conversations
  (id, company_id, contact_id, phone_number_id, status, last_message_at)
values ('d1000000-0000-4000-8000-000000000030',
        'd1000000-0000-4000-8000-000000000002',
        'd1000000-0000-4000-8000-000000000020',
        'd1000000-0000-4000-8000-000000000010', 'open', now()),
       -- A thread on the number the actor is denied.
       ('d1000000-0000-4000-8000-000000000031',
        'd1000000-0000-4000-8000-000000000002',
        'd1000000-0000-4000-8000-000000000021',
        'd1000000-0000-4000-8000-000000000011', 'open', now());

insert into public.messages
  (id, company_id, conversation_id, direction, body, status, sent_by_user_id,
   segments, created_at)
values
  -- inbound, with an MMS attachment
  ('d1000000-0000-4000-8000-000000000040', 'd1000000-0000-4000-8000-000000000002',
   'd1000000-0000-4000-8000-000000000030', 'inbound', 'the gate code is zebra99',
   'received', null, 1, now() - interval '3 minutes'),
  -- outbound, metered
  ('d1000000-0000-4000-8000-000000000041', 'd1000000-0000-4000-8000-000000000002',
   'd1000000-0000-4000-8000-000000000030', 'outbound', 'we will be there at nine',
   'sent', 'd1000000-0000-4000-8000-000000000001', 2, now() - interval '2 minutes'),
  -- an internal note
  ('d1000000-0000-4000-8000-000000000042', 'd1000000-0000-4000-8000-000000000002',
   'd1000000-0000-4000-8000-000000000030', 'note', 'owes us from last time',
   null, 'd1000000-0000-4000-8000-000000000001', null, now() - interval '1 minute'),
  -- a message on the hidden number's thread
  ('d1000000-0000-4000-8000-000000000043', 'd1000000-0000-4000-8000-000000000002',
   'd1000000-0000-4000-8000-000000000031', 'inbound', 'private', 'received',
   null, 1, now());

insert into public.message_attachments
  (id, message_id, company_id, storage_path, content_type, size_bytes)
values ('d1000000-0000-4000-8000-000000000050', 'd1000000-0000-4000-8000-000000000040',
        'd1000000-0000-4000-8000-000000000002',
        'mms-media/d1000000-0000-4000-8000-000000000002/d1000000-0000-4000-8000-000000000040/0',
        'image/jpeg', 1000);

-- A job made from the note, with a comment and a file on the comment.
insert into public.tasks
  (id, company_id, message_id, conversation_id, title, description, created_by_user_id)
values ('d1000000-0000-4000-8000-0000000000a0', 'd1000000-0000-4000-8000-000000000002',
        'd1000000-0000-4000-8000-000000000042', 'd1000000-0000-4000-8000-000000000030',
        'Replace the boiler valve', 'zebra99 gate, ring twice',
        'd1000000-0000-4000-8000-000000000001');
update public.tasks
   set title = 'Replace boiler valve today',
       addr_street = '14 Maple Row', addr_city = 'Springfield',
       addr_postal_code = '90210', addr_provenance = 'manual'
 where id = 'd1000000-0000-4000-8000-0000000000a0';
-- The address trigger clears the map position on every address change, so the
-- pin is set after it.
update public.tasks
   set lat = 40.1, lng = -75.2, geocoded_at = now(), geocode_status = 'ok'
 where id = 'd1000000-0000-4000-8000-0000000000a0';
insert into public.task_comments (id, company_id, task_id, author_user_id, body)
values ('d1000000-0000-4000-8000-0000000000a1', 'd1000000-0000-4000-8000-000000000002',
        'd1000000-0000-4000-8000-0000000000a0', 'd1000000-0000-4000-8000-000000000001',
        'customer is awkward about parking');
insert into public.attachments
  (id, company_id, owner_type, owner_id, conversation_id, storage_path, file_name, content_type)
values ('d1000000-0000-4000-8000-0000000000a2', 'd1000000-0000-4000-8000-000000000002',
        'task_comment', 'd1000000-0000-4000-8000-0000000000a1',
        'd1000000-0000-4000-8000-000000000030',
        'd1000000-0000-4000-8000-000000000002/task_comment/dt-parking.jpg',
        'parking.jpg', 'image/jpeg');

-- The meter: one usage row on the outbound message.
insert into public.usage_events (id, company_id, message_id, type, quantity, meter_identifier)
values ('d1000000-0000-4000-8000-000000000060', 'd1000000-0000-4000-8000-000000000002',
        'd1000000-0000-4000-8000-000000000041', 'sms_outbound', 2, 'dt-meter-1');

-- A summary of the thread, made from the words.
insert into public.conversation_summaries
  (conversation_id, company_id, last_message_id, lines, model)
values ('d1000000-0000-4000-8000-000000000030', 'd1000000-0000-4000-8000-000000000002',
        'd1000000-0000-4000-8000-000000000041', '[{"text":"gate code zebra99"}]', 'dt-model');

-- Consent evidence: the opt-out row (keyed on the phone) and its timeline event.
insert into public.opt_outs (id, company_id, phone_e164, source)
values ('d1000000-0000-4000-8000-000000000070', 'd1000000-0000-4000-8000-000000000002',
        '+12125550120', 'stop_keyword');
insert into public.conversation_events (id, company_id, conversation_id, type, payload)
values ('d1000000-0000-4000-8000-000000000071', 'd1000000-0000-4000-8000-000000000002',
        'd1000000-0000-4000-8000-000000000030', 'opted_out', '{"keyword":"STOP"}'),
       ('d1000000-0000-4000-8000-000000000072', 'd1000000-0000-4000-8000-000000000002',
        'd1000000-0000-4000-8000-000000000030', 'status_changed', '{"to":"open"}'),
       ('d1000000-0000-4000-8000-000000000073', 'd1000000-0000-4000-8000-000000000002',
        'd1000000-0000-4000-8000-000000000030', 'call_completed',
        '{"kind":"voicemail","call_session_id":"dt-sess-vm","transcript":"call me back"}');

-- A call with a voicemail, threaded into the conversation, and its meter row.
insert into public.calls
  (id, company_id, phone_number_id, call_session_id, caller_e164, contact_id,
   conversation_id, outcome, voicemail_path, voicemail_seconds,
   voicemail_transcript, voicemail_intake)
values ('d1000000-0000-4000-8000-000000000080', 'd1000000-0000-4000-8000-000000000002',
        'd1000000-0000-4000-8000-000000000010', 'dt-sess-vm', '+12125550120',
        'd1000000-0000-4000-8000-000000000020',
        'd1000000-0000-4000-8000-000000000030', 'voicemail',
        'd1000000-0000-4000-8000-000000000002/dt-sess-vm.mp3', 21,
        'call me back about the boiler', '{"problem":"boiler"}'),
       -- A second call, not in any conversation, no voicemail.
       ('d1000000-0000-4000-8000-000000000081', 'd1000000-0000-4000-8000-000000000002',
        'd1000000-0000-4000-8000-000000000010', 'dt-sess-2', '+12125550122',
        null, null, 'answered', null, null, null, null);
insert into public.call_records
  (id, company_id, call_session_id, call_leg_id, leg, caller_e164, billable_seconds)
values ('d1000000-0000-4000-8000-000000000082', 'd1000000-0000-4000-8000-000000000002',
        'dt-sess-vm', 'dt-leg-1', 'inbound', '+12125550120', 21);

-- Snapshot of everything that is billing or consent, taken before anything moves.
create temp table dt_before as
select 'usage' as k, to_jsonb(u.*)::text as v from public.usage_events u
 where u.company_id = 'd1000000-0000-4000-8000-000000000002'
union all
select 'call_records', to_jsonb(r.*)::text from public.call_records r
 where r.company_id = 'd1000000-0000-4000-8000-000000000002'
union all
select 'opt_outs', to_jsonb(o.*)::text from public.opt_outs o
 where o.company_id = 'd1000000-0000-4000-8000-000000000002';

-- ===========================================================================
-- DT-1. A trashed row is invisible, and restore brings it back whole.
-- ===========================================================================
do $$
declare
  co    uuid := 'd1000000-0000-4000-8000-000000000002';
  us    uuid := 'd1000000-0000-4000-8000-000000000001';
  conv  uuid := 'd1000000-0000-4000-8000-000000000030';
  r     jsonb;
  last_body text;
begin
  -- Message: the inbox preview moves to the newest message that is NOT trashed.
  r := public.api_trash_message(co, us, 'd1000000-0000-4000-8000-000000000042');
  if r ->> 'outcome' is distinct from 'trashed' then
    raise exception 'DT-1 FAILED: message not trashed: %', r;
  end if;
  select l -> 'last_message' ->> 'id' into last_body
    from public.api_list_conversations(co, us, 10) l
   where (l ->> 'id')::uuid = conv;
  if last_body is distinct from 'd1000000-0000-4000-8000-000000000041' then
    raise exception 'DT-1 FAILED: the trashed note is still the inbox preview (%)', last_body;
  end if;
  -- Search no longer finds it.
  if (public.api_search_v2(co, 'owes', 10, 10, 10, 10, 10) -> 'conversations') is distinct from '[]'::jsonb then
    raise exception 'DT-1 FAILED: search still finds a trashed message';
  end if;
  -- Trashing twice is a not_found, not a second audit-able event.
  if public.api_trash_message(co, us, 'd1000000-0000-4000-8000-000000000042') ->> 'outcome'
       is distinct from 'not_found' then
    raise exception 'DT-1 FAILED: a trashed message was trashed again';
  end if;
  r := public.api_restore_trash(co, us, 'message', 'd1000000-0000-4000-8000-000000000042');
  if r ->> 'outcome' is distinct from 'restored' then
    raise exception 'DT-1 FAILED: message not restored: %', r;
  end if;
  if (public.api_search_v2(co, 'owes', 10, 10, 10, 10, 10) -> 'conversations') = '[]'::jsonb then
    raise exception 'DT-1 FAILED: a restored message is not searchable again';
  end if;

  -- Voicemail alone: the call stays in the log, the words and audio leave.
  r := public.api_trash_call(co, us, 'd1000000-0000-4000-8000-000000000080', true);
  if r ->> 'outcome' is distinct from 'trashed' then
    raise exception 'DT-1 FAILED: voicemail not trashed: %', r;
  end if;
  if not exists (select 1 from public.api_list_calls(co, 10) c
                  where c ->> 'id' = 'd1000000-0000-4000-8000-000000000080'
                    and c -> 'voicemail_transcript' = 'null'::jsonb) then
    raise exception 'DT-1 FAILED: the call log still shows a trashed voicemail transcript';
  end if;
  if (public.api_search_v2(co, 'boiler', 10, 10, 10, 10, 10, null, null, null, 10)
        -> 'voicemails') is distinct from '[]'::jsonb then
    raise exception 'DT-1 FAILED: search still finds a trashed voicemail';
  end if;
  r := public.api_restore_trash(co, us, 'voicemail', 'd1000000-0000-4000-8000-000000000080');
  if r ->> 'outcome' is distinct from 'restored' then
    raise exception 'DT-1 FAILED: voicemail not restored: %', r;
  end if;

  -- Whole call.
  r := public.api_trash_call(co, us, 'd1000000-0000-4000-8000-000000000081', false);
  if exists (select 1 from public.api_list_calls(co, 10) c
              where c ->> 'id' = 'd1000000-0000-4000-8000-000000000081') then
    raise exception 'DT-1 FAILED: a trashed call is still in the call log';
  end if;
  perform public.api_restore_trash(co, us, 'call', 'd1000000-0000-4000-8000-000000000081');
  if not exists (select 1 from public.api_list_calls(co, 10) c
                  where c ->> 'id' = 'd1000000-0000-4000-8000-000000000081') then
    raise exception 'DT-1 FAILED: a restored call is not back in the log';
  end if;

  -- Conversation: gone from the inbox, the contact timeline and search; its call
  -- goes with it; both come back on restore.
  r := public.api_trash_conversations(co, us, array[conv]);
  if (r -> 'trashed') is distinct from to_jsonb(array[conv]) then
    raise exception 'DT-1 FAILED: conversation not trashed: %', r;
  end if;
  if exists (select 1 from public.api_list_conversations(co, us, 10) l
              where (l ->> 'id')::uuid = conv) then
    raise exception 'DT-1 FAILED: a trashed conversation is still in the inbox';
  end if;
  if exists (select 1 from public.api_list_conversations(co, us, 10, 'closed') l
              where (l ->> 'id')::uuid = conv) then
    raise exception 'DT-1 FAILED: a trashed conversation shows under Closed';
  end if;
  if exists (select 1 from public.api_contact_timeline(co, 'd1000000-0000-4000-8000-000000000020') t
              where t ->> 'kind' = 'conversation') then
    raise exception 'DT-1 FAILED: a trashed conversation is on the contact timeline';
  end if;
  if (public.api_search_v2(co, 'zebra99', 10, 10, 10, 10, 10) -> 'conversations') is distinct from '[]'::jsonb then
    raise exception 'DT-1 FAILED: search finds a trashed conversation';
  end if;
  if not exists (select 1 from public.calls
                  where id = 'd1000000-0000-4000-8000-000000000080' and deleted_at is not null) then
    raise exception 'DT-1 FAILED: the conversation''s call was not trashed with it';
  end if;
  if (select status from public.conversations where id = conv) is distinct from 'closed' then
    raise exception 'DT-1 FAILED: a trashed conversation is not stored closed';
  end if;
  -- The trash lists the conversation once, and not its call separately.
  if (select count(*) from public.api_list_trash(co, 50) t) is distinct from 1 then
    raise exception 'DT-1 FAILED: the trash should list the conversation alone, got %',
      (select jsonb_agg(t) from public.api_list_trash(co, 50) t);
  end if;
  r := public.api_restore_trash(co, us, 'conversation', conv);
  if r ->> 'outcome' is distinct from 'restored' or r ->> 'status' is distinct from 'open' then
    raise exception 'DT-1 FAILED: conversation not restored to its status: %', r;
  end if;
  if not exists (select 1 from public.api_list_conversations(co, us, 10) l
                  where (l ->> 'id')::uuid = conv) then
    raise exception 'DT-1 FAILED: a restored conversation is not in the inbox';
  end if;
  if (select deleted_at from public.calls where id = 'd1000000-0000-4000-8000-000000000080') is not null then
    raise exception 'DT-1 FAILED: the conversation''s call was not restored with it';
  end if;

  raise notice 'DT-1 PASSED: trashed rows are invisible to list, search, call log and timeline; restore returns them';
end $$;

-- ===========================================================================
-- DT-2 + DT-3. A new text after a thread was trashed starts a NEW thread; and a
--              restore that would make two open threads comes back closed.
-- ===========================================================================
do $$
declare
  co    uuid := 'd1000000-0000-4000-8000-000000000002';
  us    uuid := 'd1000000-0000-4000-8000-000000000001';
  num   uuid := 'd1000000-0000-4000-8000-000000000010';
  conv  uuid := 'd1000000-0000-4000-8000-000000000030';
  res   jsonb;
  newc  uuid;
begin
  perform public.api_trash_conversations(co, us, array[conv]);

  res := public.thread_inbound_message(co, num, '+12125550120', 'hello again', 'dt-telnyx-1');
  newc := (res ->> 'conversation_id')::uuid;
  if newc = conv then
    raise exception 'DT-2 FAILED: an inbound text landed in the trashed conversation';
  end if;
  if (select count(*) from public.messages where conversation_id = conv and body = 'hello again') is distinct from 0 then
    raise exception 'DT-2 FAILED: the new text was appended to the trashed thread';
  end if;
  if (select closed_at from public.conversations where id = newc) is not null then
    raise exception 'DT-2 FAILED: the new thread should be open';
  end if;

  -- DT-3: the trashed one was open, a newer open thread now holds its place.
  res := public.api_restore_trash(co, us, 'conversation', conv);
  if res ->> 'outcome' is distinct from 'restored' or res ->> 'status' is distinct from 'closed' then
    raise exception 'DT-3 FAILED: restoring beside a newer open thread should come back closed: %', res;
  end if;
  if (select count(*) from public.conversations
       where company_id = co and phone_number_id = num
         and contact_id = 'd1000000-0000-4000-8000-000000000020' and closed_at is null) is distinct from 1 then
    raise exception 'DT-3 FAILED: restore broke the one-open-thread rule';
  end if;

  -- Put the fixture back for the rest of the suite.
  delete from public.messages where conversation_id = newc;
  delete from public.conversation_events where conversation_id = newc;
  delete from public.conversations where id = newc;
  update public.conversations set status = 'open', closed_at = null where id = conv;
  raise notice 'DT-2/DT-3 PASSED: a trashed thread is never reopened; restore keeps one open thread';
end $$;

-- ===========================================================================
-- DT-3b. A trashed conversation's jobs leave every task view with it, and come
--        back with it; a job the crew deleted on its own does not.
-- ===========================================================================
do $$
declare
  co   uuid := 'd1000000-0000-4000-8000-000000000002';
  us   uuid := 'd1000000-0000-4000-8000-000000000001';
  conv uuid := 'd1000000-0000-4000-8000-000000000030';
  task uuid := 'd1000000-0000-4000-8000-0000000000a0';
begin
  perform public.api_trash_conversations(co, us, array[conv]);
  if (select deleted_at from public.tasks where id = task) is null then
    raise exception 'DT-3b FAILED: the trashed conversation''s task is still live';
  end if;
  if (public.api_search_v2(co, 'boiler valve', 10, 10, 10, 10, 10) -> 'tasks') is distinct from '[]'::jsonb then
    raise exception 'DT-3b FAILED: search finds a task from a trashed conversation';
  end if;
  if exists (select 1 from public.api_contact_timeline(co, 'd1000000-0000-4000-8000-000000000020') t
              where t ->> 'kind' = 'task') then
    raise exception 'DT-3b FAILED: the contact timeline shows a task from a trashed conversation';
  end if;

  perform public.api_restore_trash(co, us, 'conversation', conv);
  if (select deleted_at from public.tasks where id = task) is not null then
    raise exception 'DT-3b FAILED: restore did not bring the task back';
  end if;
  if exists (select 1 from public.task_events where task_id = task and kind = 'deleted') then
    raise exception 'DT-3b FAILED: a restored task keeps a "deleted" history line';
  end if;
  if (public.api_search_v2(co, 'boiler valve', 10, 10, 10, 10, 10) -> 'tasks') = '[]'::jsonb then
    raise exception 'DT-3b FAILED: a restored task is not searchable';
  end if;

  -- A job deleted by the crew before the thread went to the Trash stays deleted.
  update public.tasks set deleted_at = now() - interval '1 day' where id = task;
  perform public.api_trash_conversations(co, us, array[conv]);
  perform public.api_restore_trash(co, us, 'conversation', conv);
  if (select deleted_at from public.tasks where id = task) is null then
    raise exception 'DT-3b FAILED: restoring a thread revived a job the crew had deleted';
  end if;
  update public.tasks set deleted_at = null where id = task;
  delete from public.task_events where task_id = task and kind = 'deleted';
  raise notice 'DT-3b PASSED: the thread''s jobs follow it into the Trash and back';
end $$;

-- ===========================================================================
-- DT-4. Tenant isolation and the #106 deny list.
-- ===========================================================================
do $$
declare
  co     uuid := 'd1000000-0000-4000-8000-000000000002';
  other  uuid := 'd1000000-0000-4000-8000-00000000000b';
  us     uuid := 'd1000000-0000-4000-8000-000000000001';
  hidden uuid := 'd1000000-0000-4000-8000-000000000011';
  hconv  uuid := 'd1000000-0000-4000-8000-000000000031';
begin
  if public.api_trash_message(other, us, 'd1000000-0000-4000-8000-000000000041') ->> 'outcome'
       is distinct from 'not_found' then
    raise exception 'DT-4 FAILED: another workspace trashed this workspace''s message';
  end if;
  if public.api_trash_conversations(other, us, array['d1000000-0000-4000-8000-000000000030'::uuid])
       -> 'trashed' is distinct from '[]'::jsonb then
    raise exception 'DT-4 FAILED: another workspace trashed this workspace''s conversation';
  end if;
  if public.api_trash_call(other, us, 'd1000000-0000-4000-8000-000000000081') ->> 'outcome'
       is distinct from 'not_found' then
    raise exception 'DT-4 FAILED: another workspace trashed this workspace''s call';
  end if;

  -- The deny list, on message, conversation (by name) and the trash itself.
  if public.api_trash_message(co, us, 'd1000000-0000-4000-8000-000000000043', array[hidden]) ->> 'outcome'
       is distinct from 'not_found' then
    raise exception 'DT-4 FAILED: a message on a denied number was trashed';
  end if;
  if public.api_trash_conversations(co, us, array[hconv], array[hidden]) -> 'trashed' is distinct from '[]'::jsonb then
    raise exception 'DT-4 FAILED: a conversation on a denied number was trashed';
  end if;
  if (select deleted_at from public.conversations where id = hconv) is not null then
    raise exception 'DT-4 FAILED: the denied conversation was modified';
  end if;
  -- Trash it as an unrestricted actor, then confirm the list and restore honour the list.
  perform public.api_trash_conversations(co, us, array[hconv]);
  if exists (select 1 from public.api_list_trash(co, 50, null, null, array[hidden]) t
              where t ->> 'id' = hconv::text) then
    raise exception 'DT-4 FAILED: the trash listed an item on a denied number';
  end if;
  if public.api_restore_trash(co, us, 'conversation', hconv, array[hidden]) ->> 'outcome'
       is distinct from 'not_found' then
    raise exception 'DT-4 FAILED: a denied number''s item was restored';
  end if;
  if exists (select 1 from public.api_trash_object_paths('conversation', hconv, co, array[hidden])) then
    raise exception 'DT-4 FAILED: object paths were returned for a denied number';
  end if;
  if public.api_purge_trash_item('conversation', hconv, us, co, array[hidden]) ->> 'outcome'
       is distinct from 'not_found' then
    raise exception 'DT-4 FAILED: a denied number''s item was purged';
  end if;
  if public.api_purge_trash_item('conversation', hconv, us, other, null) ->> 'outcome'
       is distinct from 'not_found' then
    raise exception 'DT-4 FAILED: another workspace purged this workspace''s item';
  end if;
  perform public.api_restore_trash(co, us, 'conversation', hconv);
  raise notice 'DT-4 PASSED: isolation and the deny list hold on trash, restore, list and purge';
end $$;

-- ===========================================================================
-- DT-5 + DT-6 + DT-7. Purge: content gone, billing and consent untouched.
-- ===========================================================================
do $$
declare
  co    uuid := 'd1000000-0000-4000-8000-000000000002';
  us    uuid := 'd1000000-0000-4000-8000-000000000001';
  conv  uuid := 'd1000000-0000-4000-8000-000000000030';
  customer uuid := 'd1000000-0000-4000-8000-000000000020';
  paths text[];
  res   jsonb;
begin
  insert into public.scheduled_messages (
    company_id, conversation_id, body, send_at, clock_timezone, clock_source, expires_at, created_by
  ) values (co, conv, 'Text with a private address', now() + interval '1 day',
    'America/Edmonton', 'contact', now() + interval '2 days', us);
  insert into public.conversation_snoozes (company_id, conversation_id, user_id, until, note)
  values (co, conv, us, now() + interval '1 day', 'Call to verify the private address');
  insert into public.quotes (company_id, conversation_id, contact_id, amount_cents, currency,
    description, status, expires_at)
  values (co, conv, customer, 20000, 'cad', 'Quote for the private address', 'accepted', now());
  insert into public.payment_requests (company_id, conversation_id, contact_id, amount_cents,
    currency, description, stripe_account_id, status, amount_received_cents, expires_at)
  values (co, conv, customer, 15000, 'cad',
    'Payment for the private address', 'acct_test', 'paid', 15000, now());

  perform public.api_trash_conversations(co, us, array[conv]);

  -- Everything that lives in a bucket is named BEFORE the rows go.
  select array_agg(bucket || ':' || path order by bucket, path) into paths
    from public.api_trash_object_paths('conversation', conv);
  if paths is distinct from array[
       'attachments:d1000000-0000-4000-8000-000000000002/task_comment/dt-parking.jpg',
       'mms-media:d1000000-0000-4000-8000-000000000002/d1000000-0000-4000-8000-000000000040/0',
       'voicemails:d1000000-0000-4000-8000-000000000002/dt-sess-vm.mp3'] then
    raise exception 'DT-5 FAILED: object paths wrong: %', paths;
  end if;

  res := public.api_purge_trash_item('conversation', conv, us);
  if res ->> 'outcome' is distinct from 'purged' then
    raise exception 'DT-5 FAILED: purge refused: %', res;
  end if;

  -- DT-5: no media, recording, transcript or summary row survives.
  if exists (select 1 from public.message_attachments
              where message_id in ('d1000000-0000-4000-8000-000000000040')) then
    raise exception 'DT-5 FAILED: an MMS attachment row survived purge';
  end if;
  if exists (select 1 from public.messages
              where conversation_id = conv and (body <> '' or purged_at is null)) then
    raise exception 'DT-5 FAILED: a message body survived purge';
  end if;
  if not exists (
    select 1 from public.scheduled_messages where conversation_id = conv and body = '' and status = 'canceled'
  ) or exists (
    select 1 from public.conversation_snoozes where conversation_id = conv
  ) then
    raise exception 'DT-5 FAILED: scheduled text or snooze content survived purge';
  end if;
  if not exists (
    select 1 from public.quotes where conversation_id = conv and description = 'Removed'
      and status = 'accepted' and amount_cents = 20000 and currency = 'cad'
  ) or not exists (
    select 1 from public.payment_requests where conversation_id = conv and description = 'Removed'
      and status = 'paid' and amount_cents = 15000 and amount_received_cents = 15000 and currency = 'cad'
  ) then
    raise exception 'DT-5 FAILED: financial descriptions survived or payment facts changed';
  end if;
  if exists (select 1 from public.calls
              where id = 'd1000000-0000-4000-8000-000000000080'
                and (voicemail_path is not null or voicemail_transcript is not null
                     or voicemail_intake is not null or voicemail_seconds is not null
                     or caller_e164 is not null or purged_at is null)) then
    raise exception 'DT-5 FAILED: a recording pointer, transcript or intake survived purge';
  end if;
  if exists (select 1 from public.conversation_summaries where conversation_id = conv) then
    raise exception 'DT-5 FAILED: an AI summary survived purge';
  end if;
  if exists (select 1 from public.conversation_events
              where conversation_id = conv and type::text in ('status_changed', 'call_completed')) then
    raise exception 'DT-5 FAILED: timeline events carrying content survived purge';
  end if;
  if exists (select 1 from public.conversations where id = conv and purged_at is null) then
    raise exception 'DT-5 FAILED: the conversation was not marked purged';
  end if;
  if exists (select 1 from public.api_trash_object_paths('conversation', conv)) then
    raise exception 'DT-5 FAILED: object paths remain after purge';
  end if;
  -- A purged item is gone from the trash; purging it again finds nothing.
  if (select count(*) from public.api_list_trash(co, 50) t where t ->> 'id' = conv::text) is distinct from 0 then
    raise exception 'DT-5 FAILED: a purged conversation is still listed in the trash';
  end if;
  if public.api_purge_trash_item('conversation', conv, us) ->> 'outcome' is distinct from 'not_found' then
    raise exception 'DT-5 FAILED: a purged item purged twice';
  end if;
  -- Live data is not purgeable: only what is in the Trash.
  if public.api_purge_trash_item('message', 'd1000000-0000-4000-8000-000000000043', us) ->> 'outcome'
       is distinct from 'not_found' then
    raise exception 'DT-5 FAILED: a live message was purged';
  end if;

  -- Task-derived content: the comment, its file, and the words in the history.
  if exists (select 1 from public.task_comments
              where task_id = 'd1000000-0000-4000-8000-0000000000a0') then
    raise exception 'DT-5 FAILED: a task comment body survived purge';
  end if;
  if exists (select 1 from public.attachments
              where id = 'd1000000-0000-4000-8000-0000000000a2'
                 or owner_type = 'task_comment' and conversation_id = conv) then
    raise exception 'DT-5 FAILED: a comment file row survived purge';
  end if;
  if exists (select 1 from public.tasks
              where id = 'd1000000-0000-4000-8000-0000000000a0'
                and (title <> 'Removed' or description <> '')) then
    raise exception 'DT-5 FAILED: task title or description text survived purge';
  end if;
  if exists (select 1 from public.tasks
              where id = 'd1000000-0000-4000-8000-0000000000a0'
                and (addr_street is not null or addr_unit is not null
                     or addr_city is not null or addr_state is not null
                     or addr_postal_code is not null or addr_country is not null
                     or addr_provenance is not null or lat is not null
                     or lng is not null or geocoded_at is not null
                     or geocode_status is distinct from 'no_address')) then
    raise exception 'DT-5 FAILED: a purged task kept its address or map position';
  end if;
  if exists (select 1 from public.task_events
              where task_id = 'd1000000-0000-4000-8000-0000000000a0'
                and (from_value is not null or to_value is not null)
                and kind in ('created', 'title', 'description', 'address')) then
    raise exception 'DT-5 FAILED: title or description text survived in the task history';
  end if;
  if not exists (select 1 from public.task_events
                  where task_id = 'd1000000-0000-4000-8000-0000000000a0' and kind = 'created') then
    raise exception 'DT-5 FAILED: the task history rows themselves were erased';
  end if;
  if exists (select 1 from public.task_events
              where task_id = 'd1000000-0000-4000-8000-0000000000a0'
                and (coalesce(from_value::text, '') || coalesce(to_value::text, ''))
                    ~* '(boiler|zebra|valve|maple|springfield|90210)') then
    raise exception 'DT-5 FAILED: a task event still carries text';
  end if;

  -- DT-6: the meter is byte-for-byte what it was.
  if exists (
    select 1 from (
      select 'usage' as k, to_jsonb(u.*)::text as v from public.usage_events u
       where u.company_id = co
      union all
      select 'call_records', to_jsonb(r.*)::text from public.call_records r where r.company_id = co
      union all
      select 'opt_outs', to_jsonb(o.*)::text from public.opt_outs o where o.company_id = co
    ) aft
    full join dt_before b on b.k = aft.k and b.v = aft.v
    where b.v is null or aft.v is null) then
    raise exception 'DT-6/7 FAILED: a usage, call-record or opt-out row changed or went missing';
  end if;
  -- The tombstone still counts as the segments it carried.
  if (select segments from public.messages where id = 'd1000000-0000-4000-8000-000000000041') is distinct from 2 then
    raise exception 'DT-6 FAILED: the outbound message lost its segment count';
  end if;
  if (select message_id from public.usage_events where id = 'd1000000-0000-4000-8000-000000000060')
       is distinct from 'd1000000-0000-4000-8000-000000000041' then
    raise exception 'DT-6 FAILED: the usage row lost its message pointer';
  end if;

  -- DT-7: the STOP and its time survive in the timeline as well as in opt_outs.
  if not exists (select 1 from public.conversation_events
                  where id = 'd1000000-0000-4000-8000-000000000071' and type::text = 'opted_out') then
    raise exception 'DT-7 FAILED: the opt-out timeline event was erased';
  end if;
  if not exists (select 1 from public.opt_outs
                  where company_id = co and phone_e164 = '+12125550120' and revoked_at is null) then
    raise exception 'DT-7 FAILED: the opt-out is no longer in force after the thread was purged';
  end if;

  raise notice 'DT-5/6/7 PASSED: content erased; usage, call records and opt-outs identical; STOP evidence kept';
end $$;

-- ===========================================================================
-- DT-7b. The same, for the CONTACT: soft-deleting the contact leaves the opt-out
--        in force, because it is keyed on the number.
-- ===========================================================================
do $$
declare
  co uuid := 'd1000000-0000-4000-8000-000000000002';
begin
  update public.contacts set deleted_at = now()
   where id = 'd1000000-0000-4000-8000-000000000020';
  if not exists (select 1 from public.opt_outs
                  where company_id = co and phone_e164 = '+12125550120' and revoked_at is null) then
    raise exception 'DT-7b FAILED: deleting the contact lifted the opt-out';
  end if;
  raise notice 'DT-7b PASSED: the opt-out outlives the contact';
end $$;

-- ===========================================================================
-- DT-8. A legal hold stops erasure, not deletion.
-- ===========================================================================
do $$
declare
  co uuid := 'd1000000-0000-4000-8000-000000000002';
  us uuid := 'd1000000-0000-4000-8000-000000000001';
  msg uuid := 'd1000000-0000-4000-8000-000000000043';
begin
  update public.companies set legal_hold_at = now(), legal_hold_reason = 'dt'
   where id = co;
  if public.api_trash_message(co, us, msg) ->> 'outcome' is distinct from 'trashed' then
    raise exception 'DT-8 FAILED: a legal hold stopped a delete (it should only stop the erasure)';
  end if;
  update public.messages set deleted_at = now() - interval '40 days' where id = msg;
  if exists (select 1 from public.api_trash_due(100) where id = msg) then
    raise exception 'DT-8 FAILED: a workspace on legal hold has items due for purge';
  end if;
  if exists (select 1 from public.api_trash_object_paths('message', msg)) then
    raise exception 'DT-8 FAILED: object paths were offered under a legal hold';
  end if;
  if public.api_purge_trash_item('message', msg, us) ->> 'outcome' is distinct from 'legal_hold' then
    raise exception 'DT-8 FAILED: a legal hold did not stop the erasure';
  end if;
  if (select purged_at from public.messages where id = msg) is not null then
    raise exception 'DT-8 FAILED: content was erased under a legal hold';
  end if;
  update public.companies set legal_hold_at = null, legal_hold_reason = null where id = co;
  raise notice 'DT-8 PASSED: legal hold stops erasure and nothing else';
end $$;

-- ===========================================================================
-- DT-9. What is due, and the audit row.
-- ===========================================================================
do $$
declare
  co  uuid := 'd1000000-0000-4000-8000-000000000002';
  us  uuid := 'd1000000-0000-4000-8000-000000000001';
  msg uuid := 'd1000000-0000-4000-8000-000000000043';
  vm  uuid := 'd1000000-0000-4000-8000-000000000081';
  a   record;
begin
  -- msg is 40 days old in the trash: due. A fresh one is not.
  if not exists (select 1 from public.api_trash_due(100) where id = msg and kind = 'message') then
    raise exception 'DT-9 FAILED: a 40-day-old trashed message is not due';
  end if;
  perform public.api_trash_call(co, us, vm, false);
  if exists (select 1 from public.api_trash_due(100) where id = vm) then
    raise exception 'DT-9 FAILED: an item deleted a moment ago is due';
  end if;
  update public.calls set deleted_at = now() - interval '29 days 23 hours' where id = vm;
  if exists (select 1 from public.api_trash_due(100) where id = vm) then
    raise exception 'DT-9 FAILED: an item inside the 30 days is due';
  end if;
  update public.calls set deleted_at = now() - interval '30 days 1 hour' where id = vm;
  if not exists (select 1 from public.api_trash_due(100) where id = vm and kind = 'call') then
    raise exception 'DT-9 FAILED: an item past the 30 days is not due';
  end if;

  -- The cron purge (no actor) leaves a content-free audit row.
  perform public.api_purge_trash_item('message', msg, null);
  select * into a from public.audit_log
   where company_id = co and action = 'record.purged' and target_id = msg::text;
  if not found then
    raise exception 'DT-9 FAILED: purge wrote no audit row';
  end if;
  if a.actor_user_id is not null or a.after ->> 'by' is distinct from 'trash_expiry' then
    raise exception 'DT-9 FAILED: the expiry purge audit row is wrong: %', to_jsonb(a);
  end if;
  if a.after::text ~* '(private|zebra|boiler|gate code)' or a.before::text ~* '(private|zebra)' then
    raise exception 'DT-9 FAILED: the audit row carries content';
  end if;

  -- A person's "Delete forever" is attributed to them.
  perform public.api_purge_trash_item('call', vm, us);
  if not exists (select 1 from public.audit_log
                  where company_id = co and action = 'record.purged'
                    and target_id = vm::text and actor_user_id = us
                    and after ->> 'by' = 'delete_forever') then
    raise exception 'DT-9 FAILED: delete-forever is not attributed to the person who did it';
  end if;
  if exists (select 1 from public.calls where id = vm and (caller_e164 is not null or purged_at is null)) then
    raise exception 'DT-9 FAILED: a purged call kept the caller''s number';
  end if;

  raise notice 'DT-9 PASSED: 30-day window enforced; audit rows are attributed and content-free';
end $$;

do $$
declare
  company uuid := 'd1000000-0000-4000-8000-000000000002';
  actor uuid := 'd1000000-0000-4000-8000-000000000001';
  expired_task uuid := gen_random_uuid();
  recent_task uuid := gen_random_uuid();
  active_task uuid := gen_random_uuid();
  expired_comment uuid := gen_random_uuid();
  recent_comment uuid := gen_random_uuid();
  child_comment uuid := gen_random_uuid();
  shared_path text := company || '/shared.jpg';
  preview_path text := company || '/preview.webp';
begin
  insert into public.tasks (id, company_id, created_by_user_id, title, description, addr_street, deleted_at)
  values (expired_task, company, actor, 'Replace lock', 'Gate code 5102', 'Maple Road', now() - interval '31 days'),
         (recent_task, company, actor, 'Fix gate', 'Get replacement', 'Elm Lane', now() - interval '29 days'),
         (active_task, company, actor, 'Review options', '', null, null);
  insert into public.task_comments (id, company_id, task_id, author_user_id, body, deleted_at)
  values (expired_comment, company, active_task, actor, 'Old customer note', now() - interval '31 days'),
         (recent_comment, company, active_task, actor, 'Recent customer note', now() - interval '29 days'),
         (child_comment, company, expired_task, actor, 'Parking instructions', null);
  insert into public.attachments (company_id, owner_type, owner_id, storage_path, file_name, content_type)
  values (company, 'task_comment', child_comment, shared_path, 'shared.jpg', 'image/jpeg'),
         (company, 'task', active_task, shared_path, 'shared.jpg', 'image/jpeg');
  insert into public.attachments (company_id, owner_type, owner_id, storage_path, preview_path, file_name, content_type)
  values (company, 'task', expired_task, company || '/task.jpg', preview_path, 'task.jpg', 'image/jpeg');

  if (select count(*) from public.api_trash_due(200)
       where (kind, id) in (('task', expired_task), ('task_comment', expired_comment))) is distinct from 2
     or exists (select 1 from public.api_trash_due(200) where id in (recent_task, recent_comment, active_task))
  then
    raise exception 'Task expiry selected the wrong records';
  end if;
  if (select array_agg(path order by path) from public.api_trash_object_paths('task', expired_task))
       is distinct from array[preview_path, company || '/task.jpg'] then
    raise exception 'Task expiry missed a file or included a shared file';
  end if;
  if public.api_purge_trash_item('task', expired_task, actor, company) ->> 'outcome' is distinct from 'not_found' then
    raise exception 'Task expiry is available outside cron';
  end if;

  update public.companies set legal_hold_at = now(), legal_hold_reason = 'dt'
   where id = company;
  if exists (select 1 from public.api_trash_due(200) where id in (expired_task, expired_comment))
     or exists (select 1 from public.api_trash_object_paths('task', expired_task))
     or public.api_purge_trash_item('task', expired_task) ->> 'outcome' is distinct from 'legal_hold'
     or public.api_purge_trash_item('task_comment', expired_comment) ->> 'outcome' is distinct from 'legal_hold' then
    raise exception 'Task expiry bypassed legal hold';
  end if;
  update public.companies set legal_hold_at = null, legal_hold_reason = null
   where id = company;

  if public.api_purge_trash_item('task', expired_task) ->> 'outcome' is distinct from 'purged'
     or public.api_purge_trash_item('task_comment', expired_comment) ->> 'outcome' is distinct from 'purged'
     or public.api_purge_trash_item('task', expired_task) ->> 'outcome' is distinct from 'not_found' then
    raise exception 'Task expiry did not erase both records exactly once';
  end if;
  if not exists (
    select 1 from public.tasks
     where id = expired_task and title = 'Removed' and description = '' and addr_street is null
       and deleted_at is not null and purged_at is not null
  ) or exists (
    select 1 from public.task_events where task_id = expired_task
     and (from_value is not null or to_value is not null)
  ) or exists (
    select 1 from public.record_activity where source_type = 'task' and source_id = expired_task
     and payload <> '{}'::jsonb
  ) then
    raise exception 'Task text survived expiry';
  end if;
  if exists (select 1 from public.task_comments where id in (expired_comment, child_comment))
     or exists (select 1 from public.attachments where owner_id in (expired_task, child_comment))
     or not exists (select 1 from public.attachments where owner_id = active_task and storage_path = shared_path)
     or not exists (select 1 from public.tasks where id = recent_task and title = 'Fix gate')
     or not exists (select 1 from public.task_comments where id = recent_comment) then
    raise exception 'Task expiry erased the wrong comments or attachments';
  end if;
  if (select count(*) from public.audit_log where company_id = company
       and target_id in (expired_task::text, expired_comment::text)
       and action = 'record.purged' and before = '{}'::jsonb
       and after = '{"by":"trash_expiry"}'::jsonb) is distinct from 2 then
    raise exception 'Task expiry did not audit both records without their content';
  end if;
end $$;

do $$
declare
  company uuid := 'd1000000-0000-4000-8000-000000000002';
  other_company uuid := 'd1000000-0000-4000-8000-00000000000b';
  actor uuid := 'd1000000-0000-4000-8000-000000000001';
  line uuid := 'd1000000-0000-4000-8000-000000000010';
  customer uuid := gen_random_uuid();
  other_customer uuid := gen_random_uuid();
  merged_customer uuid := gen_random_uuid();
  thread uuid := gen_random_uuid();
  message uuid := gen_random_uuid();
  call uuid := gen_random_uuid();
  task uuid := gen_random_uuid();
  endpoint uuid := gen_random_uuid();
  number text := '+12125550170';
  alternate text := '+12125550171';
  state jsonb;
  target record;
begin
  insert into public.contacts (id, company_id, phone_e164, name, email, notes, consent_source, consent_at)
  values (customer, company, number, 'Erasure Example', 'delete@test.local', 'Gate code 8803', 'inbound_sms', now()),
         (other_customer, other_company, number, 'Different Workspace', null, null, null, null);
  insert into public.contacts (id, company_id, phone_e164, name, merged_into, merged_at)
  values (merged_customer, company, '+12125550172', 'Erasure Example Alias', customer, now());
  insert into public.contact_phones (company_id, contact_id, phone_e164) values (company, customer, alternate);
  insert into public.opt_outs (company_id, phone_e164, source) values (company, number, 'stop_keyword');
  insert into public.conversations (id, company_id, contact_id, phone_number_id, contact_phone_e164, status)
  values (thread, company, customer, line, alternate, 'open');
  insert into public.messages (id, company_id, conversation_id, direction, body, status, telnyx_message_id)
  values (message, company, thread, 'inbound', 'Gate code 8803', 'received', 'dt-erasure-message');
  insert into public.message_attachments (company_id, message_id, storage_path, content_type, size_bytes)
  values (company, message, 'mms-media/dt-erasure.jpg', 'image/jpeg', 1);
  insert into public.calls (id, company_id, phone_number_id, call_session_id, caller_e164, contact_id,
    outcome, voicemail_path, voicemail_transcript)
  values (call, company, line, 'dt-erasure-call', alternate, customer, 'voicemail', 'dt-erasure.mp3', 'Gate code 8803');
  insert into public.call_records (company_id, call_session_id, call_leg_id, leg, caller_e164, billable_seconds)
  values (company, 'dt-erasure-call', 'dt-erasure-leg', 'inbound', alternate, 35),
         (other_company, 'dt-other-call', 'dt-other-leg', 'inbound', number, 12);
  insert into public.tasks (id, company_id, contact_id, created_by_user_id, title, description)
  values (task, company, customer, actor, 'Erasure Example', 'Gate code 8803');
  insert into public.attachments (company_id, owner_type, owner_id, storage_path, file_name, content_type)
  values (company, 'task', task, company || '/gate.jpg', 'gate.jpg', 'image/jpeg');
  insert into public.contact_consent_events (company_id, contact_id, state, source, evidence, phone_e164)
  values (company, customer, 'implied', 'inbound_sms', '{"text":"Gate code 8803"}', number);
  insert into public.webhook_endpoints (id, company_id, url, secret, events)
  values (endpoint, company, 'https://example.test/webhook', 'dt-erasure-endpoint', array['contact.deleted']);
  insert into public.webhook_deliveries (company_id, endpoint_id, event_type, payload)
  values (company, endpoint, 'contact.created', jsonb_build_object('data', jsonb_build_object('id', customer, 'name', 'Erasure Example')));

  if public.api_contact_erasure(other_company, customer, '{}', actor) ->> 'state' is distinct from 'not_found'
     or public.api_contact_erasure(company, customer, array[line], actor) ->> 'state' is distinct from 'not_found' then
    raise exception 'Erasure preview or start exposed a hidden record';
  end if;
  update public.companies set legal_hold_at = now(), legal_hold_reason = 'dt erasure' where id = company;
  if public.api_contact_erasure(company, customer, '{}', actor) ->> 'state' is distinct from 'legal_hold' then
    raise exception 'Erasure started on a workspace under legal hold';
  end if;
  update public.companies set legal_hold_at = null, legal_hold_reason = null where id = company;

  state := public.api_contact_erasure(company, customer, '{}');
  if state ->> 'state' is distinct from 'ready'
     or state -> 'counts' is distinct from '{"conversations":1,"messages":1,"calls":1,"tasks":1}'::jsonb then
    raise exception 'Erasure preview counts were incorrect: %', state;
  end if;
  state := public.api_contact_erasure(company, customer, '{}', actor);
  if state ->> 'state' is distinct from 'erasing'
     or not exists (select 1 from public.api_customer_erasures_due(10) where id = customer)
     or public.api_restore_trash(company, actor, 'contact', customer) ->> 'outcome' is distinct from 'not_found'
     or public.api_finish_customer_erasure(company, customer) then
    raise exception 'Erasure started without holding the contact until all its records are processed';
  end if;

  begin
    update public.contacts set deleted_at = null where id = customer;
    raise exception 'Contact reopened during erasure';
  exception when lock_not_available then null;
  end;
  begin
    insert into public.messages (company_id, conversation_id, direction, body, status)
    values (company, thread, 'inbound', 'arrived during erasure', 'received');
    raise exception 'Content arrived in an erasing conversation';
  exception when lock_not_available then null;
  end;

  update public.companies set legal_hold_at = now(), legal_hold_reason = 'dt erasure' where id = company;
  if exists (select 1 from public.api_customer_erasures_due(10) where id = customer)
     or exists (select 1 from public.api_customer_erasure_batch(company, customer, 25))
     or exists (select 1 from public.api_trash_object_paths('call', call))
     or public.api_finish_customer_erasure(company, customer) then
    raise exception 'A new hold did not pause the erasure';
  end if;
  update public.companies set legal_hold_at = null, legal_hold_reason = null where id = company;

  if not exists (select 1 from public.api_trash_object_paths('conversation', thread) where path = 'dt-erasure.jpg')
     or not exists (select 1 from public.api_trash_object_paths('call', call) where path = 'dt-erasure.mp3')
     or not exists (select 1 from public.api_trash_object_paths('task', task) where path = company || '/gate.jpg') then
    raise exception 'Erasure omitted MMS, voicemail or task media';
  end if;
  for target in select * from public.api_customer_erasure_batch(company, customer, 25) loop
    if public.api_purge_trash_item(target.kind, target.id) ->> 'outcome' is distinct from 'purged' then
      raise exception 'Unable to purge %: %', target.kind, target.id;
    end if;
  end loop;
  if not public.api_finish_customer_erasure(company, customer) or public.api_finish_customer_erasure(company, customer) then
    raise exception 'The customer erasure should finalize once';
  end if;
  state := public.api_contact_erasure(company, customer, '{}');
  if state ->> 'state' is distinct from 'erased' or state ->> 'date' is null then
    raise exception 'Missing erasure receipt';
  end if;

  if not exists (select 1 from public.contacts where id = customer and phone_e164 = number
    and consent_source = 'inbound_sms' and consent_at is not null and name is null and notes is null and email is null)
     or not exists (select 1 from public.opt_outs where company_id = company and phone_e164 = number)
     or not exists (select 1 from public.contact_consent_events where contact_id = customer and evidence = '{}'::jsonb)
     or not exists (select 1 from public.call_records where company_id = company and call_session_id = 'dt-erasure-call'
                     and caller_e164 is null and billable_seconds = 35)
     or not exists (select 1 from public.contacts where id = other_customer and phone_e164 = number and name = 'Different Workspace')
     or not exists (select 1 from public.call_records where company_id = other_company and caller_e164 = number) then
    raise exception 'Erasure changed the consent floor, billing totals, or another workspace';
  end if;
  if exists (select 1 from public.contact_phones where company_id = company and contact_id = customer)
     or not exists (select 1 from public.contacts where id = merged_customer and name is null and purged_at is not null)
     or exists (select 1 from public.conversations where id = thread and contact_phone_e164 is not null)
     or exists (select 1 from public.messages where id = message and body is distinct from '')
     or exists (select 1 from public.calls where id = call and (caller_e164 is not null or voicemail_transcript is not null))
     or exists (select 1 from public.tasks where id = task and (title is distinct from 'Removed' or description is distinct from ''))
     or exists (select 1 from public.webhook_deliveries where endpoint_id = endpoint and event_type = 'contact.created') then
    raise exception 'Erasure left private content outside the consent and opt-out records';
  end if;
  if (select count(*) from public.audit_log where company_id = company and target_id = customer::text
    and action = 'contact.erased' and before = '{}'::jsonb) is distinct from 1
     or (select count(*) from public.webhook_deliveries where endpoint_id = endpoint and event_type = 'contact.deleted'
     and payload->'data' = jsonb_build_object('id', customer) and payload->>'id' = id::text) is distinct from 1 then
    raise exception 'Erasure did not record one content-free audit and webhook';
  end if;
end $$;

rollback;
