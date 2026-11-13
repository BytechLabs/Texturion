-- D9 amendment: a write that changes only server bookkeeping, or a re-read that leaves a thread as read as it was, broadcasts nothing.
-- calls keep every update: the table has no updated_at, and each column written on its own is read by a client or a route.

create or replace function public.broadcast_conversation_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  -- Server bookkeeping that no client, route select or api_thread_call reads.
  v_quiet constant text[] := array[
    'updated_at', 'last_notified_at', 'last_auto_reply_at', 'last_emergency_ack_at',
    'offramp_sent_at', 'chase_level'];
begin
  -- A thread created in this transaction has never been announced: the trigger fires on update only.
  if tg_op = 'UPDATE'
     and old.created_at < now()
     and (to_jsonb(new) - v_quiet) = (to_jsonb(old) - v_quiet) then
    return null;
  end if;

  perform public.broadcast_number_scoped(
    jsonb_build_object('conversation_id', new.id),
    'conversation.updated', new.company_id, new.phone_number_id);
  return null;
end $$;

revoke all on function public.broadcast_conversation_change()
  from public, anon, authenticated;

create or replace function public.broadcast_task_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  cid uuid := coalesce(new.conversation_id, old.conversation_id);
  co  uuid := coalesce(new.company_id, old.company_id);
  v_number uuid;
  -- Server bookkeeping that no client or route reads. lat, lng and geocode_status feed the Map.
  v_quiet constant text[] := array[
    'updated_at', 'due_notified_at', 'overdue_notified_at', 'geocoded_at'];
begin
  -- task_assignees_sync_first rewrites the row on purpose so a crew change is heard.
  if tg_op = 'UPDATE'
     and coalesce(current_setting('loonext.assignee_sync', true), '') <> 'on'
     and (to_jsonb(new) - v_quiet) = (to_jsonb(old) - v_quiet) then
    return null;
  end if;

  select c.phone_number_id into v_number
  from public.conversations c
  where c.id = cid;

  perform public.broadcast_number_scoped(
    jsonb_build_object('conversation_id', cid),
    'task.changed', co, v_number);
  return null;
end $$;

revoke all on function public.broadcast_task_changed()
  from public, anon, authenticated;

create or replace function public.broadcast_conversation_read() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_number uuid;
  v_newest_not_mine timestamptz;
begin
  if tg_op = 'UPDATE'
     and new.conversation_id = old.conversation_id
     and new.user_id = old.user_id then
    -- The same unread test api_for_you makes against conversation_unread_basis.
    select case when b.latest_by is distinct from new.user_id
                then b.latest_at else b.other_at end
      into v_newest_not_mine
      from public.conversation_unread_basis b
     where b.conversation_id = new.conversation_id;
    -- Read before the write and read after it: nothing a client shows moved.
    if coalesce(v_newest_not_mine <= least(old.last_read_at, new.last_read_at), true) then
      return null;
    end if;
  end if;

  select c.company_id, c.phone_number_id into v_company, v_number
    from public.conversations c
   where c.id = new.conversation_id;
  if v_company is null then return null; end if;

  perform public.broadcast_number_scoped(
    jsonb_build_object('conversation_id', new.conversation_id,
                       'user_id', new.user_id),
    'read.conversation', v_company, v_number);
  return null;
end $$;

revoke all on function public.broadcast_conversation_read()
  from public, anon, authenticated;
