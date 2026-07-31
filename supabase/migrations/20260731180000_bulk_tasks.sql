-- #478 — bulk actions on tasks.
--
-- #275 shipped this for conversations. Tasks are NOT a parameterisation of that
-- function, and the reason is worth stating because it is the whole design:
--
-- THERE IS NO TASK STATUS COLUMN. Completion is derived from the joined
-- `messages.done_at` (T2), so "mark 40 tasks done" is really "mark 40 MESSAGES
-- done" — and the single-row primitive for that, `set_message_done`, exists
-- precisely because the flip and its audit event must be ONE transaction
-- (D14/D22). A bulk version therefore has to write N flips and N audit events
-- atomically, which `api_bulk_conversations` never had to do. A bulk done that
-- half-records is worse than none: the tasks look finished and the timeline
-- cannot say who finished them.
--
-- IDS ARE ALWAYS EXPLICIT, AND THAT IS DELIBERATE. `api_bulk_conversations`
-- takes the list filters and re-expresses them in SQL. The task list's filters
-- are built in TypeScript against a view (status, overdue, due window,
-- has_location, conversation, assignee, q), so re-expressing them here would
-- create a second implementation that has to agree with the first forever. It
-- would not: the two would drift the first time somebody added a filter to one.
--
-- So the Worker resolves the ids with the SAME query builder the list uses and
-- hands them here. "Select all matching the filter" is then true by
-- construction rather than by two implementations agreeing, and this function
-- has one job: apply an action to a set of ids, atomically, and say honestly
-- what happened to each.
--
-- Returns { action, matched, applied: [{id, previous}], failed: [{id, reason}],
-- capped } — the same contract as the conversations version, so the clients'
-- existing result-message code reads both without a second shape.

create or replace function public.api_bulk_task_cap()
returns int language sql immutable as $$ select 500 $$;

comment on function public.api_bulk_task_cap() is
  '#478: max tasks one api_bulk_tasks call may touch. A function rather than a '
  'literal so the Worker and the SQL suite read the same number.';

