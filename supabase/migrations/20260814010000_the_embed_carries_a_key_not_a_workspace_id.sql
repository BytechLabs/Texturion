-- #232 — what the embed snippet actually carries.
--
-- The first draft of the widget route took a `companyId` from the request body,
-- and `auth/company.test.ts` refused it by name: "a handler that read
-- `company_id` out of a body would be scoping to a company the caller merely
-- NAMED". The guard has no exemption and should not have one.
--
-- It is right about more than the rule. A workspace id in the page source of
-- every customer's website is:
--
--   * an internal identifier published permanently, on domains we do not
--     control, in a place a search engine will cache;
--   * unrevocable — if a widget is abused there is nothing to rotate, because
--     the id is the workspace itself;
--   * a way to spend somebody else's daily budget by copying it out of one
--     site and posting it from anywhere.
--
-- A key fixes all three for the price of one column. It is public BY DESIGN —
-- it lives in a `<script>` tag — and it grants nothing on its own: everything
-- it can cause still passes the send gates and the budgets.
--
-- ROTATABLE, which is the property the company id could never have. An owner
-- whose key is being abused gets a new one, pastes a new snippet, and the old
-- key stops working the moment it changes.

alter table public.companies
  add column if not exists widget_key uuid not null default gen_random_uuid();

comment on column public.companies.widget_key is
  '#232: the public identifier the "Text us" embed carries, so a workspace id '
  'never appears in a customer''s page source. Rotatable — replacing it '
  'invalidates every embed of the old one.';

-- The resolver's only lookup.
create unique index if not exists companies_widget_key_uq
  on public.companies (widget_key);

-- ---------------------------------------------------------------------------
-- Resolve a key to a workspace, or to nothing.
--
-- A FUNCTION rather than a Worker-side select, for the reason #347 exists: a
-- bare `from("companies")` with no company scope is exactly the shape that
-- guard refuses, and rightly — the scoping here IS the key lookup, which is a
-- different rule that belongs in one named place rather than as an exception
-- to a general one.
--
-- Returns the id and nothing else. The caller needs a workspace to run the send
-- gates against; it does not need — and must not be handed — a name, a plan or
-- a number, because the caller is an anonymous request from a page we do not
-- control and every extra field is a fact a stranger can read out of it.
--
-- A closed workspace resolves to nothing. A widget left embedded on a site
-- outlives the account behind it, and the first thing that must not happen is
-- a text sent on behalf of a business that no longer exists.
-- ---------------------------------------------------------------------------
create or replace function public.api_company_for_widget_key(p_key uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id
    from public.companies
   where widget_key = p_key
     and deleted_at is null
   limit 1;
$$;

revoke execute on function public.api_company_for_widget_key(uuid)
  from public, anon, authenticated;
grant execute on function public.api_company_for_widget_key(uuid) to service_role;
