-- #540 — let a member take a measure off their own landing screen.
--
-- ## Why this lives on the membership
--
-- The set belongs to a PERSON IN A COMPANY, not to a person and not to a
-- company. The bookkeeper who only wants the pipeline and the foreman who only
-- wants response time are the same two people in one workspace; and somebody in
-- two workspaces reasonably wants a different screen in each.
-- `company_members` is already exactly that pair, and already carries
-- per-membership state (`joining_note`), so this is a column there rather than a
-- fifth table keyed on the same two ids.
--
-- ## Why a text[] and not five booleans
--
-- Five booleans means a migration every time the dashboard gains a card, and a
-- schema that has to be read to find out what the product currently shows. The
-- list of panels is a product decision that changes; the fact that a member has
-- put SOME of them away does not. The ids are validated in the API against the
-- shared module, and unknown ids are dropped on read rather than rejected, so a
-- client one release behind never sees a broken screen.
--
-- Stored as "hidden" rather than "shown" so that the default is the empty array
-- and a new card appears for everybody automatically. Storing what is shown
-- would mean every existing member's screen silently stops growing.

alter table public.company_members
  add column if not exists dashboard_hidden text[] not null default '{}';

comment on column public.company_members.dashboard_hidden is
  '#540: dashboard panels THIS member has put away (packages/shared/src/dashboard-panels.ts). Hidden rather than shown, so a new card appears for everybody by default. Queue sections are deliberately not in the hideable set — hiding unclaimed work is how a customer gets missed.';

-- The only writer.
--
-- A plain UPDATE from the API onto this table would be an UPDATE onto the table
-- that also holds `role`, and the blast radius of getting that wrong once is a
-- silent privilege change. This function names the one column it may touch, so
-- there is no statement anywhere in the product that can write a role by
-- accident while saving a layout preference.
--
-- Returns the stored array so the caller renders what the database actually
-- holds rather than what it hoped it sent.
create or replace function public.api_set_dashboard_hidden(
  p_company_id uuid,
  p_user_id    uuid,
  p_hidden     text[]
)
returns text[]
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hidden text[];
begin
  update public.company_members
     set dashboard_hidden = coalesce(p_hidden, '{}'),
         updated_at       = now()
   where company_id = p_company_id
     and user_id    = p_user_id
     and deactivated_at is null
  returning dashboard_hidden into v_hidden;

  -- No active membership: say so rather than reporting a saved preference that
  -- was written nowhere. The route turns this into a 403, matching every other
  -- membership check.
  if v_hidden is null then
    raise exception 'no active membership for this user in this company'
      using errcode = 'no_data_found';
  end if;

  return v_hidden;
end;
$$;

comment on function public.api_set_dashboard_hidden(uuid, uuid, text[]) is
  '#540: save which dashboard panels a member has put away. The only writer of company_members.dashboard_hidden, and it can touch no other column — the table also holds role.';

revoke all on function public.api_set_dashboard_hidden(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.api_set_dashboard_hidden(uuid, uuid, text[]) to service_role;
