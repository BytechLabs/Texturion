\set ON_ERROR_STOP on

begin;

do $$
declare
  v_workspace uuid := 'b81ec000-0000-4000-8000-000000000040';
  v_owner uuid := 'b81ec000-0000-4000-8000-000000000041';
  v_effective timestamptz := now() + interval '1 day';
  v_subscription text := 'sub_downgrade_fixture';
  v_schedule text := 'sched_downgrade_fixture';
  v_result text;
begin
  insert into auth.users (id, email) values (v_owner, 'pending-plan-owner@example.test');
  insert into public.companies (
    id, name, owner_user_id, country, requested_area_code, aup_accepted_at, stripe_subscription_id, plan
  ) values (
    v_workspace, 'Downgrade capacity', v_owner, 'CA', '416', now(), v_subscription, 'pro'
  );
  insert into public.company_members (company_id, user_id, role) values (v_workspace, v_owner, 'owner');

  insert into public.phone_numbers (company_id, provisioning_key, requested_area_code, country)
  values (v_workspace, 'pending-plan-number-1', '416', 'CA');
  insert into public.invites (company_id, invited_by, email, role) values
    (v_workspace, v_owner, 'first@example.test', 'member'),
    (v_workspace, v_owner, 'second@example.test', 'member'),
    (v_workspace, v_owner, 'third@example.test', 'member');

  v_result := public.api_record_pending_downgrade(v_workspace, v_subscription, v_schedule, v_effective, 3, 1);
  if v_result is distinct from 'seat_limit' then
    raise exception 'Pending invites count along with members when switching to Starter: %', v_result;
  end if;

  update public.invites set revoked_at = now()
  where company_id = v_workspace and email operator(extensions.=) 'third@example.test'::extensions.citext;
  v_result := public.api_record_pending_downgrade(v_workspace, v_subscription, v_schedule, v_effective, 3, 1);
  if v_result is distinct from 'scheduled' then
    raise exception 'Expected a pending downgrade when both limits fit: %', v_result;
  end if;

  begin
    insert into public.invites (company_id, invited_by, email, role)
    values (v_workspace, v_owner, 'extra@example.test', 'member');
    raise exception 'A Pro workspace with a Starter downgrade must refuse a fourth seat';
  exception when sqlstate 'P8801' then
    null;
  end;

  begin
    insert into public.phone_numbers (company_id, provisioning_key, requested_area_code, country)
    values (v_workspace, 'pending-plan-number-2', '416', 'CA');
    raise exception 'A Pro workspace with a Starter downgrade must refuse a second number';
  exception when sqlstate 'P8802' then
    null;
  end;

  update public.companies set pending_plan = null, pending_plan_effective_at = null,
    pending_plan_schedule_id = null, pending_plan_seat_limit = null, pending_plan_number_limit = null
  where id = v_workspace and pending_plan_schedule_id = v_schedule;

  insert into public.phone_numbers (company_id, provisioning_key, requested_area_code, country)
  values (v_workspace, 'pending-plan-number-2', '416', 'CA');
  insert into public.invites (company_id, invited_by, email, role)
  values (v_workspace, v_owner, 'extra@example.test', 'member');

  v_result := public.api_record_pending_downgrade(
    v_workspace, v_subscription, v_schedule, v_effective, 3, 1, false
  );
  if v_result is distinct from 'scheduled' then
    raise exception 'Expected a schedule to erase: %', v_result;
  end if;
  update public.companies set deleted_at = now() - interval '31 days', purge_after = now() - interval '1 day'
  where id = v_workspace;
  perform public.anonymize_purged_workspace(v_workspace);

  if not exists (
    select 1 from public.companies where id = v_workspace and purged_at is not null
      and pending_plan is null and pending_plan_effective_at is null and pending_plan_schedule_id is null
      and pending_plan_seat_limit is null and pending_plan_number_limit is null
  ) then
    raise exception 'Workspace erasure must clear the Stripe schedule and its pending downgrade';
  end if;
end $$;

rollback;
