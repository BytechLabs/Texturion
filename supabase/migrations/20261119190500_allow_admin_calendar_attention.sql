create function public.calendar_attention_actor_allowed(
  p_company_id uuid,
  p_actor_id uuid,
  p_connection_user_id uuid
) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1
      from public.company_members actor
      join public.company_members connector on connector.company_id = actor.company_id
      join public.companies company on company.id = actor.company_id
     where actor.company_id = p_company_id
       and actor.user_id = p_actor_id and actor.deactivated_at is null
       and connector.user_id = p_connection_user_id and connector.deactivated_at is null
       and company.deleted_at is null
       and (actor.user_id = connector.user_id or actor.role in ('owner', 'admin'))
  );
$$;

revoke execute on function public.calendar_attention_actor_allowed(uuid, uuid, uuid)
  from public, anon, authenticated;

do $migration$
declare
  v_list constant regprocedure := 'public.api_list_calendar_attention(uuid,uuid,integer)'::regprocedure;
  v_detail constant regprocedure := 'public.api_get_calendar_attention(uuid,uuid,uuid)'::regprocedure;
  v_conflict constant regprocedure := 'public.api_resolve_calendar_conflict(uuid,uuid,uuid,text,text,text,timestamptz,timestamptz,text,text,text,jsonb)'::regprocedure;
  v_removed constant regprocedure := 'public.api_resolve_calendar_event_removed(uuid,uuid,uuid,text,timestamptz)'::regprocedure;
  v_observe constant regprocedure := 'public.api_observe_calendar_conflict_condition(uuid,uuid,uuid,text,jsonb,text,text,text,text,text)'::regprocedure;
  v_owner constant text := 'and c.user_id = p_user_id';
  v_actor constant text := 'and public.calendar_attention_actor_allowed(p_company_id, p_user_id, c.user_id)';
  v_access constant text := 'and public.calendar_task_access_allowed(';
  v_connector_access constant text := $sql$and t.deleted_at is null
    and public.calendar_task_access_allowed(c.user_id, t.company_id, t.conversation_id)
    $sql$;
  v_connection_lookup constant text := $sql$and user_id = p_user_id
   for update;$sql$;
  v_connection_lock constant text := $sql$and public.calendar_attention_actor_allowed(p_company_id, p_user_id, user_id)
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;$sql$;
  v_old_assignee constant text := 'tas.user_id = p_user_id';
  v_assignee constant text := 'tas.user_id = v_connection.user_id';
  v_detail_connection constant text := $sql$'connection_id', l.connection_id,$sql$;
  v_current_task constant text := $sql$where id = v_link.task_id and company_id = p_company_id
   for update;$sql$;
  v_removed_task constant text := v_current_task || $sql$
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;$sql$;
  v_live_task constant text := $sql$where id = v_link.task_id and company_id = p_company_id and deleted_at is null
   for update;
  if not found
     or not public.calendar_task_access_allowed(p_user_id, p_company_id, v_task.conversation_id)
     or not public.calendar_task_access_allowed(v_connection.user_id, p_company_id, v_task.conversation_id) then
    return jsonb_build_object('outcome', 'not_found');
  end if;$sql$;
  v_proc regprocedure;
  v_sql text;
  v_task_lookup text;
begin
  foreach v_proc in array array[v_list, v_detail, v_conflict, v_removed, v_observe] loop
    v_sql := pg_get_functiondef(v_proc);
    if strpos(v_sql, v_owner) = 0 then
      raise exception '%: calendar owner check was not found', v_proc;
    end if;
    v_sql := replace(v_sql, v_owner, v_actor);
    if v_proc <> v_observe then
      if strpos(v_sql, v_access) = 0 then
        raise exception '%: calendar task access check was not found', v_proc;
      end if;
      v_sql := replace(v_sql, v_access, v_connector_access || v_access);
    end if;
    if v_proc in (v_conflict, v_removed) then
      v_task_lookup := case when v_proc = v_removed then v_removed_task else v_current_task end;
      if strpos(v_sql, v_connection_lookup) = 0 or strpos(v_sql, v_old_assignee) = 0
         or strpos(v_sql, v_task_lookup) = 0 then
        raise exception '%: calendar resolution checks were not found', v_proc;
      end if;
      v_sql := replace(v_sql, v_connection_lookup, v_connection_lock);
      v_sql := replace(v_sql, v_old_assignee, v_assignee);
      v_sql := replace(v_sql, v_task_lookup, v_live_task);
    end if;
    if v_proc = v_detail then
      if strpos(v_sql, v_detail_connection) = 0 then
        raise exception '%: calendar connection output was not found', v_proc;
      end if;
      v_sql := replace(v_sql, v_detail_connection,
        v_detail_connection || E'\n    ''connection_user_id'', c.user_id,');
    end if;
    if v_proc = v_observe then
      if strpos(v_sql, 'or not public.calendar_task_access_allowed(') = 0 then
        raise exception '%: calendar observation access check was not found', v_proc;
      end if;
      v_sql := replace(v_sql, 'or not public.calendar_task_access_allowed(', $sql$or v_task.deleted_at is not null
     or not public.calendar_task_access_allowed(v_connection.user_id, p_company_id, v_task.conversation_id)
     or not public.calendar_task_access_allowed($sql$);
    end if;
    execute v_sql;
  end loop;
end $migration$;
