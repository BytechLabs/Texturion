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
  p_notify_opt_out_hint boolean,
  p_reaction jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_conversation_id uuid;
  v_verdict jsonb;
  v_notify_day date;
  v_allow_push boolean;
begin
  v_result := public.thread_inbound_message(
    p_company_id, p_phone_number_id, p_from_e164, p_body, p_telnyx_message_id,
    p_timezone, p_email_limit, p_push_limit, p_notify_emergency, p_notify_media_count, p_reaction
  );
  if not p_notify_opt_out_hint or (v_result->>'created')::boolean is not true
     or v_result->>'notify_reason' = 'reaction' then
    return v_result;
  end if;

  v_conversation_id := (v_result->>'conversation_id')::uuid;
  update public.conversations
     set opt_out_hint_at = now()
   where company_id = p_company_id and id = v_conversation_id
     and opt_out_hint_at is null and deleted_at is null and not is_spam;
  if not found then
    return v_result;
  end if;

  insert into public.audit_log (company_id, action, target_type, target_id, after)
  values (p_company_id, 'opt_out.language_detected', 'conversation', v_conversation_id,
          jsonb_build_object('from', p_from_e164));

  if p_notify_emergency then
    return v_result;
  end if;

  begin
    v_notify_day := (now() at time zone coalesce(p_timezone, 'UTC'))::date;
  exception when invalid_parameter_value then
    v_notify_day := (now() at time zone 'UTC')::date;
  end;

  v_allow_push := coalesce((v_result->'crew_notify_verdict'->>'allow_push')::boolean, false)
    or not exists (
      select 1 from public.inbound_notification_days d
       where d.company_id = p_company_id and d.day = v_notify_day
         and d.notify_count >= p_push_limit
    );
  if not v_allow_push then
    return v_result;
  end if;

  v_verdict := jsonb_build_object(
    'allow_email', coalesce((v_result->'crew_notify_verdict'->>'allow_email')::boolean, false),
    'allow_push', true,
    'notify_reason', 'opt_out_hint',
    'emergency', false,
    'media_count', p_notify_media_count
  );
  update public.messages
     set crew_notify_state = 'pending', crew_notify_verdict = v_verdict
   where company_id = p_company_id and id = (v_result->>'message_id')::uuid;

  return v_result || jsonb_build_object(
    'crew_notify_state', 'pending', 'crew_notify_verdict', v_verdict
  );
end $$;

revoke execute on function public.thread_inbound_message(
  uuid, uuid, text, text, text, text, integer, integer, boolean, integer, boolean, jsonb
) from public, anon, authenticated;
grant execute on function public.thread_inbound_message(
  uuid, uuid, text, text, text, text, integer, integer, boolean, integer, boolean, jsonb
) to service_role;
