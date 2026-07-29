-- #397 ask 2 — notice when ONE customer's calls stop arriving.
--
-- The competitive risk this issue describes ends with a contractor pointing
-- their number at an AI receptionist. Texting keeps working, so nothing breaks
-- loudly; the calls simply stop, and we find out at renewal. Porting out is a
-- one-way door, and by the time it shows in churn it is already irreversible.
--
-- ---------------------------------------------------------------------------
-- WHY THE EXISTING SIGNAL DOES NOT COVER THIS.
--
-- `channel:telnyx-call-events` in the liveness ledger already notices call
-- events stopping — but FLEET-WIDE. It catches a Telnyx outage. At our size a
-- single workspace going silent does not move it at all, and one workspace is
-- exactly the case here: not our infrastructure failing, one customer quietly
-- replacing us.
--
-- ---------------------------------------------------------------------------
-- SAME SHAPE AS #235, FOR THE SAME REASON.
--
-- Each workspace is judged against ITS OWN trailing history, never a fleet
-- average. A three-person crew taking six calls a week and a busy shop taking
-- sixty have nothing to say about each other, and a shared threshold would
-- alarm on one forever while never firing for the other.
--
-- And the minimum sample matters more here than anywhere: call volume is the
-- lowest-volume signal in the product. A quiet fortnight is an ordinary
-- fortnight for a small crew, so the baseline has to be established before
-- silence means anything at all.

create table if not exists public.call_silence_state (
  company_id     uuid primary key references public.companies(id) on delete cascade,
  -- 'ok' | 'silent'. Two states only: this is a yes/no question about whether
  -- somebody still points their number at us.
  state          text not null default 'ok' check (state in ('ok', 'silent')),
  recent_calls   int not null default 0,
  baseline_calls int not null default 0,
  assessed_at    timestamptz not null default now(),
  silent_since   timestamptz
);

comment on table public.call_silence_state is
  '#397: per-workspace inbound-call silence. The early signal that a customer '
  'pointed their number somewhere else, which nothing fleet-wide would catch.';

/**
 * Assess every active workspace, and return only the ones that CHANGED.
 *
 * Transitions only, like #235: a workspace that has been silent for a fortnight
 * is not news on day fourteen, and re-announcing it daily is how the mailbox
 * stops being read.
 */
create or replace function public.api_assess_call_silence()
returns table (
  company_id     uuid,
  company_name   text,
  was            text,
  state          text,
  recent_calls   int,
  baseline_calls int
)
language plpgsql
security definer
set search_path = ''
as $$
-- The RETURNS TABLE columns shadow the real ones inside the body; prefer the
-- column, as api_assess_number_health does for the same reason.
#variable_conflict use_column
declare
  -- Two weeks recent against the eight before it. Wider than #235's windows
  -- because calls are rarer than texts: a seven-day window on six-calls-a-week
  -- would be noise.
  v_window   int := 14;
  v_baseline int := 56;
  -- Below this many calls in the baseline period we have no opinion. A
  -- workspace that never took calls cannot stop taking them, and alerting on
  -- one would be alerting on a customer who simply does not use the feature.
  v_min      int := 8;
begin
  return query
  with stats as (
    select
      c.id as company_id,
      c.name as company_name,
      count(*) filter (
        where k.direction = 'inbound'
          and k.created_at > now() - make_interval(days => v_window)
      )::int as recent_calls,
      -- Scaled to the recent window's length so the comparison is like for
      -- like rather than a longer period always looking busier.
      (count(*) filter (
        where k.direction = 'inbound'
          and k.created_at <= now() - make_interval(days => v_window)
          and k.created_at > now() - make_interval(days => v_baseline)
      ) * v_window / (v_baseline - v_window))::int as baseline_calls
    from public.companies c
    left join public.calls k on k.company_id = c.id
    where c.deleted_at is null
      and c.subscription_status in ('active', 'past_due')
    group by c.id, c.name
  ),
  judged as (
    select
      s.*,
      case
        -- Established rhythm, now nothing at all. The signal this exists for.
        when s.baseline_calls >= v_min and s.recent_calls = 0 then 'silent'
        else 'ok'
      end as new_state
    from stats s
  ),
  upserted as (
    insert into public.call_silence_state as t
      (company_id, state, recent_calls, baseline_calls, assessed_at, silent_since)
    select
      j.company_id, j.new_state, j.recent_calls, j.baseline_calls, now(),
      case when j.new_state = 'silent' then now() end
    from judged j
    on conflict (company_id) do update
       set state          = excluded.state,
           recent_calls   = excluded.recent_calls,
           baseline_calls = excluded.baseline_calls,
           assessed_at    = now(),
           -- Held across assessments so a workspace silent for a fortnight
           -- does not read as newly silent every morning.
           silent_since   = case
                              when excluded.state = 'ok' then null
                              when t.state = 'ok' then now()
                              else t.silent_since
                            end
    returning t.company_id, t.state, t.recent_calls, t.baseline_calls
  )
  select
    u.company_id, j.company_name,
    coalesce(prev.state, 'ok') as was,
    u.state, u.recent_calls, u.baseline_calls
  from upserted u
  join judged j on j.company_id = u.company_id
  left join (select company_id, state from public.call_silence_state) prev
    on prev.company_id = u.company_id
  where u.state is distinct from coalesce(prev.state, 'ok');
end;
$$;

revoke all on function public.api_assess_call_silence() from public, anon, authenticated;
grant execute on function public.api_assess_call_silence() to service_role;

alter table public.call_silence_state enable row level security;
revoke all on table public.call_silence_state from public, anon, authenticated;
grant select, insert, update, delete on table public.call_silence_state to service_role;
