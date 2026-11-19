create index messages_live_inbound_by_conversation_idx
  on public.messages (conversation_id, created_at, id)
  where direction = 'inbound' and deleted_at is null;

create function public.report_lead_opening(p_company_id uuid, p_conversation_id uuid)
returns table (opened_at timestamptz, channel text)
language sql stable rows 1
as $$
  with candidates as (
    (
      select m.created_at as opened_at, 'text'::text as channel
      from public.messages m
      where m.company_id = p_company_id and m.conversation_id = p_conversation_id
        and m.direction = 'inbound' and m.deleted_at is null
      order by m.created_at, m.id
      limit 1
    )
    union all
    (
      select k.started_at, 'call'::text
      from public.calls k
      where k.company_id = p_company_id and k.conversation_id = p_conversation_id
        and k.direction = 'inbound' and k.outcome in ('missed', 'voicemail')
        and k.deleted_at is null
      order by k.started_at, k.id
      limit 1
    )
  ), first_opening as (
    select candidate.opened_at, candidate.channel
    from candidates candidate
    order by candidate.opened_at, candidate.channel
    limit 1
  )
  select opening.opened_at, opening.channel
  from first_opening opening
  where not exists (
    select 1 from public.messages m
    where m.company_id = p_company_id and m.conversation_id = p_conversation_id
      and m.direction = 'outbound' and not m.automated and m.deleted_at is null
      and m.created_at < opening.opened_at
  ) and not exists (
    select 1 from public.calls k
    where k.company_id = p_company_id and k.conversation_id = p_conversation_id
      and k.direction = 'outbound' and k.answered_by_user_id is not null and k.deleted_at is null
      and k.started_at < opening.opened_at
  );
$$;

revoke all on function public.report_lead_opening(uuid, uuid) from public, anon, authenticated;
grant execute on function public.report_lead_opening(uuid, uuid) to service_role;

create or replace function public.api_response_time_stats(
  p_company_id uuid,
  p_since timestamptz,
  p_until timestamptz,
  p_max_rows int default 5000,
  p_hidden_number_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if p_company_id is null then
    raise exception 'api_response_time_stats: p_company_id is required';
  end if;
  p_max_rows := greatest(coalesce(p_max_rows, 5000), 1);

  with leads as (
    select c.id as conversation_id, c.phone_number_id, opening.opened_at, opening.channel
    from public.conversations c
    cross join lateral public.report_lead_opening(p_company_id, c.id) opening
    where c.company_id = p_company_id and not c.is_spam and c.deleted_at is null
      and (p_hidden_number_ids is null or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
      and opening.opened_at >= p_since and opening.opened_at < p_until
  ),
  scored as (
    select l.conversation_id, l.phone_number_id, l.opened_at, l.channel,
           answer.responded_at, answer.user_id as responder_user_id,
           extract(epoch from (answer.responded_at - l.opened_at)) as response_seconds,
           auto_text.sent_at is not null as auto_text_sent,
           exists (
             select 1 from public.messages m
             where m.company_id = p_company_id and m.conversation_id = l.conversation_id
               and m.direction = 'inbound' and m.deleted_at is null
               and m.created_at > auto_text.sent_at
           ) as replied_to_auto_text
    from leads l
    left join lateral (
      select candidate.responded_at, candidate.user_id
      from (
        (
          select m.created_at as responded_at, m.sent_by_user_id as user_id
          from public.messages m
          where m.company_id = p_company_id and m.conversation_id = l.conversation_id
            and m.direction = 'outbound' and not m.automated and m.deleted_at is null
            and m.created_at >= l.opened_at
          order by m.created_at, m.id
          limit 1
        )
        union all
        (
          select coalesce(k.answered_at, k.started_at), k.answered_by_user_id
          from public.calls k
          where k.company_id = p_company_id and k.conversation_id = l.conversation_id
            and k.deleted_at is null and coalesce(k.answered_at, k.started_at) >= l.opened_at
            and (
              (k.direction = 'inbound' and k.outcome = 'answered')
              or (k.direction = 'outbound' and k.answered_by_user_id is not null
                  and (k.outcome = 'answered' or k.forward_seconds >= 10))
            )
          order by coalesce(k.answered_at, k.started_at), k.id
          limit 1
        )
      ) candidate
      order by candidate.responded_at, candidate.user_id
      limit 1
    ) answer on true
    left join lateral (
      select min(m.created_at) as sent_at
      from public.messages m
      where m.company_id = p_company_id and m.conversation_id = l.conversation_id
        and m.automation = 'missed_call_text' and m.status in ('sent', 'delivered')
        and m.deleted_at is null
        and m.created_at >= l.opened_at
    ) auto_text on true
  ),
  answered as (
    select * from scored where response_seconds is not null
  )
  select jsonb_build_object(
    'since', p_since,
    'until', p_until,
    'leads', (select count(*) from scored),
    'answered', (select count(*) from answered),
    'unanswered', (select count(*) from scored where response_seconds is null),
    'text_first', (select count(*) from scored where channel = 'text'),
    'call_first', (select count(*) from scored where channel = 'call'),
    'auto_text_sent', (select count(*) from scored where auto_text_sent),
    'replied_to_auto_text', (select count(*) from scored where replied_to_auto_text),
    'median_seconds', (select percentile_cont(0.5) within group (order by response_seconds) from answered),
    'p90_seconds', (select percentile_cont(0.9) within group (order by response_seconds) from answered),
    'by_member', (
      select coalesce(jsonb_agg(member order by (member->>'median_seconds')::numeric), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'user_id', responder_user_id,
          'answered', count(*),
          'median_seconds', percentile_cont(0.5) within group (order by response_seconds)
        ) as member
        from answered where responder_user_id is not null
        group by responder_user_id
      ) members
    ),
    'by_number', (
      select coalesce(jsonb_agg(line), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'phone_number_id', phone_number_id,
          'leads', count(*),
          'answered', count(*) filter (where response_seconds is not null),
          'median_seconds', percentile_cont(0.5) within group (order by response_seconds)
            filter (where response_seconds is not null)
        ) as line
        from scored where phone_number_id is not null
        group by phone_number_id
      ) lines
    ),
    'rows', (
      select coalesce(jsonb_agg(to_jsonb(slice)), '[]'::jsonb)
      from (
        select conversation_id, phone_number_id, opened_at, responded_at, responder_user_id, response_seconds
        from scored order by opened_at desc, conversation_id limit p_max_rows
      ) slice
    ),
    'row_limit', p_max_rows,
    'truncated', (select count(*) from scored) > p_max_rows
  ) into v_result;

  return v_result;
end;
$function$;
