-- Task due-date reminders.
--
-- A due date only mattered inside the app: For You pins overdue tasks and the
-- list can filter on them, but nothing reached a phone, so a task due at 2pm
-- passed unnoticed by anyone who was not already looking. This records whether
-- the reminder for a task's CURRENT due date has gone out, which is what makes
-- the scheduled job at-most-once per due date rather than every run.

alter table public.tasks
  add column if not exists due_notified_at timestamptz;

comment on column public.tasks.due_notified_at is
  'When the reminder for the current due_at was sent. Null means owed (or not '
  'due yet). Cleared automatically whenever due_at changes, so a rescheduled '
  'task reminds again on its new date.';

-- The scan the job runs every 15 minutes: due, un-reminded, not deleted. A
-- partial index keeps it proportional to the work owed rather than to the
-- number of tasks that ever existed.
create index if not exists tasks_due_notice_pending_idx
  on public.tasks (due_at)
  where due_notified_at is null
    and due_at is not null
    and deleted_at is null;

-- Rescheduling a task must re-arm its reminder. A trigger rather than a change
-- to update_task, because every writer has to obey this: a task moved to next
-- Tuesday by any path whose reminder already fired would otherwise stay silent
-- forever, which is worse than never having reminded at all.
create or replace function public.tasks_rearm_due_notice()
returns trigger
language plpgsql
as $$
begin
  if new.due_at is distinct from old.due_at then
    new.due_notified_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_rearm_due_notice on public.tasks;
create trigger tasks_rearm_due_notice
  before update on public.tasks
  for each row
  execute function public.tasks_rearm_due_notice();

-- Postgres grants EXECUTE on a new function to PUBLIC by default; this one is
-- only ever reached through the trigger.
revoke all on function public.tasks_rearm_due_notice() from public, anon, authenticated;
