-- #211: outbound calls become first-class CallSessionDO sessions (design v2).
-- The ONE-id invariant (S1 + M3, load-bearing): a single server id S is minted
-- at authorize (POST /v1/calls/browser), STORED here bound to the nonce, echoed
-- by the honest client as client_state tag part-4, and RETURNED to the client.
-- api_authorize_outbound_call DERIVES the calls-row PK from the STORED S (never
-- the caller's tag), so by construction:
--   S == nonce-bound S == tag part-4 == DO idFromName == calls PK == client id.
-- The tag stays AUTHORITATIVE for routing (the loader UUID-validates part-4 and
-- rejects-without-minting when part-4 != the returned S), but trust originates
-- ONLY from the row stored here, closing the caller-controlled-session-id hole
-- (a forged part-4 can bind only the forger's OWN S_nonce -- self-DoS on their
-- own line, sweeper-freed -- never a victim's row).
--
-- Everything is ADDITIVE and behind CALLS_OUTBOUND_V3 (defaulted OFF in code),
-- so this migration is dark until the founder enables the flag:
--   1. outbound_call_authorizations gains call_session_id (=S) + user_id, both
--      nullable so old-shape callers (and the legacy 3-part path) still resolve.
--   2. api_claim_outbound_line is DROP+CREATE'd with two new trailing params
--      (p_call_session_id text, p_user_id uuid), both defaulting null so a
--      named-arg caller omitting them keeps resolving (migrate-before-deploy).
--   3. api_authorize_outbound_call is CREATE OR REPLACE'd (signature unchanged):
--      its DELETE ... RETURNING now also yields the stored S + user_id; the calls
--      row PK is coalesce(stored_S, caller_T) so the row lands under whatever the
--      DO (S) or a fall-to-legacy handler (part-4 = S) keys on; the jsonb returns
--      session_id + user_id in BOTH the fresh and the replay branch.
--   4. calls.state CHECK gains 'dialing' (the one new outbound state).
--
-- Bases: api_claim_outbound_line + api_authorize_outbound_call bodies are copied
-- VERBATIM from their latest definition (20260723001000_outbound_line_claim_state_gate.sql)
-- with ONLY the additive changes above -- the advisory lock, the 30s reservation
-- window, and the #209 state-gated busy scan are byte-identical.

-- 1. Store the nonce-bound server session id + the placing member on the
--    reservation row. Nullable: a 3-part (legacy / CALLS_OUTBOUND_V3-off) claim
--    leaves both NULL and behaves exactly as today.
alter table public.outbound_call_authorizations
  add column if not exists call_session_id uuid null;
alter table public.outbound_call_authorizations
  add column if not exists user_id uuid null;

-- 2. Atomic outbound line claim, now also recording S (=call_session_id) and the
--    placing member (user_id) on the reservation. The two new params are TRAILING
--    with defaults so the pre-#211 worker's 6-named-arg call still resolves to
--    this definition during the migrate-then-deploy window. DROP first (not a
--    plain CREATE OR REPLACE) because the arity changes -- keeping the old 6-arg
--    overload alongside would make PostgREST named-call resolution ambiguous.
drop function if exists public.api_claim_outbound_line(uuid, uuid, text, text, text, timestamptz);
create function public.api_claim_outbound_line(
  p_company_id      uuid,
  p_phone_number_id uuid,
  p_nonce           text,
  p_from            text,
  p_customer        text,
  p_window_start    timestamptz,
  p_call_session_id text default null,
  p_user_id         uuid default null
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

  -- #211: store S (call_session_id) + the placing member alongside the
  -- reservation. call_session_id is a uuid column; p_call_session_id arrives as
  -- text (the route mints crypto.randomUUID()) so cast it, tolerating null.
  insert into public.outbound_call_authorizations
    (nonce, company_id, phone_number_id, from_e164, customer_e164,
     call_session_id, user_id)
  values (p_nonce, p_company_id, p_phone_number_id, p_from, p_customer,
     p_call_session_id::uuid, p_user_id);
  return true;
end;
$$;
revoke execute on function public.api_claim_outbound_line(uuid, uuid, text, text, text, timestamptz, text, uuid)
  from public, anon, authenticated;
grant execute on function public.api_claim_outbound_line(uuid, uuid, text, text, text, timestamptz, text, uuid)
  to service_role;

-- 3. The call.initiated re-check + row mint. Signature UNCHANGED (5 params), so
--    CREATE OR REPLACE suffices and the legacy 3-part caller is untouched. The
--    #211 changes:
--      (a) the nonce DELETE ... RETURNING also yields the stored S + user_id;
--      (b) the calls row PK v_session_id := coalesce(stored_S, p_call_session_id)
--          -- for a v3 auth that is the nonce-bound S (NEVER the caller's tag);
--          for a legacy 3-part auth (no stored S) it stays the caller-supplied
--          Telnyx id, exactly as today;
--      (c) the busy re-check + the INSERT + the replay lookup all key on
--          v_session_id, so the row is created and found under the ONE id every
--          downstream reader (DO idFromName, mirror, terminal merge) keys on;
--      (d) the jsonb returns session_id + user_id in the fresh AND replay branch.
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
    -- The row is under whatever it was created as; the DO / legacy handler
    -- keys the replay on part-4 (= S), so look it up by p_call_session_id.
    select company_id, phone_number_id, answered_by_user_id
      into v_company, v_number, v_user
      from public.calls where call_session_id = p_call_session_id limit 1;
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

-- 4. The one new outbound state: 'dialing' (the customer leg initiated, not yet
--    answered). Additive to the calls.state CHECK from 20260717000000. Drop the
--    inline-named constraint and re-add it NOT VALID + VALIDATE so the hot table
--    is never long-locked (every existing row already satisfies the superset).
--    NULL stays legal and means legacy (pre-v3 inbound OR pre-parity outbound).
alter table public.calls drop constraint if exists calls_state_check;
alter table public.calls
  add constraint calls_state_check
  check (state is null or state in (
    'dialing',
    'ringing', 'answered', 'voicemail_greeting', 'voicemail_recording',
    'ended_answered', 'ended_voicemail', 'ended_missed', 'ended_rejected'
  )) not valid;
alter table public.calls validate constraint calls_state_check;

-- 5. No index change: calls_live_state_idx (20260717000000) predicates on
--    `state is not null and state not like 'ended%'`, which already covers the
--    non-terminal 'dialing' rows -- they are live and belong in the busy-line
--    accelerator.
-- 6. No sweeper change: api_sweep_stale_calls (20260723001100) tier (b) already
--    matches `state not like 'ended_%'`, so a wedged 'dialing' row is swept by
--    the same 4h NULL-state last-resort flip to ended_missed (the DO's own T16
--    janitor fires first). 'dialing' needs no new branch anywhere.
