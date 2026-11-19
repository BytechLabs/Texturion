alter table public.contacts add column creation_origin text
  check (creation_origin is null or creation_origin in ('app', 'api', 'import', 'inbound'));

alter table public.contacts alter column name set default
  nullif(current_setting('loonext.widget_contact_name', true), '');

create function public.thread_widget_message(
  p_company_id uuid, p_phone_number_id uuid, p_from_e164 text, p_body text,
  p_timezone text, p_email_limit integer, p_push_limit integer,
  p_idempotency_key text, p_contact_name text
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  previous_name text := coalesce(current_setting('loonext.widget_contact_name', true), '');
  result jsonb;
begin
  perform set_config('loonext.widget_contact_name', coalesce(p_contact_name, ''), true);
  result := public.thread_inbound_message(
    p_company_id, p_phone_number_id, p_from_e164, p_body, null, p_timezone,
    p_email_limit, p_push_limit, 'widget', p_idempotency_key
  );
  perform set_config('loonext.widget_contact_name', previous_name, true);

  if p_contact_name <> '' and (result->>'created')::boolean then
    update public.contacts set name = p_contact_name
    where company_id = p_company_id and id = (result->>'contact_id')::uuid
      and deleted_at is null and (name is null or name = '');
  end if;
  return result;
end;
$$;

revoke execute on function public.thread_widget_message(uuid, uuid, text, text, text, integer, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.thread_widget_message(uuid, uuid, text, text, text, integer, integer, text, text)
  to service_role;

create function public.enqueue_contact_creation_webhooks()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  contact record;
  batch record;
begin
  for contact in
    select id, company_id, phone_e164, name,
      coalesce(creation_origin, case when created_by_user_id is null then 'inbound' else 'app' end) as origin
    from new_contacts where creation_origin is distinct from 'import'
  loop
    perform public.enqueue_workspace_webhook(contact.company_id, 'contact.created', jsonb_build_object(
      'contact_id', contact.id, 'phone_e164', contact.phone_e164, 'name', contact.name, 'origin', contact.origin
    ));
  end loop;

  for batch in
    select company_id, jsonb_agg(jsonb_build_object(
      'contact_id', id, 'phone_e164', phone_e164, 'name', name
    ) order by id) as contacts
    from (
      select *, row_number() over (partition by company_id order by id) as number
      from new_contacts where creation_origin = 'import'
    ) contacts
    group by company_id, (number - 1) / 200
  loop
    perform public.enqueue_workspace_webhook(batch.company_id, 'contact.created', jsonb_build_object(
      'origin', 'import', 'contacts', batch.contacts
    ));
  end loop;
  return null;
end;
$$;

create trigger enqueue_contact_creation_webhooks
  after insert on public.contacts referencing new table as new_contacts
  for each statement execute function public.enqueue_contact_creation_webhooks();

create function public.enqueue_contact_reactivation_webhook()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.enqueue_workspace_webhook(new.company_id, 'contact.created', jsonb_build_object(
    'contact_id', new.id, 'phone_e164', new.phone_e164, 'name', new.name, 'origin', 'app'
  ));
  return new;
end;
$$;

create trigger enqueue_contact_reactivation_webhook
  after update of deleted_at on public.contacts
  for each row when (old.deleted_at is not null and new.deleted_at is null)
  execute function public.enqueue_contact_reactivation_webhook();

alter table public.tasks add column creation_origin text
  check (creation_origin in ('app', 'api'));

alter table public.tasks alter column creation_origin set default
  (case when current_setting('loonext.task_creation_origin', true) = 'api' then 'api' else 'app' end);

create or replace function public.api_create_public_task(
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
  v_previous_origin text;
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
    v_previous_origin := coalesce(current_setting('loonext.task_creation_origin', true), '');
    perform set_config('loonext.task_creation_origin', 'api', true);
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
    perform set_config('loonext.task_creation_origin', v_previous_origin, true);
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

create function public.enqueue_task_creation_webhook()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  origin text;
  assignees uuid[];
  source jsonb;
begin
  origin := case
    when new.occurrence_no > 1 then 'repeat'
    when new.creation_origin = 'api' then 'api'
    else 'app'
  end;
  select coalesce(array_agg(user_id order by (user_id = new.assigned_user_id) desc, added_at, user_id), '{}')
    into assignees from public.task_assignees where company_id = new.company_id and task_id = new.id;
  source := case
    when new.source_call_id is not null then jsonb_build_object('kind', 'call', 'id', new.source_call_id)
    when new.message_id is not null then jsonb_build_object('kind', 'message', 'id', new.message_id)
    else null
  end;

  perform public.enqueue_workspace_webhook(new.company_id, 'task.created', jsonb_build_object(
    'task_id', new.id, 'title', new.title, 'due_at', new.due_at,
    'assigned_user_id', new.assigned_user_id, 'assignee_ids', assignees,
    'message_id', new.message_id, 'source', source, 'origin', origin
  ));
  return new;
end;
$$;

create constraint trigger enqueue_task_creation_webhook
  after insert on public.tasks deferrable initially deferred
  for each row execute function public.enqueue_task_creation_webhook();

revoke execute on function public.enqueue_contact_creation_webhooks(),
  public.enqueue_contact_reactivation_webhook(), public.enqueue_task_creation_webhook()
  from public, anon, authenticated, service_role;
