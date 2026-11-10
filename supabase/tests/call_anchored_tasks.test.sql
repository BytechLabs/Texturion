-- [#356 / D64] A task promotes a message OR an answered call — assertion suite
-- for supabase/migrations/20261110100000_call_anchored_tasks.sql.
--
-- What is pinned:
--   CA-1  the anchor rule is structural (a message task cannot carry done_at or
--         a call; a call task can), and one live task per call
--   CA-2  create_task takes exactly one source, refuses an unanswered call, a
--         call with no conversation and another workspace's call
--   CA-3  done has one owner: messages.done_at for a message task, tasks.done_at
--         for a call task, toggled through set_task_done
--   CA-4  every reader keeps a call task: For You, search, contact timeline,
--         the member-holdings count, the bulk done action, the map view
--
-- One transaction, rolled back. Fixtures use a 'ca' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('ca000000-0000-4000-8000-00000000000a'::uuid, 'call-task-owner@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status)
values
  ('ca000000-0000-4000-8000-0000000000c1'::uuid, 'Call Task Co',
   'ca000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(), 'active'),
  ('ca000000-0000-4000-8000-0000000000c2'::uuid, 'Other Co',
   'ca000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(), 'active');

insert into public.company_members (company_id, user_id, role) values
  ('ca000000-0000-4000-8000-0000000000c1'::uuid,
   'ca000000-0000-4000-8000-00000000000a'::uuid, 'owner');

insert into public.phone_numbers
  (id, company_id, provisioning_key, country, number_e164, status,
   requested_area_code)
values
  ('ca000000-0000-4000-8000-0000000000b1'::uuid,
   'ca000000-0000-4000-8000-0000000000c1'::uuid, 'call-task-1', 'US',
   '+14155550199', 'active', '415');

insert into public.contacts (id, company_id, phone_e164, name) values
  ('ca000000-0000-4000-8000-0000000000a1'::uuid,
   'ca000000-0000-4000-8000-0000000000c1'::uuid, '+14155552001', 'Pat Plumber');

insert into public.conversations
  (id, company_id, phone_number_id, contact_id, status, last_message_at)
values
  ('ca000000-0000-4000-8000-0000000000e1'::uuid,
   'ca000000-0000-4000-8000-0000000000c1'::uuid,
   'ca000000-0000-4000-8000-0000000000b1'::uuid,
   'ca000000-0000-4000-8000-0000000000a1'::uuid, 'open', now());

insert into public.messages
  (id, company_id, conversation_id, direction, status, body, created_at)
values
  ('ca000000-0000-4000-8000-0000000000d1'::uuid,
   'ca000000-0000-4000-8000-0000000000c1'::uuid,
   'ca000000-0000-4000-8000-0000000000e1'::uuid, 'inbound', 'received',
   'Boiler is leaking', now() - interval '1 hour');

-- f1 answered with a conversation; f2 answered, no conversation; f3 missed;
-- f4 voicemail; f5 answered but in the OTHER workspace; f6 a second answered
-- call used by the bulk and search checks.
insert into public.calls
  (id, company_id, phone_number_id, call_session_id, caller_e164, contact_id,
   conversation_id, outcome, forward_seconds, started_at, caller_name)
values
  ('ca000000-0000-4000-8000-0000000000f1'::uuid,
   'ca000000-0000-4000-8000-0000000000c1'::uuid,
   'ca000000-0000-4000-8000-0000000000b1'::uuid, 'sess-ca-1', '+14155552001',
   'ca000000-0000-4000-8000-0000000000a1'::uuid,
   'ca000000-0000-4000-8000-0000000000e1'::uuid, 'answered', 180,
   now() - interval '2 hours', 'Pat Plumber'),
  ('ca000000-0000-4000-8000-0000000000f2'::uuid,
   'ca000000-0000-4000-8000-0000000000c1'::uuid,
   'ca000000-0000-4000-8000-0000000000b1'::uuid, 'sess-ca-2', null,
   null, null, 'answered', 60, now() - interval '3 hours', null),
  ('ca000000-0000-4000-8000-0000000000f3'::uuid,
   'ca000000-0000-4000-8000-0000000000c1'::uuid,
   'ca000000-0000-4000-8000-0000000000b1'::uuid, 'sess-ca-3', '+14155552001',
   'ca000000-0000-4000-8000-0000000000a1'::uuid,
   'ca000000-0000-4000-8000-0000000000e1'::uuid, 'missed', 0,
   now() - interval '4 hours', 'Pat Plumber'),
  ('ca000000-0000-4000-8000-0000000000f4'::uuid,
   'ca000000-0000-4000-8000-0000000000c1'::uuid,
   'ca000000-0000-4000-8000-0000000000b1'::uuid, 'sess-ca-4', '+14155552001',
   'ca000000-0000-4000-8000-0000000000a1'::uuid,
   'ca000000-0000-4000-8000-0000000000e1'::uuid, 'voicemail', 0,
   now() - interval '5 hours', 'Pat Plumber'),
  ('ca000000-0000-4000-8000-0000000000f5'::uuid,
   'ca000000-0000-4000-8000-0000000000c2'::uuid,
   null, 'sess-ca-5', '+14155552009', null, null, 'answered', 30,
   now() - interval '6 hours', null),
  ('ca000000-0000-4000-8000-0000000000f6'::uuid,
   'ca000000-0000-4000-8000-0000000000c1'::uuid,
   'ca000000-0000-4000-8000-0000000000b1'::uuid, 'sess-ca-6', '+14155552001',
   'ca000000-0000-4000-8000-0000000000a1'::uuid,
   'ca000000-0000-4000-8000-0000000000e1'::uuid, 'answered', 90,
   now() - interval '7 hours', 'Pat Plumber');

-- ---------------------------------------------------------------------------
-- CA-1. The anchor rule is structural.
-- ---------------------------------------------------------------------------
do $$
declare v_msg_task uuid;
begin
  -- A message task cannot carry its own done_at ...
  begin
    insert into public.tasks
      (company_id, message_id, conversation_id, title, created_by_user_id, done_at)
    values
      ('ca000000-0000-4000-8000-0000000000c1'::uuid,
       'ca000000-0000-4000-8000-0000000000d1'::uuid,
       'ca000000-0000-4000-8000-0000000000e1'::uuid, 'bad',
       'ca000000-0000-4000-8000-00000000000a'::uuid, now());
    raise exception 'CA-1 FAILED: a message-anchored task accepted its own done_at';
  exception when check_violation then null;
  end;

  -- ... nor a call.
  begin
    insert into public.tasks
      (company_id, message_id, source_call_id, conversation_id, title,
       created_by_user_id)
    values
      ('ca000000-0000-4000-8000-0000000000c1'::uuid,
       'ca000000-0000-4000-8000-0000000000d1'::uuid,
       'ca000000-0000-4000-8000-0000000000f1'::uuid,
       'ca000000-0000-4000-8000-0000000000e1'::uuid, 'bad',
       'ca000000-0000-4000-8000-00000000000a'::uuid);
    raise exception 'CA-1 FAILED: a task carried both a message and a call';
  exception when check_violation then null;
  end;

  -- A call task carries its own done_at.
  insert into public.tasks
    (company_id, source_call_id, conversation_id, title, created_by_user_id,
     done_at, done_by_user_id)
  values
    ('ca000000-0000-4000-8000-0000000000c1'::uuid,
     'ca000000-0000-4000-8000-0000000000f6'::uuid,
     'ca000000-0000-4000-8000-0000000000e1'::uuid, 'Fixture call task',
     'ca000000-0000-4000-8000-00000000000a'::uuid, now(),
     'ca000000-0000-4000-8000-00000000000a'::uuid);

  -- One live task per call.
  begin
    insert into public.tasks
      (company_id, source_call_id, conversation_id, title, created_by_user_id)
    values
      ('ca000000-0000-4000-8000-0000000000c1'::uuid,
       'ca000000-0000-4000-8000-0000000000f6'::uuid,
       'ca000000-0000-4000-8000-0000000000e1'::uuid, 'dup',
       'ca000000-0000-4000-8000-00000000000a'::uuid);
    raise exception 'CA-1 FAILED: two live tasks over one call';
  exception when unique_violation then null;
  end;

  -- A deleted task frees the call.
  update public.tasks set deleted_at = now()
   where source_call_id = 'ca000000-0000-4000-8000-0000000000f6'::uuid;
  insert into public.tasks
    (company_id, source_call_id, conversation_id, title, created_by_user_id)
  values
    ('ca000000-0000-4000-8000-0000000000c1'::uuid,
     'ca000000-0000-4000-8000-0000000000f6'::uuid,
     'ca000000-0000-4000-8000-0000000000e1'::uuid, 'Re-promoted call',
     'ca000000-0000-4000-8000-00000000000a'::uuid);

  raise notice 'CA-1 PASSED: the anchor rule and one-live-task-per-call hold';
end $$;

-- ---------------------------------------------------------------------------
-- CA-2. create_task: exactly one source, and only an answered call.
-- ---------------------------------------------------------------------------
do $$
declare r jsonb; v_task jsonb;
begin
  -- Neither source (and no title), and both sources.
  r := public.create_task(
    'ca000000-0000-4000-8000-0000000000c1'::uuid, null, null, null, null, null,
    'ca000000-0000-4000-8000-00000000000a'::uuid);
  -- (Since #689 a task with no source is a standalone one, which needs a title.)
  if r->>'outcome' is distinct from 'title_required' then
    raise exception 'CA-2 FAILED: no source and no title gave %', r;
  end if;
  r := public.create_task(
    'ca000000-0000-4000-8000-0000000000c1'::uuid,
    'ca000000-0000-4000-8000-0000000000d1'::uuid, null, null, null, null,
    'ca000000-0000-4000-8000-00000000000a'::uuid,
    null, null, null, null, null, null, null,
    'ca000000-0000-4000-8000-0000000000f1'::uuid);
  if r->>'outcome' is distinct from 'no_source' then
    raise exception 'CA-2 FAILED: two sources gave %', r;
  end if;

  -- Unanswered calls: missed and voicemail.
  r := public.create_task(
    'ca000000-0000-4000-8000-0000000000c1'::uuid, null, null, null, null, null,
    'ca000000-0000-4000-8000-00000000000a'::uuid,
    null, null, null, null, null, null, null,
    'ca000000-0000-4000-8000-0000000000f3'::uuid);
  if r->>'outcome' is distinct from 'call_not_answered' then
    raise exception 'CA-2 FAILED: a missed call was promoted: %', r;
  end if;
  r := public.create_task(
    'ca000000-0000-4000-8000-0000000000c1'::uuid, null, null, null, null, null,
    'ca000000-0000-4000-8000-00000000000a'::uuid,
    null, null, null, null, null, null, null,
    'ca000000-0000-4000-8000-0000000000f4'::uuid);
  if r->>'outcome' is distinct from 'call_not_answered' then
    raise exception 'CA-2 FAILED: a voicemail call was promoted: %', r;
  end if;

  -- Answered, but there is no conversation to attach the task to.
  r := public.create_task(
    'ca000000-0000-4000-8000-0000000000c1'::uuid, null, null, null, null, null,
    'ca000000-0000-4000-8000-00000000000a'::uuid,
    null, null, null, null, null, null, null,
    'ca000000-0000-4000-8000-0000000000f2'::uuid);
  if r->>'outcome' is distinct from 'call_no_conversation' then
    raise exception 'CA-2 FAILED: a call without a conversation gave %', r;
  end if;

  -- Another workspace's call is invisible.
  r := public.create_task(
    'ca000000-0000-4000-8000-0000000000c1'::uuid, null, null, null, null, null,
    'ca000000-0000-4000-8000-00000000000a'::uuid,
    null, null, null, null, null, null, null,
    'ca000000-0000-4000-8000-0000000000f5'::uuid);
  if r->>'outcome' is distinct from 'no_call' then
    raise exception 'CA-2 FAILED: another workspace''s call gave %', r;
  end if;

  -- The answered call becomes a task on the call's conversation, titled for the
  -- caller, with the task_created event carrying the call.
  r := public.create_task(
    'ca000000-0000-4000-8000-0000000000c1'::uuid, null, null, null,
    'ca000000-0000-4000-8000-00000000000a'::uuid, null,
    'ca000000-0000-4000-8000-00000000000a'::uuid,
    null, null, null, null, null, null, null,
    'ca000000-0000-4000-8000-0000000000f1'::uuid);
  if r->>'outcome' is distinct from 'created' then
    raise exception 'CA-2 FAILED: an answered call was refused: %', r;
  end if;
  v_task := r->'task';
  if (v_task->>'conversation_id')::uuid
       is distinct from 'ca000000-0000-4000-8000-0000000000e1'::uuid
     or v_task->>'message_id' is not null
     or (v_task->>'source_call_id')::uuid
       is distinct from 'ca000000-0000-4000-8000-0000000000f1'::uuid
     or v_task->>'title' is distinct from 'Call from Pat Plumber' then
    raise exception 'CA-2 FAILED: call task row is wrong: %', v_task;
  end if;
  if not exists (
    select 1 from public.conversation_events e
     where e.conversation_id = 'ca000000-0000-4000-8000-0000000000e1'::uuid
       and e.type = 'task_created'
       and e.payload->>'call_id' = 'ca000000-0000-4000-8000-0000000000f1'
       and e.payload->>'task_id' = v_task->>'id') then
    raise exception 'CA-2 FAILED: no task_created event on the call''s conversation';
  end if;

  -- A second promotion of the same call conflicts.
  r := public.create_task(
    'ca000000-0000-4000-8000-0000000000c1'::uuid, null, null, null, null, null,
    'ca000000-0000-4000-8000-00000000000a'::uuid,
    null, null, null, null, null, null, null,
    'ca000000-0000-4000-8000-0000000000f1'::uuid);
  if r->>'outcome' is distinct from 'conflict' then
    raise exception 'CA-2 FAILED: a second promotion of one call gave %', r;
  end if;

  -- The message path is unchanged.
  r := public.create_task(
    'ca000000-0000-4000-8000-0000000000c1'::uuid,
    'ca000000-0000-4000-8000-0000000000d1'::uuid, null, null, null, null,
    'ca000000-0000-4000-8000-00000000000a'::uuid);
  if r->>'outcome' is distinct from 'created'
     or r->'task'->>'source_call_id' is not null then
    raise exception 'CA-2 FAILED: message promotion changed: %', r;
  end if;

  raise notice 'CA-2 PASSED: create_task takes one source and only an answered call';
end $$;

-- ---------------------------------------------------------------------------
-- CA-3. Done has exactly one owner.
-- ---------------------------------------------------------------------------
do $$
declare
  v_call_task uuid;
  v_msg_task  uuid;
  r jsonb;
begin
  select id into v_call_task from public.tasks
   where source_call_id = 'ca000000-0000-4000-8000-0000000000f1'::uuid
     and deleted_at is null;
  select id into v_msg_task from public.tasks
   where message_id = 'ca000000-0000-4000-8000-0000000000d1'::uuid
     and deleted_at is null;

  -- Call task: the task owns done.
  r := public.set_task_done(
    'ca000000-0000-4000-8000-0000000000c1'::uuid, v_call_task, true,
    'ca000000-0000-4000-8000-00000000000a'::uuid);
  if r->>'outcome' is distinct from 'updated' or r->>'done_at' is null then
    raise exception 'CA-3 FAILED: marking a call task done gave %', r;
  end if;
  if not exists (select 1 from public.tasks
                  where id = v_call_task and done_at is not null
                    and done_by_user_id = 'ca000000-0000-4000-8000-00000000000a'::uuid) then
    raise exception 'CA-3 FAILED: tasks.done_at was not written';
  end if;
  r := public.set_task_done(
    'ca000000-0000-4000-8000-0000000000c1'::uuid, v_call_task, true,
    'ca000000-0000-4000-8000-00000000000a'::uuid);
  if r->>'outcome' is distinct from 'unchanged' then
    raise exception 'CA-3 FAILED: a redundant done was not a no-op: %', r;
  end if;
  if (select task.done_at from public.tasks task where task.id = v_call_task) is null
     or public.task_done_at((select t from public.tasks t where t.id = v_call_task)) is null then
    raise exception 'CA-3 FAILED: task_done_at does not read the task''s own done_at';
  end if;
  r := public.set_task_done(
    'ca000000-0000-4000-8000-0000000000c1'::uuid, v_call_task, false,
    'ca000000-0000-4000-8000-00000000000a'::uuid);
  if r->>'outcome' is distinct from 'updated'
     or exists (select 1 from public.tasks
                 where id = v_call_task
                   and (done_at is not null or done_by_user_id is not null)) then
    raise exception 'CA-3 FAILED: reopening a call task left done state behind: %', r;
  end if;

  -- Message task: the message owns done; the task row never gains a done_at.
  r := public.set_task_done(
    'ca000000-0000-4000-8000-0000000000c1'::uuid, v_msg_task, true,
    'ca000000-0000-4000-8000-00000000000a'::uuid);
  if r->>'outcome' is distinct from 'updated' then
    raise exception 'CA-3 FAILED: marking a message task done gave %', r;
  end if;
  if (select done_at from public.messages
       where id = 'ca000000-0000-4000-8000-0000000000d1'::uuid) is null then
    raise exception 'CA-3 FAILED: messages.done_at was not written';
  end if;
  if (select done_at from public.tasks where id = v_msg_task) is not null then
    raise exception 'CA-3 FAILED: a message task gained its own done_at';
  end if;
  if public.task_done_at((select t from public.tasks t where t.id = v_msg_task)) is null then
    raise exception 'CA-3 FAILED: task_done_at does not read the message''s done_at';
  end if;
  perform public.set_task_done(
    'ca000000-0000-4000-8000-0000000000c1'::uuid, v_msg_task, false,
    'ca000000-0000-4000-8000-00000000000a'::uuid);

  -- Wrong workspace.
  r := public.set_task_done(
    'ca000000-0000-4000-8000-0000000000c2'::uuid, v_call_task, true,
    'ca000000-0000-4000-8000-00000000000a'::uuid);
  if r->>'outcome' is distinct from 'not_found' then
    raise exception 'CA-3 FAILED: another workspace toggled the task: %', r;
  end if;

  raise notice 'CA-3 PASSED: done is owned by the message, or by the task without one';
end $$;

-- ---------------------------------------------------------------------------
-- CA-4. Readers keep a call task.
-- ---------------------------------------------------------------------------
do $$
declare
  v_call_task uuid;
  v jsonb;
  n int;
begin
  select id into v_call_task from public.tasks
   where source_call_id = 'ca000000-0000-4000-8000-0000000000f1'::uuid
     and deleted_at is null;
  update public.tasks
     set assigned_user_id = 'ca000000-0000-4000-8000-00000000000a'::uuid,
         title = 'Quote the boiler swap'
   where id = v_call_task;

  -- For You: open call task is listed; done call task is not.
  v := public.api_for_you(
    'ca000000-0000-4000-8000-0000000000c1'::uuid,
    'ca000000-0000-4000-8000-00000000000a'::uuid, now(), 20, null);
  if not exists (select 1 from jsonb_array_elements(v->'my_tasks') i
                  where i->>'task_id' = v_call_task::text) then
    raise exception 'CA-4 FAILED: For You dropped an open call task: %', v->'my_tasks';
  end if;

  -- Holdings count it.
  if (public.api_member_holdings(
        'ca000000-0000-4000-8000-0000000000c1'::uuid,
        'ca000000-0000-4000-8000-00000000000a'::uuid)->>'tasks')::int < 1 then
    raise exception 'CA-4 FAILED: member holdings missed an open call task';
  end if;

  -- Search finds it, open.
  v := public.api_search_v2(
    'ca000000-0000-4000-8000-0000000000c1'::uuid, 'boiler swap', 10, 10, 10, 10, 10);
  if not exists (select 1 from jsonb_array_elements(v->'tasks') i
                  where i->>'id' = v_call_task::text
                    and (i->>'done')::boolean = false) then
    raise exception 'CA-4 FAILED: search lost the call task: %', v->'tasks';
  end if;

  -- Contact timeline lists it, open.
  if not exists (
    select 1 from public.api_contact_timeline(
      'ca000000-0000-4000-8000-0000000000c1'::uuid,
      'ca000000-0000-4000-8000-0000000000a1'::uuid) t
     where t->>'kind' = 'task' and t->>'id' = v_call_task::text
       and (t->>'done')::boolean = false) then
    raise exception 'CA-4 FAILED: the contact timeline lost the call task';
  end if;

  -- Bulk done flips tasks.done_at and nothing else; bulk undone reverses it.
  v := public.api_bulk_tasks(
    'ca000000-0000-4000-8000-0000000000c1'::uuid,
    'ca000000-0000-4000-8000-00000000000a'::uuid, 'mark_done',
    array[v_call_task], null, null);
  if jsonb_array_length(v->'applied') is distinct from 1
     or not exists (select 1 from public.tasks
                     where id = v_call_task and done_at is not null) then
    raise exception 'CA-4 FAILED: bulk done on a call task: %', v;
  end if;

  -- Now done everywhere it is read.
  v := public.api_for_you(
    'ca000000-0000-4000-8000-0000000000c1'::uuid,
    'ca000000-0000-4000-8000-00000000000a'::uuid, now(), 20, null);
  if exists (select 1 from jsonb_array_elements(v->'my_tasks') i
              where i->>'task_id' = v_call_task::text) then
    raise exception 'CA-4 FAILED: For You still lists a done call task';
  end if;
  v := public.api_search_v2(
    'ca000000-0000-4000-8000-0000000000c1'::uuid, 'boiler swap', 10, 10, 10, 10, 10);
  if not exists (select 1 from jsonb_array_elements(v->'tasks') i
                  where i->>'id' = v_call_task::text
                    and (i->>'done')::boolean = true) then
    raise exception 'CA-4 FAILED: search does not show the call task as done';
  end if;
  if not exists (
    select 1 from public.api_contact_timeline(
      'ca000000-0000-4000-8000-0000000000c1'::uuid,
      'ca000000-0000-4000-8000-0000000000a1'::uuid) t
     where t->>'id' = v_call_task::text and (t->>'done')::boolean = true) then
    raise exception 'CA-4 FAILED: the timeline does not show the call task as done';
  end if;

  v := public.api_bulk_tasks(
    'ca000000-0000-4000-8000-0000000000c1'::uuid,
    'ca000000-0000-4000-8000-00000000000a'::uuid, 'mark_undone',
    array[v_call_task], null, null);
  if jsonb_array_length(v->'applied') is distinct from 1
     or exists (select 1 from public.tasks
                 where id = v_call_task and done_at is not null) then
    raise exception 'CA-4 FAILED: bulk undone on a call task: %', v;
  end if;

  -- Bulk done on a message task still goes through the message.
  v := public.api_bulk_tasks(
    'ca000000-0000-4000-8000-0000000000c1'::uuid,
    'ca000000-0000-4000-8000-00000000000a'::uuid, 'mark_done',
    array[(select id from public.tasks
            where message_id = 'ca000000-0000-4000-8000-0000000000d1'::uuid
              and deleted_at is null)], null, null);
  if jsonb_array_length(v->'applied') is distinct from 1
     or (select done_at from public.messages
          where id = 'ca000000-0000-4000-8000-0000000000d1'::uuid) is null then
    raise exception 'CA-4 FAILED: bulk done on a message task: %', v;
  end if;

  -- The map view carries the call and the effective done state.
  select count(*) into n from public.task_map_rows
   where id = v_call_task and source_call_id is not null and done_at is null;
  if n is distinct from 1 then
    raise exception 'CA-4 FAILED: task_map_rows lost the call task (% rows)', n;
  end if;

  raise notice 'CA-4 PASSED: For You, search, timeline, holdings, bulk and the map keep call tasks';
end $$;

rollback;

select 'ALL CALL-ANCHORED TASK TESTS PASSED' as result;
