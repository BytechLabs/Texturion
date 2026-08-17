-- #287 — one win rate, counting real quotes as well as pipeline tags.
--
-- ## The problem this settles
--
-- #354 built the pipeline report on `conversation_tags`: a crew applies a
-- `quote_sent` tag, then `won` or `lost`, and the report counts those. That was
-- the only signal available at the time and it is still a real one — plenty of
-- quoting happens over the phone and gets tagged rather than sent as a link.
--
-- #287 then gave the product an actual quote object, with a real amount, a real
-- send, and a customer's own recorded acceptance. So the product now has TWO
-- notions of "we quoted this and won it", and a screen showing both would be
-- showing two different numbers for one question — the exact confusion this
-- repository keeps having to unpick.
--
-- ## The rule
--
-- A conversation is QUOTED if it has a `quote_sent` tag OR a quote that was
-- actually sent. It is WON if it has a `won` tag OR an accepted quote, and LOST
-- if it has a `lost` tag OR a declined quote. Counted ONCE either way: the
-- union is per conversation, not per signal, so a job that was both tagged and
-- formally quoted is one job.
--
-- WHERE THE TWO DISAGREE ABOUT WHEN, THE EARLIER ONE WINS. Not "the quote row
-- is more authoritative" — the question is "when did we first quote this job",
-- and a crew who tagged it on Monday and sent the formal price on Thursday
-- quoted it on Monday. Taking the later one would shorten every median
-- days-to-win by the gap between the two habits.
--
-- ## What does NOT count
--
-- A DRAFT quote. It was never sent, so nobody was ever asked to answer it, and
-- counting it would put unsent prices in the denominator of a win rate — which
-- makes a crew that drafts carefully look worse than one that does not.

create or replace function public.api_pipeline_report(
  p_company_id uuid,
  p_since      timestamptz,
  p_until      timestamptz
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with tag_quoted as (
    select ct.conversation_id, min(ct.created_at) as at
      from public.conversation_tags ct
      join public.tags t on t.id = ct.tag_id
     where t.company_id = p_company_id
       and t.pipeline_stage = 'quote_sent'
     group by ct.conversation_id
  ),
  -- #287: a quote that actually went to a customer. `sent_at` rather than the
  -- row existing, because a draft was never asked of anybody.
  quote_quoted as (
    select q.conversation_id, min(q.sent_at) as at
      from public.quotes q
     where q.company_id = p_company_id
       and q.sent_at is not null
     group by q.conversation_id
  ),
  quoted as (
    select conversation_id, min(at) as quoted_at
      from (select * from tag_quoted union all select * from quote_quoted) u
     group by conversation_id
  ),
  tag_outcomes as (
    select ct.conversation_id, t.pipeline_stage, min(ct.created_at) as at
      from public.conversation_tags ct
      join public.tags t on t.id = ct.tag_id
     where t.company_id = p_company_id
       and t.pipeline_stage in ('won', 'lost')
     group by ct.conversation_id, t.pipeline_stage
  ),
  quote_outcomes as (
    select q.conversation_id,
           case when q.status = 'accepted' then 'won' else 'lost' end as pipeline_stage,
           min(q.decided_at) as at
      from public.quotes q
     where q.company_id = p_company_id
       and q.status in ('accepted', 'declined')
       and q.decided_at is not null
     group by q.conversation_id, q.status
  ),
  outcomes as (
    select conversation_id, pipeline_stage, min(at) as at
      from (select * from tag_outcomes union all select * from quote_outcomes) u
     group by conversation_id, pipeline_stage
  ),
  windowed as (
    select q.conversation_id,
           q.quoted_at,
           max(o.at) filter (where o.pipeline_stage = 'won')  as won_at,
           max(o.at) filter (where o.pipeline_stage = 'lost') as lost_at
      from quoted q
      left join outcomes o on o.conversation_id = q.conversation_id
     where q.quoted_at >= p_since and q.quoted_at < p_until
     group by q.conversation_id, q.quoted_at
  )
  select jsonb_build_object(
    'quoted', count(*),
    'won',    count(*) filter (where won_at is not null),
    'lost',   count(*) filter (where lost_at is not null and won_at is null),
    'open',   count(*) filter (where won_at is null and lost_at is null),
    -- Median rather than mean days-to-win: one job that closed after eight
    -- months would drag a mean into uselessness, and the owner is asking how
    -- long a normal quote takes.
    'median_days_to_win', (
      select round(
        percentile_cont(0.5) within group (
          order by extract(epoch from (won_at - quoted_at)) / 86400.0
        )::numeric, 1)
        from windowed where won_at is not null)
  )
  from windowed
$$;

-- REVOKE BEFORE GRANT. A recreated function is handed back the default PUBLIC
-- execute grant, which `anon` and `authenticated` inherit — so recreating a
-- security-definer function without this widens it, silently, every time.
revoke execute on function public.api_pipeline_report(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_pipeline_report(uuid, timestamptz, timestamptz)
  to service_role;
