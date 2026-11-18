alter table public.contacts add column creation_origin text
  check (creation_origin is null or creation_origin in ('app', 'api', 'import', 'inbound'));

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
    when current_setting('loonext.task_creation_origin', true) = 'api' then 'api'
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

create function public.create_task(
  p_company_id uuid, p_message_id uuid, p_title text, p_description text,
  p_assigned_user_id uuid, p_due_at timestamptz, p_actor_user_id uuid,
  p_addr_street text, p_addr_unit text, p_addr_city text, p_addr_state text,
  p_addr_postal_code text, p_addr_country text, p_addr_provenance text,
  p_call_id uuid, p_contact_id uuid, p_conversation_id uuid, p_priority text, p_assignee_ids uuid[],
  p_creation_origin text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if p_creation_origin is distinct from 'api' then
    raise exception 'Invalid task creation origin';
  end if;
  perform set_config('loonext.task_creation_origin', p_creation_origin, true);
  return public.create_task(
    p_company_id, p_message_id, p_title, p_description, p_assigned_user_id,
    p_due_at, p_actor_user_id, p_addr_street, p_addr_unit, p_addr_city, p_addr_state,
    p_addr_postal_code, p_addr_country, p_addr_provenance, p_call_id, p_contact_id,
    p_conversation_id, p_priority, p_assignee_ids
  );
end;
$$;

revoke execute on function public.enqueue_contact_creation_webhooks(),
  public.enqueue_contact_reactivation_webhook(), public.enqueue_task_creation_webhook()
  from public, anon, authenticated, service_role;
revoke execute on function public.create_task(
  uuid, uuid, text, text, uuid, timestamptz, uuid, text, text, text, text,
  text, text, text, uuid, uuid, uuid, text, uuid[], text
) from public, anon, authenticated;
grant execute on function public.create_task(
  uuid, uuid, text, text, uuid, timestamptz, uuid, text, text, text, text,
  text, text, text, uuid, uuid, uuid, text, uuid[], text
) to service_role;
