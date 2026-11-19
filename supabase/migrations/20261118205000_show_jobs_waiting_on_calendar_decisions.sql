do $migration$
declare
  v_fields constant text := '           t.assigned_user_id, t.due_at, t.created_at,';
  v_hold_field constant text := $sql$
           exists (
             select 1 from public.task_calendar_links l
              where l.company_id = t.company_id and l.task_id = t.id
                and l.link_state in ('event_removed', 'refused')
           ) as calendar_hold,$sql$;
  v_old_filter constant text := $sql$
      -- #245/D137: a removed/refused provider occurrence is unresolved
      -- attention, not an ordinary unscheduled job in the member queue.
      -- Conflicts remain visible because they retain a usable local date.
      and not exists (
        select 1
          from public.task_calendar_links cal_hold
         where cal_hold.company_id = t.company_id
           and cal_hold.task_id = t.id
           and cal_hold.link_state in ('event_removed', 'refused'))$sql$;
  v_json constant text := $sql$'assigned_user_id', t.assigned_user_id, 'due_at', t.due_at,
               'overdue', t.overdue)$sql$;
  v_new_json constant text := $sql$'assigned_user_id', t.assigned_user_id, 'due_at', t.due_at,
               'overdue', t.overdue, 'calendar_hold', t.calendar_hold)$sql$;
  v_definition text := pg_get_functiondef('public.api_for_you(uuid, uuid, timestamptz, integer, uuid[])'::regprocedure);
begin
  if strpos(v_definition, v_fields) = 0 or strpos(v_definition, v_old_filter) = 0
     or strpos(v_definition, v_json) = 0 then
    raise exception 'api_for_you: the assigned task calendar hold was not found';
  end if;
  v_definition := replace(v_definition, v_fields, v_fields || v_hold_field);
  v_definition := replace(v_definition, v_old_filter, '');
  execute replace(v_definition, v_json, v_new_json);
end $migration$;
