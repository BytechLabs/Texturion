-- #208 (belt and braces): close the 4h busy-line wedge class at the claim
-- itself. api_claim_inbound_line's busy EXISTS treated ANY outcome-null calls
-- row in the window as an occupied line. But a row can be STRANDED
-- outcome-null while the call is in fact over. This is a known class (see the
-- NOTE in apps/api/src/messaging/voice-webhook.ts, terminal handler): the
-- event that resolves the call is dropped or never arrives, the row stays
-- outcome-null, the line wedges until the 4h janitor, and every later inbound
-- call on the number skips the ring and goes straight to voicemail. #208's
-- concrete instance: the customer leg was already dead when the owner-death
-- teardown tried to hang it up, so no terminal webhook ever came.
--
-- The calls-v3 CallSessionDO mirrors its granular state into calls.state
-- ('ended_%' = terminal, per 20260717000000_calls_v3_state.sql). Require the
-- blocking row to be NON-TERMINAL in that mirror too: a stranded outcome-null
-- row whose machine already ended can no longer hold the line. state is NULL
-- for legacy and outbound rows (§3 nullability); NULL keeps today's behavior
-- (busy), so this only ever RELEASES lines the DO mirror proves are done; it
-- never admits a second call onto a genuinely live line.
--
-- Additive-only: CREATE OR REPLACE of the function, no table changes. Copied
-- verbatim from 20260712000700_outbound_line_claim.sql with ONLY the calls
-- EXISTS predicate extended.
create or replace function public.api_claim_inbound_line(
  p_company_id      uuid,
  p_phone_number_id uuid,
  p_call_session_id text,
  p_caller_e164     text,
  p_window_start    timestamptz
) returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_busy boolean;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_company_id::text || ':' || p_phone_number_id::text, 0));

  select
    exists (
      select 1 from public.calls
       where phone_number_id = p_phone_number_id
         and outcome is null
         -- #208: an outcome-null row whose DO state mirror is already
         -- terminal is a STRANDED row, not a live call. Never busy.
         and (state is null or state not like 'ended_%')
         and call_session_id <> p_call_session_id
         and created_at >= p_window_start
    )
    or exists (
      select 1 from public.outbound_call_authorizations
       where phone_number_id = p_phone_number_id
         and created_at > now() - interval '30 seconds'
    )
  into v_busy;

  insert into public.calls as c
    (company_id, phone_number_id, call_session_id, caller_e164, direction)
  values
    (p_company_id, p_phone_number_id, p_call_session_id, p_caller_e164, 'inbound')
  on conflict (call_session_id) do update set
    caller_e164     = coalesce(c.caller_e164, excluded.caller_e164),
    phone_number_id = coalesce(c.phone_number_id, excluded.phone_number_id);

  return v_busy;
end;
$$;
revoke execute on function public.api_claim_inbound_line(uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_claim_inbound_line(uuid, uuid, text, text, timestamptz)
  to service_role;
