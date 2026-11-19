create or replace function public.api_pipeline_report(
  p_company_id uuid,
  p_since      timestamptz,
  p_until      timestamptz,
  p_hidden_number_ids uuid[] default null
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
      join public.conversations c on c.id = q.conversation_id and c.company_id = p_company_id
      left join outcomes o on o.conversation_id = q.conversation_id
     where q.quoted_at >= p_since and q.quoted_at < p_until
       and c.deleted_at is null and c.purged_at is null and not c.is_spam
       and (p_hidden_number_ids is null or c.phone_number_id is null
            or not (c.phone_number_id = any(p_hidden_number_ids)))
     group by q.conversation_id, q.quoted_at
  ),
  open_quotes as materialized (
    select q.id, q.conversation_id, q.description as label, q.amount_cents, q.currency, q.sent_at as opened_at
    from public.quotes q
    join public.conversations c on c.company_id = q.company_id and c.id = q.conversation_id
    where q.company_id = p_company_id and q.status in ('sent', 'viewed') and q.expires_at > p_until
      and q.sent_at >= p_since and q.sent_at < p_until
      and c.deleted_at is null and c.purged_at is null and not c.is_spam
      and (p_hidden_number_ids is null or c.phone_number_id is null
           or not c.phone_number_id = any(p_hidden_number_ids))
  ),
  open_items as materialized (
    select * from open_quotes
    union all
    select w.conversation_id, w.conversation_id, coalesce(contact.name, contact.phone_e164),
           null::bigint, null::text, w.quoted_at
    from windowed w
    join tag_quoted tagged on tagged.conversation_id = w.conversation_id
    join public.conversations c on c.company_id = p_company_id and c.id = w.conversation_id
    left join public.contacts contact on contact.company_id = c.company_id and contact.id = c.contact_id
    where w.won_at is null and w.lost_at is null
      and not exists (select 1 from open_quotes q where q.conversation_id = w.conversation_id)
  )
  select jsonb_build_object(
    'open_items', (select coalesce(jsonb_agg(to_jsonb(item) order by item.opened_at, item.id), '[]'::jsonb)
      from (select * from open_items order by opened_at, id limit 5) item),
    'open_items_total', (select count(*) from open_items),
    'quoted', count(*),
    'won',    count(*) filter (where won_at is not null),
    'lost',   count(*) filter (where lost_at is not null and won_at is null),
    'open',   count(*) filter (where won_at is null and lost_at is null),
    'median_days_to_win', (
      select round(
        percentile_cont(0.5) within group (
          order by extract(epoch from (won_at - quoted_at)) / 86400.0
        )::numeric, 1)
        from windowed where won_at is not null)
  )
  from windowed
$$;
