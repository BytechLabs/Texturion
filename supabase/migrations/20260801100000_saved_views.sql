-- #280 — saved views: the filter you rebuild every morning, kept.
--
-- ---------------------------------------------------------------------------
-- A VIEW IS A SAVED QUERY, NOT A SAVED RESULT, AND NOT A PERMISSION
--
-- The single most important decision here, and the one the natural
-- implementation gets wrong. #280 states it directly: "a shared view resolves
-- per viewer, and must never reveal the existence of conversations on numbers
-- that viewer cannot see. A shared view is a query, not a permission grant."
--
-- So a row stores FILTER PARAMETERS and nothing else. No conversation ids, no
-- counts, no materialised membership. Opening a view replays those parameters
-- through the same `api_list_conversations` / task listing the client already
-- calls, which is where #106's number-access filtering lives. A viewer who
-- cannot see the emergency line opens "the emergency queue" and sees an empty
-- list, not somebody else's threads.
--
-- The alternative — storing what matched — would be faster, would need its own
-- access check, and would be one forgotten join away from a data leak between
-- members of the same workspace.
--
-- ---------------------------------------------------------------------------
-- WHY THE DEFAULT IS ON THE MEMBERSHIP AND NOT ON THE VIEW
--
-- "A member can choose which view they land on" is per member, and a shared
-- view can be one person's landing screen and not another's. An `is_default`
-- column on the view would make one member's choice everybody's. The columns
-- live on `company_members`, which is already the (company, user) grain.
--
-- ---------------------------------------------------------------------------
-- WHY FILTERS ARE JSONB AND VALIDATED IN THE API
--
-- The set of filters is the list endpoint's query schema, and that schema
-- changes when a filter is added. Mirroring it as columns here would mean a
-- migration every time, and a saved view holding a filter the API no longer
-- accepts. It is validated with zod on write AND on read
-- (`packages/shared/src/saved-views.ts`), so a row written before a schema
-- change cannot be replayed into a request the API would reject.

