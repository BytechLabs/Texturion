alter table public.tasks add column independent_source boolean not null default false;
alter table public.tasks drop constraint tasks_one_done_owner;
alter table public.tasks add constraint tasks_one_done_owner check (
  message_id is null or (source_call_id is null and
    (independent_source or (done_at is null and done_by_user_id is null)))
);

drop index public.tasks_message_uq;
drop index public.tasks_source_call_uq;
create unique index tasks_message_uq on public.tasks (message_id)
  where message_id is not null and deleted_at is null and not independent_source;
create unique index tasks_source_call_uq on public.tasks (source_call_id)
  where source_call_id is not null and deleted_at is null and not independent_source;
create index tasks_message_link_idx on public.tasks (company_id, message_id, created_at, id)
  where message_id is not null and deleted_at is null;
create index tasks_call_link_idx on public.tasks (company_id, source_call_id, created_at, id)
  where source_call_id is not null and deleted_at is null;

create or replace function public.task_done_at(public.tasks) returns timestamptz
language sql stable set search_path = '' as $$
  select case when $1.message_id is not null and not $1.independent_source
    then (select m.done_at from public.messages m where m.id = $1.message_id and m.company_id = $1.company_id)
    else $1.done_at end
$$;

create or replace function public.task_done_by(public.tasks) returns uuid
language sql stable set search_path = '' as $$
  select case when $1.message_id is not null and not $1.independent_source
    then (select m.done_by_user_id from public.messages m where m.id = $1.message_id and m.company_id = $1.company_id)
    else $1.done_by_user_id end
$$;

