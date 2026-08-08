-- #551 — the map view could not be opened at all.
--
-- ## What happened
--
-- "Clicking on map view says something went wrong try again."
--
-- `GET /v1/tasks?has_location=true` is the map's read, and it is the only caller
-- that points `TASK_COLUMNS` at the VIEW rather than at the `tasks` table:
--
--   apps/api/src/routes/tasks.ts:873
--     db.from("task_map_rows").select(`${TASK_COLUMNS},done_at,contact_id,…`)
--
-- #237 then appended three columns to that shared projection —
-- `reminders_off, confirmed_at, confirmed_by` — because the tasks TABLE has them.
-- `task_map_rows` never did. So every map load selected three columns the view
-- does not expose, PostgREST refused, and the route 500'd. Unconditionally, for
-- every workspace, on all three clients.
--
-- ## The shape of it, which is the third time this session
--
-- One projection string, two relations, and nothing checking that both could
-- satisfy it. The same shape as the notification preferences (a GET select list
-- and a PATCH schema that had drifted) and the company view (five writable
-- columns the read never asked for). A list of field names used in two places
-- needs something comparing the two; `tasks.map-projection.test.ts` is that for
-- this one.
--
-- ## Why the columns go on the END
--
-- `create or replace view` may only APPEND columns — renaming or reordering an
-- existing one is refused outright, so the whole view has to be restated with the
-- new fields last. The select list below is therefore identical to
-- 20260724030000 with three lines added, and NOT reordered into TASK_COLUMNS'
-- order. PostgREST selects by name, so order is irrelevant to the caller.

create or replace view public.task_map_rows
  with (security_invoker = true) as
select
  t.id, t.company_id, t.message_id, t.conversation_id, t.title, t.description,
  t.assigned_user_id, t.due_at, t.created_by_user_id, t.created_at, t.updated_at,
  t.addr_street, t.addr_unit, t.addr_city, t.addr_state, t.addr_postal_code,
  t.addr_country, t.addr_provenance, t.lat, t.lng, t.deleted_at,
  m.done_at,
  cv.phone_number_id,
  c.id   as contact_id,
  c.name as contact_name,
  c.lat  as contact_lat,
  c.lng  as contact_lng,
  coalesce(t.lat, c.lat) as map_lat,
  coalesce(t.lng, c.lng) as map_lng,
  -- #237, and the whole of #551: the map pin shows whether a job has told its
  -- customer it is coming and whether they answered. `confirmed_by` matters as
  -- much as `confirmed_at` — a crew confirmation is a note to ourselves, a
  -- customer's is a promise, and a screen that drew them the same way would have
  -- a dispatcher trusting the weaker of the two.
  t.reminders_off,
  t.confirmed_at,
  t.confirmed_by
from public.tasks t
join public.conversations cv on cv.id = t.conversation_id
join public.contacts     c  on c.id  = cv.contact_id
join public.messages     m  on m.id  = t.message_id;

comment on view public.task_map_rows is
  '#221/#551: one flat row per task that has a location, so the map can filter on '
  'a coalesced lat/lng in SQL. Every column TASK_COLUMNS names must exist here — '
  'the map is the one caller that points that projection at this view instead of '
  'the tasks table, and three columns added to it by #237 broke every map load '
  'until this migration. tasks.map-projection.test.ts compares the two lists.';

revoke all on public.task_map_rows from anon, authenticated, public;
grant select on public.task_map_rows to service_role;
