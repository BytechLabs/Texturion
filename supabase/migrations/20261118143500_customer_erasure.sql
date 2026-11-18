alter table public.contacts
  add column erasure_started_at timestamptz,
  add column erasure_completed_at timestamptz,
  add column erasure_requested_by uuid,
  add column erasure_counts jsonb;

create index contacts_pending_erasure_idx on public.contacts (erasure_started_at, id)
  where erasure_started_at is not null and erasure_completed_at is null;

create function public.customer_erasure_group(p_company uuid, p_contact uuid)
returns setof uuid
language sql stable set search_path = ''
as $$
  with recursive contacts(id) as (
    select p_contact
    union
    select c.id from public.contacts c join contacts parent on c.merged_into = parent.id
     where c.company_id = p_company
  )
  select id from contacts;
$$;

create function public.customer_erasure_numbers(p_company uuid, p_contact uuid)
returns setof text
language sql stable set search_path = ''
as $$
  select phone_e164 from public.contacts where company_id = p_company
    and id in (select public.customer_erasure_group(p_company, p_contact))
  union
  select phone_e164 from public.contact_phones where company_id = p_company
    and contact_id in (select public.customer_erasure_group(p_company, p_contact))
  union
  select contact_phone_e164 from public.conversations
   where company_id = p_company and contact_phone_e164 is not null
     and contact_id in (select public.customer_erasure_group(p_company, p_contact));
$$;

create function public.customer_erasure_calls(p_company uuid, p_contact uuid)
returns setof public.calls
language sql stable set search_path = ''
as $$
  with members as (select public.customer_erasure_group(p_company, p_contact) as id)
  select k.* from public.calls k
   where k.company_id = p_company and (
     k.contact_id in (select id from members) or k.conversation_id in (
       select id from public.conversations where company_id = p_company and contact_id in (select id from members)
     ) or (k.contact_id is null and k.conversation_id is null
       and k.caller_e164 in (select public.customer_erasure_numbers(p_company, p_contact))
       and not exists (select 1 from public.contacts c
         where c.company_id = p_company and c.id not in (select id from members) and c.phone_e164 = k.caller_e164)
       and not exists (select 1 from public.contact_phones cp
         where cp.company_id = p_company and cp.contact_id not in (select id from members) and cp.phone_e164 = k.caller_e164)
     )
   );
$$;

