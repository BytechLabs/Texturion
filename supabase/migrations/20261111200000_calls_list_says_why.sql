-- #725: the calls list says where each call went (#721) and why it ended.
-- Both were recorded but only the call page read them, so a row could not
-- say "Missed · Nobody answered in time".

create or replace function public.api_list_calls(
  p_company_id         uuid,
  p_limit              int,
  p_outcome            text default null,
  p_cursor_ts          timestamptz default null,
  p_cursor_id          uuid default null,
  p_hidden_number_ids  uuid[] default null,
  p_contact_id         uuid default null
) returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'call_session_id', c.call_session_id,
    'caller_e164', c.caller_e164,
    'contact_id', c.contact_id,
    'contact_name', ct.name,
    'caller_name', c.caller_name,
    'phone_number_id', c.phone_number_id,
    'conversation_id', c.conversation_id,
    'outcome', c.outcome,
    'state', c.state,
    'direction', c.direction,
    'forward_seconds', c.forward_seconds,
    'screening_result', c.screening_result,
    'stir_attestation', c.stir_attestation,
    'routing', c.routing,
    'ended_reason', c.ended_reason,
    'voicemail_seconds', case when c.voicemail_deleted_at is null then c.voicemail_seconds end,
    'voicemail_transcript', case when c.voicemail_deleted_at is null then c.voicemail_transcript end,
    'voicemail_intake', case when c.voicemail_deleted_at is null then c.voicemail_intake end,
    'answered_by_user_id', c.answered_by_user_id,
    'answered_at', c.answered_at,
    'started_at', c.started_at
  )
  from public.calls c
  left join public.contacts ct on ct.id = c.contact_id
  where c.company_id = p_company_id
    and c.deleted_at is null
    and (p_contact_id is null or c.contact_id = p_contact_id)
    and (p_outcome is null or c.outcome = p_outcome)
    and (p_hidden_number_ids is null
         or c.phone_number_id is null
         or not (c.phone_number_id = any (p_hidden_number_ids)))
    and (p_cursor_ts is null
         or (c.started_at, c.id) < (p_cursor_ts, p_cursor_id))
  order by c.started_at desc, c.id desc
  limit greatest(p_limit, 0)
$$;

revoke execute on function public.api_list_calls(uuid, int, text, timestamptz, uuid, uuid[], uuid)
  from public, anon, authenticated;
grant execute on function public.api_list_calls(uuid, int, text, timestamptz, uuid, uuid[], uuid)
  to service_role;
