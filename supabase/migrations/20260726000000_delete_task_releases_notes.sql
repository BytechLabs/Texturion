-- Deleting a task releases the notes that were linked to it.
--
-- A promoted note is linked back to its task through `messages.task_id`, and
-- that link is what carries the note's own files into the task's derived
-- attachments and its body into the task's activity. Deleting a task soft-
-- deleted the task row and its own attachment rows, but left every linked note
-- still pointing at the dead task.
--
-- The link is set once and only once: `create_task` guards on `task_id is
-- null`. So promoting the same note again after a delete produced a task with
-- no back-link at all. Its Attachments section was empty and its activity did
-- not contain the note it was made from, while the photos sat in storage,
-- still attached to the note in the thread. The delete confirmation, which
-- counts a task's notes and files, then read zero for it too.
--
-- The path is ordinary: `has_task` is derived from live tasks, so the thread
-- offers "Make a task" on that note again the moment the first one is deleted.
--
-- Releasing the notes is the right end of the fix. The task is gone and hidden
-- everywhere, so the link has nothing left to describe, and a note freed this
-- way is immediately promotable again.

create or replace function public.delete_task(
  p_company_id uuid,
  p_task_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_task public.tasks%rowtype;
  v_now  timestamptz := now();
begin
  update public.tasks
     set deleted_at = v_now
   where company_id = p_company_id
     and id = p_task_id
     and deleted_at is null
  returning * into v_task;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  -- Soft-delete the task's live generic attachment rows (D19) in the SAME txn.
  update public.attachments
     set deleted_at = v_now
   where company_id = p_company_id
     and owner_type = 'task'
     and owner_id = p_task_id
     and deleted_at is null;

  -- Release the notes, in the same transaction, so the same message can be
  -- promoted again and carry its files and its body with it.
  update public.messages
     set task_id = null
   where company_id = p_company_id
     and task_id = p_task_id;

  insert into public.conversation_events
    (company_id, conversation_id, actor_user_id, type, payload)
  values
    (p_company_id, v_task.conversation_id, p_actor_user_id, 'task_deleted',
     jsonb_build_object('task_id', p_task_id));

  return jsonb_build_object('outcome', 'deleted');
end $function$;

-- Postgres grants EXECUTE on a recreated function to PUBLIC by default.
revoke all on function public.delete_task(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_task(uuid, uuid, uuid) to service_role;
