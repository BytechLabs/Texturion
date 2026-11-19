alter table public.scheduled_messages add column trashed_with_conversation_at timestamptz;

comment on column public.scheduled_messages.trashed_with_conversation_at is
  'Matches the conversation deletion that canceled this text until that deletion is undone.';

do $migration$
declare
  v_cancel constant text := '     set status = ''canceled'', canceled_at = v_now, canceled_by = p_user_id';
  v_mark constant text := v_cancel || ', trashed_with_conversation_at = v_now, claimed_at = null, updated_at = v_now';
  v_trash text := pg_get_functiondef('public.api_trash_conversations(uuid, uuid, uuid[], uuid[])'::regprocedure);
  v_restore text := pg_get_functiondef('public.api_restore_trash(uuid, uuid, text, uuid, uuid[])'::regprocedure);
  v_restore_declare constant text := '  v_status public.conversation_status;';
  v_restore_additions constant text := $sql$
  v_scheduled_restored integer;
  v_scheduled_missed integer;
  v_task_id uuid;
$sql$;
  v_restore_tasks constant text := $sql$
    update public.tasks
       set deleted_at = null, trashed_with_conversation_at = null
     where conversation_id = v_conv.id
       and trashed_with_conversation_at = v_stamp;
$sql$;
  v_restore_jobs constant text := $sql$
    for v_task_id in
      update public.tasks t
         set deleted_at = null, trashed_with_conversation_at = null
       where t.company_id = p_company_id and t.conversation_id = v_conv.id
         and t.trashed_with_conversation_at = v_stamp
      returning t.id
    loop
      if exists (
        select 1 from public.tasks t
         where t.id = v_task_id and t.due_at > now() and not t.reminders_off
           and public.task_done_at(t) is null
      ) then
        perform public.calendar_enqueue_reminder_replan(p_company_id, v_task_id, p_user_id);
      end if;
    end loop;

    with canceled as (
      update public.scheduled_messages s
         set trashed_with_conversation_at = null
       where s.company_id = p_company_id and s.conversation_id = v_conv.id
         and s.trashed_with_conversation_at = v_stamp and s.status = 'canceled'
      returning s.*
    ), restored as (
      insert into public.scheduled_messages (
        company_id, conversation_id, body, send_at, clock_timezone, clock_source,
        expires_at, inbound_watermark, origin, task_id, created_by
      )
      select s.company_id, s.conversation_id, s.body, s.send_at, s.clock_timezone, s.clock_source,
             s.expires_at, s.inbound_watermark, s.origin, s.task_id, s.created_by
        from canceled s
       where s.origin <> 'reminder' and s.send_at > now() and s.expires_at > now()
      returning id
    )
    select (select count(*) from restored),
           (select count(*) from canceled s where s.origin <> 'reminder'
              and (s.send_at <= now() or s.expires_at <= now()))
      into v_scheduled_restored, v_scheduled_missed;
$sql$;
  v_return_status constant text := $sql$      'status', case when v_open then v_status::text else 'closed' end);$sql$;
  v_return_counts constant text := $sql$      'status', case when v_open then v_status::text else 'closed' end,
      'scheduled_restored', v_scheduled_restored,
      'scheduled_missed', v_scheduled_missed);$sql$;
begin
  if strpos(v_trash, v_cancel) = 0 then
    raise exception 'api_trash_conversations: scheduled text cancellation was not found';
  end if;
  if strpos(v_restore, v_restore_declare) = 0 or strpos(v_restore, v_restore_tasks) = 0
     or strpos(v_restore, v_return_status) = 0 then
    raise exception 'api_restore_trash: conversation restoration was not found';
  end if;

  execute replace(v_trash, v_cancel, v_mark);
  v_restore := replace(v_restore, v_restore_declare, v_restore_declare || v_restore_additions);
  v_restore := replace(v_restore, v_restore_tasks, v_restore_jobs);
  execute replace(v_restore, v_return_status, v_return_counts);
end $migration$;
