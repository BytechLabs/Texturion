-- ===========================================================================
-- The bell's 'missed_call' arm: the workspace's missed calls newer than this
-- member's read watermark.
--
-- notification_feed asks `e.company_id = p_company_id and e.type =
-- 'call_completed' and e.payload->>'outcome' = 'missed' and e.created_at >
-- p_since`, then keeps inbound calls on threads that are this member's or
-- nobody's. Missed calls are a small part of every call, and calls a small
-- part of every event, so a partial index on exactly that predicate is small
-- and lets the arm skip everything else the workspace has written.
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
--     drop index concurrently public.conversation_events_missed_call_idx;
-- ===========================================================================
create index concurrently if not exists conversation_events_missed_call_idx
  on public.conversation_events (company_id, created_at)
  where type = 'call_completed' and payload ->> 'outcome' = 'missed';
