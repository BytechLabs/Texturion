-- #135 (D43) phase 3: live-call handling. The call_member_legs ledger gains
-- a KIND: 'ring' legs are the simultaneous-ring legs whose races decide
-- answer/voicemail; 'consult' legs are the member↔member announce-transfer
-- call (its own two-party bridge — the customer stays parked on their
-- number's single call, per the no-conferencing line model). The two ring
-- RPCs must only ever see 'ring' legs — a consult leg failing must never
-- start voicemail, and a consult answer must never win the customer.

alter table public.call_member_legs
  add column kind text not null default 'ring'
    constraint call_member_legs_kind check (kind in ('ring', 'consult'));

create or replace function public.api_claim_ring_answer(
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
       and kind = 'ring'
       and state = 'ringing'
       and not exists (
         select 1 from public.call_member_legs w
          where w.call_session_id = p_call_session_id
            and w.kind = 'ring'
            and w.state = 'answered'
       )
    returning 1
  )
  select exists (select 1 from claimed)
$$;

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
  update public.call_member_legs
     set state = 'failed'
   where call_session_id = p_call_session_id
     and call_control_id = p_call_control_id
     and kind = 'ring'
     and state = 'ringing';

  perform 1 from public.call_member_legs
    where call_session_id = p_call_session_id
      and kind = 'ring'
    for update;

  return not exists (
    select 1 from public.call_member_legs
     where call_session_id = p_call_session_id
       and kind = 'ring'
       and state in ('ringing', 'answered')
  );
end;
$$;
