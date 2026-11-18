create function public.api_call_effect_counts(p_company uuid, p_since timestamptz)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_object_agg(totals.reason, totals.calls), '{}'::jsonb)
  from (
    select reasons.reason, count(*) as calls
    from public.calls c
    cross join lateral (
      select distinct reason
      from unnest(array[c.routing, c.ended_reason]) as r(reason)
      where reason is not null
    ) reasons
    where c.company_id = p_company and c.deleted_at is null and c.started_at >= p_since
    group by reasons.reason
  ) totals;
$$;

revoke execute on function public.api_call_effect_counts(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.api_call_effect_counts(uuid, timestamptz) to service_role;
