-- #135 (D43) — close the last outbound line-race gap. The reservation row is
-- only treated as "line busy" for 30s, but the nonce stays consumable for up
-- to 120s, so a dial whose call.initiated lands 30-120s after /calls/browser
-- fell into a window where the reservation was stale AND the calls row didn't
-- yet exist — the line read free and a second call could claim it.
--
-- Fix: api_authorize_outbound_call now RE-RUNS the per-number line busy check
-- at call.initiated, under the per-(company,number) advisory lock, AFTER
-- consuming the nonce. If the line went live in the meantime it rejects this
-- call outright (never creating a second live row on the number), regardless
-- of how stale the reservation had become. Lock order is session→number,
-- which never cycles with the number-only claim RPCs, so no deadlock.

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

  -- Re-check the line under the per-(company,number) lock — a call may have
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
