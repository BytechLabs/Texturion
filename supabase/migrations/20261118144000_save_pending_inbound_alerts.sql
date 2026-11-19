alter table public.messages
  add column crew_notify_state text not null default 'none'
    check (crew_notify_state in ('none', 'pending', 'attempted')),
  add column crew_notify_verdict jsonb;

create index messages_pending_inbound_notify_idx
  on public.messages (created_at, id)
  where crew_notify_state = 'pending' and deleted_at is null;

create function public.thread_inbound_message(
  p_company_id uuid,
  p_phone_number_id uuid,
  p_from_e164 text,
  p_body text,
  p_telnyx_message_id text,
  p_timezone text,
  p_email_limit integer,
  p_push_limit integer,
  p_notify_emergency boolean,
  p_notify_media_count integer,
  p_reaction jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_id uuid;
  v_state text;
  v_verdict jsonb;
  v_reply_users uuid[];
  v_emergency_claimed boolean := false;
begin
  if p_reaction is null then
    v_result := public.thread_inbound_message(
      p_company_id, p_phone_number_id, p_from_e164, p_body, p_telnyx_message_id,
      p_timezone, p_email_limit, p_push_limit
    );
  else
    v_result := public.thread_inbound_message(
      p_company_id, p_phone_number_id, p_from_e164, p_body, p_telnyx_message_id,
      p_timezone, p_email_limit, p_push_limit, p_reaction
    );
    if v_result->>'notify_reason' = 'reaction' then
      return v_result;
    end if;
  end if;
  v_id := (v_result->>'message_id')::uuid;

  if (v_result->>'created')::boolean and p_notify_emergency then
    select (c.emergency_at is null or c.emergency_at <= now() - interval '1 hour')
      and not exists (
        select 1 from public.messages m
         where m.company_id = c.company_id and m.conversation_id = c.id
           and m.id <> v_id and m.created_at > now() - interval '1 hour'
           and m.crew_notify_verdict->>'emergency' = 'true'
      )
      into v_emergency_claimed
      from public.conversations c
     where c.id = (v_result->>'conversation_id')::uuid and c.company_id = p_company_id;
  end if;

  if (v_result->>'created')::boolean and not p_notify_emergency
     and v_result->>'notify_reason' = 'append'
     and not (v_result->>'notify_email')::boolean and not (v_result->>'notify_push')::boolean then
    select array_agg(distinct m.sent_by_user_id) into v_reply_users
      from public.conversations c
      join public.messages m on m.conversation_id = c.id and m.company_id = c.company_id
     where c.id = (v_result->>'conversation_id')::uuid and c.company_id = p_company_id
       and not c.is_spam and c.deleted_at is null
       and c.last_notified_at > now() - interval '15 minutes'
       and m.direction = 'outbound' and not m.automated and m.sent_by_user_id is not null
       and m.created_at > c.last_notified_at and m.deleted_at is null
       and m.status <> 'failed';
    if cardinality(v_reply_users) > 0 then
      v_result := v_result || jsonb_build_object('notify_push', true, 'notify_reason', 'reply');
      update public.conversations set last_notified_at = now()
       where id = (v_result->>'conversation_id')::uuid and company_id = p_company_id;
    end if;
  end if;

  if (v_result->>'created')::boolean and (
    p_notify_emergency or (v_result->>'notify_email')::boolean or (v_result->>'notify_push')::boolean
  ) then
    update public.messages
       set crew_notify_state = 'pending',
           crew_notify_verdict = jsonb_build_object(
             'allow_email', p_notify_emergency or coalesce((v_result->>'notify_email')::boolean, false),
             'allow_push', p_notify_emergency or coalesce((v_result->>'notify_push')::boolean, false),
             'notify_reason', v_result->>'notify_reason',
             'emergency', p_notify_emergency,
             'emergency_claimed', v_emergency_claimed,
             'reply_user_ids', v_reply_users,
             'media_count', p_notify_media_count
           )
     where id = v_id and company_id = p_company_id;
  end if;

  select crew_notify_state, crew_notify_verdict into v_state, v_verdict
    from public.messages
   where id = v_id and company_id = p_company_id;
  return v_result || jsonb_build_object(
    'crew_notify_state', v_state, 'crew_notify_verdict', v_verdict
  );
end
$$;

create function public.api_mark_inbound_notify_attempted(
  p_company_id uuid, p_message_id uuid, p_require_unread boolean
) returns boolean
language sql
security definer
set search_path = ''
as $$
  with candidate as (
    select m.id,
      (m.deleted_at is null and m.created_at >= now() - interval '30 minutes'
       and c.deleted_at is null and not c.is_spam
       and not exists (
         select 1 from public.blocked_senders b
          where b.company_id = c.company_id and b.phone_e164 = c.contact_phone_e164
       )
       and (
         not p_require_unread or (
           not exists (
             select 1 from public.conversation_reads r
              where r.conversation_id = m.conversation_id and r.last_read_at >= m.created_at
           )
           and not exists (
             select 1 from public.messages reply
              where reply.company_id = m.company_id and reply.conversation_id = m.conversation_id
                and reply.direction = 'outbound' and not reply.automated
                and reply.created_at >= m.created_at and reply.deleted_at is null
           )
         )
       )) as eligible
      from public.messages m
      join public.conversations c on c.id = m.conversation_id and c.company_id = m.company_id
     where m.id = p_message_id and m.company_id = p_company_id
       and m.crew_notify_state = 'pending'
  ), resolved as (
    update public.messages m
       set crew_notify_state = case when candidate.eligible then 'attempted' else 'none' end
      from candidate
     where m.id = candidate.id and m.crew_notify_state = 'pending'
    returning m.crew_notify_state
  )
  select exists (select 1 from resolved where crew_notify_state = 'attempted')
$$;

revoke execute on function public.thread_inbound_message(
  uuid, uuid, text, text, text, text, integer, integer, boolean, integer, jsonb
) from public, anon, authenticated;
grant execute on function public.thread_inbound_message(
  uuid, uuid, text, text, text, text, integer, integer, boolean, integer, jsonb
) to service_role;

revoke execute on function public.api_mark_inbound_notify_attempted(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.api_mark_inbound_notify_attempted(uuid, uuid, boolean)
  to service_role;
