alter table public.scheduled_messages
  add column advertised_due_at timestamptz,
  add column advertised_due_on date;

alter table public.scheduled_messages drop constraint scheduled_messages_origin_ck;
alter table public.scheduled_messages add constraint scheduled_messages_origin_ck
  check (origin in ('human', 'reminder', 'rating', 'correction'));
alter table public.scheduled_messages drop constraint scheduled_messages_reminder_shape_ck;
alter table public.scheduled_messages add constraint scheduled_messages_reminder_shape_ck
  check (
    (origin = 'reminder' and task_id is not null and reminder_offset_minutes is not null)
    or (origin in ('rating', 'correction') and task_id is not null and reminder_offset_minutes is null)
    or (origin = 'human' and reminder_offset_minutes is null)
  );

create unique index scheduled_messages_one_booking_correction
  on public.scheduled_messages(company_id, task_id)
  where origin = 'correction' and status in ('pending', 'held');

create function public.record_reminder_booking() returns trigger
language plpgsql set search_path = '' as $$
begin
  select case when t.deleted_at is null then t.due_at end,
         case when t.deleted_at is null then t.due_on end
    into new.advertised_due_at, new.advertised_due_on
    from public.tasks t where t.company_id = new.company_id and t.id = new.task_id;
  return new;
end;
$$;

create trigger scheduled_messages_record_reminder_booking
  before update of status on public.scheduled_messages for each row
  when (new.origin in ('reminder', 'correction') and new.status = 'sent' and old.status is distinct from 'sent')
  execute function public.record_reminder_booking();

create function public.queue_booking_correction() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_last public.scheduled_messages;
  v_pending public.scheduled_messages;
  v_original_at timestamptz;
  v_original_on date;
  v_locale text;
  v_day text;
  v_time text;
  v_body text;
begin
  select * into v_pending from public.scheduled_messages
    where company_id = new.company_id and task_id = new.id and origin = 'correction'
      and status in ('pending', 'held') for update;
  if found then
    update public.scheduled_messages set status = 'canceled', canceled_at = now(),
      claimed_at = null, updated_at = now() where id = v_pending.id;
  end if;
  if new.conversation_id is null or new.conversation_id is distinct from old.conversation_id then
    return new;
  end if;

  select * into v_last from public.scheduled_messages
    where company_id = new.company_id and task_id = new.id and status = 'sent'
      and conversation_id = new.conversation_id and origin in ('reminder', 'correction')
    order by updated_at desc, id desc limit 1;
  if not found then return new; end if;
  if v_pending.id is not null and v_pending.conversation_id = new.conversation_id then
    v_original_at := v_pending.advertised_due_at;
    v_original_on := v_pending.advertised_due_on;
  elsif v_last.origin = 'correction' or v_last.advertised_due_at is not null or v_last.advertised_due_on is not null then
    v_original_at := v_last.advertised_due_at;
    v_original_on := v_last.advertised_due_on;
  else
    v_original_at := old.due_at;
    v_original_on := old.due_on;
  end if;

  if new.deleted_at is null
     and (new.due_at, new.due_on) is not distinct from (v_original_at, v_original_on) then
    return new;
  end if;
  if old.deleted_at is not null and v_last.origin = 'reminder' and v_pending.id is null
     and (new.due_at, new.due_on) is not distinct from (old.due_at, old.due_on) then
    return new;
  end if;

  select coalesce(c.locale, co.locale, 'en') into v_locale
    from public.conversations cv join public.companies co on co.id = cv.company_id
    left join public.contacts c on c.id = cv.contact_id and c.company_id = cv.company_id
    where cv.company_id = new.company_id and cv.id = new.conversation_id
      and cv.deleted_at is null and cv.purged_at is null;
  if not found then return new; end if;
  v_day := to_char(coalesce(new.due_on, (new.due_at at time zone v_last.clock_timezone)::date), 'YYYY-MM-DD');
  v_time := to_char(new.due_at at time zone v_last.clock_timezone, 'HH24:MI');
  if new.deleted_at is not null or v_day is null then
    v_body := case when v_locale like 'fr%' then 'Votre rendez-vous a été annulé.'
      else 'Your appointment was canceled.' end;
  elsif v_locale like 'fr%' then
    v_body := 'Votre rendez-vous a été déplacé au ' || v_day ||
      coalesce(' à ' || v_time, '') || '.';
  else
    v_body := 'Your appointment was moved to ' || v_day ||
      coalesce(' at ' || v_time, '') || '.';
  end if;

  insert into public.scheduled_messages (
    company_id, conversation_id, task_id, origin, body, send_at,
    clock_timezone, clock_source, expires_at, created_by, advertised_due_at, advertised_due_on
  ) values (
    new.company_id, new.conversation_id, new.id, 'correction', v_body, now() + interval '10 minutes',
    v_last.clock_timezone, v_last.clock_source, now() + interval '1 day', v_last.created_by,
    v_original_at, v_original_on
  );
  return new;
end;
$$;

create trigger tasks_queue_booking_correction
  after update of due_at, due_on, deleted_at, conversation_id on public.tasks for each row
  when ((new.due_at, new.due_on, new.deleted_at, new.conversation_id)
     is distinct from (old.due_at, old.due_on, old.deleted_at, old.conversation_id))
  execute function public.queue_booking_correction();

