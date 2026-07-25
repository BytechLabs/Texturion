-- Handing a job to someone else re-arms its reminder.
--
-- The reminder is claimed before the checks that decide whether to send it, so
-- the queue drains and a task is never scanned twice. That is right for a
-- member who has turned reminders off, and wrong when the reason was that the
-- assignee had been removed from the workspace: the job is still owed, and the
-- person it is handed to next was never told.
--
-- Rescheduling already re-arms the reminder for the same reason. Reassignment
-- is the same event seen from the other side: the deadline that matters has not
-- been announced to the person who now has to meet it.

create or replace function public.tasks_rearm_due_notice()
returns trigger
language plpgsql
as $$
begin
  if new.due_at is distinct from old.due_at
     or new.assigned_user_id is distinct from old.assigned_user_id then
    new.due_notified_at := null;
  end if;
  return new;
end;
$$;

-- Postgres grants EXECUTE on a recreated function to PUBLIC by default; this
-- one is only ever reached through the trigger.
revoke all on function public.tasks_rearm_due_notice() from public, anon, authenticated;
