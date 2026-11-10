-- #689 E: task-scoped history and comments (amends D28 for tasks).
--
-- Until now a task's history was the task_* rows of its source conversation's
-- timeline: only create, assign, due and delete, and a task with no
-- conversation had nowhere to write them (the standalone migration drops them).
-- A task's discussion was thread notes (`messages.task_id`), so a standalone or
-- call task had nowhere to talk either.
--
-- This migration gives the task its own record:
--   1. task_events   append-only: one row per field change, written by triggers
--                    so no writer can forget one.
--   2. task_comments soft-deleted comments that live on the task. Files on a
--                    comment reuse `attachments` with owner_type 'task_comment'.
--   3. api_task_activity: the merged, paginated, visibility-gated read.
--
-- The source conversation's one-line summary (conversation_events task_*) is
-- unchanged and keeps being written by the same RPCs.
--
-- WHO MADE THE CHANGE. A trigger cannot see the caller, so each RPC that
-- changes a task says so with a transaction-local setting before it writes,
-- `loonext.task_actor`. Where a column already names the person (created_by,
-- done_by, confirmed_by) it is the fallback. A change nobody names (the
-- offboarding reassignment, a cron) records no actor: a system change.
--
-- Every function created or recreated here is revoked from public, anon and
-- authenticated before the service_role grant, because hosted Supabase grants
-- EXECUTE on a recreated function by name.

-- ---------------------------------------------------------------------------
-- 1. task_events
-- ---------------------------------------------------------------------------
create table public.task_events (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete restrict,
  task_id       uuid not null references public.tasks(id) on delete cascade,
  -- Null = the system (no member made this change).
  actor_user_id uuid references auth.users(id) on delete restrict,
  kind          text not null check (kind in (
    'created', 'title', 'description', 'address', 'assignee', 'due',
    'reminders', 'confirmation', 'done', 'reopened', 'deleted')),
  -- The value before and after, as the task stores it: a string for title,
  -- description and the user id of an assignee, an ISO timestamp for a time, a
  -- boolean for reminders_off, an object of the address fields for an address.
  -- Null means "none" (no assignee, no due time, no address).
  from_value    jsonb,
  to_value      jsonb,
  created_at    timestamptz not null default now()
);

create index task_events_task_idx
  on public.task_events (company_id, task_id, created_at desc, id desc);

alter table public.task_events enable row level security;
revoke all on public.task_events from public, anon, authenticated;
grant select, insert, update, delete on public.task_events to service_role;

comment on table public.task_events is
  '#689 E: append-only history of one task, one row per field change, written by triggers on tasks and messages. Cascades with the task, so the workspace purge reaches it through tasks.';

-- ---------------------------------------------------------------------------
-- 2. task_comments
-- ---------------------------------------------------------------------------
create table public.task_comments (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete restrict,
  task_id        uuid not null references public.tasks(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete restrict,
  body           text not null
    check (char_length(btrim(body)) between 1 and 4000),
  created_at     timestamptz not null default now(),
  edited_at      timestamptz,
  deleted_at     timestamptz
);

create index task_comments_task_idx
  on public.task_comments (company_id, task_id, created_at desc, id desc)
  where deleted_at is null;

alter table public.task_comments enable row level security;
revoke all on public.task_comments from public, anon, authenticated;
grant select, insert, update, delete on public.task_comments to service_role;

comment on table public.task_comments is
  '#689 E: a comment on a task (amends D28 for tasks). Soft-deleted. Files on a comment are attachments rows with owner_type task_comment. Cascades with the task, so the workspace purge reaches it through tasks.';

-- A comment's files are `attachments` rows owned by the comment.
alter table public.attachments drop constraint attachments_owner_type_check;
alter table public.attachments add constraint attachments_owner_type_check
  check (owner_type in ('note', 'task', 'task_comment'));

-- ---------------------------------------------------------------------------
-- 3. The writer of task_events
-- ---------------------------------------------------------------------------
create or replace function public.task_event_actor(p_fallback uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('loonext.task_actor', true), '')::uuid,
    p_fallback);
$$;

revoke execute on function public.task_event_actor(uuid)
  from public, anon, authenticated;
