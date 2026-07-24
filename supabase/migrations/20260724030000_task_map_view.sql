-- #221: the Map view hid a task that had its OWN geocoded address whenever the
-- task's CONTACT wasn't geocoded, because the GET /v1/tasks?has_location=true
-- filter required contacts.lat. The real map location is
-- coalesce(task.lat, contact.lat) — the client already PREFERS the task's own
-- geocode (map-types.ts) — but PostgREST cannot OR a root-table column against
-- an embedded resource's column (verified: PGRST100 "failed to parse logic
-- tree"). So expose the map candidate set as a FLAT view where the
-- location / #106-access / done / keyset predicates are all plain columns.
--
-- Every conversation has exactly one contact (contact_id is NOT NULL across the
-- table), so the inner joins never drop a task; message_id likewise always
-- resolves to the source row. done_at + phone_number_id ride along so the route
-- keeps deriving `done` and enforcing the hidden-number filter without an embed.
--
-- SECURITY: this view spans companies (the API scopes every read by company_id
-- with the service-role key). anon/authenticated must NEVER read it. It runs
-- security_invoker so it carries no ambient definer privilege, and SELECT is
-- revoked from anon/authenticated/public and granted only to service_role.
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
  coalesce(t.lng, c.lng) as map_lng
from public.tasks t
join public.conversations cv on cv.id = t.conversation_id
join public.contacts     c  on c.id  = cv.contact_id
join public.messages     m  on m.id  = t.message_id;

revoke all on public.task_map_rows from anon, authenticated, public;
grant select on public.task_map_rows to service_role;
