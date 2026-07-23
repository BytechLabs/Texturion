-- #210 ongoing-call visibility: the list projection gains answered_at so the
-- live-duration ticker can anchor on when the call was ANSWERED, not when it
-- started ringing (without it, both clients fall back to started_at and an
-- answered call's timer over-counts by the ring window). Additive and
-- nullable; the signature is unchanged, so CREATE OR REPLACE suffices and
-- every existing call site is untouched. Body otherwise identical to
-- 20260723000100 (contact filter).

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
    'voicemail_seconds', c.voicemail_seconds,
    'answered_by_user_id', c.answered_by_user_id,
    'answered_at', c.answered_at,
    'started_at', c.started_at
  )
  from public.calls c
  left join public.contacts ct on ct.id = c.contact_id
  where c.company_id = p_company_id
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
