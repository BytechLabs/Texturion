-- D146: a number is healthy or degraded, and nothing in between.
--
-- 'watch' was a tier only we heard about: a softer fall, or a thin sample,
-- that sent us a notice and showed the customer nothing. Judging health for
-- our own ears is monitoring, and PostHog's issue on the 'degraded' notice is
-- what a person acts on. 'degraded' stays exactly as it was, because the
-- customer sees it.
--
-- Rows in 'watch' become 'healthy' without a transition being reported: the
-- customer was already shown healthy, so nothing they see changes.

update public.number_health
   set state = 'healthy', degraded_since = null, detail = null
 where state = 'watch';

alter table public.number_health drop constraint number_health_state_check;
alter table public.number_health
  add constraint number_health_state_check check (state in ('healthy', 'degraded'));

comment on table public.number_health is
  '#235: per-number delivery health, healthy or degraded. A degraded number '
  'is shown to its customer.';

-- The body is 20260730000300_number_reputation.sql's, without the three rules
-- that produced 'watch'.
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
-- the real column names inside the body, so an unqualified reference (the
-- `on conflict (phone_number_id)` target, which cannot be qualified) is
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
        -- both sides to mean something. 15 points is wide on purpose: it is
        -- past anything a normal week produces.
        when sc.base_rate is not null and sc.base_sent >= v_min
             and sc.rate < sc.base_rate - 0.15 then 'degraded'

        -- No baseline to compare against (a new number), so an absolute floor
        -- has to serve. A number delivering under 70% is in trouble whatever
        -- its history, and a RECYCLED number arrives pre-poisoned with no
        -- history at all, which is exactly the case the issue names.
        when sc.base_rate is null and sc.rate < 0.70 then 'degraded'

        -- Delivered, billed, and never answered. The tell for silent
        -- filtering: the carrier accepts and drops, so delivery looks perfect
        -- while the conversation dies. Only meaningful where replies used to
        -- happen, hence the baseline gate.
        when sc.base_replies_scaled >= 5 and sc.inbound_replies = 0 then 'degraded'

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

revoke all on function public.api_assess_number_health() from public, anon, authenticated;
grant execute on function public.api_assess_number_health() to service_role;
