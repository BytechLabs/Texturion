-- [#689 C] Multiple assignees, flat.
--
-- task_assignees holds who is on a task: up to ten members, no lead. "Mine" is
-- being one of them and unassigned is nobody. tasks.assigned_user_id stays as a
-- MAINTAINED column, the first person added, so every reader written before
-- this (the public API, For You, exports, the map, old client builds) keeps
-- answering without change. The join table is the truth; the column is derived
-- from it by a trigger and nothing else decides it:
--
--   * task_assignees_sync_first recomputes the column after any insert or
--     delete on the table.
--   * tasks_mirror_assigned_user catches a direct write of the column by a
--     writer that does not know about crews and turns it into the same change
--     on the table: the old first assignee leaves, the new one joins.
--
-- Every function created here is revoked from public, anon and authenticated
-- before the service_role grant, because a function regains the hosted default
-- grants when it is created.

-- ---------------------------------------------------------------------------
-- 1. The table, and what already exists moves into it. The triggers come AFTER
--    the backfill so it writes no history, notices or calendar work.
-- ---------------------------------------------------------------------------
create table public.task_assignees (
  company_id uuid not null references public.companies(id) on delete restrict,
  task_id    uuid not null references public.tasks(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  added_at   timestamptz not null default clock_timestamp(),
  added_by   uuid references auth.users(id) on delete set null,
  primary key (task_id, user_id),
  -- Members only: the person has to be one of the workspace's members.
  foreign key (company_id, user_id)
    references public.company_members (company_id, user_id) on delete cascade
);

create index task_assignees_user_idx
  on public.task_assignees (company_id, user_id, task_id);

alter table public.task_assignees enable row level security;
revoke all on public.task_assignees from public, anon, authenticated;
grant select, insert, update, delete on public.task_assignees to service_role;

comment on table public.task_assignees is
  '#689 C: who is on a task, up to ten members, no lead. tasks.assigned_user_id is the first of them, kept by trigger. Cascades with the task, so the workspace purge reaches it through tasks.';

insert into public.task_assignees (company_id, task_id, user_id, added_at)
select t.company_id, t.id, t.assigned_user_id, t.created_at
  from public.tasks t
  join public.company_members cm
    on cm.company_id = t.company_id and cm.user_id = t.assigned_user_id
 where t.assigned_user_id is not null
on conflict do nothing;

-- A repeating job's template carries the whole crew.
alter table public.task_series
  add column assignee_ids uuid[] not null default '{}';

update public.task_series s
   set assignee_ids = array[s.assigned_user_id]
 where s.assigned_user_id is not null;

comment on column public.task_series.assignee_ids is
  '#689 C: everyone a new occurrence is given. assigned_user_id stays as the first of them.';

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
-- A list of people with the nulls and repeats taken out, in the order first seen.
create or replace function public.task_assignee_list(p_ids uuid[])
returns uuid[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(d.u order by d.first_at), '{}'::uuid[])
    from (select x.u, min(x.ord) as first_at
            from unnest(coalesce(p_ids, '{}'::uuid[])) with ordinality as x(u, ord)
           where x.u is not null
           group by x.u) d;
$$;

revoke execute on function public.task_assignee_list(uuid[])
  from public, anon, authenticated;
grant execute on function public.task_assignee_list(uuid[]) to service_role;

-- Make a task's crew exactly p_user_ids. Callers have already checked the
-- people are active members and that there are at most ten; the triggers on
-- task_assignees do the rest (first assignee, history, subscribers, calendar).
-- Takes the departures first so a full crew can swap a person. Returns who
-- was added and who was removed.
create or replace function public.task_set_assignees(
  p_task_id  uuid,
  p_user_ids uuid[],
  p_actor    uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_want    uuid[] := public.task_assignee_list(p_user_ids);
  v_added   uuid[];
  v_removed uuid[];
  v_base    timestamptz := clock_timestamp();
begin
  select t.company_id into v_company from public.tasks t where t.id = p_task_id;
  if v_company is null then
    return jsonb_build_object('added', '[]'::jsonb, 'removed', '[]'::jsonb);
  end if;

  with gone as (
    delete from public.task_assignees a
     where a.task_id = p_task_id and a.user_id <> all (v_want)
    returning a.user_id)
  select coalesce(array_agg(g.user_id), '{}'::uuid[]) into v_removed from gone g;

  with fresh as (
    insert into public.task_assignees (company_id, task_id, user_id, added_at, added_by)
    select v_company, p_task_id, w.u, v_base + w.ord * interval '1 microsecond', p_actor
      from unnest(v_want) with ordinality as w(u, ord)
     where not exists (select 1 from public.task_assignees a
                        where a.task_id = p_task_id and a.user_id = w.u)
    returning user_id)
  select coalesce(array_agg(f.user_id), '{}'::uuid[]) into v_added from fresh f;

  return jsonb_build_object('added', to_jsonb(v_added), 'removed', to_jsonb(v_removed));
end $$;

revoke execute on function public.task_set_assignees(uuid, uuid[], uuid)
  from public, anon, authenticated;
grant execute on function public.task_set_assignees(uuid, uuid[], uuid)
  to service_role;

-- The source conversation's timeline line for a change of crew. One person
-- replaced by one reads as before ("from A to B"); anything else is one line
-- per person.
create or replace function public.task_assignment_events(
  p_company_id      uuid,
  p_task_id         uuid,
  p_conversation_id uuid,
  p_actor           uuid,
  p_added           uuid[],
  p_removed         uuid[]
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if cardinality(p_added) = 1 and cardinality(p_removed) = 1 then
    insert into public.conversation_events
      (company_id, conversation_id, actor_user_id, type, payload)
    values
      (p_company_id, p_conversation_id, p_actor, 'task_assigned',
       jsonb_build_object('task_id', p_task_id,
                          'from_user_id', p_removed[1], 'to_user_id', p_added[1]));
    return;
  end if;
  foreach v_user in array p_added loop
    insert into public.conversation_events
      (company_id, conversation_id, actor_user_id, type, payload)
    values
      (p_company_id, p_conversation_id, p_actor, 'task_assigned',
       jsonb_build_object('task_id', p_task_id,
                          'from_user_id', null, 'to_user_id', v_user));
  end loop;
  foreach v_user in array p_removed loop
    insert into public.conversation_events
      (company_id, conversation_id, actor_user_id, type, payload)
    values
      (p_company_id, p_conversation_id, p_actor, 'task_assigned',
       jsonb_build_object('task_id', p_task_id,
                          'from_user_id', v_user, 'to_user_id', null));
  end loop;
end $$;

revoke execute on function public.task_assignment_events(uuid, uuid, uuid, uuid, uuid[], uuid[])
  from public, anon, authenticated;
grant execute on function public.task_assignment_events(uuid, uuid, uuid, uuid, uuid[], uuid[])
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. Triggers on task_assignees
-- ---------------------------------------------------------------------------
-- At most ten. The RPCs check first and answer too_many; this is the backstop
-- for any other writer.
create or replace function public.task_assignees_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.task_assignees a where a.task_id = new.task_id) >= 10 then
    raise exception 'a task holds at most 10 assignees'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function public.task_assignees_cap() from public, anon, authenticated;

create trigger task_assignees_cap
  before insert on public.task_assignees
  for each row execute function public.task_assignees_cap();

-- tasks.assigned_user_id is the first assignee. The UPDATE is unconditional on
-- purpose: it fires the realtime broadcast, so other screens see a crew change
-- that did not move the first person.
create or replace function public.task_assignees_sync_first()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task  uuid := case when tg_op = 'INSERT' then new.task_id else old.task_id end;
  v_first uuid;
  v_prior text := coalesce(current_setting('loonext.assignee_sync', true), '');
begin
  select a.user_id into v_first
    from public.task_assignees a
   where a.task_id = v_task
   order by a.added_at, a.user_id
   limit 1;
  perform set_config('loonext.assignee_sync', 'on', true);
  update public.tasks set assigned_user_id = v_first where id = v_task;
  perform set_config('loonext.assignee_sync', v_prior, true);
  return null;
end $$;

revoke all on function public.task_assignees_sync_first() from public, anon, authenticated;

create trigger task_assignees_sync_first
  after insert or delete on public.task_assignees
  for each row execute function public.task_assignees_sync_first();

-- One history line per person added or removed. Creating the task with its
-- crew is already the "created" line, so that path sets the quiet flag. A task
-- that is being deleted for good has no history left to write to.
create or replace function public.task_assignees_record_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.task_assignees := case when tg_op = 'INSERT' then new else old end;
begin
  if coalesce(current_setting('loonext.task_assignees_quiet', true), '') = 'on' then
    return null;
  end if;
  if tg_op = 'DELETE'
     and not exists (select 1 from public.tasks t where t.id = v_row.task_id) then
    return null;
  end if;
  insert into public.task_events
    (company_id, task_id, actor_user_id, kind, from_value, to_value)
  values
    (v_row.company_id, v_row.task_id,
     public.task_event_actor(case when tg_op = 'INSERT' then v_row.added_by end),
     case when tg_op = 'INSERT' then 'assignee_added' else 'assignee_removed' end,
     case when tg_op = 'DELETE' then to_jsonb(v_row.user_id) end,
     case when tg_op = 'INSERT' then to_jsonb(v_row.user_id) end);
  return null;
end $$;

revoke all on function public.task_assignees_record_event() from public, anon, authenticated;

create trigger task_assignees_event
  after insert or delete on public.task_assignees
  for each row execute function public.task_assignees_record_event();

-- A person put on a task follows it (an assignment lifts an earlier unfollow).
-- The due and overdue pushes are stamped once per task, so adding somebody
-- re-arms both: the new person gets theirs, and a person who already had one
-- may get a second if the window is still open.
create or replace function public.task_assignees_on_add()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.task_subscribe(new.company_id, new.task_id, new.user_id, 'assignee', true);
  update public.tasks
     set due_notified_at = null, overdue_notified_at = null
   where id = new.task_id
     and (due_notified_at is not null or overdue_notified_at is not null);
  return null;
end $$;

revoke all on function public.task_assignees_on_add() from public, anon, authenticated;

create trigger task_assignees_on_add
  after insert on public.task_assignees
  for each row execute function public.task_assignees_on_add();

-- Each assignee with a connected calendar gets the event; a person taken off
-- loses theirs. The decision is the one calendar_enqueue_task_sync already
-- makes per connection.
create or replace function public.task_assignees_calendar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
begin
  if coalesce(current_setting('loonext.calendar_provider_apply', true), '') = 'on' then
    return null;
  end if;
  select * into v_task from public.tasks t
   where t.id = case when tg_op = 'INSERT' then new.task_id else old.task_id end;
  if found then
    perform public.calendar_enqueue_task_sync(v_task);
  end if;
  return null;
end $$;

revoke all on function public.task_assignees_calendar() from public, anon, authenticated;

create trigger task_assignees_calendar
  after insert or delete on public.task_assignees
  for each row execute function public.task_assignees_calendar();

-- ---------------------------------------------------------------------------
-- 4. A direct write of tasks.assigned_user_id by a writer that does not know
--    about the crew: the old first assignee leaves and the new one joins.
-- ---------------------------------------------------------------------------
create or replace function public.tasks_mirror_assigned_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('loonext.assignee_sync', true), '') = 'on' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.assigned_user_id is not null then
    delete from public.task_assignees a
     where a.task_id = new.id and a.user_id = old.assigned_user_id;
  end if;
  if new.assigned_user_id is not null then
    insert into public.task_assignees (company_id, task_id, user_id, added_by)
    values (new.company_id, new.id, new.assigned_user_id, public.task_event_actor(null))
    on conflict do nothing;
  end if;
  return null;
end $$;

revoke all on function public.tasks_mirror_assigned_user() from public, anon, authenticated;

create trigger tasks_mirror_assigned_user_insert
  after insert on public.tasks
  for each row when (new.assigned_user_id is not null)
  execute function public.tasks_mirror_assigned_user();

create trigger tasks_mirror_assigned_user_update
  after update of assigned_user_id on public.tasks
  for each row when (old.assigned_user_id is distinct from new.assigned_user_id)
  execute function public.tasks_mirror_assigned_user();

-- The creator follows the task (insert only). Assignees follow through
-- task_assignees_on_add, so the old assign trigger goes.
drop trigger task_subscribers_on_task_assign on public.tasks;

create or replace function public.task_subscribers_on_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.task_subscribe(
    new.company_id, new.id, new.created_by_user_id, 'creator', false);
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 5. History: two new kinds. The old 'assignee' kind stays readable.
-- ---------------------------------------------------------------------------
alter table public.task_events drop constraint task_events_kind_check;
alter table public.task_events add constraint task_events_kind_check
  check (kind in (
    'created', 'title', 'description', 'address', 'assignee', 'due',
    'reminders', 'confirmation', 'done', 'reopened', 'deleted',
    'priority', 'label_added', 'label_removed', 'repeat',
    'assignee_added', 'assignee_removed'));

-- task_events_record_task_change, from 20261111090000: the assignee block is
-- gone, because task_assignees records each person now.
create or replace function public.task_events_record_task_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.task_events
      (company_id, task_id, actor_user_id, kind, to_value)
    values
      (new.company_id, new.id,
       coalesce(new.created_by_user_id, public.task_event_actor(null)),
       'created', to_jsonb(new.title));
    return null;
  end if;

  if new.title is distinct from old.title then
    insert into public.task_events
      (company_id, task_id, actor_user_id, kind, from_value, to_value)
    values
      (new.company_id, new.id, public.task_event_actor(null), 'title',
       to_jsonb(old.title), to_jsonb(new.title));
  end if;

  if new.description is distinct from old.description then
    insert into public.task_events
      (company_id, task_id, actor_user_id, kind, from_value, to_value)
    values
      (new.company_id, new.id, public.task_event_actor(null), 'description',
       to_jsonb(old.description), to_jsonb(new.description));
  end if;

  if new.addr_street      is distinct from old.addr_street
     or new.addr_unit        is distinct from old.addr_unit
     or new.addr_city        is distinct from old.addr_city
     or new.addr_state       is distinct from old.addr_state
     or new.addr_postal_code is distinct from old.addr_postal_code
     or new.addr_country     is distinct from old.addr_country then
    insert into public.task_events
      (company_id, task_id, actor_user_id, kind, from_value, to_value)
    values
      (new.company_id, new.id, public.task_event_actor(null), 'address',
       nullif(jsonb_strip_nulls(jsonb_build_object(
         'street', old.addr_street, 'unit', old.addr_unit,
         'city', old.addr_city, 'state', old.addr_state,
         'postal_code', old.addr_postal_code, 'country', old.addr_country)),
         '{}'::jsonb),
       nullif(jsonb_strip_nulls(jsonb_build_object(
         'street', new.addr_street, 'unit', new.addr_unit,
         'city', new.addr_city, 'state', new.addr_state,
         'postal_code', new.addr_postal_code, 'country', new.addr_country)),
         '{}'::jsonb));
  end if;

  if new.due_at is distinct from old.due_at then
    insert into public.task_events
      (company_id, task_id, actor_user_id, kind, from_value, to_value)
    values
      (new.company_id, new.id, public.task_event_actor(null), 'due',
       to_jsonb(old.due_at), to_jsonb(new.due_at));
  end if;

  if new.priority is distinct from old.priority then
    insert into public.task_events
      (company_id, task_id, actor_user_id, kind, from_value, to_value)
    values
      (new.company_id, new.id, public.task_event_actor(null), 'priority',
       to_jsonb(old.priority), to_jsonb(new.priority));
  end if;

  if new.reminders_off is distinct from old.reminders_off then
    insert into public.task_events
      (company_id, task_id, actor_user_id, kind, from_value, to_value)
    values
      (new.company_id, new.id, public.task_event_actor(null), 'reminders',
       to_jsonb(old.reminders_off), to_jsonb(new.reminders_off));
  end if;

  if new.confirmed_at is distinct from old.confirmed_at then
    insert into public.task_events
      (company_id, task_id, actor_user_id, kind, from_value, to_value)
    values
      (new.company_id, new.id, public.task_event_actor(null),
       'confirmation', to_jsonb(old.confirmed_at), to_jsonb(new.confirmed_at));
  end if;

  -- A task with a message is done when its MESSAGE is (messages trigger);
  -- tasks.done_at is only ever set on a task without one (tasks_one_done_owner).
  if new.done_at is distinct from old.done_at then
    insert into public.task_events
      (company_id, task_id, actor_user_id, kind, from_value, to_value)
    values
      (new.company_id, new.id,
       public.task_event_actor(case when new.done_at is not null
                                    then new.done_by_user_id end),
       case when new.done_at is not null then 'done' else 'reopened' end,
       to_jsonb(old.done_at), to_jsonb(new.done_at));
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    insert into public.task_events
      (company_id, task_id, actor_user_id, kind)
    values
      (new.company_id, new.id, public.task_event_actor(null), 'deleted');
  end if;

  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 6. set_task_assignees, and assign_task as its one-person shorthand
-- ---------------------------------------------------------------------------
create or replace function public.set_task_assignees(
  p_company_id    uuid,
  p_task_id       uuid,
  p_assignee_ids  uuid[],
  p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task    public.tasks%rowtype;
  v_want    uuid[] := public.task_assignee_list(p_assignee_ids);
  v_have    uuid[];
  v_result  jsonb;
  v_added   uuid[];
  v_removed uuid[];
begin
  perform set_config('loonext.task_actor', coalesce(p_actor_user_id::text, ''), true);
  select * into v_task
    from public.tasks t
   where t.company_id = p_company_id
     and t.id = p_task_id
     and t.deleted_at is null
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found', 'task', null);
  end if;

  if cardinality(v_want) > 10 then
    return jsonb_build_object('outcome', 'too_many', 'task', null);
  end if;

  select coalesce(array_agg(a.user_id), '{}'::uuid[]) into v_have
    from public.task_assignees a where a.task_id = v_task.id;
  if v_want <@ v_have and v_have <@ v_want then
    return jsonb_build_object('outcome', 'unchanged', 'task', to_jsonb(v_task),
                              'added', '[]'::jsonb, 'removed', '[]'::jsonb);
  end if;

  if exists (
    select 1 from unnest(v_want) u
     where not exists (select 1 from public.company_members cm where cm.company_id = p_company_id and cm.user_id = u and cm.deactivated_at is null)) then
    return jsonb_build_object('outcome', 'not_member', 'task', null);
  end if;

  v_result := public.task_set_assignees(v_task.id, v_want, p_actor_user_id);
  v_added := array(select jsonb_array_elements_text(v_result->'added')::uuid);
  v_removed := array(select jsonb_array_elements_text(v_result->'removed')::uuid);

  perform public.task_assignment_events(
    p_company_id, v_task.id, v_task.conversation_id, p_actor_user_id,
    v_added, v_removed);

  select * into v_task from public.tasks t where t.id = v_task.id;
  return jsonb_build_object('outcome', 'updated', 'task', to_jsonb(v_task),
                            'added', v_result->'added', 'removed', v_result->'removed');
end $$;

revoke execute on function public.set_task_assignees(uuid, uuid, uuid[], uuid)
  from public, anon, authenticated;
grant execute on function public.set_task_assignees(uuid, uuid, uuid[], uuid)
  to service_role;

-- The one-person shorthand: exactly this person, or nobody for null.
create or replace function public.assign_task(
  p_company_id       uuid,
  p_task_id          uuid,
  p_assigned_user_id uuid,
  p_actor_user_id    uuid
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.set_task_assignees(
    p_company_id, p_task_id,
    case when p_assigned_user_id is null then '{}'::uuid[]
         else array[p_assigned_user_id] end,
    p_actor_user_id);
$$;

-- ---------------------------------------------------------------------------
-- 7. create_task: a crew. Copied from 20261111090000; the changes are
--    p_assignee_ids, the checks on it and the insert.
-- ---------------------------------------------------------------------------
drop function public.create_task(
  uuid, uuid, text, text, uuid, timestamptz, uuid,
  text, text, text, text, text, text, text, uuid, uuid, uuid, text);

create or replace function public.create_task(
  p_company_id       uuid,
  p_message_id       uuid,
  p_title            text,
  p_description      text,
  p_assigned_user_id uuid,
  p_due_at           timestamptz,
  p_actor_user_id    uuid,
  p_addr_street      text default null,
  p_addr_unit        text default null,
  p_addr_city        text default null,
  p_addr_state       text default null,
  p_addr_postal_code text default null,
  p_addr_country     text default null,
  p_addr_provenance  text default null,
  p_call_id          uuid default null,
  p_contact_id       uuid default null,
  p_conversation_id  uuid default null,
  p_priority         text default 'normal',
  -- #689 C: the whole crew. When given it wins over p_assigned_user_id, which
  -- stays as the one-person shorthand.
  p_assignee_ids     uuid[] default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation_id uuid;
  v_contact_id      uuid;
  v_body            text;
  v_direction       text;
  v_title           text;
  v_has_address     boolean;
  v_provenance      text;
  v_task            public.tasks%rowtype;
  v_call            record;
  v_standalone      boolean := p_message_id is null and p_call_id is null;
  v_assignees       uuid[];
begin
  if coalesce(p_priority, 'normal') not in ('none', 'low', 'normal', 'high', 'urgent') then
    return jsonb_build_object('outcome', 'bad_priority', 'task', null);
  end if;

  -- At most one source: a message, a call, or none (a standalone task).
  if p_message_id is not null and p_call_id is not null then
    return jsonb_build_object('outcome', 'no_source', 'task', null);
  end if;

  -- A contact or conversation link belongs to a standalone task only; a message
  -- or call task already has its conversation.
  if not v_standalone
     and (p_contact_id is not null or p_conversation_id is not null) then
    return jsonb_build_object('outcome', 'bad_link', 'task', null);
  end if;

  if p_message_id is not null then
    select m.conversation_id, m.body, m.direction
      into v_conversation_id, v_body, v_direction
      from public.messages m
     where m.company_id = p_company_id
       and m.id = p_message_id;
    if not found then
      return jsonb_build_object('outcome', 'no_message', 'task', null);
    end if;
  elsif p_call_id is not null then
    select k.conversation_id, k.outcome,
           coalesce(nullif(k.caller_name, ''), nullif(ct.name, ''), k.caller_e164) as who
      into v_call
      from public.calls k
      left join public.contacts ct on ct.id = k.contact_id
     where k.company_id = p_company_id
       and k.id = p_call_id;
    if not found then
      return jsonb_build_object('outcome', 'no_call', 'task', null);
    end if;
    if v_call.outcome is distinct from 'answered' then
      return jsonb_build_object('outcome', 'call_not_answered', 'task', null);
    end if;
    if v_call.conversation_id is null then
      return jsonb_build_object('outcome', 'call_no_conversation', 'task', null);
    end if;
    v_conversation_id := v_call.conversation_id;
    v_body := 'Call from ' || coalesce(v_call.who, 'unknown caller');
  else
    -- Standalone: only the title is required. A conversation, when given, must
    -- be this company's and fixes the contact; a contact alone must be live.
    if nullif(btrim(coalesce(p_title, '')), '') is null then
      return jsonb_build_object('outcome', 'title_required', 'task', null);
    end if;
    if p_conversation_id is not null then
      select c.id, c.contact_id
        into v_conversation_id, v_contact_id
        from public.conversations c
       where c.company_id = p_company_id
         and c.id = p_conversation_id;
      if not found then
        return jsonb_build_object('outcome', 'no_conversation', 'task', null);
      end if;
      if p_contact_id is not null and p_contact_id is distinct from v_contact_id then
        return jsonb_build_object('outcome', 'contact_mismatch', 'task', null);
      end if;
    elsif p_contact_id is not null then
      perform 1
        from public.contacts ct
       where ct.company_id = p_company_id
         and ct.id = p_contact_id
         and ct.deleted_at is null;
      if not found then
        return jsonb_build_object('outcome', 'no_contact', 'task', null);
      end if;
      v_contact_id := p_contact_id;
    end if;
  end if;

  -- Every assignee must be an active member of the company (validation_failed),
  -- and a task holds at most ten.
  v_assignees := public.task_assignee_list(
    case when p_assignee_ids is not null then p_assignee_ids
         when p_assigned_user_id is not null then array[p_assigned_user_id]
         else '{}'::uuid[] end);
  if cardinality(v_assignees) > 10 then
    return jsonb_build_object('outcome', 'too_many', 'task', null);
  end if;
  if exists (
    select 1 from unnest(v_assignees) u
     where not exists (select 1 from public.company_members cm where cm.company_id = p_company_id and cm.user_id = u and cm.deactivated_at is null)) then
    return jsonb_build_object('outcome', 'not_member', 'task', null);
  end if;

  v_title := coalesce(
    nullif(btrim(coalesce(p_title, '')), ''),
    left(nullif(trim(regexp_replace(coalesce(v_body, ''), '\s+', ' ', 'g')), ''), 500),
    'Task');

  v_has_address := coalesce(
    p_addr_street, p_addr_unit, p_addr_city, p_addr_state,
    p_addr_postal_code, p_addr_country) is not null;
  v_provenance := case when v_has_address then p_addr_provenance else null end;

  begin
    insert into public.tasks
      (company_id, message_id, source_call_id, conversation_id, contact_id,
       title, description, due_at, created_by_user_id,
       addr_street, addr_unit, addr_city, addr_state, addr_postal_code,
       addr_country, addr_provenance, reminders_off, priority)
    values
      (p_company_id, p_message_id, p_call_id, v_conversation_id, v_contact_id,
       v_title, coalesce(p_description, ''), p_due_at,
       p_actor_user_id,
       p_addr_street, p_addr_unit, p_addr_city, p_addr_state,
       p_addr_postal_code, p_addr_country, v_provenance,
       -- No thread to text the reminder into.
       v_conversation_id is null,
       coalesce(p_priority, 'normal'))
    returning * into v_task;
  exception when unique_violation then
    -- A second live promotion of the same message or call.
    return jsonb_build_object('outcome', 'conflict', 'task', null);
  end;

  -- #689 C: the crew goes into task_assignees, which keeps tasks.assigned_user_id
  -- as the first of them. Quiet, because creating the task already says so.
  if cardinality(v_assignees) > 0 then
    perform set_config('loonext.task_assignees_quiet', 'on', true);
    perform public.task_set_assignees(v_task.id, v_assignees, p_actor_user_id);
    perform set_config('loonext.task_assignees_quiet', '', true);
    select * into v_task from public.tasks t where t.id = v_task.id;
  end if;

  -- attach_fixes [#2]: link the SOURCE note back to the new task.
  if v_direction = 'note' then
    update public.messages
       set task_id = v_task.id
     where id = p_message_id
       and task_id is null;
  end if;

  -- T2.1 audit: one task_created row on the task's conversation, same txn. A
  -- standalone task with no conversation has no thread to write to.
  if v_conversation_id is not null then
    insert into public.conversation_events
      (company_id, conversation_id, actor_user_id, type, payload)
    values
      (p_company_id, v_conversation_id, p_actor_user_id, 'task_created',
       case when p_message_id is not null
            then jsonb_build_object('task_id', v_task.id, 'message_id', p_message_id)
            when p_call_id is not null
            then jsonb_build_object('task_id', v_task.id, 'call_id', p_call_id)
            else jsonb_build_object('task_id', v_task.id)
       end);
  end if;

  return jsonb_build_object('outcome', 'created', 'task', to_jsonb(v_task));
end $$;

revoke execute on function public.create_task(
  uuid, uuid, text, text, uuid, timestamptz, uuid,
  text, text, text, text, text, text, text, uuid, uuid, uuid, text, uuid[])
  from public, anon, authenticated;
grant execute on function public.create_task(
  uuid, uuid, text, text, uuid, timestamptz, uuid,
  text, text, text, text, text, text, text, uuid, uuid, uuid, text, uuid[])
  to service_role;

-- ---------------------------------------------------------------------------
-- 8. api_bulk_tasks: assign adds. Copied from 20261111090000; the changes are
--    p_target_user_ids and the assign branch.
-- ---------------------------------------------------------------------------
drop function public.api_bulk_tasks(uuid, uuid, text, uuid[], uuid, uuid[], text, uuid);

create or replace function public.api_bulk_tasks(
  p_company_id     uuid,
  p_user_id        uuid,
  p_action         text,
  p_ids            uuid[],
  -- The assign target. NULL is legitimate (unassign) and is why the action has
  -- to be named separately from the value.
  p_target_user_id uuid    default null,
  -- #106: numbers this actor may not see. Their tasks are refused by id rather
  -- than silently skipped: a caller that asked about a task it cannot see gets
  -- told, and the count it renders stays true.
  p_hidden_number_ids uuid[] default null,
  -- #693: set_priority's value, add_label / remove_label's tag.
  p_priority       text    default null,
  p_tag_id         uuid    default null,
  -- #689 C: the people to add. Wins over p_target_user_id when non-empty.
  p_target_user_ids uuid[]  default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap      int := public.api_bulk_task_cap();
  v_matched  int := 0;
  v_selected uuid[];
  v_applied  jsonb := '[]'::jsonb;
  v_failed   jsonb := '[]'::jsonb;
  v_now      timestamptz := now();
  v_row      record;
  v_result   jsonb;
  v_task     public.tasks;
  v_targets  uuid[];
  v_want     uuid[];
begin
  -- #689 E: who is making this change, for the task_events triggers.
  perform set_config('loonext.task_actor', coalesce(p_user_id::text, ''), true);
  if p_action is null or p_action not in (
       'mark_done', 'mark_undone', 'assign', 'delete',
       'set_priority', 'add_label', 'remove_label') then
    return jsonb_build_object('error', 'validation_failed');
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    return jsonb_build_object('error', 'validation_failed');
  end if;
  if p_action = 'set_priority'
     and (p_priority is null
          or p_priority not in ('none', 'low', 'normal', 'high', 'urgent')) then
    return jsonb_build_object('error', 'validation_failed');
  end if;
  if p_action in ('add_label', 'remove_label') then
    if p_tag_id is null then
      return jsonb_build_object('error', 'validation_failed');
    end if;
    perform 1 from public.tags g
     where g.id = p_tag_id and g.company_id = p_company_id;
    if not found then
      return jsonb_build_object('error', 'tag_not_found');
    end if;
  end if;

  -- NOTHING HERE CAN SEND A MESSAGE, and the enum above is what guarantees it.
  -- #275 established that rule at the route AND in SQL; a new bulk surface that
  -- only enforced it in TypeScript would be one route handler away from
  -- texting a customer list.

  -- Resolve ONCE, and intersect the caller's ids with what they may actually
  -- see. An id the caller was not entitled to comes back as `failed`, never
  -- silently applied and never silently dropped.
  select count(*)::int,
         (array_agg(t.id order by t.id))[1:v_cap]
    into v_matched, v_selected
    from public.tasks t
    left join public.conversations c on c.id = t.conversation_id
   where t.company_id = p_company_id
     and t.deleted_at is null
     and t.id = any(p_ids)
     and (
       p_hidden_number_ids is null
       or array_length(p_hidden_number_ids, 1) is null
       -- A task whose conversation has no number cannot be hidden BY number,
       -- so it stays visible. `tasks.conversation_id` is nullable.
       or c.phone_number_id is null
       or not (c.phone_number_id = any(p_hidden_number_ids))
     );

  -- Everything asked for that did not survive the intersection. Reported rather
  -- than omitted: a caller that selected 40 and sees 38 applied deserves to
  -- know which two and why, and "not_found" covers deleted, wrong-company and
  -- hidden-number alike: telling them apart would leak which of the three it
  -- was.
  select coalesce(jsonb_agg(jsonb_build_object('id', missing, 'reason', 'not_found')), '[]'::jsonb)
    into v_failed
    from unnest(p_ids) as missing
   where not (missing = any(coalesce(v_selected, '{}'::uuid[])));

  if v_selected is null or array_length(v_selected, 1) is null then
    return jsonb_build_object(
      'action', p_action, 'matched', v_matched, 'applied', '[]'::jsonb,
      'failed', v_failed, 'capped', false);
  end if;

  if p_action in ('mark_done', 'mark_undone') then
    -- The flip and its event, per task, in this transaction. `previous` carries
    -- the prior done_at so an undo restores the exact timestamp rather than
    -- guessing at "not done".
    for v_row in
      select t.id as task_id, t.message_id, t.conversation_id,
             coalesce(m.done_at, t.done_at) as done_at
        from public.tasks t
        left join public.messages m on m.id = t.message_id
       where t.id = any(v_selected)
         and ((p_action = 'mark_done' and coalesce(m.done_at, t.done_at) is null)
              or (p_action = 'mark_undone' and coalesce(m.done_at, t.done_at) is not null))
       for update of t
    loop
      if v_row.message_id is not null then
        -- D17: the message owns done. set_message_done locks the message, is
        -- idempotent, and writes the D22 event in this same transaction, so a
        -- concurrent toggle that already flipped it applies nothing here.
        v_result := public.set_message_done(
          p_company_id, v_row.message_id, p_action = 'mark_done', p_user_id);
        if v_result->>'outcome' is distinct from 'updated' then
          continue;
        end if;
      else
        -- D64: a call-anchored task owns its own done state. No conversation
        -- event: message_done is about a message, and this task has none.
        update public.tasks
           set done_at = case when p_action = 'mark_done' then v_now end,
               done_by_user_id = case when p_action = 'mark_done' then p_user_id end
         where id = v_row.task_id;
      end if;

      v_applied := v_applied || jsonb_build_object(
        'id', v_row.task_id,
        'previous', jsonb_build_object('done_at', v_row.done_at));
    end loop;

  elsif p_action = 'assign' then
    -- #689 C: assign ADDS. Each target joins every selected task's crew and
    -- nobody already on it is removed, because a bulk action that replaced the
    -- crew would silently drop people from jobs the caller never looked at. No
    -- target at all is the one way to clear: it takes everybody off.
    v_targets := public.task_assignee_list(
      case when p_target_user_ids is not null and cardinality(p_target_user_ids) > 0
             then p_target_user_ids
           when p_target_user_id is not null then array[p_target_user_id]
           else '{}'::uuid[] end);
    if cardinality(v_targets) > 10 then
      return jsonb_build_object('error', 'validation_failed');
    end if;

    -- A target who is not an active member is refused for the whole call
    -- rather than per row: it is one wrong id in the request, and applying it
    -- to some tasks and not others would leave a half-assigned list nobody
    -- asked for.
    if exists (
      select 1 from unnest(v_targets) u
       where not exists (select 1 from public.company_members cm where cm.company_id = p_company_id and cm.user_id = u and cm.deactivated_at is null)) then
      return jsonb_build_object('error', 'not_member');
    end if;

    for v_row in
      select t.id, t.conversation_id,
             coalesce((select array_agg(a.user_id order by a.added_at, a.user_id)
                         from public.task_assignees a where a.task_id = t.id),
                      '{}'::uuid[]) as had
        from public.tasks t
       where t.id = any(v_selected)
         and case when cardinality(v_targets) = 0
                  then exists (select 1 from public.task_assignees a
                                where a.task_id = t.id)
                  else exists (select 1 from unnest(v_targets) u
                                where not exists (
                                  select 1 from public.task_assignees a
                                   where a.task_id = t.id and a.user_id = u))
             end
       for update
    loop
      v_want := case when cardinality(v_targets) = 0 then '{}'::uuid[]
                     else v_row.had || array(
                       select u from unnest(v_targets) u where u <> all (v_row.had)) end;
      if cardinality(v_want) > 10 then
        v_failed := v_failed || jsonb_build_object(
          'id', v_row.id, 'reason', 'too_many_assignees');
        continue;
      end if;

      v_result := public.task_set_assignees(v_row.id, v_want, p_user_id);
      perform public.task_assignment_events(
        p_company_id, v_row.id, v_row.conversation_id, p_user_id,
        array(select jsonb_array_elements_text(v_result->'added')::uuid),
        array(select jsonb_array_elements_text(v_result->'removed')::uuid));

      v_applied := v_applied || jsonb_build_object(
        'id', v_row.id,
        'previous', jsonb_build_object(
          'assigned_user_id', v_row.had[1],
          'assignee_ids', to_jsonb(v_row.had)));
    end loop;

  elsif p_action = 'set_priority' then
    for v_row in
      select t.id, t.priority
        from public.tasks t
       where t.id = any(v_selected)
         and t.priority is distinct from p_priority
       for update
    loop
      update public.tasks set priority = p_priority where id = v_row.id;
      v_applied := v_applied || jsonb_build_object(
        'id', v_row.id,
        'previous', jsonb_build_object('priority', v_row.priority));
    end loop;

  elsif p_action = 'add_label' then
    for v_row in
      select t.id
        from public.tasks t
       where t.id = any(v_selected)
         and not exists (select 1 from public.task_tags k
                          where k.task_id = t.id and k.tag_id = p_tag_id)
       for update
    loop
      insert into public.task_tags (company_id, task_id, tag_id)
      values (p_company_id, v_row.id, p_tag_id)
      on conflict do nothing;
      v_applied := v_applied || jsonb_build_object(
        'id', v_row.id,
        'previous', jsonb_build_object('tag_id', p_tag_id, 'had', false));
    end loop;

  elsif p_action = 'remove_label' then
    for v_row in
      select t.id
        from public.tasks t
       where t.id = any(v_selected)
         and exists (select 1 from public.task_tags k
                      where k.task_id = t.id and k.tag_id = p_tag_id)
       for update
    loop
      delete from public.task_tags
       where task_id = v_row.id and tag_id = p_tag_id;
      v_applied := v_applied || jsonb_build_object(
        'id', v_row.id,
        'previous', jsonb_build_object('tag_id', p_tag_id, 'had', true));
    end loop;

  else -- delete
    -- Soft, and deliberately NOT touching messages.done_at: the same rule the
    -- single-row delete follows (T4). Deleting the task does not un-finish the
    -- work somebody did.
    for v_row in
      select t.id, t.conversation_id
        from public.tasks t
       where t.id = any(v_selected)
       for update
    loop
      update public.tasks set deleted_at = v_now where id = v_row.id
      returning * into v_task;

      insert into public.conversation_events
        (company_id, conversation_id, actor_user_id, type, payload)
      values
        (p_company_id, v_row.conversation_id, p_user_id, 'task_deleted',
         jsonb_build_object('task_id', v_row.id));

      -- #693: deleting an open occurrence skips it.
      perform public.task_series_on_skip(v_task);

      v_applied := v_applied || jsonb_build_object(
        'id', v_row.id, 'previous', jsonb_build_object('deleted_at', null));
    end loop;
  end if;

  return jsonb_build_object(
    'action',  p_action,
    'matched', v_matched,
    'applied', v_applied,
    'failed',  v_failed,
    'capped',  v_matched > v_cap);
end $$;

revoke execute on function public.api_bulk_tasks(
  uuid, uuid, text, uuid[], uuid, uuid[], text, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.api_bulk_tasks(
  uuid, uuid, text, uuid[], uuid, uuid[], text, uuid, uuid[])
  to service_role;

-- ---------------------------------------------------------------------------
-- 9. Leaving the workspace, repeats
-- ---------------------------------------------------------------------------
-- offboard_member, from 20261110100000: the open tasks part moves the member
-- off each crew.
create or replace function public.offboard_member(
  p_company_id  uuid,
  p_member_id   uuid,
  p_reassign_to uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_role    text;
  v_deactivated timestamptz;
  v_conversations int := 0;
  v_tasks int := 0;
  v_moved uuid[];
begin
  select m.user_id, m.role::text, m.deactivated_at
    into v_user_id, v_role, v_deactivated
    from public.company_members m
   where m.company_id = p_company_id and m.id = p_member_id
   for update;

  if v_user_id is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_role = 'owner' then
    return jsonb_build_object('outcome', 'owner');
  end if;

  -- A destination must be someone who will actually see the work: an ACTIVE
  -- member of this company, and not the person being removed.
  if p_reassign_to is not null then
    if p_reassign_to = v_user_id then
      return jsonb_build_object('outcome', 'bad_destination');
    end if;
    if not exists (
      select 1 from public.company_members m
       where m.company_id = p_company_id
         and m.user_id = p_reassign_to
         and m.deactivated_at is null
    ) then
      return jsonb_build_object('outcome', 'bad_destination');
    end if;
  end if;

  if v_deactivated is null then
    update public.company_members
       set deactivated_at = now()
     where company_id = p_company_id and id = p_member_id;
  end if;

  -- Open conversations. `closed_at is null` is the same "still live" test the
  -- inbox uses, so what moves is exactly what someone would still be working.
  update public.conversations
     set assigned_user_id = p_reassign_to
   where company_id = p_company_id
     and assigned_user_id = v_user_id
     and closed_at is null;
  get diagnostics v_conversations = row_count;

  -- Open tasks. Completion is the source message's done_at, or the task's own
  -- done_at when it has no message (D64), so a finished task is left exactly as
  -- it was.
  -- #689 C: the member leaves every open crew they are on, and the person
  -- taking over joins it. Others on the crew stay. Leaving first keeps a full
  -- crew of ten from refusing the hand-over.
  select coalesce(array_agg(t.id), '{}'::uuid[])
    into v_moved
    from public.tasks t
   where t.company_id = p_company_id
     and exists (select 1 from public.task_assignees a
                  where a.task_id = t.id and a.user_id = v_user_id)
     and t.deleted_at is null
     and coalesce(
       (select m.done_at from public.messages m where m.id = t.message_id),
       t.done_at
     ) is null;
  v_tasks := cardinality(v_moved);
  delete from public.task_assignees a
   where a.task_id = any (v_moved) and a.user_id = v_user_id;
  if p_reassign_to is not null then
    insert into public.task_assignees (company_id, task_id, user_id)
    select p_company_id, m, p_reassign_to from unnest(v_moved) m
    on conflict do nothing;
  end if;

  return jsonb_build_object(
    'outcome', case when v_deactivated is null then 'deactivated' else 'already' end,
    'user_id', v_user_id,
    'conversations', v_conversations,
    'tasks', v_tasks
  );
end $$;

-- task_series_spawn, from 20261111090000: an occurrence gets the series' crew.
create or replace function public.task_series_spawn(
  s    public.task_series,
  p_no int,
  p_on date,
  p_due timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignees uuid[];
  v_id       uuid;
  v_prior    text := coalesce(current_setting('loonext.task_tags_quiet', true), '');
begin
  -- A trashed customer or thread is not a place to put new work.
  if s.conversation_id is not null and exists (
       select 1 from public.conversations c
        where c.id = s.conversation_id and c.deleted_at is not null) then
    return null;
  end if;
  if s.contact_id is not null and exists (
       select 1 from public.contacts c
        where c.id = s.contact_id and c.deleted_at is not null) then
    return null;
  end if;

  -- #689 C: every assignee of the series who is still on the crew.
  select coalesce(array_agg(x.u order by x.ord), '{}'::uuid[])
    into v_assignees
    from unnest(s.assignee_ids) with ordinality as x(u, ord)
   where exists (select 1 from public.company_members cm where cm.company_id = s.company_id and cm.user_id = x.u and cm.deactivated_at is null);

  insert into public.tasks
    (company_id, conversation_id, contact_id, title, description,
     due_at, created_by_user_id, priority,
     addr_street, addr_unit, addr_city, addr_state, addr_postal_code,
     addr_country, addr_provenance,
     -- TODO(#693): the customer-side reminder text for a repeating job ("your
     -- furnace service is due, reply to book") is a separate opt-in toggle, off
     -- by default and bound by the opt-out rules. Until it exists no occurrence
     -- texts anyone.
     reminders_off,
     series_id, occurrence_no, occurrence_on)
  values
    (s.company_id, s.conversation_id, s.contact_id, s.title, s.description,
     p_due, s.created_by_user_id, s.priority,
     s.addr_street, s.addr_unit, s.addr_city, s.addr_state, s.addr_postal_code,
     s.addr_country, s.addr_provenance,
     true,
     s.id, p_no, p_on)
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    return null;
  end if;

  if cardinality(v_assignees) > 0 then
    perform set_config('loonext.task_assignees_quiet', 'on', true);
    perform public.task_set_assignees(v_id, v_assignees, s.created_by_user_id);
    perform set_config('loonext.task_assignees_quiet', '', true);
  end if;

  perform set_config('loonext.task_tags_quiet', 'on', true);
  insert into public.task_tags (company_id, task_id, tag_id)
  select s.company_id, v_id, g.id
    from public.tags g
   where g.company_id = s.company_id
     and g.id = any (s.label_ids)
  on conflict do nothing;
  perform set_config('loonext.task_tags_quiet', v_prior, true);

  return v_id;
end $$;

-- api_set_task_repeat, from 20261111090000: the series template keeps the crew.
create or replace function public.api_set_task_repeat(
  p_company_id    uuid,
  p_task_id       uuid,
  p_actor_user_id uuid,
  p_repeat        jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task   public.tasks;
  v_old    public.task_series;
  v_new    public.task_series;
  v_tz     text;
  v_anchor date;
  v_rule   jsonb;
  v_same   boolean;
  v_out    text := 'set';
begin
  perform set_config('loonext.task_actor', coalesce(p_actor_user_id::text, ''), true);
  select * into v_task
    from public.tasks t
   where t.company_id = p_company_id and t.id = p_task_id and t.deleted_at is null
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  select c.timezone into v_tz from public.companies c where c.id = p_company_id;
  v_tz := coalesce(v_tz, 'UTC');

  if v_task.series_id is not null then
    select * into v_old from public.task_series where id = v_task.series_id for update;
  end if;

  -- CLEAR: the repeat ends here. Later occurrences nobody has done are removed;
  -- finished ones stay as history; this task stops being an occurrence.
  if p_repeat is null or jsonb_typeof(p_repeat) = 'null' then
    if v_old.id is null then
      return jsonb_build_object('outcome', 'unchanged', 'task', to_jsonb(v_task));
    end if;
    perform public.task_series_stop(v_old.id);
    update public.tasks t
       set deleted_at = now()
     where t.series_id = v_old.id and t.id <> v_task.id
       and t.occurrence_no > v_task.occurrence_no
       and t.deleted_at is null and public.task_done_at(t) is null;
    update public.tasks
       set series_id = null, occurrence_no = null, occurrence_on = null
     where id = v_task.id
    returning * into v_task;
    insert into public.task_events
      (company_id, task_id, actor_user_id, kind, from_value, to_value)
    values
      (p_company_id, v_task.id, p_actor_user_id, 'repeat',
       public.task_series_summary(v_old), null);
    return jsonb_build_object('outcome', 'cleared', 'task', to_jsonb(v_task));
  end if;

  v_anchor := case
    when v_task.due_at is not null then (v_task.due_at at time zone v_tz)::date
    else (now() at time zone v_tz)::date end;
  v_rule := public.task_series_rule(p_repeat, v_anchor);
  if v_rule ? 'error' then
    return jsonb_build_object('outcome', 'invalid', 'reason', v_rule->>'error');
  end if;
  -- A schedule needs a date to start from.
  if v_rule->>'kind' = 'schedule' and v_task.due_at is null then
    return jsonb_build_object('outcome', 'needs_due');
  end if;
  if v_rule->>'ends_kind' = 'on'
     and (v_rule->>'ends_on')::date < v_anchor then
    return jsonb_build_object('outcome', 'invalid', 'reason', 'ends');
  end if;

  -- Same rule as the one it already has: only the end and the pause move, and
  -- the series keeps its occurrences.
  v_same := v_old.id is not null
    and v_old.kind = v_rule->>'kind'
    and v_old.unit = v_rule->>'unit'
    and v_old.every = (v_rule->>'every')::int
    and v_old.weekdays is not distinct from
        (select array_agg(d::smallint order by d::smallint)
           from jsonb_array_elements_text(
                  coalesce(nullif(v_rule->'weekdays', 'null'::jsonb), '[]'::jsonb)) d
          having count(*) > 0)
    and v_old.month_day is not distinct from (v_rule->>'month_day')::smallint
    and v_old.nth is not distinct from (v_rule->>'nth')::smallint
    and v_old.nth_weekday is not distinct from (v_rule->>'nth_weekday')::smallint;

  if v_same then
    update public.task_series
       set ends_kind = v_rule->>'ends_kind',
           ends_on = (v_rule->>'ends_on')::date,
           ends_after = (v_rule->>'ends_after')::int,
           paused = (v_rule->>'paused')::boolean,
           -- Resuming, or lengthening an end, reopens a series that had run out.
           stopped_at = case
             when ((v_rule->>'ends_kind') = 'never'
                   or ((v_rule->>'ends_kind') = 'on'
                       and (v_rule->>'ends_on')::date >= coalesce(tail_on, anchor_on))
                   or ((v_rule->>'ends_kind') = 'after'
                       and (v_rule->>'ends_after')::int > tail_no))
                  and stopped_at is not null
             then null else stopped_at end
     where id = v_old.id
    returning * into v_new;
    if v_new.kind = 'schedule' then
      perform public.task_series_materialize(v_new.id);
    elsif not v_new.paused and v_new.stopped_at is null then
      -- Resumed: if the newest occurrence was finished while it was paused,
      -- nothing made the next one.
      perform public.task_series_on_done(t)
         from public.tasks t
        where t.series_id = v_new.id and t.occurrence_no = v_new.tail_no
          and t.deleted_at is null;
    end if;
    if public.task_series_summary(v_old) is distinct from public.task_series_summary(v_new) then
      insert into public.task_events
        (company_id, task_id, actor_user_id, kind, from_value, to_value)
      values
        (p_company_id, v_task.id, p_actor_user_id, 'repeat',
         public.task_series_summary(v_old), public.task_series_summary(v_new));
    else
      v_out := 'unchanged';
    end if;
    select * into v_task from public.tasks where id = v_task.id;
    return jsonb_build_object('outcome', v_out, 'task', to_jsonb(v_task));
  end if;

  -- A new rule starts a new series at this task; the old one stops and its
  -- later, untouched occurrences are removed. (A new rule cannot reuse the old
  -- occurrence keys, and a history split at the change is the honest record.)
  if v_old.id is not null then
    perform public.task_series_stop(v_old.id);
    update public.tasks t
       set deleted_at = now()
     where t.series_id = v_old.id and t.id <> v_task.id
       and t.occurrence_no > v_task.occurrence_no
       and t.deleted_at is null and public.task_done_at(t) is null;
  end if;

  insert into public.task_series
    (company_id, kind, unit, every, weekdays, month_day, nth, nth_weekday,
     ends_kind, ends_on, ends_after, paused, time_zone, due_time, anchor_on,
     tail_no, tail_on,
     title, description, assigned_user_id, assignee_ids, priority,
     addr_street, addr_unit, addr_city, addr_state, addr_postal_code,
     addr_country, addr_provenance, contact_id, conversation_id, label_ids,
     created_by_user_id)
  values
    (p_company_id, v_rule->>'kind', v_rule->>'unit', (v_rule->>'every')::int,
     (select array_agg(d::smallint order by d::smallint)
        from jsonb_array_elements_text(
               coalesce(nullif(v_rule->'weekdays', 'null'::jsonb), '[]'::jsonb)) d
       having count(*) > 0),
     (v_rule->>'month_day')::smallint, (v_rule->>'nth')::smallint,
     (v_rule->>'nth_weekday')::smallint,
     v_rule->>'ends_kind', (v_rule->>'ends_on')::date,
     (v_rule->>'ends_after')::int, (v_rule->>'paused')::boolean, v_tz,
     case when v_task.due_at is not null
          then (v_task.due_at at time zone v_tz)::time else time '09:00' end,
     v_anchor, 1, v_anchor,
     v_task.title, v_task.description, v_task.assigned_user_id,
     coalesce((select array_agg(a.user_id order by a.added_at, a.user_id)
                 from public.task_assignees a where a.task_id = v_task.id), '{}'),
     v_task.priority,
     v_task.addr_street, v_task.addr_unit, v_task.addr_city, v_task.addr_state,
     v_task.addr_postal_code, v_task.addr_country, v_task.addr_provenance,
     coalesce(v_task.contact_id,
              (select c.contact_id from public.conversations c
                where c.id = v_task.conversation_id)),
     v_task.conversation_id,
     coalesce((select array_agg(g.tag_id)
                 from public.task_tags g where g.task_id = v_task.id), '{}'),
     coalesce(p_actor_user_id, v_task.created_by_user_id))
  returning * into v_new;

  update public.tasks
     set series_id = v_new.id, occurrence_no = 1,
         occurrence_on = case when v_new.kind = 'schedule' then v_anchor end
   where id = v_task.id
  returning * into v_task;

  insert into public.task_events
    (company_id, task_id, actor_user_id, kind, from_value, to_value)
  values
    (p_company_id, v_task.id, p_actor_user_id, 'repeat',
     case when v_old.id is not null then public.task_series_summary(v_old) end,
     public.task_series_summary(v_new));

  if v_new.kind = 'schedule' then
    perform public.task_series_materialize(v_new.id);
  elsif not v_new.paused and public.task_done_at(v_task) is not null then
    -- Repeat-after-done set on a job that is already done.
    perform public.task_series_on_done(v_task);
  end if;

  select * into v_task from public.tasks where id = v_task.id;
  return jsonb_build_object('outcome', 'set', 'task', to_jsonb(v_task));
end $$;

-- api_edit_task_series, from 20261111090000: "this and future" sets the crew.
create or replace function public.api_edit_task_series(
  p_company_id    uuid,
  p_task_id       uuid,
  p_actor_user_id uuid,
  p_changes       jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task   public.tasks;
  s        public.task_series;
  v_addr   jsonb := p_changes->'address';
  v_set_ad boolean := p_changes ? 'address';
  v_time   time;
  v_n      int;
  v_assignees uuid[];
  v_set_as boolean := p_changes ? 'assignee_ids' or p_changes ? 'assigned_user_id';
  v_later  uuid;
begin
  perform set_config('loonext.task_actor', coalesce(p_actor_user_id::text, ''), true);
  select * into v_task
    from public.tasks t
   where t.company_id = p_company_id and t.id = p_task_id and t.deleted_at is null
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_task.series_id is null then
    return jsonb_build_object('outcome', 'no_series');
  end if;
  select * into s from public.task_series where id = v_task.series_id for update;

  -- #689 C: the crew, as assignee_ids, or one person as assigned_user_id.
  if p_changes ? 'assignee_ids' then
    v_assignees := public.task_assignee_list(
      coalesce((select array_agg(x.e::uuid order by x.ord)
                  from jsonb_array_elements_text(
                    coalesce(nullif(p_changes->'assignee_ids', 'null'::jsonb), '[]'::jsonb))
                       with ordinality as x(e, ord)), '{}'::uuid[]));
  elsif p_changes ? 'assigned_user_id' then
    v_assignees := public.task_assignee_list(
      case when nullif(p_changes->>'assigned_user_id', '') is null then '{}'::uuid[]
           else array[(p_changes->>'assigned_user_id')::uuid] end);
  end if;
  if v_set_as then
    if cardinality(v_assignees) > 10 then
      return jsonb_build_object('outcome', 'too_many');
    end if;
    if exists (
      select 1 from unnest(v_assignees) u
       where not exists (select 1 from public.company_members cm where cm.company_id = p_company_id and cm.user_id = u and cm.deactivated_at is null)) then
      return jsonb_build_object('outcome', 'not_member');
    end if;
  end if;
  if p_changes ? 'priority'
     and (p_changes->>'priority') not in ('none', 'low', 'normal', 'high', 'urgent') then
    return jsonb_build_object('outcome', 'bad_priority');
  end if;
  -- The time of day, from either an instant (read in the series' own zone) or
  -- a bare 'HH:MM'.
  if nullif(p_changes->>'due_at', '') is not null then
    v_time := ((p_changes->>'due_at')::timestamptz at time zone s.time_zone)::time;
  elsif p_changes ? 'due_time' then
    begin
      v_time := (p_changes->>'due_time')::time;
    exception when others then
      return jsonb_build_object('outcome', 'invalid');
    end;
  end if;

  update public.task_series
     set title = case when p_changes ? 'title' then p_changes->>'title' else title end,
         description = case when p_changes ? 'description'
                            then coalesce(p_changes->>'description', '') else description end,
         assigned_user_id = case when v_set_as then v_assignees[1] else assigned_user_id end,
         assignee_ids = case when v_set_as then v_assignees else assignee_ids end,
         priority = case when p_changes ? 'priority' then p_changes->>'priority' else priority end,
         addr_street = case when v_set_ad then v_addr->>'street' else addr_street end,
         addr_unit = case when v_set_ad then v_addr->>'unit' else addr_unit end,
         addr_city = case when v_set_ad then v_addr->>'city' else addr_city end,
         addr_state = case when v_set_ad then v_addr->>'state' else addr_state end,
         addr_postal_code = case when v_set_ad then v_addr->>'postal_code' else addr_postal_code end,
         addr_country = case when v_set_ad then v_addr->>'country' else addr_country end,
         addr_provenance = case when v_set_ad then v_addr->>'provenance' else addr_provenance end,
         due_time = coalesce(v_time, due_time),
         label_ids = (
           select coalesce(array_agg(x), '{}')
             from (
               select distinct x
                 from unnest(
                   label_ids || coalesce(
                     (select array_agg(e::uuid)
                        from jsonb_array_elements_text(
                          coalesce(p_changes->'labels_add', '[]'::jsonb)) e), '{}')) x
                where x <> all (coalesce(
                     (select array_agg(e::uuid)
                        from jsonb_array_elements_text(
                          coalesce(p_changes->'labels_remove', '[]'::jsonb)) e), '{}'))
             ) q)
   where id = s.id
  returning * into s;

  with later as (
    select t.id from public.tasks t
     where t.series_id = s.id and t.occurrence_no > v_task.occurrence_no
       and t.deleted_at is null and public.task_done_at(t) is null
  )
  update public.tasks t
     set title = case when p_changes ? 'title' then p_changes->>'title' else t.title end,
         description = case when p_changes ? 'description'
                            then coalesce(p_changes->>'description', '') else t.description end,
         priority = case when p_changes ? 'priority' then p_changes->>'priority' else t.priority end,
         addr_street = case when v_set_ad then v_addr->>'street' else t.addr_street end,
         addr_unit = case when v_set_ad then v_addr->>'unit' else t.addr_unit end,
         addr_city = case when v_set_ad then v_addr->>'city' else t.addr_city end,
         addr_state = case when v_set_ad then v_addr->>'state' else t.addr_state end,
         addr_postal_code = case when v_set_ad then v_addr->>'postal_code' else t.addr_postal_code end,
         addr_country = case when v_set_ad then v_addr->>'country' else t.addr_country end,
         addr_provenance = case when v_set_ad then v_addr->>'provenance' else t.addr_provenance end,
         due_at = case when v_time is not null and t.due_at is not null
                       then ((t.due_at at time zone s.time_zone)::date + v_time)
                            at time zone s.time_zone
                       else t.due_at end
    from later
   where t.id = later.id;
  get diagnostics v_n = row_count;

  -- The crew on the later occurrences: exactly this set.
  if v_set_as then
    for v_later in
      select t.id from public.tasks t
       where t.series_id = s.id and t.occurrence_no > v_task.occurrence_no
         and t.deleted_at is null and public.task_done_at(t) is null
    loop
      perform public.task_set_assignees(v_later, v_assignees, p_actor_user_id);
    end loop;
  end if;

  -- Labels on the later occurrences.
  delete from public.task_tags g
   using public.tasks t
   where g.task_id = t.id and t.series_id = s.id
     and t.occurrence_no > v_task.occurrence_no
     and t.deleted_at is null and public.task_done_at(t) is null
     and g.tag_id in (
       select e::uuid from jsonb_array_elements_text(
         coalesce(p_changes->'labels_remove', '[]'::jsonb)) e);
  insert into public.task_tags (company_id, task_id, tag_id)
  select p_company_id, t.id, g.id
    from public.tasks t
    join public.tags g on g.company_id = p_company_id
     and g.id in (
       select e::uuid from jsonb_array_elements_text(
         coalesce(p_changes->'labels_add', '[]'::jsonb)) e)
   where t.series_id = s.id and t.occurrence_no > v_task.occurrence_no
     and t.deleted_at is null and public.task_done_at(t) is null
  on conflict do nothing;

  return jsonb_build_object('outcome', 'updated', 'later', v_n);
end $$;
