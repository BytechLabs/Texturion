-- A connection's later calendar pulls can be claimed (#245).
--
-- api_claim_due_calendar_pulls sets last_sync_started_at = now() on a
-- connection whose last pull finished earlier, so while a pull runs the last
-- start is later than the last completion. calendar_connections_sync_clock_ck
-- forbade that: every pull after a connection's first failed, and a move made
-- in the calendar never reached its task. The columns hold the latest start
-- and the latest completion, not one sync's, so no order between them holds.
-- now() does not advance inside one transaction, so only a test that dates
-- the last sync in the past reproduces it (CS-4b in calendar_sync.test.sql).
alter table public.calendar_connections
  drop constraint if exists calendar_connections_sync_clock_ck;
