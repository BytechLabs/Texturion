-- #129 P4 remainder (docs/CALLS-FEATURE.md; deferred from D37, shipped with
-- the D38 wave): missed calls reach the D24 in-app bell. Both notification
-- twins gain a `missed_call` arm reading the `call_completed` timeline event
-- (outcome 'missed', INBOUND only — an outbound no-answer is the crew's own
-- action, never bell noise). Audience mirrors the push alert exactly:
-- the assignee when the conversation is assigned, every member when it is
-- not; #106 p_hidden_number_ids filters per arm like every other arm, and
-- the twins change in lockstep so the badge and the popover never disagree.
--
-- Also: api_thread_call now RETURNS `event_inserted` so the webhook can fire
-- the crew push/email alert exactly once per call (the event insert is the
-- per-call claim) even when the text-back is off — decoupling the alert from
-- the MCTB claim (same signature, body replaced in place).

drop function if exists public.api_notifications(uuid, uuid, int, timestamptz, uuid, uuid[]);

create function public.api_notifications(
  p_company_id        uuid,
  p_user_id           uuid,
  p_limit             int,
  p_before_ts         timestamptz default null,
  p_before_id         uuid        default null,
  p_hidden_number_ids uuid[]      default null
) returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with seen as (
    select coalesce(
             (select nr.last_seen_at from public.notification_reads nr
               where nr.user_id = p_user_id and nr.company_id = p_company_id),
             '-infinity'::timestamptz) as last_seen_at
  ),
  feed as (
    select m.id,
           'inbound_message'::text as type,
           m.created_at,
           m.conversation_id,
           m.id     as message_id,
           null::uuid as task_id,
           c.contact_id
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.company_id = p_company_id
      and m.direction = 'inbound'
      and c.assigned_user_id = p_user_id
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
    union all
    select e.id, 'assigned', e.created_at, e.conversation_id,
           null::uuid, null::uuid, c.contact_id
    from public.conversation_events e
    join public.conversations c on c.id = e.conversation_id
    where e.company_id = p_company_id
      and e.type = 'assigned'
      and e.payload->>'to' = p_user_id::text
      and coalesce(e.actor_user_id, '00000000-0000-0000-0000-000000000000') <> p_user_id
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
    union all
    select e.id, 'task_assigned', e.created_at, e.conversation_id,
           null::uuid, (e.payload->>'task_id')::uuid, c.contact_id
    from public.conversation_events e
    join public.conversations c on c.id = e.conversation_id
    where e.company_id = p_company_id
      and e.type = 'task_assigned'
      and e.payload->>'to_user_id' = p_user_id::text
      and coalesce(e.actor_user_id, '00000000-0000-0000-0000-000000000000') <> p_user_id
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
    union all
    -- #129: an INBOUND missed call — assignee-else-everyone, like the push.
    select e.id, 'missed_call', e.created_at, e.conversation_id,
           null::uuid, null::uuid, c.contact_id
    from public.conversation_events e
    join public.conversations c on c.id = e.conversation_id
    where e.company_id = p_company_id
      and e.type = 'call_completed'
      and e.payload->>'outcome' = 'missed'
      and coalesce(e.payload->>'direction', 'inbound') = 'inbound'
      and (c.assigned_user_id is null or c.assigned_user_id = p_user_id)
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
  )
  select jsonb_build_object(
           'id', f.id,
           'type', f.type,
           'conversation_id', f.conversation_id,
           'message_id', f.message_id,
           'task_id', f.task_id,
           'contact', jsonb_build_object('id', ct.id, 'name', ct.name,
                                         'phone_e164', ct.phone_e164),
           'created_at', f.created_at,
           'unread', (f.created_at > s.last_seen_at))
  from feed f
  cross join seen s
  left join public.contacts ct on ct.id = f.contact_id
  where (p_before_ts is null or (f.created_at, f.id) < (p_before_ts, p_before_id))
  order by f.created_at desc, f.id desc
  limit greatest(p_limit, 0)
