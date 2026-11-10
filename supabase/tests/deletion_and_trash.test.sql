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
  paths text[];
  res   jsonb;
begin
  perform public.api_trash_conversations(co, us, array[conv]);

  -- Everything that lives in a bucket is named BEFORE the rows go.
  select array_agg(bucket || ':' || path order by bucket, path) into paths
    from public.api_trash_object_paths('conversation', conv);
  if paths is distinct from array[
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

rollback;
