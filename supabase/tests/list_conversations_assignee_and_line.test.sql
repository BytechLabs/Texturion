\set ON_ERROR_STOP on
begin;

do $$
declare
  owner_id uuid := gen_random_uuid();
  company_id_value uuid := gen_random_uuid();
  first_line uuid := gen_random_uuid();
  other_line uuid := gen_random_uuid();
  first_contact uuid := gen_random_uuid();
  assigned_contact uuid := gen_random_uuid();
  other_contact uuid := gen_random_uuid();
  expected_thread uuid := gen_random_uuid();
  filtered uuid[];
begin
  insert into auth.users (id, email)
    values (owner_id, 'inbox-line-filters@test.local');
  insert into public.companies
    (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
    values (company_id_value, 'Inbox Line Filters', owner_id, 'US', '415', now());
  insert into public.company_members (company_id, user_id, role)
    values (company_id_value, owner_id, 'owner');
  insert into public.phone_numbers
    (id, company_id, number_e164, status, provisioning_key, country)
    values (first_line, company_id_value, '+14155550161', 'active', 'inbox-filters-1', 'US'),
           (other_line, company_id_value, '+14155550162', 'active', 'inbox-filters-2', 'US');
  insert into public.contacts (id, company_id, phone_e164)
    values (first_contact, company_id_value, '+14155550163'),
           (assigned_contact, company_id_value, '+14155550164'),
           (other_contact, company_id_value, '+14155550165');
  insert into public.conversations
    (id, company_id, contact_id, phone_number_id, assigned_user_id, last_message_at)
    values (expected_thread, company_id_value, first_contact, first_line, null, now() - interval '1 minute'),
           (gen_random_uuid(), company_id_value, assigned_contact, first_line, owner_id, now()),
           (gen_random_uuid(), company_id_value, other_contact, other_line, null, now());

  select array_agg((row->>'id')::uuid) into filtered
    from public.api_list_conversations(
      company_id_value, owner_id, 1, p_unassigned => true, p_phone_number_id => first_line
    ) row;
  if filtered is distinct from array[expected_thread] then
    raise exception 'Unassigned and Line must both apply before the page limit';
  end if;

  if exists (
    select 1 from public.api_list_conversations(
      company_id_value, owner_id, 10, p_hidden_number_ids => array[first_line],
      p_unassigned => true, p_phone_number_id => first_line
    )
  ) then
    raise exception 'The selected line must still respect number access';
  end if;
end
$$;

rollback;