$$;
revoke execute on function public.api_notifications(uuid, uuid, int, timestamptz, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.api_notifications(uuid, uuid, int, timestamptz, uuid, uuid[])
  to service_role;

drop function if exists public.api_notifications_unread_count(uuid, uuid, uuid[]);

create function public.api_notifications_unread_count(
  p_company_id        uuid,
  p_user_id           uuid,
  p_hidden_number_ids uuid[] default null
) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  with seen as (
    select coalesce(
             (select nr.last_seen_at from public.notification_reads nr
               where nr.user_id = p_user_id and nr.company_id = p_company_id),
             '-infinity'::timestamptz) as last_seen_at
  )
  select count(*)::bigint from (
    select m.created_at
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.company_id = p_company_id and m.direction = 'inbound'
      and c.assigned_user_id = p_user_id
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
    union all
    select e.created_at
    from public.conversation_events e
    join public.conversations c on c.id = e.conversation_id
    where e.company_id = p_company_id and e.type = 'assigned'
      and e.payload->>'to' = p_user_id::text
      and coalesce(e.actor_user_id, '00000000-0000-0000-0000-000000000000') <> p_user_id
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
    union all
    select e.created_at
    from public.conversation_events e
    join public.conversations c on c.id = e.conversation_id
    where e.company_id = p_company_id and e.type = 'task_assigned'
      and e.payload->>'to_user_id' = p_user_id::text
      and coalesce(e.actor_user_id, '00000000-0000-0000-0000-000000000000') <> p_user_id
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
    union all
    select e.created_at
    from public.conversation_events e
    join public.conversations c on c.id = e.conversation_id
    where e.company_id = p_company_id
      and e.type = 'call_completed'
      and e.payload->>'outcome' = 'missed'
      and coalesce(e.payload->>'direction', 'inbound') = 'inbound'
      and (c.assigned_user_id is null or c.assigned_user_id = p_user_id)
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
  ) f, seen s
  where f.created_at > s.last_seen_at
$$;
revoke execute on function public.api_notifications_unread_count(uuid, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.api_notifications_unread_count(uuid, uuid, uuid[])
  to service_role;

-- api_thread_call: same signature, body replaced — the return gains
-- `event_inserted` (true exactly once per call session) so the webhook's
-- crew alert is per-call idempotent without the MCTB claim.
create or replace function public.api_thread_call(
  p_company_id       uuid,
  p_phone_number_id  uuid,
  p_caller_e164      text,
  p_call_session_id  text,
  p_outcome          text,
  p_forward_seconds  int,
  p_create_if_missing boolean,
  p_direction        text default 'inbound'
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now        timestamptz := now();
  v_contact_id uuid;
  v_conv       public.conversations%rowtype;
  v_inserted   boolean := false;
begin
  if p_caller_e164 is null or length(p_caller_e164) = 0 then
    return '{}'::jsonb;
  end if;

  if p_create_if_missing then
    insert into public.contacts as ct (company_id, phone_e164, consent_source, consent_at)
    values (p_company_id, p_caller_e164, 'inbound_sms', v_now)
    on conflict (company_id, phone_e164) do update
      set deleted_at     = null,
          consent_source = coalesce(ct.consent_source, excluded.consent_source),
          consent_at     = coalesce(ct.consent_at, excluded.consent_at)
    returning ct.id into v_contact_id;
  else
    select ct.id into v_contact_id
      from public.contacts ct
     where ct.company_id = p_company_id
       and ct.phone_e164 = p_caller_e164
       and ct.deleted_at is null;
    if not found then
      return '{}'::jsonb;
    end if;
  end if;

  select conv.* into v_conv
    from public.conversations conv
   where conv.company_id = p_company_id
     and conv.phone_number_id = p_phone_number_id
     and conv.contact_id = v_contact_id
     and conv.closed_at is null
   for update;

  if not found then
    if not p_create_if_missing then
      return '{}'::jsonb;
    end if;

    select conv.* into v_conv
      from public.conversations conv
     where conv.company_id = p_company_id
       and conv.phone_number_id = p_phone_number_id
       and conv.contact_id = v_contact_id
       and conv.closed_at is not null
       and not conv.is_spam
     order by conv.closed_at desc
     limit 1
     for update;

    if found and v_conv.closed_at >= v_now - interval '30 days' then
      update public.conversations
         set status = 'new', closed_at = null
       where id = v_conv.id
      returning * into v_conv;
    else
      insert into public.conversations (company_id, contact_id, phone_number_id, status)
      values (p_company_id, v_contact_id, p_phone_number_id, 'new')
      on conflict (company_id, phone_number_id, contact_id) where closed_at is null
      do nothing
      returning * into v_conv;

      if v_conv.id is null then
        select conv.* into v_conv
          from public.conversations conv
         where conv.company_id = p_company_id
           and conv.phone_number_id = p_phone_number_id
           and conv.contact_id = v_contact_id
           and conv.closed_at is null
         for update;
        if not found then
          raise exception 'api_thread_call: lost conversation race for company %', p_company_id;
        end if;
      end if;
    end if;
  end if;

  if not exists (
    select 1 from public.conversation_events e
     where e.company_id = p_company_id
       and e.conversation_id = v_conv.id
       and e.type = 'call_completed'
       and e.payload->>'call_session_id' = p_call_session_id
  ) then
    insert into public.conversation_events
      (company_id, conversation_id, actor_user_id, type, payload)
    values
      (p_company_id, v_conv.id, null, 'call_completed',
       jsonb_build_object(
         'call_session_id', p_call_session_id,
         'outcome', p_outcome,
         'forward_seconds', coalesce(p_forward_seconds, 0),
         'caller', p_caller_e164,
         'direction', coalesce(nullif(p_direction, ''), 'inbound')));
    update public.conversations
       set last_message_at = greatest(coalesce(last_message_at, v_now), v_now)
     where id = v_conv.id;
    v_inserted := true;
  end if;

  return jsonb_build_object(
    'contact_id', v_contact_id,
    'conversation_id', v_conv.id,
    'event_inserted', v_inserted);
end;
$$;