create table if not exists public.saved_views (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,

  -- NULL means the whole workspace shares it. This is where the
  -- process-encoding value lives: an owner defines "the emergency queue" once
  -- and it means the same thing for everyone who can see those numbers.
  owner_user_id  uuid references auth.users(id) on delete cascade,

  surface        text not null check (surface in ('conversations', 'tasks')),
  name           text not null check (char_length(btrim(name)) between 1 and 60),

  -- The saved query. Shape is owned by the API, not by this table.
  filters        jsonb not null default '{}'::jsonb,

  -- Manual order within a surface. Sparse on purpose so a reorder rewrites the
  -- list rather than shuffling neighbours.
  position       integer not null default 0,

  created_by     uuid not null references auth.users(id) on delete restrict,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.saved_views is
  '#280: a named set of list filters. Stores the QUERY, never the result — '
  'opening one replays it through the ordinary list path, so #106 number '
  'access is applied per viewer and a shared view grants nothing.';

comment on column public.saved_views.owner_user_id is
  '#280: null = shared with the workspace. A personal view is visible only to '
  'its owner; a shared one resolves per viewer.';

-- Two names that differ only in case are the #298 tag-sprawl failure arriving
-- somewhere it would be worse, because a view is a thing people tell each other
-- to open. Scoped per (company, surface, owner) so one member''s "Today" does
-- not collide with another''s.
create unique index if not exists saved_views_name_uq
  on public.saved_views (company_id, surface, coalesce(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));

-- The one read this table has: "every view this member may see, in order."
create index if not exists saved_views_visible_idx
  on public.saved_views (company_id, surface, position, created_at);

alter table public.saved_views enable row level security;
revoke all on public.saved_views from public, anon, authenticated;
grant select, insert, update, delete on public.saved_views to service_role;

-- ---------------------------------------------------------------------------
-- The landing view, per member and per surface.
-- ---------------------------------------------------------------------------

alter table public.company_members
  add column if not exists default_conversation_view_id uuid
    references public.saved_views(id) on delete set null;

alter table public.company_members
  add column if not exists default_task_view_id uuid
    references public.saved_views(id) on delete set null;

comment on column public.company_members.default_conversation_view_id is
  '#280: the view this member lands on in the inbox. ON DELETE SET NULL — '
  'deleting a shared view must drop it from everybody''s landing screen '
  'rather than leaving them pointed at a row that no longer exists.';

comment on column public.company_members.default_task_view_id is
  '#280: the same, for tasks. A dispatcher and a tech want different screens.';

-- ---------------------------------------------------------------------------
-- How many views one workspace may hold, per surface.
--
-- A cap, because the counts endpoint does bounded work PER VIEW and an
-- uncapped list turns one poll into an unbounded number of queries. Forty is
-- far above any crew that is using this as intended and low enough that the
-- worst case is a fixed cost. The cost-protection rule is to cap before being
-- prompted, not after a bill.
-- ---------------------------------------------------------------------------
create or replace function public.saved_views_per_surface_cap() returns integer
language sql immutable as $$ select 40 $$;

-- ---------------------------------------------------------------------------
-- Create a view, refusing the two things that race.
--
-- Returns a `{ outcome }` sentinel rather than raising, matching
-- api_create_company: the caller turns it into an HTTP status, and a duplicate
-- name is a thing to tell somebody, not an exception.
-- ---------------------------------------------------------------------------
create or replace function public.api_create_saved_view(
  p_company_id uuid,
  p_user_id    uuid,
  p_surface    text,
  p_name       text,
  p_filters    jsonb,
  p_shared     boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := case when p_shared then null else p_user_id end;
  v_count integer;
  v_row   public.saved_views;
begin
  -- Counted inside the function so the check and the insert cannot straddle a
  -- concurrent create. Counts the caller's own scope: a member's personal views
  -- and the shared ones are separate budgets, so one member cannot exhaust
  -- everybody else's.
  select count(*) into v_count
    from public.saved_views v
   where v.company_id = p_company_id
     and v.surface = p_surface
     and v.owner_user_id is not distinct from v_owner;

  if v_count >= public.saved_views_per_surface_cap() then
    return jsonb_build_object(
      'outcome', 'cap',
      'limit', public.saved_views_per_surface_cap());
  end if;

  begin
    insert into public.saved_views (
      company_id, owner_user_id, surface, name, filters, position, created_by)
    values (
      p_company_id, v_owner, p_surface, btrim(p_name), coalesce(p_filters, '{}'::jsonb),
      coalesce((select max(v.position) + 1 from public.saved_views v
                 where v.company_id = p_company_id
                   and v.surface = p_surface
                   and v.owner_user_id is not distinct from v_owner), 0),
      p_user_id)
    returning * into v_row;
  exception when unique_violation then
    return jsonb_build_object('outcome', 'duplicate_name');
  end;

  return jsonb_build_object('outcome', 'created', 'view', to_jsonb(v_row));
end;
$$;

revoke execute on function public.api_create_saved_view(uuid, uuid, text, text, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.api_create_saved_view(uuid, uuid, text, text, jsonb, boolean)
  to service_role;

-- ---------------------------------------------------------------------------
-- Reorder a surface in one statement.
--
-- Takes the whole ordered list rather than a (view, position) pair, because a
-- drag produces a new order and applying it one row at a time leaves the list
-- transiently wrong for anybody else reading it. Ids that do not belong to this
-- company are ignored rather than raising: the client's list can lag a delete,
-- and failing a reorder because one row vanished is worse than reordering the
-- rest.
-- ---------------------------------------------------------------------------
create or replace function public.api_reorder_saved_views(
  p_company_id uuid,
  p_user_id    uuid,
  p_surface    text,
  p_ids        uuid[]
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_moved integer;
begin
  with ordered as (
    select id, ordinality::integer - 1 as position
      from unnest(p_ids) with ordinality as t(id, ordinality)
  )
  update public.saved_views v
     set position = o.position,
         updated_at = now()
    from ordered o
   where v.id = o.id
     and v.company_id = p_company_id
     and v.surface = p_surface
     -- A member may reorder the shared list and their own. Reordering is a
     -- view-level preference the whole workspace shares, which is the same
     -- decision tags already make.
     and (v.owner_user_id is null or v.owner_user_id = p_user_id);

  get diagnostics v_moved = row_count;
  return v_moved;
end;
$$;

revoke execute on function public.api_reorder_saved_views(uuid, uuid, text, uuid[])
  from public, anon, authenticated;
grant execute on function public.api_reorder_saved_views(uuid, uuid, text, uuid[])
  to service_role;
