-- #722 phase 2: a call keeps its lifecycle in the database. The edges are
-- packages/shared/src/state-machines/call.ts, which matches the reducer
-- (apps/api/src/calls/transitions.ts): a live call may end in any terminal
-- state, and only the two late upgrades leave ended_missed. What this refuses
-- is a call going backwards, such as a stale mirror write bringing an ended
-- call back to ringing. A refused mirror write is reported and retried from the
-- session's own state (session-do.ts doMirror), so a call is never blocked by it.
--
-- Checked on production first (2026-11-11): 165 calls, all in terminal states.

create or replace function public.calls_transition_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A pre-v3 row has no state; whatever it is given is its first.
  if new.state is distinct from old.state and old.state is not null and not (
       (old.state = 'dialing' and new.state in ('answered', 'ended_answered', 'ended_voicemail', 'ended_missed', 'ended_rejected'))
    or (old.state = 'ringing' and new.state in ('answered', 'voicemail_greeting', 'ended_answered', 'ended_voicemail', 'ended_missed', 'ended_rejected'))
    or (old.state = 'answered' and new.state in ('ended_answered', 'ended_voicemail', 'ended_missed', 'ended_rejected'))
    or (old.state = 'voicemail_greeting' and new.state in ('voicemail_recording', 'ended_answered', 'ended_voicemail', 'ended_missed', 'ended_rejected'))
    or (old.state = 'voicemail_recording' and new.state in ('ended_answered', 'ended_voicemail', 'ended_missed', 'ended_rejected'))
    or (old.state = 'ended_missed' and new.state in ('ended_voicemail', 'ended_answered'))
  ) then
    raise exception 'call % cannot go from % to %', old.id, old.state, new.state
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger calls_transition_guard
  before update of state on public.calls
  for each row execute function public.calls_transition_guard();

revoke execute on function public.calls_transition_guard() from public, anon, authenticated;
