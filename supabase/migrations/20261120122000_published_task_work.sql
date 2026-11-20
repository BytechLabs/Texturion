create function public.task_scheduled_times(p_company uuid, p_task uuid)
returns tstzmultirange language sql stable set search_path = '' as $$
  select coalesce(range_agg(tstzrange(b.starts_at, b.ends_at, '[)')), '{}')
  from public.task_schedule_blocks b
  join public.company_members cm on cm.company_id = b.company_id and cm.user_id = b.assignee_id
  where b.company_id = p_company and b.task_id = p_task and cm.deactivated_at is null
$$;

create function public.task_scheduled_times(t public.tasks)
returns tstzmultirange language sql stable set search_path = '' as $$
  select public.task_scheduled_times(t.company_id, t.id)
$$;

create function public.task_scheduled_times(t public.task_map_rows)
returns tstzmultirange language sql stable set search_path = '' as $$
  select public.task_scheduled_times(t.company_id, t.id)
$$;

create function public.api_task_published_work(
  p_company uuid, p_actor uuid, p_tasks uuid[], p_start timestamptz, p_end timestamptz
)
returns table (id uuid, task_id uuid, starts_at timestamptz, ends_at timestamptz, assignee_id uuid, visit boolean)
language sql stable set search_path = '' as $$
  select b.id, b.task_id, b.starts_at, b.ends_at, b.assignee_id, b.address_key is not null
  from public.task_schedule_blocks b
  join public.company_members cm on cm.company_id = b.company_id and cm.user_id = b.assignee_id
  join public.tasks t on t.company_id = b.company_id and t.id = b.task_id
  left join public.conversations c on c.company_id = t.company_id and c.id = t.conversation_id
  where b.company_id = p_company and b.task_id = any(p_tasks) and t.deleted_at is null
    and cm.deactivated_at is null and b.starts_at < p_end and b.ends_at > p_start
    and exists (select 1 from public.company_members viewer where viewer.company_id = p_company
      and viewer.user_id = p_actor and viewer.deactivated_at is null)
    and (c.phone_number_id is null or public.member_number_level(p_actor, c.phone_number_id) <> 'none')
  order by b.starts_at, b.id
$$;

revoke all on function public.task_scheduled_times(uuid, uuid), public.task_scheduled_times(public.tasks),
  public.task_scheduled_times(public.task_map_rows),
  public.api_task_published_work(uuid, uuid, uuid[], timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.task_scheduled_times(uuid, uuid), public.task_scheduled_times(public.tasks),
  public.task_scheduled_times(public.task_map_rows),
  public.api_task_published_work(uuid, uuid, uuid[], timestamptz, timestamptz) to service_role;

do $$
declare
  definition text := pg_get_functiondef('public.api_dispatch_publish(uuid,uuid,integer,jsonb,jsonb)'::regprocedure);
  needle text := '  update public.companies set dispatch_revision = dispatch_revision + 1 where id = p_company_id;';
begin
  if strpos(definition, needle) = 0 then raise exception 'Dispatch publication changed'; end if;
  execute replace(definition, needle, $new$  for v_change in
    select distinct t.conversation_id, c.phone_number_id
    from jsonb_to_recordset(p_blocks) b(task_id uuid)
    join public.tasks t on t.company_id = p_company_id and t.id = b.task_id
    left join public.conversations c on c.company_id = t.company_id and c.id = t.conversation_id
  loop
    perform public.broadcast_number_scoped(jsonb_build_object('conversation_id', v_change.conversation_id),
      'task.changed', p_company_id, v_change.phone_number_id);
  end loop;
$new$ || needle);
end;
$$;
