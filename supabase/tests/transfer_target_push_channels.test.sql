\set ON_ERROR_STOP on

begin;

do $$
declare
  workspace_id uuid := gen_random_uuid();
  other_workspace_id uuid := gen_random_uuid();
  browser_user uuid := gen_random_uuid();
  phone_user uuid := gen_random_uuid();
  disabled_user uuid := gen_random_uuid();
  inactive_user uuid := gen_random_uuid();
  outsider_user uuid := gen_random_uuid();
  no_channel_user uuid := gen_random_uuid();
  candidates uuid[] := array[
    browser_user, phone_user, disabled_user, inactive_user, outsider_user, no_channel_user
  ];
begin
  insert into auth.users (id, email, aud, role)
    select id, id || '@transfer-push.test', 'authenticated', 'authenticated'
    from unnest(candidates) as id;

  insert into public.companies (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
    values
      (workspace_id, 'Transfer push test', browser_user, 'CA', '613', now()),
      (other_workspace_id, 'Other transfer workspace', outsider_user, 'CA', '613', now());

  insert into public.company_members (company_id, user_id, deactivated_at)
    select workspace_id, id, case when id = inactive_user then now() end
    from unnest(candidates) as id where id <> outsider_user;
  insert into public.company_members (company_id, user_id)
    values (other_workspace_id, browser_user), (other_workspace_id, outsider_user);

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
    select id, 'https://push.example.test/' || id, 'test-key', 'test-auth'
    from unnest(array[browser_user, disabled_user, inactive_user, outsider_user]) as id;
  insert into public.device_push_tokens (user_id, platform, token)
    values (phone_user, 'ios', 'test-ios-token');
  insert into public.notification_prefs (user_id, company_id, push_enabled)
    values (disabled_user, workspace_id, false), (browser_user, other_workspace_id, false);

  if (select array_agg(user_id)
      from public.api_transfer_target_push_users(workspace_id, candidates, false))
      is distinct from array[browser_user] then
    raise exception 'Only the active browser user should have a channel without native push';
  end if;
  if not (select count(*) = 2 and bool_and(user_id in (browser_user, phone_user))
          from public.api_transfer_target_push_users(workspace_id, candidates, true)) then
    raise exception 'Enabling native push should also include the registered phone user';
  end if;
  if exists (select from public.api_transfer_target_push_users(workspace_id, array[outsider_user], true)) then
    raise exception 'A registered user outside the workspace should be omitted';
  end if;
  if has_function_privilege('authenticated', 'public.api_transfer_target_push_users(uuid,uuid[],boolean)', 'execute')
    or has_function_privilege('anon', 'public.api_transfer_target_push_users(uuid,uuid[],boolean)', 'execute')
    or not has_function_privilege('service_role', 'public.api_transfer_target_push_users(uuid,uuid[],boolean)', 'execute') then
    raise exception 'Only the service role should be able to query transfer push channels';
  end if;
end;
$$;

rollback;
