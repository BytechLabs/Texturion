\set ON_ERROR_STOP on

begin;

do $$
declare
  v_company uuid := 'b81ec000-0000-4000-8000-000000000030';
  v_owner uuid := 'b81ec000-0000-4000-8000-000000000031';
  v_member uuid := 'b81ec000-0000-4000-8000-000000000032';
  v_removed uuid := 'b81ec000-0000-4000-8000-000000000033';
  v_enabled jsonb;
  v_reminder record;
  v_retry_count int;
  v_recipient_count int;
  v_progress jsonb;
begin
  insert into auth.users (id, email, email_confirmed_at) values
    (v_owner, 'mfa-notice-owner@example.test', now()),
    (v_member, 'mfa-notice-member@example.test', now()),
    (v_removed, 'mfa-notice-removed@example.test', now());
  insert into public.companies (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
  values (v_company, 'MFA notices', v_owner, 'CA', '416', now());
  insert into public.company_members (company_id, user_id, role, deactivated_at) values
    (v_company, v_owner, 'owner', null),
    (v_company, v_member, 'member', null),
    (v_company, v_removed, 'member', now());
  insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at)
  values (gen_random_uuid(), v_owner, 'totp', 'verified', now(), now());

  v_enabled := public.api_set_company_mfa(v_company, v_owner, true, 14);
  if v_enabled->>'changed' is distinct from 'true' then
    raise exception 'Switching on the policy must queue its first notice';
  end if;
  if (public.api_set_company_mfa(v_company, v_owner, true, 30)->>'grace_until')
      is distinct from v_enabled->>'grace_until' then
    raise exception 'Saving the policy again moved the grace deadline';
  end if;

  v_progress := public.workspace_mfa_progress(v_company, v_owner);
  if v_progress->'team' is distinct from '{"enrolled":1,"total":2}'::jsonb then
    raise exception 'The owner must see active member setup progress: %', v_progress;
  end if;
  v_progress := public.workspace_mfa_progress(v_company, v_member);
  if v_progress->>'enrolled' is distinct from 'false'
    or v_progress->>'team' is not null
    or public.workspace_mfa_progress(v_company, v_removed) is not null then
    raise exception 'Crew can only see their own status and inactive users must be excluded';
  end if;

  select count(*) into v_recipient_count
  from public.claim_workspace_mfa_notices(now(), v_company) where kind = 'enabled';
  if v_recipient_count <> 2 or exists (select 1 from public.claim_workspace_mfa_notices(now(), v_company)) then
    raise exception 'The enabled notice must go once to both active members';
  end if;

  select * into v_reminder
  from public.claim_workspace_mfa_notices(now() + interval '13 days')
  where email = 'mfa-notice-member@example.test';
  if v_reminder.kind is distinct from 'reminder' then
    raise exception 'The unenrolled member needs a reminder before the end of grace';
  end if;
  if exists (
    select 1 from public.company_members
    where company_id = v_company and user_id in (v_owner, v_removed) and mfa_policy_reminder_for is not null
  ) then
    raise exception 'A verified or removed member was sent a reminder';
  end if;
  perform public.release_workspace_mfa_notice(v_reminder.member_id, v_reminder.required_at, 'reminder');
  select count(*) into v_retry_count
  from public.claim_workspace_mfa_notices(now() + interval '13 days')
  where email = 'mfa-notice-member@example.test' and kind = 'reminder';
  if v_retry_count <> 1 or exists (
    select 1 from public.claim_workspace_mfa_notices(now() + interval '13 days')
    where email = 'mfa-notice-member@example.test'
  ) then
    raise exception 'A failed reminder must be retryable and a claimed reminder must be unique';
  end if;

  if has_function_privilege('authenticated', 'public.claim_workspace_mfa_notices(timestamptz,uuid)', 'execute') then
    raise exception 'A client must not be able to read member emails via the notice queue';
  end if;
end $$;

rollback;
