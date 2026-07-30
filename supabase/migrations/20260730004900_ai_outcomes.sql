-- #431 — we meter every AI unit we spend and record nothing about whether the
-- output was used.
--
-- `ai/run.ts` is a good spend gate: every feature declares a cap, an alert
-- threshold, a timeout and an opt-in, and `ai_usage_reserve` records the
-- reservation per company per feature per month. So "what did Lou cost this
-- tenant?" has a precise answer, and "was it worth it?" has none.
--
-- For the one feature in this product whose output is explicitly OPTIONAL — a
-- drafted reply a person accepts or discards — that is the single missing number.
--
-- ON THE SAME ROW AS THE SPEND, deliberately. Ask 3 wants acceptance surfaced
-- beside cost, and the cheapest way to guarantee that is to make them physically
-- inseparable: one row per (company, period, feature) already exists for the
-- counter, so the outcomes are three more columns on it. A separate table would
-- need a join that somebody could forget, and the whole failure mode here is a
-- number nobody looks at.
--
-- THREE COUNTERS, NOT ONE RATE, and #431's own devil's advocate is why. Acceptance
-- is a noisy proxy: a crew member may discard a perfectly good draft because they
-- wanted to say something more personal, which is the product working as intended,
-- and an edit could mean the draft was 80% right and saved time or 20% right and
-- cost time. Collapsing those into a single "acceptance rate" would hide exactly
-- the ambiguity that makes the number worth reading. So the three outcomes are
-- stored separately and the ratio is computed at the point of asking, never
-- pre-baked.
--
-- WHY THIS IS SERVER-SIDE AND NOT A CLIENT ANALYTICS EVENT. #431 suggests routing
-- it through `lib/analytics/events.ts`, whose enum-only contract genuinely fits.
-- But that path is PostHog, and in this product client telemetry is unreliable:
-- ad blockers eat it, and the Sentry tunnel that would have fixed the same problem
-- was declined. A decision as consequential as "is Lou worth keeping" cannot rest
-- on a channel that a browser extension can silence, and it must not be biased by
-- WHICH customers block trackers. The outcome arrives through the authed API
-- instead, which is the same path the message itself takes.
--
-- NO MESSAGE CONTENT, EVER. The recorded value is one of three enum strings. The
-- server never learns what the draft said, what the human typed, or how much they
-- changed — only which of the three things happened. That is the whole measurement
-- and it is the most that should be collected for it.

alter table public.company_ai_usage
  add column if not exists outcome_used_count integer not null default 0,
  add column if not exists outcome_edited_count integer not null default 0,
  add column if not exists outcome_discarded_count integer not null default 0;

comment on column public.company_ai_usage.outcome_used_count is
  'Times this feature''s output was used unchanged (#431): a drafted reply sent as-is, an enrichment accepted, a voicemail read without playing the audio. Counted separately from edited/discarded because collapsing them into one rate would hide the ambiguity that makes the number worth reading.';
comment on column public.company_ai_usage.outcome_edited_count is
  'Times the output was changed and then used (#431). Deliberately ambiguous evidence: it can mean the draft was 80% right and saved time, or 20% right and cost time. Kept as its own number rather than folded either way.';
comment on column public.company_ai_usage.outcome_discarded_count is
  'Times the output was not used (#431). Not necessarily a quality failure: a crew member may discard a good draft to say something more personal, which is the product working as intended.';

/**
 * Record what a human did with one piece of AI output.
 *
 * Upserts the same (company, period, feature) row `ai_usage_reserve` maintains, so
 * a company whose outcome arrives in a later month than its reservation still gets
 * a row rather than losing the signal. That is deliberate over a strict update:
 * losing an outcome to a month boundary would bias the rate toward whatever
 * happened mid-month.
 *
 * Unknown outcomes are rejected rather than silently ignored, so a client typo
 * shows up as an error instead of as a quietly missing number — the failure mode
 * this whole issue is about.
 */
create or replace function public.ai_outcome_record(
  p_company_id uuid,
  p_feature    text,
  p_outcome    text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period text := to_char(now() at time zone 'utc', 'YYYY-MM');
begin
  if p_outcome not in ('used', 'edited', 'discarded') then
    return jsonb_build_object('error', 'validation_failed');
  end if;

  insert into public.company_ai_usage (
    company_id, period, feature, request_count,
    outcome_used_count, outcome_edited_count, outcome_discarded_count
  ) values (
    p_company_id, v_period, p_feature, 0,
    case when p_outcome = 'used' then 1 else 0 end,
    case when p_outcome = 'edited' then 1 else 0 end,
    case when p_outcome = 'discarded' then 1 else 0 end
  )
  on conflict (company_id, period, feature) do update set
    outcome_used_count = public.company_ai_usage.outcome_used_count
      + case when p_outcome = 'used' then 1 else 0 end,
    outcome_edited_count = public.company_ai_usage.outcome_edited_count
      + case when p_outcome = 'edited' then 1 else 0 end,
    outcome_discarded_count = public.company_ai_usage.outcome_discarded_count
      + case when p_outcome = 'discarded' then 1 else 0 end;

  return jsonb_build_object('recorded', p_outcome);
end $$;

revoke execute on function public.ai_outcome_record(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.ai_outcome_record(uuid, text, text)
  to service_role;

/**
 * Spend and value for one month, per feature, in one read (#431 ask 3).
 *
 * `requests` is what it cost. `used`/`edited`/`discarded` are what happened to it.
 * `outcomes_recorded` is reported separately from `requests` on purpose: they will
 * not match, because a suggestion generated and never looked at produces a request
 * with no outcome, and reading a rate over the wrong denominator is how a number
 * like this becomes misleading. The caller decides which denominator its question
 * wants.
 *
 * No rate is computed here. Ask 5 requires a threshold be chosen BEFORE the data
 * arrives, and a function that returns one blessed ratio would quietly become that
 * threshold's definition.
 */
create or replace function public.api_ai_value_report(
  p_company_id uuid,
  p_period     text default null
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'feature', u.feature,
    'period', u.period,
    'requests', u.request_count,
    'used', u.outcome_used_count,
    'edited', u.outcome_edited_count,
    'discarded', u.outcome_discarded_count,
    'outcomes_recorded', u.outcome_used_count + u.outcome_edited_count
      + u.outcome_discarded_count
  ) order by u.feature), '[]'::jsonb)
  from public.company_ai_usage u
  where u.company_id = p_company_id
    and u.period = coalesce(p_period, to_char(now() at time zone 'utc', 'YYYY-MM'))
$$;

revoke execute on function public.api_ai_value_report(uuid, text)
  from public, anon, authenticated;
grant execute on function public.api_ai_value_report(uuid, text)
  to service_role;

comment on function public.api_ai_value_report is
  'Per-feature AI spend and outcomes for one month (#431). Returns raw counts and never a rate: the denominator depends on the question, and ask 5 requires the keep/kill threshold be chosen before the data arrives rather than defined by whatever this function happened to divide by.';
