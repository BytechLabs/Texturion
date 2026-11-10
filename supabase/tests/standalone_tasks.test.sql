-- [#689 / D64 amended] A task with no source: assertion suite for
-- supabase/migrations/20261110140000_standalone_tasks.sql.
--
-- What is pinned:
--   ST-1  the anchor rule: a task with a message or a call still has a
--         conversation; a standalone one may have none
--   ST-2  create_task: a title is the only requirement; the optional contact and
--         conversation links are validated; a promotion refuses them
--   ST-3  a task with no conversation survives every writer that used to write a
--         conversation event (assign, update, delete, bulk, done)
--   ST-4  ACCESS. A standalone task with no conversation is visible to every
--         active member of its company and to nobody else; one linked to a
--         conversation is gated exactly as that conversation is: a member denied
--         its number does not find it in search, in unclaimed work or on the map,
--         and sees a redacted title in their own queue
--   ST-5  the contact timeline, the calendar access check and appointment
--         reminders understand a task with no conversation
--
-- One transaction, rolled back. Fixtures use an 'a5' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('a5000000-0000-4000-8000-00000000000a'::uuid, 'st-owner@test.local'),
  ('a5000000-0000-4000-8000-00000000000b'::uuid, 'st-member@test.local'),
  ('a5000000-0000-4000-8000-00000000000c'::uuid, 'st-other-owner@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status)
values
  ('a5000000-0000-4000-8000-0000000000c1'::uuid, 'Standalone Co',
   'a5000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(), 'active'),
  ('a5000000-0000-4000-8000-0000000000c2'::uuid, 'Other Co',
   'a5000000-0000-4000-8000-00000000000c'::uuid, 'US', '415', now(), 'active');

insert into public.company_members (company_id, user_id, role) values
  ('a5000000-0000-4000-8000-0000000000c1'::uuid,
   'a5000000-0000-4000-8000-00000000000a'::uuid, 'owner'),
  ('a5000000-0000-4000-8000-0000000000c1'::uuid,
   'a5000000-0000-4000-8000-00000000000b'::uuid, 'member'),
  ('a5000000-0000-4000-8000-0000000000c2'::uuid,
   'a5000000-0000-4000-8000-00000000000c'::uuid, 'owner');

insert into public.phone_numbers
  (id, company_id, provisioning_key, country, number_e164, status,
   requested_area_code)
values
  ('a5000000-0000-4000-8000-0000000000b1'::uuid,
   'a5000000-0000-4000-8000-0000000000c1'::uuid, 'st-1', 'US',
   '+14155550188', 'active', '415'),
  ('a5000000-0000-4000-8000-0000000000b2'::uuid,
   'a5000000-0000-4000-8000-0000000000c2'::uuid, 'st-2', 'US',
   '+14155550189', 'active', '415');

insert into public.contacts (id, company_id, phone_e164, name) values
  ('a5000000-0000-4000-8000-0000000000a1'::uuid,
   'a5000000-0000-4000-8000-0000000000c1'::uuid, '+14155552101', 'Pat Plumber'),
  ('a5000000-0000-4000-8000-0000000000a2'::uuid,
   'a5000000-0000-4000-8000-0000000000c1'::uuid, '+14155552102', 'Quinn Other'),
  ('a5000000-0000-4000-8000-0000000000a3'::uuid,
   'a5000000-0000-4000-8000-0000000000c2'::uuid, '+14155552103', 'Foreign Contact');

-- e1: Pat's thread on b1 (the number the member will be denied). e3: a thread
-- in the other workspace.
insert into public.conversations
  (id, company_id, phone_number_id, contact_id, status, last_message_at)
values
  ('a5000000-0000-4000-8000-0000000000e1'::uuid,
   'a5000000-0000-4000-8000-0000000000c1'::uuid,
   'a5000000-0000-4000-8000-0000000000b1'::uuid,
   'a5000000-0000-4000-8000-0000000000a1'::uuid, 'open', now()),
  ('a5000000-0000-4000-8000-0000000000e3'::uuid,
   'a5000000-0000-4000-8000-0000000000c2'::uuid,
   'a5000000-0000-4000-8000-0000000000b2'::uuid,
   'a5000000-0000-4000-8000-0000000000a3'::uuid, 'open', now());

insert into public.messages
  (id, company_id, conversation_id, direction, status, body, created_at)
values
  ('a5000000-0000-4000-8000-0000000000d1'::uuid,
   'a5000000-0000-4000-8000-0000000000c1'::uuid,
   'a5000000-0000-4000-8000-0000000000e1'::uuid, 'inbound', 'received',
   'Boiler is leaking', now() - interval '1 hour');

-- Restrict b1 to the owner: the member now has level 'none' there.
insert into public.number_access
  (company_id, phone_number_id, principal_kind, principal, level)
values
  ('a5000000-0000-4000-8000-0000000000c1'::uuid,
   'a5000000-0000-4000-8000-0000000000b1'::uuid,
   'user', 'a5000000-0000-4000-8000-00000000000a', 'text');

-- ---------------------------------------------------------------------------
-- ST-1. The anchor rule.
-- ---------------------------------------------------------------------------
do $$
begin
  -- A message task must keep its conversation.
  begin
    insert into public.tasks
      (company_id, message_id, conversation_id, title, created_by_user_id)
    values
      ('a5000000-0000-4000-8000-0000000000c1'::uuid,
       'a5000000-0000-4000-8000-0000000000d1'::uuid, null, 'bad',
       'a5000000-0000-4000-8000-00000000000a'::uuid);
    raise exception 'ST-1 FAILED: a message task lost its conversation';
  exception when check_violation then null;
  end;

  -- A standalone task needs none.
  insert into public.tasks (company_id, title, created_by_user_id)
  values ('a5000000-0000-4000-8000-0000000000c1'::uuid, 'Fixture standalone',
          'a5000000-0000-4000-8000-00000000000a'::uuid);

  -- And may carry its own done state, because no message owns it.
  update public.tasks
     set done_at = now(),
         done_by_user_id = 'a5000000-0000-4000-8000-00000000000a'::uuid
   where title = 'Fixture standalone';

  raise notice 'ST-1 PASSED: only a source-less task may have no conversation';
end $$;

-- ---------------------------------------------------------------------------
-- ST-2. create_task with no source.
-- ---------------------------------------------------------------------------
do $$
declare r jsonb; v jsonb;
begin
  -- A title is required.
  r := public.create_task(
    'a5000000-0000-4000-8000-0000000000c1'::uuid, null, null, null, null, null,
    'a5000000-0000-4000-8000-00000000000a'::uuid);
  if r->>'outcome' is distinct from 'title_required' then
    raise exception 'ST-2 FAILED: no title gave %', r;
  end if;
  r := public.create_task(
    'a5000000-0000-4000-8000-0000000000c1'::uuid, null, '   ', null, null, null,
    'a5000000-0000-4000-8000-00000000000a'::uuid);
  if r->>'outcome' is distinct from 'title_required' then
    raise exception 'ST-2 FAILED: a blank title gave %', r;
  end if;

  -- Title alone: no conversation, no contact, no reminders, no source.
  r := public.create_task(
    'a5000000-0000-4000-8000-0000000000c1'::uuid, null, 'Order a furnace filter',
    null, 'a5000000-0000-4000-8000-00000000000b'::uuid, null,
    'a5000000-0000-4000-8000-00000000000a'::uuid);
  v := r->'task';
  if r->>'outcome' is distinct from 'created'
     or v->>'conversation_id' is not null
     or v->>'contact_id' is not null
     or v->>'message_id' is not null
     or v->>'source_call_id' is not null
     or (v->>'reminders_off')::boolean is distinct from true
     or v->>'title' is distinct from 'Order a furnace filter' then
    raise exception 'ST-2 FAILED: title-only task is wrong: %', r;
  end if;
  -- No thread, so no task_created event (and no failed insert).
  if exists (select 1 from public.conversation_events e
              where e.payload->>'task_id' = v->>'id') then
    raise exception 'ST-2 FAILED: a conversation-less task wrote an event';
  end if;

  -- A contact alone.
  r := public.create_task(
    'a5000000-0000-4000-8000-0000000000c1'::uuid, null, 'Quote Quinn', null,
    null, null, 'a5000000-0000-4000-8000-00000000000a'::uuid,
    null, null, null, null, null, null, null, null,
    'a5000000-0000-4000-8000-0000000000a2'::uuid, null);
  if r->>'outcome' is distinct from 'created'
     or (r->'task'->>'contact_id')::uuid
        is distinct from 'a5000000-0000-4000-8000-0000000000a2'::uuid
     or r->'task'->>'conversation_id' is not null then
    raise exception 'ST-2 FAILED: contact-only task is wrong: %', r;
  end if;

  -- A conversation: the contact follows it, the event lands on its thread.
  r := public.create_task(
    'a5000000-0000-4000-8000-0000000000c1'::uuid, null, 'Call Pat back', null,
    null, null, 'a5000000-0000-4000-8000-00000000000a'::uuid,
    null, null, null, null, null, null, null, null,
    null, 'a5000000-0000-4000-8000-0000000000e1'::uuid);
  v := r->'task';
  if r->>'outcome' is distinct from 'created'
     or (v->>'conversation_id')::uuid
        is distinct from 'a5000000-0000-4000-8000-0000000000e1'::uuid
     or (v->>'contact_id')::uuid
        is distinct from 'a5000000-0000-4000-8000-0000000000a1'::uuid then
    raise exception 'ST-2 FAILED: conversation-linked task is wrong: %', r;
  end if;
  if not exists (
    select 1 from public.conversation_events e
     where e.conversation_id = 'a5000000-0000-4000-8000-0000000000e1'::uuid
       and e.type = 'task_created'
       and e.payload->>'task_id' = v->>'id'
       and not (e.payload ? 'message_id') and not (e.payload ? 'call_id')) then
    raise exception 'ST-2 FAILED: no task_created event on the linked conversation';
  end if;

  -- The contact must be the conversation's.
  r := public.create_task(
    'a5000000-0000-4000-8000-0000000000c1'::uuid, null, 'Mismatch', null,
    null, null, 'a5000000-0000-4000-8000-00000000000a'::uuid,
    null, null, null, null, null, null, null, null,
    'a5000000-0000-4000-8000-0000000000a2'::uuid,
    'a5000000-0000-4000-8000-0000000000e1'::uuid);
  if r->>'outcome' is distinct from 'contact_mismatch' then
    raise exception 'ST-2 FAILED: a foreign contact on a conversation gave %', r;
  end if;

  -- Another workspace's conversation and contact are invisible.
  r := public.create_task(
    'a5000000-0000-4000-8000-0000000000c1'::uuid, null, 'Foreign conv', null,
    null, null, 'a5000000-0000-4000-8000-00000000000a'::uuid,
    null, null, null, null, null, null, null, null,
    null, 'a5000000-0000-4000-8000-0000000000e3'::uuid);
  if r->>'outcome' is distinct from 'no_conversation' then
    raise exception 'ST-2 FAILED: another workspace''s conversation gave %', r;
  end if;
  r := public.create_task(
    'a5000000-0000-4000-8000-0000000000c1'::uuid, null, 'Foreign contact', null,
    null, null, 'a5000000-0000-4000-8000-00000000000a'::uuid,
    null, null, null, null, null, null, null, null,
    'a5000000-0000-4000-8000-0000000000a3'::uuid, null);
  if r->>'outcome' is distinct from 'no_contact' then
    raise exception 'ST-2 FAILED: another workspace''s contact gave %', r;
  end if;

  -- The assignee must be an active member of THIS workspace.
  r := public.create_task(
    'a5000000-0000-4000-8000-0000000000c1'::uuid, null, 'Wrong assignee', null,
    'a5000000-0000-4000-8000-00000000000c'::uuid, null,
    'a5000000-0000-4000-8000-00000000000a'::uuid);
  if r->>'outcome' is distinct from 'not_member' then
    raise exception 'ST-2 FAILED: a foreign assignee gave %', r;
  end if;

  -- A promotion refuses the links, and a message plus a call is still refused.
  r := public.create_task(
    'a5000000-0000-4000-8000-0000000000c1'::uuid,
    'a5000000-0000-4000-8000-0000000000d1'::uuid, null, null, null, null,
    'a5000000-0000-4000-8000-00000000000a'::uuid,
    null, null, null, null, null, null, null, null,
    'a5000000-0000-4000-8000-0000000000a1'::uuid, null);
  if r->>'outcome' is distinct from 'bad_link' then
    raise exception 'ST-2 FAILED: a link on a promotion gave %', r;
  end if;
  r := public.create_task(
    'a5000000-0000-4000-8000-0000000000c1'::uuid,
    'a5000000-0000-4000-8000-0000000000d1'::uuid, null, null, null, null,
    'a5000000-0000-4000-8000-00000000000a'::uuid,
    null, null, null, null, null, null, null,
    'a5000000-0000-4000-8000-0000000000f9'::uuid);
  if r->>'outcome' is distinct from 'no_source' then
    raise exception 'ST-2 FAILED: message plus call gave %', r;
  end if;

  -- The message path is unchanged.
  r := public.create_task(
    'a5000000-0000-4000-8000-0000000000c1'::uuid,
    'a5000000-0000-4000-8000-0000000000d1'::uuid, null, null, null, null,
    'a5000000-0000-4000-8000-00000000000a'::uuid);
  if r->>'outcome' is distinct from 'created'
     or (r->'task'->>'reminders_off')::boolean is distinct from false
     or r->'task'->>'contact_id' is not null then
    raise exception 'ST-2 FAILED: message promotion changed: %', r;
  end if;

  raise notice 'ST-2 PASSED: create_task takes a title alone and validates its links';
end $$;

-- ---------------------------------------------------------------------------
-- ST-3. Every writer survives a task with no conversation.
-- ---------------------------------------------------------------------------
do $$
declare
  v_task uuid;
  v_second uuid;
  r jsonb;
begin
  select id into v_task from public.tasks
   where title = 'Order a furnace filter' and deleted_at is null;
  select id into v_second from public.tasks
   where title = 'Quote Quinn' and deleted_at is null;

  r := public.assign_task(
    'a5000000-0000-4000-8000-0000000000c1'::uuid, v_task,
    'a5000000-0000-4000-8000-00000000000a'::uuid,
    'a5000000-0000-4000-8000-00000000000a'::uuid);
  if r->>'outcome' is distinct from 'updated' then
    raise exception 'ST-3 FAILED: assign_task gave %', r;
  end if;

  r := public.update_task(
    'a5000000-0000-4000-8000-0000000000c1'::uuid, v_task, 'Order two filters',
    null, now() + interval '2 days', false,
    'a5000000-0000-4000-8000-00000000000a'::uuid);
  if r->>'outcome' is distinct from 'updated' then
    raise exception 'ST-3 FAILED: update_task gave %', r;
  end if;

  r := public.set_task_done(
    'a5000000-0000-4000-8000-0000000000c1'::uuid, v_task, true,
    'a5000000-0000-4000-8000-00000000000a'::uuid);
  if r->>'outcome' is distinct from 'updated' then
    raise exception 'ST-3 FAILED: set_task_done gave %', r;
  end if;
  r := public.set_task_done(
    'a5000000-0000-4000-8000-0000000000c1'::uuid, v_task, false,
    'a5000000-0000-4000-8000-00000000000a'::uuid);
  if r->>'outcome' is distinct from 'updated' then
    raise exception 'ST-3 FAILED: reopening gave %', r;
  end if;

  -- Bulk assign and bulk delete.
  r := public.api_bulk_tasks(
    'a5000000-0000-4000-8000-0000000000c1'::uuid,
    'a5000000-0000-4000-8000-00000000000a'::uuid, 'assign',
    array[v_task, v_second], 'a5000000-0000-4000-8000-00000000000b'::uuid, null);
  if jsonb_array_length(r->'applied') is distinct from 2 then
    raise exception 'ST-3 FAILED: bulk assign gave %', r;
  end if;
  r := public.api_bulk_tasks(
    'a5000000-0000-4000-8000-0000000000c1'::uuid,
    'a5000000-0000-4000-8000-00000000000a'::uuid, 'delete',
    array[v_second], null, null);
  if jsonb_array_length(r->'applied') is distinct from 1 then
    raise exception 'ST-3 FAILED: bulk delete gave %', r;
  end if;

  r := public.delete_task(
    'a5000000-0000-4000-8000-0000000000c1'::uuid,
    (select id from public.tasks where title = 'Fixture standalone'),
    'a5000000-0000-4000-8000-00000000000a'::uuid);
  if r->>'outcome' is distinct from 'deleted' then
    raise exception 'ST-3 FAILED: delete_task gave %', r;
  end if;

  -- Not one of those wrote a conversation-less event.
  if exists (select 1 from public.conversation_events
              where conversation_id is null
                and type::text like 'task\_%') then
    raise exception 'ST-3 FAILED: a task event with no conversation was stored';
  end if;

  raise notice 'ST-3 PASSED: assign, update, done, bulk and delete keep a task with no conversation';
end $$;

-- ---------------------------------------------------------------------------
-- ST-4. Access.
-- ---------------------------------------------------------------------------
do $$
declare
  v_open   uuid;
  v_linked uuid;
  v_linked_unassigned uuid;
  v_member uuid := 'a5000000-0000-4000-8000-00000000000b';
  v_owner  uuid := 'a5000000-0000-4000-8000-00000000000a';
  v_c1     uuid := 'a5000000-0000-4000-8000-0000000000c1';
  v_c2     uuid := 'a5000000-0000-4000-8000-0000000000c2';
  v_hidden uuid[] := array['a5000000-0000-4000-8000-0000000000b1']::uuid[];
  v jsonb;
  n int;
begin
  -- v_open: company-wide, assigned to the member. v_linked: linked to the
  -- hidden conversation, assigned to the member. v_linked_unassigned: linked to
  -- it, unassigned. v_open_unassigned: company-wide, unassigned.
  select id into v_open from public.tasks
   where title = 'Order two filters' and deleted_at is null;
  update public.tasks set assigned_user_id = v_member, title = 'Boxed salvage order'
   where id = v_open;

  select id into v_linked from public.tasks
   where title = 'Call Pat back' and deleted_at is null;
  update public.tasks set assigned_user_id = v_member, title = 'Boxed linked callback'
   where id = v_linked;

  v_linked_unassigned := (public.create_task(
    v_c1, null, 'Boxed unclaimed linked', null, null, null, v_owner,
    null, null, null, null, null, null, null, null,
    null, 'a5000000-0000-4000-8000-0000000000e1'::uuid)->'task'->>'id')::uuid;
  perform public.create_task(
    v_c1, null, 'Boxed unclaimed open', null, null, null, v_owner);

  -- ---- For You, as the DENIED member ------------------------------------
  v := public.api_for_you(v_c1, v_member, now(), 20, v_hidden);
  if not exists (select 1 from jsonb_array_elements(v->'my_tasks') i
                  where i->>'task_id' = v_open::text
                    and i->>'title' = 'Boxed salvage order'
                    and i->>'conversation_id' is null) then
    raise exception 'ST-4 FAILED: the member lost the company-wide task from their queue: %', v->'my_tasks';
  end if;
  if not exists (select 1 from jsonb_array_elements(v->'my_tasks') i
                  where i->>'task_id' = v_linked::text
                    and i->>'title' = 'Task on a number you don''t have access to') then
    raise exception 'ST-4 FAILED: a linked task''s title was not redacted for the denied member: %', v->'my_tasks';
  end if;
  if not exists (select 1 from jsonb_array_elements(v->'triage'->'tasks') i
                  where i->>'title' = 'Boxed unclaimed open') then
    raise exception 'ST-4 FAILED: unclaimed company-wide task missing from triage: %', v->'triage';
  end if;
  if exists (select 1 from jsonb_array_elements(v->'triage'->'tasks') i
              where i->>'task_id' = v_linked_unassigned::text) then
    raise exception 'ST-4 FAILED: an unclaimed task on a denied number leaked into triage';
  end if;

  -- ---- For You, as the owner (sees everything) ------------------------------
  v := public.api_for_you(v_c1, v_owner, now(), 20, null);
  if not exists (select 1 from jsonb_array_elements(v->'triage'->'tasks') i
                  where i->>'task_id' = v_linked_unassigned::text)
     or not exists (select 1 from jsonb_array_elements(v->'triage'->'tasks') i
                     where i->>'title' = 'Boxed unclaimed open') then
    raise exception 'ST-4 FAILED: the owner misses unclaimed tasks: %', v->'triage';
  end if;

  -- ---- Another workspace sees none of it ------------------------------
  v := public.api_for_you(v_c2, 'a5000000-0000-4000-8000-00000000000c'::uuid, now(), 20, null);
  if jsonb_array_length(v->'triage'->'tasks') is distinct from 0
     or jsonb_array_length(v->'my_tasks') is distinct from 0 then
    raise exception 'ST-4 FAILED: another workspace sees these tasks: %', v;
  end if;

  -- ---- Search ------------------------------------------------------------
  v := public.api_search_v2(v_c1, 'Boxed', 20, 20, 20, 20, 20, null, null, v_hidden);
  if not exists (select 1 from jsonb_array_elements(v->'tasks') i
                  where i->>'id' = v_open::text)
     or exists (select 1 from jsonb_array_elements(v->'tasks') i
                 where i->>'id' in (v_linked::text, v_linked_unassigned::text)) then
    raise exception 'ST-4 FAILED: search for the denied member is wrong: %', v->'tasks';
  end if;
  v := public.api_search_v2(v_c1, 'Boxed', 20, 20, 20, 20, 20);
  select count(*) into n from jsonb_array_elements(v->'tasks') i
   where i->>'id' in (v_open::text, v_linked::text, v_linked_unassigned::text);
  if n is distinct from 3 then
    raise exception 'ST-4 FAILED: unrestricted search found % of 3 tasks', n;
  end if;
  v := public.api_search_v2(v_c2, 'Boxed', 20, 20, 20, 20, 20);
  if jsonb_array_length(v->'tasks') is distinct from 0 then
    raise exception 'ST-4 FAILED: another workspace found these tasks by search: %', v->'tasks';
  end if;

  -- ---- The map view: rows exist without a conversation; the route''s
  -- "not hidden" filter keeps a null number ---------------------------------
  select count(*) into n from public.task_map_rows
   where company_id = v_c1 and id in (v_open, v_linked)
     and (phone_number_id is null or not (phone_number_id = any(v_hidden)));
  if n is distinct from 1 then
    raise exception 'ST-4 FAILED: the map filter kept % of the two tasks (want only the company-wide one)', n;
  end if;
  if not exists (select 1 from public.task_map_rows
                  where id = v_open and phone_number_id is null
                    and conversation_id is null) then
    raise exception 'ST-4 FAILED: task_map_rows dropped a task with no conversation';
  end if;
  if (select contact_id from public.task_map_rows where id = v_linked)
       is distinct from 'a5000000-0000-4000-8000-0000000000a1'::uuid then
    raise exception 'ST-4 FAILED: the map did not take the linked task''s contact from its conversation';
  end if;

  -- ---- Member holdings count it ---------------------------------------------
  if (public.api_member_holdings(v_c1, v_member)->>'tasks')::int < 2 then
    raise exception 'ST-4 FAILED: member holdings missed a standalone task';
  end if;

  raise notice 'ST-4 PASSED: a company-wide task is the whole company''s; a linked one follows its conversation';
end $$;

-- ---------------------------------------------------------------------------
-- ST-5. Timeline, calendar access, reminders.
-- ---------------------------------------------------------------------------
do $$
declare
  v_owner  uuid := 'a5000000-0000-4000-8000-00000000000a';
  v_member uuid := 'a5000000-0000-4000-8000-00000000000b';
  v_c1     uuid := 'a5000000-0000-4000-8000-0000000000c1';
  v_contact_only uuid;
  v_task uuid;
  r jsonb;
  n int;
begin
  -- The contact timeline lists a task linked only to a contact.
  v_contact_only := (public.create_task(
    v_c1, null, 'Boxed contact only', null, null, null, v_owner,
    null, null, null, null, null, null, null, null,
    'a5000000-0000-4000-8000-0000000000a2'::uuid, null)->'task'->>'id')::uuid;
  if not exists (
    select 1 from public.api_contact_timeline(
      v_c1, 'a5000000-0000-4000-8000-0000000000a2'::uuid) t
     where t->>'kind' = 'task' and t->>'id' = v_contact_only::text
       and (t->>'done')::boolean = false) then
    raise exception 'ST-5 FAILED: the contact timeline lost a contact-only task';
  end if;
  -- ... and the linked-conversation task is listed once, under Pat.
  select count(*) into n from public.api_contact_timeline(
      v_c1, 'a5000000-0000-4000-8000-0000000000a1'::uuid) t
   where t->>'kind' = 'task' and t->>'detail' = 'Boxed linked callback';
  if n is distinct from 1 then
    raise exception 'ST-5 FAILED: the linked task appeared % times on its contact', n;
  end if;
  -- Another workspace's contact has nothing of ours.
  if exists (
    select 1 from public.api_contact_timeline(
      'a5000000-0000-4000-8000-0000000000c2'::uuid,
      'a5000000-0000-4000-8000-0000000000a2'::uuid) t
     where t->>'kind' = 'task') then
    raise exception 'ST-5 FAILED: another workspace read our contact''s tasks';
  end if;

  -- Calendar access: no conversation = any active member; a conversation = its
  -- number's rule; never another workspace's member.
  if not public.calendar_task_access_allowed(v_member, v_c1, null) then
    raise exception 'ST-5 FAILED: a member was denied a task with no conversation';
  end if;
  if public.calendar_task_access_allowed(
       v_member, v_c1, 'a5000000-0000-4000-8000-0000000000e1'::uuid) then
    raise exception 'ST-5 FAILED: a denied member was allowed a linked task';
  end if;
  if not public.calendar_task_access_allowed(
       v_owner, v_c1, 'a5000000-0000-4000-8000-0000000000e1'::uuid) then
    raise exception 'ST-5 FAILED: the owner was denied a linked task';
  end if;
  if public.calendar_task_access_allowed(
       'a5000000-0000-4000-8000-00000000000c'::uuid, v_c1, null) then
    raise exception 'ST-5 FAILED: another workspace''s owner was allowed our task';
  end if;
  update public.company_members set deactivated_at = now()
   where company_id = v_c1 and user_id = v_member;
  if public.calendar_task_access_allowed(v_member, v_c1, null) then
    raise exception 'ST-5 FAILED: a deactivated member was allowed a task';
  end if;

  -- Reminders: a task with no conversation owns none, even with reminders on.
  v_task := v_contact_only;
  update public.tasks set reminders_off = false, due_at = now() + interval '3 days'
   where id = v_task;
  r := public.api_sync_task_reminders(
    v_c1, v_task, v_owner,
    jsonb_build_array(jsonb_build_object(
      'offset_minutes', 1440, 'body', 'See you tomorrow',
      'send_at', (now() + interval '2 days')::text)),
    'America/Toronto', 'company', now() + interval '4 days');
  if (r->>'added')::int is distinct from 0
     or exists (select 1 from public.scheduled_messages where task_id = v_task) then
    raise exception 'ST-5 FAILED: a task with no conversation queued a customer text: %', r;
  end if;

  -- A contact merge carries a standalone task linked to the contact.
  r := public.api_merge_contacts(
    v_c1, 'a5000000-0000-4000-8000-0000000000a2'::uuid,
    'a5000000-0000-4000-8000-0000000000a1'::uuid, v_owner);
  if r->>'outcome' is distinct from 'merged'
     or (select contact_id from public.tasks where id = v_contact_only)
        is distinct from 'a5000000-0000-4000-8000-0000000000a1'::uuid then
    raise exception 'ST-5 FAILED: a merge left the task on the old contact: %', r;
  end if;

  raise notice 'ST-5 PASSED: timeline, calendar access and reminders handle a task with no conversation';
end $$;

rollback;

select 'ALL STANDALONE TASK TESTS PASSED' as result;
