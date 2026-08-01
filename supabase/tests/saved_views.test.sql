-- [#280] Saved views — assertion suite for
-- supabase/migrations/20260801100000_saved_views.sql.
--
-- What is pinned here is the set of rules that would fail SILENTLY: the name
-- collision that makes "open the emergency queue" stop naming a screen, the cap
-- that keeps the counts endpoint's cost fixed, the personal/shared budget split
-- that stops one member exhausting everybody's, and the ON DELETE SET NULL that
-- keeps a deleted shared view from stranding people on a row that is gone.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/saved_views.test.sql
--
-- One transaction, rolled back. Fixtures use an 'sv' id prefix so the file runs
-- standalone OR after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('50000000-0000-4000-8000-00000000000a'::uuid, 'views-a@test.local'),
  ('50000000-0000-4000-8000-00000000000b'::uuid, 'views-b@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('50000000-0000-4000-8000-0000000000c1'::uuid, 'Views Plumbing',
   '50000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());

insert into public.company_members (company_id, user_id, role) values
  ('50000000-0000-4000-8000-0000000000c1'::uuid,
   '50000000-0000-4000-8000-00000000000a'::uuid, 'owner'),
  ('50000000-0000-4000-8000-0000000000c1'::uuid,
   '50000000-0000-4000-8000-00000000000b'::uuid, 'member');

-- ===========================================================================
-- SV-1. A view is created, and lands at the end of its own list.
-- ===========================================================================
do $$
declare
  v_first  jsonb;
  v_second jsonb;
begin
  v_first := public.api_create_saved_view(
    '50000000-0000-4000-8000-0000000000c1'::uuid,
    '50000000-0000-4000-8000-00000000000a'::uuid,
    'conversations', 'Emergency queue', '{"status":"open"}'::jsonb, true);
  if v_first->>'outcome' <> 'created' then
    raise exception 'SV-1: expected created, got %', v_first->>'outcome';
  end if;
  if (v_first->'view'->>'owner_user_id') is not null then
    raise exception 'SV-1: a shared view must have no owner';
  end if;

  v_second := public.api_create_saved_view(
    '50000000-0000-4000-8000-0000000000c1'::uuid,
    '50000000-0000-4000-8000-00000000000a'::uuid,
    'conversations', 'Waiting on us', '{}'::jsonb, true);
  if (v_second->'view'->>'position')::int <= (v_first->'view'->>'position')::int then
    raise exception 'SV-1: a new view must land after the ones already there';
  end if;
end $$;

-- ===========================================================================
-- SV-2. Two names a letter apart are refused, and CASE is not a letter.
--
-- #298 is the tag version of this arriving somewhere worse: a view is a thing
-- one person tells another to open, so "Today" and "today" side by side means
-- the instruction no longer identifies a screen.
-- ===========================================================================
do $$
declare
  v jsonb;
begin
  v := public.api_create_saved_view(
    '50000000-0000-4000-8000-0000000000c1'::uuid,
    '50000000-0000-4000-8000-00000000000a'::uuid,
    'conversations', '  emergency QUEUE ', '{}'::jsonb, true);
  if v->>'outcome' <> 'duplicate_name' then
    raise exception 'SV-2: expected duplicate_name, got %', v->>'outcome';
  end if;
end $$;

-- ===========================================================================
-- SV-3. Personal and shared are separate budgets, and separate name spaces.
--
-- One member must not be able to exhaust everybody else's allowance, and two
-- members both calling their own view "Today" is not a collision — neither can
-- see the other's.
-- ===========================================================================
do $$
declare
  v_mine   jsonb;
  v_theirs jsonb;
begin
  v_mine := public.api_create_saved_view(
    '50000000-0000-4000-8000-0000000000c1'::uuid,
    '50000000-0000-4000-8000-00000000000a'::uuid,
    'conversations', 'Emergency queue', '{}'::jsonb, false);
  if v_mine->>'outcome' <> 'created' then
    raise exception 'SV-3: a personal view may reuse a shared name, got %',
      v_mine->>'outcome';
  end if;

  v_theirs := public.api_create_saved_view(
    '50000000-0000-4000-8000-0000000000c1'::uuid,
    '50000000-0000-4000-8000-00000000000b'::uuid,
    'conversations', 'Emergency queue', '{}'::jsonb, false);
  if v_theirs->>'outcome' <> 'created' then
    raise exception 'SV-3: two members may both name a view the same, got %',
      v_theirs->>'outcome';
  end if;
end $$;

-- ===========================================================================
-- SV-4. The cap holds, and reports the limit rather than raising.
--
-- The counts endpoint does bounded work PER VIEW, so an uncapped list turns one
-- poll into an unbounded number of queries. Capping before being prompted is
-- the rule; a bill is not a signal to design against.
-- ===========================================================================
do $$
declare
  v_cap integer := public.saved_views_per_surface_cap();
  v     jsonb;
  i     integer;
begin
  -- One 'tasks' view already counts toward nothing here; fill that surface.
  for i in 1..v_cap loop
    v := public.api_create_saved_view(
      '50000000-0000-4000-8000-0000000000c1'::uuid,
      '50000000-0000-4000-8000-00000000000a'::uuid,
      'tasks', 'View ' || i::text, '{}'::jsonb, true);
    if v->>'outcome' <> 'created' then
      raise exception 'SV-4: refused at % of %, outcome %', i, v_cap, v->>'outcome';
    end if;
  end loop;

  v := public.api_create_saved_view(
    '50000000-0000-4000-8000-0000000000c1'::uuid,
    '50000000-0000-4000-8000-00000000000a'::uuid,
    'tasks', 'One too many', '{}'::jsonb, true);
  if v->>'outcome' <> 'cap' then
    raise exception 'SV-4: expected cap, got %', v->>'outcome';
  end if;
  if (v->>'limit')::int <> v_cap then
    raise exception 'SV-4: the refusal must say what the limit is';
  end if;

  -- The OTHER surface is untouched by the tasks cap.
  v := public.api_create_saved_view(
    '50000000-0000-4000-8000-0000000000c1'::uuid,
    '50000000-0000-4000-8000-00000000000a'::uuid,
    'conversations', 'Still fine', '{}'::jsonb, true);
  if v->>'outcome' <> 'created' then
    raise exception 'SV-4: one surface''s cap must not close the other';
  end if;
end $$;

-- ===========================================================================
-- SV-5. Reorder applies the whole order at once, and ignores foreign ids.
--
-- A drag produces a new order; applying it row by row leaves the list
-- transiently wrong for anybody else reading it. And a client's list can lag a
-- delete, so a vanished id must not fail the reorder for the rest.
-- ===========================================================================
do $$
declare
  v_ids   uuid[];
  v_moved integer;
  v_first uuid;
  v_last  uuid;
begin
  select array_agg(id order by position) into v_ids
    from public.saved_views
   where company_id = '50000000-0000-4000-8000-0000000000c1'::uuid
     and surface = 'conversations'
     and owner_user_id is null;

  -- Reverse it, and append an id from another table entirely.
  v_moved := public.api_reorder_saved_views(
    '50000000-0000-4000-8000-0000000000c1'::uuid,
    '50000000-0000-4000-8000-00000000000a'::uuid,
    'conversations',
    (select array_agg(id order by ord desc)
       from unnest(v_ids) with ordinality as t(id, ord))
      || array['50000000-0000-4000-8000-00000000000a'::uuid]);

  if v_moved <> array_length(v_ids, 1) then
    raise exception 'SV-5: moved % of %', v_moved, array_length(v_ids, 1);
  end if;

  select id into v_first from public.saved_views
   where company_id = '50000000-0000-4000-8000-0000000000c1'::uuid
     and surface = 'conversations' and owner_user_id is null
   order by position limit 1;
  v_last := v_ids[array_length(v_ids, 1)];
  if v_first <> v_last then
    raise exception 'SV-5: the reversed order did not take';
  end if;
end $$;

-- ===========================================================================
-- SV-6. A member cannot reorder somebody else's personal list.
-- ===========================================================================
do $$
declare
  v_id    uuid;
  v_moved integer;
begin
  select id into v_id from public.saved_views
   where company_id = '50000000-0000-4000-8000-0000000000c1'::uuid
     and owner_user_id = '50000000-0000-4000-8000-00000000000b'::uuid
   limit 1;

  v_moved := public.api_reorder_saved_views(
    '50000000-0000-4000-8000-0000000000c1'::uuid,
    '50000000-0000-4000-8000-00000000000a'::uuid,
    'conversations', array[v_id]);
  if v_moved <> 0 then
    raise exception 'SV-6: reordered a view belonging to another member';
  end if;
end $$;

-- ===========================================================================
-- SV-7. Deleting a shared view clears it from everybody's landing screen.
--
-- ON DELETE SET NULL rather than RESTRICT: an owner tidying up must not be
-- blocked because a colleague lands there, and nobody should be left pointed at
-- a row that no longer exists.
-- ===========================================================================
do $$
declare
  v_id      uuid;
  v_remains uuid;
begin
  select id into v_id from public.saved_views
   where company_id = '50000000-0000-4000-8000-0000000000c1'::uuid
     and surface = 'conversations' and owner_user_id is null
   limit 1;

  update public.company_members
     set default_conversation_view_id = v_id
   where company_id = '50000000-0000-4000-8000-0000000000c1'::uuid;

  delete from public.saved_views where id = v_id;

  select default_conversation_view_id into v_remains
    from public.company_members
   where company_id = '50000000-0000-4000-8000-0000000000c1'::uuid
     and user_id = '50000000-0000-4000-8000-00000000000b'::uuid;
  if v_remains is not null then
    raise exception 'SV-7: a deleted view is still somebody''s landing screen';
  end if;
end $$;

-- ===========================================================================
-- SV-8. Closing the workspace takes its views with it.
-- ===========================================================================
do $$
declare
  v_left integer;
begin
  delete from public.company_members
   where company_id = '50000000-0000-4000-8000-0000000000c1'::uuid;
  delete from public.companies
   where id = '50000000-0000-4000-8000-0000000000c1'::uuid;

  select count(*) into v_left from public.saved_views
   where company_id = '50000000-0000-4000-8000-0000000000c1'::uuid;
  if v_left <> 0 then
    raise exception 'SV-8: % views outlived their workspace', v_left;
  end if;
end $$;

rollback;
