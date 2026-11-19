alter table public.task_events drop constraint task_events_kind_check;
alter table public.task_events add constraint task_events_kind_check
  check (kind in (
    'created', 'title', 'description', 'address', 'assignee', 'due',
    'reminders', 'confirmation', 'done', 'reopened', 'deleted', 'priority',
    'label_added', 'label_removed', 'repeat', 'assignee_added', 'assignee_removed',
    'link_added', 'link_removed', 'customer'));

create function public.set_task_links(
  p_company_id uuid,
  p_task_id uuid,
  p_actor_user_id uuid,
  p_contact_id uuid,
  p_conversation_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_task public.tasks;
  v_contact_id uuid := p_contact_id;
  v_before jsonb;
begin
  select * into v_task from public.tasks t
   where t.company_id = p_company_id and t.id = p_task_id and t.deleted_at is null
   for update;
  if not found
     or not public.calendar_task_access_allowed(p_actor_user_id, p_company_id, v_task.conversation_id) then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_task.message_id is not null or v_task.source_call_id is not null then
    return jsonb_build_object('outcome', 'anchored');
  end if;

  if p_conversation_id is not null then
    select c.contact_id into v_contact_id from public.conversations c
     where c.company_id = p_company_id and c.id = p_conversation_id
       and c.deleted_at is null and c.purged_at is null
     for key share;
    if not found or not public.calendar_task_access_allowed(p_actor_user_id, p_company_id, p_conversation_id) then
      return jsonb_build_object('outcome', 'no_conversation');
    end if;
    if p_contact_id is not null and p_contact_id is distinct from v_contact_id then
      return jsonb_build_object('outcome', 'contact_mismatch');
    end if;
  end if;
  if v_contact_id is not null and not exists (
    select 1 from public.contacts c
     where c.company_id = p_company_id and c.id = v_contact_id and c.deleted_at is null
  ) then
    return jsonb_build_object('outcome', 'no_contact');
  end if;
  if (v_task.contact_id, v_task.conversation_id) is not distinct from (v_contact_id, p_conversation_id) then
    return jsonb_build_object('outcome', 'unchanged', 'task', to_jsonb(v_task));
  end if;

  v_before := jsonb_build_object('contact_id', v_task.contact_id, 'conversation_id', v_task.conversation_id);
  perform set_config('loonext.task_actor', p_actor_user_id::text, true);
  update public.tasks set contact_id = v_contact_id, conversation_id = p_conversation_id, reminders_off = true
   where company_id = p_company_id and id = p_task_id
   returning * into v_task;
  update public.task_series set contact_id = v_contact_id, conversation_id = p_conversation_id
   where company_id = p_company_id and id = v_task.series_id;
  update public.scheduled_messages
     set status = 'canceled', canceled_at = now(), claimed_at = null, updated_at = now()
   where company_id = p_company_id and task_id = p_task_id and origin = 'reminder'
     and status in ('pending', 'held');
  insert into public.task_events (company_id, task_id, actor_user_id, kind, from_value, to_value)
  values (p_company_id, p_task_id, p_actor_user_id, 'customer', v_before,
    jsonb_build_object('contact_id', v_contact_id, 'conversation_id', p_conversation_id));
  return jsonb_build_object('outcome', 'updated', 'task', to_jsonb(v_task));
end;
$$;

create function public.api_set_task_confirmation(
  p_company_id uuid,
  p_task_id uuid,
  p_actor_user_id uuid,
  p_confirmed boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_task public.tasks;
begin
  select * into v_task from public.tasks t
   where t.company_id = p_company_id and t.id = p_task_id and t.deleted_at is null
   for update;
  if not found
     or not public.calendar_task_access_allowed(p_actor_user_id, p_company_id, v_task.conversation_id) then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if p_confirmed and (v_task.due_at is null or public.task_done_at(v_task) is not null) then
    return jsonb_build_object('outcome', 'unscheduled');
  end if;
  if p_confirmed = (v_task.confirmed_at is not null) then
    return jsonb_build_object('outcome', 'unchanged', 'task', to_jsonb(v_task));
  end if;
  perform set_config('loonext.task_actor', p_actor_user_id::text, true);
  update public.tasks
     set confirmed_at = case when p_confirmed then now() end,
         confirmed_by = case when p_confirmed then 'crew' end
   where company_id = p_company_id and id = p_task_id
   returning * into v_task;
  return jsonb_build_object('outcome', 'updated', 'task', to_jsonb(v_task));
end;
$$;

revoke execute on function public.set_task_links(uuid,uuid,uuid,uuid,uuid),
  public.api_set_task_confirmation(uuid,uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.set_task_links(uuid,uuid,uuid,uuid,uuid),
  public.api_set_task_confirmation(uuid,uuid,uuid,boolean) to service_role;
