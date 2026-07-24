-- AI reply suggestions — draft answers to a customer's text.
--
-- The same posture as #214 task enrichment: a metered Workers AI cost center
-- that only ever produces a SUGGESTION a person reviews. Three parts:
--
--   1. company_ai_settings gains `suggest_replies` — the per-company opt-out.
--      Default TRUE, matching the founder's #214 default-on decision: the value
--      is immediate and the cap below bounds the spend to pennies.
--
--   2. company_ai_usage becomes a PER-FEATURE ledger. It was a single monthly
--      counter, which meant a second AI feature would have shared enrichment's
--      cap and its alert — one busy feature silently starving the other, and an
--      alert email that could not say which cost center moved. A `feature`
--      column (defaulting existing rows to 'enrich') plus a widened primary key
--      gives every cost center its own bucket, its own cap, and its own
--      one-shot alert.
--
--   3. ai_usage_reserve — the generic replacement for ai_enrich_reserve: the
--      same atomic reserve-and-report, now keyed on (company, period, feature).
--
-- EXPAND/CONTRACT: ai_enrich_reserve is deliberately KEPT WORKING here even
-- though nothing will call it after this deploy. `supabase db push` runs before
-- `wrangler deploy` (deploy.yml), so for the minute between them the PREVIOUS
-- Worker is still live against this schema and still calls it.
--
-- Keeping the function is not enough on its own: its body upserts with
-- `on conflict (company_id, period)`, and widening the primary key removes the
-- unique index that inference needs, so the untouched function would raise
-- "no unique or exclusion constraint matching the ON CONFLICT specification"
-- on every call. (Confirmed by applying this migration to production inside a
-- rolled-back transaction — the old function failed there before it could fail
-- for a customer.) So it is re-pointed at the generic reserve below, and
-- dropped in the follow-up migration once this deploy has landed.

-- ---------------------------------------------------------------------------
-- 1. company_ai_settings.suggest_replies
-- ---------------------------------------------------------------------------
alter table public.company_ai_settings
  add column suggest_replies boolean not null default true;

comment on column public.company_ai_settings.suggest_replies is
  'Opt-out for AI-drafted reply suggestions in the composer. Drafts are never sent automatically.';

-- ---------------------------------------------------------------------------
-- 2. company_ai_usage — one bucket per cost center
-- ---------------------------------------------------------------------------
alter table public.company_ai_usage
  add column feature text not null default 'enrich';

comment on column public.company_ai_usage.feature is
  'Which AI cost center this monthly counter belongs to (enrich, suggest_reply).';

-- Widen the key so the counters cannot collide. Existing rows already carry the
-- backfilled default, so no row is lost or merged by the swap.
alter table public.company_ai_usage
  drop constraint company_ai_usage_pkey;
alter table public.company_ai_usage
  add primary key (company_id, period, feature);

-- ---------------------------------------------------------------------------
-- 3. ai_usage_reserve — atomically claim ONE unit of a feature's monthly cap.
--    Upserts the (company, current-month, feature) row, increments, and reports
--    whether this request is over the cap (caller then SKIPS the AI call — the
--    cap-and-drop) and whether it just crossed the alert threshold (caller
--    sends the one-shot ops alert). One statement, so concurrent requests can
--    neither double-spend the cap nor double-fire the alert.
-- ---------------------------------------------------------------------------
create or replace function public.ai_usage_reserve(
  p_company_id      uuid,
  p_feature         text,
  p_cap             integer,
  p_alert_threshold integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period       text := to_char(now() at time zone 'utc', 'YYYY-MM');
  v_count        integer;
  v_alerted      timestamptz;
  v_should_alert boolean := false;
begin
  insert into public.company_ai_usage (company_id, period, feature, request_count)
    values (p_company_id, v_period, p_feature, 1)
  on conflict (company_id, period, feature) do update
    set request_count = public.company_ai_usage.request_count + 1
  returning request_count, alerted_at into v_count, v_alerted;

  -- Fire once, the first time we cross the threshold and are still at/under the
  -- hard cap (over-cap is its own separate signal to the caller).
  if v_alerted is null and v_count >= p_alert_threshold and v_count <= p_cap then
    update public.company_ai_usage
       set alerted_at = now()
     where company_id = p_company_id
       and period = v_period
       and feature = p_feature;
    v_should_alert := true;
  end if;

  return jsonb_build_object(
    'count', v_count,
    'over_cap', v_count > p_cap,
    'should_alert', v_should_alert);
end $$;

revoke execute on function public.ai_usage_reserve(uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.ai_usage_reserve(uuid, text, integer, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3b. ai_enrich_reserve — the deploy-window shim (see EXPAND/CONTRACT above).
--     Same signature the live Worker calls, now delegating to the generic
--     reserve so it keeps counting into the 'enrich' bucket instead of failing
--     ON CONFLICT inference. DROPPED in the next migration.
-- ---------------------------------------------------------------------------
create or replace function public.ai_enrich_reserve(
  p_company_id      uuid,
  p_cap             integer,
  p_alert_threshold integer
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.ai_usage_reserve(p_company_id, 'enrich', p_cap, p_alert_threshold)
$$;

revoke execute on function public.ai_enrich_reserve(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.ai_enrich_reserve(uuid, integer, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. upsert_company_ai_settings carries the new toggle.
--    The new parameter is DEFAULTED so the three-argument call the currently
--    deployed Worker makes still binds during the deploy window (same
--    expand/contract reasoning as ai_enrich_reserve above). The old signature is
--    dropped first so the two cannot be ambiguous for a 3-argument call.
-- ---------------------------------------------------------------------------
drop function if exists public.upsert_company_ai_settings(uuid, boolean, boolean);

create or replace function public.upsert_company_ai_settings(
  p_company_id          uuid,
  p_enrich_task_address boolean,
  p_enrich_task_due     boolean,
  p_suggest_replies     boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.company_ai_settings%rowtype;
begin
  insert into public.company_ai_settings
      (company_id, enrich_task_address, enrich_task_due, suggest_replies,
       updated_at)
    values (p_company_id, p_enrich_task_address, p_enrich_task_due,
            p_suggest_replies, now())
  on conflict (company_id) do update
    set enrich_task_address = excluded.enrich_task_address,
        enrich_task_due     = excluded.enrich_task_due,
        suggest_replies     = excluded.suggest_replies,
        updated_at          = now()
  returning * into v_row;
  return to_jsonb(v_row);
end $$;

revoke execute on function public.upsert_company_ai_settings(
  uuid, boolean, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.upsert_company_ai_settings(
  uuid, boolean, boolean, boolean) to service_role;
