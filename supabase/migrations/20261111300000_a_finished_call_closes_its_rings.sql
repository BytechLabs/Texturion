-- #722, call machine cleanup (docs/STATE-MACHINES.md, plan item 9).
--
-- Two invariants of the call machine were not kept by the database:
--
-- 1. A ring leg stays `ringing` forever. The session hangs the phones up when
--    the call ends, but nothing moved the leg row, so production held 125 legs
--    "ringing" on calls that had ended. Now the moment a call reaches a
--    terminal state, every leg still ringing on it becomes `failed` (did not
--    connect); an answered leg keeps `answered`.
-- 2. A call can end with no end time: 8 production calls are terminal with a
--    NULL `ended_at`, from terminal merges that never landed. The end time is
--    now stamped when the state turns terminal. The terminal merge still
--    writes Telnyx's own time afterwards (`api_upsert_call` keeps the later of
--    the two), and a CHECK makes the pair unrepresentable.
--
-- The 7 calls with a NULL state are from July 2026, before the call machine;
-- their state is taken from their outcome. The one `ended_voicemail` call with
-- outcome `missed` is correct (the caller hung up in the greeting) and stays.

create or replace function public.calls_stamp_ended_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.state like 'ended\_%' and new.ended_at is null then
    new.ended_at := now();
  end if;
  return new;
end $$;

create trigger calls_stamp_ended_at
  before insert or update of state, ended_at on public.calls
  for each row execute function public.calls_stamp_ended_at();

create or replace function public.calls_close_ringing_legs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.state like 'ended\_%' and old.state is distinct from new.state then
    update public.call_member_legs
       set state = 'failed'
     where call_session_id = new.call_session_id
       and state = 'ringing';
  end if;
  return null;
end $$;

create trigger calls_close_ringing_legs
  after update of state on public.calls
  for each row execute function public.calls_close_ringing_legs();

revoke execute on function public.calls_stamp_ended_at() from public, anon, authenticated;
revoke execute on function public.calls_close_ringing_legs() from public, anon, authenticated;

-- The history, made to match.
update public.call_member_legs l
   set state = 'failed'
  from public.calls c
 where c.call_session_id = l.call_session_id
   and c.state like 'ended\_%'
   and l.state = 'ringing';

update public.calls
   set ended_at = started_at
       + make_interval(secs => coalesce(forward_seconds, 0) + coalesce(voicemail_seconds, 0))
 where state like 'ended\_%' and ended_at is null and started_at is not null;

update public.calls
   set state = case outcome
                 when 'answered' then 'ended_answered'
                 when 'voicemail' then 'ended_voicemail'
                 else 'ended_missed'
               end
 where state is null and outcome is not null;

alter table public.calls add constraint calls_ended_has_ended_at
  check (state is null or state not like 'ended\_%' or ended_at is not null);
