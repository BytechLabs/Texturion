alter table public.scheduled_messages
  add column create_key_hash bytea,
  add column create_request_hash bytea;

create unique index scheduled_messages_create_key_idx
  on public.scheduled_messages (company_id, created_by, create_key_hash)
  where create_key_hash is not null;

alter table public.tasks
  add column create_key_hash bytea,
  add column create_request_hash bytea;

create unique index tasks_create_key_idx
  on public.tasks (company_id, create_key_hash)
  where create_key_hash is not null;

create function public.api_schedule_message(
  p_company_id uuid,
  p_conversation_id uuid,
  p_user_id uuid,
  p_body text,
  p_send_at timestamptz,
  p_clock_timezone text,
  p_clock_source text,
  p_expires_at timestamptz,
  p_idempotency_key text,
  p_needs_quiet_confirmation boolean
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_key_hash bytea;
  v_request_hash bytea;
  v_row public.scheduled_messages;
  v_result jsonb;
begin
  -- Serialize the replay check and the existing workspace and thread caps.
  perform 1 from public.companies where id = p_company_id for update;

  if p_idempotency_key is not null then
    v_key_hash := sha256(convert_to(p_idempotency_key, 'UTF8'));
    v_request_hash := sha256(convert_to(jsonb_build_array(
      p_conversation_id, btrim(p_body), extract(epoch from p_send_at)
    )::text, 'UTF8'));

    select * into v_row from public.scheduled_messages s
     where s.company_id = p_company_id and s.created_by = p_user_id
       and s.create_key_hash = v_key_hash;
    if found then
      if v_row.create_request_hash is distinct from v_request_hash then
        return jsonb_build_object('outcome', 'key_conflict');
      end if;
      return jsonb_build_object('outcome', 'replayed', 'scheduled_message',
        to_jsonb(v_row) - array['create_key_hash', 'create_request_hash']);
    end if;
  end if;

  if p_needs_quiet_confirmation then
    return jsonb_build_object('outcome', 'quiet_confirmation');
  end if;

  v_result := public.api_schedule_message(p_company_id, p_conversation_id, p_user_id,
    p_body, p_send_at, p_clock_timezone, p_clock_source, p_expires_at);
  if v_key_hash is not null and v_result->>'outcome' = 'scheduled' then
    update public.scheduled_messages set
      create_key_hash = v_key_hash,
      create_request_hash = v_request_hash
    where company_id = p_company_id and id = (v_result #>> '{scheduled_message,id}')::uuid;
  end if;
  if v_result ? 'scheduled_message' then
    v_result := jsonb_set(v_result, '{scheduled_message}',
      (v_result->'scheduled_message') - array['create_key_hash', 'create_request_hash']);
  end if;
  return v_result;
end;
$$;

revoke execute on function public.api_schedule_message(uuid, uuid, uuid, text, timestamptz,
  text, text, timestamptz, text, boolean) from public, anon, authenticated;
grant execute on function public.api_schedule_message(uuid, uuid, uuid, text, timestamptz,
  text, text, timestamptz, text, boolean) to service_role;

create function public.api_create_public_task(
  p_company_id uuid,
  p_api_key_id uuid,
  p_actor_user_id uuid,
  p_task jsonb,
  p_idempotency_key text
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_key_hash bytea;
  v_request_hash bytea;
  v_row public.tasks;
  v_task_id uuid;
  v_task jsonb;
  v_result jsonb;
begin
  if p_idempotency_key is not null then
    v_key_hash := sha256(convert_to(p_api_key_id::text || ':' || p_idempotency_key, 'UTF8'));
    v_request_hash := sha256(convert_to(p_task::text, 'UTF8'));
    perform pg_advisory_xact_lock(hashtextextended(
      'public_task:' || p_company_id::text || ':' || encode(v_key_hash, 'hex'), 0));

    select * into v_row from public.tasks t
     where t.company_id = p_company_id and t.create_key_hash = v_key_hash;
    if found then
      if v_row.create_request_hash is distinct from v_request_hash or v_row.deleted_at is not null then
        return jsonb_build_object('outcome', 'key_conflict');
      end if;
      return jsonb_build_object('outcome', 'replayed', 'task',
        to_jsonb(v_row) - array['create_key_hash', 'create_request_hash']);
    end if;
  end if;

  begin
    v_result := public.create_task(
      p_company_id => p_company_id,
      p_message_id => (p_task->>'message_id')::uuid,
      p_title => p_task->>'title',
      p_description => p_task->>'description',
      p_assigned_user_id => (p_task->>'assigned_user_id')::uuid,
      p_due_at => (p_task->>'due_at')::timestamptz,
      p_actor_user_id => p_actor_user_id,
      p_contact_id => (p_task->>'contact_id')::uuid,
      p_conversation_id => (p_task->>'conversation_id')::uuid,
      p_priority => coalesce(p_task->>'priority', 'normal'),
      p_assignee_ids => case when p_task ? 'assignee_ids' then
        array(select value::uuid from jsonb_array_elements_text(p_task->'assignee_ids'))
      end
    );
    if v_result->>'outcome' <> 'created' then
      return v_result;
    end if;
    v_task := v_result->'task';
    v_task_id := (v_task->>'id')::uuid;

    if jsonb_array_length(p_task->'label_ids') > 0 then
      v_result := public.api_set_task_tags(p_company_id, v_task_id, p_actor_user_id,
        array(select value::uuid from jsonb_array_elements_text(p_task->'label_ids')));
      if v_result->>'outcome' <> 'updated' then
        raise sqlstate 'LNX01';
      end if;
    end if;

    if p_task ? 'repeat' then
      v_result := public.api_set_task_repeat(p_company_id, v_task_id, p_actor_user_id, p_task->'repeat');
      if v_result->'task' is null then
        raise sqlstate 'LNX01';
      end if;
      v_task := v_result->'task';
    end if;
  exception when sqlstate 'LNX01' then
    -- An invalid label or repeat rolls back the task that would otherwise be left behind.
    return v_result;
  end;

  if v_key_hash is not null then
    update public.tasks set create_key_hash = v_key_hash, create_request_hash = v_request_hash
     where company_id = p_company_id and id = v_task_id;
  end if;
  return jsonb_build_object('outcome', 'created', 'task',
    v_task - array['create_key_hash', 'create_request_hash']);
end;
$$;

revoke execute on function public.api_create_public_task(uuid, uuid, uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.api_create_public_task(uuid, uuid, uuid, jsonb, text)
  to service_role;
