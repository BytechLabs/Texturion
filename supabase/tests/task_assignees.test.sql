-- [#689 C] Multiple assignees: assertion suite for
-- supabase/migrations/20261111130000_task_assignees.sql and
-- 20261111140000_task_assignees_readers.sql.
--
-- What is pinned:
--   TA-1  create_task takes a crew; assigned_user_id is the first of it; the
--         one-person shorthand still works; a stranger and eleven people are
--         refused; creating a task writes no assignee history
--   TA-2  set_task_assignees adds and removes, each as a task_events row, and
--         the column follows; the same set is "unchanged"; assign_task is
--         "exactly this person"
--   TA-3  the cap is ten, enforced by the table as well as the RPC
--   TA-4  everyone on a task follows it, and a person taken off still does
--   TA-5  a direct write of tasks.assigned_user_id by an old writer lands in
--         the table
--   TA-6  the table accepts members only, and leaves with the member
--   TA-7  bulk assign ADDS, clears on no target, refuses a stranger for the
--         whole call, and reports a task that would pass ten
--   TA-8  offboarding takes the member off every open crew and hands their
--         place to the successor without disturbing the others
--   TA-9  a repeat carries every assignee to its next occurrence
--   TA-10 a calendar connection of each assignee gets the event, and removing
--         an assignee cancels theirs
--   TA-11 For You lists a task for each assignee, and the holdings count it
--   TA-12 only service_role reaches the table and the new functions
--
-- One transaction, rolled back. Fixtures use an 'a9' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email)
select ('a9000000-0000-4000-8000-0000000000' || lpad(to_hex(n), 2, '0'))::uuid,
       'ta-' || n || '@test.local'
  from generate_series(10, 24) n;

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status)
values
  ('a9000000-0000-4000-8000-0000000000c1'::uuid, 'Crew Co',
   'a9000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(), 'active'),
  ('a9000000-0000-4000-8000-0000000000c2'::uuid, 'Other Co',
   'a9000000-0000-4000-8000-000000000018'::uuid, 'US', '415', now(), 'active');

-- 0a = owner, 0b..0e = members, 0f = a member who is deactivated later.
-- Ten more members (0x10..0x17) are for the cap.
insert into public.company_members (company_id, user_id, role)
select 'a9000000-0000-4000-8000-0000000000c1'::uuid,
       ('a9000000-0000-4000-8000-0000000000' || lpad(to_hex(n), 2, '0'))::uuid,
       case when n = 10 then 'owner'::member_role else 'member'::member_role end
  from generate_series(10, 23) n;
insert into public.company_members (company_id, user_id, role) values
  ('a9000000-0000-4000-8000-0000000000c2'::uuid,
   'a9000000-0000-4000-8000-000000000018'::uuid, 'owner');

create or replace function pg_temp.u(n int) returns uuid language sql as $$
  select ('a9000000-0000-4000-8000-0000000000' || lpad(to_hex(n), 2, '0'))::uuid
$$;
create or replace function pg_temp.crew(p_task uuid) returns uuid[] language sql as $$
  select coalesce(array_agg(a.user_id order by a.added_at, a.user_id), '{}')
    from public.task_assignees a where a.task_id = p_task
$$;
create or replace function pg_temp.events(p_task uuid, p_kind text) returns int language sql as $$
  select count(*)::int from public.task_events e
   where e.task_id = p_task and e.kind = p_kind
$$;

-- ---------------------------------------------------------------------------
-- TA-1. Creating with a crew.
-- ---------------------------------------------------------------------------
do $$
declare
  c1 uuid := 'a9000000-0000-4000-8000-0000000000c1';
  v_res  jsonb;
  v_task uuid;
begin
  v_res := public.create_task(c1, null, 'Install furnace', null, null, null,
                              pg_temp.u(10), p_assignee_ids => array[pg_temp.u(11), pg_temp.u(12)]);
  v_task := (v_res->'task'->>'id')::uuid;
  if pg_temp.crew(v_task) is distinct from array[pg_temp.u(11), pg_temp.u(12)] then
    raise exception 'TA-1 FAILED: crew is %', pg_temp.crew(v_task);
  end if;
  if (select assigned_user_id from public.tasks where id = v_task) is distinct from pg_temp.u(11) then
    raise exception 'TA-1 FAILED: assigned_user_id is not the first assignee';
  end if;
  if (v_res->'task'->>'assigned_user_id')::uuid is distinct from pg_temp.u(11) then
    raise exception 'TA-1 FAILED: the returned row does not carry the first assignee';
  end if;
  if pg_temp.events(v_task, 'assignee_added') is distinct from 0 then
    raise exception 'TA-1 FAILED: creating the task wrote assignee history';
  end if;

  -- The shorthand.
  v_res := public.create_task(c1, null, 'One person', null, pg_temp.u(13), null, pg_temp.u(10));
  v_task := (v_res->'task'->>'id')::uuid;
  if pg_temp.crew(v_task) is distinct from array[pg_temp.u(13)] then
    raise exception 'TA-1 FAILED: the one-person shorthand did not make a crew of one';
  end if;

  -- A crew wins over the shorthand.
  v_res := public.create_task(c1, null, 'Both given', null, pg_temp.u(13), null, pg_temp.u(10),
                              p_assignee_ids => array[pg_temp.u(14)]);
  if pg_temp.crew((v_res->'task'->>'id')::uuid) is distinct from array[pg_temp.u(14)] then
    raise exception 'TA-1 FAILED: p_assignee_ids did not win over p_assigned_user_id';
  end if;

  -- An explicit empty crew is nobody.
  v_res := public.create_task(c1, null, 'Nobody', null, null, null, pg_temp.u(10),
                              p_assignee_ids => '{}');
  if v_res->'task'->>'assigned_user_id' is not null then
    raise exception 'TA-1 FAILED: an empty crew still assigned somebody';
  end if;

  -- A person from another company is refused, and so are eleven people.
  v_res := public.create_task(c1, null, 'Stranger', null, null, null, pg_temp.u(10),
                              p_assignee_ids => array[pg_temp.u(11), pg_temp.u(24)]);
  if v_res->>'outcome' is distinct from 'not_member' then
    raise exception 'TA-1 FAILED: a stranger was accepted (%)', v_res->>'outcome';
  end if;
  v_res := public.create_task(c1, null, 'Eleven', null, null, null, pg_temp.u(10),
                              p_assignee_ids => (select array_agg(pg_temp.u(n)) from generate_series(11, 21) n));
  if v_res->>'outcome' is distinct from 'too_many' then
    raise exception 'TA-1 FAILED: eleven people were accepted (%)', v_res->>'outcome';
  end if;
  raise notice 'TA-1 PASSED: create with a crew';
end $$;

-- ---------------------------------------------------------------------------
-- TA-2. Setting the crew, history, the shorthand.
-- ---------------------------------------------------------------------------
do $$
declare
  c1 uuid := 'a9000000-0000-4000-8000-0000000000c1';
  v_task uuid;
  v_res  jsonb;
begin
  v_task := (public.create_task(c1, null, 'Crew edits', null, pg_temp.u(11), null, pg_temp.u(10))->'task'->>'id')::uuid;

  v_res := public.set_task_assignees(c1, v_task, array[pg_temp.u(11), pg_temp.u(12), pg_temp.u(13)], pg_temp.u(10));
  if v_res->>'outcome' is distinct from 'updated'
     or jsonb_array_length(v_res->'added') is distinct from 2
     or jsonb_array_length(v_res->'removed') is distinct from 0 then
    raise exception 'TA-2 FAILED: adding two: %', v_res;
  end if;
  if pg_temp.events(v_task, 'assignee_added') is distinct from 2 then
    raise exception 'TA-2 FAILED: expected two assignee_added events';
  end if;
  if (select actor_user_id from public.task_events
       where task_id = v_task and kind = 'assignee_added' limit 1) is distinct from pg_temp.u(10) then
    raise exception 'TA-2 FAILED: the event does not name the actor';
  end if;

  v_res := public.set_task_assignees(c1, v_task, array[pg_temp.u(13), pg_temp.u(12), pg_temp.u(11)], pg_temp.u(10));
  if v_res->>'outcome' is distinct from 'unchanged' then
    raise exception 'TA-2 FAILED: the same people in another order was % not unchanged', v_res->>'outcome';
  end if;

  -- Taking the first person off moves the column to the next one.
  v_res := public.set_task_assignees(c1, v_task, array[pg_temp.u(12), pg_temp.u(13)], pg_temp.u(10));
  if (select assigned_user_id from public.tasks where id = v_task) is distinct from pg_temp.u(12) then
    raise exception 'TA-2 FAILED: assigned_user_id did not move to the next assignee';
  end if;
  if pg_temp.events(v_task, 'assignee_removed') is distinct from 1 then
    raise exception 'TA-2 FAILED: expected one assignee_removed event';
  end if;

  -- Nobody clears the column.
  perform public.set_task_assignees(c1, v_task, '{}', pg_temp.u(10));
  if (select assigned_user_id from public.tasks where id = v_task) is not null
     or pg_temp.crew(v_task) is distinct from '{}' then
    raise exception 'TA-2 FAILED: an empty set left somebody on the task';
  end if;

  -- The shorthand is exactly one person.
  perform public.set_task_assignees(c1, v_task, array[pg_temp.u(11), pg_temp.u(12)], pg_temp.u(10));
  v_res := public.assign_task(c1, v_task, pg_temp.u(14), pg_temp.u(10));
  if pg_temp.crew(v_task) is distinct from array[pg_temp.u(14)] then
    raise exception 'TA-2 FAILED: assign_task did not leave exactly one person: %', pg_temp.crew(v_task);
  end if;
  v_res := public.assign_task(c1, v_task, pg_temp.u(14), pg_temp.u(10));
  if v_res->>'outcome' is distinct from 'unchanged' then
    raise exception 'TA-2 FAILED: assigning the same person was %', v_res->>'outcome';
  end if;
  v_res := public.assign_task(c1, v_task, pg_temp.u(24), pg_temp.u(10));
  if v_res->>'outcome' is distinct from 'not_member' then
    raise exception 'TA-2 FAILED: a stranger was assigned (%)', v_res->>'outcome';
  end if;
  v_res := public.set_task_assignees(c1, gen_random_uuid(), array[pg_temp.u(11)], pg_temp.u(10));
  if v_res->>'outcome' is distinct from 'not_found' then
    raise exception 'TA-2 FAILED: a missing task was %', v_res->>'outcome';
  end if;
  raise notice 'TA-2 PASSED: set, history and the shorthand';
end $$;

-- ---------------------------------------------------------------------------
-- TA-3. The cap.
-- ---------------------------------------------------------------------------
do $$
declare
  c1 uuid := 'a9000000-0000-4000-8000-0000000000c1';
  v_task uuid;
  v_res  jsonb;
begin
  v_task := (public.create_task(c1, null, 'Big crew', null, null, null, pg_temp.u(10),
              p_assignee_ids => (select array_agg(pg_temp.u(n)) from generate_series(11, 20) n))->'task'->>'id')::uuid;
  if cardinality(pg_temp.crew(v_task)) is distinct from 10 then
    raise exception 'TA-3 FAILED: a crew of ten was not accepted';
  end if;
  v_res := public.set_task_assignees(c1, v_task,
             (select array_agg(pg_temp.u(n)) from generate_series(11, 21) n), pg_temp.u(10));
  if v_res->>'outcome' is distinct from 'too_many' then
    raise exception 'TA-3 FAILED: eleven was %', v_res->>'outcome';
  end if;
  begin
    insert into public.task_assignees (company_id, task_id, user_id) values (c1, v_task, pg_temp.u(21));
    raise exception 'TA-3 FAILED: the table took an eleventh row';
  exception when check_violation then null;
  end;
  -- A full crew can still swap one person.
  v_res := public.set_task_assignees(c1, v_task,
             (select array_agg(pg_temp.u(n)) from generate_series(12, 21) n), pg_temp.u(10));
  if v_res->>'outcome' is distinct from 'updated' or cardinality(pg_temp.crew(v_task)) is distinct from 10 then
    raise exception 'TA-3 FAILED: a swap on a full crew was %', v_res->>'outcome';
  end if;
  raise notice 'TA-3 PASSED: the cap is ten';
end $$;

-- ---------------------------------------------------------------------------
-- TA-4. Everyone on a task follows it.
-- ---------------------------------------------------------------------------
do $$
declare
  c1 uuid := 'a9000000-0000-4000-8000-0000000000c1';
  v_task uuid;
begin
  v_task := (public.create_task(c1, null, 'Followed', null, null, null, pg_temp.u(10),
              p_assignee_ids => array[pg_temp.u(11), pg_temp.u(12)])->'task'->>'id')::uuid;
  if (select count(*) from public.task_subscribers
       where task_id = v_task and reason = 'assignee' and unsubscribed_at is null) is distinct from 2 then
    raise exception 'TA-4 FAILED: both assignees should follow';
  end if;
  perform public.task_unsubscribe(c1, v_task, pg_temp.u(12));
  perform public.set_task_assignees(c1, v_task, array[pg_temp.u(11)], pg_temp.u(10));
  perform public.set_task_assignees(c1, v_task, array[pg_temp.u(11), pg_temp.u(12)], pg_temp.u(10));
  if not exists (select 1 from public.task_subscribers
                  where task_id = v_task and user_id = pg_temp.u(12) and unsubscribed_at is null) then
    raise exception 'TA-4 FAILED: assigning a person again did not lift their unfollow';
  end if;
  perform public.set_task_assignees(c1, v_task, array[pg_temp.u(11)], pg_temp.u(10));
  if not exists (select 1 from public.task_subscribers
                  where task_id = v_task and user_id = pg_temp.u(12)) then
    raise exception 'TA-4 FAILED: removing a person dropped their subscription';
  end if;
  raise notice 'TA-4 PASSED: assignees follow';
end $$;

-- ---------------------------------------------------------------------------
-- TA-5. An old writer of tasks.assigned_user_id.
-- ---------------------------------------------------------------------------
do $$
declare
  c1 uuid := 'a9000000-0000-4000-8000-0000000000c1';
  v_task uuid;
begin
  insert into public.tasks (company_id, title, created_by_user_id, assigned_user_id)
  values (c1, 'Legacy insert', pg_temp.u(10), pg_temp.u(11))
  returning id into v_task;
  if pg_temp.crew(v_task) is distinct from array[pg_temp.u(11)] then
    raise exception 'TA-5 FAILED: a direct insert did not reach the table';
  end if;

  perform public.set_task_assignees(c1, v_task, array[pg_temp.u(11), pg_temp.u(12)], pg_temp.u(10));
  update public.tasks set assigned_user_id = pg_temp.u(13) where id = v_task;
  if pg_temp.crew(v_task) is distinct from array[pg_temp.u(12), pg_temp.u(13)] then
    raise exception 'TA-5 FAILED: a direct update should swap the first person, crew is %', pg_temp.crew(v_task);
  end if;
  update public.tasks set assigned_user_id = null where id = v_task;
  if pg_temp.crew(v_task) is distinct from array[pg_temp.u(13)] then
    raise exception 'TA-5 FAILED: clearing the column should take only the first person, crew is %', pg_temp.crew(v_task);
  end if;
  if (select assigned_user_id from public.tasks where id = v_task) is distinct from pg_temp.u(13) then
    raise exception 'TA-5 FAILED: the column is not the first of the table';
  end if;
  raise notice 'TA-5 PASSED: a direct write of the column lands in the table';
end $$;

-- ---------------------------------------------------------------------------
-- TA-6. Members only.
-- ---------------------------------------------------------------------------
do $$
declare
  c1 uuid := 'a9000000-0000-4000-8000-0000000000c1';
  v_task uuid;
begin
  v_task := (public.create_task(c1, null, 'Members', null, null, null, pg_temp.u(10))->'task'->>'id')::uuid;
  begin
    insert into public.task_assignees (company_id, task_id, user_id) values (c1, v_task, pg_temp.u(24));
    raise exception 'TA-6 FAILED: a stranger was put on a task';
  exception when foreign_key_violation then null;
  end;
  raise notice 'TA-6 PASSED: members only';
end $$;

-- ---------------------------------------------------------------------------
-- TA-7. Bulk assign.
-- ---------------------------------------------------------------------------
do $$
declare
  c1 uuid := 'a9000000-0000-4000-8000-0000000000c1';
  v_a uuid; v_b uuid; v_full uuid;
  v_res jsonb;
begin
  v_a := (public.create_task(c1, null, 'Bulk A', null, pg_temp.u(11), null, pg_temp.u(10))->'task'->>'id')::uuid;
  v_b := (public.create_task(c1, null, 'Bulk B', null, null, null, pg_temp.u(10))->'task'->>'id')::uuid;
  v_full := (public.create_task(c1, null, 'Bulk full', null, null, null, pg_temp.u(10),
              p_assignee_ids => (select array_agg(pg_temp.u(n)) from generate_series(11, 20) n))->'task'->>'id')::uuid;

  v_res := public.api_bulk_tasks(c1, pg_temp.u(10), 'assign', array[v_a, v_b], null, null, null, null,
                                 array[pg_temp.u(12), pg_temp.u(13)]);
  if jsonb_array_length(v_res->'applied') is distinct from 2 then
    raise exception 'TA-7 FAILED: expected two applied, got %', v_res;
  end if;
  if pg_temp.crew(v_a) is distinct from array[pg_temp.u(11), pg_temp.u(12), pg_temp.u(13)] then
    raise exception 'TA-7 FAILED: bulk assign replaced the crew: %', pg_temp.crew(v_a);
  end if;
  if pg_temp.crew(v_b) is distinct from array[pg_temp.u(12), pg_temp.u(13)] then
    raise exception 'TA-7 FAILED: bulk assign to an empty task: %', pg_temp.crew(v_b);
  end if;

  -- The one-person target is the same add.
  perform public.api_bulk_tasks(c1, pg_temp.u(10), 'assign', array[v_b], pg_temp.u(14));
  if pg_temp.crew(v_b) is distinct from array[pg_temp.u(12), pg_temp.u(13), pg_temp.u(14)] then
    raise exception 'TA-7 FAILED: the single target did not add: %', pg_temp.crew(v_b);
  end if;

  -- A task that would pass ten is reported, the rest still apply.
  v_res := public.api_bulk_tasks(c1, pg_temp.u(10), 'assign', array[v_a, v_full], null, null, null, null,
                                 array[pg_temp.u(22)]);
  if not exists (select 1 from jsonb_array_elements(v_res->'failed') f
                  where f->>'id' = v_full::text and f->>'reason' = 'too_many_assignees') then
    raise exception 'TA-7 FAILED: a full crew was not reported: %', v_res;
  end if;
  if not (pg_temp.u(22) = any (pg_temp.crew(v_a))) then
    raise exception 'TA-7 FAILED: the task with room was not assigned';
  end if;

  -- A stranger refuses the whole call.
  v_res := public.api_bulk_tasks(c1, pg_temp.u(10), 'assign', array[v_b], null, null, null, null,
                                 array[pg_temp.u(15), pg_temp.u(24)]);
  if v_res->>'error' is distinct from 'not_member' then
    raise exception 'TA-7 FAILED: a stranger was %', v_res;
  end if;
  if pg_temp.u(15) = any (pg_temp.crew(v_b)) then
    raise exception 'TA-7 FAILED: a refused call still assigned somebody';
  end if;

  -- No target clears everyone, and reports who was there.
  v_res := public.api_bulk_tasks(c1, pg_temp.u(10), 'assign', array[v_a, v_b]);
  if pg_temp.crew(v_a) is distinct from '{}' or pg_temp.crew(v_b) is distinct from '{}' then
    raise exception 'TA-7 FAILED: no target did not clear the crews';
  end if;
  if jsonb_array_length((v_res->'applied'->0->'previous'->'assignee_ids')) = 0 then
    raise exception 'TA-7 FAILED: previous did not carry the old crew: %', v_res;
  end if;
  raise notice 'TA-7 PASSED: bulk assign adds, clears on no target';
end $$;

-- ---------------------------------------------------------------------------
-- TA-8. Offboarding.
-- ---------------------------------------------------------------------------
do $$
declare
  c1 uuid := 'a9000000-0000-4000-8000-0000000000c1';
  v_t1 uuid; v_t2 uuid; v_done uuid;
  v_member uuid;
  v_res jsonb;
begin
  v_t1 := (public.create_task(c1, null, 'Off 1', null, null, null, pg_temp.u(10),
            p_assignee_ids => array[pg_temp.u(11), pg_temp.u(23)])->'task'->>'id')::uuid;
  v_t2 := (public.create_task(c1, null, 'Off 2', null, pg_temp.u(23), null, pg_temp.u(10))->'task'->>'id')::uuid;
  v_done := (public.create_task(c1, null, 'Off done', null, pg_temp.u(23), null, pg_temp.u(10))->'task'->>'id')::uuid;
  update public.tasks set done_at = now() where id = v_done;

  if (public.api_member_holdings(c1, pg_temp.u(23))->>'tasks')::int is distinct from 2 then
    raise exception 'TA-8 FAILED: holdings should count both open crews, got %', public.api_member_holdings(c1, pg_temp.u(23));
  end if;

  select id into v_member from public.company_members where company_id = c1 and user_id = pg_temp.u(23);
  v_res := public.offboard_member(c1, v_member, pg_temp.u(13));
  if (v_res->>'tasks')::int is distinct from 2 then
    raise exception 'TA-8 FAILED: expected two tasks moved, got %', v_res;
  end if;
  if pg_temp.crew(v_t1) is distinct from array[pg_temp.u(11), pg_temp.u(13)] then
    raise exception 'TA-8 FAILED: crew after hand-over is %', pg_temp.crew(v_t1);
  end if;
  if pg_temp.crew(v_t2) is distinct from array[pg_temp.u(13)] then
    raise exception 'TA-8 FAILED: sole assignee hand-over is %', pg_temp.crew(v_t2);
  end if;
  if pg_temp.crew(v_done) is distinct from array[pg_temp.u(23)] then
    raise exception 'TA-8 FAILED: a finished task was moved';
  end if;
  raise notice 'TA-8 PASSED: offboarding';
end $$;

-- ---------------------------------------------------------------------------
-- TA-9. A repeat carries the crew.
-- ---------------------------------------------------------------------------
do $$
declare
  c1 uuid := 'a9000000-0000-4000-8000-0000000000c1';
  v_task uuid;
  v_next uuid;
  v_res  jsonb;
begin
  v_task := (public.create_task(c1, null, 'Weekly', null, null, now() + interval '1 day', pg_temp.u(10),
              p_assignee_ids => array[pg_temp.u(11), pg_temp.u(14)])->'task'->>'id')::uuid;
  v_res := public.api_set_task_repeat(c1, v_task, pg_temp.u(10),
             '{"kind":"after_done","unit":"week","every":1}'::jsonb);
  if v_res->>'outcome' is distinct from 'set' then
    raise exception 'TA-9 FAILED: repeat was %', v_res;
  end if;
  if (select assignee_ids from public.task_series s
       join public.tasks t on t.series_id = s.id where t.id = v_task)
     is distinct from array[pg_temp.u(11), pg_temp.u(14)] then
    raise exception 'TA-9 FAILED: the series did not keep the crew';
  end if;
  update public.tasks set done_at = now(), done_by_user_id = pg_temp.u(11) where id = v_task;
  select t.id into v_next from public.tasks t
   where t.series_id = (select series_id from public.tasks where id = v_task) and t.id is distinct from v_task;
  if v_next is null or pg_temp.crew(v_next) is distinct from array[pg_temp.u(11), pg_temp.u(14)] then
    raise exception 'TA-9 FAILED: the next occurrence crew is %', pg_temp.crew(v_next);
  end if;

  -- "This and future" sets the crew on the series and on the later ones.
  v_res := public.api_edit_task_series(c1, v_next, pg_temp.u(10),
             jsonb_build_object('assignee_ids', jsonb_build_array(pg_temp.u(15))));
  if v_res->>'outcome' is distinct from 'updated' then
    raise exception 'TA-9 FAILED: series edit was %', v_res;
  end if;
  if (select assignee_ids from public.task_series where id = (select series_id from public.tasks where id = v_next))
     is distinct from array[pg_temp.u(15)] then
    raise exception 'TA-9 FAILED: the series template was not updated';
  end if;
  v_res := public.api_edit_task_series(c1, v_next, pg_temp.u(10),
             jsonb_build_object('assignee_ids', (select jsonb_agg(pg_temp.u(n)) from generate_series(11, 21) n)));
  if v_res->>'outcome' is distinct from 'too_many' then
    raise exception 'TA-9 FAILED: eleven on a series was %', v_res;
  end if;
  raise notice 'TA-9 PASSED: repeats carry the crew';
end $$;

-- ---------------------------------------------------------------------------
-- TA-10. Each assignee's calendar.
-- ---------------------------------------------------------------------------
do $$
declare
  c1 uuid := 'a9000000-0000-4000-8000-0000000000c1';
  v_task uuid;
  v_conn_b uuid; v_conn_c uuid;
begin
  insert into public.calendar_connections (
    company_id, user_id, provider, provider_account_id,
    selected_calendar_id, selected_calendar_timezone,
    credential_ciphertext, credential_iv, credential_key_version
  ) values (
    c1, pg_temp.u(11), 'google', 'ta-b', 'primary', 'America/Edmonton',
    'AAECAwQFBgcICQoLDA0ODxAREhM', 'AAECAwQFBgcICQoL', 'v1'
  ) returning id into v_conn_b;
  insert into public.calendar_connections (
    company_id, user_id, provider, provider_account_id,
    selected_calendar_id, selected_calendar_timezone,
    credential_ciphertext, credential_iv, credential_key_version
  ) values (
    c1, pg_temp.u(12), 'google', 'ta-c', 'primary', 'America/Edmonton',
    'AQIDBAUGBwgJCgsMDQ4PEBESExQ', 'AQIDBAUGBwgJCgsM', 'v1'
  ) returning id into v_conn_c;

  v_task := (public.create_task(c1, null, 'Calendar crew', null, null, now() + interval '3 days', pg_temp.u(10),
              p_assignee_ids => array[pg_temp.u(11), pg_temp.u(12)])->'task'->>'id')::uuid;
  if not exists (select 1 from public.calendar_outbox o
                  where o.task_id = v_task and o.connection_id = v_conn_b
                    and o.action = 'create' and o.state = 'queued')
     or not exists (select 1 from public.calendar_outbox o
                     where o.task_id = v_task and o.connection_id = v_conn_c
                       and o.action = 'create' and o.state = 'queued') then
    raise exception 'TA-10 FAILED: each assignee should have a queued create';
  end if;

  perform public.set_task_assignees(c1, v_task, array[pg_temp.u(11)], pg_temp.u(10));
  if not exists (select 1 from public.calendar_outbox o
                  where o.task_id = v_task and o.connection_id = v_conn_c and o.state = 'cancelled') then
    raise exception 'TA-10 FAILED: the removed assignee kept a queued event';
  end if;
  if not exists (select 1 from public.calendar_outbox o
                  where o.task_id = v_task and o.connection_id = v_conn_b and o.state = 'queued') then
    raise exception 'TA-10 FAILED: the remaining assignee lost the event';
  end if;

  -- A person added later gets one too.
  perform public.set_task_assignees(c1, v_task, array[pg_temp.u(11), pg_temp.u(12)], pg_temp.u(10));
  if not exists (select 1 from public.calendar_outbox o
                  where o.task_id = v_task and o.connection_id = v_conn_c
                    and o.action = 'create' and o.state = 'queued') then
    raise exception 'TA-10 FAILED: an assignee added later got no event';
  end if;
  raise notice 'TA-10 PASSED: per-assignee calendar events';
end $$;

-- ---------------------------------------------------------------------------
-- TA-11. For You and the unassigned test.
-- ---------------------------------------------------------------------------
do $$
declare
  c1 uuid := 'a9000000-0000-4000-8000-0000000000c1';
  v_task uuid;
  v_for  jsonb;
begin
  v_task := (public.create_task(c1, null, 'For both', null, null, now() + interval '2 days', pg_temp.u(10),
              p_assignee_ids => array[pg_temp.u(16), pg_temp.u(17)])->'task'->>'id')::uuid;
  v_for := public.api_for_you(c1, pg_temp.u(17), now(), 50, null)::jsonb;
  if not (v_for::text like '%' || v_task::text || '%') then
    raise exception 'TA-11 FAILED: the second assignee does not see the task in For You';
  end if;
  v_for := public.api_for_you(c1, pg_temp.u(16), now(), 50, null)::jsonb;
  if not (v_for::text like '%' || v_task::text || '%') then
    raise exception 'TA-11 FAILED: the first assignee does not see the task in For You';
  end if;
  raise notice 'TA-11 PASSED: For You for each assignee';
end $$;

-- ---------------------------------------------------------------------------
-- TA-12. Grants.
-- ---------------------------------------------------------------------------
do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.set_task_assignees(uuid, uuid, uuid[], uuid)',
    'public.task_set_assignees(uuid, uuid[], uuid)',
    'public.task_assignment_events(uuid, uuid, uuid, uuid, uuid[], uuid[])',
    'public.task_assignee_list(uuid[])',
    'public.assign_task(uuid, uuid, uuid, uuid)'
  ] loop
    if has_function_privilege('anon', v_sig, 'execute')
       or has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception 'TA-12 FAILED: % is callable by anon or authenticated', v_sig;
    end if;
    if not has_function_privilege('service_role', v_sig, 'execute') then
      raise exception 'TA-12 FAILED: service_role cannot call %', v_sig;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.task_assignees', 'select')
     or has_table_privilege('authenticated', 'public.task_assignees', 'select') then
    raise exception 'TA-12 FAILED: the table is readable by anon or authenticated';
  end if;
  raise notice 'TA-12 PASSED: grants';
end $$;

rollback;
