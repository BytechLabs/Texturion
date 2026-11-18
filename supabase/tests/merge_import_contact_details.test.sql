begin;

do $$
declare
  owner constant uuid := '8f000000-0000-4000-8000-00000000001f';
  company constant uuid := '8f000000-0000-4000-8000-0000000001d7';
  customer constant uuid := '8f000000-0000-4000-8000-0000000001dc';
  request jsonb;
  outcome record;
  saved public.contacts%rowtype;
begin
  insert into auth.users (id, email) values (owner, 'import-details@test.local');
  insert into public.companies (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
  values (company, 'Import Details', owner, 'US', '415', now());
  insert into public.company_members (company_id, user_id, role) values (company, owner, 'owner');
  insert into public.contacts (id, company_id, phone_e164, created_by_user_id, name, address,
    notes, custom_fields, lat, lng, geocode_status)
  values (customer, company, '+14155550180', owner, 'Original', 'Old Street', 'Keep note',
    '{"gate":"old","priority":"yes"}', 37, -122, 'ok');
  insert into public.contacts (company_id, phone_e164) values (company, '+14155550181');

  request := jsonb_build_array(jsonb_build_object(
    'contact_id', customer,
    'profile', '{"name":"New name","email":"info@example.invalid","address":"New Street","notes":"","custom_fields":{"gate":"new","access":"side door"}}'::jsonb,
    'other_phones', '["+14155550181","+14155550182"]'::jsonb,
    'tags', '["Customer"]'::jsonb
  ));
  select * into outcome from public.api_merge_import_contact_details(company, request, false, true);
  select * into saved from public.contacts where id = customer;
  if outcome.kept is distinct from true or outcome.refused_phones is distinct from array['+14155550181']
    or saved.name is distinct from 'Original' or saved.email is distinct from 'info@example.invalid'
    or saved.address is distinct from 'Old Street' or saved.lat is distinct from 37
    or saved.custom_fields is distinct from '{"gate":"old","priority":"yes","access":"side door"}'::jsonb then
    raise exception 'the default import did not preserve saved details or report a taken number';
  end if;
  if not exists (select from public.contact_phones where contact_id = customer and phone_e164 = '+14155550182')
    or not exists (select from public.contact_tags ct join public.tags t on t.id = ct.tag_id
      where ct.contact_id = customer and t.name = 'Customer') then
    raise exception 'the import missed an available number or tag';
  end if;

  select * into outcome from public.api_merge_import_contact_details(company, request, true, true);
  select * into saved from public.contacts where id = customer;
  if outcome.kept is distinct from false or saved.name is distinct from 'New name'
    or saved.notes is distinct from 'Keep note' or saved.address is distinct from 'New Street'
    or saved.custom_fields is distinct from '{"gate":"new","priority":"yes","access":"side door"}'::jsonb
    or saved.lat is not null or saved.lng is not null or saved.geocode_status is distinct from 'pending'
    or saved.created_by_user_id is distinct from owner then
    raise exception 'replacement did not apply only the populated details';
  end if;
end
$$;

rollback;
