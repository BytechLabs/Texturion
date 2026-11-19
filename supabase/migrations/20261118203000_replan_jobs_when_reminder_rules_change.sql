create function public.api_replace_reminder_rules(
  p_company_id uuid,
  p_user_id uuid,
  p_rules jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_replan_limit constant integer := 2000;
  v_task_id uuid;
  v_replanned integer := 0;
  v_rules jsonb;
begin
  -- The sender takes the same workspace lock before turning a reminder into a message.
  perform 1 from public.companies c
   where c.id = p_company_id and c.deleted_at is null
   for no key update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  delete from public.appointment_reminder_rules where company_id = p_company_id;

  insert into public.appointment_reminder_rules (company_id, offset_minutes, body, enabled, created_by)
  select p_company_id, r.offset_minutes, r.body, coalesce(r.enabled, true), p_user_id
    from jsonb_to_recordset(p_rules) as r(offset_minutes integer, body text, enabled boolean);

  update public.scheduled_messages s
     set status = 'canceled', canceled_at = now(), claimed_at = null, updated_at = now()
   where s.company_id = p_company_id and s.origin = 'reminder'
     and s.status in ('pending', 'held')
     and not exists (
       select 1 from public.appointment_reminder_rules r
        where r.company_id = p_company_id and r.enabled
          and r.offset_minutes = s.reminder_offset_minutes
     );

  if exists (select 1 from public.appointment_reminder_rules where company_id = p_company_id and enabled) then
    for v_task_id in
      select t.id from public.tasks t
        join public.conversations c on c.company_id = t.company_id and c.id = t.conversation_id
       where t.company_id = p_company_id and t.deleted_at is null and not t.reminders_off
         and t.due_at > now() and public.task_done_at(t) is null
         and c.deleted_at is null and c.purged_at is null
       order by t.due_at, t.id
       limit v_replan_limit
    loop
      perform public.calendar_enqueue_reminder_replan(p_company_id, v_task_id, p_user_id);
      v_replanned := v_replanned + 1;
    end loop;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'offset_minutes', r.offset_minutes, 'body', r.body, 'enabled', r.enabled,
    'created_at', r.created_at, 'updated_at', r.updated_at
  ) order by r.offset_minutes desc), '[]'::jsonb)
    into v_rules
    from public.appointment_reminder_rules r where r.company_id = p_company_id;

  return jsonb_build_object('outcome', 'saved', 'rules', v_rules, 'replanned_jobs', v_replanned);
end $$;

revoke execute on function public.api_replace_reminder_rules(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.api_replace_reminder_rules(uuid, uuid, jsonb) to service_role;

do $migration$
declare
  v_definition text := pg_get_functiondef('public.api_fire_scheduled_message(uuid, integer)'::regprocedure);
  v_anchor constant text := '    select co.hold_reminders_unverified_calendar into v_hold_unverified';
  v_rule_check constant text := $sql$
    if not exists (
      select 1 from public.appointment_reminder_rules r
       where r.company_id = v_scheduled.company_id and r.enabled
         and r.offset_minutes = v_scheduled.reminder_offset_minutes
    ) then
      update public.scheduled_messages s
         set status = 'canceled', canceled_at = v_now, claimed_at = null, updated_at = v_now
       where s.id = p_id;
      return jsonb_build_object('outcome', 'gone');
    end if;

$sql$;
begin
  if strpos(v_definition, v_anchor) = 0 then
    raise exception 'api_fire_scheduled_message: the calendar check was not found';
  end if;
  execute replace(v_definition, v_anchor, v_rule_check || v_anchor);
end $migration$;
