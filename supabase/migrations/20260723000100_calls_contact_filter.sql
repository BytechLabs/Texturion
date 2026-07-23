-- #205 per-contact call history: api_list_calls gains an OPTIONAL
-- p_contact_id filter so GET /v1/calls?contact_id=... can show one contact's
-- calls (the contact drawer's history tab). Additive and null-safe:
-- p_contact_id defaults to null, and null means "every contact" - every
-- existing call site is untouched. All existing semantics are preserved
-- verbatim: the #106 deny list still runs INSIDE the SQL before the keyset
-- window (a restricted member sees none of a hidden number's calls even when
-- asking for one contact), p_outcome composes with the new filter, and the
-- (started_at, id) keyset cursor is unchanged.
--
-- Adding a parameter changes the signature, so the 6-arg overload is dropped
-- and the 7-arg version recreated (otherwise PostgREST sees two candidates
-- for a no-p_contact_id call). Body is otherwise identical to
-- 20260717000000 (calls v3 state projection): SECURITY DEFINER, empty
-- search_path, service-role only.

drop function if exists public.api_list_calls(
  uuid, int, text, timestamptz, uuid, uuid[]);

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
