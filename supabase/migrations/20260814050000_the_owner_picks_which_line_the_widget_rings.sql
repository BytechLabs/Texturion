-- #232 phase 3 — which of the workspace's numbers a website conversation lands
-- on.
--
-- Nullable, and null is the answer for nearly every workspace: Starter includes
-- one number, so there is nothing to choose and nothing is asked. It only
-- becomes a question on Pro, where a service line and a sales line can sit in
-- one workspace and the website should reach whichever one the owner staffs.
--
-- ============================================================================
-- NO FOREIGN KEY, AND THAT IS THE POINT OF THIS FILE
-- ============================================================================
--
-- The first version of this migration declared the obvious
-- `references public.phone_numbers(id) on delete set null`. It broke the
-- product.
--
-- `phone_numbers.company_id -> companies.id` already exists, so a reference the
-- other way gives PostgREST TWO relationships between the same pair of tables.
-- It then refuses every embed across that pair — not the new one, ALL of them —
-- with "Could not embed because more than one relationship was found for
-- 'phone_numbers' and 'companies'". Eighteen call sites in the Worker embed one
-- in the other. The E2E suite failed on an inbound carrier webhook and on the
-- number-release cron: a column that nothing had read yet stopped texts
-- arriving.
--
-- Adding the hint syntax (`phone_numbers!phone_numbers_company_id_fkey(...)`)
-- at all eighteen would work and would be the wrong trade: it makes every
-- future embed between these two tables a landmine, in exchange for a
-- constraint this column does not need.
--
-- It does not need it because the resolver already treats a choice that no
-- longer resolves as "not chosen". `resolveWidgetNumber` matches the id against
-- the workspace's ACTIVE numbers and falls back to the oldest — which it has to
-- do anyway, since SUSPENDED is not a delete and no foreign key would ever have
-- fired for it. The FK's only unique contribution was tidying the column on a
-- release, and a released number's id sitting in a row that reads it as "no
-- longer active" is the same outcome by a different route.
--
-- The drop below repairs any environment that applied the earlier version.

alter table public.companies
  add column if not exists widget_number_id uuid;

alter table public.companies
  drop constraint if exists companies_widget_number_id_fkey;

comment on column public.companies.widget_number_id is
  '#232: the number a website-widget conversation lands on. Null means "not '
  'chosen" — the resolver falls back to the oldest active number, which is '
  'what every workspace had before this column existed. A choice that is no '
  'longer active falls back the same way. Deliberately NOT a foreign key: a '
  'second relationship between companies and phone_numbers makes every '
  'PostgREST embed across that pair ambiguous. See the header of this '
  'migration.';
