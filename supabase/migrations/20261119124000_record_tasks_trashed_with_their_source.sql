alter table public.tasks add column trashed_with_source_at timestamptz;

comment on column public.tasks.trashed_with_source_at is
  'Matches the source deletion when restoring the task with its text or call.';

create function public.trash_source_task_refs(
  p_company_id uuid, p_message_id uuid, p_call_id uuid, p_stamp timestamptz
) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'number', t.number, 'trashed', t.deleted_at is not null
  ) order by t.number), '[]'::jsonb)
    from public.tasks t
   where t.company_id = p_company_id and t.purged_at is null
     and (t.message_id = p_message_id or t.source_call_id = p_call_id)
     and (t.deleted_at is null or (t.trashed_with_source_at = p_stamp and t.deleted_at = p_stamp));
$$;

create function public.trash_source_tasks(
  p_company_id uuid, p_message_id uuid, p_call_id uuid, p_stamp timestamptz
) returns void
language sql set search_path = '' as $$
  with trashed as (
    update public.tasks t
       set deleted_at = p_stamp, trashed_with_source_at = p_stamp
     where t.company_id = p_company_id and t.deleted_at is null
       and (t.message_id = p_message_id or t.source_call_id = p_call_id)
    returning t.id
  )
  update public.scheduled_messages s
     set status = 'canceled', canceled_at = p_stamp, claimed_at = null, updated_at = p_stamp
   where s.company_id = p_company_id and s.origin = 'reminder' and s.status in ('pending', 'held')
     and s.task_id in (select id from trashed);
$$;

create function public.restore_source_tasks(
  p_company_id uuid, p_user_id uuid, p_message_id uuid, p_call_id uuid, p_stamp timestamptz
) returns void
language sql set search_path = '' as $$
  with restored as (
    update public.tasks t
       set deleted_at = null, trashed_with_source_at = null
     where t.company_id = p_company_id and t.purged_at is null
       and (t.message_id = p_message_id or t.source_call_id = p_call_id)
       and t.trashed_with_source_at = p_stamp and t.deleted_at = p_stamp
    returning t.id, t.conversation_id, t.reminders_off
  )
  select public.calendar_enqueue_reminder_replan(p_company_id, id, p_user_id)
    from restored where conversation_id is not null and not reminders_off;
$$;

revoke execute on function public.trash_source_task_refs(uuid, uuid, uuid, timestamptz),
  public.trash_source_tasks(uuid, uuid, uuid, timestamptz),
  public.restore_source_tasks(uuid, uuid, uuid, uuid, timestamptz) from public, anon, authenticated;

