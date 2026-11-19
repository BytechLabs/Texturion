create or replace function public.report_lead_opening(p_company_id uuid, p_conversation_id uuid)
returns table (opened_at timestamptz, channel text)
language sql stable rows 1
set search_path = ''
as $
  with candidates as (
    (
      select m.created_at as opened_at, 'text'::text as channel
      from public.messages m
      where m.company_id = p_company_id and m.conversation_id = p_conversation_id
        and m.direction = 'inbound' and m.deleted_at is null and m.purged_at is null
      order by m.created_at, m.id
      limit 1
    )
    union all
    (
      select k.started_at, 'call'::text
      from public.calls k
      where k.company_id = p_company_id and k.conversation_id = p_conversation_id
        and k.direction = 'inbound' and k.outcome in ('missed', 'voicemail')
        and k.deleted_at is null and k.purged_at is null
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
      and m.direction = 'outbound' and not m.automated and m.deleted_at is null and m.purged_at is null
      and m.created_at < opening.opened_at
  ) and not exists (
    select 1 from public.calls k
    where k.company_id = p_company_id and k.conversation_id = p_conversation_id
      and k.direction = 'outbound' and k.answered_by_user_id is not null and k.deleted_at is null and k.purged_at is null
      and k.started_at < opening.opened_at
  );
$$;

alter table public.companies add column response_baseline jsonb;

create function public.report_first_human_response(
  p_company_id uuid,
  p_conversation_id uuid,
  p_opened_at timestamptz,
  p_until timestamptz default 'infinity'
) returns table (responded_at timestamptz, user_id uuid)
language sql stable rows 1
set search_path = ''
as $$
  select candidate.responded_at, candidate.user_id
  from (
    (
      select m.created_at as responded_at, m.sent_by_user_id as user_id
      from public.messages m
      where m.company_id = p_company_id and m.conversation_id = p_conversation_id
        and m.direction = 'outbound' and not m.automated and m.deleted_at is null and m.purged_at is null
        and m.created_at >= p_opened_at and m.created_at < p_until
      order by m.created_at, m.id
      limit 1
    )
    union all
    (
      select coalesce(k.answered_at, k.started_at), k.answered_by_user_id
      from public.calls k
      where k.company_id = p_company_id and k.conversation_id = p_conversation_id
        and k.deleted_at is null and k.purged_at is null
        and coalesce(k.answered_at, k.started_at) >= p_opened_at
        and coalesce(k.answered_at, k.started_at) < p_until
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
  limit 1;
$$;

revoke execute on function public.report_first_human_response(uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.report_first_human_response(uuid, uuid, timestamptz, timestamptz)
  to service_role;

create function public.api_response_time_baseline(
  p_company_id uuid,
  p_now timestamptz,
  p_definition_version integer,
  p_min_days integer,
  p_max_days integer,
  p_min_answers integer,
  p_hidden_number_ids uuid[] default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  company_scope boolean := coalesce(cardinality(p_hidden_number_ids), 0) = 0;
  cached jsonb;
  anchor timestamptz;
  selected_until timestamptz;
  answer_count integer;
  decided jsonb;
begin
  if p_company_id is null then
    raise exception 'api_response_time_baseline: p_company_id is required';
  end if;

  if company_scope then
    select c.response_baseline into cached
    from public.companies c where c.id = p_company_id;
    if cached->>'definition_version' is distinct from p_definition_version::text then
      select c.response_baseline into cached
      from public.companies c where c.id = p_company_id for no key update;
    end if;
    if cached->>'definition_version' = p_definition_version::text then
      if cached->>'answered' = '0' then
        return jsonb_build_object('reason', 'no_answered_leads');
      end if;
      return jsonb_build_object('baseline', cached);
    end if;
  end if;

  with openings as materialized (
    select c.id, opening.opened_at
    from public.conversations c
    cross join lateral public.report_lead_opening(p_company_id, c.id) opening
    where c.company_id = p_company_id and not c.is_spam and c.deleted_at is null and c.purged_at is null
      and opening.opened_at < p_now
      and (company_scope or c.phone_number_id is null or not (c.phone_number_id = any(p_hidden_number_ids)))
  ),
  limits as (
    select min(opened_at) as first_lead, min(opened_at) + make_interval(days => p_max_days) as last_day
    from openings
  ),
  scored as materialized (
    select o.opened_at, response.responded_at
    from openings o cross join limits l
    left join lateral public.report_first_human_response(
      p_company_id, o.id, o.opened_at, least(p_now, l.last_day)
    ) response on true
    where o.opened_at < l.last_day
  ),
  nth_answer as (
    select s.responded_at
    from scored s where s.responded_at is not null
    order by s.responded_at
    offset (p_min_answers - 1) limit 1
  ),
  baseline_window as (
    select l.first_lead,
      case when answer.responded_at is null then l.last_day
        else least(l.last_day, greatest(l.first_lead + make_interval(days => p_min_days),
                                        answer.responded_at + interval '1 microsecond')) end as closes_at
    from limits l left join nth_answer answer on true
  )
  select w.first_lead, w.closes_at,
    (select count(*) from scored s where s.responded_at is not null)::integer,
    (
      select jsonb_build_object(
        'definition_version', p_definition_version,
        'since', w.first_lead,
        'until', w.closes_at,
        'leads', count(*),
        'answered', count(*) filter (where s.responded_at < w.closes_at),
        'median_seconds', percentile_cont(0.5) within group (
          order by extract(epoch from s.responded_at - s.opened_at)
        ) filter (where s.responded_at < w.closes_at)
      )
      from scored s where s.opened_at < w.closes_at
    )
  into anchor, selected_until, answer_count, decided
  from baseline_window w;

  if anchor is null or selected_until > p_now then
    return jsonb_build_object('reason', 'collecting', 'answered', least(answer_count, p_min_answers), 'required', p_min_answers);
  end if;
  if company_scope then
    update public.companies set response_baseline = decided where id = p_company_id;
  end if;
  if answer_count = 0 then
    return jsonb_build_object('reason', 'no_answered_leads');
  end if;
  return jsonb_build_object('baseline', decided);
end $$;

revoke execute on function public.api_response_time_baseline(uuid, timestamptz, integer, integer, integer, integer, uuid[])
  from public, anon, authenticated;
grant execute on function public.api_response_time_baseline(uuid, timestamptz, integer, integer, integer, integer, uuid[])
  to service_role;


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
    where c.company_id = p_company_id and not c.is_spam and c.deleted_at is null and c.purged_at is null
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
               and m.direction = 'inbound' and m.deleted_at is null and m.purged_at is null
               and m.created_at > auto_text.sent_at
           ) as replied_to_auto_text
    from leads l
    left join lateral public.report_first_human_response(p_company_id, l.conversation_id, l.opened_at) answer on true
    left join lateral (
      select min(m.created_at) as sent_at
      from public.messages m
      where m.company_id = p_company_id and m.conversation_id = l.conversation_id
        and m.automation = 'missed_call_text' and m.status in ('sent', 'delivered')
        and m.deleted_at is null and m.purged_at is null
        and m.created_at >= l.opened_at
    ) auto_text on true
  ),
  answered as (
    select * from scored where response_seconds is not null
  ),
  missed as (
    select k.conversation_id, coalesce(k.caller_e164, k.conversation_id::text, k.id::text) as caller,
           min(k.started_at) as missed_at
    from public.calls k
    left join public.conversations c on c.id = k.conversation_id and c.company_id = k.company_id
    where k.company_id = p_company_id and k.direction = 'inbound'
      and k.outcome in ('missed', 'voicemail') and k.deleted_at is null and k.purged_at is null
      and (c.id is null or (not c.is_spam and c.deleted_at is null and c.purged_at is null))
      and k.started_at >= p_since and k.started_at < p_until
      and (p_hidden_number_ids is null or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
      and (p_hidden_number_ids is null or k.phone_number_id is null
           or not (k.phone_number_id = any(p_hidden_number_ids)))
    group by k.conversation_id, coalesce(k.caller_e164, k.conversation_id::text, k.id::text)
  ),
  missed_callers as (
    select m.caller, bool_or(response.responded_at is not null) as reached
    from missed m
    left join lateral public.report_first_human_response(
      p_company_id, m.conversation_id, m.missed_at, p_until
    ) response on true
    group by m.caller
  )
  select jsonb_build_object(
    'since', p_since,
    'until', p_until,
    'leads', (select count(*) from scored),
    'answered', (select count(*) from answered),
    'unanswered', (select count(*) from scored where response_seconds is null),
    'missed_callers', (
      select jsonb_build_object('total', count(*),
        'reached', count(*) filter (where reached),
        'unreached', count(*) filter (where not reached))
      from missed_callers
    ),
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


create function public.invalidate_response_baseline() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_at timestamptz;
begin
  if tg_table_name = 'calls' then
    affected_at := old.started_at;
  else
    affected_at := old.created_at;
  end if;

  perform 1 from public.companies c where c.id = old.company_id for no key update;
  update public.companies c set response_baseline = null
  where c.id = old.company_id
    and affected_at < (c.response_baseline->>'until')::timestamptz;
  return null;
end $$;

revoke execute on function public.invalidate_response_baseline() from public, anon, authenticated;

create trigger conversations_invalidate_response_baseline
after update of deleted_at, purged_at, is_spam, phone_number_id on public.conversations
for each row when (old.deleted_at is distinct from new.deleted_at
  or old.purged_at is distinct from new.purged_at or old.is_spam is distinct from new.is_spam
  or old.phone_number_id is distinct from new.phone_number_id)
execute function public.invalidate_response_baseline();

create trigger messages_invalidate_response_baseline
after update of deleted_at, purged_at on public.messages
for each row when (old.deleted_at is distinct from new.deleted_at or old.purged_at is distinct from new.purged_at)
execute function public.invalidate_response_baseline();

create trigger calls_invalidate_response_baseline
after update of deleted_at, purged_at on public.calls
for each row when (old.deleted_at is distinct from new.deleted_at or old.purged_at is distinct from new.purged_at)
execute function public.invalidate_response_baseline();
