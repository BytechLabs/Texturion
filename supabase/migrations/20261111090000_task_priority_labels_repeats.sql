-- #693: task priority, task labels and repeating jobs (#689 H, D153).
--
--   1. tasks.priority (none, low, normal, high, urgent) and a stored rank to sort
--      on; a 'priority' history event.
--   2. task_tags: a task carries tags from the workspace's one tag vocabulary
--      (the same table conversations and contacts use); 'label_added' and
--      'label_removed' history events.
--   3. task_series: a repeat. Two kinds behind one control.
--        schedule    every Monday, the 1st, every Jan 15, every N units. The
--                    runner (api_materialize_task_repeats) keeps the next two
--                    occurrences created ahead of time.
--        after_done  every N days, weeks or months after COMPLETION. The next
--                    occurrence is created by the completion itself.
--      Each occurrence is an ordinary task row, so its done state, comments,
--      history and calendar event are its own, and the calendar sync never sees
--      provider recurrence.
--
-- IDEMPOTENCY. Every occurrence carries (series_id, occurrence_no) and a unique
-- index over it. The next occurrence is always inserted with ON CONFLICT DO
-- NOTHING at occurrence_no + 1, so two completions, a reopen and a second
-- completion, a completion racing an edit and two runner ticks all try to insert
-- the SAME key and exactly one wins. A schedule series also keys on the
-- occurrence date. Every writer that decides what comes next takes the series row
-- FOR UPDATE first, so the decisions are serialised as well as the inserts.
--
-- Every function created or recreated here is revoked from public, anon and
-- authenticated before the service_role grant (a recreated function regains the
-- hosted defaults). Nullable comparisons use IS DISTINCT FROM.

-- ---------------------------------------------------------------------------
-- 1. Priority
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column priority text not null default 'normal'
    constraint tasks_priority_check
    check (priority in ('none', 'low', 'normal', 'high', 'urgent'));

alter table public.tasks
  add column priority_rank smallint generated always as (
    case priority
      when 'none' then 0 when 'low' then 1 when 'normal' then 2
      when 'high' then 3 else 4 end) stored;

create index tasks_priority_idx
  on public.tasks (company_id, priority_rank desc, created_at desc, id desc)
  where deleted_at is null;

comment on column public.tasks.priority is
  '#693: none, low, normal, high or urgent. Default normal.';

-- ---------------------------------------------------------------------------
-- 2. task_tags
-- ---------------------------------------------------------------------------
create table public.task_tags (
  company_id uuid not null references public.companies(id) on delete restrict,
  task_id    uuid not null references public.tasks(id) on delete cascade,
  tag_id     uuid not null references public.tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, tag_id)
);

create index task_tags_tag_idx
  on public.task_tags (company_id, tag_id, task_id);

alter table public.task_tags enable row level security;
revoke all on public.task_tags from public, anon, authenticated;
grant select, insert, update, delete on public.task_tags to service_role;

comment on table public.task_tags is
  '#693: which workspace tags a task carries. Same vocabulary as conversation_tags and contact_tags. Cascades with the task and with the tag, so the workspace purge reaches it through tasks.';

alter table public.task_events drop constraint task_events_kind_check;
alter table public.task_events add constraint task_events_kind_check
  check (kind in (
    'created', 'title', 'description', 'address', 'assignee', 'due',
    'reminders', 'confirmation', 'done', 'reopened', 'deleted',
    'priority', 'label_added', 'label_removed', 'repeat'));

-- A label change is a task_events row. The tag name is copied into the row
-- because the tag may be deleted or merged later.
create or replace function public.task_events_record_tag_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row  public.task_tags;
  v_name text;
begin
  -- A merge moves links around and a new occurrence copies its series' labels:
  -- neither is somebody labelling a task.
  if coalesce(current_setting('loonext.task_tags_quiet', true), '') = 'on' then
    return null;
  end if;
  v_row := case when tg_op = 'INSERT' then new else old end;
  -- The task itself is being deleted (the cascade): nothing to say about it.
  if not exists (select 1 from public.tasks t where t.id = v_row.task_id) then
    return null;
  end if;
  select g.name into v_name from public.tags g where g.id = v_row.tag_id;
  insert into public.task_events
    (company_id, task_id, actor_user_id, kind, from_value, to_value)
  values
    (v_row.company_id, v_row.task_id, public.task_event_actor(null),
     case when tg_op = 'INSERT' then 'label_added' else 'label_removed' end,
     case when tg_op = 'DELETE'
          then jsonb_build_object('tag_id', v_row.tag_id, 'name', v_name) end,
     case when tg_op = 'INSERT'
          then jsonb_build_object('tag_id', v_row.tag_id, 'name', v_name) end);
  return null;
end $$;

revoke execute on function public.task_events_record_tag_change()
  from public, anon, authenticated;

create trigger task_events_record_tag_change
  after insert or delete on public.task_tags
  for each row execute function public.task_events_record_tag_change();

-- task_events_record_task_change, from 20261110160000: the only change is the
-- priority block.
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