revoke execute on function public.record_reminder_booking(), public.queue_booking_correction()
  from public, anon, authenticated;

create function public.booking_correction_notice(p_company_id uuid, p_task_id uuid, p_actor uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'body', s.body, 'recipient', c.name)
    from public.scheduled_messages s
    join public.conversations cv on cv.company_id = s.company_id and cv.id = s.conversation_id
    left join public.contacts c on c.company_id = cv.company_id and c.id = cv.contact_id
   where s.company_id = p_company_id and s.task_id = p_task_id
     and s.origin = 'correction' and s.status = 'pending' and s.created_at = now()
     and public.calendar_task_access_allowed(p_actor, p_company_id, s.conversation_id);
$$;

revoke execute on function public.booking_correction_notice(uuid,uuid,uuid)
  from public, anon, authenticated;

do $migration$
declare
  v_sync text := pg_get_functiondef('public.api_sync_task_reminders(uuid,uuid,uuid,jsonb,text,text,timestamptz)'::regprocedure);
  v_fire text := pg_get_functiondef('public.api_fire_scheduled_message(uuid,integer,timestamptz)'::regprocedure);
  v_update text := pg_get_functiondef('public.update_task(uuid,uuid,text,text,timestamptz,boolean,uuid,boolean,text,text,text,text,text,text,text,text)'::regprocedure);
  v_date text := pg_get_functiondef('public.set_task_due_on(uuid,uuid,uuid,date)'::regprocedure);
  v_delete text := pg_get_functiondef('public.delete_task(uuid,uuid,uuid)'::regprocedure);
  v_delete_series text := pg_get_functiondef('public.api_delete_task_series(uuid,uuid,uuid)'::regprocedure);
  v_after_lock constant text := 'if public.task_done_at(v_task) is not null then';
  v_due constant text := 'or v_task.due_at is null';
  v_probe_kind constant text := $$v_probe.origin = 'reminder'$$;
  v_send_kind constant text := $$v_scheduled.origin = 'reminder'$$;
  v_booked_start constant text := 'if v_task.id is null';
  v_booked_end constant text := 'or coalesce(v_source_done_at, v_task.done_at) is not null then';
  v_automation constant text := $$when 'reminder' then 'reminder'$$;
  v_updated constant text := $$return jsonb_build_object('outcome', 'updated', 'task', to_jsonb(v_task));$$;
  v_deleted constant text := $$return jsonb_build_object('outcome', 'deleted');$$;
  v_series_result constant text := $$'outcome', v_res->>'outcome', 'also_removed', v_n$$;
  v_notice constant text := 'public.booking_correction_notice(p_company_id, p_task_id, p_actor_user_id)';
begin
  if strpos(v_sync, v_after_lock) = 0 or strpos(v_fire, v_due) = 0
     or strpos(v_fire, v_probe_kind) = 0 or strpos(v_fire, v_send_kind) = 0
     or strpos(v_fire, v_booked_start) = 0 or strpos(v_fire, v_booked_end) = 0
     or strpos(v_fire, v_automation) = 0 or strpos(v_update, v_updated) = 0
     or strpos(v_date, v_updated) = 0 or strpos(v_delete, v_deleted) = 0
     or strpos(v_delete_series, v_series_result) = 0 then
    raise exception 'Scheduled reminder definition changed';
  end if;
  execute replace(v_sync, v_after_lock,
    $sql$if v_task.due_on is not null then
    select coalesce(jsonb_agg(item), '[]'::jsonb) into p_reminders
      from jsonb_array_elements(coalesce(p_reminders, '[]'::jsonb)) item
      where (item->>'offset_minutes')::integer >= 1440;
  end if;
  if public.task_done_at(v_task) is not null or (v_task.due_at is null and v_task.due_on is null) then$sql$);
  v_fire := replace(v_fire, v_due,
    'or (v_task.due_at is null and (v_task.due_on is null or v_scheduled.reminder_offset_minutes < 1440))');
  v_fire := replace(v_fire, v_probe_kind, $$v_probe.origin in ('reminder', 'correction')$$);
  v_fire := replace(v_fire, v_send_kind, $$v_scheduled.origin in ('reminder', 'correction')$$);
  v_fire := replace(v_fire, v_booked_start, $$if v_scheduled.origin = 'reminder' and (v_task.id is null$$);
  v_fire := replace(v_fire, v_booked_end, 'or coalesce(v_source_done_at, v_task.done_at) is not null) then');
  execute replace(v_fire, v_automation, v_automation || E'\n       when ''correction'' then ''reminder''');
  execute replace(v_update, v_updated,
    $$return jsonb_build_object('outcome', 'updated', 'task', to_jsonb(v_task), 'correction',
       case when p_clear_due or p_due_at is not null then $$ || v_notice || ' end);');
  execute replace(v_date, v_updated,
    $$return jsonb_build_object('outcome', 'updated', 'task', to_jsonb(v_task), 'correction', $$ || v_notice || ');');
  execute replace(v_delete, v_deleted,
    $$return jsonb_build_object('outcome', 'deleted', 'correction', $$ || v_notice || ');');
  execute replace(v_delete_series, v_series_result, v_series_result || $$, 'correction', v_res->'correction'$$);
end $migration$;
