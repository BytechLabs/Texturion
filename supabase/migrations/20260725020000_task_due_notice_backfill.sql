-- Retire the due-date reminder backlog that existed before reminders did.
--
-- `due_notified_at` arrived NULL on every row, which reads as "a reminder is
-- owed". For a workspace with dated work in its history that is one alert per
-- past deadline on the first run, all at once, each with its own collapse key
-- so none replaces another.
--
-- The job now also passes over anything more than a day late, so this is not
-- the only guard. It is the one that empties the queue in a single statement
-- rather than letting the scheduled job claim the backlog a batch at a time,
-- with a realtime broadcast per row.
--
-- Work that is due from here on is untouched: only deadlines already in the
-- past are retired, so a task due later today still reminds.

update public.tasks
   set due_notified_at = now()
 where due_notified_at is null
   and due_at is not null
   and due_at < now();