grant execute on function public.task_event_actor(uuid) to service_role;

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

  if new.assigned_user_id is distinct from old.assigned_user_id then
    insert into public.task_events
      (company_id, task_id, actor_user_id, kind, from_value, to_value)
    values
      (new.company_id, new.id, public.task_event_actor(null), 'assignee',
       to_jsonb(old.assigned_user_id), to_jsonb(new.assigned_user_id));
  end if;

  if new.due_at is distinct from old.due_at then
    insert into public.task_events
      (company_id, task_id, actor_user_id, kind, from_value, to_value)
    values
      (new.company_id, new.id, public.task_event_actor(null), 'due',
       to_jsonb(old.due_at), to_jsonb(new.due_at));
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
      (new.company_id, new.id, public.task_event_actor(new.confirmed_by),
       'confirmation', to_jsonb(old.confirmed_at), to_jsonb(new.confirmed_at));
  end if;

  -- A task with a message is done when its MESSAGE is (messages trigger below);
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

revoke execute on function public.task_events_record_task_change()
  from public, anon, authenticated;

create trigger task_events_record_task_change
  after insert or update on public.tasks
  for each row execute function public.task_events_record_task_change();

-- A message-anchored task is done when its message is (D17): record the flip on
-- every live task promoted from it.
create or replace function public.task_events_record_message_done()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.task_events
    (company_id, task_id, actor_user_id, kind, from_value, to_value)
  select t.company_id, t.id,
         public.task_event_actor(case when new.done_at is not null
                                      then new.done_by_user_id end),
         case when new.done_at is not null then 'done' else 'reopened' end,
         to_jsonb(old.done_at), to_jsonb(new.done_at)
    from public.tasks t
   where t.message_id = new.id
     and t.deleted_at is null;
  return null;
end $$;

revoke execute on function public.task_events_record_message_done()
  from public, anon, authenticated;

create trigger task_events_record_message_done
  after update of done_at on public.messages
  for each row
  when (old.done_at is distinct from new.done_at)
  execute function public.task_events_record_message_done();

-- ---------------------------------------------------------------------------
-- 4. History that already exists moves onto the task
--    The conversation events keep their rows; the task simply stops depending
--    on them. Only what they recorded can be carried over: a creation, each
--    assignment, each due time (the previous time was not recorded).
-- ---------------------------------------------------------------------------
insert into public.task_events
  (company_id, task_id, actor_user_id, kind, to_value, created_at)
select t.company_id, t.id, t.created_by_user_id, 'created', to_jsonb(t.title),
       t.created_at
  from public.tasks t
 where t.deleted_at is null;

insert into public.task_events
  (company_id, task_id, actor_user_id, kind, from_value, to_value, created_at)
select e.company_id, t.id, e.actor_user_id,
       case e.type::text when 'task_assigned' then 'assignee' else 'due' end,
       case e.type::text
         when 'task_assigned' then to_jsonb(e.payload->>'from_user_id') end,
       case e.type::text
         when 'task_assigned' then to_jsonb(e.payload->>'to_user_id')
         else to_jsonb(e.payload->>'due_at') end,
       e.created_at
  from public.conversation_events e
  join public.tasks t
    on t.company_id = e.company_id
   and t.id::text = e.payload->>'task_id'
 where e.type::text in ('task_assigned', 'task_due_set')
   and t.deleted_at is null;

