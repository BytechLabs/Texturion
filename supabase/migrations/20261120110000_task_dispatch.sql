alter table public.companies add column dispatch_revision integer not null default 0;
alter table public.tasks
  add column dispatch_estimate integer check (dispatch_estimate between 5 and 720),
  add column dispatch_windows tstzmultirange not null default '{}';

alter table public.tasks add constraint tasks_dispatch_company_id_key unique (company_id, id);

create table public.task_schedule_blocks (
  id uuid primary key,
  company_id uuid not null,
  task_id uuid not null,
  assignee_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  locked boolean not null default false,
  address_key text,
  foreign key (company_id, task_id) references public.tasks(company_id, id) on delete cascade,
  foreign key (company_id, assignee_id) references public.company_members(company_id, user_id) on delete cascade,
  check (ends_at - starts_at between interval '5 minutes' and interval '12 hours')
);

create index task_schedule_blocks_day_idx on public.task_schedule_blocks(company_id, starts_at);
create index task_schedule_blocks_task_idx on public.task_schedule_blocks(company_id, task_id);
create index task_schedule_blocks_assignee_idx on public.task_schedule_blocks(company_id, assignee_id, starts_at);

alter table public.task_schedule_blocks enable row level security;
revoke all on public.task_schedule_blocks from public, anon, authenticated;
grant select, insert, update, delete on public.task_schedule_blocks to service_role;

create function public.task_scheduled_start(p_company uuid, p_task uuid)
returns timestamptz language sql stable set search_path = '' as $$
  select coalesce(min(b.starts_at) filter (where b.ends_at > now()), max(b.starts_at))
  from public.task_schedule_blocks b
  join public.company_members cm on cm.company_id = b.company_id and cm.user_id = b.assignee_id
  where b.company_id = p_company and b.task_id = p_task and cm.deactivated_at is null
$$;

create function public.task_scheduled_start(t public.tasks)
returns timestamptz language sql stable set search_path = '' as $$
  select public.task_scheduled_start(t.company_id, t.id)
$$;

create function public.task_scheduled_start(t public.task_map_rows)
returns timestamptz language sql stable set search_path = '' as $$
  select public.task_scheduled_start(t.company_id, t.id)
$$;

revoke all on function public.task_scheduled_start(uuid, uuid), public.task_scheduled_start(public.tasks),
  public.task_scheduled_start(public.task_map_rows) from public, anon, authenticated;
grant execute on function public.task_scheduled_start(uuid, uuid), public.task_scheduled_start(public.tasks),
  public.task_scheduled_start(public.task_map_rows) to service_role;

create function public.dispatch_address(t public.tasks)
returns text language sql immutable set search_path = '' as $$
  select case when nullif(btrim(t.addr_street), '') is not null then
    concat_ws(', ', nullif(t.addr_street, ''), nullif(t.addr_unit, ''),
      nullif(t.addr_city, ''), nullif(t.addr_state, ''), nullif(t.addr_postal_code, ''),
      nullif(t.addr_country, ''))
  end
$$;
revoke all on function public.dispatch_address(public.tasks) from public, anon, authenticated;
grant execute on function public.dispatch_address(public.tasks) to service_role;

