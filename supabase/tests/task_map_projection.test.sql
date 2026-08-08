-- #551 — every column the map's projection names must exist on the map's view.
--
-- ## The bug this asserts against
--
-- The map view could not be opened at all: "Clicking on map view says something
-- went wrong try again."
--
-- `GET /v1/tasks?has_location=true` is the one caller that points the shared
-- `TASK_COLUMNS` projection (apps/api/src/routes/tasks.ts:249) at the VIEW
-- `public.task_map_rows` instead of at the `tasks` table. #237 appended
-- `reminders_off, confirmed_at, confirmed_by` to that projection because the
-- table has them. The view did not. Every map load selected three columns the
-- view does not expose, PostgREST refused, and the route 500'd — for every
-- workspace, on all three clients, from the day #237 shipped.
--
-- ## Why the assertion lives in SQL
--
-- The projection is a TypeScript string and the view is a database object, so no
-- typechecker can compare them and no unit test can see the real column list.
-- This suite can: it asks the catalogue. The vitest twin
-- (`apps/api/src/routes/tasks.map-projection.test.ts`) pins the other direction —
-- that the string still parses into the names this file expects — so the pair
-- covers a rename on either side.
--
-- The list below is deliberately WRITTEN OUT rather than derived. A test that
-- read the projection from the same place the route does would agree with it by
-- construction, which is how the truncated-echo defect in #552 survived its own
-- test. This is the independent copy, and its cost is that somebody adding a
-- column edits two files — which is exactly the moment to notice the view.

\set ON_ERROR_STOP on
begin;

do $$
declare
  v_expected text[] := array[
    -- TASK_COLUMNS, in the order the route writes it.
    'id', 'company_id', 'message_id', 'conversation_id', 'title', 'description',
    'assigned_user_id', 'due_at', 'created_by_user_id', 'created_at', 'updated_at',
    'addr_street', 'addr_unit', 'addr_city', 'addr_state', 'addr_postal_code',
    'addr_country', 'addr_provenance',
    'lat', 'lng',
    -- #237, and the three that broke it.
    'reminders_off', 'confirmed_at', 'confirmed_by',
    -- The extras the map path appends to TASK_COLUMNS at the call site.
    'done_at', 'contact_id', 'contact_name', 'contact_lat', 'contact_lng',
    -- Selected by filters rather than by the projection, and just as fatal when
    -- absent: the route filters on map_lat and deleted_at.
    'map_lat', 'map_lng', 'deleted_at'
  ];
  v_actual text[];
  v_missing text[];
begin
  select array_agg(column_name::text)
    into v_actual
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'task_map_rows';

  if v_actual is null then
    raise exception 'TMP-1 FAILED: public.task_map_rows does not exist at all';
  end if;

  select array_agg(needed)
    into v_missing
    from unnest(v_expected) as needed
   where needed <> all (v_actual);

  if v_missing is not null then
    raise exception
      'TMP-1 FAILED: the map read selects column(s) the view does not expose: %. '
      'Every map load 500s until they are added. `create or replace view` may '
      'only APPEND, so restate the whole view with the new columns last.',
      array_to_string(v_missing, ', ');
  end if;

  raise notice
    'TMP-1 PASSED: all % columns the map read names exist on task_map_rows',
    array_length(v_expected, 1);
end $$;

-- TMP-2: and the view is actually readable by the role that reads it. A column
-- list that lines up while the grant is missing is the same 500 with a different
-- cause, and this suite is the only place that can tell.
do $$
begin
  if not has_table_privilege('service_role', 'public.task_map_rows', 'select') then
    raise exception 'TMP-2 FAILED: service_role cannot select from task_map_rows';
  end if;
  -- And still not readable by anyone else: it joins contacts, so a customer's
  -- name and coordinates are on every row.
  if has_table_privilege('anon', 'public.task_map_rows', 'select')
     or has_table_privilege('authenticated', 'public.task_map_rows', 'select') then
    raise exception
      'TMP-2 FAILED: task_map_rows is readable by anon/authenticated, and every '
      'row carries a customer name and their coordinates';
  end if;
  raise notice 'TMP-2 PASSED: the map view is service_role only';
end $$;

rollback;