create or replace function public.api_bulk_tasks(
  p_company_id     uuid,
  p_user_id        uuid,
  p_action         text,
  p_ids            uuid[],
  -- The assign target. NULL is legitimate (unassign) and is why the action has
  -- to be named separately from the value.
  p_target_user_id uuid    default null,
  -- #106: numbers this actor may not see. Their tasks are refused by id rather
  -- than silently skipped — a caller that asked about a task it cannot see gets
  -- told, and the count it renders stays true.
  p_hidden_number_ids uuid[] default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap      int := public.api_bulk_task_cap();
  v_matched  int := 0;
  v_selected uuid[];
  v_applied  jsonb := '[]'::jsonb;
  v_failed   jsonb := '[]'::jsonb;
  v_now      timestamptz := now();
  v_row      record;
begin
  if p_action is null or p_action not in ('mark_done', 'mark_undone', 'assign', 'delete') then
    return jsonb_build_object('error', 'validation_failed');
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    return jsonb_build_object('error', 'validation_failed');
  end if;

  -- NOTHING HERE CAN SEND A MESSAGE, and the enum above is what guarantees it.
  -- #275 established that rule at the route AND in SQL; a new bulk surface that
  -- only enforced it in TypeScript would be one route handler away from
  -- texting a customer list.

  -- Resolve ONCE, and intersect the caller's ids with what they may actually
  -- see. An id the caller was not entitled to comes back as `failed`, never
  -- silently applied and never silently dropped.
  select count(*)::int,
         (array_agg(t.id order by t.id))[1:v_cap]
    into v_matched, v_selected
    from public.tasks t
    left join public.conversations c on c.id = t.conversation_id
   where t.company_id = p_company_id
     and t.deleted_at is null
     and t.id = any(p_ids)
     and (
       p_hidden_number_ids is null
       or array_length(p_hidden_number_ids, 1) is null
       -- A task whose conversation has no number cannot be hidden BY number,
       -- so it stays visible. `tasks.conversation_id` is nullable.
       or c.phone_number_id is null
       or not (c.phone_number_id = any(p_hidden_number_ids))
     );

  -- Everything asked for that did not survive the intersection. Reported rather
  -- than omitted: a caller that selected 40 and sees 38 applied deserves to
  -- know which two and why, and "not_found" covers deleted, wrong-company and
  -- hidden-number alike — telling them apart would leak which of the three it
  -- was.
  select coalesce(jsonb_agg(jsonb_build_object('id', missing, 'reason', 'not_found')), '[]'::jsonb)
    into v_failed
    from unnest(p_ids) as missing
   where not (missing = any(coalesce(v_selected, '{}'::uuid[])));

  if v_selected is null or array_length(v_selected, 1) is null then
    return jsonb_build_object(
      'action', p_action, 'matched', v_matched, 'applied', '[]'::jsonb,
      'failed', v_failed, 'capped', false);
  end if;

  if p_action in ('mark_done', 'mark_undone') then
    -- The flip and its event, per task, in this transaction. `previous` carries
    -- the prior done_at so an undo restores the exact timestamp rather than
    -- guessing at "not done".
    for v_row in
      select t.id as task_id, m.id as message_id, m.done_at, m.conversation_id
        from public.tasks t
        join public.messages m on m.id = t.message_id
       where t.id = any(v_selected)
         and ((p_action = 'mark_done' and m.done_at is null)
              or (p_action = 'mark_undone' and m.done_at is not null))
       for update of m
    loop
      if p_action = 'mark_done' then
        update public.messages
           set done_at = v_now, done_by_user_id = p_user_id
         where id = v_row.message_id;
      else
        update public.messages
           set done_at = null, done_by_user_id = null
         where id = v_row.message_id;
      end if;

      -- D22, same transaction as the flip. The body is never copied into the
      -- payload; the timeline joins the live message by id.
      insert into public.conversation_events
        (company_id, conversation_id, actor_user_id, type, payload)
      values
        (p_company_id, v_row.conversation_id, p_user_id,
         (case when p_action = 'mark_done' then 'message_done' else 'message_undone' end)
           ::public.conversation_event_type,
         jsonb_build_object('message_id', v_row.message_id));

      v_applied := v_applied || jsonb_build_object(
        'id', v_row.task_id,
        'previous', jsonb_build_object('done_at', v_row.done_at));
    end loop;

  elsif p_action = 'assign' then
    -- A target who is not an active member is refused for the whole call
    -- rather than per row: it is one wrong id in the request, and applying it
    -- to some tasks and not others would leave a half-assigned list nobody
    -- asked for.
    if p_target_user_id is not null then
      perform 1 from public.company_members cm
       where cm.company_id = p_company_id
         and cm.user_id = p_target_user_id
         and cm.deactivated_at is null;
      if not found then
        return jsonb_build_object('error', 'not_member');
      end if;
    end if;

    for v_row in
      select t.id, t.assigned_user_id, t.conversation_id
        from public.tasks t
       where t.id = any(v_selected)
         and t.assigned_user_id is distinct from p_target_user_id
       for update
    loop
      update public.tasks
         set assigned_user_id = p_target_user_id
       where id = v_row.id;

      insert into public.conversation_events
        (company_id, conversation_id, actor_user_id, type, payload)
      values
        (p_company_id, v_row.conversation_id, p_user_id, 'task_assigned',
         jsonb_build_object(
           'task_id', v_row.id,
           'from_user_id', v_row.assigned_user_id,
           'to_user_id', p_target_user_id));

      v_applied := v_applied || jsonb_build_object(
        'id', v_row.id,
        'previous', jsonb_build_object('assigned_user_id', v_row.assigned_user_id));
    end loop;

  else -- delete
    -- Soft, and deliberately NOT touching messages.done_at — the same rule the
    -- single-row delete follows (T4). Deleting the task does not un-finish the
    -- work somebody did.
    for v_row in
      select t.id, t.conversation_id
        from public.tasks t
       where t.id = any(v_selected)
       for update
    loop
      update public.tasks set deleted_at = v_now where id = v_row.id;

      insert into public.conversation_events
        (company_id, conversation_id, actor_user_id, type, payload)
      values
        (p_company_id, v_row.conversation_id, p_user_id, 'task_deleted',
         jsonb_build_object('task_id', v_row.id));

      v_applied := v_applied || jsonb_build_object(
        'id', v_row.id, 'previous', jsonb_build_object('deleted_at', null));
    end loop;
  end if;

  return jsonb_build_object(
    'action',  p_action,
    'matched', v_matched,
    'applied', v_applied,
    'failed',  v_failed,
    'capped',  v_matched > v_cap);
end $$;

comment on function public.api_bulk_tasks(uuid, uuid, text, uuid[], uuid, uuid[]) is
  '#478: apply one action to a set of tasks, atomically. Completion writes the '
  'messages.done_at flip AND its conversation_event in the same transaction '
  '(D14/D22) — a bulk done that half-records is worse than none.';

revoke execute on function public.api_bulk_tasks(uuid, uuid, text, uuid[], uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.api_bulk_tasks(uuid, uuid, text, uuid[], uuid, uuid[])
  to service_role;
revoke execute on function public.api_bulk_task_cap() from public, anon, authenticated;
grant execute on function public.api_bulk_task_cap() to service_role;