create function public.api_dispatch_read(
  p_company_id uuid, p_actor_id uuid, p_day date, p_days integer, p_task_id uuid default null
)
returns jsonb language sql stable set search_path = '' as $$
  with workspace as (
    select co.*,
      p_day::timestamp at time zone co.timezone as range_start,
      (p_day + p_days)::timestamp at time zone co.timezone as range_end
    from public.companies co
    where co.id = p_company_id and p_days between 1 and 14
      and exists (select 1 from public.company_members cm where cm.company_id = co.id
        and cm.user_id = p_actor_id and cm.deactivated_at is null)
  ), hidden as (
    select phone_number_id from public.member_number_levels(p_actor_id, p_company_id)
    where level = 'none'
  ), active_blocks as (
    select b.*
    from workspace w join public.task_schedule_blocks b on b.company_id = w.id
    join public.company_members cm on cm.company_id = b.company_id and cm.user_id = b.assignee_id
    where b.starts_at < w.range_end and b.ends_at > w.range_start
      and cm.deactivated_at is null
  ), relevant as (
    select t.id, t.title, t.due_on, t.due_at, t.dispatch_estimate, t.dispatch_windows,
      t.conversation_id, t.message_id, t.source_call_id,
      public.dispatch_address(t) as address, t.lat, t.lng, t.updated_at,
      t.assigned_user_id, public.task_done_at(t) is not null as done,
      (select count(*) from public.task_schedule_blocks b
        join public.company_members cm on cm.company_id = b.company_id and cm.user_id = b.assignee_id
        where b.company_id = w.id and b.task_id = t.id and cm.deactivated_at is null) as scheduled_count
    from workspace w join public.tasks t on t.company_id = w.id
    left join public.conversations c on c.company_id = w.id and c.id = t.conversation_id
    where t.deleted_at is null
      and not exists (select 1 from hidden h where h.phone_number_id = c.phone_number_id)
      and (t.id = p_task_id or public.task_done_at(t) is null
        or exists (select 1 from active_blocks b where b.task_id = t.id))
  ), queue as (
    select r.* from relevant r
    order by (r.id is not distinct from p_task_id) desc, r.due_on nulls last,
      r.due_at nulls last, r.updated_at desc, r.id
    limit 201
  ), days as (
    select p_day + n as day, w.timezone,
      case when e.entry is not null then e.entry -> 'hours'
        else w.business_hours -> lower(to_char(p_day + n, 'Dy')) end as hours
    from workspace w cross join generate_series(0, p_days - 1) n
    left join lateral (
      select item as entry from jsonb_array_elements(w.business_hours_exceptions) item
      where (p_day + n)::text between item ->> 'from' and item ->> 'to'
      limit 1
    ) e on true
  )
  select jsonb_build_object(
    'revision', w.dispatch_revision, 'timezone', w.timezone,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('id', cm.user_id, 'name', p.display_name)
        order by p.display_name, cm.user_id)
      from public.company_members cm left join public.profiles p on p.user_id = cm.user_id
      where cm.company_id = w.id and cm.deactivated_at is null
    ), '[]'::jsonb),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('date', d.day,
        'start', d.day::timestamp at time zone d.timezone,
        'end', (d.day + 1)::timestamp at time zone d.timezone,
        'closed', coalesce(d.hours = 'null'::jsonb, w.business_hours <> '{}'::jsonb),
        'opens_at', (d.day + (d.hours ->> 'open')::time) at time zone d.timezone,
        'closes_at', (d.day + (d.hours ->> 'close')::time +
          case when d.hours ->> 'close' < d.hours ->> 'open' then interval '1 day' else interval '0' end)
          at time zone d.timezone) order by d.day)
      from days d
    ), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg((to_jsonb(q) - 'dispatch_windows') || jsonb_build_object('windows',
        coalesce((select jsonb_agg(jsonb_build_object('start', lower(a), 'end', upper(a)))
          from unnest(q.dispatch_windows) a), '[]'::jsonb)) order by q.due_on nulls last, q.due_at nulls last, q.id)
      from relevant q
      where exists (select 1 from queue x where x.id = q.id)
        or exists (select 1 from active_blocks b where b.task_id = q.id)
    ), '[]'::jsonb),
    'queue_truncated', (select count(*) > 200 from queue),
    'blocks', coalesce((
      select jsonb_agg((to_jsonb(b) - 'company_id' - 'address_key') ||
        jsonb_build_object('visit', b.address_key is not null,
          'address_confirmed', coalesce(b.address_key = md5(r.address), false))
        order by b.starts_at, b.id)
      from active_blocks b join relevant r on r.id = b.task_id
    ), '[]'::jsonb)
  ) from workspace w
$$;
revoke all on function public.api_dispatch_read(uuid, uuid, date, integer, uuid) from public, anon, authenticated;
grant execute on function public.api_dispatch_read(uuid, uuid, date, integer, uuid) to service_role;

create function public.api_dispatch_publish(
  p_company_id uuid, p_actor_id uuid, p_revision integer, p_blocks jsonb, p_details jsonb
)
returns text language plpgsql set search_path = '' as $$
declare
  v_revision integer;
  v_change record;
  v_task public.tasks;
  v_number_id uuid;
  v_old public.task_schedule_blocks;
  v_windows tstzmultirange;
