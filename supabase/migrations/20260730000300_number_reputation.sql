-- #235 — noticing that a number has gone bad, before the customer does.
--
-- We sell a phone number as the product. If a carrier or an analytics vendor
-- starts filtering it, the customer's business stops working and nothing today
-- would tell us: `grep -ril "spam|reputation|10dlc"` over apps/api/src matched
-- only billing files. Filtering is silent by construction — the carrier returns
-- a success-looking status and drops the message, so the customer sees
-- "delivered", the homeowner sees nothing, and we are blamed for both.
--
-- ---------------------------------------------------------------------------
-- THE HARD PART IS NOT DETECTION. IT IS NOT CRYING WOLF.
--
-- At this platform's size a number might send a few dozen texts a week. Three
-- failures in a row is a completely ordinary Tuesday — handsets off, numbers
-- reassigned, a wrong digit — and a system that called that "your number has
-- been flagged as spam" would be worse than silence: the customer would churn
-- over a false alarm, and the one time it was real nobody would believe it.
--
-- So there are two states above healthy and they have different audiences:
--
--   'watch'    — the signal is real but the sample is thin. INTERNAL ONLY.
--                Nobody is told. It exists so we are looking before we are
--                sure, which is the whole point of the issue.
--   'degraded' — enough volume, and a fall from THIS NUMBER'S OWN baseline
--                large enough that ordinary variance does not explain it.
--                This is the only state the customer ever sees.
--
-- Comparing a number against ITSELF rather than a fleet average is deliberate:
-- a plumber texting the same 200 regulars has a different natural delivery
-- rate than a roofer cold-quoting, and a shared threshold would flag one of
-- them forever and never flag the other.

-- ---------------------------------------------------------------------------
-- 1. The state we keep per number.
-- ---------------------------------------------------------------------------

create table if not exists public.number_health (
  phone_number_id  uuid primary key
                     references public.phone_numbers(id) on delete cascade,
  company_id       uuid not null references public.companies(id) on delete cascade,
  state            text not null default 'healthy'
                     check (state in ('healthy', 'watch', 'degraded')),
  -- The recent window.
  sent             int not null default 0,
  delivered        int not null default 0,
  failed           int not null default 0,
  delivery_rate    numeric(5,4),
  -- This number's own trailing baseline, which is what "a fall" is measured
  -- against.
  baseline_rate    numeric(5,4),
  -- Inbound replies over the same window. A collapse here against healthy
  -- outbound volume is the tell for filtering that still reports "delivered":
  -- the messages are being accepted, billed, and never read.
  inbound_replies  int not null default 0,
  baseline_replies int not null default 0,
  assessed_at      timestamptz not null default now(),
  -- When this number first left 'healthy'. Kept across assessments so the
  -- banner can say how long, and so a flapping number is visible as one.
  degraded_since   timestamptz,
  -- Plain language, written by the assessor, shown to nobody but the operator.
  detail           text
);

comment on table public.number_health is
  '#235: per-number delivery health. ''watch'' is internal; only ''degraded'' '
  'is ever shown to a customer.';

create index if not exists number_health_state_idx
  on public.number_health (state) where state <> 'healthy';

-- ---------------------------------------------------------------------------
-- 2. Thresholds, named so they can be argued with.
-- ---------------------------------------------------------------------------

-- The recent window. Long enough to accumulate a sample at low volume, short
-- enough that a customer is not sending into a wall for a fortnight.
create or replace function public.number_health_window_days() returns int
language sql immutable set search_path = '' as $$ select 7 $$;

-- The baseline window that precedes it. Four times the recent window, so an
-- ordinary week cannot move the thing it is being compared to.
create or replace function public.number_health_baseline_days() returns int
language sql immutable set search_path = '' as $$ select 28 $$;

-- Below this many settled sends in the window, we do not have an opinion worth
-- acting on. THIS is the number that stops false alarms, and it is set from
-- what a small crew actually sends rather than from what would be
-- statistically comfortable.
create or replace function public.number_health_min_sample() returns int
language sql immutable set search_path = '' as $$ select 20 $$;

-- ---------------------------------------------------------------------------
-- 3. The assessment.
--
-- Runs daily. Writes state for every active number, and returns only the rows
-- whose state CHANGED — so the caller alerts on transitions rather than
-- re-announcing a known-bad number every morning until it is muted.
-- ---------------------------------------------------------------------------

