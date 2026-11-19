\set ON_ERROR_STOP on

begin;

do $$
declare
  v_company uuid := 'b81ec000-0000-4000-8000-000000000001';
  v_owner uuid := 'b81ec000-0000-4000-8000-000000000002';
  v_existing uuid;
  v_result jsonb;
  v_function text := 'public.api_create_invite(uuid,uuid,text,public.member_role,text,text,integer,uuid)';
begin
  insert into auth.users (id, email) values (v_owner, 'invite-capacity-owner@example.test');
  insert into public.companies
    (id, name, owner_user_id, country, requested_area_code, aup_accepted_at, plan)
  values (v_company, 'Invite capacity', v_owner, 'CA', '416', now(), 'starter');
  insert into public.company_members (company_id, user_id, role) values (v_company, v_owner, 'owner');

  if has_function_privilege('anon', v_function, 'execute')
     or has_function_privilege('authenticated', v_function, 'execute')
     or not has_function_privilege('service_role', v_function, 'execute') then
    raise exception 'Team invite creation must be restricted to the API role';
  end if;

  insert into public.invites (company_id, invited_by, email, role, expires_at)
  values (v_company, v_owner, 'OLD@example.test', 'member', now() - interval '2 days')
  returning id into v_existing;

  v_result := public.api_create_invite(v_company, v_owner, 'old@example.test', 'bookkeeper', null, 'starter', 3);
  if v_result->>'outcome' is distinct from 'created'
     or (v_result->'invite'->>'id')::uuid is distinct from v_existing
     or v_result->'invite'->>'role' is distinct from 'bookkeeper'
     or (v_result->'invite'->>'expires_at')::timestamptz is distinct from now() + interval '7 days'
     or (v_result->'previous_invite'->>'expires_at')::timestamptz is distinct from now() - interval '2 days'
     or v_result->'previous_invite'->>'role' is distinct from 'member' then
    raise exception 'Expected an expired invite to refresh in place: %', v_result;
  end if;

  v_result := public.api_create_invite(v_company, v_owner, 'Old@example.test', 'member', null, 'starter', 3);
  if v_result->>'outcome' is distinct from 'duplicate' then
    raise exception 'Expected a case-insensitive pending conflict: %', v_result;
  end if;

  v_result := public.api_create_invite(v_company, v_owner, 'second@example.test', 'member', null, 'starter', 3);
  if v_result->>'outcome' is distinct from 'created' then
    raise exception 'Expected the final free seat to be reserved: %', v_result;
  end if;
  v_result := public.api_create_invite(v_company, v_owner, 'third@example.test', 'member', null, 'starter', 3);
  if v_result is distinct from '{"outcome":"seat_limit","active":1,"pending":2}'::jsonb then
    raise exception 'Expected owner plus pending invites to use all seats: %', v_result;
  end if;

  update public.invites set revoked_at = now() where id = v_existing;
  v_result := public.api_create_invite(v_company, v_owner, 'old@example.test', 'member', null, 'starter', 3);
  if v_result->>'outcome' is distinct from 'revoke_cooldown' then
    raise exception 'Expected a cooldown after revoking an invite: %', v_result;
  end if;

  update public.companies
  set invite_attempts_at = array_fill(now() - interval '1 hour', array[9])
  where id = v_company;
  v_result := public.api_create_invite(v_company, v_owner, 'third@example.test', 'member', null, 'starter', 3);
  if v_result->>'outcome' is distinct from 'daily_limit' then
    raise exception 'Expected the daily limit at three times the seat count: %', v_result;
  end if;

  update public.companies
  set invite_attempts_at = array_fill(now() - interval '25 hours', array[9])
  where id = v_company;
  v_result := public.api_create_invite(v_company, v_owner, 'third@example.test', 'member', null, 'starter', 3);
  if v_result->>'outcome' is distinct from 'created'
     or (select cardinality(invite_attempts_at) from public.companies where id = v_company) is distinct from 1 then
    raise exception 'Expected attempts older than 24 hours to fall out of the quota: %', v_result;
  end if;

  v_existing := (v_result->'invite'->>'id')::uuid;
  v_result := public.api_create_invite(v_company, v_owner, null, null, null, 'starter', 3, v_existing);
  if v_result->>'outcome' is distinct from 'created' then
    raise exception 'A pending invite should reuse its reserved seat when resent: %', v_result;
  end if;
  v_result := public.api_create_invite(v_company, v_owner, null, null, null, 'starter', 3, v_existing);
  if v_result->>'outcome' is distinct from 'resend_limit' then
    raise exception 'Expected a 24-hour per-invite resend limit: %', v_result;
  end if;
end $$;

rollback;