begin
  if not exists (select 1 from public.company_members cm where cm.company_id = p_company_id
    and cm.user_id = p_actor_id and cm.deactivated_at is null) then
    return 'not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text, 876));
  select dispatch_revision into v_revision from public.companies where id = p_company_id;
  if v_revision is distinct from p_revision then return 'stale'; end if;

  for v_change in
    select a.task_id, a.updated_at from jsonb_to_recordset(p_blocks) a(task_id uuid, updated_at timestamptz)
    union
    select a.task_id, a.updated_at from jsonb_to_recordset(p_details) a(task_id uuid, updated_at timestamptz)
    order by task_id
  loop
    select t.* into v_task from public.tasks t
      where t.company_id = p_company_id and t.id = v_change.task_id and t.deleted_at is null
      for update;
    if not found then return 'not_found'; end if;
    select c.phone_number_id into v_number_id from public.conversations c
      where c.company_id = p_company_id and c.id = v_task.conversation_id;
    if v_number_id is not null and public.member_number_level(p_actor_id, v_number_id) = 'none' then
      return 'not_found';
    end if;
    if v_task.updated_at is distinct from v_change.updated_at then return 'stale'; end if;
  end loop;

  for v_change in select * from jsonb_to_recordset(p_details)
    as d(task_id uuid, estimate integer, windows jsonb)
  loop
    select coalesce(range_agg(tstzrange(w.start, w."end", '[)')), '{}')
      into v_windows from jsonb_to_recordset(v_change.windows) w(start timestamptz, "end" timestamptz);
    if exists (
      select 1 from public.task_schedule_blocks b
      where b.company_id = p_company_id and b.task_id = v_change.task_id
        and not isempty(v_windows) and not (v_windows @> tstzrange(b.starts_at, b.ends_at, '[)'))
        and not exists (select 1 from jsonb_to_recordset(p_blocks) e(id uuid) where e.id = b.id)
    ) then return 'window'; end if;
  end loop;

  for v_change in select * from jsonb_to_recordset(p_blocks) as b(
    id uuid, task_id uuid, remove boolean, assignee_id uuid, starts_at timestamptz, ends_at timestamptz,
    visit boolean, confirm_address boolean, locked boolean, reschedule boolean
  )
  loop
    select * into v_old from public.task_schedule_blocks b where b.id = v_change.id;
    if found then
      if v_old.company_id <> p_company_id or v_old.task_id <> v_change.task_id then return 'not_found'; end if;
      if v_old.locked and not v_change.reschedule and
        (v_change.remove or not v_change.locked or
         row(v_old.assignee_id, v_old.starts_at, v_old.ends_at, v_old.address_key is not null)
          is distinct from row(v_change.assignee_id, v_change.starts_at, v_change.ends_at, v_change.visit))
      then return 'locked'; end if;
    elsif v_change.remove then
      return 'not_found';
    end if;
    if v_change.remove then continue; end if;

    select t.* into strict v_task from public.tasks t
      where t.company_id = p_company_id and t.id = v_change.task_id;
    select c.phone_number_id into v_number_id from public.conversations c
      where c.company_id = p_company_id and c.id = v_task.conversation_id;
    if not exists (select 1 from public.company_members cm where cm.company_id = p_company_id
      and cm.user_id = v_change.assignee_id and cm.deactivated_at is null)
      or (v_number_id is not null and public.member_number_level(v_change.assignee_id, v_number_id) = 'none')
    then return 'assignee'; end if;
    if v_change.visit and (public.dispatch_address(v_task) is null or
      (not v_change.confirm_address and v_old.address_key is distinct from md5(public.dispatch_address(v_task))))
    then return 'address'; end if;

    select coalesce(range_agg(tstzrange(w.start, w."end", '[)')), '{}')
      into v_windows from jsonb_to_recordset(p_details) d(task_id uuid, windows jsonb)
      cross join lateral jsonb_to_recordset(d.windows) w(start timestamptz, "end" timestamptz)
      where d.task_id = v_change.task_id;
    if not exists (select 1 from jsonb_to_recordset(p_details) d(task_id uuid) where d.task_id = v_change.task_id)
    then v_windows := v_task.dispatch_windows; end if;
    if v_change.ends_at - v_change.starts_at not between interval '5 minutes' and interval '12 hours'
    then return 'duration'; end if;
    if not isempty(v_windows) and not (v_windows @> tstzrange(v_change.starts_at, v_change.ends_at, '[)'))
    then return 'window'; end if;
    if exists (
      select 1 from public.task_schedule_blocks b
      join public.tasks t on t.company_id = b.company_id and t.id = b.task_id and t.deleted_at is null
      where b.company_id = p_company_id and b.assignee_id = v_change.assignee_id
        and b.starts_at < v_change.ends_at and b.ends_at > v_change.starts_at
        and not exists (select 1 from jsonb_to_recordset(p_blocks) e(id uuid) where e.id = b.id)
    ) or exists (
      select 1 from jsonb_to_recordset(p_blocks) b(
        id uuid, remove boolean, assignee_id uuid, starts_at timestamptz, ends_at timestamptz
      ) where b.id <> v_change.id and not b.remove and b.assignee_id = v_change.assignee_id
        and b.starts_at < v_change.ends_at and b.ends_at > v_change.starts_at
    ) then return 'overlap'; end if;
  end loop;

  update public.tasks t
    set dispatch_estimate = d.estimate, dispatch_windows = coalesce((
      select range_agg(tstzrange(w.start, w."end", '[)'))
      from jsonb_to_recordset(d.windows) w(start timestamptz, "end" timestamptz)
    ), '{}')
    from jsonb_to_recordset(p_details) d(task_id uuid, estimate integer, windows jsonb)
    where t.company_id = p_company_id and t.id = d.task_id;

  delete from public.task_schedule_blocks b using jsonb_to_recordset(p_blocks) e(id uuid, remove boolean)
    where b.company_id = p_company_id and b.id = e.id and e.remove;
  insert into public.task_schedule_blocks (id, company_id, task_id, assignee_id, starts_at, ends_at, locked, address_key)
    select b.id, p_company_id, b.task_id, b.assignee_id, b.starts_at, b.ends_at, b.locked,
      case when b.visit then md5(public.dispatch_address(t)) end
    from jsonb_to_recordset(p_blocks) b(id uuid, task_id uuid, remove boolean, assignee_id uuid,
      starts_at timestamptz, ends_at timestamptz, locked boolean, visit boolean)
    join public.tasks t on t.company_id = p_company_id and t.id = b.task_id
    where not b.remove
    on conflict (id) do update set assignee_id = excluded.assignee_id, starts_at = excluded.starts_at,
      ends_at = excluded.ends_at, locked = excluded.locked, address_key = excluded.address_key
      where task_schedule_blocks.company_id = excluded.company_id
        and task_schedule_blocks.task_id = excluded.task_id;

  update public.companies set dispatch_revision = dispatch_revision + 1 where id = p_company_id;
  return 'ok';
end;
$$;
revoke all on function public.api_dispatch_publish(uuid, uuid, integer, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.api_dispatch_publish(uuid, uuid, integer, jsonb, jsonb) to service_role;

create function public.erase_task_dispatch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.dispatch_estimate := null;
  new.dispatch_windows := '{}';
  delete from public.task_schedule_blocks b where b.company_id = new.company_id and b.task_id = new.id;
  return new;
end;
$$;
revoke all on function public.erase_task_dispatch() from public, anon, authenticated;

create trigger erase_task_dispatch before update of purged_at on public.tasks
for each row when (old.purged_at is null and new.purged_at is not null)
execute function public.erase_task_dispatch();

do $migration$
declare
  original text := pg_get_functiondef('public.purge_workspace_step(uuid,integer)'::regprocedure);
  updated text;
begin
  updated := replace(original, '''usage_events'', ''tasks''', '''usage_events'', ''task_schedule_blocks'', ''tasks''');
  if updated = original then
    raise exception 'Workspace purge order changed';
  end if;
  execute updated;
end;
$migration$;
