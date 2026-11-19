alter table public.tasks
  add column due_on date,
  add column due_time_set boolean generated always as (due_on is null) stored,
  add constraint tasks_one_due_precision check (due_on is null or due_at is null);

create or replace view public.task_map_rows
  with (security_invoker = true) as
select
  t.id, t.company_id, t.message_id, t.conversation_id, t.title, t.description,
  t.assigned_user_id, t.due_at, t.created_by_user_id, t.created_at, t.updated_at,
  t.addr_street, t.addr_unit, t.addr_city, t.addr_state, t.addr_postal_code,
  t.addr_country, t.addr_provenance, t.lat, t.lng, t.deleted_at,
  coalesce(m.done_at, t.done_at) as done_at,
  cv.phone_number_id,
  c.id as contact_id,
  c.name as contact_name,
  c.lat as contact_lat,
  c.lng as contact_lng,
  coalesce(t.lat, c.lat) as map_lat,
  coalesce(t.lng, c.lng) as map_lng,
  t.reminders_off, t.confirmed_at, t.confirmed_by, t.source_call_id,
  t.priority, t.priority_rank, t.series_id, t.occurrence_no, t.number,
  t.due_on, t.due_time_set
from public.tasks t
left join public.conversations cv on cv.id = t.conversation_id
left join public.contacts c on c.id = coalesce(cv.contact_id, t.contact_id)
left join public.messages m on m.id = t.message_id;

create function public.set_task_due_on(
  p_company_id uuid,
  p_task_id uuid,
  p_actor_user_id uuid,
  p_due_on date
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_task public.tasks;
begin
  select * into v_task from public.tasks t
   where t.company_id = p_company_id and t.id = p_task_id and t.deleted_at is null
   for update;
  if not found
     or not public.calendar_task_access_allowed(p_actor_user_id, p_company_id, v_task.conversation_id) then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_task.due_at is null and v_task.due_on is not distinct from p_due_on then
    return jsonb_build_object('outcome', 'unchanged', 'task', to_jsonb(v_task));
  end if;

  perform set_config('loonext.task_actor', p_actor_user_id::text, true);
  update public.tasks
     set due_at = null, due_on = p_due_on, confirmed_at = null, confirmed_by = null
   where company_id = p_company_id and id = p_task_id
   returning * into v_task;
  return jsonb_build_object('outcome', 'updated', 'task', to_jsonb(v_task));
end;
$$;

create function public.create_task_with_date(
  p_company_id uuid,
  p_message_id uuid,
  p_title text,
  p_description text,
  p_assigned_user_id uuid,
  p_due_at timestamptz,
  p_actor_user_id uuid,
  p_due_on date,
  p_addr_street text default null,
  p_addr_unit text default null,
  p_addr_city text default null,
  p_addr_state text default null,
  p_addr_postal_code text default null,
  p_addr_country text default null,
  p_addr_provenance text default null,
  p_call_id uuid default null,
  p_contact_id uuid default null,
  p_conversation_id uuid default null,
  p_priority text default 'normal',
  p_assignee_ids uuid[] default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
  v_task public.tasks;
begin
  if p_due_at is not null and p_due_on is not null then
    return jsonb_build_object('outcome', 'bad_due_precision');
  end if;
  v_result := public.create_task(
    p_company_id, p_message_id, p_title, p_description, p_assigned_user_id,
    p_due_at, p_actor_user_id, p_addr_street, p_addr_unit, p_addr_city, p_addr_state,
    p_addr_postal_code, p_addr_country, p_addr_provenance, p_call_id,
    p_contact_id, p_conversation_id, p_priority, p_assignee_ids
  );
  if v_result->>'outcome' is distinct from 'created' or p_due_on is null then
    return v_result;
  end if;

  update public.tasks set due_on = p_due_on
   where company_id = p_company_id and id = (v_result->'task'->>'id')::uuid
   returning * into v_task;
  return jsonb_set(v_result, '{task}', to_jsonb(v_task));
end;
$$;

revoke execute on function public.set_task_due_on(uuid,uuid,uuid,date),
  public.create_task_with_date(uuid,uuid,text,text,uuid,timestamptz,uuid,date,text,text,text,text,text,text,text,uuid,uuid,uuid,text,uuid[])
  from public, anon, authenticated;
grant execute on function public.set_task_due_on(uuid,uuid,uuid,date),
  public.create_task_with_date(uuid,uuid,text,text,uuid,timestamptz,uuid,date,text,text,text,text,text,text,text,uuid,uuid,uuid,text,uuid[])
  to service_role;

do $migration$
declare
  v_update text := pg_get_functiondef('public.update_task(uuid,uuid,text,text,timestamptz,boolean,uuid,boolean,text,text,text,text,text,text,text,text)'::regprocedure);
  v_api text := pg_get_functiondef('public.api_create_public_task(uuid,uuid,uuid,jsonb,text)'::regprocedure);
  v_confirmation text := pg_get_functiondef('public.api_set_task_confirmation(uuid,uuid,uuid,boolean)'::regprocedure);
  v_change constant text := 'or (v_new_due   is distinct from v_task.due_at)';
  v_due_value constant text := 'due_at = v_new_due,';
  v_api_arg constant text := $sql$p_due_at => (p_task->>'due_at')::timestamptz,$sql$;
begin
  if strpos(v_update, v_change) = 0 or strpos(v_update, v_due_value) = 0
     or strpos(v_api, v_api_arg) = 0 then
    raise exception 'Task due update or creation argument was not found';
  end if;
  v_update := replace(v_update, v_change, v_change ||
    E'\n            or (v_task.due_on is not null and (p_clear_due or p_due_at is not null))');
  v_update := replace(v_update, v_due_value, v_due_value ||
    E'\n         due_on = case when p_clear_due or p_due_at is not null then null else due_on end,');
  execute v_update;
  execute replace(v_confirmation, 'v_task.due_at is null',
    '(v_task.due_at is null and v_task.due_on is null)');
  v_api := replace(v_api, 'v_result := public.create_task(', 'v_result := public.create_task_with_date(');
  execute replace(v_api, v_api_arg, v_api_arg ||
    E'\n      p_due_on => (p_task->>''due_on'')::date,');
end $migration$;
