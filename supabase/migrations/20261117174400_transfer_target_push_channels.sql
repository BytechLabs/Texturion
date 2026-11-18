create function public.api_transfer_target_push_users(
  p_company_id uuid,
  p_user_ids uuid[],
  p_allow_native boolean
) returns table (user_id uuid)
language sql stable security invoker
set search_path = ''
as $$
  select m.user_id
  from public.company_members m
  where m.company_id = p_company_id
    and m.deactivated_at is null
    and m.user_id = any(p_user_ids)
    and not exists (
      select 1 from public.notification_prefs np
      where np.user_id = m.user_id and np.company_id = m.company_id
        and np.push_enabled = false
    )
    and (
      exists (
        select 1 from public.push_subscriptions s where s.user_id = m.user_id
      )
      or (
        p_allow_native and exists (
          select 1 from public.device_push_tokens t where t.user_id = m.user_id
        )
      )
    );
$$;

revoke all on function public.api_transfer_target_push_users(uuid, uuid[], boolean)
from public, anon, authenticated;
grant execute on function public.api_transfer_target_push_users(uuid, uuid[], boolean)
to service_role;
