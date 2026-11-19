begin;

insert into auth.users (id, email)
values ('8f000000-0000-4000-8000-00000000000d', 'export-erasure@test.local');

insert into public.companies (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values ('8f000000-0000-4000-8000-0000000000d5', 'Export Erasure',
  '8f000000-0000-4000-8000-00000000000d', 'US', '415', now());

do $$
declare
  company constant uuid := '8f000000-0000-4000-8000-0000000000d5';
  actor constant uuid := '8f000000-0000-4000-8000-00000000000d';
  customer uuid;
  queued uuid;
  copies integer;
  removable integer;
  failure text;
begin
  insert into public.contacts (company_id, phone_e164, name)
  values (company, '+14155550169', 'Erased customer') returning id into customer;

  insert into public.data_exports (company_id, requested_by, kind, status, storage_prefix)
  values
    (company, actor, 'workspace', 'ready', company || '/old'),
    (company, actor, 'usage_summary', 'ready', company || '/usage');
  insert into public.data_exports (company_id, requested_by, kind, status, storage_prefix, lease_token, lease_expires_at)
  values (company, actor, 'conversation_history', 'running', company || '/running',
    gen_random_uuid(), now() + interval '10 minutes');
  insert into public.data_exports (company_id, requested_by, kind, requested_at)
  values (company, actor, 'tasks', '-infinity') returning id into queued;

  update public.contacts set erasure_started_at = now(), deleted_at = now() where id = customer;
  if exists (select from public.data_exports where company_id = company and
      kind in ('workspace', 'conversation_history') and
      (erasure_revoked_at is null or lease_token is not null
        or (kind = 'conversation_history' and status is distinct from 'failed'))) then
    raise exception 'an old export remained downloadable or writable during customer erasure';
  end if;
  if not exists (select from public.data_exports where company_id = company
      and kind = 'usage_summary' and status = 'ready' and erasure_revoked_at is null) then
    raise exception 'the billing-only export was revoked';
  end if;
  if exists (select from public.claim_data_exports(3) where id = queued) then
    raise exception 'a queued export started while customer data was being erased';
  end if;

  select count(*), count(*) filter (where files.removable) into copies, removable
  from public.api_customer_erasure_exports(company, customer, 5) files;
  if copies is distinct from 2 or removable is distinct from 1 then
    raise exception 'file removal started before the old worker lease elapsed';
  end if;

  begin
    update public.contacts set erasure_completed_at = now() where id = customer;
  exception when raise_exception then
    get stacked diagnostics failure = message_text;
  end;
  if failure is distinct from 'Cannot finish erasure until archived exports are removed' then
    raise exception 'the erasure receipt did not wait for storage removal';
  end if;

  update public.data_exports set reaped_at = now()
  where company_id = company and erasure_revoked_at is not null;
  update public.contacts set erasure_completed_at = now() where id = customer;
  if not exists (select from public.claim_data_exports(3) where id = queued) then
    raise exception 'the queued export did not resume after erasure';
  end if;
end
$$;

rollback;
