-- [#689 E] Task-scoped history and comments: assertion suite for
-- supabase/migrations/20261110160000_task_history_and_comments.sql.
--
-- What is pinned:
--   TH-1  every field change writes exactly one task_events row, with the actor
--         the RPC was told about; a no-op writes none
--   TH-2  a message-anchored task's done and reopen come from messages.done_at
--         and are recorded once per flip, with the actor
--   TH-3  a standalone task, which has no conversation to write to, has history
--   TH-4  delete is recorded with its actor
--   TH-5  api_task_activity obeys the task's own visibility: a task on a number
--         the caller is denied, a task of another company and a deleted task are
--         not_found; a standalone task is visible to its whole company
--   TH-6  comments: merged into the activity, soft-deleted ones hidden, newest
--         first, keyset pagination returns every entry exactly once
--   TH-7  a comment can own attachments, and deleting the task retires them
--   TH-8  the history tables are append-only to everyone but service_role
--
-- One transaction, rolled back. Fixtures use an 'e6' id prefix. now() is frozen
-- inside one transaction, so ordering assertions give rows explicit times.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('e6000000-0000-4000-8000-00000000000a'::uuid, 'th-owner@test.local'),
  ('e6000000-0000-4000-8000-00000000000b'::uuid, 'th-member@test.local'),
  ('e6000000-0000-4000-8000-00000000000c'::uuid, 'th-other-owner@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status)
values
  ('e6000000-0000-4000-8000-0000000000c1'::uuid, 'History Co',
   'e6000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(), 'active'),
  ('e6000000-0000-4000-8000-0000000000c2'::uuid, 'Other Co',
   'e6000000-0000-4000-8000-00000000000c'::uuid, 'US', '415', now(), 'active');

insert into public.company_members (company_id, user_id, role) values
  ('e6000000-0000-4000-8000-0000000000c1'::uuid,
   'e6000000-0000-4000-8000-00000000000a'::uuid, 'owner'),
  ('e6000000-0000-4000-8000-0000000000c1'::uuid,
   'e6000000-0000-4000-8000-00000000000b'::uuid, 'member'),
  ('e6000000-0000-4000-8000-0000000000c2'::uuid,
   'e6000000-0000-4000-8000-00000000000c'::uuid, 'owner');

insert into public.phone_numbers
  (id, company_id, provisioning_key, country, number_e164, status,
   requested_area_code)
values
  ('e6000000-0000-4000-8000-0000000000b1'::uuid,
   'e6000000-0000-4000-8000-0000000000c1'::uuid, 'th-1', 'US',
   '+14155550150', 'active', '415');

insert into public.contacts (id, company_id, phone_e164, name) values
  ('e6000000-0000-4000-8000-0000000000a1'::uuid,
   'e6000000-0000-4000-8000-0000000000c1'::uuid, '+14155550151', 'Pat Plumber');

insert into public.conversations
  (id, company_id, phone_number_id, contact_id, status, last_message_at)
values
  ('e6000000-0000-4000-8000-0000000000e1'::uuid,
   'e6000000-0000-4000-8000-0000000000c1'::uuid,
   'e6000000-0000-4000-8000-0000000000b1'::uuid,
   'e6000000-0000-4000-8000-0000000000a1'::uuid, 'open', now());

insert into public.messages
  (id, company_id, conversation_id, direction, status, body, created_at)
values
  ('e6000000-0000-4000-8000-0000000000d1'::uuid,
   'e6000000-0000-4000-8000-0000000000c1'::uuid,
   'e6000000-0000-4000-8000-0000000000e1'::uuid, 'inbound', 'received',
   'Boiler is leaking', now() - interval '1 hour');

-- ---------------------------------------------------------------------------
-- TH-1. One event per field change, with the actor.
-- ---------------------------------------------------------------------------
do $$
declare
  v_c1     uuid := 'e6000000-0000-4000-8000-0000000000c1';
  v_owner  uuid := 'e6000000-0000-4000-8000-00000000000a';
  v_member uuid := 'e6000000-0000-4000-8000-00000000000b';
  v_task   uuid;
  r        jsonb;
  n        int;
  v_actor  uuid;
begin
  r := public.create_task(
    v_c1, null, 'Fix furnace', 'Old note', null, null, v_owner);
  v_task := (r->'task'->>'id')::uuid;

  select count(*), min(actor_user_id::text)::uuid into n, v_actor
    from public.task_events where task_id = v_task and kind = 'created';
  if n is distinct from 1 or v_actor is distinct from v_owner then
    raise exception 'TH-1 FAILED: creation recorded % times by %', n, v_actor;
  end if;

  -- Title, description and due in one update_task call: three events.
  perform public.update_task(
    v_c1, v_task, 'Fix the furnace', 'New note', '2026-12-01 09:00+00', false,
    v_member);
  select count(*) into n from public.task_events
   where task_id = v_task and kind in ('title', 'description', 'due');
  if n is distinct from 3 then
    raise exception 'TH-1 FAILED: title+description+due wrote % events, wanted 3', n;
  end if;
  if exists (select 1 from public.task_events
              where task_id = v_task and kind in ('title', 'description', 'due')
                and actor_user_id is distinct from v_member) then
    raise exception 'TH-1 FAILED: an update_task event lost its actor';
  end if;
  if not exists (select 1 from public.task_events
                  where task_id = v_task and kind = 'title'
                    and from_value = to_jsonb('Fix furnace'::text)
                    and to_value = to_jsonb('Fix the furnace'::text)) then
    raise exception 'TH-1 FAILED: the title event lost its before/after';
  end if;

  -- The same values again change nothing, so record nothing.
  perform public.update_task(
    v_c1, v_task, 'Fix the furnace', 'New note', '2026-12-01 09:00+00', false,
    v_member);
  select count(*) into n from public.task_events
   where task_id = v_task and kind in ('title', 'description', 'due');
  if n is distinct from 3 then
    raise exception 'TH-1 FAILED: a no-op update wrote events (now %)', n;
  end if;

  -- Clearing the due time is a change to null.
  perform public.update_task(v_c1, v_task, null, null, null, true, v_owner);
  if not exists (select 1 from public.task_events
                  where task_id = v_task and kind = 'due'
                    and to_value is null and actor_user_id = v_owner) then
    raise exception 'TH-1 FAILED: clearing the due time was not recorded';
  end if;

  -- Address.
  perform public.update_task(
    v_c1, v_task, null, null, null, false, v_owner,
    true, '12 Elm St', null, 'Calgary', 'AB', 'T2P 0A1', 'CA', 'manual');
  select count(*) into n from public.task_events
   where task_id = v_task and kind = 'address'
     and from_value is null
     and to_value->>'street' = '12 Elm St' and actor_user_id = v_owner;
  if n is distinct from 1 then
    raise exception 'TH-1 FAILED: the address change wrote % events', n;
  end if;

  -- Assignee, by the RPC.
  perform public.assign_task(v_c1, v_task, v_member, v_owner);
  -- #689 C: each person put on a task is an assignee_added event.
  if not exists (select 1 from public.task_events
                  where task_id = v_task and kind = 'assignee_added'
                    and from_value is null
                    and to_value = to_jsonb(v_member::text)
                    and actor_user_id = v_owner) then
    raise exception 'TH-1 FAILED: the assignment was not recorded with its actor';
  end if;
  -- Assigning the same person again is a no-op.
  perform public.assign_task(v_c1, v_task, v_member, v_owner);
  select count(*) into n from public.task_events
   where task_id = v_task and kind = 'assignee_added';
  if n is distinct from 1 then
    raise exception 'TH-1 FAILED: a repeated assignment wrote % events', n;
  end if;

  -- Reminder switch and confirmation are plain column writes. confirmed_by says
  -- 'customer' or 'crew', so a crew confirmation's member is the acting one.
  perform set_config('loonext.task_actor', '', true);
  update public.tasks set reminders_off = not reminders_off where id = v_task;
  select count(*) into n from public.task_events
   where task_id = v_task and kind = 'reminders';
  if n is distinct from 1 then
    raise exception 'TH-1 FAILED: the reminder switch wrote % events', n;
  end if;
  perform set_config('loonext.task_actor', v_member::text, true);
  update public.tasks
     set confirmed_at = '2026-11-10 10:00+00', confirmed_by = 'crew'
   where id = v_task;
  perform set_config('loonext.task_actor', '', true);
  if not exists (select 1 from public.task_events
                  where task_id = v_task and kind = 'confirmation'
                    and actor_user_id = v_member and from_value is null) then
    raise exception 'TH-1 FAILED: a crew confirmation did not name the acting member';
  end if;

  -- A change nobody names is a system change.
  update public.tasks set title = 'Renamed by a job' where id = v_task;
  if not exists (select 1 from public.task_events
                  where task_id = v_task and kind = 'title'
                    and to_value = to_jsonb('Renamed by a job'::text)
                    and actor_user_id is null) then
    raise exception 'TH-1 FAILED: an unnamed change should have no actor';
  end if;

  raise notice 'TH-1 PASSED: one event per field change, actor recorded, no-ops silent';
end $$;

-- ---------------------------------------------------------------------------
-- TH-2. A message-anchored task: done and reopened come from the message.
-- ---------------------------------------------------------------------------
do $$
declare
  v_c1     uuid := 'e6000000-0000-4000-8000-0000000000c1';
  v_owner  uuid := 'e6000000-0000-4000-8000-00000000000a';
  v_member uuid := 'e6000000-0000-4000-8000-00000000000b';
  v_msg    uuid := 'e6000000-0000-4000-8000-0000000000d1';
  v_task   uuid;
  n        int;
begin
  v_task := (public.create_task(
    v_c1, v_msg, null, null, null, null, v_owner)->'task'->>'id')::uuid;
  if not exists (select 1 from public.task_events
                  where task_id = v_task and kind = 'created'
                    and actor_user_id = v_owner) then
    raise exception 'TH-2 FAILED: promoting a message wrote no created event';
  end if;

  perform public.set_task_done(v_c1, v_task, true, v_member);
  if not exists (select 1 from public.task_events
                  where task_id = v_task and kind = 'done'
                    and actor_user_id = v_member) then
    raise exception 'TH-2 FAILED: finishing a message task was not recorded';
  end if;

  perform public.set_task_done(v_c1, v_task, true, v_member);
  select count(*) into n from public.task_events
   where task_id = v_task and kind = 'done';
  if n is distinct from 1 then
    raise exception 'TH-2 FAILED: a repeated done wrote % events', n;
  end if;

  -- The message route flips the same message directly.
  perform public.set_message_done(v_c1, v_msg, false, v_owner);
  if not exists (select 1 from public.task_events
                  where task_id = v_task and kind = 'reopened'
                    and actor_user_id = v_owner) then
    raise exception 'TH-2 FAILED: reopening through the message was not recorded';
  end if;

  raise notice 'TH-2 PASSED: a message task''s done and reopen are recorded once each';
end $$;

-- ---------------------------------------------------------------------------
-- TH-3. A standalone task with no conversation has history.
-- ---------------------------------------------------------------------------
do $$
declare
  v_c1     uuid := 'e6000000-0000-4000-8000-0000000000c1';
  v_owner  uuid := 'e6000000-0000-4000-8000-00000000000a';
  v_member uuid := 'e6000000-0000-4000-8000-00000000000b';
  v_task   uuid;
  n        int;
begin
  v_task := (public.create_task(
    v_c1, null, 'Order two filters', null, null, null, v_owner)
    ->'task'->>'id')::uuid;
  if (select conversation_id from public.tasks where id = v_task) is not null then
    raise exception 'TH-3 FAILED: the fixture should have no conversation';
  end if;
  perform public.set_task_done(v_c1, v_task, true, v_member);
  perform public.set_task_done(v_c1, v_task, false, v_owner);
  select count(*) into n from public.task_events
   where task_id = v_task and kind in ('created', 'done', 'reopened');
  if n is distinct from 3 then
    raise exception 'TH-3 FAILED: a standalone task has % history rows, wanted 3', n;
  end if;
  if not exists (select 1 from public.task_events
                  where task_id = v_task and kind = 'reopened'
                    and actor_user_id = v_owner) then
    raise exception 'TH-3 FAILED: the reopen lost its actor';
  end if;
  raise notice 'TH-3 PASSED: a task with no conversation still has history';
end $$;

-- ---------------------------------------------------------------------------
-- TH-4. Delete is recorded with its actor.
-- ---------------------------------------------------------------------------
do $$
declare
  v_c1    uuid := 'e6000000-0000-4000-8000-0000000000c1';
  v_owner uuid := 'e6000000-0000-4000-8000-00000000000a';
  v_task  uuid;
begin
  v_task := (public.create_task(
    v_c1, null, 'Throwaway', null, null, null, v_owner)->'task'->>'id')::uuid;
  perform public.delete_task(v_c1, v_task, v_owner);
  if not exists (select 1 from public.task_events
                  where task_id = v_task and kind = 'deleted'
                    and actor_user_id = v_owner) then
    raise exception 'TH-4 FAILED: the deletion was not recorded with its actor';
  end if;
  raise notice 'TH-4 PASSED: delete is recorded';
end $$;

-- ---------------------------------------------------------------------------
-- TH-5 and TH-6. Visibility, merge, soft delete, pagination.
-- ---------------------------------------------------------------------------
do $$
declare
  v_c1     uuid := 'e6000000-0000-4000-8000-0000000000c1';
  v_c2     uuid := 'e6000000-0000-4000-8000-0000000000c2';
  v_owner  uuid := 'e6000000-0000-4000-8000-00000000000a';
  v_member uuid := 'e6000000-0000-4000-8000-00000000000b';
  v_hidden uuid[] := array['e6000000-0000-4000-8000-0000000000b1']::uuid[];
  v_linked uuid;
  v_open   uuid;
  v_gone   uuid;
  v_c_live uuid;
  v_c_dead uuid;
  v_t0     timestamptz := now() + interval '1 day';
  r        jsonb;
  seen     uuid[] := '{}';
  page     jsonb;
  cur_ts   timestamptz;
  cur_id   uuid;
  total    int;
  i        int;
begin
  -- A standalone task linked to the conversation on the number the member is
  -- denied, and one with no conversation at all.
  v_linked := (public.create_task(
    v_c1, null, 'Callback for Pat', null, null, null, v_owner,
    null, null, null, null, null, null, null, null,
    null, 'e6000000-0000-4000-8000-0000000000e1'::uuid)->'task'->>'id')::uuid;
  v_open := (public.create_task(
    v_c1, null, 'Company-wide chore', null, null, null, v_owner)
    ->'task'->>'id')::uuid;

  insert into public.task_comments
    (company_id, task_id, author_user_id, body, created_at)
  values (v_c1, v_linked, v_owner, 'Call before noon', v_t0 + interval '1 hour');
  insert into public.task_comments
    (company_id, task_id, author_user_id, body, created_at)
  values (v_c1, v_open, v_owner, 'Ask Sam about it', v_t0 + interval '1 hour');

  -- ---- the owner sees everything (no hidden numbers) ------------------------
  r := public.api_task_activity(v_c1, v_linked);
  if r->>'outcome' is distinct from 'ok' or not exists (
       select 1 from jsonb_array_elements(r->'items') item
        where item->>'kind' = 'comment'
          and item->'detail'->>'body' = 'Call before noon') then
    raise exception 'TH-5 FAILED: the owner cannot read a comment: %', r;
  end if;

  -- ---- a member denied the number cannot read the linked task's activity ----
  r := public.api_task_activity(v_c1, v_linked, v_hidden);
  if r->>'outcome' is distinct from 'not_found' then
    raise exception 'TH-5 FAILED: a denied member read a hidden task: %', r;
  end if;

  -- ---- ...but reads the task with no conversation, comment included ---------
  r := public.api_task_activity(v_c1, v_open, v_hidden);
  if r->>'outcome' is distinct from 'ok' or not exists (
       select 1 from jsonb_array_elements(r->'items') item
        where item->>'kind' = 'comment'
          and item->'detail'->>'body' = 'Ask Sam about it') then
    raise exception 'TH-5 FAILED: a company-wide task was hidden from a member: %', r;
  end if;

  -- ---- a different company never can ----------------------------------------
  r := public.api_task_activity(v_c2, v_open);
  if r->>'outcome' is distinct from 'not_found' then
    raise exception 'TH-5 FAILED: another company read a task: %', r;
  end if;
  r := public.api_task_activity(v_c2, v_linked, v_hidden);
  if r->>'outcome' is distinct from 'not_found' then
    raise exception 'TH-5 FAILED: another company read a linked task: %', r;
  end if;

  -- ---- a deleted task is gone -----------------------------------------------
  v_gone := (public.create_task(
    v_c1, null, 'Soon gone', null, null, null, v_owner)->'task'->>'id')::uuid;
  perform public.delete_task(v_c1, v_gone, v_owner);
  r := public.api_task_activity(v_c1, v_gone);
  if r->>'outcome' is distinct from 'not_found' then
    raise exception 'TH-5 FAILED: a deleted task still has activity: %', r;
  end if;
  raise notice 'TH-5 PASSED: comments obey the task''s own visibility';

  -- ---- soft-deleted comments are hidden -------------------------------------
  insert into public.task_comments
    (company_id, task_id, author_user_id, body, created_at, deleted_at)
  values (v_c1, v_open, v_owner, 'Typed by mistake', v_t0 + interval '2 hours',
          v_t0 + interval '3 hours')
  returning id into v_c_dead;
  r := public.api_task_activity(v_c1, v_open);
  if exists (select 1 from jsonb_array_elements(r->'items') item
              where item->>'id' = v_c_dead::text) then
    raise exception 'TH-6 FAILED: a soft-deleted comment is still listed';
  end if;

  -- ---- newest first, and every entry exactly once across pages --------------
  for i in 1..7 loop
    insert into public.task_comments
      (company_id, task_id, author_user_id, body, created_at)
    values (v_c1, v_open, v_owner, 'Comment ' || i, v_t0 + (i || ' minutes')::interval);
  end loop;
  insert into public.task_comments
    (company_id, task_id, author_user_id, body, created_at)
  values (v_c1, v_open, v_owner, 'Latest', v_t0 + interval '5 hours')
  returning id into v_c_live;

  r := public.api_task_activity(v_c1, v_open, null, 3);
  if (r->'items'->0->>'id')::uuid is distinct from v_c_live then
    raise exception 'TH-6 FAILED: the newest comment is not first: %', r->'items'->0;
  end if;

  select jsonb_array_length(public.api_task_activity(v_c1, v_open, null, 200)->'items')
    into total;
  loop
    page := public.api_task_activity(v_c1, v_open, null, 3, cur_ts, cur_id)->'items';
    exit when jsonb_array_length(page) = 0;
    for i in 0..jsonb_array_length(page) - 1 loop
      if (page->i->>'id')::uuid = any(seen) then
        raise exception 'TH-6 FAILED: pagination repeated %', page->i->>'id';
      end if;
      seen := seen || (page->i->>'id')::uuid;
    end loop;
    cur_ts := (page->(jsonb_array_length(page) - 1)->>'at')::timestamptz;
    cur_id := (page->(jsonb_array_length(page) - 1)->>'id')::uuid;
  end loop;
  if coalesce(array_length(seen, 1), 0) is distinct from total then
    raise exception 'TH-6 FAILED: pages covered % of % entries',
      coalesce(array_length(seen, 1), 0), total;
  end if;
  raise notice 'TH-6 PASSED: merged, soft-delete hidden, newest first, paginated';
end $$;

-- ---------------------------------------------------------------------------
-- TH-7. A comment owns files; deleting the task retires them.
-- ---------------------------------------------------------------------------
do $$
declare
  v_c1    uuid := 'e6000000-0000-4000-8000-0000000000c1';
  v_owner uuid := 'e6000000-0000-4000-8000-00000000000a';
  v_task  uuid;
  v_com   uuid;
begin
  v_task := (public.create_task(
    v_c1, null, 'Photo job', null, null, null, v_owner)->'task'->>'id')::uuid;
  insert into public.task_comments (company_id, task_id, author_user_id, body)
  values (v_c1, v_task, v_owner, 'See the photo') returning id into v_com;
  insert into public.attachments
    (company_id, owner_type, owner_id, conversation_id, storage_path, file_name)
  values (v_c1, 'task_comment', v_com, null, 'th/photo.png', 'photo.png');

  perform public.delete_task(v_c1, v_task, v_owner);
  if exists (select 1 from public.attachments
              where owner_type = 'task_comment' and owner_id = v_com
                and deleted_at is null) then
    raise exception 'TH-7 FAILED: deleting the task left its comment''s file live';
  end if;
  raise notice 'TH-7 PASSED: comment files follow their task';
end $$;

-- ---------------------------------------------------------------------------
-- TH-8. Only service_role reaches the history tables and the new functions.
-- ---------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('authenticated', 'public.task_events', 'select')
     or has_table_privilege('anon', 'public.task_comments', 'select')
     or has_table_privilege('authenticated', 'public.task_comments', 'insert') then
    raise exception 'TH-8 FAILED: an end-user role can reach the history tables';
  end if;
  if not has_table_privilege('service_role', 'public.task_events', 'insert')
     or not has_table_privilege('service_role', 'public.task_comments', 'update') then
    raise exception 'TH-8 FAILED: service_role lost access to the history tables';
  end if;
  if has_function_privilege('authenticated',
       'public.api_task_activity(uuid, uuid, uuid[], int, timestamptz, uuid)',
       'execute')
     or has_function_privilege('public',
       'public.task_event_actor(uuid)', 'execute')
     or has_function_privilege('authenticated',
       'public.update_task(uuid, uuid, text, text, timestamptz, boolean, uuid, boolean, text, text, text, text, text, text, text, text)',
       'execute') then
    raise exception 'TH-8 FAILED: a function regained its hosted default EXECUTE';
  end if;
  raise notice 'TH-8 PASSED: service_role only';
end $$;

rollback;