create or replace function public.api_assess_number_health()
returns table (
  phone_number_id uuid,
  company_id      uuid,
  number_e164     text,
  was             text,
  state           text,
  delivery_rate   numeric,
  baseline_rate   numeric,
  detail          text
)
language plpgsql
security definer
set search_path = ''
as $$
-- The RETURNS TABLE columns (phone_number_id, company_id, state, ...) shadow
-- the real column names inside the body, so an unqualified reference — the
-- `on conflict (phone_number_id)` target, which cannot be qualified — is
-- ambiguous. Prefer the column; the locals below are all v_-prefixed and
-- collide with nothing.
#variable_conflict use_column
declare
  v_window   int := public.number_health_window_days();
  v_baseline int := public.number_health_baseline_days();
  v_min      int := public.number_health_min_sample();
begin
  return query
  with stats as (
    select
      n.id as phone_number_id,
      n.company_id,
      n.number_e164,
      -- Recent window.
      count(*) filter (
        where m.direction = 'outbound' and m.status in ('delivered', 'failed')
          and m.created_at > now() - make_interval(days => v_window)
      ) as sent,
      count(*) filter (
        where m.direction = 'outbound' and m.status = 'delivered'
          and m.created_at > now() - make_interval(days => v_window)
      ) as delivered,
      count(*) filter (
        where m.direction = 'outbound' and m.status = 'failed'
          and m.created_at > now() - make_interval(days => v_window)
      ) as failed,
      count(*) filter (
        where m.direction = 'inbound'
          and m.created_at > now() - make_interval(days => v_window)
      ) as inbound_replies,
      -- The trailing baseline, EXCLUDING the recent window so the two do not
      -- overlap. An overlapping baseline drags toward the very change we are
      -- trying to detect, which is how a slow decline hides forever.
      count(*) filter (
        where m.direction = 'outbound' and m.status in ('delivered', 'failed')
          and m.created_at <= now() - make_interval(days => v_window)
          and m.created_at > now() - make_interval(days => v_baseline)
      ) as base_sent,
      count(*) filter (
        where m.direction = 'outbound' and m.status = 'delivered'
          and m.created_at <= now() - make_interval(days => v_window)
          and m.created_at > now() - make_interval(days => v_baseline)
      ) as base_delivered,
      count(*) filter (
        where m.direction = 'inbound'
          and m.created_at <= now() - make_interval(days => v_window)
          and m.created_at > now() - make_interval(days => v_baseline)
      ) as base_replies
    from public.phone_numbers n
    left join public.conversations cv on cv.phone_number_id = n.id
    left join public.messages m on m.conversation_id = cv.id
    where n.status = 'active'
    group by n.id, n.company_id, n.number_e164
  ),
  scored as (
    select
      s.*,
      case when s.sent > 0 then s.delivered::numeric / s.sent end as rate,
      case when s.base_sent > 0 then s.base_delivered::numeric / s.base_sent end as base_rate,
      -- Scale the baseline reply count to the recent window's length so the
      -- comparison is like-for-like.
      (s.base_replies::numeric * v_window / v_baseline) as base_replies_scaled
    from stats s
  ),
  judged as (
    select
      sc.*,
      case
        -- Not enough to have an opinion. Explicitly healthy rather than
        -- unknown: a number nobody is texting from is not a number in trouble.
        when sc.sent < v_min then 'healthy'

        -- A real fall from this number's own baseline, with enough volume on
        -- both sides to mean something. 15 points is wide on purpose — it is
        -- past anything a normal week produces.
        when sc.base_rate is not null and sc.base_sent >= v_min
             and sc.rate < sc.base_rate - 0.15 then 'degraded'

        -- No baseline to compare against (a new number), so an absolute floor
        -- has to serve. A number delivering under 70% is in trouble whatever
        -- its history — and a RECYCLED number arrives pre-poisoned with no
        -- history at all, which is exactly the case the issue names.
        when sc.base_rate is null and sc.rate < 0.70 then 'degraded'

        -- Delivered, billed, and never answered. The tell for silent
        -- filtering: the carrier accepts and drops, so delivery looks perfect
        -- while the conversation dies. Only meaningful where replies used to
        -- happen, hence the baseline gate.
        when sc.base_replies_scaled >= 5 and sc.inbound_replies = 0 then 'degraded'

        -- Softer versions of the same three: real, but the sample is thin or
        -- the fall is smaller. Internal only — nobody is told.
        when sc.base_rate is not null and sc.rate < sc.base_rate - 0.08 then 'watch'
        when sc.rate < 0.85 then 'watch'
        when sc.base_replies_scaled >= 5
             and sc.inbound_replies::numeric < sc.base_replies_scaled * 0.25 then 'watch'

        else 'healthy'
      end as new_state
    from scored sc
  ),
  upserted as (
    insert into public.number_health as h (
      phone_number_id, company_id, state, sent, delivered, failed,
      delivery_rate, baseline_rate, inbound_replies, baseline_replies,
      assessed_at, degraded_since, detail
    )
    select
      j.phone_number_id, j.company_id, j.new_state, j.sent, j.delivered, j.failed,
      j.rate, j.base_rate, j.inbound_replies, round(j.base_replies_scaled)::int,
      now(),
      case when j.new_state = 'healthy' then null else now() end,
      case
        when j.new_state = 'healthy' then null
        when j.sent >= v_min and j.base_rate is not null then
          'delivery ' || round(j.rate * 100) || '% against a baseline of '
            || round(j.base_rate * 100) || '%'
        when j.base_replies_scaled >= 5 and j.inbound_replies = 0 then
          'no inbound replies against an expected ' || round(j.base_replies_scaled)
        else 'delivery ' || round(coalesce(j.rate, 0) * 100) || '% with no baseline'
      end
    from judged j
    on conflict (phone_number_id) do update
       set state            = excluded.state,
           sent             = excluded.sent,
           delivered        = excluded.delivered,
           failed           = excluded.failed,
           delivery_rate    = excluded.delivery_rate,
           baseline_rate    = excluded.baseline_rate,
           inbound_replies  = excluded.inbound_replies,
           baseline_replies = excluded.baseline_replies,
           assessed_at      = now(),
           detail           = excluded.detail,
           -- Held across assessments: a number that has been bad for nine days
           -- must not read as newly bad every morning.
           degraded_since   = case
                                when excluded.state = 'healthy' then null
                                when h.state = 'healthy' then now()
                                else h.degraded_since
                              end
       where h.state is distinct from excluded.state
          or h.assessed_at < now() - interval '1 hour'
    returning h.phone_number_id, h.company_id, h.state, h.delivery_rate,
              h.baseline_rate, h.detail
  )
  select
    u.phone_number_id, u.company_id, j.number_e164,
    -- `was` is what the caller alerts on: only a TRANSITION is news.
    coalesce(prev.state, 'healthy') as was,
    u.state, u.delivery_rate, u.baseline_rate, u.detail
  from upserted u
  join judged j on j.phone_number_id = u.phone_number_id
  left join (select phone_number_id, state from public.number_health) prev
    on prev.phone_number_id = u.phone_number_id
  where u.state is distinct from coalesce(prev.state, 'healthy');
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. What the owner sees.
--
-- 'watch' is deliberately flattened to 'healthy' here. It is a signal for us,
-- not a warning for them: telling somebody their business line MIGHT be
-- degraded, on a thin sample, is how a false alarm becomes a cancellation.
-- ---------------------------------------------------------------------------

