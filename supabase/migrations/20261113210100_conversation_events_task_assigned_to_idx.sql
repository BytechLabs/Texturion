-- ===========================================================================
-- The bell's 'task_assigned' arm: the tasks given to this member in this
-- workspace, newer than their read watermark.
--
-- notification_feed asks `e.company_id = p_company_id and e.type =
-- 'task_assigned' and e.payload->>'to_user_id' = p_user_id::text and
-- e.created_at > p_since`. Without this index the arm reads every event the
-- workspace has ever written, on every badge refresh. The key and the
-- predicate are the arm's own text, so the planner can match them, generic
-- plans included.
--
-- ONE STATEMENT, ALONE IN THIS FILE.
--
--   CONCURRENTLY, because a plain CREATE INDEX blocks every write to
--   conversation_events for the whole build, and every text, call and
--   assignment writes there.
--
--   CONCURRENTLY cannot run inside a pipeline, and the migration runner sends a
--   file's statements as one (SQLSTATE 25001, see
--   20260806090100_opted_out_announcement_index.sql). A single statement is not
--   a pipeline. A second statement here breaks the deploy.
--
-- A cancelled build leaves an INVALID index that `if not exists` then skips
-- forever. Recover by hand, then re-run this migration:
--
--     drop index concurrently public.conversation_events_task_assigned_to_idx;
-- ===========================================================================
create index concurrently if not exists conversation_events_task_assigned_to_idx
  on public.conversation_events (company_id, (payload ->> 'to_user_id'), created_at)
  where type = 'task_assigned';
