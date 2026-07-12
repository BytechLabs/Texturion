-- #135 (D43) — close the outbound line-model race. POST /v1/calls/browser
-- checked "one live call per number" with a lock-free SELECT and created no
-- row (the calls row lands only later at call.initiated), so two outbound
-- calls on one number — or an inbound call during the authorize→initiate
-- window — could both go live, breaking the founder-binding invariant.
--
-- Fix: the outbound authorization row IS the line reservation. Claim it
-- ATOMICALLY under the SAME per-(company,number) advisory lock the inbound
-- claim uses, and teach BOTH busy checks to see an in-flight reservation
-- (fresh, i.e. within the authorize→initiate window) as an occupied line.

-- A fresh reservation window: long enough to bridge authorize → call.initiated
-- (~1-3s), short enough that an abandoned reservation (browser never dialed)
-- frees the line quickly. Once call.initiated lands, the calls row is the
-- durable busy signal and the reservation is consumed.
-- (Encoded inline as 30 seconds below.)

-- Inbound claim now ALSO treats a fresh outbound reservation on the number as
-- busy (closing the inbound-vs-outbound window).
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

-- Atomic outbound line claim: under the SAME per-(company,number) lock, refuse
-- when the line is occupied (an in-flight calls row OR another fresh
-- reservation on the number), else record THIS reservation. Returns true when
-- the line was claimed, false when busy.
create function public.api_claim_outbound_line(
  p_company_id      uuid,
  p_phone_number_id uuid,
  p_nonce           text,
  p_from            text,
  p_customer        text,
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
         and created_at >= p_window_start
    )
    or exists (
      select 1 from public.outbound_call_authorizations
       where phone_number_id = p_phone_number_id
         and created_at > now() - interval '30 seconds'
    )
  into v_busy;

  if v_busy then
    return false;
  end if;

  insert into public.outbound_call_authorizations
    (nonce, company_id, phone_number_id, from_e164, customer_e164)
  values (p_nonce, p_company_id, p_phone_number_id, p_from, p_customer);
  return true;
end;
$$;
revoke execute on function public.api_claim_outbound_line(uuid, uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_claim_outbound_line(uuid, uuid, text, text, text, timestamptz)
  to service_role;
