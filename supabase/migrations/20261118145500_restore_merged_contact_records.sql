alter table public.contacts
  alter column phone_e164 drop not null,
  add column merged_phone_e164 text,
  add column merge_profile_delta jsonb,
  add constraint contacts_live_phone_check check (phone_e164 is not null or merged_into is not null);

alter table public.contact_phones
  add column merged_from_contact_id uuid;

alter table public.contact_addresses
  add column merged_from_address_id uuid;

create index contact_phones_merge_source_idx on public.contact_phones (company_id, merged_from_contact_id)
  where merged_from_contact_id is not null;

create index contact_addresses_merge_source_idx on public.contact_addresses (company_id, merged_from_address_id)
  where merged_from_address_id is not null;

create function public.lock_contact_numbers(p_company_id uuid)
returns void
language sql set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('contact numbers ' || p_company_id::text, 0));
$$;

create function public.contact_owning_number(p_company_id uuid, p_phone_e164 text)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select public.live_contact_id(cp.contact_id) from public.contact_phones cp
     where cp.company_id = p_company_id and cp.phone_e164 = p_phone_e164),
    (select public.live_contact_id(c.id) from public.contacts c
     where c.company_id = p_company_id and c.phone_e164 = p_phone_e164)
  );
$$;

create function public.api_contact_number_owners(p_company_id uuid, p_numbers text[])
returns table (requested_number text, id uuid, phone_e164 text, name text, deleted_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select requested.phone, c.id, c.phone_e164, c.name, c.deleted_at
    from unnest(p_numbers) requested(phone)
    join public.contacts c on c.id = public.contact_owning_number(p_company_id, requested.phone)
   where c.company_id = p_company_id;
$$;

create function public.reject_duplicate_contact_number()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  owner uuid;
begin
  if new.phone_e164 is null then return new; end if;
  if tg_op = 'UPDATE' and new.phone_e164 = old.phone_e164 and new.company_id = old.company_id then
    return new;
  end if;
  perform public.lock_contact_numbers(new.company_id);
  if tg_table_name = 'contacts' then
    select cp.contact_id into owner from public.contact_phones cp
     where cp.company_id = new.company_id and cp.phone_e164 = new.phone_e164;
  else
    select c.id into owner from public.contacts c
     where c.company_id = new.company_id and c.phone_e164 = new.phone_e164;
  end if;
  if owner is not null then
    raise unique_violation using message = 'Number is already assigned to a contact',
      detail = public.live_contact_id(owner)::text;
  end if;
  return new;
end;
$$;

create trigger contacts_number_owner
  before insert or update of company_id, phone_e164 on public.contacts
  for each row execute function public.reject_duplicate_contact_number();

create trigger contact_phones_number_owner
  before insert or update of company_id, phone_e164 on public.contact_phones
  for each row execute function public.reject_duplicate_contact_number();

create function public.transfer_contact_merge_records(p_company uuid, p_from uuid, p_into uuid, p_number text)
returns void
language plpgsql set search_path = ''
as $$
begin
  update public.contact_phones set contact_id = p_into, merged_from_contact_id = p_from
   where company_id = p_company and contact_id = p_from;

  insert into public.contact_phones (company_id, contact_id, phone_e164, merged_from_contact_id)
  values (p_company, p_into, p_number, p_from);

  insert into public.contact_addresses (company_id, contact_id, label, address, is_primary, merged_from_address_id)
  select distinct on (lower(btrim(source.address))) p_company, p_into, source.label, source.address, false, source.id
    from public.contact_addresses source
   where source.company_id = p_company and source.contact_id = p_from
     and not exists (select 1 from public.contact_addresses kept
                     where kept.company_id = p_company and kept.contact_id = p_into
                       and lower(btrim(kept.address)) = lower(btrim(source.address)))
   order by lower(btrim(source.address)), source.is_primary desc, source.id;
end;
$$;

create function public.contact_merge_profile(p_contact jsonb)
returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_object_agg(entry.key, entry.value)
    from jsonb_each(p_contact) entry
   where entry.key in ('name', 'address', 'notes', 'email', 'business_name', 'timezone', 'locale', 'custom_fields');
$$;

create function public.undo_contact_merge_profile(p_before jsonb, p_merged jsonb, p_current jsonb)
returns jsonb
language sql immutable set search_path = ''
as $$
  select coalesce(jsonb_object_agg(entry.key,
    case when p_current->entry.key is not distinct from p_merged->entry.key then p_before->entry.key
         else p_current->entry.key end), '{}'::jsonb)
    from jsonb_each(p_current) entry
   where p_before ? entry.key or p_current->entry.key is distinct from p_merged->entry.key;
$$;

create or replace function public.api_unmerge_contact(p_company_id uuid, p_contact_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  source public.contacts%rowtype;
  survivor public.contacts%rowtype;
  before_merge jsonb;
  after_merge jsonb;
  profile jsonb;
  restored public.contacts%rowtype;
  number text;
  number_owner uuid;
begin
  perform public.lock_contact_numbers(p_company_id);
  select * into source from public.contacts where id = p_contact_id and company_id = p_company_id for update;
  if not found or source.purged_at is not null or public.customer_erasure_pending(p_contact_id) then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if source.merged_into is null then return jsonb_build_object('outcome', 'not_merged'); end if;

  select * into survivor from public.contacts where id = source.merged_into and company_id = p_company_id for update;
  if not found or survivor.purged_at is not null then return jsonb_build_object('outcome', 'not_found'); end if;
  number := coalesce(source.merged_phone_e164, source.phone_e164);
  number_owner := public.contact_owning_number(p_company_id, number);
  if number_owner is not null and number_owner <> survivor.id then
    return jsonb_build_object('outcome', 'number_taken', 'existing_contact_id', number_owner);
  end if;

  delete from public.contact_phones where company_id = p_company_id and contact_id = survivor.id
    and phone_e164 = number;
  update public.contact_phones set contact_id = p_contact_id, merged_from_contact_id = null
   where company_id = p_company_id and contact_id = survivor.id and merged_from_contact_id = p_contact_id;
  delete from public.contact_addresses copied using public.contact_addresses original
   where copied.company_id = p_company_id and copied.contact_id = survivor.id and copied.merged_from_address_id = original.id
     and original.company_id = p_company_id and original.contact_id = p_contact_id
     and copied.address = original.address and copied.label is not distinct from original.label and not copied.is_primary;
  update public.contact_addresses copied set merged_from_address_id = null
   where copied.company_id = p_company_id and copied.contact_id = survivor.id and copied.merged_from_address_id in (
     select original.id from public.contact_addresses original where original.company_id = p_company_id and original.contact_id = p_contact_id
   );

  if source.merge_profile_delta is not null then
    before_merge := source.merge_profile_delta -> 'before';
    after_merge := source.merge_profile_delta -> 'after';
    profile := public.undo_contact_merge_profile(before_merge, after_merge, public.contact_merge_profile(to_jsonb(survivor)));
    restored := jsonb_populate_record(null::public.contacts, profile);
    update public.contacts set name = restored.name, address = restored.address, notes = restored.notes,
      email = restored.email, business_name = restored.business_name, timezone = restored.timezone, locale = restored.locale,
      custom_fields = public.undo_contact_merge_profile(before_merge->'custom_fields', after_merge->'custom_fields', survivor.custom_fields)
     where id = survivor.id;
  end if;

  update public.contacts set phone_e164 = number, merged_phone_e164 = null, merge_profile_delta = null,
    merged_into = null, merged_at = null, merged_by = null, updated_at = now()
   where id = p_contact_id;
  return jsonb_build_object('outcome', 'unmerged', 'phone', number);
end;
$$;

do $migration$
declare
  edit record;
  definition text;
begin
  for edit in select * from (values
    ('public.api_merge_contacts(uuid,uuid,uuid,uuid)',
     'v_conv      record;',
     'v_conv      record;' || E'\n  v_saved     public.contacts;'),
    ('public.api_merge_contacts(uuid,uuid,uuid,uuid)',
     '  select * into v_from from public.contacts',
     $lock$  perform public.lock_contact_numbers(p_company_id);
  perform 1 from public.contacts where company_id = p_company_id and id in (p_from, p_into) order by id for update;
  select * into v_from from public.contacts$lock$),
    ('public.api_merge_contacts(uuid,uuid,uuid,uuid)',
     'if v_from.id is null or v_into.id is null then',
     'if v_from.id is null or v_into.id is null or v_from.deleted_at is not null or v_into.deleted_at is not null then'),
    ('public.api_merge_contacts(uuid,uuid,uuid,uuid)',
     'if v_from.merged_into is not null or v_into.merged_into is not null then',
     $chain$if v_from.merged_into is not null or v_into.merged_into is not null or exists (
    select 1 from public.contacts where company_id = p_company_id and merged_into = p_from
  ) then$chain$),
    ('public.api_merge_contacts(uuid,uuid,uuid,uuid)',
     'set merged_into = p_into,',
     $source$set merged_into = p_into, phone_e164 = null, merged_phone_e164 = v_from.phone_e164,$source$),
    ('public.api_merge_contacts(uuid,uuid,uuid,uuid)',
     'consent_source = coalesce(consent_source, v_from.consent_source),',
     $profile$email = coalesce(email, v_from.email),
         business_name = coalesce(business_name, v_from.business_name),
         timezone = coalesce(timezone, v_from.timezone),
         locale = coalesce(locale, v_from.locale),
         custom_fields = v_from.custom_fields || custom_fields,
         consent_source = coalesce(consent_source, v_from.consent_source),$profile$),
    ('public.api_merge_contacts(uuid,uuid,uuid,uuid)',
     '   where id = p_into;',
     $transfer$   where id = p_into returning * into v_saved;

  perform public.transfer_contact_merge_records(p_company_id, p_from, p_into, v_from.phone_e164);
  update public.contacts set merge_profile_delta = jsonb_build_object(
    'before', public.contact_merge_profile(to_jsonb(v_into)), 'after', public.contact_merge_profile(to_jsonb(v_saved))
  ) where id = p_from;$transfer$),
    ('public.api_finish_customer_erasure(uuid,uuid)',
     'geocode_status = ''no_address'', deleted_at = coalesce(deleted_at, completed), purged_at = completed',
     'geocode_status = ''no_address'', deleted_at = coalesce(deleted_at, completed), purged_at = completed,'
       || ' merged_phone_e164 = null, merge_profile_delta = null'),
    ('public.customer_erasure_numbers(uuid,uuid)',
     'select phone_e164 from public.contacts where company_id = p_company',
     'select phone_e164 from public.contacts where company_id = p_company and phone_e164 is not null')
  ) as edits(signature, anchor, replacement)
  loop
    definition := pg_get_functiondef(edit.signature::regprocedure);
    if (length(definition) - length(replace(definition, edit.anchor, ''))) / length(edit.anchor) <> 1 then
      raise exception 'Contact merge anchor missing or repeated in %', edit.signature;
    end if;
    execute replace(definition, edit.anchor, edit.replacement);
  end loop;
end $migration$;

revoke execute on function public.lock_contact_numbers(uuid), public.reject_duplicate_contact_number(),
  public.transfer_contact_merge_records(uuid, uuid, uuid, text), public.contact_merge_profile(jsonb),
  public.undo_contact_merge_profile(jsonb, jsonb, jsonb) from public, anon, authenticated, service_role;

revoke execute on function public.contact_owning_number(uuid, text), public.api_contact_number_owners(uuid, text[]),
  public.api_merge_contacts(uuid, uuid, uuid, uuid),
  public.api_unmerge_contact(uuid, uuid) from public, anon, authenticated;

grant execute on function public.contact_owning_number(uuid, text), public.api_contact_number_owners(uuid, text[]),
  public.api_merge_contacts(uuid, uuid, uuid, uuid),
  public.api_unmerge_contact(uuid, uuid) to service_role;
