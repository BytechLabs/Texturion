-- #749: settings that can lose a customer say who chose a value other than the
-- default, and when. The answer is the latest settings change that touched the
-- key; a key nobody changed through Settings returns no row.
create or replace function public.api_latest_setting_changes(
  p_company_id uuid,
  p_keys       text[]
) returns table (
  key           text,
  actor_user_id uuid,
  actor_name    text,
  occurred_at   timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select k.key, latest.actor_user_id, p.display_name, latest.occurred_at
    from unnest(p_keys) as k(key)
    cross join lateral (
      select a.actor_user_id, a.occurred_at
        from public.audit_log a
       where a.company_id = p_company_id
         and a.action = 'settings.changed'
         and a.target_type = 'company'
         and a.after ? k.key
       order by a.occurred_at desc, a.id desc
       limit 1
    ) latest
    left join public.profiles p on p.user_id = latest.actor_user_id;
$$;
revoke execute on function public.api_latest_setting_changes(uuid, text[])
  from public, anon, authenticated;
grant execute on function public.api_latest_setting_changes(uuid, text[])
  to service_role;
