-- #303 — detect the SHAPES that breach the AUP, without reading anybody's words.
--
-- `/legal/aup` exists and acceptance is mandatory at company creation. What
-- follows acceptance is nothing: no detection, no thresholds, no defined
-- response. That matters more for a messaging provider than for most products,
-- because the industry rules are enforced against US rather than against the
-- customer who broke them — carrier filtering and account-level action apply to
-- the whole sending pool, so one abusive workspace is billed to every other
-- customer's deliverability (#235).
--
-- ===========================================================================
-- BEHAVIOURAL, AND THAT CONSTRAINT IS THE DESIGN
-- ===========================================================================
--
-- The issue's own devil's advocate names the way this goes wrong first:
-- "building surveillance of customer message content would betray the privacy
-- posture the rest of the product holds — the design must stay behavioural, and
-- that constraint should be explicit rather than assumed."
--
-- So nothing here reads a body. Every signal is a COUNT or a RATIO:
--
--   sent_24h        outbound accepted in the last day
--   baseline_daily  the workspace's own median day over the prior fortnight,
--                   because "a lot" is meaningless without knowing what this
--                   crew's ordinary Tuesday looks like. A two-person shop
--                   sending 300 is alarming; a ten-van operation sending 300 is
--                   Monday.
--   fresh_ratio     share of those sends that went to a number this workspace
--                   had never contacted before. Mass marketing is defined by
--                   reaching strangers; a busy crew after a storm is texting
--                   people who already called them.
--   opt_outs_24h    STOPs in the same window. The recipients' own verdict, and
--                   the one signal that needs no interpretation at all.
--
-- Velocity ALONE is deliberately not enough to report. A genuinely busy crew
-- after a storm looks statistically like a spammer, and the asymmetry of that
-- false positive is the whole reason this alerts a human rather than acting.
create or replace function public.api_aup_signals(
  p_baseline_days int default 14
)
returns table (
  company_id     uuid,
  company_name   text,
  sent_24h       bigint,
  baseline_daily numeric,
  fresh_ratio    numeric,
  opt_outs_24h   bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with recent as (
    select
      v.company_id,
      m.id,
      v.contact_id
    from public.messages m
    join public.conversations v on v.id = m.conversation_id
    where m.direction = 'outbound'
      and m.status in ('sent', 'delivered')
      and m.created_at >= now() - interval '24 hours'
  ),
  -- A contact this workspace had already texted BEFORE today. Anything not in
  -- here is a stranger, which is what makes the ratio mean something.
  known as (
    select distinct v.company_id, v.contact_id
      from public.messages m
      join public.conversations v on v.id = m.conversation_id
     where m.direction = 'outbound'
       and m.created_at < now() - interval '24 hours'
  ),
  -- The workspace's own ordinary day. MEDIAN rather than mean, so one genuine
  -- storm week cannot raise the bar it is later judged against.
  baseline as (
    select
      v.company_id,
      percentile_cont(0.5) within group (
        order by daily.n
      ) as median_daily
    from public.conversations v
    join lateral (
      select date_trunc('day', m.created_at) as d, count(*) as n
        from public.messages m
       where m.conversation_id = v.id
         and m.direction = 'outbound'
         and m.created_at >= now() - make_interval(days => greatest(p_baseline_days, 1) + 1)
         and m.created_at <  now() - interval '24 hours'
       group by 1
    ) daily on true
    group by v.company_id
  ),
  stops as (
    select o.company_id, count(*) as n
      from public.opt_outs o
     where o.created_at >= now() - interval '24 hours'
     group by o.company_id
  )
  select
    c.id,
    c.name,
    count(r.id)::bigint,
    coalesce(b.median_daily, 0)::numeric,
    case
      when count(r.id) = 0 then 0
      else round(
        count(r.id) filter (
          where not exists (
            select 1 from known k
             where k.company_id = c.id and k.contact_id = r.contact_id
          )
        )::numeric / count(r.id),
        3
      )
    end,
    coalesce(max(s.n), 0)::bigint
  from public.companies c
  left join recent r on r.company_id = c.id
  left join baseline b on b.company_id = c.id
  left join stops s on s.company_id = c.id
  where c.deleted_at is null
  group by c.id, c.name, b.median_daily
  having count(r.id) > 0;
$$;

comment on function public.api_aup_signals is
  '#303: behavioural AUP signals per workspace — a day''s outbound, that workspace''s OWN median day, the share of sends reaching never-contacted numbers, and opt-outs in the same window. No message body is read: every value is a count or a ratio, which is what keeps detection compatible with the privacy posture the rest of the product holds. Judged against a workspace''s own baseline because "a lot" is meaningless otherwise.';

revoke all on function public.api_aup_signals(int) from public, anon, authenticated;
grant execute on function public.api_aup_signals(int) to service_role;
