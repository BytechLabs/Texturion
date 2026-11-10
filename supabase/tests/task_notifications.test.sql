-- [#689 D] Task subscribers and notifications: assertion suite for
-- supabase/migrations/20261110210000_task_subscribers.sql.
--
-- What is pinned:
--   TN-1  the creator and the assignee follow a task from the moment it exists,
--         and reassigning it makes the new assignee a follower
--   TN-2  commenting subscribes the commenter
--   TN-3  an unfollow is sticky against a comment, and lifted by an assignment,
--         a mention or pressing Follow
--   TN-4  unfollowing a task you never followed still holds
--   TN-5  the 60-second collapse: the first claim wins, a repeat inside the
--         window gets nobody, each (actor, recipient, kind) is its own window,
--         an expired window can be won again, another company's task claims
--         nothing
--   TN-6  overdue_notified_at is re-armed by a new due time or assignee and by
--         nothing else
--   TN-7  followers and windows leave with their task
--   TN-8  only service_role reaches the tables and the functions
--
-- One transaction, rolled back. Fixtures use an 'e7' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('e7000000-0000-4000-8000-00000000000a'::uuid, 'tn-owner@test.local'),
  ('e7000000-0000-4000-8000-00000000000b'::uuid, 'tn-member@test.local'),
  ('e7000000-0000-4000-8000-00000000000d'::uuid, 'tn-other@test.local'),
  ('e7000000-0000-4000-8000-00000000000c'::uuid, 'tn-stranger@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status)
values
  ('e7000000-0000-4000-8000-0000000000c1'::uuid, 'Notify Co',
   'e7000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(), 'active'),
  ('e7000000-0000-4000-8000-0000000000c2'::uuid, 'Other Co',
   'e7000000-0000-4000-8000-00000000000c'::uuid, 'US', '415', now(), 'active');

insert into public.company_members (company_id, user_id, role) values
  ('e7000000-0000-4000-8000-0000000000c1'::uuid,
   'e7000000-0000-4000-8000-00000000000a'::uuid, 'owner'),
  ('e7000000-0000-4000-8000-0000000000c1'::uuid,
   'e7000000-0000-4000-8000-00000000000b'::uuid, 'member'),
  ('e7000000-0000-4000-8000-0000000000c1'::uuid,
   'e7000000-0000-4000-8000-00000000000d'::uuid, 'member'),
  ('e7000000-0000-4000-8000-0000000000c2'::uuid,
   'e7000000-0000-4000-8000-00000000000c'::uuid, 'owner');

-- ---------------------------------------------------------------------------
-- TN-1. Creator and assignee follow from the start; reassigning adds the new one.
-- ---------------------------------------------------------------------------
do $$
declare
  v_c1     uuid := 'e7000000-0000-4000-8000-0000000000c1';
  v_owner  uuid := 'e7000000-0000-4000-8000-00000000000a';
  v_member uuid := 'e7000000-0000-4000-8000-00000000000b';
  v_other  uuid := 'e7000000-0000-4000-8000-00000000000d';
  v_task   uuid;
  v_reason text;
begin
  v_task := (public.create_task(
    v_c1, null, 'Fix furnace', null, v_member, null, v_owner)->'task'->>'id')::uuid;

  select reason into v_reason from public.task_subscribers
   where task_id = v_task and user_id = v_owner and unsubscribed_at is null;
  if v_reason is distinct from 'creator' then
    raise exception 'TN-1 FAILED: the creator is not a follower (reason %)', v_reason;
  end if;
  select reason into v_reason from public.task_subscribers
   where task_id = v_task and user_id = v_member and unsubscribed_at is null;
  if v_reason is distinct from 'assignee' then
    raise exception 'TN-1 FAILED: the assignee is not a follower (reason %)', v_reason;
  end if;

  perform public.assign_task(v_c1, v_task, v_other, v_owner);
  if not exists (select 1 from public.task_subscribers
                  where task_id = v_task and user_id = v_other
                    and reason = 'assignee' and unsubscribed_at is null) then
    raise exception 'TN-1 FAILED: the new assignee is not a follower';
  end if;
  if not exists (select 1 from public.task_subscribers
                  where task_id = v_task and user_id = v_member
                    and unsubscribed_at is null) then
    raise exception 'TN-1 FAILED: the previous assignee stopped following';
  end if;

  -- An unassigned task subscribes only its creator.
  v_task := (public.create_task(
    v_c1, null, 'Unowned', null, null, null, v_owner)->'task'->>'id')::uuid;
  if (select count(*) from public.task_subscribers where task_id = v_task)
     is distinct from 1 then
    raise exception 'TN-1 FAILED: an unassigned task has more than its creator';
  end if;

  raise notice 'TN-1 PASSED: creator and assignee follow; reassigning adds the new one';
end $$;

-- ---------------------------------------------------------------------------
-- TN-2 / TN-3. Commenting subscribes. An unfollow is sticky against a comment
-- and lifted by an assignment, a mention, or Follow.
-- ---------------------------------------------------------------------------
do $$
declare
  v_c1     uuid := 'e7000000-0000-4000-8000-0000000000c1';
  v_owner  uuid := 'e7000000-0000-4000-8000-00000000000a';
  v_member uuid := 'e7000000-0000-4000-8000-00000000000b';
  v_other  uuid := 'e7000000-0000-4000-8000-00000000000d';
  v_task   uuid;
  v_reason text;
begin
  v_task := (public.create_task(
    v_c1, null, 'Sticky', null, null, null, v_owner)->'task'->>'id')::uuid;

  insert into public.task_comments (company_id, task_id, author_user_id, body)
  values (v_c1, v_task, v_member, 'I can take a look');
  select reason into v_reason from public.task_subscribers
   where task_id = v_task and user_id = v_member and unsubscribed_at is null;
  if v_reason is distinct from 'commenter' then
    raise exception 'TN-2 FAILED: the commenter is not a follower (reason %)', v_reason;
  end if;

  -- The owner (creator) unfollows, then a teammate comments and the author of
  -- the earlier comment comments again: neither brings the owner back.
  perform public.task_unsubscribe(v_c1, v_task, v_owner);
  insert into public.task_comments (company_id, task_id, author_user_id, body)
  values (v_c1, v_task, v_member, 'Second note');
  insert into public.task_comments (company_id, task_id, author_user_id, body)
  values (v_c1, v_task, v_owner, 'The owner comments after unfollowing');
  if exists (select 1 from public.task_subscribers
              where task_id = v_task and user_id = v_owner
                and unsubscribed_at is null) then
    raise exception 'TN-3 FAILED: a comment re-subscribed someone who unfollowed';
  end if;

  -- A later assignment lifts it.
  perform public.assign_task(v_c1, v_task, v_owner, v_member);
  select reason into v_reason from public.task_subscribers
   where task_id = v_task and user_id = v_owner and unsubscribed_at is null;
  if v_reason is distinct from 'assignee' then
    raise exception 'TN-3 FAILED: an assignment did not lift the unfollow (reason %)', v_reason;
  end if;

  -- A mention lifts it.
  perform public.task_unsubscribe(v_c1, v_task, v_other);
  perform public.task_subscribe(v_c1, v_task, v_other, 'commenter', false);
  if exists (select 1 from public.task_subscribers
              where task_id = v_task and user_id = v_other
                and unsubscribed_at is null) then
    raise exception 'TN-3 FAILED: an ambient subscribe lifted an unfollow';
  end if;
  perform public.task_subscribe(v_c1, v_task, v_other, 'mentioned', true);
  select reason into v_reason from public.task_subscribers
   where task_id = v_task and user_id = v_other and unsubscribed_at is null;
  if v_reason is distinct from 'mentioned' then
    raise exception 'TN-3 FAILED: a mention did not lift the unfollow (reason %)', v_reason;
  end if;

  -- Following again by hand lifts it too, and does not rewrite a live reason.
  perform public.task_unsubscribe(v_c1, v_task, v_other);
  perform public.task_subscribe(v_c1, v_task, v_other, 'manual', true);
  select reason into v_reason from public.task_subscribers
   where task_id = v_task and user_id = v_other and unsubscribed_at is null;
  if v_reason is distinct from 'manual' then
    raise exception 'TN-3 FAILED: Follow did not lift the unfollow (reason %)', v_reason;
  end if;
  perform public.task_subscribe(v_c1, v_task, v_other, 'mentioned', true);
  select reason into v_reason from public.task_subscribers
   where task_id = v_task and user_id = v_other;
  if v_reason is distinct from 'manual' then
    raise exception 'TN-3 FAILED: a live follower''s reason was rewritten to %', v_reason;
  end if;

  raise notice 'TN-2/TN-3 PASSED: commenting subscribes; an unfollow sticks until asked back';
end $$;

-- ---------------------------------------------------------------------------
-- TN-4. Unfollowing a task you never followed still holds.
-- ---------------------------------------------------------------------------
do $$
declare
  v_c1     uuid := 'e7000000-0000-4000-8000-0000000000c1';
  v_owner  uuid := 'e7000000-0000-4000-8000-00000000000a';
  v_member uuid := 'e7000000-0000-4000-8000-00000000000b';
  v_task   uuid;
begin
  v_task := (public.create_task(
    v_c1, null, 'Never followed', null, null, null, v_owner)->'task'->>'id')::uuid;

  perform public.task_unsubscribe(v_c1, v_task, v_member);
  perform public.task_unsubscribe(v_c1, v_task, v_member);
  insert into public.task_comments (company_id, task_id, author_user_id, body)
  values (v_c1, v_task, v_member, 'Still not following');
  if exists (select 1 from public.task_subscribers
              where task_id = v_task and user_id = v_member
                and unsubscribed_at is null) then
    raise exception 'TN-4 FAILED: a comment subscribed someone who had unfollowed first';
  end if;
  if (select count(*) from public.task_subscribers
       where task_id = v_task and user_id = v_member) is distinct from 1 then
    raise exception 'TN-4 FAILED: repeated unfollow wrote more than one row';
  end if;

  -- Another company's task id subscribes and unsubscribes nobody.
  perform public.task_subscribe(
    'e7000000-0000-4000-8000-0000000000c2'::uuid, v_task, v_member, 'manual', true);
  perform public.task_unsubscribe(
    'e7000000-0000-4000-8000-0000000000c2'::uuid, v_task,
    'e7000000-0000-4000-8000-00000000000d'::uuid);
  if exists (select 1 from public.task_subscribers
              where task_id = v_task
                and user_id = 'e7000000-0000-4000-8000-00000000000d') then
    raise exception 'TN-4 FAILED: a task was followed through another company';
  end if;
  if exists (select 1 from public.task_subscribers
              where task_id = v_task and user_id = v_member
                and unsubscribed_at is null) then
    raise exception 'TN-4 FAILED: a cross-company Follow lifted the unfollow';
  end if;

  raise notice 'TN-4 PASSED: an unfollow before any follow holds; company scope enforced';
end $$;

-- ---------------------------------------------------------------------------
-- TN-5. The 60-second collapse.
-- ---------------------------------------------------------------------------
do $$
declare
  v_c1     uuid := 'e7000000-0000-4000-8000-0000000000c1';
  v_c2     uuid := 'e7000000-0000-4000-8000-0000000000c2';
  v_owner  uuid := 'e7000000-0000-4000-8000-00000000000a';
  v_member uuid := 'e7000000-0000-4000-8000-00000000000b';
  v_other  uuid := 'e7000000-0000-4000-8000-00000000000d';
  v_task   uuid;
  v_won    uuid[];
begin
  v_task := (public.create_task(
    v_c1, null, 'Collapse', null, null, null, v_owner)->'task'->>'id')::uuid;

  v_won := public.task_notify_claim(
    v_c1, v_task, v_owner, 'due_changed', array[v_member, v_other], 60);
  if v_won is null or array_length(v_won, 1) is distinct from 2 then
    raise exception 'TN-5 FAILED: the first claim should win both recipients, got %', v_won;
  end if;

  -- The same edit again inside the window pushes nobody.
  v_won := public.task_notify_claim(
    v_c1, v_task, v_owner, 'due_changed', array[v_member, v_other], 60);
  if array_length(v_won, 1) is not null then
    raise exception 'TN-5 FAILED: a repeat inside the window won %', v_won;
  end if;

  -- A new recipient in the same window wins; the old ones still do not.
  v_won := public.task_notify_claim(
    v_c1, v_task, v_owner, 'due_changed', array[v_member, v_owner], 60);
  if v_won is distinct from array[v_owner] then
    raise exception 'TN-5 FAILED: only the new recipient should win, got %', v_won;
  end if;

  -- A different kind, and a different actor, are their own windows.
  v_won := public.task_notify_claim(
    v_c1, v_task, v_owner, 'comment', array[v_member], 60);
  if v_won is distinct from array[v_member] then
    raise exception 'TN-5 FAILED: another kind should not share the window';
  end if;
  v_won := public.task_notify_claim(
    v_c1, v_task, v_other, 'due_changed', array[v_member], 60);
  if v_won is distinct from array[v_member] then
    raise exception 'TN-5 FAILED: another actor should not share the window';
  end if;

  -- A duplicate in one call is one recipient.
  v_won := public.task_notify_claim(
    v_c1, v_task, v_owner, 'completed', array[v_member, v_member], 60);
  if array_length(v_won, 1) is distinct from 1 then
    raise exception 'TN-5 FAILED: a duplicated recipient won twice: %', v_won;
  end if;

  -- The window closes: the same edit wins again.
  update public.task_notify_windows
     set window_until = clock_timestamp() - interval '1 second'
   where task_id = v_task and actor_user_id = v_owner and kind = 'due_changed';
  v_won := public.task_notify_claim(
    v_c1, v_task, v_owner, 'due_changed', array[v_member], 60);
  if v_won is distinct from array[v_member] then
    raise exception 'TN-5 FAILED: an expired window did not reopen, got %', v_won;
  end if;
  if (select window_until from public.task_notify_windows
       where task_id = v_task and actor_user_id = v_owner
         and recipient_user_id = v_member and kind = 'due_changed')
     <= clock_timestamp() then
    raise exception 'TN-5 FAILED: the reopened window was not extended';
  end if;

  -- Another company's id claims nothing and writes nothing.
  v_won := public.task_notify_claim(
    v_c2, v_task, v_owner, 'due_changed', array[v_member], 60);
  if array_length(v_won, 1) is not null then
    raise exception 'TN-5 FAILED: a claim through another company won %', v_won;
  end if;
  if exists (select 1 from public.task_notify_windows where company_id = v_c2) then
    raise exception 'TN-5 FAILED: a window was written for another company';
  end if;

  -- An empty or null list wins nobody.
  v_won := public.task_notify_claim(v_c1, v_task, v_owner, 'x', array[]::uuid[], 60);
  if array_length(v_won, 1) is not null then
    raise exception 'TN-5 FAILED: an empty list won %', v_won;
  end if;

  raise notice 'TN-5 PASSED: one push per (actor, recipient, kind) per window';
end $$;

-- ---------------------------------------------------------------------------
-- TN-6. overdue_notified_at is re-armed by a new due time or assignee only.
-- ---------------------------------------------------------------------------
do $$
declare
  v_c1     uuid := 'e7000000-0000-4000-8000-0000000000c1';
  v_owner  uuid := 'e7000000-0000-4000-8000-00000000000a';
  v_member uuid := 'e7000000-0000-4000-8000-00000000000b';
  v_task   uuid;
  v_stamp  timestamptz;
begin
  v_task := (public.create_task(
    v_c1, null, 'Overdue', null, v_owner, now() - interval '1 hour',
    v_owner)->'task'->>'id')::uuid;

  update public.tasks
     set overdue_notified_at = now(), due_notified_at = now()
   where id = v_task;

  perform public.update_task(v_c1, v_task, 'Overdue, renamed', null, null, false, v_owner);
  select overdue_notified_at into v_stamp from public.tasks where id = v_task;
  if v_stamp is null then
    raise exception 'TN-6 FAILED: a rename re-armed the overdue alert';
  end if;

  perform public.update_task(
    v_c1, v_task, null, null, now() - interval '30 minutes', false, v_owner);
  select overdue_notified_at into v_stamp from public.tasks where id = v_task;
  if v_stamp is not null then
    raise exception 'TN-6 FAILED: a new due time did not re-arm the overdue alert';
  end if;
  if (select due_notified_at from public.tasks where id = v_task) is not null then
    raise exception 'TN-6 FAILED: a new due time stopped re-arming the due-soon alert';
  end if;

  update public.tasks set overdue_notified_at = now() where id = v_task;
  perform public.assign_task(v_c1, v_task, v_member, v_owner);
  select overdue_notified_at into v_stamp from public.tasks where id = v_task;
  if v_stamp is not null then
    raise exception 'TN-6 FAILED: a new assignee did not re-arm the overdue alert';
  end if;

  raise notice 'TN-6 PASSED: overdue is re-armed by due time and assignee only';
end $$;

-- ---------------------------------------------------------------------------
-- TN-7. Followers and windows leave with their task.
-- ---------------------------------------------------------------------------
do $$
declare
  v_c1     uuid := 'e7000000-0000-4000-8000-0000000000c1';
  v_owner  uuid := 'e7000000-0000-4000-8000-00000000000a';
  v_member uuid := 'e7000000-0000-4000-8000-00000000000b';
  v_task   uuid;
begin
  v_task := (public.create_task(
    v_c1, null, 'Goes away', null, v_member, null, v_owner)->'task'->>'id')::uuid;
  perform public.task_notify_claim(v_c1, v_task, v_owner, 'completed', array[v_member], 60);

  delete from public.tasks where id = v_task;
  if exists (select 1 from public.task_subscribers where task_id = v_task)
     or exists (select 1 from public.task_notify_windows where task_id = v_task) then
    raise exception 'TN-7 FAILED: followers or windows outlived their task';
  end if;

  raise notice 'TN-7 PASSED: followers and windows cascade with the task';
end $$;

-- ---------------------------------------------------------------------------
-- TN-8. Only service_role reaches the tables and the functions.
-- ---------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('authenticated', 'public.task_subscribers', 'select')
     or has_table_privilege('anon', 'public.task_subscribers', 'insert')
     or has_table_privilege('authenticated', 'public.task_notify_windows', 'select')
     or has_table_privilege('anon', 'public.task_notify_windows', 'insert') then
    raise exception 'TN-8 FAILED: an end-user role can reach the notification tables';
  end if;
  if not has_table_privilege('service_role', 'public.task_subscribers', 'update')
     or not has_table_privilege('service_role', 'public.task_notify_windows', 'insert') then
    raise exception 'TN-8 FAILED: service_role lost access to the notification tables';
  end if;
  if has_function_privilege('authenticated',
       'public.task_subscribe(uuid, uuid, uuid, text, boolean)', 'execute')
     or has_function_privilege('public',
       'public.task_unsubscribe(uuid, uuid, uuid)', 'execute')
     or has_function_privilege('authenticated',
       'public.task_notify_claim(uuid, uuid, uuid, text, uuid[], int)', 'execute')
     or has_function_privilege('public',
       'public.task_subscribers_on_task()', 'execute')
     or has_function_privilege('public',
       'public.task_subscribers_on_comment()', 'execute')
     or has_function_privilege('authenticated',
       'public.tasks_rearm_due_notice()', 'execute') then
    raise exception 'TN-8 FAILED: a function regained its hosted default EXECUTE';
  end if;
  if not has_function_privilege('service_role',
       'public.task_notify_claim(uuid, uuid, uuid, text, uuid[], int)', 'execute') then
    raise exception 'TN-8 FAILED: service_role cannot claim a window';
  end if;
  raise notice 'TN-8 PASSED: service_role only';
end $$;

rollback;
