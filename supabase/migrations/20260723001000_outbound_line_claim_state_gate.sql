-- #209: close the 4h busy-line wedge class on the OUTBOUND side of the claims
-- family. 20260723000000 taught api_claim_inbound_line that an outcome-null
-- calls row whose DO state mirror is already terminal ('ended_%', per
-- 20260717000000_calls_v3_state.sql) is a STRANDED row, not a live call. The
-- outbound checks were left behind: tonight a calls row stranded as
-- state='ended_answered' + outcome NULL (the terminal merge died on the old
-- transfer path) blocked every outbound call on its number for the full 4h
-- window ("This line is on another call right now") while the inbound side
-- had already been released by the gated claim.
--
-- Fix: the SAME predicate, applied to the two remaining busy checks that scan
-- outcome-null rows:
--   1. api_claim_outbound_line (latest definition:
--      20260712000700_outbound_line_claim.sql), the /calls/browser claim.
--   2. api_authorize_outbound_call (latest definition:
--      20260712000800_outbound_auth_recheck.sql), the call.initiated re-check
--      of the same line under the same lock.
-- state is NULL for legacy and outbound rows (calls-v3 §3 nullability); NULL
-- keeps today's behavior (busy), so this only ever RELEASES lines the DO
-- mirror proves are done; it never admits a second call onto a genuinely
-- live line. The reservation-table EXISTS (30s window) carries no state and
-- is untouched.
--
-- Additive-only: CREATE OR REPLACE of both functions, no table changes.
-- Copied verbatim from their latest definitions with ONLY the calls EXISTS
-- predicate extended.

-- 1. Atomic outbound line claim: under the SAME per-(company,number) lock,
-- refuse when the line is occupied (an in-flight calls row OR another fresh
-- reservation on the number), else record THIS reservation. Returns true when
-- the line was claimed, false when busy.
create or replace function public.api_claim_outbound_line(
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
         -- #209: an outcome-null row whose DO state mirror is already
         -- terminal is a STRANDED row, not a live call. Never busy.
         and (state is null or state not like 'ended_%')
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

-- 2. The call.initiated re-check (same line, same lock, consumed nonce) gets
-- the same gate: a stranded terminal-mirror row must not reject the dial.
create or replace function public.api_authorize_outbound_call(
  p_nonce          text,
  p_from           text,
  p_customer       text,
  p_call_session_id text,
  p_max_age_secs   int
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_number  uuid;
  v_busy    boolean;
begin
  -- Serialize concurrent initiate deliveries of the SAME session.
  perform pg_advisory_xact_lock(hashtextextended(p_call_session_id, 0));

  -- Consume the nonce, binding the presented caller ID to what was authorized.
  delete from public.outbound_call_authorizations
   where nonce = p_nonce
     and from_e164 = p_from
     and created_at > now() - make_interval(secs => p_max_age_secs)
   returning company_id, phone_number_id into v_company, v_number;

  if v_company is null then
    -- Nonce gone: a REPLAY of an authorized call has a calls row; else reject.
    select company_id, phone_number_id into v_company, v_number
      from public.calls where call_session_id = p_call_session_id limit 1;
    if v_company is null then
      return jsonb_build_object('authorized', false);
    end if;
    return jsonb_build_object(
      'authorized', true, 'company_id', v_company,
      'phone_number_id', v_number, 'replay', true);
  end if;

  -- Re-check the line under the per-(company,number) lock - a call may have
  -- gone live since /calls/browser reserved it (its reservation may since have
  -- gone stale). One live call per number is founder-binding, so refuse
  -- rather than create a second live row.
  perform pg_advisory_xact_lock(
    hashtextextended(v_company::text || ':' || v_number::text, 0));

  select
    exists (
      select 1 from public.calls
       where phone_number_id = v_number
         and outcome is null
         -- #209: an outcome-null row whose DO state mirror is already
         -- terminal is a STRANDED row, not a live call. Never busy.
         and (state is null or state not like 'ended_%')
         and call_session_id <> p_call_session_id
         and created_at > now() - interval '4 hours'
    )
    or exists (
      select 1 from public.outbound_call_authorizations
       where phone_number_id = v_number
         and created_at > now() - interval '30 seconds'
    )
  into v_busy;

  if v_busy then
    return jsonb_build_object('authorized', false, 'line_busy', true);
  end if;

  insert into public.calls as c
    (company_id, phone_number_id, call_session_id, caller_e164, direction)
  values (v_company, v_number, p_call_session_id, p_customer, 'outbound')
  on conflict (call_session_id) do nothing;

  return jsonb_build_object(
    'authorized', true, 'company_id', v_company,
    'phone_number_id', v_number, 'replay', false);
end;
$$;
revoke execute on function public.api_authorize_outbound_call(text, text, text, text, int)
  from public, anon, authenticated;
grant execute on function public.api_authorize_outbound_call(text, text, text, text, int)
  to service_role;