create function public.api_contact_erasure(
  p_company uuid, p_contact uuid, p_hidden uuid[], p_actor uuid default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  customer public.contacts%rowtype;
  contact_ids uuid[];
  conversation_ids uuid[];
  counts jsonb;
  started timestamptz := now();
  held boolean;
begin
  if p_actor is not null then
    perform 1 from public.companies where id = p_company and deleted_at is null for share;
    if not found then return jsonb_build_object('state', 'not_found'); end if;
  end if;
  select * into customer from public.contacts
   where id = p_contact and company_id = p_company and merged_into is null
   for update;
  if not found then return jsonb_build_object('state', 'not_found'); end if;
  select array(select public.customer_erasure_group(p_company, p_contact)) into contact_ids;
  if exists (
    select 1 from public.conversations
     where company_id = p_company and contact_id = any (contact_ids) and phone_number_id = any (p_hidden)
    union all
    select 1 from public.customer_erasure_calls(p_company, p_contact) where phone_number_id = any (p_hidden)
  ) then return jsonb_build_object('state', 'not_found'); end if;

  held := public.is_on_legal_hold(p_company);
  if customer.erasure_started_at is not null and customer.deleted_at is not null then
    return jsonb_build_object(
      'state', case when customer.erasure_completed_at is null then 'erasing' else 'erased' end,
      'date', coalesce(customer.erasure_completed_at, customer.erasure_started_at),
      'counts', customer.erasure_counts, 'legal_hold', held
    );
  end if;
  if p_actor is not null and held then return jsonb_build_object('state', 'legal_hold'); end if;

  select array(select id from public.conversations where company_id = p_company and contact_id = any (contact_ids))
    into conversation_ids;
  counts := jsonb_build_object(
    'conversations', cardinality(conversation_ids),
    'messages', (select count(*) from public.messages where company_id = p_company
      and conversation_id = any (conversation_ids) and purged_at is null),
    'calls', (select count(*) from public.customer_erasure_calls(p_company, p_contact) where purged_at is null),
    'tasks', (select count(*) from public.tasks where company_id = p_company
      and (contact_id = any (contact_ids) or conversation_id = any (conversation_ids)) and purged_at is null)
  );
  if p_actor is null then
    return jsonb_build_object('state', 'ready', 'counts', counts, 'legal_hold', held);
  end if;

  perform public.api_trash_conversations(p_company, p_actor, conversation_ids, p_hidden);
  update public.calls set deleted_at = started, deleted_by_user_id = p_actor
   where id in (select id from public.customer_erasure_calls(p_company, p_contact)) and deleted_at is null;
  update public.tasks set deleted_at = started
   where company_id = p_company and contact_id = any (contact_ids) and deleted_at is null;
  update public.task_series set stopped_at = coalesce(stopped_at, started)
   where company_id = p_company and (contact_id = any (contact_ids) or conversation_id = any (conversation_ids));
  update public.contacts set deleted_at = coalesce(deleted_at, started), deleted_by_user_id = p_actor,
         erasure_started_at = started, erasure_completed_at = null,
         erasure_requested_by = p_actor, erasure_counts = counts
   where id = p_contact;

  return jsonb_build_object('state', 'erasing', 'date', started, 'counts', counts, 'legal_hold', false);
end;
$$;

create function public.customer_erasure_pending(p_contact uuid)
returns boolean
language sql stable set search_path = ''
as $$
  with recursive contacts(id, company_id, merged_into, erasure_started_at, erasure_completed_at) as (
    select id, company_id, merged_into, erasure_started_at, erasure_completed_at from public.contacts where id = p_contact
    union
    select c.id, c.company_id, c.merged_into, c.erasure_started_at, c.erasure_completed_at
      from public.contacts c join contacts alias on c.id = alias.merged_into and c.company_id = alias.company_id
  )
  select exists (select 1 from contacts where erasure_started_at is not null and erasure_completed_at is null);
$$;

create function public.api_customer_erasures_due(p_limit integer)
returns table (id uuid, company_id uuid)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.company_id from public.contacts c join public.companies co on co.id = c.company_id
   where c.erasure_started_at is not null and c.erasure_completed_at is null
     and co.deleted_at is null and not public.is_on_legal_hold(c.company_id)
   order by c.erasure_started_at, c.id limit least(greatest(p_limit, 1), 50);
$$;

create function public.api_customer_erasure_batch(p_company uuid, p_contact uuid, p_limit integer)
returns table (kind text, id uuid)
language sql stable security definer set search_path = ''
as $$
  with pending as (
    select c.id from public.contacts c join public.companies co on co.id = c.company_id
     where c.id = p_contact and c.company_id = p_company and c.erasure_started_at is not null
       and c.erasure_completed_at is null and co.deleted_at is null and not public.is_on_legal_hold(c.company_id)
  ), members as (
    select public.customer_erasure_group(p_company, id) as id from pending
  ), items as (
    select 1 as priority, 'conversation'::text as kind, c.id
      from members p join public.conversations c on c.contact_id = p.id
     where c.company_id = p_company and c.purged_at is null
    union all
    select 2, 'call', k.id from pending p cross join lateral public.customer_erasure_calls(p_company, p.id) k
     where k.purged_at is null
    union all
    select 3, 'task', t.id from members p join public.tasks t on t.contact_id = p.id
     where t.company_id = p_company and t.purged_at is null
  )
  select kind, id from items order by priority, id limit least(greatest(p_limit, 1), 100);
$$;

create function public.reject_customer_erasure_restore()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  contact uuid;
begin
  if tg_table_name = 'contacts' then
    contact := old.id;
  else
    contact := old.contact_id;
  end if;
  if public.customer_erasure_pending(contact) then
    raise exception 'Customer erasure pending' using errcode = '55P03';
  end if;
  return new;
end;
$$;

create trigger reject_pending_customer_restore
  before update of deleted_at on public.contacts
  for each row when (old.deleted_at is not null and new.deleted_at is null)
  execute function public.reject_customer_erasure_restore();

create trigger reject_pending_customer_unmerge
  before update of merged_into on public.contacts
  for each row when (old.merged_into is distinct from new.merged_into)
  execute function public.reject_customer_erasure_restore();

create trigger reject_pending_customer_conversation_restore
  before update of deleted_at on public.conversations
  for each row when (old.deleted_at is not null and new.deleted_at is null)
  execute function public.reject_customer_erasure_restore();

create function public.reject_pending_customer_record()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  contact uuid;
begin
  if tg_table_name <> 'messages' then contact := new.contact_id; end if;
  if contact is null and tg_table_name <> 'conversations' then
    select contact_id into contact from public.conversations
     where id = new.conversation_id and company_id = new.company_id;
  end if;
  if public.customer_erasure_pending(contact) then
    raise exception 'Customer erasure pending' using errcode = '55P03';
  end if;
  return new;
end;
$$;

create trigger reject_pending_customer_conversation
  before insert or update of contact_id on public.conversations
  for each row execute function public.reject_pending_customer_record();

create trigger reject_pending_customer_message
  before insert on public.messages
  for each row execute function public.reject_pending_customer_record();

create trigger reject_pending_customer_call
  before insert or update of contact_id, conversation_id on public.calls
  for each row execute function public.reject_pending_customer_record();

create trigger reject_pending_customer_task
  before insert or update of contact_id, conversation_id on public.tasks
  for each row execute function public.reject_pending_customer_record();

create or replace function public.audit_log_is_append_only()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and current_setting('loonext.audit_retention', true) = 'on' then
    return old;
  end if;
  if tg_op = 'UPDATE' and current_setting('loonext.customer_erasure', true) = 'on'
     and new.before = '{}'::jsonb and new.after = '{}'::jsonb
     and to_jsonb(new) - array['before', 'after'] = to_jsonb(old) - array['before', 'after'] then
    return new;
  end if;
  raise exception 'audit_log is append-only: % is not permitted', tg_op using errcode = 'restrict_violation';
end;
$$;

create or replace function public.contact_consent_events_no_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if old.contact_id is not null and new.contact_id is null
     and to_jsonb(new) - 'contact_id' = to_jsonb(old) - 'contact_id' then
    return new;
  end if;
  if current_setting('loonext.customer_erasure', true) = 'on' and new.evidence = '{}'::jsonb
     and to_jsonb(new) - 'evidence' = to_jsonb(old) - 'evidence' then
    return new;
  end if;
  raise exception 'contact_consent_events is append-only (#226): record a new row instead of rewriting %', old.id;
end;
$$;

create function public.api_finish_customer_erasure(p_company uuid, p_contact uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  customer public.contacts%rowtype;
  contact_ids uuid[];
  conversation_ids uuid[];
  numbers text[];
  records text[];
  provider_ids text[];
  call_sessions text[];
  completed timestamptz := now();
begin
  perform 1 from public.companies where id = p_company and deleted_at is null for share;
  if not found or public.is_on_legal_hold(p_company) then return false; end if;

  select * into customer from public.contacts
   where id = p_contact and company_id = p_company and erasure_started_at is not null
     and erasure_completed_at is null
   for update;
  if not found or exists (select 1 from public.api_customer_erasure_batch(p_company, p_contact, 1)) then
    return false;
  end if;

  select array(select public.customer_erasure_group(p_company, p_contact)) into contact_ids;
  select array(select id from public.conversations where company_id = p_company and contact_id = any (contact_ids))
    into conversation_ids;
  select array(select n from public.customer_erasure_numbers(p_company, p_contact) n
    where not exists (select 1 from public.contacts c
      where c.company_id = p_company and not (c.id = any (contact_ids)) and c.phone_e164 = n)
      and not exists (select 1 from public.contact_phones cp
        where cp.company_id = p_company and not (cp.contact_id = any (contact_ids)) and cp.phone_e164 = n))
    into numbers;
  select array(select telnyx_message_id from public.messages
    where company_id = p_company and conversation_id = any (conversation_ids) and telnyx_message_id is not null)
    into provider_ids;
  select array(select distinct call_session_id from public.call_records
    where company_id = p_company and caller_e164 = any (numbers) and call_session_id is not null)
    into call_sessions;
  select array(
    select unnest(contact_ids)::text union all select unnest(conversation_ids)::text
    union all select id::text from public.messages where company_id = p_company and conversation_id = any (conversation_ids)
    union all select id::text from public.tasks where company_id = p_company
      and (contact_id = any (contact_ids) or conversation_id = any (conversation_ids))
    union all select id::text from public.calls where company_id = p_company and call_session_id = any (call_sessions)
    union all select id::text from public.quotes where company_id = p_company and contact_id = any (contact_ids)
    union all select id::text from public.payment_requests where company_id = p_company and contact_id = any (contact_ids)
  ) into records;

  delete from public.scheduled_messages where company_id = p_company and conversation_id = any (conversation_ids);
  delete from public.conversation_snoozes where company_id = p_company and conversation_id = any (conversation_ids);
  delete from public.pending_notifications where company_id = p_company and conversation_id = any (conversation_ids);
  delete from public.job_ratings where company_id = p_company and contact_id = any (contact_ids);
  delete from public.record_references where company_id = p_company
    and (target_contact_id = any (contact_ids) or target_conversation_id = any (conversation_ids) or source_id::text = any (records));
  update public.record_activity set payload = '{}'::jsonb where company_id = p_company
    and (record_id::text = any (records) or source_id::text = any (records) or conversation_id = any (conversation_ids));
  perform set_config('loonext.customer_erasure', 'on', true);
  update public.audit_log set before = '{}'::jsonb, after = '{}'::jsonb
   where company_id = p_company and target_id = any (records)
     and (before <> '{}'::jsonb or after <> '{}'::jsonb) and action <> 'record.purged';
  update public.contact_consent_events set evidence = '{}'::jsonb
   where company_id = p_company and contact_id = any (contact_ids) and evidence <> '{}'::jsonb;
  perform set_config('loonext.customer_erasure', 'off', true);
  update public.conversation_events set payload = '{}'::jsonb
   where company_id = p_company and conversation_id = any (conversation_ids);
  update public.conversations set contact_phone_e164 = null, spam_signals = null
   where company_id = p_company and id = any (conversation_ids);
  update public.messages set reaction_to_message_id = null, reaction_emoji = null, reaction_removed = false
   where company_id = p_company and conversation_id = any (conversation_ids) and reaction_to_message_id is not null;
  update public.task_series set title = 'Removed', description = '', stopped_at = coalesce(stopped_at, completed),
         addr_street = null, addr_unit = null, addr_city = null, addr_state = null,
         addr_postal_code = null, addr_country = null, addr_provenance = null
   where company_id = p_company and (contact_id = any (contact_ids) or conversation_id = any (conversation_ids));

  update public.call_records set caller_e164 = null where company_id = p_company and caller_e164 = any (numbers);
  delete from public.outbound_call_authorizations where company_id = p_company and customer_e164 = any (numbers);
  delete from public.blocked_senders where company_id = p_company and phone_e164 = any (numbers);
  delete from public.widget_verifications where company_id = p_company and phone_e164 = any (numbers);

  update public.public_links set revoked_at = coalesce(revoked_at, completed), revoke_reason = 'subject_erased'
   where company_id = p_company and (
     (subject_type = 'quote' and subject_id in (select id from public.quotes where company_id = p_company and contact_id = any (contact_ids)))
     or id in (select public_link_id from public.payment_requests where company_id = p_company and contact_id = any (contact_ids))
   );
  update public.quotes set description = 'Removed', status = case
      when status in ('accepted', 'declined') then status else 'expired' end
   where company_id = p_company and contact_id = any (contact_ids);
  update public.payment_requests set description = 'Removed', status = case
      when status = 'requested' then 'cancelled' else status end
   where company_id = p_company and contact_id = any (contact_ids);

  delete from public.webhook_deliveries d where d.company_id = p_company and exists (
    select 1 from unnest(records || numbers || call_sessions) entry(value)
     where jsonb_path_exists(d.payload->'data', '$.** ? (@ == $value)', jsonb_build_object('value', entry.value))
  );
  update public.webhook_events w set payload = '{}'::jsonb
   where w.processed_at is not null and w.provider = 'telnyx'
     and (w.payload #>> '{data,payload,id}' = any (provider_ids)
       or w.payload #>> '{data,payload,call_session_id}' = any (call_sessions));

  perform public.purge_contact_from_trash(p_contact, p_company, customer.erasure_requested_by);
  delete from public.contact_phones where company_id = p_company and contact_id = any (contact_ids);
  delete from public.contact_addresses where company_id = p_company and contact_id = any (contact_ids);
  delete from public.contact_tags where company_id = p_company and contact_id = any (contact_ids);
  perform set_config('loonext.activity_quiet', 'on', true);
  update public.contacts set name = null, email = null, business_name = null, address = null, notes = null,
    custom_fields = '{}'::jsonb, timezone = null, locale = null, lat = null, lng = null, geocoded_at = null,
    geocode_status = 'no_address', deleted_at = coalesce(deleted_at, completed), purged_at = completed
   where company_id = p_company and id = any (contact_ids) and id <> p_contact;
  perform set_config('loonext.activity_quiet', 'off', true);
  update public.contacts set erasure_completed_at = completed where id = p_contact;

  insert into public.audit_log (company_id, actor_user_id, action, target_type, target_id, before, after)
  values (p_company, customer.erasure_requested_by, 'contact.erased', 'contact', p_contact::text, '{}',
          jsonb_build_object('counts', customer.erasure_counts));

  insert into public.webhook_deliveries (id, company_id, endpoint_id, event_type, payload)
  select delivery.id, p_company, e.id, 'contact.deleted', jsonb_build_object(
    'id', delivery.id, 'type', 'contact.deleted', 'created_at', completed, 'company_id', p_company,
    'data', jsonb_build_object('id', p_contact)
  ) from public.webhook_endpoints e cross join lateral
    (select gen_random_uuid() as id where e.id is not null) delivery
   where e.company_id = p_company and e.active and e.events @> array['contact.deleted'];
  return true;
end;
$$;

do $migration$
declare
  edit record;
  definition text;
  updated text;
begin
  for edit in select * from (values
    ('public.api_list_trash(uuid,integer,timestamptz,uuid,uuid[])',
     'c.purged_at is null and c.merged_into is null',
     'c.purged_at is null and c.merged_into is null and not public.customer_erasure_pending(c.id)'),
    ('public.api_trash_due(integer)',
     'c.purged_at is null and c.merged_into is null',
     'c.purged_at is null and c.merged_into is null and not public.customer_erasure_pending(c.id)'),
    ('public.api_restore_trash(uuid,uuid,text,uuid,uuid[])',
     'if p_kind = ''contact'' then',
     $restore$if (p_kind = 'contact' and public.customer_erasure_pending(p_id)) or (p_kind = 'conversation' and exists (
    select 1 from public.conversations c where c.id = p_id and public.customer_erasure_pending(c.contact_id)
  )) or (p_kind = 'call' and exists (
    select 1 from public.calls k left join public.conversations c on c.id = k.conversation_id
     where k.id = p_id and (public.customer_erasure_pending(k.contact_id) or public.customer_erasure_pending(c.contact_id))
  )) then return jsonb_build_object('outcome', 'not_found');
  elsif p_kind = 'contact' then$restore$),
    ('public.api_purge_trash_item(text,uuid,uuid,uuid,uuid[])',
     'return public.purge_contact_from_trash(p_id, p_company_id, p_actor);',
     $purge$if public.customer_erasure_pending(p_id) then return jsonb_build_object('outcome', 'not_found'); end if;
    return public.purge_contact_from_trash(p_id, p_company_id, p_actor);$purge$),
    ('public.purge_expired_task(text,uuid)',
     $expiry$where t.id = p_id and t.deleted_at < cutoff and t.purged_at is null
       and t.trashed_with_conversation_at is null$expiry$,
     $task$where t.id = p_id and t.purged_at is null and (
       (t.deleted_at < cutoff and t.trashed_with_conversation_at is null)
       or (t.deleted_at is not null and public.customer_erasure_pending(t.contact_id)))$task$),
    ('public.api_trash_object_paths(text,uuid,uuid,uuid[])',
     $expiry$where t.id = p_id and t.deleted_at < now() - interval '30 days'
         and t.purged_at is null and t.trashed_with_conversation_at is null$expiry$,
     $task$where t.id = p_id and t.purged_at is null and (
         (t.deleted_at < now() - interval '30 days' and t.trashed_with_conversation_at is null)
         or (t.deleted_at is not null and public.customer_erasure_pending(t.contact_id)))$task$)
  ) as edits(signature, anchor, replacement)
  loop
    definition := pg_get_functiondef(edit.signature::regprocedure);
    updated := replace(definition, edit.anchor, edit.replacement);
    if updated = definition then
      raise exception 'Customer erasure anchor missing from %', edit.signature;
    end if;
    execute updated;
  end loop;
end $migration$;

revoke execute on function
  public.customer_erasure_group(uuid, uuid), public.customer_erasure_numbers(uuid, uuid), public.customer_erasure_calls(uuid, uuid),
  public.customer_erasure_pending(uuid), public.reject_customer_erasure_restore(),
  public.reject_pending_customer_record()
  from public, anon, authenticated, service_role;

revoke execute on function
  public.api_contact_erasure(uuid, uuid, uuid[], uuid), public.api_customer_erasures_due(integer),
  public.api_customer_erasure_batch(uuid, uuid, integer), public.api_finish_customer_erasure(uuid, uuid)
  from public, anon, authenticated;

grant execute on function
  public.api_contact_erasure(uuid, uuid, uuid[], uuid), public.api_customer_erasures_due(integer),
  public.api_customer_erasure_batch(uuid, uuid, integer), public.api_finish_customer_erasure(uuid, uuid)
  to service_role;
