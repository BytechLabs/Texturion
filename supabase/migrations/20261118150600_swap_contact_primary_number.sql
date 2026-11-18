alter table public.contacts
  add column primary_number_label text,
  add column primary_number_source_id uuid;

create function public.api_make_primary_contact_number(
  p_company_id uuid, p_contact_id uuid, p_phone_id uuid, p_actor uuid default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  contact public.contacts%rowtype;
  alternate public.contact_phones%rowtype;
begin
  perform public.lock_contact_numbers(p_company_id);
  select * into contact from public.contacts
   where id = p_contact_id and company_id = p_company_id and deleted_at is null and merged_into is null
   for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;

  delete from public.contact_phones where id = p_phone_id and company_id = p_company_id and contact_id = p_contact_id
  returning * into alternate;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;

  update public.contacts set phone_e164 = alternate.phone_e164,
    primary_number_label = alternate.label, primary_number_source_id = alternate.merged_from_contact_id,
    updated_by_user_id = coalesce(p_actor, updated_by_user_id)
   where id = p_contact_id;
  insert into public.contact_phones (company_id, contact_id, phone_e164, label, merged_from_contact_id)
  values (p_company_id, p_contact_id, contact.phone_e164, contact.primary_number_label, contact.primary_number_source_id);

  return jsonb_build_object('outcome', 'updated', 'previous_number', contact.phone_e164, 'phone_e164', alternate.phone_e164);
end;
$$;

do $migration$
declare
  edit record;
  definition text;
begin
  for edit in select * from (values
    ('public.api_unmerge_contact(uuid,uuid)', 'number_owner uuid;', 'number_owner uuid;' || E'\n  replacement_id uuid;'),
    ('public.api_unmerge_contact(uuid,uuid)',
     '  delete from public.contact_phones where company_id = p_company_id and contact_id = survivor.id',
     $unmerge$  if survivor.primary_number_source_id = p_contact_id then
    select id into replacement_id from public.contact_phones where company_id = p_company_id and contact_id = survivor.id
      and merged_from_contact_id is distinct from p_contact_id and phone_e164 <> number
    order by (merged_from_contact_id is not null), created_at, id limit 1;
    if replacement_id is null or (public.api_make_primary_contact_number(p_company_id, survivor.id, replacement_id)->>'outcome') <> 'updated' then
      return jsonb_build_object('outcome', 'replacement_number_required');
    end if;
  end if;

  delete from public.contact_phones where company_id = p_company_id and contact_id = survivor.id$unmerge$),
    ('public.transfer_contact_merge_records(uuid,uuid,uuid,text)',
     'insert into public.contact_phones (company_id, contact_id, phone_e164, merged_from_contact_id)' || E'\n'
       || '  values (p_company, p_into, p_number, p_from);',
     'insert into public.contact_phones (company_id, contact_id, phone_e164, merged_from_contact_id, label)' || E'\n'
       || '  select p_company, p_into, p_number, p_from, primary_number_label from public.contacts where id = p_from;'),
    ('public.purge_contact_from_trash(uuid,uuid,uuid)',
     'set name = null, email = null, business_name = null, address = null, notes = null,',
     'set name = null, email = null, business_name = null, address = null, notes = null,'
       || ' primary_number_label = null, primary_number_source_id = null,'),
    ('public.api_finish_customer_erasure(uuid,uuid)',
     'merged_phone_e164 = null, merge_profile_delta = null',
     'merged_phone_e164 = null, merge_profile_delta = null, primary_number_label = null, primary_number_source_id = null')
  ) as edits(signature, anchor, replacement)
  loop
    definition := pg_get_functiondef(edit.signature::regprocedure);
    if (length(definition) - length(replace(definition, edit.anchor, ''))) / length(edit.anchor) <> 1 then
      raise exception 'Primary number change anchor missing or repeated in %', edit.signature;
    end if;
    execute replace(definition, edit.anchor, edit.replacement);
  end loop;
end $migration$;

revoke execute on function public.api_make_primary_contact_number(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.api_make_primary_contact_number(uuid, uuid, uuid, uuid) to service_role;
