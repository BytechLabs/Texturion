-- #135 (D43) hardening: adversarial-review fixes for the concurrency, replay,
-- and line-model correctness of the calls engine.
--
--   1. api_claim_ring_answer now returns a THREE-way verdict so a webhook
--      REPLAY of the winner's own call.answered no longer reads as "a sibling
--      won" and hangs up the live bridged call. 'won' = this pass claimed it;
--      'already' = this leg is the (idempotent) winner, re-running is safe;
--      'lost' = a sibling won (or this leg never rang) — dismiss it.
--   2. api_ring_leg_failed takes a per-session advisory lock BEFORE its update
--      instead of update-then-FOR-UPDATE, which deadlocked when the last two
--      member legs timed out simultaneously (each held its own row lock and
--      waited on the other). The advisory lock serialises the whole "am I
--      last?" decision with a single, order-free lock.
--   3. call_member_legs.kind gains 'transfer' — the blind-transfer target leg
--      is now LEDGERED (like ring/consult), so handleTransferAnswered can
--      verify a transfer was actually issued (company-scoped) before it
--      stamps the audit field, closing the forged-brt audit-forgery hole.
--   4. api_claim_inbound_line atomically decides one-call-per-NUMBER: a
--      per-(company,number) advisory lock guards a busy check + the session
--      row insert, so two inbound calls to the same number in the same
--      instant can never both go live.

-- 1. Three-way ring-answer claim ---------------------------------------------
drop function if exists public.api_claim_ring_answer(text, text);
create function public.api_claim_ring_answer(
  p_call_session_id text,
  p_call_control_id text
) returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_state text;
begin
  select state into v_state
    from public.call_member_legs
   where call_session_id = p_call_session_id
     and call_control_id = p_call_control_id
     and kind = 'ring';
  if v_state is null then
    -- This leg was never ledgered as a ring leg for this session.
    return 'lost';
  end if;
  if v_state = 'answered' then
    -- Idempotent replay of the leg that already won — re-running the
    -- answer/bridge/stamp/dismiss is safe and must NOT hang the winner up.
    return 'already';
  end if;

  update public.call_member_legs
     set state = 'answered'
   where call_session_id = p_call_session_id
     and call_control_id = p_call_control_id
     and kind = 'ring'
     and state = 'ringing'
     and not exists (
       select 1 from public.call_member_legs w
        where w.call_session_id = p_call_session_id
          and w.kind = 'ring'
          and w.state = 'answered'
     );
  if found then
    return 'won';
  end if;
  -- A sibling won in the race window.
  return 'lost';
end;
$$;
revoke execute on function public.api_claim_ring_answer(text, text)
  from public, anon, authenticated;
grant execute on function public.api_claim_ring_answer(text, text)
  to service_role;

-- 2. Deadlock-free last-leg decision -----------------------------------------
create or replace function public.api_ring_leg_failed(
  p_call_session_id text,
  p_call_control_id text
) returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  -- Serialise the whole decision per session with ONE advisory lock, before
  -- any row lock — so concurrent simultaneous timeouts can never hold each
  -- other's row locks and deadlock.
  perform pg_advisory_xact_lock(hashtextextended(p_call_session_id, 0));

  update public.call_member_legs
     set state = 'failed'
   where call_session_id = p_call_session_id
     and call_control_id = p_call_control_id
     and kind = 'ring'
     and state = 'ringing';

  return not exists (
    select 1 from public.call_member_legs
     where call_session_id = p_call_session_id
       and kind = 'ring'
       and state in ('ringing', 'answered')
  );
end;
$$;
revoke execute on function public.api_ring_leg_failed(text, text)
  from public, anon, authenticated;
grant execute on function public.api_ring_leg_failed(text, text)
  to service_role;

-- 3. Transfer legs are ledgered ----------------------------------------------
alter table public.call_member_legs
  drop constraint call_member_legs_kind;
alter table public.call_member_legs
  add constraint call_member_legs_kind
    check (kind in ('ring', 'consult', 'transfer'));

-- 4. Atomic one-call-per-number line claim -----------------------------------
-- Inserts the in-flight session row (outcome null) under a per-(company,
-- number) advisory lock, returning whether the LINE was already busy (another
-- outcome-null session on the number inside the window). The caller routes a
-- busy line straight to voicemail; the winner rings the team. Convergent with
-- api_upsert_call's merge on replay (same session id → no-op busy=false).
create function public.api_claim_inbound_line(
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

  select exists (
    select 1 from public.calls
     where phone_number_id = p_phone_number_id
       and outcome is null
       and call_session_id <> p_call_session_id
       and created_at >= p_window_start
  ) into v_busy;

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