revoke execute on function public.task_events_record_task_change()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. task_series
-- ---------------------------------------------------------------------------
create table public.task_series (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete restrict,
  kind        text not null check (kind in ('schedule', 'after_done')),
  unit        text not null check (unit in ('day', 'week', 'month', 'year')),
  every       smallint not null default 1 check (every between 1 and 365),
  -- ISO weekdays, 1 = Monday .. 7 = Sunday. Weekly series only.
  weekdays    smallint[]
    check (weekdays is null or (
      cardinality(weekdays) between 1 and 7
      and weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[])),
  -- Monthly on a date (31 means the last day of a short month), or on the nth
  -- weekday (nth -1 = the last one). Monthly schedule series only.
  month_day   smallint check (month_day between 1 and 31),
  nth         smallint check (nth in (1, 2, 3, 4, -1)),
  nth_weekday smallint check (nth_weekday between 1 and 7),
  ends_kind   text not null default 'never' check (ends_kind in ('never', 'on', 'after')),
  ends_on     date,
  ends_after  integer check (ends_after between 1 and 1000),
  paused      boolean not null default false,
  -- Set when the series is deleted or has run its course. A stopped series
  -- never makes another occurrence.
  stopped_at  timestamptz,
  time_zone   text not null,
  due_time    time not null default time '09:00',
  anchor_on   date not null,
  -- Where the series has got to: the newest occurrence's number and date, and
  -- the date of the one before it (what the runner indexes on).
  tail_no     integer not null default 1,
  tail_on     date,
  prev_on     date,
  -- What a new occurrence carries.
  title       text not null,
  description text not null default '',
  assigned_user_id uuid references auth.users(id) on delete set null,
  priority    text not null default 'normal'
    check (priority in ('none', 'low', 'normal', 'high', 'urgent')),
  addr_street text, addr_unit text, addr_city text, addr_state text,
  addr_postal_code text, addr_country text, addr_provenance text,
  contact_id      uuid references public.contacts(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  label_ids   uuid[] not null default '{}',
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint task_series_ends_on_ck check ((ends_kind = 'on') = (ends_on is not null)),
  constraint task_series_ends_after_ck check ((ends_kind = 'after') = (ends_after is not null)),
  constraint task_series_after_done_unit_ck check (kind = 'schedule' or unit <> 'year'),
  constraint task_series_nth_ck check ((nth is null) = (nth_weekday is null))
);

create trigger set_updated_at before update on public.task_series
  for each row execute function moddatetime('updated_at');

-- The runner's work list: schedule series that may need another occurrence.
create index task_series_runner_idx
  on public.task_series (coalesce(prev_on, date '0001-01-01'))
  where kind = 'schedule' and not paused and stopped_at is null;

alter table public.task_series enable row level security;
revoke all on public.task_series from public, anon, authenticated;
grant select, insert, update, delete on public.task_series to service_role;

comment on table public.task_series is
  '#693: one repeating job. kind schedule = occurrences made ahead of time by the runner; after_done = the next one is made when the last is completed. Holds the template new occurrences copy (title, address: personal data) so it is classified and purged with the workspace.';

alter table public.tasks
  add column series_id uuid references public.task_series(id) on delete set null,
  add column occurrence_no integer,
  add column occurrence_on date;

alter table public.tasks add constraint tasks_series_ck
  check ((series_id is null) = (occurrence_no is null));

-- THE IDEMPOTENCY KEYS. One occurrence per number; a schedule series also one
-- per date.
create unique index tasks_series_occurrence_no_uq
  on public.tasks (series_id, occurrence_no) where series_id is not null;
create unique index tasks_series_occurrence_on_uq
  on public.tasks (series_id, occurrence_on) where occurrence_on is not null;

comment on column public.tasks.series_id is
  '#693: the repeat this task is an occurrence of.';
comment on column public.tasks.occurrence_no is
  '#693: 1 for the task the repeat was set on, then 2, 3 ... Unique per series: the key that makes creating the next occurrence idempotent.';
comment on column public.tasks.occurrence_on is
  '#693: the local date a schedule occurrence was planned for. Null for an after-done occurrence, whose date is decided by the completion.';

-- ---------------------------------------------------------------------------
-- 4. The date arithmetic
-- ---------------------------------------------------------------------------
-- The first date of a schedule series that is on or after p_from_on (and on or
-- after the anchor). Null when the rule yields nothing (cannot happen for a
-- valid row).
create or replace function public.task_series_next_on(
  s public.task_series,
  p_after date
) returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_from  date := greatest(p_after + 1, s.anchor_on);
  v_d     date;
  v_k     int;
  v_i     int;
  v_n     int;
  v_base  date;
  v_month date;
  v_last  date;
  v_first date;
  v_days  smallint[];
begin
  if s.unit = 'day' then
    v_k := ceil((v_from - s.anchor_on)::numeric / s.every)::int;
    return s.anchor_on + v_k * s.every;

  elsif s.unit = 'week' then
    v_days := coalesce(s.weekdays, array[extract(isodow from s.anchor_on)::smallint]);
    -- Weeks are counted from the Monday of the anchor's week.
    v_base := s.anchor_on - (extract(isodow from s.anchor_on)::int - 1);
    v_d := v_from;
    for v_i in 0 .. 7 * s.every + 7 loop
      if extract(isodow from v_d)::smallint = any (v_days)
         and (((v_d - v_base) / 7) % s.every) = 0 then
        return v_d;
      end if;
      v_d := v_d + 1;
    end loop;
    return null;

  elsif s.unit = 'month' then
    v_n := (extract(year from v_from)::int - extract(year from s.anchor_on)::int) * 12
         + extract(month from v_from)::int - extract(month from s.anchor_on)::int;
    v_k := greatest(0, v_n / s.every);
    for v_i in 0 .. 24 loop
      v_month := (date_trunc('month', s.anchor_on)
                  + make_interval(months => (v_k + v_i) * s.every))::date;
      v_last := (v_month + interval '1 month' - interval '1 day')::date;
      if s.nth is not null then
        if s.nth = -1 then
          v_d := v_last - ((extract(isodow from v_last)::int - s.nth_weekday + 7) % 7);
        else
          v_first := v_month + ((s.nth_weekday - extract(isodow from v_month)::int + 7) % 7);
          v_d := v_first + (s.nth - 1) * 7;
          -- A fifth Friday that the month does not have is its last Friday.
          if v_d > v_last then v_d := v_d - 7; end if;
        end if;
      else
        v_d := v_month + (least(
                 coalesce(s.month_day, extract(day from s.anchor_on)::int),
                 extract(day from v_last)::int) - 1);
      end if;
      if v_d >= v_from then return v_d; end if;
    end loop;
    return null;

  else -- year
    v_n := extract(year from v_from)::int - extract(year from s.anchor_on)::int;
    v_k := greatest(0, v_n / s.every);
    for v_i in 0 .. 8 loop
      v_month := make_date(
        extract(year from s.anchor_on)::int + (v_k + v_i) * s.every,
        extract(month from s.anchor_on)::int, 1);
      v_last := (v_month + interval '1 month' - interval '1 day')::date;
      v_d := v_month + (least(extract(day from s.anchor_on)::int,
                              extract(day from v_last)::int) - 1);
      if v_d >= v_from then return v_d; end if;
    end loop;
    return null;
  end if;
end $$;

revoke execute on function public.task_series_next_on(public.task_series, date)
  from public, anon, authenticated;

-- The local wall-clock time of an occurrence, as an instant.
create or replace function public.task_series_due_at(
  s public.task_series,
  p_on date
) returns timestamptz
language sql
stable
set search_path = ''
as $$
  select (p_on + s.due_time) at time zone s.time_zone;
$$;

revoke execute on function public.task_series_due_at(public.task_series, date)
  from public, anon, authenticated;

-- The date an after-done occurrence is due: p_base plus the rule's interval.
create or replace function public.task_series_after_on(
  s public.task_series,
  p_base date
) returns date
language sql
immutable
set search_path = ''
as $$
  select (p_base + case s.unit
    when 'day' then make_interval(days => s.every)
    when 'week' then make_interval(weeks => s.every)
    when 'month' then make_interval(months => s.every)
    else make_interval(years => s.every) end)::date;
$$;

revoke execute on function public.task_series_after_on(public.task_series, date)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Making an occurrence
-- ---------------------------------------------------------------------------
-- Returns the new task's id, or null when that occurrence already exists (the
-- key is taken) or its customer link is gone. The only inserter of occurrences
-- after the first.
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
  v_assignee uuid;
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

  if s.assigned_user_id is not null and exists (
       select 1 from public.company_members cm
        where cm.company_id = s.company_id
          and cm.user_id = s.assigned_user_id
          and cm.deactivated_at is null) then
    v_assignee := s.assigned_user_id;
  end if;

  insert into public.tasks
    (company_id, conversation_id, contact_id, title, description,
     assigned_user_id, due_at, created_by_user_id, priority,
     addr_street, addr_unit, addr_city, addr_state, addr_postal_code,
     addr_country, addr_provenance,
     -- The customer-side reminder text for a repeating job is a separate,
     -- opt-in toggle (#693, not built). Until then no occurrence texts anyone.
     reminders_off,
     series_id, occurrence_no, occurrence_on)
  values
    (s.company_id, s.conversation_id, s.contact_id, s.title, s.description,
     v_assignee, p_due, s.created_by_user_id, s.priority,
     s.addr_street, s.addr_unit, s.addr_city, s.addr_state, s.addr_postal_code,
     s.addr_country, s.addr_provenance,
     true,
     s.id, p_no, p_on)
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    return null;
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

revoke execute on function public.task_series_spawn(public.task_series, int, date, timestamptz)
  from public, anon, authenticated;

-- Close a series: no more occurrences. Idempotent.
create or replace function public.task_series_stop(p_series_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.task_series
     set stopped_at = coalesce(stopped_at, now())
   where id = p_series_id;
$$;

revoke execute on function public.task_series_stop(uuid)
  from public, anon, authenticated;

-- Schedule series: keep two occurrences on or after today created. Skips the
-- days nobody was around to make (a series set on a task that is a week late
-- does not backfill a week of overdue copies).
create or replace function public.task_series_materialize(
  p_series_id uuid,
  p_now       timestamptz default now()
) returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  s        public.task_series;
  v_today  date;
  v_made   int := 0;
  v_next   date;
  v_up     int;
  v_id     uuid;
  v_loops  int;
begin
  select * into s from public.task_series where id = p_series_id for update;
  if not found or s.kind <> 'schedule' or s.paused or s.stopped_at is not null then
    return 0;
  end if;
  v_today := (p_now at time zone s.time_zone)::date;

  for v_loops in 1 .. 4 loop
    select count(*) into v_up
      from public.tasks t
     where t.series_id = s.id and t.occurrence_on >= v_today;
    exit when v_up >= 2;

    v_next := public.task_series_next_on(
      s, greatest(coalesce(s.tail_on, s.anchor_on - 1), v_today - 1));
    if v_next is null
       or (s.ends_kind = 'on' and v_next > s.ends_on)
       or (s.ends_kind = 'after' and s.tail_no >= s.ends_after) then
      -- It has run its course.
      update public.task_series set stopped_at = p_now where id = s.id;
      exit;
    end if;

    v_id := public.task_series_spawn(
      s, s.tail_no + 1, v_next, public.task_series_due_at(s, v_next));
    if v_id is null then
      -- Either the key was taken (cannot be: we hold the series row) or the
      -- customer link is gone. A series with nowhere to put work stops.
      update public.task_series set stopped_at = p_now where id = s.id;
      exit;
    end if;
    v_made := v_made + 1;
    update public.task_series
       set tail_no = s.tail_no + 1, prev_on = s.tail_on, tail_on = v_next
     where id = s.id
    returning * into s;
  end loop;
  return v_made;
end $$;

revoke execute on function public.task_series_materialize(uuid, timestamptz)
  from public, anon, authenticated;

-- After-done series: make occurrence p_no + 1, dated from p_base. Caller holds
-- the series row.
create or replace function public.task_series_spawn_after(
  s       public.task_series,
  p_no    int,
  p_base  date
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_on date := public.task_series_after_on(s, p_base);
  v_id uuid;
begin
  if (s.ends_kind = 'after' and p_no >= s.ends_after)
     or (s.ends_kind = 'on' and v_on > s.ends_on) then
    update public.task_series set stopped_at = coalesce(stopped_at, now())
     where id = s.id;
    return null;
  end if;
  v_id := public.task_series_spawn(
    s, p_no + 1, null, public.task_series_due_at(s, v_on));
  if v_id is not null then
    update public.task_series
       set tail_no = p_no + 1, prev_on = tail_on, tail_on = v_on
     where id = s.id;
  end if;
  return v_id;
end $$;

revoke execute on function public.task_series_spawn_after(public.task_series, int, date)
  from public, anon, authenticated;

-- An occurrence was completed: an after-done series makes the next one.
create or replace function public.task_series_on_done(p_task public.tasks)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s      public.task_series;
  v_done timestamptz := public.task_done_at(p_task);
begin
  if p_task.series_id is null or v_done is null then
    return null;
  end if;
  select * into s from public.task_series where id = p_task.series_id for update;
  if not found or s.kind <> 'after_done' or s.paused or s.stopped_at is not null then
    return null;
  end if;
  -- Only the newest occurrence leads to a next one; completing an older one a
  -- second time finds its successor already made.
  if p_task.occurrence_no is distinct from s.tail_no then
    return null;
  end if;
  return public.task_series_spawn_after(
    s, p_task.occurrence_no, (v_done at time zone s.time_zone)::date);
end $$;

revoke execute on function public.task_series_on_done(public.tasks)
  from public, anon, authenticated;

-- An open after-done occurrence was deleted: "skip this one". The chain would
-- end here, so the next one is made from today (or its planned date).
create or replace function public.task_series_on_skip(p_task public.tasks)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.task_series;
begin
  if p_task.series_id is null or public.task_done_at(p_task) is not null then
    return null;
  end if;
  select * into s from public.task_series where id = p_task.series_id for update;
  if not found or s.kind <> 'after_done' or s.paused or s.stopped_at is not null
     or p_task.occurrence_no is distinct from s.tail_no then
    return null;
  end if;
  return public.task_series_spawn_after(
    s, p_task.occurrence_no,
    greatest((coalesce(p_task.due_at, now()) at time zone s.time_zone)::date,
             (now() at time zone s.time_zone)::date));
end $$;

revoke execute on function public.task_series_on_skip(public.tasks)
  from public, anon, authenticated;

create or replace function public.task_series_task_done_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.task_series_on_done(new);
  return null;
end $$;

revoke execute on function public.task_series_task_done_trigger()
  from public, anon, authenticated;

create trigger task_series_task_done
  after update of done_at on public.tasks
  for each row
  when (old.done_at is null and new.done_at is not null and new.series_id is not null)
  execute function public.task_series_task_done_trigger();

-- A message task is done when its message is.
create or replace function public.task_series_message_done_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
begin
  for t in
    select * from public.tasks
     where message_id = new.id and series_id is not null and deleted_at is null
  loop
    perform public.task_series_on_done(t);
  end loop;
  return null;
end $$;

revoke execute on function public.task_series_message_done_trigger()
  from public, anon, authenticated;

create trigger task_series_message_done
  after update of done_at on public.messages
  for each row
  when (old.done_at is null and new.done_at is not null)
  execute function public.task_series_message_done_trigger();

-- ---------------------------------------------------------------------------
-- 6. The runner
-- ---------------------------------------------------------------------------
create or replace function public.api_materialize_task_repeats(
  p_limit int default 200,
  p_now   timestamptz default now()
) returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   uuid;
  v_made int := 0;
begin
  -- Coarse by a day either side of every timezone; the precise local-date test
  -- is inside task_series_materialize. SKIP LOCKED: a series another tick or a
  -- member's edit holds is theirs.
  for v_id in
    select s.id
      from public.task_series s
     where s.kind = 'schedule' and not s.paused and s.stopped_at is null
       and coalesce(s.prev_on, date '0001-01-01')
           < (p_now at time zone 'UTC')::date + 2
     order by coalesce(s.prev_on, date '0001-01-01'), s.id
     limit greatest(1, least(coalesce(p_limit, 200), 1000))
       for update skip locked
  loop
    v_made := v_made + public.task_series_materialize(v_id, p_now);
  end loop;
  return v_made;
end $$;

revoke execute on function public.api_materialize_task_repeats(int, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_materialize_task_repeats(int, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 7. Normalising a repeat rule from the API
-- ---------------------------------------------------------------------------
-- Returns the rule in the series' own columns, or {"error": "..."}.
create or replace function public.task_series_rule(
  p_rule   jsonb,
  p_anchor date
) returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_kind    text := p_rule->>'kind';
  v_unit    text := p_rule->>'unit';
  v_every   int;
  v_days    smallint[];
  v_mday    int;
  v_nth     int;
  v_nthday  int;
  v_ends    jsonb := coalesce(p_rule->'ends', '{}'::jsonb);
  v_ekind   text := coalesce(v_ends->>'kind', 'never');
  v_eon     date;
  v_eafter  int;
begin
  begin
    if v_kind not in ('schedule', 'after_done')
       or v_unit not in ('day', 'week', 'month', 'year')
       or (v_kind = 'after_done' and v_unit = 'year') then
      return jsonb_build_object('error', 'rule');
    end if;
    v_every := coalesce(nullif(p_rule->>'every', '')::int, 1);
    if v_every not between 1 and 365 then
      return jsonb_build_object('error', 'every');
    end if;

    if v_kind = 'schedule' and v_unit = 'week' then
      select coalesce(array_agg(distinct d::smallint order by d::smallint), '{}')
        into v_days
        from jsonb_array_elements_text(coalesce(p_rule->'weekdays', '[]'::jsonb)) d;
      if cardinality(v_days) = 0 then
        v_days := array[extract(isodow from p_anchor)::smallint];
      elsif not (v_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]) then
        return jsonb_build_object('error', 'weekdays');
      end if;
    end if;

    if v_kind = 'schedule' and v_unit = 'month' then
      if nullif(p_rule->>'nth', '') is not null then
        v_nth := (p_rule->>'nth')::int;
        v_nthday := coalesce(nullif(p_rule->>'nth_weekday', '')::int,
                             extract(isodow from p_anchor)::int);
        if v_nth not in (1, 2, 3, 4, -1) or v_nthday not between 1 and 7 then
          return jsonb_build_object('error', 'nth');
        end if;
      else
        v_mday := coalesce(nullif(p_rule->>'month_day', '')::int,
                           extract(day from p_anchor)::int);
        if v_mday not between 1 and 31 then
          return jsonb_build_object('error', 'month_day');
        end if;
      end if;
    end if;

    if v_ekind not in ('never', 'on', 'after') then
      return jsonb_build_object('error', 'ends');
    end if;
    if v_ekind = 'on' then
      v_eon := (v_ends->>'on')::date;
      if v_eon is null then return jsonb_build_object('error', 'ends'); end if;
    elsif v_ekind = 'after' then
      v_eafter := (v_ends->>'after')::int;
      if v_eafter is null or v_eafter not between 1 and 1000 then
        return jsonb_build_object('error', 'ends');
      end if;
    end if;
  exception when others then
    return jsonb_build_object('error', 'rule');
  end;

  return jsonb_build_object(
    'kind', v_kind, 'unit', v_unit, 'every', v_every,
    'weekdays', to_jsonb(v_days), 'month_day', v_mday,
    'nth', v_nth, 'nth_weekday', v_nthday,
    'ends_kind', v_ekind, 'ends_on', v_eon, 'ends_after', v_eafter,
    'paused', coalesce((p_rule->>'paused')::boolean, false));
end $$;

revoke execute on function public.task_series_rule(jsonb, date)
  from public, anon, authenticated;

-- The rule of a series as the history event stores it.
create or replace function public.task_series_summary(s public.task_series)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'kind', s.kind, 'unit', s.unit, 'every', s.every,
    'weekdays', to_jsonb(s.weekdays), 'month_day', s.month_day,
    'nth', s.nth, 'nth_weekday', s.nth_weekday,
    'ends_kind', s.ends_kind, 'ends_on', s.ends_on, 'ends_after', s.ends_after,
    'paused', s.paused));
$$;

revoke execute on function public.task_series_summary(public.task_series)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Setting, changing and clearing a repeat
-- ---------------------------------------------------------------------------
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
     title, description, assigned_user_id, priority,
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
     v_task.title, v_task.description, v_task.assigned_user_id, v_task.priority,
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

revoke execute on function public.api_set_task_repeat(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.api_set_task_repeat(uuid, uuid, uuid, jsonb)
  to service_role;

-- "This and future": the edit made to this occurrence is also written to the
-- series' template and to every later occurrence nobody has finished.
-- p_changes keys: title, description, assigned_user_id, priority, address
-- (object or null), labels_add, labels_remove (uuid arrays), due_at (its time
-- of day moves later occurrences) or due_time ('HH:MM').
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

  if p_changes ? 'assigned_user_id'
     and nullif(p_changes->>'assigned_user_id', '') is not null
     and not exists (
       select 1 from public.company_members cm
        where cm.company_id = p_company_id
          and cm.user_id = (p_changes->>'assigned_user_id')::uuid
          and cm.deactivated_at is null) then
    return jsonb_build_object('outcome', 'not_member');
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
         assigned_user_id = case when p_changes ? 'assigned_user_id'
                                 then nullif(p_changes->>'assigned_user_id', '')::uuid
                                 else assigned_user_id end,
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
         assigned_user_id = case when p_changes ? 'assigned_user_id'
                                 then nullif(p_changes->>'assigned_user_id', '')::uuid
                                 else t.assigned_user_id end,
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

revoke execute on function public.api_edit_task_series(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.api_edit_task_series(uuid, uuid, uuid, jsonb)
  to service_role;

-- "Delete this and future": the series stops, this task and every later
-- occurrence nobody finished are deleted; earlier and finished ones stay.
create or replace function public.api_delete_task_series(
  p_company_id    uuid,
  p_task_id       uuid,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_res  jsonb;
  v_n    int := 0;
begin
  perform set_config('loonext.task_actor', coalesce(p_actor_user_id::text, ''), true);
  select * into v_task
    from public.tasks t
   where t.company_id = p_company_id and t.id = p_task_id and t.deleted_at is null
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_task.series_id is not null then
    perform 1 from public.task_series where id = v_task.series_id for update;
    perform public.task_series_stop(v_task.series_id);
    update public.tasks t
       set deleted_at = now()
     where t.series_id = v_task.series_id and t.id <> v_task.id
       and t.occurrence_no > v_task.occurrence_no
       and t.deleted_at is null and public.task_done_at(t) is null;
    get diagnostics v_n = row_count;
  end if;
  v_res := public.delete_task(p_company_id, p_task_id, p_actor_user_id);
  return jsonb_build_object(
    'outcome', v_res->>'outcome', 'also_removed', v_n);
end $$;

revoke execute on function public.api_delete_task_series(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.api_delete_task_series(uuid, uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 9. Labels
-- ---------------------------------------------------------------------------
create or replace function public.api_set_task_tags(
  p_company_id    uuid,
  p_task_id       uuid,
  p_actor_user_id uuid,
  p_add           uuid[] default null,
  p_remove        uuid[] default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_tags jsonb;
begin
  perform set_config('loonext.task_actor', coalesce(p_actor_user_id::text, ''), true);
  select * into v_task
    from public.tasks t
   where t.company_id = p_company_id and t.id = p_task_id and t.deleted_at is null
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  -- Every tag named must be this workspace's.
  if exists (
       select 1 from unnest(coalesce(p_add, '{}') || coalesce(p_remove, '{}')) x
        where not exists (select 1 from public.tags g
                           where g.id = x and g.company_id = p_company_id)) then
    return jsonb_build_object('outcome', 'tag_not_found');
  end if;

  delete from public.task_tags
   where task_id = p_task_id and tag_id = any (coalesce(p_remove, '{}'));
  insert into public.task_tags (company_id, task_id, tag_id)
  select p_company_id, p_task_id, x
    from unnest(coalesce(p_add, '{}')) x
  on conflict do nothing;

  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'color', g.color)
                            order by lower(g.name)), '[]'::jsonb)
    into v_tags
    from public.task_tags k join public.tags g on g.id = k.tag_id
   where k.task_id = p_task_id;
  return jsonb_build_object('outcome', 'updated', 'labels', v_tags);
end $$;

revoke execute on function public.api_set_task_tags(uuid, uuid, uuid, uuid[], uuid[])
  from public, anon, authenticated;
grant execute on function public.api_set_task_tags(uuid, uuid, uuid, uuid[], uuid[])
  to service_role;

-- api_merge_tags: from 20261110140000_contacts_carry_tags.sql with the task
-- links (and the series templates) folded in too.
create or replace function public.api_merge_tags(
  p_company_id uuid,
  p_from_tag   uuid,
  p_into_tag   uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from public.tags;
  v_into public.tags;
  v_moved integer;
  v_merged integer;
begin
  select * into v_from from public.tags
   where id = p_from_tag and company_id = p_company_id;
  select * into v_into from public.tags
   where id = p_into_tag and company_id = p_company_id;

  if v_from.id is null or v_into.id is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_from.id = v_into.id then
    return jsonb_build_object('outcome', 'same_tag');
  end if;

  if v_from.pipeline_stage is not null and v_into.pipeline_stage is not null then
    return jsonb_build_object(
      'outcome', 'two_stages',
      'from_stage', v_from.pipeline_stage,
      'into_stage', v_into.pipeline_stage);
  end if;

  update public.conversation_tags into_row
     set created_at = least(into_row.created_at, from_row.created_at)
    from public.conversation_tags from_row
   where into_row.tag_id = p_into_tag
     and from_row.tag_id = p_from_tag
     and from_row.conversation_id = into_row.conversation_id;
  get diagnostics v_merged = row_count;

  delete from public.conversation_tags dup
   where dup.tag_id = p_from_tag
     and exists (select 1 from public.conversation_tags keep
                  where keep.tag_id = p_into_tag
                    and keep.conversation_id = dup.conversation_id);

  update public.conversation_tags set tag_id = p_into_tag where tag_id = p_from_tag;
  get diagnostics v_moved = row_count;

  update public.contact_tags into_row
     set created_at = least(into_row.created_at, from_row.created_at)
    from public.contact_tags from_row
   where into_row.tag_id = p_into_tag
     and from_row.tag_id = p_from_tag
     and from_row.contact_id = into_row.contact_id;

  delete from public.contact_tags dup
   where dup.tag_id = p_from_tag
     and exists (select 1 from public.contact_tags keep
                  where keep.tag_id = p_into_tag
                    and keep.contact_id = dup.contact_id);

  update public.contact_tags set tag_id = p_into_tag where tag_id = p_from_tag;

  -- #693: the same fold for tasks. Not a person labelling anything, so quiet.
  perform set_config('loonext.task_tags_quiet', 'on', true);
  update public.task_tags into_row
     set created_at = least(into_row.created_at, from_row.created_at)
    from public.task_tags from_row
   where into_row.tag_id = p_into_tag
     and from_row.tag_id = p_from_tag
     and from_row.task_id = into_row.task_id;

  delete from public.task_tags dup
   where dup.tag_id = p_from_tag
     and exists (select 1 from public.task_tags keep
                  where keep.tag_id = p_into_tag
                    and keep.task_id = dup.task_id);

  update public.task_tags set tag_id = p_into_tag where tag_id = p_from_tag;
  perform set_config('loonext.task_tags_quiet', '', true);

  update public.task_series
     set label_ids = (
       select coalesce(array_agg(distinct case when x = p_from_tag then p_into_tag else x end), '{}')
         from unnest(label_ids) x)
   where company_id = p_company_id and p_from_tag = any (label_ids);

  if v_from.pipeline_stage is not null then
    update public.tags set pipeline_stage = null where id = p_from_tag;
    update public.tags set pipeline_stage = v_from.pipeline_stage
     where id = p_into_tag;
  end if;

  delete from public.tags where id = p_from_tag;

  return jsonb_build_object(
    'outcome', 'merged',
    'moved', v_moved,
    'already_both', v_merged,
    'stage_moved', v_from.pipeline_stage is not null);
end;
$$;

revoke execute on function public.api_merge_tags(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.api_merge_tags(uuid, uuid, uuid) to service_role;

-- api_tag_usage: a tag used only on tasks is not a dead tag.
create or replace function public.api_tag_usage(p_company_id uuid)
returns table (
  tag_id      uuid,
  name        text,
  description text,
  uses        bigint,
  last_used   timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id,
    t.name,
    t.description,
    (select count(*) from public.conversation_tags ct where ct.tag_id = t.id)
      + (select count(*) from public.contact_tags kt where kt.tag_id = t.id)
      + (select count(*) from public.task_tags tt where tt.tag_id = t.id),
    greatest(
      (select max(ct.created_at) from public.conversation_tags ct where ct.tag_id = t.id),
      (select max(kt.created_at) from public.contact_tags kt where kt.tag_id = t.id),
      (select max(tt.created_at) from public.task_tags tt where tt.tag_id = t.id)
    )
  from public.tags t
  where t.company_id = p_company_id
  order by 4 desc, t.name
$$;

revoke execute on function public.api_tag_usage(uuid) from public, anon, authenticated;
grant execute on function public.api_tag_usage(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 10. The map view carries priority and the series
-- ---------------------------------------------------------------------------
create or replace view public.task_map_rows
  with (security_invoker = true) as
select
  t.id, t.company_id, t.message_id, t.conversation_id, t.title, t.description,
  t.assigned_user_id, t.due_at, t.created_by_user_id, t.created_at, t.updated_at,
  t.addr_street, t.addr_unit, t.addr_city, t.addr_state, t.addr_postal_code,
  t.addr_country, t.addr_provenance, t.lat, t.lng, t.deleted_at,
  coalesce(m.done_at, t.done_at) as done_at,
  cv.phone_number_id,
  c.id   as contact_id,
  c.name as contact_name,
  c.lat  as contact_lat,
  c.lng  as contact_lng,
  coalesce(t.lat, c.lat) as map_lat,
  coalesce(t.lng, c.lng) as map_lng,
  t.reminders_off,
  t.confirmed_at,
  t.confirmed_by,
  t.source_call_id,
  t.priority,
  t.priority_rank,
  t.series_id,
  t.occurrence_no
from public.tasks t
left join public.conversations cv on cv.id = t.conversation_id
left join public.contacts      c  on c.id  = coalesce(cv.contact_id, t.contact_id)
left join public.messages      m  on m.id  = t.message_id;

-- ---------------------------------------------------------------------------
-- 11. create_task: a priority. Copied from 20261110150000_standalone_tasks.sql;
--     the changes are p_priority, its check and the insert column.
-- ---------------------------------------------------------------------------
drop function public.create_task(
  uuid, uuid, text, text, uuid, timestamptz, uuid,
  text, text, text, text, text, text, text, uuid, uuid, uuid);

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
  p_priority         text default 'normal'
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

  -- Assignee must be an active member of the company (validation_failed).
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
       title, description, assigned_user_id, due_at, created_by_user_id,
       addr_street, addr_unit, addr_city, addr_state, addr_postal_code,
       addr_country, addr_provenance, reminders_off, priority)
    values
      (p_company_id, p_message_id, p_call_id, v_conversation_id, v_contact_id,
       v_title, coalesce(p_description, ''), p_assigned_user_id, p_due_at,
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
  text, text, text, text, text, text, text, uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_task(
  uuid, uuid, text, text, uuid, timestamptz, uuid,
  text, text, text, text, text, text, text, uuid, uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 12. update_task: a priority. Copied from 20261110160000; the changes are
--     p_priority and the lines that read it.
-- ---------------------------------------------------------------------------
drop function public.update_task(
  uuid, uuid, text, text, timestamptz, boolean, uuid,
  boolean, text, text, text, text, text, text, text);

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
  p_addr_provenance  text default null,
  p_priority         text default null
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
  v_new_prio     text;
  v_has_address  boolean;
  v_due_changed  boolean := false;
  v_addr_changed boolean := false;
  v_changed      boolean := false;
  v_prior_actor  text := coalesce(current_setting('loonext.schedule_actor', true), '');
begin
  -- #689 E: who is making this change, for the task_events triggers.
  perform set_config('loonext.task_actor', coalesce(p_actor_user_id::text, ''), true);
  if p_priority is not null
     and p_priority not in ('none', 'low', 'normal', 'high', 'urgent') then
    return jsonb_build_object('outcome', 'bad_priority', 'task', null);
  end if;
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
  v_new_prio  := coalesce(p_priority, v_task.priority);
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
            or (v_new_prio  is distinct from v_task.priority)
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
         priority = v_new_prio,
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

revoke execute on function public.update_task(
  uuid, uuid, text, text, timestamptz, boolean, uuid,
  boolean, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.update_task(
  uuid, uuid, text, text, timestamptz, boolean, uuid,
  boolean, text, text, text, text, text, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 13. delete_task: deleting an open after-done occurrence skips it. Copied from
--     20261110160000; the only change is the task_series_on_skip call.
-- ---------------------------------------------------------------------------
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

  -- #693: deleting an open occurrence of a repeat skips it. A schedule series
  -- has its next ones already; an after-done series would end here, so the next
  -- is made now.
  perform public.task_series_on_skip(v_task);

  return jsonb_build_object('outcome', 'deleted');
end $function$;

revoke execute on function public.delete_task(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_task(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 14. api_bulk_tasks: priority and labels. Copied from 20261110160000; the
--     changes are the two trailing parameters, the three actions and the
--     skip call in delete.
-- ---------------------------------------------------------------------------
drop function public.api_bulk_tasks(uuid, uuid, text, uuid[], uuid, uuid[]);

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
  p_tag_id         uuid    default null
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
  uuid, uuid, text, uuid[], uuid, uuid[], text, uuid)
  from public, anon, authenticated;
grant execute on function public.api_bulk_tasks(
  uuid, uuid, text, uuid[], uuid, uuid[], text, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 15. api_contact_timeline: a task entry says which repeat it belongs to.
--     Copied from 20261110170000_deletion_and_trash.sql; the changes are the
--     `series_id` and `repeat` columns.
-- ---------------------------------------------------------------------------
create or replace function public.api_contact_timeline(
  p_company_id uuid,
  p_contact_id uuid,
  p_limit      int default 50,
  -- The decoded halves of the opaque cursor. Both null on the first page; the
  -- API layer never passes one without the other.
  p_before_ts  timestamptz default null,
  p_before_id  uuid default null
) returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with entries as (
    -- CONVERSATIONS, ordered by last activity rather than creation: a thread
    -- reopened last week belongs beside last week.
    select
      'conversation'::text as kind,
      c.id                 as id,
      coalesce(c.last_message_at, c.created_at) as occurred_at,
      c.id                 as conversation_id,
      c.status::text       as status,
      null::text           as detail,
      c.created_at         as started_at,
      null::int            as talk_seconds,
      null::timestamptz    as due_at,
      null::boolean        as done,
      null::uuid           as series_id,
      null::jsonb          as repeat
    from public.conversations c
    where c.company_id = p_company_id
      and c.deleted_at is null
      and c.contact_id = p_contact_id
      -- A spam thread is not part of the relationship. It stays reachable in
      -- the inbox's spam view; here it would be the one entry that makes the
      -- rest untrustworthy.
      and coalesce(c.is_spam, false) = false

    union all

    select
      'call'::text,
      k.id,
      k.started_at,
      k.conversation_id,
      k.outcome::text,
      k.caller_name,
      k.started_at,
      -- Talk time: the forward leg's billable seconds, never ring time.
      k.forward_seconds,
      null::timestamptz,
      null::boolean,
      null::uuid,
      null::jsonb
    from public.calls k
    where k.company_id = p_company_id
      and k.deleted_at is null
      and k.contact_id = p_contact_id

    union all

    -- TASKS, via their conversation, or via their own contact (#689 standalone). `done` is the source message's done_at exactly as the
    -- checklist reads it (D17), or the task's own done_at when it was promoted
    -- from a call (D64); never both.
    select
      'task'::text,
      t.id,
      t.created_at,
      t.conversation_id,
      null::text,
      t.title,
      t.created_at,
      null::int,
      t.due_at,
      coalesce(m.done_at, t.done_at) is not null,
      t.series_id,
      case when s.id is not null then jsonb_build_object(
        'kind', s.kind, 'unit', s.unit, 'every', s.every,
        'paused', s.paused, 'stopped', s.stopped_at is not null) end
    from public.tasks t
    left join public.conversations tc on tc.id = t.conversation_id
    left join public.messages m on m.id = t.message_id
    left join public.task_series s on s.id = t.series_id
    where t.company_id = p_company_id
      and coalesce(tc.contact_id, t.contact_id) = p_contact_id
      and t.deleted_at is null
  )
  select jsonb_build_object(
    'kind', e.kind,
    'id', e.id,
    'occurred_at', e.occurred_at,
    'conversation_id', e.conversation_id,
    'status', e.status,
    'detail', e.detail,
    'started_at', e.started_at,
    'talk_seconds', e.talk_seconds,
    'due_at', e.due_at,
    'done', e.done,
    'series_id', e.series_id,
    'repeat', e.repeat
  )
  from entries e
  where p_before_ts is null
     -- ROW-WISE, matching the ORDER BY exactly. Comparing only the timestamp
     -- skips the second of any two entries that share one.
     or (e.occurred_at, e.id) < (p_before_ts, p_before_id)
  order by e.occurred_at desc, e.id desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

revoke execute on function public.api_contact_timeline(uuid, uuid, int, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.api_contact_timeline(uuid, uuid, int, timestamptz, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 16. The erasure paths learn the new tables, rewritten from the live
--     definitions so a later change cannot be reverted by a stale copy here.
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_def text;
  v_new text;
begin
  -- The workspace purge roster: the series after the tasks that point at it.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'purge_workspace_step';
  v_new := replace(v_def, $$'usage_events', 'tasks',$$, $$'usage_events', 'tasks', 'task_series',$$);
  if v_new = v_def then
    raise exception 'purge_workspace_step: the roster anchor was not found';
  end if;
  execute v_new;

  -- Deleting content for good stops the repeats made from it and blanks their
  -- template, which was copied from the same words.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'api_purge_trash_item';
  v_new := replace(v_def,
    $$-- A task made from deleted content is removed the way a person would remove$$,
    $$-- #693: a repeat made from it stops and loses its copy of the words.
  update public.task_series s
     set stopped_at = coalesce(s.stopped_at, now()),
         title = 'Removed', description = '',
         addr_street = null, addr_unit = null, addr_city = null,
         addr_state = null, addr_postal_code = null, addr_country = null,
         addr_provenance = null, conversation_id = null, contact_id = null
   where not v_vm_only
     and s.id in (select t.series_id from public.tasks t
                   where t.id = any (v_tasks) and t.series_id is not null);
  -- A task made from deleted content is removed the way a person would remove$$);
  if v_new = v_def then
    raise exception 'api_purge_trash_item: the task anchor was not found';
  end if;
  execute v_new;

  -- A merged contact's repeats follow it.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'api_merge_contacts';
  v_new := replace(v_def,
    $$-- #689: so does a standalone task linked straight to the contact.$$,
    $$-- #693: and the repeats made for them.
  update public.task_series set contact_id = p_into
   where company_id = p_company_id and contact_id = p_from;

  -- #689: so does a standalone task linked straight to the contact.$$);
  if v_new = v_def then
    raise exception 'api_merge_contacts: the task anchor was not found';
  end if;
  execute v_new;
end $mig$;

-- pg_get_functiondef round-trips each function's attributes, but a function
-- recreated this way regains the hosted EXECUTE default.
revoke execute on function public.purge_workspace_step(uuid, int)
  from public, anon, authenticated;
grant execute on function public.purge_workspace_step(uuid, int) to service_role;

revoke execute on function public.api_purge_trash_item(text, uuid, uuid, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.api_purge_trash_item(text, uuid, uuid, uuid, uuid[])
  to service_role;
revoke execute on function public.api_merge_contacts(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.api_merge_contacts(uuid, uuid, uuid, uuid)
  to service_role;
