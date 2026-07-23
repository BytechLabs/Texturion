-- #211 SECURITY (call-hijack fix): authorization-scope the REPLAY branch of
-- api_authorize_outbound_call. Follow-on to 20260723004000 (left in place for a
-- clean review diff); this is an additive CREATE OR REPLACE with the SAME 5-arg
-- signature, so nothing else changes.
--
-- THE HOLE (in 20260723004000): when the nonce DELETE consumed nothing (a
-- genuine re-delivery, OR a forged leg carrying a random nonce), the replay
-- branch did an UNSCOPED lookup:
--     select company_id, phone_number_id from public.calls
--      where call_session_id = p_call_session_id
-- p_call_session_id is the CALLER-SUPPLIED tag part-4. A member could craft a
-- 4-part oc tag whose part-4 = a VICTIM's live session id S_v (S_v is not secret
-- -- it rides the X-Loonext-Session SIP header and the /calls/live control
-- handle). The unscoped lookup then returned the VICTIM's company + number and
-- echoed session_id = S_v with replay=true. Downstream, the S1 identity gate
-- (auth.session_id === tag part-4) passed trivially and the customer-leg stamp
-- wrote the ATTACKER's call-control id onto the victim row -- a later transfer
-- bridged the target to the attacker (hijack/eavesdrop), and on DO eviction the
-- reconstructed machine pointed customerCcid at the attacker leg (stranding the
-- real customer). The dark CALLS_OUTBOUND_V3 flag did NOT protect it: edge
-- routing was gated only on callsV3Active.
--
-- THE FIX (defense in depth; the routing + the TS stamp are fixed alongside):
--   * The replay lookup is AUTHORIZATION-SCOPED. It matches ONLY an OUTBOUND row
--     (a row THIS RPC minted from a consumed authorization -- inbound rows are
--     keyed on Telnyx's own call_session_id and are never minted here) whose
--     presented caller id (the business number, phone_numbers.number_e164)
--     equals p_from -- the SAME (from) binding the FRESH branch's nonce DELETE
--     enforces. A forger who cannot present the row's OWN business number gets
--     authorized=false; its crafted leg is hung up (bounded self-DoS), never a
--     victim tenant. Tenant for any WRITE thus never originates from a row looked
--     up by a caller-controlled session id alone (F3).
--   * The caller (runtime.loadOutboundInitiatedContext / voice-webhook) now
--     DROPS the replay without any customer_call_control_id write, so even a
--     same-tenant replay that legitimately matches performs no stamp -- the
--     already-live machine (or a later adopt-from-row) carries the call.
--
-- Body is copied VERBATIM from 20260723004000 with the SOLE change being the
-- replay-branch SELECT (unscoped -> outbound + from-scoped). Every other line --
-- the advisory locks, the nonce DELETE ... RETURNING, the coalesce(stored_S,
-- caller_T) PK, the #209 state-gated busy re-check, the INSERT, both jsonb
-- returns -- is byte-identical.

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
  v_auth_session uuid;   -- the nonce-bound S stored at claim (null for legacy)
  v_user    uuid;        -- the placing member stored at claim
  v_session_id text;     -- the calls-row PK: coalesce(stored_S, caller_T)
  v_busy    boolean;
begin
  -- Serialize concurrent initiate deliveries of the SAME session.
  perform pg_advisory_xact_lock(hashtextextended(p_call_session_id, 0));

  -- Consume the nonce, binding the presented caller ID to what was authorized.
  -- #211: also read back the nonce-bound S + placing member.
  delete from public.outbound_call_authorizations
   where nonce = p_nonce
     and from_e164 = p_from
     and created_at > now() - make_interval(secs => p_max_age_secs)
   returning company_id, phone_number_id, call_session_id, user_id
        into v_company, v_number, v_auth_session, v_user;

  if v_company is null then
    -- Nonce gone: a REPLAY of an authorized call has a calls row; else reject.
    -- #211 SECURITY (call-hijack fix): the lookup is AUTHORIZATION-SCOPED -- it
    -- matches ONLY an OUTBOUND row (minted here by a consumed authorization;
    -- inbound rows key on Telnyx's T and are never minted by this RPC) whose
    -- business number (phone_numbers.number_e164) equals the PRESENTED from, the
    -- same (from) binding the fresh DELETE above enforces. A forger presenting a
    -- victim's session id under a from it does NOT own gets no row back and is
    -- rejected (its crafted leg is hung up). The tenant a WRITE keys on is thus
    -- NEVER derived from a caller-controlled session id alone.
    select c.company_id, c.phone_number_id, c.answered_by_user_id
      into v_company, v_number, v_user
      from public.calls c
      join public.phone_numbers pn on pn.id = c.phone_number_id
     where c.call_session_id = p_call_session_id
       and c.direction = 'outbound'
       and pn.number_e164 = p_from
     limit 1;
    if v_company is null then
      return jsonb_build_object('authorized', false);
    end if;
    return jsonb_build_object(
      'authorized', true, 'company_id', v_company,
      'phone_number_id', v_number, 'replay', true,
      'session_id', p_call_session_id, 'user_id', v_user);
  end if;

  -- #211 ONE-id: the row PK is the nonce-bound S when present (v3), else the
  -- caller-supplied Telnyx id (legacy 3-part). NEVER trust the caller's value
  -- when a bound S exists.
  v_session_id := coalesce(v_auth_session::text, p_call_session_id);

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
         and call_session_id <> v_session_id
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
  values (v_company, v_number, v_session_id, p_customer, 'outbound')
  on conflict (call_session_id) do nothing;

  return jsonb_build_object(
    'authorized', true, 'company_id', v_company,
    'phone_number_id', v_number, 'replay', false,
    'session_id', v_session_id, 'user_id', v_user);
end;
$$;
revoke execute on function public.api_authorize_outbound_call(text, text, text, text, int)
  from public, anon, authenticated;
grant execute on function public.api_authorize_outbound_call(text, text, text, text, int)
  to service_role;
