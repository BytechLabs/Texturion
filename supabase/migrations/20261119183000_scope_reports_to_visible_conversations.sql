drop function public.api_pipeline_report(uuid, timestamptz, timestamptz);

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
       and c.deleted_at is null
       and (p_hidden_number_ids is null or c.phone_number_id is null
            or not (c.phone_number_id = any(p_hidden_number_ids)))
     group by q.conversation_id, q.quoted_at
  )
  select jsonb_build_object(
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

revoke execute on function public.api_pipeline_report(uuid, timestamptz, timestamptz, uuid[])
  from public, anon, authenticated;
grant execute on function public.api_pipeline_report(uuid, timestamptz, timestamptz, uuid[])
  to service_role;

drop function public.api_lead_source_report(uuid, timestamptz, timestamptz);

create or replace function public.api_lead_source_report(
  p_company_id uuid,
  p_since      timestamptz,
  p_until      timestamptz,
  p_hidden_number_ids uuid[] default null
) returns table (
  lead_source_id uuid,
  name           text,
  by_number      bigint,
  by_person      bigint,
  by_widget      bigint,
  total          bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    c.lead_source_id,
    s.name,
    count(*) filter (where c.lead_source_origin = 'number' and not w.credited) as by_number,
    count(*) filter (where c.lead_source_origin = 'manual') as by_person,
    count(*) filter (where w.credited) as by_widget,
    count(*) filter (where not w.credited) as total
  from public.conversations c
  left join public.lead_sources s on s.id = c.lead_source_id
  -- Website origin takes precedence over number attribution.
  cross join lateral (
    select (c.first_source = 'widget'
            and c.lead_source_origin is distinct from 'manual') as credited
  ) w
  where c.company_id = p_company_id
    and c.deleted_at is null
    and (p_hidden_number_ids is null or c.phone_number_id is null
         or not (c.phone_number_id = any(p_hidden_number_ids)))
    and c.created_at >= p_since
    and c.created_at <  p_until
    and c.is_spam = false
  group by c.lead_source_id, s.name;
$$;

revoke execute on function public.api_lead_source_report(uuid, timestamptz, timestamptz, uuid[])
  from public, anon, authenticated;
grant execute on function public.api_lead_source_report(uuid, timestamptz, timestamptz, uuid[])
  to service_role;

drop function public.api_contact_timeline(uuid, uuid, int, timestamptz, uuid);

create or replace function public.api_contact_timeline(
  p_company_id uuid,
  p_contact_id uuid,
  p_limit      int default 50,
  p_before_ts  timestamptz default null,
  p_before_id  uuid default null,
  p_hidden_number_ids uuid[] default null
) returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with entries as (
    select
      'conversation'::text as kind,
      c.id                 as id,
      coalesce(c.last_message_at, c.created_at) as occurred_at,
      c.id                 as conversation_id,
      c.status::text       as status,
      null::text           as detail,
      c.created_at         as started_at,
      null::int            as talk_seconds,
      null::timestamptz    as due_at,
      null::boolean        as done,
      null::uuid           as series_id,
      null::jsonb          as repeat
    from public.conversations c
    where c.company_id = p_company_id
      and c.deleted_at is null
      and (p_hidden_number_ids is null or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
      and c.contact_id = p_contact_id
      and coalesce(c.is_spam, false) = false

    union all

    select
      'call'::text,
      k.id,
      k.started_at,
      k.conversation_id,
      k.outcome::text,
      k.caller_name,
      k.started_at,
      k.forward_seconds,
      null::timestamptz,
      null::boolean,
      null::uuid,
      null::jsonb
    from public.calls k
    left join public.conversations kc on kc.id = k.conversation_id and kc.company_id = k.company_id
    where k.company_id = p_company_id
      and kc.deleted_at is null
      and (p_hidden_number_ids is null or kc.phone_number_id is null
           or not (kc.phone_number_id = any(p_hidden_number_ids)))
      and k.deleted_at is null
      and (p_hidden_number_ids is null or k.phone_number_id is null
           or not (k.phone_number_id = any(p_hidden_number_ids)))
      and k.contact_id = p_contact_id

    union all

    select
      'task'::text,
      t.id,
      t.created_at,
      t.conversation_id,
      null::text,
      t.title,
      t.created_at,
      null::int,
      t.due_at,
      coalesce(m.done_at, t.done_at) is not null,
      t.series_id,
      case when s.id is not null then jsonb_build_object(
        'kind', s.kind, 'unit', s.unit, 'every', s.every,
        'paused', s.paused, 'stopped', s.stopped_at is not null) end
    from public.tasks t
    left join public.conversations tc on tc.id = t.conversation_id
    left join public.messages m on m.id = t.message_id
    left join public.calls sk on sk.id = t.source_call_id
    left join public.task_series s on s.id = t.series_id
    where t.company_id = p_company_id
      and coalesce(tc.contact_id, t.contact_id) = p_contact_id
      and t.deleted_at is null
      and tc.deleted_at is null
      and (p_hidden_number_ids is null or tc.phone_number_id is null
           or not (tc.phone_number_id = any(p_hidden_number_ids)))
      and (p_hidden_number_ids is null or sk.phone_number_id is null
           or not (sk.phone_number_id = any(p_hidden_number_ids)))
  )
  select jsonb_build_object(
    'kind', e.kind,
    'id', e.id,
    'occurred_at', e.occurred_at,
    'conversation_id', e.conversation_id,
    'status', e.status,
    'detail', e.detail,
    'started_at', e.started_at,
    'talk_seconds', e.talk_seconds,
    'due_at', e.due_at,
    'done', e.done,
    'series_id', e.series_id,
    'repeat', e.repeat
  )
  from entries e
  where p_before_ts is null
     or (e.occurred_at, e.id) < (p_before_ts, p_before_id)
  order by e.occurred_at desc, e.id desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

revoke execute on function public.api_contact_timeline(uuid, uuid, int, timestamptz, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.api_contact_timeline(uuid, uuid, int, timestamptz, uuid, uuid[])
  to service_role;
