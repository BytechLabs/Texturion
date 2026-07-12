-- #135 (D43) phase 2: the browser is the phone — inbound. One migration
-- carries the whole inbound surface (docs/CALLS-V2.md):
--
--   * companies gains the Calls settings: voicemail greeting (owner-authored
--     text, spoken by TTS), the screening mode ('off' | 'flag' | 'divert' —
--     founder toggle; 'flag' labels, 'divert' sends flagged calls straight
--     to voicemail), the outbound CNAM display name (<=15 alphanumeric+space,
--     carrier rule), and the inbound caller-name dip toggle.
--   * calls gains what a v2 call knows: the carrier screening verdict + STIR/
--     SHAKEN attestation (honest labels in UI), the dipped caller display
--     name, the voicemail recording (our storage path + duration — Telnyx's
--     copy is deleted after fetch), which member answered (journey lines +
--     presence), and the customer leg's call_control_id (phase 3 hold/
--     transfer commands act on it).
--   * call_member_legs — the simultaneous-ring ledger: one row per member
--     browser leg dialed for an inbound call. Webhook events land
--     CONCURRENTLY, so answer/failure races are decided here with guarded
--     updates: exactly one leg may win, and voicemail fires exactly once
--     when the last leg fails.

alter table public.companies
  add column voicemail_greeting text,
  add column call_screening text not null default 'flag'
    constraint companies_call_screening check (call_screening in ('off', 'flag', 'divert')),
  add column cnam_display_name text
    constraint companies_cnam_display_name
    check (cnam_display_name is null
           or cnam_display_name ~ '^[A-Za-z0-9 ]{1,15}$'),
  add column caller_id_lookup boolean not null default true;

alter table public.calls
  add column screening_result text,
  add column stir_attestation text,
  add column caller_name text,
  add column voicemail_path text,
  add column voicemail_seconds int,
  add column answered_by_user_id uuid references auth.users(id) on delete set null,
  add column customer_call_control_id text;

create table public.call_member_legs (
  call_session_id text not null,
  call_control_id text not null,
  company_id      uuid not null references public.companies(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  state           text not null default 'ringing'
    constraint call_member_legs_state check (state in ('ringing', 'answered', 'failed')),
  created_at      timestamptz not null default now(),
  primary key (call_session_id, call_control_id)
);
create index call_member_legs_session on public.call_member_legs (call_session_id);

alter table public.call_member_legs enable row level security;
-- deny-by-default: only the service role (webhook) touches ring state.

-- Atomic first-answer-wins: mark THIS leg answered only if no sibling won
-- already. Returns true for the winner (the webhook then hangs up siblings),
-- false for a late answer (the webhook hangs up THIS leg).
create function public.api_claim_ring_answer(
  p_call_session_id text,
  p_call_control_id text
) returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  with claimed as (
    update public.call_member_legs
       set state = 'answered'
     where call_session_id = p_call_session_id
       and call_control_id = p_call_control_id
       and state = 'ringing'
       and not exists (
         select 1 from public.call_member_legs w
          where w.call_session_id = p_call_session_id
            and w.state = 'answered'
       )
    returning 1
  )
  select exists (select 1 from claimed)
$$;
revoke execute on function public.api_claim_ring_answer(text, text)
  from public, anon, authenticated;
grant execute on function public.api_claim_ring_answer(text, text)
  to service_role;

-- Atomic last-leg-fails: mark THIS leg failed; return true only when it was
-- the LAST live leg and nobody answered — the caller then starts voicemail
-- exactly once (concurrent sibling failures race safely: one gets true).
create function public.api_ring_leg_failed(
  p_call_session_id text,
  p_call_control_id text
) returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.call_member_legs
     set state = 'failed'
   where call_session_id = p_call_session_id
     and call_control_id = p_call_control_id
     and state = 'ringing';

  -- Serialize the "am I last?" decision: lock the session's rows so two
  -- concurrent failures cannot both read "none ringing" before either
  -- commits (the winner is whoever locks first and still sees none left).
  perform 1 from public.call_member_legs
    where call_session_id = p_call_session_id
    for update;

  return not exists (
    select 1 from public.call_member_legs
     where call_session_id = p_call_session_id
       and state in ('ringing', 'answered')
  );
end;
$$;
revoke execute on function public.api_ring_leg_failed(text, text)
  from public, anon, authenticated;
grant execute on function public.api_ring_leg_failed(text, text)
  to service_role;
