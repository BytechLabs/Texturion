-- #133 calls liveness: two gaps the audit confirmed.
--
-- 1. Stale-session sweeper. A calls row is pre-created (outbound) or merged
--    (inbound) with outcome NULL and resolves on the deciding hangup — but a
--    lost webhook, a failed transfer with exhausted ledger replays, or a
--    Telnyx dial that never produced terminal events leaves it in-flight
--    forever ("Calling…" in /calls, and it holds the #133 double-dial guard
--    window open). The sweeper flips rows stale past a generous window to
--    'missed' — the conservative read for both directions ("we cannot prove
--    it connected"). Billing is untouched (per-leg call_records rows meter
--    independently). Trade accepted: api_upsert_call's merge lets only
--    'voicemail' overwrite a set outcome, so a >4h-late 'answered' hangup
--    can no longer correct the row — at that age the webhook is lost, not
--    late (ledger replays exhaust in minutes).
--
-- 2. calls broadcast. Every other surface goes live via §8
--    Broadcast-from-Database triggers; the calls table had none, so /calls
--    only refreshed on navigation. Same ID-only payload pattern as
--    broadcast_conversation_change (20260701000400).

create or replace function public.api_sweep_stale_calls(
  p_stale_before timestamptz default null
) returns int
language sql
volatile
security definer
set search_path = ''
as $$
  with swept as (
    update public.calls
       set outcome = 'missed'
     where outcome is null
       and started_at < coalesce(p_stale_before, now() - interval '4 hours')
    returning 1
  )
  select count(*)::int from swept
$$;
revoke execute on function public.api_sweep_stale_calls(timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_sweep_stale_calls(timestamptz)
  to service_role;

create or replace function public.broadcast_call_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(
    jsonb_build_object('call_id', new.id,
                       'conversation_id', new.conversation_id),
    'call.updated', 'company:' || new.company_id::text, true);
  return null;
end $$;

create trigger calls_broadcast after insert or update on public.calls
  for each row execute function public.broadcast_call_change();
