-- #209: make api_sweep_stale_calls honest about rows whose DO state mirror is
-- ALREADY terminal. The old sweeper treated every outcome-null row the same:
-- wait 4 hours, then stamp outcome='missed' + state='ended_missed'. That is
-- the right conservative call for a row with NO terminal evidence, but for a
-- row the CallSessionDO already mirrored terminal (state 'ended_%', per
-- 20260717000000_calls_v3_state.sql) it is a LIE twice over: the row rendered
-- as in-progress for 4 hours (tonight's incident: state='ended_answered' +
-- outcome NULL after the terminal merge died on the old transfer path), and
-- the sweep then relabeled an ANSWERED call as missed, overwriting the
-- truthful mirror.
--
-- Fix, two tiers:
--   (a) mirror-terminal rows (state like 'ended_%', outcome null): the mirror
--       IS the truth, so derive outcome FROM it (the same state->outcome map
--       as outcomeForState in apps/api/src/calls/transitions.ts and the
--       20260717000000 backfill), leave state untouched, and sweep on a SHORT
--       threshold (default 5 minutes) - the terminal merge normally lands in
--       seconds, so a few minutes is already proof it died.
--   (b) rows with no terminal mirror (state null, or a live state whose DO
--       vanished) keep today's conservative behavior: 4 hours, then
--       outcome='missed' + state='ended_missed' (the §7.6 dead-DO last
--       resort; the DO's own T16 janitor fires first).
-- The sweeper can therefore never again overwrite a truthful ended_answered
-- with ended_missed.
--
-- Signature gains p_terminal_stale_before (test hook, like p_stale_before).
-- The old single-argument overload is dropped FIRST so PostgREST named-call
-- resolution stays unambiguous (same idiom as 20260710170000). The
-- apps/api/src/messaging/crons.ts caller passes both as null (SQL owns both
-- windows).
drop function if exists public.api_sweep_stale_calls(timestamptz);
create function public.api_sweep_stale_calls(
  p_stale_before          timestamptz default null,
  p_terminal_stale_before timestamptz default null
) returns int
language sql
volatile
security definer
set search_path = ''
as $$
  with finalized as (
    -- (a) The mirror already proved the call over; only the outcome write was
    --     lost. Derive it from the mirror and KEEP the state - never stamp
    --     ended_missed over a truthful terminal.
    update public.calls
       set outcome = case state
             when 'ended_answered'  then 'answered'
             when 'ended_voicemail' then 'voicemail'
             when 'ended_missed'    then 'missed'
             when 'ended_rejected'  then 'missed'
           end
     where outcome is null
       and state like 'ended_%'
       and started_at < coalesce(p_terminal_stale_before,
                                 now() - interval '5 minutes')
    returning 1
  ),
  swept as (
    -- (b) No terminal evidence: the conservative "never proved connected"
    --     flip, unchanged from 20260717000000 (which also stamps outbound
    --     rows with the inbound-vocabulary label - documented cosmetic
    --     consistency, nobody should "fix" it into a new enum).
    update public.calls
       set outcome = 'missed',
           state   = 'ended_missed'
     where outcome is null
       and (state is null or state not like 'ended_%')
       and started_at < coalesce(p_stale_before, now() - interval '4 hours')
    returning 1
  )
  select (select count(*) from finalized)::int
       + (select count(*) from swept)::int
$$;
revoke execute on function public.api_sweep_stale_calls(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_sweep_stale_calls(timestamptz, timestamptz)
  to service_role;
