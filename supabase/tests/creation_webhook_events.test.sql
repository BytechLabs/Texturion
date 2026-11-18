begin;

insert into auth.users (id, email)
values ('8f000000-0000-4000-8000-00000000000f', 'creation-events@test.local');

insert into public.companies (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values ('8f000000-0000-4000-8000-0000000000d7', 'Creation Events',
  '8f000000-0000-4000-8000-00000000000f', 'US', '415', now());

insert into public.company_members (company_id, user_id, role)
values ('8f000000-0000-4000-8000-0000000000d7', '8f000000-0000-4000-8000-00000000000f', 'owner');

do $$
declare
  company constant uuid := '8f000000-0000-4000-8000-0000000000d7';
  owner constant uuid := '8f000000-0000-4000-8000-00000000000f';
  count_inbound integer;
  count_imported integer;
  count_api integer;
  task jsonb;
begin
  insert into public.webhook_endpoints (company_id, url, secret, events)
  values (company, 'https://example.invalid/creation', 'fixture', array['contact.created', 'task.created']);

  insert into public.contacts (company_id, phone_e164)
  values (company, '+14155550173');
  insert into public.contacts (company_id, phone_e164, name)
  values (company, '+14155550173', 'Inbound customer')
  on conflict (company_id, phone_e164) do update set name = excluded.name;

  insert into public.contacts (company_id, phone_e164, created_by_user_id, creation_origin)
  values
    (company, '+14155550174', owner, 'import'),
    (company, '+14155550175', owner, 'import');

  select count(*) into count_inbound from public.webhook_deliveries
  where company_id = company and event_type = 'contact.created'
    and payload->'data'->>'origin' = 'inbound';
  if count_inbound is distinct from 1 then
    raise exception 'the inbound contact should send one creation event, got %', count_inbound;
  end if;

  select jsonb_array_length(payload->'data'->'contacts') into count_imported
  from public.webhook_deliveries where company_id = company and event_type = 'contact.created'
    and payload->'data'->>'origin' = 'import';
  if count_imported is distinct from 2 then
    raise exception 'the import should send one batch with two contacts';
  end if;

  task := public.create_task(company, null, 'Public task', null, null, null, owner,
    null, null, null, null, null, null, null, null, null, null, 'normal', array[owner], 'api');
  set constraints enqueue_task_creation_webhook immediate;
  select count(*) into count_api from public.webhook_deliveries
  where company_id = company and event_type = 'task.created'
    and payload->'data'->>'origin' = 'api' and payload->'data'->>'task_id' = task->'task'->>'id'
    and payload->'data'->'assignee_ids' = to_jsonb(array[owner]);
  if count_api is distinct from 1 then
    raise exception 'the public task event missed its origin or assigned member';
  end if;
end
$$;

rollback;
