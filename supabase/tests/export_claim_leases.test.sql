begin;

insert into auth.users (id, email)
values ('8f000000-0000-4000-8000-00000000000a', 'export-lease@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('8f000000-0000-4000-8000-0000000000c1', 'Export Lease HVAC',
   '8f000000-0000-4000-8000-00000000000a', 'US', '415', now());

do $$
declare
  v_company constant uuid := '8f000000-0000-4000-8000-0000000000c1';
  v_user constant uuid := '8f000000-0000-4000-8000-00000000000a';
  v_export uuid;
  v_first public.data_exports;
  v_second public.data_exports;
begin
  if has_function_privilege('authenticated', 'public.claim_data_exports(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.claim_data_exports(integer)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.claim_data_exports(integer)', 'EXECUTE') then
    raise exception 'export work must be claimable only by the service';
  end if;

  insert into public.data_exports (company_id, requested_by, status, requested_at)
  values (v_company, v_user, 'pending', '-infinity')
  returning id into v_export;

  select * into v_first from public.claim_data_exports(1);
  if v_first.id is distinct from v_export or v_first.lease_token is null
     or v_first.lease_expires_at is distinct from now() + interval '20 minutes'
     or v_first.status is distinct from 'running'
     or v_first.storage_prefix is distinct from v_company::text || '/' || v_export::text then
    raise exception 'first claim did not grant the expected lease';
  end if;

  if exists (select from public.claim_data_exports(3) where id = v_export) then
    raise exception 'the export was claimed twice while its lease was active';
  end if;

  update public.data_exports set lease_expires_at = now() where id = v_export;
  select * into v_second from public.claim_data_exports(1);
  if v_second.id is distinct from v_export or v_second.lease_token is null
     or v_second.lease_token is not distinct from v_first.lease_token
     or v_second.started_at is distinct from v_first.started_at then
    raise exception 'reclaiming an expired lease must issue a new token and preserve the start';
  end if;

  update public.data_exports set status = 'ready', lease_token = null, lease_expires_at = null
  where id = v_export;
  if exists (select from public.claim_data_exports(3) where id = v_export) then
    raise exception 'a completed export was claimed again';
  end if;
end
$$;

rollback;
