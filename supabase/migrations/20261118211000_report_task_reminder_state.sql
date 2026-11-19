create function public.task_reminder_state(t public.tasks)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case
    when not exists (
      select 1 from public.conversations c
       where c.company_id = t.company_id and c.id = t.conversation_id
         and c.deleted_at is null and c.purged_at is null
    ) then jsonb_build_object('state', 'no_customer_thread')
    when t.confirmed_at is not null then jsonb_build_object('state', 'confirmed')
    when t.reminders_off then jsonb_build_object('state', 'off')
    when not exists (
      select 1 from public.appointment_reminder_rules r
       where r.company_id = t.company_id and r.enabled
    ) then jsonb_build_object('state', 'none_configured')
    when t.due_at is null or public.task_done_at(t) is not null then jsonb_build_object('state', 'none_queued')
    else coalesce((
      select case s.status
        when 'pending' then jsonb_build_object('state', 'queued', 'next_send_at', s.send_at)
        else jsonb_build_object('state', s.status)
      end
        from public.scheduled_messages s
       where s.company_id = t.company_id and s.task_id = t.id and s.origin = 'reminder'
         and s.status in ('pending', 'held', 'sent')
         -- Quiet hours can move send_at earlier than the nominal offset.
         and s.created_at >= coalesce((
           select max(e.created_at) from public.task_events e
            where e.company_id = t.company_id and e.task_id = t.id and e.kind = 'due'
         ), '-infinity'::timestamptz)
         and (s.status = 'sent' or (s.expires_at > now() and exists (
           select 1 from public.appointment_reminder_rules r
            where r.company_id = t.company_id and r.enabled
              and r.offset_minutes = s.reminder_offset_minutes
         )))
       order by case s.status when 'held' then 0 when 'pending' then 1 else 2 end, s.send_at
       limit 1
    ), jsonb_build_object('state', 'none_queued'))
  end
$$;

revoke execute on function public.task_reminder_state(public.tasks) from public, anon, authenticated;
grant execute on function public.task_reminder_state(public.tasks) to service_role;

create or replace function public.set_task_reminders_off(
  p_company_id uuid,
  p_task_id uuid,
  p_off boolean,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks%rowtype;
begin
  select * into v_task from public.tasks
   where company_id = p_company_id and id = p_task_id and deleted_at is null
   for no key update;
  if not found then
    return jsonb_build_object('outcome', 'not_found', 'task', null);
  end if;
  if not p_off and not exists (
    select 1 from public.conversations c
     where c.company_id = p_company_id and c.id = v_task.conversation_id
       and c.deleted_at is null and c.purged_at is null
  ) then
    return jsonb_build_object('outcome', 'no_conversation', 'task', null);
  end if;

  perform set_config('loonext.task_actor', coalesce(p_actor_user_id::text, ''), true);
  update public.tasks
     set reminders_off = p_off, updated_at = now()
   where company_id = p_company_id and id = p_task_id
  returning * into v_task;
  return jsonb_build_object('outcome', 'updated', 'task', to_jsonb(v_task));
end $$;
