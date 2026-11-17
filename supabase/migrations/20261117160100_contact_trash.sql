alter table public.contacts
  add column purged_at timestamptz;

create index contacts_trash_due_idx on public.contacts (deleted_at, id)
  where deleted_at is not null and purged_at is null and merged_into is null;

create function public.reset_contact_trash_on_reopen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.purged_at := null;
  new.deleted_by_user_id := null;
  return new;
end;
$$;

revoke execute on function public.reset_contact_trash_on_reopen() from public, anon, authenticated;

create trigger contacts_reopen_from_trash
  before update of deleted_at on public.contacts
  for each row
  when (old.deleted_at is not null and new.deleted_at is null)
  execute function public.reset_contact_trash_on_reopen();

create function public.purge_contact_from_trash(
  p_id uuid,
  p_company_id uuid,
  p_actor uuid
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  company uuid;
  activity_quiet text := current_setting('loonext.activity_quiet', true);
begin
  select c.company_id into company
    from public.contacts c
   where c.id = p_id
     and (p_company_id is null or c.company_id = p_company_id)
     and c.deleted_at is not null and c.purged_at is null and c.merged_into is null
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if public.is_on_legal_hold(company) then
    return jsonb_build_object('outcome', 'legal_hold');
  end if;

  delete from public.contact_phones where company_id = company and contact_id = p_id;
  delete from public.contact_addresses where company_id = company and contact_id = p_id;
  delete from public.contact_tags where company_id = company and contact_id = p_id;
  update public.record_activity
     set payload = payload - 'from' - 'to'
   where company_id = company and source_type = 'contact' and source_id = p_id
     and kind = 'edited' and payload ?| array['from', 'to'];
  -- Clearing the profile must not add another copy of its previous values.
  perform set_config('loonext.activity_quiet', 'on', true);
  update public.contacts
     set name = null, email = null, business_name = null, address = null, notes = null,
         custom_fields = '{}'::jsonb, timezone = null, locale = null,
         lat = null, lng = null, geocoded_at = null, geocode_status = 'no_address',
         purged_at = now()
   where id = p_id and company_id = company;
  perform set_config('loonext.activity_quiet', coalesce(activity_quiet, ''), true);

  insert into public.audit_log
    (company_id, actor_user_id, action, target_type, target_id, before, after)
  values
    (company, p_actor, 'record.purged', 'contact', p_id::text, '{}'::jsonb,
     jsonb_build_object('by', case when p_actor is null then 'trash_expiry' else 'delete_forever' end));
  return jsonb_build_object('outcome', 'purged', 'kind', 'contact', 'id', p_id, 'company_id', company);
end;
$$;

revoke execute on function public.purge_contact_from_trash(uuid, uuid, uuid)
  from public, anon, authenticated;

do $migration$
declare
  edit record;
  definition text;
  updated text;
begin
  for edit in
    select * from (values
      ('public.api_list_trash(uuid,integer,timestamptz,uuid,uuid[])',
       'with items as (',
       $list$with items as (
    select 'contact'::text as kind, c.id, c.deleted_at, c.deleted_by_user_id as deleted_by,
           jsonb_build_object('contact_name', c.name, 'contact_phone', c.phone_e164) as detail
      from public.contacts c
     where c.company_id = p_company_id and c.deleted_at is not null
       and c.purged_at is null and c.merged_into is null
    union all$list$),
      ('public.api_trash_due(integer)',
       'with due as (',
       $due$with due as (
    select 'contact'::text as kind, c.id, c.company_id, c.deleted_at as at
      from public.contacts c
     where c.deleted_at < now() - interval '30 days'
       and c.purged_at is null and c.merged_into is null
    union all$due$),
      ('public.api_restore_trash(uuid,uuid,text,uuid,uuid[])',
       $first$if p_kind = 'message' then$first$,
       $restore$if p_kind = 'contact' then
    update public.contacts set deleted_at = null
     where id = p_id and company_id = p_company_id and deleted_at is not null
       and purged_at is null and merged_into is null;
    if not found then
      return jsonb_build_object('outcome', 'not_found');
    end if;
    return jsonb_build_object('outcome', 'restored', 'kind', 'contact', 'id', p_id);
  elsif p_kind = 'message' then$restore$),
      ('public.api_purge_trash_item(text,uuid,uuid,uuid,uuid[])',
       $first$if p_kind = 'message' then$first$,
       $purge$if p_kind = 'contact' then
    return public.purge_contact_from_trash(p_id, p_company_id, p_actor);
  elsif p_kind = 'message' then$purge$),
      ('public.api_trash_object_paths(text,uuid,uuid,uuid[])',
       $first$if p_kind = 'message' then$first$,
       $paths$if p_kind = 'contact' then
    return;
  elsif p_kind = 'message' then$paths$)
    ) as edits(signature, anchor, replacement)
  loop
    definition := pg_get_functiondef(edit.signature::regprocedure);
    updated := replace(definition, edit.anchor, edit.replacement);
    if updated = definition then
      raise exception 'The contact Trash anchor changed in %', edit.signature;
    end if;
    execute updated;
  end loop;
end $migration$;

revoke execute on function
  public.api_list_trash(uuid, integer, timestamptz, uuid, uuid[]),
  public.api_trash_due(integer),
  public.api_restore_trash(uuid, uuid, text, uuid, uuid[]),
  public.api_purge_trash_item(text, uuid, uuid, uuid, uuid[]),
  public.api_trash_object_paths(text, uuid, uuid, uuid[])
  from public, anon, authenticated;

grant execute on function
  public.api_list_trash(uuid, integer, timestamptz, uuid, uuid[]),
  public.api_trash_due(integer),
  public.api_restore_trash(uuid, uuid, text, uuid, uuid[]),
  public.api_purge_trash_item(text, uuid, uuid, uuid, uuid[]),
  public.api_trash_object_paths(text, uuid, uuid, uuid[])
  to service_role;
