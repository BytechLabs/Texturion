alter table public.alert_escalations add column call_session_id text;

create or replace function public.create_task(
  p_company_id       uuid,
  p_message_id       uuid,
  p_title            text,
  p_description      text,
  p_assigned_user_id uuid,
  p_due_at           timestamptz,
  p_actor_user_id    uuid,
  p_addr_street      text default null,
  p_addr_unit        text default null,
  p_addr_city        text default null,
  p_addr_state       text default null,
  p_addr_postal_code text default null,
  p_addr_country     text default null,
  p_addr_provenance  text default null,
  p_call_id          uuid default null,
  p_contact_id       uuid default null,
  p_conversation_id  uuid default null,
  p_priority         text default 'normal',
  p_assignee_ids     uuid[] default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation_id uuid;
  v_contact_id      uuid;
  v_body            text;
  v_direction       text;
  v_title           text;
  v_has_address     boolean;
  v_provenance      text;
  v_task            public.tasks%rowtype;
  v_call            record;
  v_standalone      boolean := p_message_id is null and p_call_id is null;
  v_assignees       uuid[];
begin
  if coalesce(p_priority, 'normal') not in ('none', 'low', 'normal', 'high', 'urgent') then
    return jsonb_build_object('outcome', 'bad_priority', 'task', null);
  end if;

  -- At most one source: a message, a call, or none (a standalone task).
  if p_message_id is not null and p_call_id is not null then
    return jsonb_build_object('outcome', 'no_source', 'task', null);
  end if;

  -- A contact or conversation link belongs to a standalone task only; a message
  -- or call task already has its conversation.
  if not v_standalone
     and (p_contact_id is not null or p_conversation_id is not null) then
    return jsonb_build_object('outcome', 'bad_link', 'task', null);
  end if;

  if p_message_id is not null then
    select m.conversation_id, m.body, m.direction
      into v_conversation_id, v_body, v_direction
      from public.messages m
     where m.company_id = p_company_id
       and m.id = p_message_id;
    if not found then
      return jsonb_build_object('outcome', 'no_message', 'task', null);
    end if;
  elsif p_call_id is not null then
    select k.conversation_id, k.outcome, k.voicemail_path, k.voicemail_deleted_at,
           coalesce(nullif(k.caller_name, ''), nullif(ct.name, ''), k.caller_e164) as who
      into v_call
      from public.calls k
      left join public.contacts ct on ct.id = k.contact_id
     where k.company_id = p_company_id
       and k.id = p_call_id
       and k.deleted_at is null
       and k.purged_at is null
       for share of k;
    if not found then
      return jsonb_build_object('outcome', 'no_call', 'task', null);
    end if;
    if v_call.outcome is distinct from 'answered'
       and (v_call.outcome is distinct from 'voicemail'
         or v_call.voicemail_path is null or v_call.voicemail_deleted_at is not null) then
      return jsonb_build_object('outcome', 'call_not_answered', 'task', null);
    end if;
    if v_call.conversation_id is null then
      return jsonb_build_object('outcome', 'call_no_conversation', 'task', null);
    end if;
    v_conversation_id := v_call.conversation_id;
    v_body := 'Call from ' || coalesce(v_call.who, 'unknown caller');
  else
    -- Standalone: only the title is required. A conversation, when given, must
    -- be this company's and fixes the contact; a contact alone must be live.
    if nullif(btrim(coalesce(p_title, '')), '') is null then
      return jsonb_build_object('outcome', 'title_required', 'task', null);
    end if;
    if p_conversation_id is not null then
      select c.id, c.contact_id
        into v_conversation_id, v_contact_id
        from public.conversations c
       where c.company_id = p_company_id
         and c.id = p_conversation_id;
      if not found then
        return jsonb_build_object('outcome', 'no_conversation', 'task', null);
      end if;
      if p_contact_id is not null and p_contact_id is distinct from v_contact_id then
        return jsonb_build_object('outcome', 'contact_mismatch', 'task', null);
      end if;
    elsif p_contact_id is not null then
      perform 1
        from public.contacts ct
       where ct.company_id = p_company_id
         and ct.id = p_contact_id
         and ct.deleted_at is null;
      if not found then
        return jsonb_build_object('outcome', 'no_contact', 'task', null);
      end if;
      v_contact_id := p_contact_id;
    end if;
  end if;

  -- Every assignee must be an active member of the company (validation_failed),
  -- and a task holds at most ten.
  v_assignees := public.task_assignee_list(
    case when p_assignee_ids is not null then p_assignee_ids
         when p_assigned_user_id is not null then array[p_assigned_user_id]
         else '{}'::uuid[] end);
  if cardinality(v_assignees) > 10 then
    return jsonb_build_object('outcome', 'too_many', 'task', null);
  end if;
  if exists (
    select 1 from unnest(v_assignees) u
     where not exists (select 1 from public.company_members cm where cm.company_id = p_company_id and cm.user_id = u and cm.deactivated_at is null)) then
    return jsonb_build_object('outcome', 'not_member', 'task', null);
  end if;

  v_title := coalesce(
    nullif(btrim(coalesce(p_title, '')), ''),
    left(nullif(trim(regexp_replace(coalesce(v_body, ''), '\s+', ' ', 'g')), ''), 500),
    'Task');

  v_has_address := coalesce(
    p_addr_street, p_addr_unit, p_addr_city, p_addr_state,
    p_addr_postal_code, p_addr_country) is not null;
  v_provenance := case when v_has_address then p_addr_provenance else null end;

  begin
    insert into public.tasks
      (company_id, message_id, source_call_id, conversation_id, contact_id,
       title, description, due_at, created_by_user_id,
       addr_street, addr_unit, addr_city, addr_state, addr_postal_code,
       addr_country, addr_provenance, reminders_off, priority)
    values
      (p_company_id, p_message_id, p_call_id, v_conversation_id, v_contact_id,
       v_title, coalesce(p_description, ''), p_due_at,
       p_actor_user_id,
       p_addr_street, p_addr_unit, p_addr_city, p_addr_state,
       p_addr_postal_code, p_addr_country, v_provenance,
       -- No thread to text the reminder into.
       v_conversation_id is null,
       coalesce(p_priority, 'normal'))
    returning * into v_task;
  exception when unique_violation then
    -- A second live promotion of the same message or call.
    return jsonb_build_object('outcome', 'conflict', 'task', null);
  end;

  -- #689 C: the crew goes into task_assignees, which keeps tasks.assigned_user_id
  -- as the first of them. Quiet, because creating the task already says so.
  if cardinality(v_assignees) > 0 then
    perform set_config('loonext.task_assignees_quiet', 'on', true);
    perform public.task_set_assignees(v_task.id, v_assignees, p_actor_user_id);
    perform set_config('loonext.task_assignees_quiet', '', true);
    select * into v_task from public.tasks t where t.id = v_task.id;
  end if;

  -- attach_fixes [#2]: link the SOURCE note back to the new task.
  if v_direction = 'note' then
    update public.messages
       set task_id = v_task.id
     where id = p_message_id
       and task_id is null;
  end if;

  -- T2.1 audit: one task_created row on the task's conversation, same txn. A
  -- standalone task with no conversation has no thread to write to.
  if v_conversation_id is not null then
    insert into public.conversation_events
      (company_id, conversation_id, actor_user_id, type, payload)
    values
      (p_company_id, v_conversation_id, p_actor_user_id, 'task_created',
       case when p_message_id is not null
            then jsonb_build_object('task_id', v_task.id, 'message_id', p_message_id)
            when p_call_id is not null
            then jsonb_build_object('task_id', v_task.id, 'call_id', p_call_id)
            else jsonb_build_object('task_id', v_task.id)
       end);
  end if;

  return jsonb_build_object('outcome', 'created', 'task', to_jsonb(v_task));
end $$;
