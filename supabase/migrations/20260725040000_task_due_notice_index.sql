-- Keep the due-reminder index to the work actually owed.
--
-- The index covers dated, unstamped, live tasks. The job also requires an
-- assignee, and it stamps only what it sends, so an UNASSIGNED dated task is
-- never scanned and never stamped: it sits in the index for as long as the row
-- exists. A workspace that dates work before handing it out accumulates those
-- for good.
--
-- Adding the assignee to the predicate makes the index track what the scan
-- asks for. Assigning a task moves it in, which is exactly when a reminder
-- starts being owed.
--
-- A completed task is a different case and deliberately not addressed here:
-- completion lives on the promoted message, not on this row, so it cannot be
-- expressed in a partial index over `tasks`. Those leave the index when the
-- job claims them, which it does whether or not it goes on to send.

drop index if exists tasks_due_notice_pending_idx;

create index if not exists tasks_due_notice_pending_idx
  on public.tasks (due_at)
  where due_notified_at is null
    and due_at is not null
    and deleted_at is null
    and assigned_user_id is not null;