-- ---------------------------------------------------------------------------
-- 5. api_task_activity: one task's history, comments and (for a task promoted
--    from a thread note) notes, newest first, keyset-paginated.
--
--    Visibility is the task's own (D148): a task with a conversation is gated
--    like that conversation (p_hidden_number_ids are the numbers the caller is
--    denied, the same list every task reader takes); a task with no
--    conversation is visible to every active member of its company. A hidden,
--    deleted or foreign task is `not_found`, indistinguishable from absent.
-- ---------------------------------------------------------------------------
create or replace function public.api_task_activity(
  p_company_id        uuid,
  p_task_id           uuid,
  p_hidden_number_ids uuid[] default null,
  p_limit             int default 50,
  p_before_ts         timestamptz default null,
  p_before_id         uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_visible boolean;
  v_items   jsonb;
begin
  select true
    into v_visible
    from public.tasks t
    left join public.conversations c on c.id = t.conversation_id
   where t.company_id = p_company_id
     and t.id = p_task_id
     and t.deleted_at is null
     and (
       p_hidden_number_ids is null
       or array_length(p_hidden_number_ids, 1) is null
       or c.phone_number_id is null
       or not (c.phone_number_id = any(p_hidden_number_ids)));
  if v_visible is not true then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  with entries as (
    select 'event'::text as kind, e.id, e.created_at as at,
           e.actor_user_id as user_id,
           jsonb_build_object('event', e.kind, 'from', e.from_value,
                              'to', e.to_value) as detail
      from public.task_events e
     where e.company_id = p_company_id
       and e.task_id = p_task_id
    union all
    select 'comment', k.id, k.created_at, k.author_user_id,
           jsonb_build_object('body', k.body, 'edited_at', k.edited_at)
      from public.task_comments k
     where k.company_id = p_company_id
       and k.task_id = p_task_id
       and k.deleted_at is null
    union all
    select 'note', m.id, m.created_at, m.sent_by_user_id,
           jsonb_build_object('body', m.body)
      from public.messages m
     where m.company_id = p_company_id
       and m.task_id = p_task_id
       and m.direction = 'note'
  ),
  page as (
    select *
      from entries e
     where p_before_ts is null
        or (e.at, e.id) < (p_before_ts, p_before_id)
     order by e.at desc, e.id desc
     limit greatest(1, least(coalesce(p_limit, 50), 201))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', p.kind, 'id', p.id, 'at', p.at, 'user_id', p.user_id,
           'detail', p.detail) order by p.at desc, p.id desc), '[]'::jsonb)
    into v_items
    from page p;

  return jsonb_build_object('outcome', 'ok', 'items', v_items);
end $$;