drop function public.api_trash_message(uuid, uuid, uuid, uuid[]);
create function public.api_trash_message(
  p_company_id uuid, p_user_id uuid, p_message_id uuid,
  p_hidden_number_ids uuid[] default null, p_include_tasks boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_row record;
  v_stamp timestamptz := now();
begin
  select m.id, m.conversation_id, m.direction::text as direction into v_row
    from public.messages m
    join public.conversations c on c.company_id = m.company_id and c.id = m.conversation_id
   where m.id = p_message_id and m.company_id = p_company_id
     and m.deleted_at is null and c.deleted_at is null
     and (p_hidden_number_ids is null or not (c.phone_number_id = any(p_hidden_number_ids)))
   for update of m;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;

  update public.messages set deleted_at = v_stamp, deleted_by_user_id = p_user_id where id = v_row.id;
  if p_include_tasks then
    perform public.trash_source_tasks(p_company_id, p_message_id, null, v_stamp);
  end if;
  return jsonb_build_object('outcome', 'trashed', 'message_id', v_row.id,
    'conversation_id', v_row.conversation_id, 'direction', v_row.direction,
    'linked_tasks', public.trash_source_task_refs(p_company_id, p_message_id, null, v_stamp));
end $$;

drop function public.api_trash_call(uuid, uuid, uuid, boolean, uuid[]);
create function public.api_trash_call(
  p_company_id uuid, p_user_id uuid, p_call_id uuid, p_voicemail_only boolean default false,
  p_hidden_number_ids uuid[] default null, p_include_tasks boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_call record;
  v_stamp timestamptz := now();
begin
  select k.id, k.conversation_id, k.voicemail_deleted_at,
         (k.voicemail_path is not null or k.voicemail_transcript is not null) as has_voicemail
    into v_call from public.calls k
   where k.id = p_call_id and k.company_id = p_company_id and k.deleted_at is null
     and (p_hidden_number_ids is null or k.phone_number_id is null
          or not (k.phone_number_id = any(p_hidden_number_ids)))
   for update of k;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;

  if p_voicemail_only then
    if not v_call.has_voicemail or v_call.voicemail_deleted_at is not null then
      return jsonb_build_object('outcome', 'not_found');
    end if;
    update public.calls set voicemail_deleted_at = v_stamp, voicemail_deleted_by_user_id = p_user_id
     where id = p_call_id;
    return jsonb_build_object('outcome', 'trashed', 'kind', 'voicemail', 'call_id', p_call_id,
      'conversation_id', v_call.conversation_id);
  end if;

  update public.calls set deleted_at = v_stamp, deleted_by_user_id = p_user_id where id = p_call_id;
  if p_include_tasks then
    perform public.trash_source_tasks(p_company_id, null, p_call_id, v_stamp);
  end if;
  return jsonb_build_object('outcome', 'trashed', 'kind', 'call', 'call_id', p_call_id,
    'conversation_id', v_call.conversation_id,
    'linked_tasks', public.trash_source_task_refs(p_company_id, null, p_call_id, v_stamp));
end $$;

create function public.api_trash_source_tasks_preview(
  p_company_id uuid, p_kind text, p_id uuid, p_hidden_number_ids uuid[]
) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case
    when p_kind = 'message' and exists (
      select 1 from public.messages m
        join public.conversations c on c.company_id = m.company_id and c.id = m.conversation_id
       where m.company_id = p_company_id and m.id = p_id and m.deleted_at is null
         and c.deleted_at is null
         and (p_hidden_number_ids is null or not (c.phone_number_id = any(p_hidden_number_ids)))
    ) then public.trash_source_task_refs(p_company_id, p_id, null, null)
    when p_kind = 'call' and exists (
      select 1 from public.calls k where k.company_id = p_company_id and k.id = p_id and k.deleted_at is null
        and (p_hidden_number_ids is null or k.phone_number_id is null
             or not (k.phone_number_id = any(p_hidden_number_ids)))
    ) then public.trash_source_task_refs(p_company_id, null, p_id, null)
    else '[]'::jsonb
  end;
$$;

revoke execute on function public.api_trash_message(uuid, uuid, uuid, uuid[], boolean),
  public.api_trash_call(uuid, uuid, uuid, boolean, uuid[], boolean),
  public.api_trash_source_tasks_preview(uuid, text, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.api_trash_message(uuid, uuid, uuid, uuid[], boolean),
  public.api_trash_call(uuid, uuid, uuid, boolean, uuid[], boolean),
  public.api_trash_source_tasks_preview(uuid, text, uuid, uuid[]) to service_role;

do $migration$
declare
  v_definition text := pg_get_functiondef('public.api_restore_trash(uuid,uuid,text,uuid,uuid[])'::regprocedure);
  v_message_check constant text := $sql$  elsif p_kind = 'message' then
    perform 1
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
     where m.id = p_id and m.company_id = p_company_id
       and m.deleted_at is not null and m.purged_at is null
       and (p_hidden_number_ids is null
            or not (c.phone_number_id = any (p_hidden_number_ids)));$sql$;
  v_locked_message constant text := $sql$  elsif p_kind = 'message' then
    select m.deleted_at into v_stamp
      from public.messages m
      join public.conversations c on c.company_id = m.company_id and c.id = m.conversation_id
     where m.id = p_id and m.company_id = p_company_id
       and m.deleted_at is not null and m.purged_at is null
       and (p_hidden_number_ids is null
            or not (c.phone_number_id = any (p_hidden_number_ids)))
     for update of m;$sql$;
  v_message_return constant text := $sql$    return jsonb_build_object('outcome', 'restored', 'kind', 'message', 'id', p_id);$sql$;
  v_call_return constant text := $sql$    return jsonb_build_object('outcome', 'restored', 'kind', 'call', 'id', p_id);$sql$;
begin
  if strpos(v_definition, v_message_check) = 0 or strpos(v_definition, v_message_return) = 0
     or strpos(v_definition, v_call_return) = 0 then
    raise exception 'api_restore_trash: the source restore paths were not found';
  end if;
  v_definition := replace(v_definition, v_message_check, v_locked_message);
  v_definition := replace(v_definition, v_message_return,
    '    perform public.restore_source_tasks(p_company_id, p_user_id, p_id, null, v_stamp);' || E'\n' || v_message_return);
  v_definition := replace(v_definition, v_call_return,
    '    perform public.restore_source_tasks(p_company_id, p_user_id, null, p_id, v_conv.deleted_at);' || E'\n' || v_call_return);
  execute v_definition;
end $migration$;

do $migration$
declare
  v_definition text := pg_get_functiondef('public.api_list_trash(uuid,integer,timestamptz,uuid,uuid[])'::regprocedure);
  v_message_end constant text := $sql$'snippet', left(m.body, 120))$sql$;
  v_call_end constant text := $sql$'has_voicemail', (k.voicemail_path is not null))$sql$;
begin
  if strpos(v_definition, v_message_end) = 0 or strpos(v_definition, v_call_end) = 0 then
    raise exception 'api_list_trash: the source row details were not found';
  end if;
  v_definition := replace(v_definition, v_message_end, $sql$'snippet', left(m.body, 120),
             'linked_tasks', public.trash_source_task_refs(m.company_id, m.id, null, m.deleted_at))$sql$);
  v_definition := replace(v_definition, v_call_end, $sql$'has_voicemail', (k.voicemail_path is not null),
             'linked_tasks', public.trash_source_task_refs(k.company_id, null, k.id, k.deleted_at))$sql$);
  execute v_definition;
end $migration$;
