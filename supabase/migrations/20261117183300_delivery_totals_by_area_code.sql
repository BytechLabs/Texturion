create function public.api_delivery_totals_by_area_code(
  p_company_id uuid,
  p_since timestamptz
) returns table (
  area_code text,
  sent bigint,
  delivered bigint,
  failed bigint,
  pending bigint
)
language sql
stable
set search_path = ''
as $$
  select
    substring(
      coalesce(nullif(cv.contact_phone_e164, ''), c.phone_e164)
      from '^\+1([2-9][0-9]{2})[2-9][0-9]{6}$'
    ) as area_code,
    count(*) as sent,
    count(*) filter (where m.status = 'delivered') as delivered,
    count(*) filter (where m.status = 'failed') as failed,
    count(*) filter (where m.status in ('queued', 'sent')) as pending
  from public.messages m
  join public.conversations cv
    on cv.id = m.conversation_id and cv.company_id = m.company_id
  join public.contacts c
    on c.id = cv.contact_id and c.company_id = m.company_id
  where m.company_id = p_company_id
    and m.direction = 'outbound'
    and m.created_at >= p_since
    and coalesce(nullif(cv.contact_phone_e164, ''), c.phone_e164) <> ''
  group by 1;
$$;

revoke execute on function public.api_delivery_totals_by_area_code(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_delivery_totals_by_area_code(uuid, timestamptz)
  to service_role;