create or replace function public.api_number_health(p_company_id uuid)
returns table (
  phone_number_id uuid,
  state           text,
  delivery_rate   numeric,
  degraded_since  timestamptz,
  detail          text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    h.phone_number_id,
    case when h.state = 'degraded' then 'degraded' else 'healthy' end,
    h.delivery_rate,
    case when h.state = 'degraded' then h.degraded_since end,
    case when h.state = 'degraded' then h.detail end
  from public.number_health h
  where h.company_id = p_company_id;
$$;

revoke all on function public.api_assess_number_health() from public, anon, authenticated;
grant execute on function public.api_assess_number_health() to service_role;

revoke all on function public.api_number_health(uuid) from public, anon, authenticated;
grant execute on function public.api_number_health(uuid) to service_role;

revoke all on function public.number_health_window_days() from public, anon, authenticated;
revoke all on function public.number_health_baseline_days() from public, anon, authenticated;
revoke all on function public.number_health_min_sample() from public, anon, authenticated;
grant execute on function public.number_health_window_days() to service_role;
grant execute on function public.number_health_baseline_days() to service_role;
grant execute on function public.number_health_min_sample() to service_role;

alter table public.number_health enable row level security;
revoke all on table public.number_health from public, anon, authenticated;
grant select, insert, update, delete on table public.number_health to service_role;
