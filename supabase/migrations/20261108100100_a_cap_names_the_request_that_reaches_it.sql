-- D146: a cap reports the one request that reaches it, and nothing before.
--
-- ai_usage_reserve and claim_high_priority_push kept notice rungs below their
-- caps (the AI alert threshold and the 80% push warning) and stamped a column
-- each time one fired, only so the notice went out once. The caps keep
-- refusing or degrading exactly as before. What changes is the notice: the
-- request that takes the count from under the cap to it is named from the
-- counter, in the statement that moves it, so it is sent once with nothing
-- stored to say so.
--
-- EXPAND FIRST. The release applies this before the new Worker deploys, and
-- the deployed Worker still passes p_alert_threshold to ai_usage_reserve. The
-- parameter keeps a default and is ignored, so both Workers are answered. The
-- old Worker reads `should_alert` and `alert`, which are gone, so it sends no
-- notice until it is replaced.
--
-- destructive-ok: company_ai_usage.alerted_at and the budget's warned_at and
-- capped_at only remembered that a notice went out. No product path and no
-- report reads them, and the functions below were their only writers.

create or replace function public.ai_usage_reserve(
  p_company_id      uuid,
  p_feature         text,
  p_cap             integer,
  -- Ignored. The Worker deployed before this migration still passes it.
  p_alert_threshold integer default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period text := to_char(now() at time zone 'utc', 'YYYY-MM');
  v_count  integer;
begin
  insert into public.company_ai_usage (company_id, period, feature, request_count)
    values (p_company_id, v_period, p_feature, 1)
  on conflict (company_id, period, feature) do update
    set request_count = public.company_ai_usage.request_count + 1
  returning request_count into v_count;

  -- Each request adds one, so the count before this one is v_count - 1. It is
  -- under the cap and the count after is at it for exactly one request.
  return jsonb_build_object(
    'count', v_count,
    'over_cap', v_count > p_cap,
    'reached_cap', v_count = p_cap);
end $$;

revoke execute on function public.ai_usage_reserve(uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.ai_usage_reserve(uuid, text, integer, integer)
  to service_role;

alter table public.company_ai_usage drop column alerted_at;

create or replace function public.claim_high_priority_push(
  p_company_id    uuid,
  p_reason        text,
  p_sends         int,
  p_default_limit int default 2000
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_limit    int;
  v_day      date;
  v_capped   boolean;
  v_total    int;
  v_allowed  boolean := true;
  v_reached  boolean := false;
begin
  if p_company_id is null then
    raise exception 'claim_high_priority_push: company is required';
  end if;
  if p_reason is null then
    raise exception 'claim_high_priority_push: reason is required';
  end if;
  -- A claim for nothing is a no-op, not an error: a fan-out can legitimately
  -- find zero registered devices.
  if coalesce(p_sends, 0) <= 0 then
    return jsonb_build_object('allowed', true, 'sends', 0, 'reached_cap', false);
  end if;

  select c.timezone, c.high_priority_push_limit
    into v_timezone, v_limit
    from public.companies c
   where c.id = p_company_id;
  if not found then
    raise exception 'claim_high_priority_push: company % not found', p_company_id;
  end if;
  v_limit := greatest(coalesce(v_limit, p_default_limit), 0);

  -- An unknown zone falls back to UTC rather than raising: this runs on the
  -- inbound webhook and the live-call paths, and a bad timezone must not wedge
  -- either. The column's shape check (#343) makes this a genuine backstop.
  begin
    v_day := (now() at time zone coalesce(v_timezone, 'utc'))::date;
  exception when invalid_parameter_value or undefined_object then
    v_day := (now() at time zone 'utc')::date;
  end;

  -- Which reasons share the ceiling lives HERE and only here. The API passes a
  -- reason and does not get a vote, so the two cannot drift.
  v_capped := p_reason in ('lead', 'lead_chase');

  if v_capped then
    -- One statement takes the row's lock, adds this claim and reads the new
    -- total, so the total before it (v_total - p_sends) is this claim's own.
    insert into public.high_priority_push_budget as b
      (company_id, day, requested, day_limit)
    values (p_company_id, v_day, p_sends, v_limit)
    on conflict (company_id, day) do update
      -- day_limit is re-stamped every claim: a limit changed mid-day takes
      -- effect at once, which is the whole point of making it configurable.
      set requested = b.requested + excluded.requested,
          day_limit = excluded.day_limit
    returning b.requested into v_total;

    -- Soft boundary: allowed while the total before this claim is under the
    -- ceiling, so the crossing claim goes out whole, and it is the one that
    -- reached the ceiling.
    v_allowed := v_total - p_sends < v_limit;
    v_reached := v_allowed and v_limit <= v_total;
  end if;

  -- Attribution, for every reason. Written after the verdict so `sends` counts
  -- what actually went out at HIGH and `degraded` counts what did not.
  insert into public.high_priority_push_days as d
    (company_id, day, reason, sends, degraded)
  values (
    p_company_id, v_day, p_reason,
    case when v_allowed then p_sends else 0 end,
    case when v_allowed then 0 else p_sends end)
  on conflict (company_id, day, reason) do update
    set sends    = d.sends    + excluded.sends,
        degraded = d.degraded + excluded.degraded;

  return jsonb_build_object(
    'allowed', v_allowed,
    'sends', coalesce(v_total, p_sends),
    'limit', case when v_capped then v_limit end,
    'reached_cap', v_reached);
end $$;

revoke execute on function public.claim_high_priority_push(uuid, text, int, int)
  from public, anon, authenticated;
grant execute on function public.claim_high_priority_push(uuid, text, int, int)
  to service_role;

alter table public.high_priority_push_budget
  drop column warned_at,
  drop column capped_at;
