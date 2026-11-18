alter table public.tasks add column purged_at timestamptz;

create index tasks_trash_due_idx on public.tasks (deleted_at, id)
  where deleted_at is not null and purged_at is null
    and trashed_with_conversation_at is null;

create index task_comments_trash_due_idx on public.task_comments (deleted_at, id)
  where deleted_at is not null;

create function public.expired_task_attachments(
  p_company_id uuid, p_kind text, p_id uuid
) returns setof uuid
language sql
stable
set search_path = ''
as $$
  select a.id
    from public.attachments a
   where a.company_id = p_company_id
     and ((p_kind = 'task' and a.owner_type = 'task' and a.owner_id = p_id)
       or (a.owner_type = 'task_comment' and (
         (p_kind = 'task_comment' and a.owner_id = p_id)
         or (p_kind = 'task' and exists (
           select 1 from public.task_comments c
            where c.company_id = p_company_id and c.task_id = p_id and c.id = a.owner_id
         ))
       )));
$$;

create function public.purge_expired_task(p_kind text, p_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  company uuid;
  cutoff timestamptz := now() - interval '30 days';
begin
  if p_kind = 'task' then
    select t.company_id into company from public.tasks t
     where t.id = p_id and t.deleted_at < cutoff and t.purged_at is null
       and t.trashed_with_conversation_at is null
     for update;
  else
    perform 1 from public.tasks t
      join public.task_comments c on c.company_id = t.company_id and c.task_id = t.id
     where c.id = p_id and c.deleted_at < cutoff
     for update of t;
    select c.company_id into company from public.task_comments c
     where c.id = p_id and c.deleted_at < cutoff
     for update;
  end if;
  if company is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  perform 1 from public.companies where id = company and deleted_at is null for share;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if public.is_on_legal_hold(company) then
    return jsonb_build_object('outcome', 'legal_hold');
  end if;

  delete from public.attachments a where a.id in (
    select public.expired_task_attachments(company, p_kind, p_id)
  );
  if p_kind = 'task' then
    update public.tasks
       set title = 'Removed', description = '',
           addr_street = null, addr_unit = null, addr_city = null, addr_state = null,
           addr_postal_code = null, addr_country = null, addr_provenance = null,
           lat = null, lng = null, geocoded_at = null, geocode_status = 'no_address',
           purged_at = now()
     where id = p_id and company_id = company;
    update public.task_events set from_value = null, to_value = null
     where company_id = company and task_id = p_id
       and kind in ('created', 'title', 'description', 'address');
    update public.record_activity set payload = '{}'::jsonb
     where company_id = company and source_type = 'task' and source_id = p_id;
    delete from public.record_references
     where company_id = company and source_task_id = p_id;
    delete from public.task_comments where company_id = company and task_id = p_id;
  else
    delete from public.record_references
     where company_id = company and source_kind = 'task_comment' and source_id = p_id;
    delete from public.task_comments where company_id = company and id = p_id;
  end if;

  insert into public.audit_log
    (company_id, action, target_type, target_id, before, after)
  values (company, 'record.purged', p_kind, p_id::text, '{}', '{"by":"trash_expiry"}');

  return jsonb_build_object(
    'outcome', 'purged', 'kind', p_kind, 'id', p_id, 'company_id', company
  );
end;
$$;

revoke execute on function
  public.expired_task_attachments(uuid, text, uuid),
  public.purge_expired_task(text, uuid)
  from public, anon, authenticated, service_role;

do $migration$
declare
  edit record;
  definition text;
  updated text;
begin
  for edit in select * from (values
    ('public.api_trash_due(integer)',
     'with due as (',
     $due$with due as (
    select 'task'::text as kind, t.id, t.company_id, t.deleted_at as at
      from public.tasks t
     where t.deleted_at < now() - interval '30 days' and t.purged_at is null
       and t.trashed_with_conversation_at is null
    union all
    select 'task_comment', c.id, c.company_id, c.deleted_at
      from public.task_comments c
      join public.tasks t on t.id = c.task_id and t.company_id = c.company_id
     where c.deleted_at < now() - interval '30 days'
       and (t.deleted_at is null or t.deleted_at >= now() - interval '30 days')
    union all$due$),
    ('public.api_trash_object_paths(text,uuid,uuid,uuid[])',
     $first$if p_kind = 'contact' then$first$,
     $paths$if p_kind in ('task', 'task_comment') then
    if p_company_id is not null or p_hidden_number_ids is not null then return; end if;
    if p_kind = 'task' then
      select t.company_id into v_company from public.tasks t
       where t.id = p_id and t.deleted_at < now() - interval '30 days'
         and t.purged_at is null and t.trashed_with_conversation_at is null;
    else
      select c.company_id into v_company from public.task_comments c
       where c.id = p_id and c.deleted_at < now() - interval '30 days';
    end if;
    if v_company is null or public.is_on_legal_hold(v_company)
       or not exists (select 1 from public.companies where id = v_company and deleted_at is null)
    then return; end if;

    select array(select public.expired_task_attachments(v_company, p_kind, p_id)) into v_att;
    return query
      select distinct 'attachments'::text, paths.path
        from public.attachments a
        cross join lateral (values (a.storage_path), (a.preview_path)) paths(path)
       where a.id = any (v_att) and paths.path is not null
         and not exists (
           select 1 from public.attachments other
            where other.company_id = v_company and not (other.id = any (v_att))
              and (other.storage_path = paths.path or other.preview_path = paths.path)
         );
    return;
  elsif p_kind = 'contact' then$paths$),
    ('public.api_purge_trash_item(text,uuid,uuid,uuid,uuid[])',
     $first$if p_kind = 'contact' then$first$,
     $purge$if p_kind in ('task', 'task_comment') then
    if p_actor is not null or p_company_id is not null or p_hidden_number_ids is not null then
      return jsonb_build_object('outcome', 'not_found');
    end if;
    return public.purge_expired_task(p_kind, p_id);
  elsif p_kind = 'contact' then$purge$)
  ) as edits(signature, anchor, replacement)
  loop
    definition := pg_get_functiondef(edit.signature::regprocedure);
    updated := replace(definition, edit.anchor, edit.replacement);
    if updated = definition then
      raise exception 'Task expiry anchor missing from %', edit.signature;
    end if;
    execute updated;
  end loop;
end $migration$;
