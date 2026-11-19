create function public.internal_task_reminder_default() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.message_id is null and new.source_call_id is null)
     or exists (
       select 1 from public.messages m
        where m.id = new.message_id and m.company_id = new.company_id
          and m.direction = 'note'
     ) then
    new.reminders_off := true;
  end if;
  return new;
end $$;

revoke execute on function public.internal_task_reminder_default() from public, anon, authenticated;

create trigger internal_task_reminder_default
before insert on public.tasks
for each row execute function public.internal_task_reminder_default();

with internal_tasks as (
  select t.company_id, t.id
    from public.tasks t
    left join public.messages m on m.id = t.message_id and m.company_id = t.company_id
   where t.deleted_at is null
     and ((t.message_id is null and t.source_call_id is null) or m.direction = 'note')
     and not exists (
       select 1 from public.scheduled_messages s
        where s.company_id = t.company_id and s.task_id = t.id
          and s.origin = 'reminder' and s.status = 'sent'
     )
), suppressed as (
  update public.tasks t set reminders_off = true
    from internal_tasks i
   where t.company_id = i.company_id and t.id = i.id and not t.reminders_off
)
update public.scheduled_messages s
   set status = 'canceled', claimed_at = null, updated_at = now()
  from internal_tasks i
 where s.company_id = i.company_id and s.task_id = i.id
   and s.origin = 'reminder' and s.status in ('pending', 'held');
