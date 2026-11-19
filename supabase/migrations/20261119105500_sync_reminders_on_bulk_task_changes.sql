do $migration$
declare
  v_definition text := pg_get_functiondef(
    'public.api_bulk_tasks(uuid, uuid, text, uuid[], uuid, uuid[], text, uuid, uuid[])'::regprocedure
  );
  v_declaration constant text := '  v_want     uuid[];';
  v_anchor constant text := $sql$  return jsonb_build_object(
    'action',  p_action,$sql$;
  v_result constant text := $sql$    'applied', v_applied,$sql$;
  v_follow_up constant text := $sql$
  if p_action in ('mark_done', 'delete') then
    update public.scheduled_messages s
       set status = 'canceled', canceled_at = v_now, claimed_at = null, updated_at = v_now
     where s.company_id = p_company_id and s.origin = 'reminder'
       and s.status in ('pending', 'held')
       and s.task_id in (select (item->>'id')::uuid from jsonb_array_elements(v_applied) item);
  elsif p_action = 'mark_undone' then
    perform public.calendar_enqueue_reminder_replan(p_company_id, t.id, p_user_id)
      from public.tasks t
     where t.company_id = p_company_id and t.conversation_id is not null
       and not t.reminders_off and t.due_at > v_now
       and t.id in (select (item->>'id')::uuid from jsonb_array_elements(v_applied) item);
  end if;

  if p_action = 'mark_done' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id,
      'title', t.title,
      'source', case
        when t.message_id is not null then jsonb_build_object('kind', 'message', 'id', t.message_id)
        when t.source_call_id is not null then jsonb_build_object('kind', 'call', 'id', t.source_call_id)
      end,
      'askForRating', t.conversation_id is not null
        and (t.source_call_id is not null or coalesce(m.direction <> 'note', false))
    ) order by t.id), '[]'::jsonb) into v_completed_tasks
      from public.tasks t
      left join public.messages m on m.company_id = t.company_id and m.id = t.message_id
     where t.company_id = p_company_id
       and t.id in (select (item->>'id')::uuid from jsonb_array_elements(v_applied) item);
  end if;

$sql$;
begin
  if strpos(v_definition, v_declaration) = 0 or strpos(v_definition, v_anchor) = 0
     or strpos(v_definition, v_result) = 0 then
    raise exception 'api_bulk_tasks: the result or declaration was not found';
  end if;
  v_definition := replace(v_definition, v_declaration,
    v_declaration || E'\n  v_completed_tasks jsonb := ''[]''::jsonb;');
  v_definition := replace(v_definition, v_result,
    v_result || E'\n    ''completed_tasks'', v_completed_tasks,');
  execute replace(v_definition, v_anchor, v_follow_up || v_anchor);
end $migration$;

do $migration$
declare
  v_definition text := pg_get_functiondef(
    'public.api_sync_task_reminders(uuid, uuid, uuid, jsonb, text, text, timestamptz)'::regprocedure
  );
  v_anchor constant text := '  with gone as (';
  v_done_check constant text := $sql$
  if public.task_done_at(v_task) is not null then
    p_reminders := '[]'::jsonb;
  end if;

$sql$;
begin
  if strpos(v_definition, v_anchor) = 0 then
    raise exception 'api_sync_task_reminders: the reminder reset was not found';
  end if;
  execute replace(v_definition, v_anchor, v_done_check || v_anchor);
end $migration$;

do $migration$
declare
  v_definition text := pg_get_functiondef('public.api_claim_job_rating(uuid, uuid, uuid, uuid, uuid)'::regprocedure);
  v_anchor constant text := E'begin\n  if exists (';
  v_lock constant text := $sql$
  perform pg_advisory_xact_lock(hashtextextended(
    'job-rating:' || p_company_id::text || ':' || p_contact_id::text, 0));
$sql$;
begin
  if strpos(v_definition, v_anchor) = 0 then
    raise exception 'api_claim_job_rating: the function body was not found';
  end if;
  execute replace(v_definition, v_anchor, 'begin' || v_lock || E'\n  if exists (');
end $migration$;
