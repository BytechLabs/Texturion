-- #751: every event Loonext writes to Google or Outlook now ends with a link to
-- its task. Events written before that have none, and a task nobody edits would
-- never be written again. Queue one sync per task with a live event; the worker
-- sees the provider's copy lacks the link and rewrites only its description.
select public.calendar_enqueue_task_sync(t)
  from public.tasks t
 where exists (
   select 1
     from public.task_calendar_links l
    where l.task_id = t.id
      and l.company_id = t.company_id
      and l.link_state = 'active'
 );
