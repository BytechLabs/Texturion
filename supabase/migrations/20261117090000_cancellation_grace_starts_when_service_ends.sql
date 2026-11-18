create or replace function public.api_reanchor_cancellation(
  p_company_id uuid,
  p_old_canceled_at timestamptz,
  p_new_canceled_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_new_canceled_at <= p_old_canceled_at then
    return false;
  end if;

  update public.companies
  set canceled_at = p_new_canceled_at,
      winback_dismissed_at = case
        when winback_dismissed_at >= p_old_canceled_at
          then greatest(winback_dismissed_at, p_new_canceled_at)
        else winback_dismissed_at
      end
  where id = p_company_id
    and canceled_at = p_old_canceled_at
    and subscription_status = 'canceled'
    and deleted_at is null;

  if not found then
    return false;
  end if;

  insert into public.grace_notices (
    company_id,
    canceled_at,
    threshold_day,
    sent_at
  )
  select
    company_id,
    p_new_canceled_at,
    threshold_day,
    sent_at
  from public.grace_notices
  where company_id = p_company_id
    and canceled_at = p_old_canceled_at
    and threshold_day = 1
  on conflict (company_id, canceled_at, threshold_day) do nothing;

  delete from public.grace_notices
  where company_id = p_company_id
    and canceled_at = p_old_canceled_at
    and threshold_day = 1;

  return true;
end;
$$;

revoke all on function public.api_reanchor_cancellation(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_reanchor_cancellation(uuid, timestamptz, timestamptz)
  to service_role;