create function public.api_create_linked_task(p_request jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  input record;
  result jsonb;
  previous text := coalesce(current_setting('loonext.independent_source', true), '');
begin
  select * into input from jsonb_to_record(p_request) as request(
    p_company_id uuid, p_message_id uuid, p_call_id uuid, p_title text,
    p_description text, p_assigned_user_id uuid, p_assignee_ids uuid[],
    p_due_at timestamptz, p_due_on date, p_actor_user_id uuid,
    p_addr_street text, p_addr_unit text, p_addr_city text, p_addr_state text,
    p_addr_postal_code text, p_addr_country text, p_addr_provenance text, p_priority text);
  if (input.p_message_id is null) = (input.p_call_id is null) then
    return jsonb_build_object('outcome', 'no_source');
  end if;
  if nullif(btrim(input.p_title), '') is null then
    return jsonb_build_object('outcome', 'title_required');
  end if;

  perform set_config('loonext.independent_source', 'on', true);
  result := public.create_task_with_date(
    input.p_company_id, input.p_message_id, input.p_title, input.p_description,
    input.p_assigned_user_id, input.p_due_at, input.p_actor_user_id, input.p_due_on,
    input.p_addr_street, input.p_addr_unit, input.p_addr_city, input.p_addr_state,
    input.p_addr_postal_code, input.p_addr_country, input.p_addr_provenance,
    input.p_call_id, null, null, input.p_priority, input.p_assignee_ids
  );
  perform set_config('loonext.independent_source', previous, true);
  return result;
end
$$;

revoke all on function public.api_create_linked_task(jsonb) from public, anon, authenticated;
grant execute on function public.api_create_linked_task(jsonb) to service_role;

do $migration$
declare
  signature text;
  existing text;
  updated text;
begin
  for signature, existing, updated in values
    ('create_task(uuid,uuid,text,text,uuid,timestamptz,uuid,text,text,text,text,text,text,text,uuid,uuid,uuid,text,uuid[])',
     'addr_country, addr_provenance, reminders_off, priority)',
     'addr_country, addr_provenance, reminders_off, priority, independent_source)'),
    ('create_task(uuid,uuid,text,text,uuid,timestamptz,uuid,text,text,text,text,text,text,text,uuid,uuid,uuid,text,uuid[])',
     'coalesce(p_priority, ''normal''))', 'coalesce(p_priority, ''normal''), coalesce(current_setting(''loonext.independent_source'', true) = ''on'', false))'),
    ('set_task_done(uuid,uuid,boolean,uuid)', 'if v_task.message_id is not null then',
     'if v_task.message_id is not null and not v_task.independent_source then'),
    ('api_bulk_tasks(uuid,uuid,text,uuid[],uuid,uuid[],text,uuid,uuid[])',
     'select t.id as task_id, t.message_id, t.conversation_id',
     'select t.id as task_id, case when not t.independent_source then t.message_id end as message_id, t.conversation_id'),
    ('api_bulk_tasks(uuid,uuid,text,uuid[],uuid,uuid[],text,uuid,uuid[])',
     'coalesce(m.done_at, t.done_at)', 'public.task_done_at(t)'),
    ('api_contact_timeline(uuid,uuid,integer,timestamptz,uuid,uuid[])',
     'coalesce(m.done_at, t.done_at)', 'public.task_done_at(t)'),
    ('api_linked_tasks(uuid,text,uuid,uuid[])', 'coalesce(tm.done_at, t.done_at)', 'public.task_done_at(t)'),
    ('api_member_holdings(uuid,uuid)', 'coalesce(m.done_at, t.done_at)', 'public.task_done_at(t)'),
    ('api_resolve_references(uuid,integer[],text[],text[],uuid[])', 'coalesce(m.done_at, t.done_at)', 'public.task_done_at(t)'),
    ('api_search_v2(uuid,text,integer,integer,integer,integer,integer,timestamptz,uuid,uuid[],integer)',
     'coalesce(m.done_at, t.done_at)', 'public.task_done_at(t)'),
    ('api_task_links(uuid,uuid,uuid[])', 'coalesce(om.done_at, o.done_at)', 'public.task_done_at(o)'),
    ('api_purge_trash_item(text,uuid,uuid,uuid,uuid[])',
     'case when t.message_id is null then t.done_at else m.done_at end', 'public.task_done_at(t)'),
    ('api_purge_trash_item(text,uuid,uuid,uuid,uuid[])',
     'case when t.message_id is null then t.done_by_user_id else m.done_by_user_id end', 'public.task_done_by(t)'),
    ('api_fire_scheduled_message(uuid,integer,timestamptz)',
     'coalesce(v_source_done_at, v_task.done_at)', 'public.task_done_at(v_task)'),
    ('calendar_message_done_changed()', 'where message_id = new.id', 'where message_id = new.id and not independent_source'),
    ('task_series_message_done_trigger()', 'where message_id = new.id', 'where message_id = new.id and not independent_source'),
    ('task_events_record_message_done()', 'where t.message_id = new.id', 'where t.message_id = new.id and not t.independent_source'),
    ('state_transition_capture_task_via_message()', 'where k.message_id = new.id', 'where k.message_id = new.id and not k.independent_source')
  loop
    declare
      definition text := pg_get_functiondef(('public.' || signature)::regprocedure);
    begin
      if strpos(definition, existing) = 0 then raise exception 'Changed task routine: %', signature; end if;
      execute replace(definition, existing, updated);
    end;
  end loop;

  for signature, existing in values
    ('api_for_you(uuid,uuid,timestamptz,integer,uuid[])',
     'coalesce\(\(select m\.done_at from public\.messages m\s+where m\.id = t\.message_id\), t\.done_at\)'),
    ('offboard_member(uuid,uuid,uuid)',
     'coalesce\(\s*\(select m\.done_at from public\.messages m where m\.id = t\.message_id\),\s*t\.done_at\s*\)')
  loop
    declare
      definition text := pg_get_functiondef(('public.' || signature)::regprocedure);
    begin
      if definition !~ existing then raise exception 'Changed task routine: %', signature; end if;
      execute regexp_replace(definition, existing, 'public.task_done_at(t)', 'g');
    end;
  end loop;
end
$migration$;

create or replace view public.task_map_rows with (security_invoker = true) as
select t.id, t.company_id, t.message_id, t.conversation_id, t.title, t.description,
  t.assigned_user_id, t.due_at, t.created_by_user_id, t.created_at, t.updated_at,
  t.addr_street, t.addr_unit, t.addr_city, t.addr_state, t.addr_postal_code,
  t.addr_country, t.addr_provenance, t.lat, t.lng, t.deleted_at,
  public.task_done_at(t) as done_at, cv.phone_number_id, c.id as contact_id,
  c.name as contact_name, c.lat as contact_lat, c.lng as contact_lng,
  coalesce(t.lat, c.lat) as map_lat, coalesce(t.lng, c.lng) as map_lng,
  t.reminders_off, t.confirmed_at, t.confirmed_by, t.source_call_id,
  t.priority, t.priority_rank, t.series_id, t.occurrence_no, t.number,
  t.due_on, t.due_time_set, t.source_line_id, t.independent_source
from public.tasks t
left join public.conversations cv on cv.id = t.conversation_id
left join public.contacts c on c.id = coalesce(cv.contact_id, t.contact_id);
