do $migration$
declare
  v_paths text := pg_get_functiondef('public.api_trash_object_paths(text,uuid,uuid,uuid[])'::regprocedure);
  v_purge text := pg_get_functiondef('public.api_purge_trash_item(text,uuid,uuid,uuid,uuid[])'::regprocedure);
  v_path_message constant text := 't.message_id = any (v_msgs)';
  v_path_call constant text := 't.source_call_id = any (v_calls)';
  v_path_filter constant text := $sql$ and (p_kind = 'conversation' or t.trashed_with_source_at is not null)$sql$;
  v_message_source constant text := 'from public.messages m where m.id = p_id;';
  v_conversation_source constant text := 'from public.conversations c where c.id = p_id;';
  v_call_source constant text := 'select k.company_id into v_company from public.calls k where k.id = p_id;';
  v_purge_anchor constant text := '  -- Files made from the content. Same selection as api_trash_object_paths.';
  v_detach constant text := $sql$
  if p_kind in ('message', 'call') then
    with surviving as (
      select t.id,
             case when t.message_id is null then t.done_at else m.done_at end as done_at,
             case when t.message_id is null then t.done_by_user_id else m.done_by_user_id end as done_by,
             concat(case when c.locale = 'fr-CA' then 'Travail' else 'Job' end, ' #', t.number) as label
        from public.tasks t
        join public.companies c on c.id = t.company_id
        left join public.messages m on (m.company_id, m.id) = (t.company_id, t.message_id)
       where t.company_id = v_company and t.trashed_with_source_at is null and t.purged_at is null
         and (t.message_id = any (v_msgs) or t.source_call_id = any (v_calls))
       for update of t
    ), detached as (
      update public.tasks t
         set message_id = null, source_call_id = null,
             done_at = surviving.done_at, done_by_user_id = surviving.done_by,
             title = surviving.label, description = '',
             addr_street = null, addr_unit = null, addr_city = null,
             addr_state = null, addr_postal_code = null, addr_country = null,
             addr_provenance = null, lat = null, lng = null, geocoded_at = null,
             geocode_status = 'no_address', reminders_off = true
        from surviving where t.id = surviving.id
      returning t.id
    )
    select coalesce(array_agg(id), '{}') into v_kept_tasks from detached;

    update public.scheduled_messages s
       set status = 'canceled', canceled_at = now(), claimed_at = null, updated_at = now()
     where s.company_id = v_company and s.task_id = any (v_kept_tasks)
       and s.origin = 'reminder' and s.status in ('pending', 'held');
    update public.task_events
       set from_value = null, to_value = null
     where company_id = v_company and task_id = any (v_kept_tasks)
       and kind in ('created', 'title', 'description', 'address');
  end if;

$sql$;
begin
  if strpos(v_paths, v_path_message) = 0 or strpos(v_paths, v_path_call) = 0
     or strpos(v_paths, v_message_source) = 0 or strpos(v_paths, v_conversation_source) = 0
     or strpos(v_paths, v_call_source) = 0 then
    raise exception 'api_trash_object_paths: source lookup was not found';
  end if;
  v_paths := replace(v_paths, v_path_message, '(' || v_path_message || v_path_filter || ')');
  v_paths := replace(v_paths, v_path_call, '(' || v_path_call || v_path_filter || ')');
  v_paths := replace(v_paths, v_message_source,
    replace(v_message_source, ';', ' and m.deleted_at is not null and m.purged_at is null;'));
  v_paths := replace(v_paths, v_conversation_source,
    replace(v_conversation_source, ';', ' and c.deleted_at is not null and c.purged_at is null;'));
  v_paths := replace(v_paths, v_call_source, $sql$select k.company_id into v_company from public.calls k
     where k.id = p_id and ((p_kind = 'call' and k.deleted_at is not null and k.purged_at is null)
       or (p_kind = 'voicemail' and k.voicemail_deleted_at is not null and k.deleted_at is null));$sql$);
  execute v_paths;

  if strpos(v_purge, v_purge_anchor) = 0 or strpos(v_purge, '  v_vm_only boolean := false;') = 0 then
    raise exception 'api_purge_trash_item: job selection was not found';
  end if;
  v_purge := replace(v_purge, '  v_vm_only boolean := false;',
    E'  v_kept_tasks uuid[];\n  v_vm_only boolean := false;');
  execute replace(v_purge, v_purge_anchor, v_detach || v_purge_anchor);
end $migration$;

create or replace function public.task_series_task_done_trigger()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.task_done_at(old) is null then
    perform public.task_series_on_done(new);
  end if;
  return null;
end;
$$;