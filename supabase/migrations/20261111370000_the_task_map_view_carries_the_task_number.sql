-- The Tasks map and calendar list read `task_map_rows` with the task list's
-- columns, which include `number` since 20261111150000 gave tasks their T-numbers.
-- The view was last defined before that (20261111090000) and never gained it, so
-- every map read failed in production with "column task_map_rows.number does not
-- exist". Same definition, with the number appended (a replaced view may only add
-- columns at the end).
create or replace view public.task_map_rows
  with (security_invoker = true) as
select
  t.id, t.company_id, t.message_id, t.conversation_id, t.title, t.description,
  t.assigned_user_id, t.due_at, t.created_by_user_id, t.created_at, t.updated_at,
  t.addr_street, t.addr_unit, t.addr_city, t.addr_state, t.addr_postal_code,
  t.addr_country, t.addr_provenance, t.lat, t.lng, t.deleted_at,
  coalesce(m.done_at, t.done_at) as done_at,
  cv.phone_number_id,
  c.id   as contact_id,
  c.name as contact_name,
  c.lat  as contact_lat,
  c.lng  as contact_lng,
  coalesce(t.lat, c.lat) as map_lat,
  coalesce(t.lng, c.lng) as map_lng,
  t.reminders_off,
  t.confirmed_at,
  t.confirmed_by,
  t.source_call_id,
  t.priority,
  t.priority_rank,
  t.series_id,
  t.occurrence_no,
  t.number
from public.tasks t
left join public.conversations cv on cv.id = t.conversation_id
left join public.contacts      c  on c.id  = coalesce(cv.contact_id, t.contact_id)
left join public.messages      m  on m.id  = t.message_id;
