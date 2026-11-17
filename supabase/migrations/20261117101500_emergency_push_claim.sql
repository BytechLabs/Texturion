drop function public.claim_emergency_ack(uuid, uuid, text, integer, integer, integer);

create function public.claim_emergency_ack(
  p_company_id uuid,
  p_conversation_id uuid,
  p_body text,
  p_segments_estimate integer,
  p_throttle_seconds integer,
  p_daily_cap integer,
  p_reply_allowed boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_block       text;
  v_company     public.companies%rowtype;
  v_dest_phone  text;
  v_last_ack    timestamptz;
  v_last_emergency timestamptz;
  v_claim       jsonb;
  v_message     public.messages%rowtype;
  v_now         timestamptz := now();
  v_today_count int;
begin
  if (p_reply_allowed and (p_body is null or length(trim(p_body)) = 0
     or p_segments_estimate is null or p_segments_estimate < 1))
     or p_throttle_seconds is null or p_throttle_seconds < 0
     or p_daily_cap is null or p_daily_cap < 0 then
    return jsonb_build_object('skipped', 'not_found');
  end if;

  select c.* into v_company
    from public.companies c
   where c.id = p_company_id
   for update;
  if not found then
    return jsonb_build_object('skipped', 'not_found');
  end if;

  if not coalesce(v_company.emergency_keyword_enabled, true) then
    return jsonb_build_object('skipped', 'emergency_disabled');
  end if;

  select conv.last_emergency_ack_at, ct.phone_e164, conv.emergency_at
    into v_last_ack, v_dest_phone, v_last_emergency
    from public.conversations conv
    join public.contacts ct on ct.id = conv.contact_id
   where conv.id = p_conversation_id
     and conv.company_id = p_company_id
   for update of conv;
  if not found then
    return jsonb_build_object('skipped', 'not_found');
  end if;

  -- Claim under the conversation lock so concurrent inbounds cannot both wake the crew.
  v_now := greatest(v_now, v_last_emergency);
  v_claim := jsonb_build_object('notify_immediately',
    v_last_emergency is null
    or v_last_emergency <= v_now - make_interval(secs => p_throttle_seconds));

  update public.conversations
     set emergency_at = v_now
   where id = p_conversation_id;

  insert into public.conversation_events
    (company_id, conversation_id, actor_user_id, type, payload)
  values
    (p_company_id, p_conversation_id, null, 'emergency_flagged',
     jsonb_build_object('source', 'inbound_keyword'));

  if not p_reply_allowed or not coalesce(v_company.emergency_reply_enabled, true) then
    return v_claim || jsonb_build_object('skipped', 'reply_disabled', 'flagged', true);
  end if;

  v_block := public.company_send_block(v_company);
  if v_block is not null then
    return v_claim || jsonb_build_object('skipped', v_block);
  end if;

  if exists (select 1 from public.opt_outs o
              where o.company_id = p_company_id
                and o.phone_e164 = v_dest_phone
                and o.revoked_at is null) then
    return v_claim || jsonb_build_object('skipped', 'recipient_opted_out');
  end if;

  if v_last_ack is not null
     and v_last_ack > v_now - make_interval(secs => p_throttle_seconds) then
    return v_claim || jsonb_build_object('skipped', 'throttled');
  end if;

  select count(*) into v_today_count
    from public.conversation_events e
   where e.company_id = p_company_id
     and e.type = 'emergency_flagged'
     and e.created_at > v_now - interval '24 hours';
  if v_today_count > p_daily_cap then
    return v_claim || jsonb_build_object('skipped', 'daily_cap');
  end if;

  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments,
     sent_by_user_id, automated, automation)
  values
    (p_company_id, p_conversation_id, 'outbound', p_body, 'queued',
     p_segments_estimate, v_company.owner_user_id, true, 'emergency_ack')
  returning * into v_message;

  update public.conversations
     set last_emergency_ack_at = v_now,
         last_message_at       = greatest(last_message_at, v_message.created_at)
   where id = p_conversation_id;

  insert into public.conversation_events
    (company_id, conversation_id, actor_user_id, type, payload)
  values
    (p_company_id, p_conversation_id, null, 'auto_reply_sent',
     jsonb_build_object('kind', 'emergency_ack', 'message_id', v_message.id));

  return v_claim || jsonb_build_object('message', to_jsonb(v_message) - 'body_tsv');
end $function$;

revoke all on function public.claim_emergency_ack(uuid, uuid, text, integer, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.claim_emergency_ack(uuid, uuid, text, integer, integer, integer, boolean) to service_role;