revoke execute on function public.api_task_activity(
  uuid, uuid, uuid[], int, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.api_task_activity(
  uuid, uuid, uuid[], int, timestamptz, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. The RPCs that change a task now say who is acting.
--    Each is restated from its latest definition with one added line, and its
--    grants restated because a recreated function regains the hosted defaults.
-- ---------------------------------------------------------------------------

-- update_task: copied from 20260825020000_two_way_calendar_sync_outbox.sql; the only change is the set_config line.
create or replace function public.update_task(
  p_company_id       uuid,
  p_task_id          uuid,
  p_title            text,
  p_description      text,
  p_due_at           timestamptz,
  p_clear_due        boolean,
  p_actor_user_id    uuid,
  p_set_address      boolean default false,
  p_addr_street      text default null,
  p_addr_unit        text default null,
  p_addr_city        text default null,
  p_addr_state       text default null,
  p_addr_postal_code text default null,
  p_addr_country     text default null,
  p_addr_provenance  text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task         public.tasks%rowtype;
  v_new_title    text;
  v_new_desc     text;
  v_new_due      timestamptz;
  v_new_prov     text;
  v_has_address  boolean;
  v_due_changed  boolean := false;
  v_addr_changed boolean := false;
  v_changed      boolean := false;
  v_prior_actor  text := coalesce(current_setting('loonext.schedule_actor', true), '');
begin
  -- #689 E: who is making this change, for the task_events triggers.
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

  v_new_title := coalesce(p_title, v_task.title);
  v_new_desc  := coalesce(p_description, v_task.description);
  if p_clear_due then
    v_new_due := null;
  elsif p_due_at is not null then
    v_new_due := p_due_at;
  else
    v_new_due := v_task.due_at;
  end if;

  if p_set_address then
    v_has_address := coalesce(
      p_addr_street, p_addr_unit, p_addr_city, p_addr_state,
      p_addr_postal_code, p_addr_country) is not null;
    v_new_prov := case when v_has_address then p_addr_provenance else null end;
    v_addr_changed :=
         (p_addr_street      is distinct from v_task.addr_street)
      or (p_addr_unit        is distinct from v_task.addr_unit)
      or (p_addr_city        is distinct from v_task.addr_city)
      or (p_addr_state       is distinct from v_task.addr_state)
      or (p_addr_postal_code is distinct from v_task.addr_postal_code)
      or (p_addr_country     is distinct from v_task.addr_country)
      or (v_new_prov         is distinct from v_task.addr_provenance);
  end if;

  v_changed := (v_new_title is distinct from v_task.title)
            or (v_new_desc  is distinct from v_task.description)
            or (v_new_due   is distinct from v_task.due_at)
            or v_addr_changed;
  if not v_changed then
    return jsonb_build_object('outcome', 'unchanged', 'task', to_jsonb(v_task));
  end if;

  v_due_changed := v_new_due is distinct from v_task.due_at;
  if v_due_changed then
    perform set_config('loonext.schedule_actor', p_actor_user_id::text, true);
  end if;

  update public.tasks
     set title = v_new_title,
         description = v_new_desc,
         due_at = v_new_due,
         addr_street      = case when p_set_address then p_addr_street      else addr_street end,
         addr_unit        = case when p_set_address then p_addr_unit        else addr_unit end,
         addr_city        = case when p_set_address then p_addr_city        else addr_city end,
         addr_state       = case when p_set_address then p_addr_state       else addr_state end,
         addr_postal_code = case when p_set_address then p_addr_postal_code else addr_postal_code end,
         addr_country     = case when p_set_address then p_addr_country     else addr_country end,
         addr_provenance  = case when p_set_address then v_new_prov         else addr_provenance end
   where id = v_task.id
  returning * into v_task;

  if v_due_changed then
    perform set_config('loonext.schedule_actor', v_prior_actor, true);
    insert into public.conversation_events
      (company_id, conversation_id, actor_user_id, type, payload)
    values
      (p_company_id, v_task.conversation_id, p_actor_user_id, 'task_due_set',
       jsonb_build_object('task_id', v_task.id, 'due_at', v_new_due));
  end if;

  return jsonb_build_object('outcome', 'updated', 'task', to_jsonb(v_task));
end $$;

-- assign_task: copied from 20260702090000_appv2_task_mutations.sql; the only change is the set_config line.
create or replace function public.assign_task(
  p_company_id       uuid,
  p_task_id          uuid,
  p_assigned_user_id uuid,
  p_actor_user_id    uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task     public.tasks%rowtype;
  v_from     uuid;
begin
  -- #689 E: who is making this change, for the task_events triggers.
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

  if v_task.assigned_user_id is not distinct from p_assigned_user_id then
    return jsonb_build_object('outcome', 'unchanged', 'task', to_jsonb(v_task));
  end if;

  if p_assigned_user_id is not null then
    perform 1
      from public.company_members cm
     where cm.company_id = p_company_id
       and cm.user_id = p_assigned_user_id
       and cm.deactivated_at is null;
    if not found then
      return jsonb_build_object('outcome', 'not_member', 'task', null);
    end if;
  end if;

  -- Capture the PRIOR assignee for the audit before the update overwrites it.
  v_from := v_task.assigned_user_id;

  update public.tasks
     set assigned_user_id = p_assigned_user_id
   where id = v_task.id
  returning * into v_task;

  insert into public.conversation_events
    (company_id, conversation_id, actor_user_id, type, payload)
  values
    (p_company_id, v_task.conversation_id, p_actor_user_id, 'task_assigned',
     jsonb_build_object(
       'task_id', v_task.id,
       'from_user_id', v_from,
       'to_user_id', p_assigned_user_id));

  return jsonb_build_object('outcome', 'updated', 'task', to_jsonb(v_task));
end $$;

-- delete_task: copied from 20260726000000_delete_task_releases_notes.sql; the only change is the set_config line.
create or replace function public.delete_task(
  p_company_id uuid,
  p_task_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_task public.tasks%rowtype;
  v_now  timestamptz := now();
begin
  -- #689 E: who is making this change, for the task_events triggers.
  perform set_config('loonext.task_actor', coalesce(p_actor_user_id::text, ''), true);
  update public.tasks
     set deleted_at = v_now
   where company_id = p_company_id
     and id = p_task_id
     and deleted_at is null
  returning * into v_task;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  -- Soft-delete the task's live generic attachment rows (D19) in the SAME txn.
  update public.attachments
     set deleted_at = v_now
   where company_id = p_company_id
     and owner_type = 'task'
     and owner_id = p_task_id
     and deleted_at is null;

  -- Files on its comments go too.
  update public.attachments
     set deleted_at = v_now
   where company_id = p_company_id
     and owner_type = 'task_comment'
     and owner_id in (select k.id from public.task_comments k where k.task_id = p_task_id)
     and deleted_at is null;

  -- Release the notes, in the same transaction, so the same message can be
  -- promoted again and carry its files and its body with it.
  update public.messages
     set task_id = null
   where company_id = p_company_id
     and task_id = p_task_id;

  insert into public.conversation_events
    (company_id, conversation_id, actor_user_id, type, payload)
  values
    (p_company_id, v_task.conversation_id, p_actor_user_id, 'task_deleted',
     jsonb_build_object('task_id', p_task_id));

  return jsonb_build_object('outcome', 'deleted');
end $function$;

-- set_task_done: copied from 20261110100000_call_anchored_tasks.sql; the only change is the set_config line.
create or replace function public.set_task_done(
  p_company_id    uuid,
  p_task_id       uuid,
  p_done          boolean,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task   public.tasks%rowtype;
  v_result jsonb;
begin
  -- #689 E: who is making this change, for the task_events triggers.
  perform set_config('loonext.task_actor', coalesce(p_actor_user_id::text, ''), true);
  select * into v_task
    from public.tasks t
   where t.company_id = p_company_id
     and t.id = p_task_id
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found', 'task', null);
  end if;

  if v_task.message_id is not null then
    v_result := public.set_message_done(
      p_company_id, v_task.message_id, p_done, p_actor_user_id);
    return jsonb_build_object(
      'outcome', v_result->>'outcome',
      'task', to_jsonb(v_task),
      'done_at', v_result->'message'->'done_at');
  end if;

  if p_done = (v_task.done_at is not null) then
    return jsonb_build_object(
      'outcome', 'unchanged', 'task', to_jsonb(v_task),
      'done_at', to_jsonb(v_task.done_at));
  end if;

  update public.tasks
     set done_at = case when p_done then now() end,
         done_by_user_id = case when p_done then p_actor_user_id end
   where id = v_task.id
  returning * into v_task;

  return jsonb_build_object(
    'outcome', 'updated', 'task', to_jsonb(v_task),
    'done_at', to_jsonb(v_task.done_at));
end $$;

-- set_message_done: copied from 20260703000000_set_message_done_enum_cast_fix.sql; the only change is the set_config line.
create or replace function public.set_message_done(
  p_company_id    uuid,
  p_message_id    uuid,
  p_done          boolean,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg  public.messages%rowtype;
  v_now  timestamptz := now();
begin
  -- #689 E: who is making this change, for the task_events triggers.
  perform set_config('loonext.task_actor', coalesce(p_actor_user_id::text, ''), true);
  -- Company-scope + lock the row so a concurrent toggle can't interleave the
  -- update and the audit insert (§10 + atomicity).
  select * into v_msg
    from public.messages m
   where m.company_id = p_company_id
     and m.id = p_message_id
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found', 'message', null);
  end if;

  -- Idempotent no-op: already in the requested state → no write, no event.
  if p_done = (v_msg.done_at is not null) then
    return jsonb_build_object('outcome', 'unchanged',
                              'message', to_jsonb(v_msg));
  end if;

  if p_done then
    update public.messages
       set done_at = v_now, done_by_user_id = p_actor_user_id
     where id = v_msg.id
    returning * into v_msg;
  else
    update public.messages
       set done_at = null, done_by_user_id = null
     where id = v_msg.id
    returning * into v_msg;
  end if;

  -- D22 audit — SAME txn as the flip above. Only real transitions reach here.
  -- Body is never copied into the payload (D8/D22 PII posture); the timeline
  -- joins the live message by message_id. conversation_id is always non-null.
  -- The event type is cast to the enum explicitly: a CASE over string literals
  -- is `text`, which does not implicitly coerce to conversation_event_type in a
  -- VALUES list (the bug this migration fixes).
  insert into public.conversation_events
    (company_id, conversation_id, actor_user_id, type, payload)
  values
    (p_company_id, v_msg.conversation_id, p_actor_user_id,
     (case when p_done then 'message_done' else 'message_undone' end)
       ::public.conversation_event_type,
     jsonb_build_object('message_id', v_msg.id));

  return jsonb_build_object('outcome', 'updated', 'message', to_jsonb(v_msg));
end $$;

-- api_bulk_tasks: copied from 20261110100000_call_anchored_tasks.sql; the only change is the set_config line.
create or replace function public.api_bulk_tasks(
  p_company_id     uuid,
  p_user_id        uuid,
  p_action         text,
  p_ids            uuid[],
  -- The assign target. NULL is legitimate (unassign) and is why the action has
  -- to be named separately from the value.
  p_target_user_id uuid    default null,
  -- #106: numbers this actor may not see. Their tasks are refused by id rather
  -- than silently skipped — a caller that asked about a task it cannot see gets
  -- told, and the count it renders stays true.
  p_hidden_number_ids uuid[] default null
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
begin
  -- #689 E: who is making this change, for the task_events triggers.
  perform set_config('loonext.task_actor', coalesce(p_user_id::text, ''), true);
  if p_action is null or p_action not in ('mark_done', 'mark_undone', 'assign', 'delete') then
    return jsonb_build_object('error', 'validation_failed');
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    return jsonb_build_object('error', 'validation_failed');
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
  -- hidden-number alike — telling them apart would leak which of the three it
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
    -- A target who is not an active member is refused for the whole call
    -- rather than per row: it is one wrong id in the request, and applying it
    -- to some tasks and not others would leave a half-assigned list nobody
    -- asked for.
    if p_target_user_id is not null then
      perform 1 from public.company_members cm
       where cm.company_id = p_company_id
         and cm.user_id = p_target_user_id
         and cm.deactivated_at is null;
      if not found then
        return jsonb_build_object('error', 'not_member');
      end if;
    end if;

    for v_row in
      select t.id, t.assigned_user_id, t.conversation_id
        from public.tasks t
       where t.id = any(v_selected)
         and t.assigned_user_id is distinct from p_target_user_id
       for update
    loop
      update public.tasks
         set assigned_user_id = p_target_user_id
       where id = v_row.id;

      insert into public.conversation_events
        (company_id, conversation_id, actor_user_id, type, payload)
      values
        (p_company_id, v_row.conversation_id, p_user_id, 'task_assigned',
         jsonb_build_object(
           'task_id', v_row.id,
           'from_user_id', v_row.assigned_user_id,
           'to_user_id', p_target_user_id));

      v_applied := v_applied || jsonb_build_object(
        'id', v_row.id,
        'previous', jsonb_build_object('assigned_user_id', v_row.assigned_user_id));
    end loop;

  else -- delete
    -- Soft, and deliberately NOT touching messages.done_at — the same rule the
    -- single-row delete follows (T4). Deleting the task does not un-finish the
    -- work somebody did.
    for v_row in
      select t.id, t.conversation_id
        from public.tasks t
       where t.id = any(v_selected)
       for update
    loop
      update public.tasks set deleted_at = v_now where id = v_row.id;

      insert into public.conversation_events
        (company_id, conversation_id, actor_user_id, type, payload)
      values
        (p_company_id, v_row.conversation_id, p_user_id, 'task_deleted',
         jsonb_build_object('task_id', v_row.id));

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

revoke execute on function public.update_task(
  uuid, uuid, text, text, timestamptz, boolean, uuid,
  boolean, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.update_task(
  uuid, uuid, text, text, timestamptz, boolean, uuid,
  boolean, text, text, text, text, text, text, text)
  to service_role;

revoke execute on function public.assign_task(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.assign_task(uuid, uuid, uuid, uuid)
  to service_role;

revoke execute on function public.delete_task(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_task(uuid, uuid, uuid) to service_role;

revoke execute on function public.set_task_done(uuid, uuid, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.set_task_done(uuid, uuid, boolean, uuid)
  to service_role;

revoke execute on function public.set_message_done(uuid, uuid, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.set_message_done(uuid, uuid, boolean, uuid)
  to service_role;

revoke execute on function public.api_bulk_tasks(uuid, uuid, text, uuid[], uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.api_bulk_tasks(uuid, uuid, text, uuid[], uuid, uuid[])
  to service_role;

-- ---------------------------------------------------------------------------
-- 7. The reminder switch used to be a bare column write from the route, which
--    left no way to say who flipped it. It is an RPC now, like its neighbours.
-- ---------------------------------------------------------------------------
create or replace function public.set_task_reminders_off(
  p_company_id    uuid,
  p_task_id       uuid,
  p_off           boolean,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks%rowtype;
begin
  perform set_config('loonext.task_actor', coalesce(p_actor_user_id::text, ''), true);

  update public.tasks
     set reminders_off = p_off,
         updated_at = now()
   where company_id = p_company_id
     and id = p_task_id
     and deleted_at is null
  returning * into v_task;
  if not found then
    return jsonb_build_object('outcome', 'not_found', 'task', null);
  end if;
  return jsonb_build_object('outcome', 'updated', 'task', to_jsonb(v_task));
end $$;

revoke execute on function public.set_task_reminders_off(uuid, uuid, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.set_task_reminders_off(uuid, uuid, boolean, uuid)
  to service_role;
