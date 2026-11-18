create function public.api_insert_voicemail_event(
  p_company_id uuid,
  p_conversation_id uuid,
  p_call_session_id text,
  p_caller text,
  p_seconds integer,
  p_transcript text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform 1 from public.conversations
   where id = p_conversation_id and company_id = p_company_id
   for no key update;
  if not found then
    raise exception 'Voicemail conversation was not found in the workspace';
  end if;

  if exists (
    select 1 from public.conversation_events
     where conversation_id = p_conversation_id and type = 'call_completed'
       and payload->>'call_session_id' = p_call_session_id and payload->>'kind' = 'voicemail'
  ) then
    return false;
  end if;

  insert into public.conversation_events (company_id, conversation_id, type, payload)
  values (
    p_company_id, p_conversation_id, 'call_completed',
    jsonb_build_object(
      'kind', 'voicemail', 'call_session_id', p_call_session_id, 'outcome', 'voicemail',
      'voicemail_seconds', p_seconds, 'caller', p_caller
    ) || case
      when nullif(p_transcript, '') is not null then jsonb_build_object('transcript', p_transcript)
      else '{}'::jsonb
    end
  );
  return true;
end;
$function$;

revoke all on function public.api_insert_voicemail_event(uuid, uuid, text, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.api_insert_voicemail_event(uuid, uuid, text, text, integer, text)
  to service_role;
