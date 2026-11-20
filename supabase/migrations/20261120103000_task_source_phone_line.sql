alter table public.tasks add column source_line_id uuid;

create function public.set_task_source_line() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source_call_id is not null then
    select c.phone_number_id into new.source_line_id
      from public.calls c where c.company_id = new.company_id and c.id = new.source_call_id;
  elsif new.message_id is not null then
    select c.phone_number_id into new.source_line_id
      from public.messages m
      join public.conversations c on c.company_id = m.company_id and c.id = m.conversation_id
      where m.company_id = new.company_id and m.id = new.message_id;
  else
    new.source_line_id := null;
  end if;
  return new;
end;
$$;

revoke execute on function public.set_task_source_line() from public, anon, authenticated;
grant execute on function public.set_task_source_line() to service_role;

create trigger tasks_source_line
before insert on public.tasks
for each row execute function public.set_task_source_line();

do $$
begin
  -- Backfilling the line should not move every source-linked task up in Recently updated.
  alter table public.tasks disable trigger set_updated_at;

  update public.tasks t
  set source_line_id = c.phone_number_id
  from public.calls c
  where t.company_id = c.company_id and t.source_call_id = c.id and c.phone_number_id is not null;

  update public.tasks t
  set source_line_id = c.phone_number_id
  from public.messages m
  join public.conversations c on c.company_id = m.company_id and c.id = m.conversation_id
  where t.company_id = m.company_id and t.message_id = m.id and c.phone_number_id is not null;

  alter table public.tasks enable trigger set_updated_at;
end;
$$;

create index tasks_company_source_line
on public.tasks (company_id, source_line_id) where source_line_id is not null;

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
  t.due_on, t.due_time_set, t.source_line_id
from public.tasks t
left join public.conversations cv on cv.id = t.conversation_id
left join public.contacts c on c.id = coalesce(cv.contact_id, t.contact_id)
left join public.messages m on m.id = t.message_id;
