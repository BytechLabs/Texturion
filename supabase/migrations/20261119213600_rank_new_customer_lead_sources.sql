drop function public.api_lead_source_report(uuid, timestamptz, timestamptz, uuid[]);

create function public.api_lead_source_report(
  p_company_id uuid,
  p_since timestamptz,
  p_until timestamptz,
  p_hidden_number_ids uuid[] default null
) returns table (
  lead_source_id uuid,
  name text,
  by_number bigint,
  by_person bigint,
  by_widget bigint,
  total bigint,
  new_customer bigint,
  "returning" bigint,
  outreach bigint
)
language sql stable
security definer
set search_path = ''
as $$
  with visible as materialized (
    select c.id, c.contact_id, c.lead_source_id, c.lead_source_origin, c.first_source
    from public.conversations c
    where c.company_id = p_company_id and not c.is_spam
      and c.deleted_at is null and c.purged_at is null
      and c.created_at < p_until
      and (p_hidden_number_ids is null or c.phone_number_id is null
           or not c.phone_number_id = any(p_hidden_number_ids))
  ),
  openings as materialized (
    select c.id, opening.opened_at,
      row_number() over (partition by coalesce(c.contact_id, c.id) order by opening.opened_at, c.id) as sequence
    from visible c
    cross join lateral public.report_lead_opening(p_company_id, c.id) opening
    where opening.opened_at < p_until
  ),
  classified as (
    select c.lead_source_id, c.lead_source_origin,
      (c.first_source = 'widget' and c.lead_source_origin is distinct from 'manual') is true as widget,
      case
        when o.opened_at >= p_since then case when o.sequence = 1 then 'new_customer' else 'returning' end
        when o.opened_at < p_since and (
          exists (
            select 1 from public.messages m
            where m.company_id = p_company_id and m.conversation_id = c.id and m.direction = 'inbound'
              and m.deleted_at is null and m.purged_at is null
              and m.created_at >= p_since and m.created_at < p_until
          ) or exists (
            select 1 from public.calls k
            where k.company_id = p_company_id and k.conversation_id = c.id and k.direction = 'inbound'
              and k.outcome in ('missed','voicemail') and k.deleted_at is null and k.purged_at is null
              and k.started_at >= p_since and k.started_at < p_until
          )
        ) then 'returning'
        when o.id is null and (
          exists (
            select 1 from public.messages m
            where m.company_id = p_company_id and m.conversation_id = c.id and m.direction = 'outbound'
              and not m.automated and m.deleted_at is null and m.purged_at is null
              and m.created_at >= p_since and m.created_at < p_until
          ) or exists (
            select 1 from public.calls k
            where k.company_id = p_company_id and k.conversation_id = c.id and k.direction = 'outbound'
              and k.answered_by_user_id is not null and k.deleted_at is null and k.purged_at is null
              and k.started_at >= p_since and k.started_at < p_until
          )
        ) then 'outreach'
      end as group_name
    from visible c left join openings o on o.id = c.id
  )
  select
    c.lead_source_id, s.name,
    count(*) filter (where c.group_name = 'new_customer' and c.lead_source_origin = 'number' and not c.widget),
    count(*) filter (where c.group_name = 'new_customer' and c.lead_source_origin = 'manual'),
    count(*) filter (where c.group_name = 'new_customer' and c.widget),
    count(*) filter (where c.group_name = 'new_customer' and not c.widget),
    count(*) filter (where c.group_name = 'new_customer'),
    count(*) filter (where c.group_name = 'returning'),
    count(*) filter (where c.group_name = 'outreach')
  from classified c
  left join public.lead_sources s on s.company_id = p_company_id and s.id = c.lead_source_id
  where c.group_name is not null
  group by c.lead_source_id, s.name;
$$;

revoke execute on function public.api_lead_source_report(uuid, timestamptz, timestamptz, uuid[])
  from public, anon, authenticated;
grant execute on function public.api_lead_source_report(uuid, timestamptz, timestamptz, uuid[])
  to service_role;
