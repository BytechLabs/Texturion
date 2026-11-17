\set ON_ERROR_STOP on

begin;

do $$
declare
  owner_id uuid := gen_random_uuid();
  company_id uuid;
  contact_id uuid;
  tag_id uuid;
  phone text := '+14165550108';
  result jsonb;
  profile public.contacts%rowtype;
begin
  insert into auth.users (id, email) values (owner_id, 'owner@contact-trash.test');
  company_id := (public.api_create_company(owner_id, 'Contact Trash Test', 'CA', '416', true)->>'id')::uuid;

  insert into public.contacts
    (company_id, phone_e164, name, email, business_name, address, notes, custom_fields,
     timezone, locale, lat, lng, consent_source, consent_at)
    values
    (company_id, phone, 'Morgan', 'morgan@example.test', 'North Shop', '1 Main Street',
     'Use side door', '{"account":"A12"}', 'America/Toronto', 'fr-CA',
     43.65, -79.38, 'inbound_sms', now())
    returning id into contact_id;

  insert into public.contact_phones (company_id, contact_id, phone_e164)
    values (company_id, contact_id, '+14165550109');
  insert into public.contact_addresses (company_id, contact_id, address)
    values (company_id, contact_id, '2 Main Street');
  insert into public.tags (company_id, name, color)
    values (company_id, 'Priority', '#123456') returning id into tag_id;
  insert into public.contact_tags (company_id, contact_id, tag_id)
    values (company_id, contact_id, tag_id);
  insert into public.opt_outs (company_id, phone_e164, source)
    values (company_id, phone, 'manual');
  update public.contacts set name = 'Morgan Lee' where id = contact_id;
  if not exists (select 1 from public.record_activity a
                  where a.source_id = contact_id and a.kind = 'edited'
                    and a.payload->>'to' = 'Morgan Lee') then
    raise exception 'The test contact must have a profile value in its activity history';
  end if;

  update public.contacts set deleted_at = now(), deleted_by_user_id = owner_id
   where id = contact_id;
  select item into result from public.api_list_trash(company_id, 50) as items(item)
   where item->>'id' = contact_id::text;
  if result->>'kind' is distinct from 'contact'
     or result->>'contact_name' is distinct from 'Morgan Lee'
     or (result->>'deleted_by_user_id')::uuid is distinct from owner_id then
    raise exception 'The deleted contact is missing from Trash';
  end if;

  result := public.api_restore_trash(gen_random_uuid(), owner_id, 'contact', contact_id);
  if result->>'outcome' is distinct from 'not_found' then
    raise exception 'A different workspace could restore the contact';
  end if;
  result := public.api_restore_trash(company_id, owner_id, 'contact', contact_id);
  select * into profile from public.contacts where id = contact_id;
  if result->>'outcome' is distinct from 'restored'
     or profile.deleted_at is not null or profile.deleted_by_user_id is not null
     or profile.notes is distinct from 'Use side door' then
    raise exception 'Restoring a contact did not preserve its profile';
  end if;

  update public.contacts set deleted_at = now() - interval '31 days' where id = contact_id;
  if not exists (select 1 from public.api_trash_due(200) d where d.kind = 'contact' and d.id = contact_id) then
    raise exception 'The expired contact was not scheduled for purge';
  end if;
  update public.companies set legal_hold_at = now(), legal_hold_reason = 'Retention test'
   where id = company_id;
  result := public.api_purge_trash_item('contact', contact_id, owner_id, company_id);
  if result->>'outcome' is distinct from 'legal_hold' then
    raise exception 'Contact purge did not respect the legal hold';
  end if;
  update public.companies set legal_hold_at = null, legal_hold_reason = null where id = company_id;
  result := public.api_purge_trash_item('contact', contact_id, owner_id, company_id);
  select * into profile from public.contacts where id = contact_id;
  if result->>'outcome' is distinct from 'purged' or profile.purged_at is null
     or profile.name is not null or profile.email is not null or profile.business_name is not null
     or profile.address is not null or profile.notes is not null
     or profile.custom_fields is distinct from '{}'::jsonb
     or profile.timezone is not null or profile.locale is not null
     or profile.lat is not null or profile.lng is not null
     or profile.phone_e164 is distinct from phone or profile.consent_source::text is distinct from 'inbound_sms'
     or profile.consent_at is null then
    raise exception 'Contact purge did not erase the profile and keep the consent record';
  end if;
  if exists (select 1 from public.contact_phones p where p.contact_id = profile.id)
     or exists (select 1 from public.contact_addresses a where a.contact_id = profile.id)
     or exists (select 1 from public.contact_tags t where t.contact_id = profile.id)
     or not exists (select 1 from public.opt_outs o
                     where o.company_id = profile.company_id and o.phone_e164 = phone and o.revoked_at is null) then
    raise exception 'Contact purge left child records or lifted opt-out';
  end if;
  if exists (select 1 from public.record_activity a
              where a.company_id = profile.company_id and a.source_type = 'contact'
                and a.source_id = profile.id and a.kind = 'edited'
                and a.payload ?| array['from', 'to']) then
    raise exception 'Contact purge left profile values in the activity history';
  end if;

  result := public.api_restore_trash(company_id, owner_id, 'contact', contact_id);
  if result->>'outcome' is distinct from 'not_found' then
    raise exception 'An erased profile could be restored';
  end if;

  update public.contacts set deleted_at = null where id = contact_id;
  select * into profile from public.contacts where id = contact_id;
  if profile.deleted_at is not null or profile.purged_at is not null or profile.name is not null then
    raise exception 'Reopening the contact did not start a clean profile';
  end if;
end;
$$;

rollback;
