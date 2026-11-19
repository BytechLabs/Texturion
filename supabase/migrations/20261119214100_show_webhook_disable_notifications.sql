create or replace function public.notification_feed(
  p_company_id        uuid,
  p_user_id           uuid,
  p_hidden_number_ids uuid[] default null,
  p_since             timestamptz default '-infinity'
) returns table (
  id              uuid,
  type            text,
  created_at      timestamptz,
  conversation_id uuid,
  message_id      uuid,
  task_id         uuid,
  contact_id      uuid
)
language sql
stable
security definer
set search_path = ''
as $$
    select m.id,
           'inbound_message'::text as type,
           m.created_at,
           m.conversation_id,
           m.id     as message_id,
           null::uuid as task_id,
           c.contact_id
    from public.messages m
    join public.conversations c on c.id = m.conversation_id and c.deleted_at is null
    where m.company_id = p_company_id
      and m.direction = 'inbound'
      and m.deleted_at is null
      and m.created_at > p_since
      and c.assigned_user_id = p_user_id
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
    union all
    select e.id, 'assigned', e.created_at, e.conversation_id,
           null::uuid, null::uuid, c.contact_id
    from public.conversation_events e
    join public.conversations c on c.id = e.conversation_id and c.deleted_at is null
    where e.company_id = p_company_id
      and e.type = 'assigned'
      and e.payload->>'to' = p_user_id::text
      and e.created_at > p_since
      and coalesce(e.actor_user_id, '00000000-0000-0000-0000-000000000000') <> p_user_id
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
    union all
    select e.id, 'task_assigned', e.created_at, e.conversation_id,
           null::uuid, (e.payload->>'task_id')::uuid, c.contact_id
    from public.conversation_events e
    join public.conversations c on c.id = e.conversation_id and c.deleted_at is null
    where e.company_id = p_company_id
      and e.type = 'task_assigned'
      and e.payload->>'to_user_id' = p_user_id::text
      and e.created_at > p_since
      and coalesce(e.actor_user_id, '00000000-0000-0000-0000-000000000000') <> p_user_id
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
    union all
    select e.id, 'missed_call', e.created_at, e.conversation_id,
           null::uuid, null::uuid, c.contact_id
    from public.conversation_events e
    join public.conversations c on c.id = e.conversation_id and c.deleted_at is null
    where e.company_id = p_company_id
      and e.type = 'call_completed'
      and e.payload->>'outcome' = 'missed'
      and e.created_at > p_since
      and coalesce(e.payload->>'direction', 'inbound') = 'inbound'
      and (c.assigned_user_id is null or c.assigned_user_id = p_user_id)
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
    union all
    select m.id, 'mention', m.created_at, m.conversation_id,
           m.id, null::uuid, c.contact_id
    from public.message_mentions mn
    join public.messages m      on m.id = mn.message_id and m.deleted_at is null
    join public.conversations c on c.id = m.conversation_id and c.deleted_at is null
    where mn.company_id = p_company_id
      and mn.user_id = p_user_id
      and m.direction = 'note'
      and m.created_at > p_since
      and m.sent_by_user_id is distinct from p_user_id
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
    union all
    select a.id, 'webhook_disabled', a.occurred_at,
           null::uuid, null::uuid, null::uuid, null::uuid
    from public.audit_log a
    where a.company_id = p_company_id
      and a.action = 'webhook.endpoint_disabled'
      and a.occurred_at > p_since
      and exists (
        select 1 from public.company_members member
        where member.company_id = p_company_id and member.user_id = p_user_id
          and member.deactivated_at is null and member.role in ('owner', 'admin')
      )
$$;
