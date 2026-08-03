-- #303 — the carrier's own verdict joins the signals.
--
-- The issue names "a spike in carrier-violation error codes" and the watch job
-- did not have it. It is the signal with the least interpretation in it: the
-- other two are inferences about a SHAPE, and a workspace whose sends are being
-- actively rejected as spam is not a shape — a carrier has already decided.
--
-- WHY IT STANDS ALONE rather than joining the velocity/fan-out conjunction.
-- That conjunction exists because volume alone is a busy Tuesday and reaching
-- strangers alone is a new workspace doing exactly what it should; neither
-- means anything by itself. A carrier block means something by itself, and it
-- carries a cost the others do not: filtering applies to the SENDING POOL, so
-- these rejections are already spending every other customer's deliverability.
-- Same reasoning as opt-outs, which stand alone for the same reason.
--
-- The codes are the ones packages/shared/src/carrier-failure.ts classifies as
-- `spam_blocked` — 40003, 40015, 40322 — and NOT 40300, which is an opt-out
-- and already counted by its own signal. Duplicating a STOP into two alarms
-- would report one event twice and make a quiet workspace look like two
-- problems.
--
-- Still no message body is read. This counts rows by error code.

drop function if exists public.api_aup_signals(int);

create or replace function public.api_aup_signals(
  p_baseline_days int default 14
) returns table (
  company_id       uuid,
  company_name     text,
  sent_24h         bigint,
  baseline_daily   numeric,
  fresh_ratio      numeric,
  opt_outs_24h     bigint,
  spam_blocks_24h  bigint
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
  ),
  -- The carrier's verdict. FAILED sends only: a message that went through
  -- carries no rejection whatever code is attached to it.
  blocks as (
    select v.company_id, count(*) as n
      from public.messages m
      join public.conversations v on v.id = m.conversation_id
     where m.direction = 'outbound'
       and m.status = 'failed'
       and m.error_code in ('40003', '40015', '40322')
       and m.created_at >= now() - interval '24 hours'
     group by v.company_id
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
    coalesce(max(s.n), 0)::bigint,
    coalesce(max(bl.n), 0)::bigint
  from public.companies c
  left join recent r on r.company_id = c.id
  left join baseline b on b.company_id = c.id
  left join stops s on s.company_id = c.id
  left join blocks bl on bl.company_id = c.id
  where c.deleted_at is null
  group by c.id, c.name, b.median_daily
  -- A workspace whose sends ALL failed has no `recent` rows — recent counts
  -- only sent/delivered — so the old `count(r.id) > 0` would have hidden
  -- exactly the workspace being blocked hardest.
  having count(r.id) > 0 or coalesce(max(bl.n), 0) > 0;
$$;

comment on function public.api_aup_signals(int) is
  '#303: behavioural AUP signals per workspace — a day''s outbound, that workspace''s OWN median day, the share of sends reaching never-contacted numbers, opt-outs, and carrier spam-rejections in the same window. No message body is read: every value is a count or a ratio, which is what keeps detection compatible with the privacy posture the rest of the product holds. Judged against a workspace''s own baseline because "a lot" is meaningless otherwise.';

revoke all on function public.api_aup_signals(int) from public, anon, authenticated;
grant execute on function public.api_aup_signals(int) to service_role;
