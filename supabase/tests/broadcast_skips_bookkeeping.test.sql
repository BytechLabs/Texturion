-- Quiet broadcasts: assertion suite for
-- supabase/migrations/20261113131600_broadcasts_skip_bookkeeping_writes.sql.
--
--   QB-1  a conversation write of bookkeeping alone sends nothing
--   QB-2  a status or last_message_at change sends one conversation.updated
--   QB-3  a thread created in this transaction is announced by its first update
--   QB-4  a task write of bookkeeping alone sends nothing
--   QB-5  a task due change sends one task.changed, and so does a crew change
--   QB-6  a first read sends one read.conversation, a re-read of a read thread none
--   QB-7  a read after a new inbound sends one; the reader's own text does not count
--   QB-8  a watermark moved back over an unread message sends one
--
-- One transaction, rolled back. Fixtures use a '3b' id prefix.

\set ON_ERROR_STOP on

begin;

delete from realtime.messages;

insert into auth.users (id, email) values
  ('3b000000-0000-4000-8000-00000000000a'::uuid, 'qb-owner@test.local'),
  ('3b000000-0000-4000-8000-00000000000b'::uuid, 'qb-member@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status)
values
  ('3b000000-0000-4000-8000-0000000000c1'::uuid, 'Quiet Co',
   '3b000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(), 'active');

insert into public.company_members (company_id, user_id, role) values
  ('3b000000-0000-4000-8000-0000000000c1'::uuid,
   '3b000000-0000-4000-8000-00000000000a'::uuid, 'owner'),
  ('3b000000-0000-4000-8000-0000000000c1'::uuid,
   '3b000000-0000-4000-8000-00000000000b'::uuid, 'member');

insert into public.phone_numbers
  (id, company_id, number_e164, status, country, provisioning_key)
values
  ('3b000000-0000-4000-8000-0000000000f1'::uuid,
   '3b000000-0000-4000-8000-0000000000c1'::uuid, '+14155550631', 'active', 'US', 'qb-1');

insert into public.contacts (id, company_id, phone_e164) values
  ('3b000000-0000-4000-8000-0000000000a1'::uuid,
   '3b000000-0000-4000-8000-0000000000c1'::uuid, '+14155550632'),
  ('3b000000-0000-4000-8000-0000000000a2'::uuid,
   '3b000000-0000-4000-8000-0000000000c1'::uuid, '+14155550633');

-- Created yesterday, so its updates are judged on what they change.
insert into public.conversations
  (id, company_id, contact_id, phone_number_id, status, last_message_at, created_at)
values
  ('3b000000-0000-4000-8000-0000000000e1'::uuid,
   '3b000000-0000-4000-8000-0000000000c1'::uuid,
   '3b000000-0000-4000-8000-0000000000a1'::uuid,
   '3b000000-0000-4000-8000-0000000000f1'::uuid, 'open',
   now() - interval '1 day', now() - interval '1 day');

-- now() does not move inside the transaction, so every time below is stated.
insert into public.messages
  (id, company_id, conversation_id, direction, body, status, sent_by_user_id, created_at)
values
  ('3b000000-0000-4000-8000-0000000000d1'::uuid,
   '3b000000-0000-4000-8000-0000000000c1'::uuid,
   '3b000000-0000-4000-8000-0000000000e1'::uuid,
   'inbound', 'can you come tuesday', 'received', null, now() - interval '2 hours');

insert into public.tasks
  (id, company_id, message_id, conversation_id, title, created_by_user_id,
   assigned_user_id, due_at)
values
  ('3b000000-0000-4000-8000-0000000000b1'::uuid,
   '3b000000-0000-4000-8000-0000000000c1'::uuid,
   '3b000000-0000-4000-8000-0000000000d1'::uuid,
   '3b000000-0000-4000-8000-0000000000e1'::uuid,
   'Tuesday visit',
   '3b000000-0000-4000-8000-00000000000a'::uuid,
   '3b000000-0000-4000-8000-00000000000a'::uuid,
   now() + interval '1 day');

create or replace function pg_temp.sends(p_event text) returns int
language sql as $$
  select count(*)::int from realtime.messages m where m.event = p_event;
$$;

create or replace function pg_temp.read_at(p_at timestamptz) returns void
language sql as $$
  insert into public.conversation_reads (conversation_id, user_id, last_read_at)
  values ('3b000000-0000-4000-8000-0000000000e1'::uuid,
          '3b000000-0000-4000-8000-00000000000a'::uuid, p_at)
  on conflict (conversation_id, user_id)
  do update set last_read_at = excluded.last_read_at;
$$;

do $$
declare
  v_conv constant uuid := '3b000000-0000-4000-8000-0000000000e1';
begin
  delete from realtime.messages;
  update public.conversations set last_notified_at = now() where id = v_conv;
  if pg_temp.sends('conversation.updated') is distinct from 0 then
    raise exception 'QB-1 FAILED: a last_notified_at stamp sent % conversation.updated',
      pg_temp.sends('conversation.updated');
  end if;

  update public.conversations
     set last_auto_reply_at = now(), last_emergency_ack_at = now(),
         offramp_sent_at = now(), chase_level = 1
   where id = v_conv;
  if pg_temp.sends('conversation.updated') is distinct from 0 then
    raise exception 'QB-1 FAILED: the other bookkeeping stamps sent % conversation.updated',
      pg_temp.sends('conversation.updated');
  end if;
  raise notice 'QB-1 PASSED: a bookkeeping-only conversation write sends nothing';
end $$;

do $$
declare
  v_conv constant uuid := '3b000000-0000-4000-8000-0000000000e1';
begin
  delete from realtime.messages;
  update public.conversations set status = 'waiting' where id = v_conv;
  if pg_temp.sends('conversation.updated') is distinct from 1 then
    raise exception 'QB-2 FAILED: a status change sent % conversation.updated (want 1)',
      pg_temp.sends('conversation.updated');
  end if;

  delete from realtime.messages;
  update public.conversations
     set last_message_at = now() - interval '1 hour', last_notified_at = now()
   where id = v_conv;
  if pg_temp.sends('conversation.updated') is distinct from 1 then
    raise exception 'QB-2 FAILED: a last_message_at change sent % conversation.updated (want 1)',
      pg_temp.sends('conversation.updated');
  end if;
  raise notice 'QB-2 PASSED: a change a client shows sends one conversation.updated';
end $$;

-- api_thread_call creates a thread for a first call and touches it in the same transaction.
do $$
declare
  v_conv constant uuid := '3b000000-0000-4000-8000-0000000000e2';
begin
  insert into public.conversations (id, company_id, contact_id, phone_number_id, status)
  values (v_conv, '3b000000-0000-4000-8000-0000000000c1',
          '3b000000-0000-4000-8000-0000000000a2',
          '3b000000-0000-4000-8000-0000000000f1', 'new');
  delete from realtime.messages;
  update public.conversations
     set last_message_at = greatest(last_message_at, now())
   where id = v_conv;
  if pg_temp.sends('conversation.updated') is distinct from 1 then
    raise exception 'QB-3 FAILED: a new thread''s first update sent % conversation.updated (want 1)',
      pg_temp.sends('conversation.updated');
  end if;
  raise notice 'QB-3 PASSED: a thread created in this transaction is announced';
end $$;

do $$
declare
  v_task constant uuid := '3b000000-0000-4000-8000-0000000000b1';
begin
  delete from realtime.messages;
  update public.tasks set overdue_notified_at = now() where id = v_task;
  if pg_temp.sends('task.changed') is distinct from 0 then
    raise exception 'QB-4 FAILED: an overdue_notified_at stamp sent % task.changed',
      pg_temp.sends('task.changed');
  end if;

  update public.tasks set due_notified_at = now(), geocoded_at = now() where id = v_task;
  if pg_temp.sends('task.changed') is distinct from 0 then
    raise exception 'QB-4 FAILED: the other bookkeeping stamps sent % task.changed',
      pg_temp.sends('task.changed');
  end if;
  raise notice 'QB-4 PASSED: a bookkeeping-only task write sends nothing';
end $$;

do $$
declare
  v_task constant uuid := '3b000000-0000-4000-8000-0000000000b1';
begin
  delete from realtime.messages;
  update public.tasks set due_at = due_at + interval '1 hour' where id = v_task;
  if pg_temp.sends('task.changed') is distinct from 1 then
    raise exception 'QB-5 FAILED: a due change sent % task.changed (want 1)',
      pg_temp.sends('task.changed');
  end if;

  -- The due change cleared both stamps; set them again so the add's re-arm writes the row too.
  update public.tasks set due_notified_at = now(), overdue_notified_at = now() where id = v_task;
  -- The first assignee stays the owner, so only the crew changed.
  delete from realtime.messages;
  insert into public.task_assignees (company_id, task_id, user_id, added_by)
  values ('3b000000-0000-4000-8000-0000000000c1', v_task,
          '3b000000-0000-4000-8000-00000000000b',
          '3b000000-0000-4000-8000-00000000000a');
  if (select assigned_user_id from public.tasks where id = v_task)
     is distinct from '3b000000-0000-4000-8000-00000000000a'::uuid then
    raise exception 'QB-5 FAILED: the fixture moved the first assignee';
  end if;
  if (select due_notified_at from public.tasks where id = v_task) is not null then
    raise exception 'QB-5 FAILED: the add did not re-arm the due notice';
  end if;
  if pg_temp.sends('task.changed') is distinct from 1 then
    raise exception 'QB-5 FAILED: a crew change sent % task.changed (want 1)',
      pg_temp.sends('task.changed');
  end if;
  raise notice 'QB-5 PASSED: a due change and a crew change each send one task.changed';
end $$;

do $$
begin
  delete from realtime.messages;
  perform pg_temp.read_at(now() - interval '1 hour');
  if pg_temp.sends('read.conversation') is distinct from 1 then
    raise exception 'QB-6 FAILED: a first read sent % read.conversation (want 1)',
      pg_temp.sends('read.conversation');
  end if;

  delete from realtime.messages;
  perform pg_temp.read_at(now() - interval '50 minutes');
  if pg_temp.sends('read.conversation') is distinct from 0 then
    raise exception 'QB-6 FAILED: a re-read of a read thread sent % read.conversation',
      pg_temp.sends('read.conversation');
  end if;
  raise notice 'QB-6 PASSED: a first read sends one, a re-read of a read thread none';
end $$;

do $$
begin
  insert into public.messages
    (id, company_id, conversation_id, direction, body, status, sent_by_user_id, created_at)
  values
    ('3b000000-0000-4000-8000-0000000000d2'::uuid,
     '3b000000-0000-4000-8000-0000000000c1'::uuid,
     '3b000000-0000-4000-8000-0000000000e1'::uuid,
     'inbound', 'tuesday works', 'received', null, now() - interval '30 minutes');
  delete from realtime.messages;
  perform pg_temp.read_at(now() - interval '20 minutes');
  if pg_temp.sends('read.conversation') is distinct from 1 then
    raise exception 'QB-7 FAILED: a read after a new inbound sent % read.conversation (want 1)',
      pg_temp.sends('read.conversation');
  end if;

  insert into public.messages
    (id, company_id, conversation_id, direction, body, status, sent_by_user_id, created_at)
  values
    ('3b000000-0000-4000-8000-0000000000d3'::uuid,
     '3b000000-0000-4000-8000-0000000000c1'::uuid,
     '3b000000-0000-4000-8000-0000000000e1'::uuid,
     'outbound', 'see you then', 'queued',
     '3b000000-0000-4000-8000-00000000000a'::uuid, now() - interval '10 minutes');
  delete from realtime.messages;
  perform pg_temp.read_at(now() - interval '5 minutes');
  if pg_temp.sends('read.conversation') is distinct from 0 then
    raise exception 'QB-7 FAILED: a re-read after the reader''s own text sent % read.conversation',
      pg_temp.sends('read.conversation');
  end if;
  raise notice 'QB-7 PASSED: a new inbound makes the next read heard, the reader''s own text does not';
end $$;

do $$
begin
  delete from realtime.messages;
  perform pg_temp.read_at(now() - interval '40 minutes');
  if pg_temp.sends('read.conversation') is distinct from 1 then
    raise exception 'QB-8 FAILED: a watermark moved back over an unread message sent % (want 1)',
      pg_temp.sends('read.conversation');
  end if;
  raise notice 'QB-8 PASSED: a read that makes the thread unread again is heard';
end $$;

rollback;
