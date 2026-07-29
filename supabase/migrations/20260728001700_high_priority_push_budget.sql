-- ===========================================================================
-- [#452] HIGH-priority push is a rationed resource. Give it a counter, a
-- ceiling and an alert — the three things every other cost centre here has.
--
-- FCM HIGH and APNs priority 10 wake a sleeping phone. Google rate-limits apps
-- that overuse them, and the penalty lands on the app rather than on the
-- offending message: the throttling degrades exactly the notifications you
-- most needed delivered. Apple carries the same expectation. It is a budget
-- denominated in platform goodwill instead of dollars, which is precisely why
-- it was never written down as a cost centre.
--
-- FIVE features request it today, not the two #452 counted: the emergency
-- keyword (#414), a first inbound on a new or reopened thread (#391/D52), an
-- incoming call's ring, the call-ended alert, and — shipped since the issue
-- was written — every rung of the #388 lead-chase ladder. Nothing counted any
-- of them.
--
-- WHAT IS METERED: one NATIVE DEVICE SEND at high priority. Web Push urgency
-- is not rationed by anyone, so it is deliberately out of scope — metering it
-- would inflate the number with sends no platform is counting. The unit is the
-- device rather than the notification because the device is what Google counts.
--
-- WHAT IS CAPPED is a bucket, not a reason, and the split is a shape argument
-- rather than a volume one:
--
--   CAPPED — `lead` and `lead_chase`. Both are driven by inbound text volume,
--   which is the one input an outsider controls. They share ONE ceiling
--   because they share that input: a flood drives both, and two independent
--   ceilings would let it spend twice the intended budget.
--
--   COUNTED, NEVER CAPPED — `ring`, `call_end`, `emergency`. The first two
--   require a phone call to have actually happened. The third requires one of
--   the four fixed words in EMERGENCY_KEYWORDS (a constant, not the
--   owner-configurable column #452 assumed — so the "an owner sets it to
--   'help'" risk does not exist). None can be manufactured from outside at
--   volume, and a ring delivered at NORMAL priority is not a ring.
--
-- PAST THE CEILING, HIGH DEGRADES TO NORMAL — it is never dropped. This is the
-- one cost centre where the #12 cap-and-drop posture is wrong: dropping the
-- alert loses the lead outright, while sending it NORMAL loses only the Doze
-- wake. Degrading spends nothing further and still delivers the message.
--
-- THE DAY IS THE BUSINESS'S DAY (D15, and the #343 precedent), not UTC's, so
-- the ceiling resets when the crew's day does rather than mid-afternoon.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Ops-only ceiling override. Deliberately NOT on PATCH /v1/company: a ceiling
-- the customer can raise is not a ceiling (#12). NULL = use the default the
-- caller passes.
--
-- No per-plan variation, unlike the #343 ceilings: this bounds our standing
-- with Google, which does not get better because a customer pays more.
-- ---------------------------------------------------------------------------
alter table public.companies
  add column if not exists high_priority_push_limit int
    check (high_priority_push_limit is null
           or high_priority_push_limit between 0 and 1000000);

comment on column public.companies.high_priority_push_limit is
  '#452: ops-only override of the daily ceiling on lead-driven HIGH-priority native pushes (lead + lead_chase share it). NULL = use the shipped default. Past the ceiling those pushes degrade to NORMAL; they are never dropped.';

-- ---------------------------------------------------------------------------
-- ATTRIBUTION. One row per (company, local day, reason), covering every reason
-- whether capped or not, so the ops question — "how many HIGH-priority pushes
-- did we send last week, and to whom?" — is one SELECT, and a spike can be
-- pinned on the feature that caused it rather than on push in general.
--
-- `sends` and `degraded` are separate columns because they answer different
-- questions: `sends` is what we spent, `degraded` is the demand we refused. A
-- row with a large `degraded` is the signal that the ceiling is either too low
-- or being attacked, and collapsing the two would hide it.
-- ---------------------------------------------------------------------------
create table if not exists public.high_priority_push_days (
  company_id uuid not null references public.companies(id) on delete cascade,
  day        date not null,
  reason     text not null,
  sends      int  not null default 0 check (sends >= 0),
  degraded   int  not null default 0 check (degraded >= 0),
  primary key (company_id, day, reason),
  constraint high_priority_push_days_reason_check
    check (reason in ('lead', 'lead_chase', 'emergency', 'ring', 'call_end'))
);

comment on table public.high_priority_push_days is
  '#452: daily per-company attribution of HIGH-priority native pushes (FCM HIGH / APNs 10), split by the feature that asked. `sends` is spend, `degraded` is demand refused by the ceiling.';

-- The ops read is "the last N days, all companies". Lead with `day` so that
-- range scan does not read the whole table.
create index if not exists high_priority_push_days_day_idx
  on public.high_priority_push_days (day desc, company_id);

-- Service-role only, like inbound_notification_days/webhook_events. The
-- rls.sql default-privilege revoke already strips anon/authenticated from
-- future tables; enabling RLS with no end-user policy makes the denial
-- explicit (service_role bypasses RLS).
alter table public.high_priority_push_days enable row level security;

-- ---------------------------------------------------------------------------
-- THE BUDGET. One row per (company, local day) holding the SHARED ceiling for
-- the capped bucket, its running total, and the one-shot ladder stamps.
--
-- Separate from the attribution table on purpose: the ceiling spans two
-- reasons, so hanging it off either reason's row would make one of them lie.
-- This row is also the lock that serializes concurrent claims — the count, the
-- degrade decision and the stamps can never race, which is the shape the #343
-- notification budget uses for the same reason.
-- ---------------------------------------------------------------------------
create table if not exists public.high_priority_push_budget (
  company_id uuid not null references public.companies(id) on delete cascade,
  day        date not null,
  -- Capped-bucket demand: spent + refused. The ladder measures this, so a
  -- workspace past the ceiling keeps being measured rather than freezing.
  requested  int  not null default 0 check (requested >= 0),
  -- The ceiling in force when the row was last written, so a row read weeks
  -- later says what the limit WAS rather than what it is now.
  day_limit  int  not null,
  warned_at  timestamptz,
  capped_at  timestamptz,
  primary key (company_id, day)
);

comment on table public.high_priority_push_budget is
  '#452: the shared daily ceiling for lead-driven HIGH-priority pushes (lead + lead_chase). `requested` is total demand including what was degraded to NORMAL.';

-- Service-role only, same posture as the attribution table above.
alter table public.high_priority_push_budget enable row level security;

-- ---------------------------------------------------------------------------
-- The claim. Called BEFORE the native fan-out, with the number of devices the
-- send is about to touch; returns whether those sends may go at HIGH.
--
-- THE CEILING IS SOFT AT THE BOUNDARY: the claim that crosses it is allowed in
-- full, and everything after degrades. Splitting one fan-out mid-crew would
-- wake some of a crew and not the rest for a single lead, which is a worse
-- outcome than one claim's overshoot.
-- ---------------------------------------------------------------------------
create or replace function public.claim_high_priority_push(
  p_company_id    uuid,
  p_reason        text,
  p_sends         int,
  -- Defaulted so an older Worker mid-deploy behaves exactly as the new one.
  p_default_limit int default 2000
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timezone  text;
  v_limit     int;
  v_day       date;
  v_capped    boolean;
  v_before    int;
  v_total     int;
  v_warned    timestamptz;
  v_capped_at timestamptz;
  v_allowed   boolean := true;
  v_alert     int;
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
    return jsonb_build_object('allowed', true, 'sends', 0, 'alert', null);
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
    -- Take the budget row (and its lock) FIRST, so the running total read
    -- below is serialized against every concurrent claimant.
    insert into public.high_priority_push_budget as b
      (company_id, day, requested, day_limit)
    values (p_company_id, v_day, 0, v_limit)
    on conflict (company_id, day) do update
      -- Re-stamped every claim: a limit changed mid-day takes effect at once,
      -- which is the whole point of making it runtime-configurable.
      set day_limit = excluded.day_limit
    returning b.requested, b.warned_at, b.capped_at
      into v_before, v_warned, v_capped_at;

    -- Soft boundary: allowed while the running total is still under the
    -- ceiling, so the crossing claim goes out whole.
    v_allowed := v_before < v_limit;

    update public.high_priority_push_budget
       set requested = requested + p_sends
     where company_id = p_company_id and day = v_day
    returning requested into v_total;

    -- Warn before the ceiling, state it once at the ceiling (#12 posture).
    if v_total >= v_limit and v_capped_at is null then
      update public.high_priority_push_budget set capped_at = now()
       where company_id = p_company_id and day = v_day;
      v_alert := 100;
    elsif v_total >= (v_limit * 8 / 10) and v_warned is null then
      update public.high_priority_push_budget set warned_at = now()
       where company_id = p_company_id and day = v_day;
      v_alert := 80;
    end if;
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
    'alert', v_alert);
end $$;

revoke execute on function public.claim_high_priority_push(uuid, text, int, int)
  from public, anon, authenticated;
grant execute on function public.claim_high_priority_push(uuid, text, int, int)
  to service_role;

-- ---------------------------------------------------------------------------
-- The ops report. #452's definition of done is that somebody can answer "how
-- many HIGH-priority pushes did we send last week, and to whom?" — this is
-- that answer, as one call, so it does not depend on anyone remembering the
-- shape of two tables.
-- ---------------------------------------------------------------------------
create or replace function public.api_high_priority_push_report(p_days int default 7)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.sends desc), '[]'::jsonb)
    from (
      select c.id   as company_id,
             c.name as company_name,
             d.reason,
             sum(d.sends)::int    as sends,
             sum(d.degraded)::int as degraded,
             max(d.day)           as last_day
        from public.high_priority_push_days d
        join public.companies c on c.id = d.company_id
       where d.day >= (now() at time zone 'utc')::date
                      - greatest(coalesce(p_days, 7), 1)
       group by c.id, c.name, d.reason
    ) t
$$;

revoke execute on function public.api_high_priority_push_report(int)
  from public, anon, authenticated;
grant execute on function public.api_high_priority_push_report(int) to service_role;
