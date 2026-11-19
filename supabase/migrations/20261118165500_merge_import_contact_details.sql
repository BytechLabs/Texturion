create function public.api_merge_import_contact_details(
  p_company uuid, p_rows jsonb, p_replace boolean, p_may_create_tags boolean
)
returns table (contact_id uuid, kept boolean, refused_phones text[], refused_tags text[])
language plpgsql security definer set search_path = ''
as $$
declare
  entry jsonb;
  customer public.contacts%rowtype;
  detail record;
  applied jsonb;
  custom jsonb;
  next_address text;
  phone text;
  tag_name text;
  tag record;
begin
  perform public.lock_contact_numbers(p_company);
  for entry in select value from jsonb_array_elements(p_rows) order by value->>'contact_id'
  loop
    contact_id := (entry->>'contact_id')::uuid;
    select * into customer from public.contacts c
    where c.id = contact_id and c.company_id = p_company and c.deleted_at is null
      and c.merged_into is null for update;
    if not found then continue; end if;

    kept := false;
    refused_phones := '{}';
    refused_tags := '{}';
    applied := '{}'::jsonb;
    for detail in
      select key, value from jsonb_each_text(coalesce(entry->'profile', '{}'))
      where key in ('name', 'address', 'notes', 'email', 'business_name')
        and nullif(btrim(value), '') is not null
    loop
      if not p_replace and nullif(btrim(to_jsonb(customer)->>detail.key), '') is not null then
        kept := kept or (to_jsonb(customer)->>detail.key is distinct from detail.value);
      else
        applied := applied || jsonb_build_object(detail.key, detail.value);
      end if;
    end loop;

    custom := coalesce(entry->'profile'->'custom_fields', '{}');
    if not p_replace and exists (
      select from jsonb_each_text(custom) incoming
      where customer.custom_fields ? incoming.key
        and customer.custom_fields->>incoming.key is distinct from incoming.value
    ) then
      kept := true;
    end if;
    custom := case when p_replace then customer.custom_fields || custom else custom || customer.custom_fields end;
    next_address := coalesce(applied->>'address', customer.address);
    if applied <> '{}'::jsonb or custom is distinct from customer.custom_fields then
      update public.contacts c set
        name = coalesce(applied->>'name', c.name),
        address = next_address,
        notes = coalesce(applied->>'notes', c.notes),
        email = coalesce(applied->>'email', c.email),
        business_name = coalesce(applied->>'business_name', c.business_name),
        custom_fields = custom,
        lat = case when next_address is distinct from c.address then null else c.lat end,
        lng = case when next_address is distinct from c.address then null else c.lng end,
        geocoded_at = case when next_address is distinct from c.address then null else c.geocoded_at end,
        geocode_status = case when next_address is distinct from c.address then 'pending' else c.geocode_status end
      where c.id = contact_id and c.company_id = p_company;
    end if;

    for phone in select distinct value from jsonb_array_elements_text(coalesce(entry->'other_phones', '[]')) order by value
    loop
      if phone = customer.phone_e164 or exists (
        select from public.contact_phones cp where cp.contact_id = customer.id and cp.phone_e164 = phone
      ) then continue; end if;
      if (select count(*) from public.contact_phones cp where cp.contact_id = customer.id) >= 8 then
        refused_phones := array_append(refused_phones, phone);
        continue;
      end if;
      begin
        insert into public.contact_phones (company_id, contact_id, phone_e164)
        values (p_company, customer.id, phone);
      exception when unique_violation then
        refused_phones := array_append(refused_phones, phone);
      end;
    end loop;

    for tag_name in select distinct value from jsonb_array_elements_text(coalesce(entry->'tags', '[]')) order by value
    loop
      select * into tag from public.api_find_or_create_tag(p_company, tag_name, p_may_create_tags);
      if tag.id is null or tag.refused then
        refused_tags := array_append(refused_tags, tag_name);
      else
        insert into public.contact_tags (company_id, contact_id, tag_id)
        values (p_company, customer.id, tag.id)
        on conflict do nothing;
      end if;
    end loop;
    return next;
  end loop;
end;
$$;

revoke execute on function public.api_merge_import_contact_details(uuid, jsonb, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.api_merge_import_contact_details(uuid, jsonb, boolean, boolean)
  to service_role;
