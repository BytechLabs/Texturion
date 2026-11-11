-- #736: the For you page is the member's to arrange: which panels, in what
-- order, and how wide (packages/shared/src/dashboard-layout.ts). Null means
-- the default, which follows the queue's urgency order on every load; a
-- stored layout is the member's own and stays as they left it.
--
-- Beside `dashboard_hidden` (#540), which the phones still read until they
-- arrange panels too: a panel taken off the page on the web is also added
-- there, so the phones put it away as well.

alter table public.company_members add column dashboard_layout jsonb;

comment on column public.company_members.dashboard_layout is
  '#736: this member''s For you layout, {panels: [{id, size}]}; null for the default. Holds no personal data, only panel ids and sizes.';

-- Returns what was stored, so the caller renders what the database holds.
create or replace function public.api_set_dashboard_layout(
  p_company_id uuid,
  p_user_id    uuid,
  p_layout     jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_found  boolean;
  v_layout jsonb;
begin
  update public.company_members
     set dashboard_layout = p_layout,
         updated_at       = now()
   where company_id = p_company_id
     and user_id    = p_user_id
     and deactivated_at is null
  returning true, dashboard_layout into v_found, v_layout;

  if v_found is null then
    raise exception 'no active membership for this user in this company'
      using errcode = 'no_data_found';
  end if;
  return v_layout;
end;
$$;

revoke execute on function public.api_set_dashboard_layout(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.api_set_dashboard_layout(uuid, uuid, jsonb)
  to service_role;
