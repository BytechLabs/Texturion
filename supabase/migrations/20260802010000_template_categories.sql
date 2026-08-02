-- ---------------------------------------------------------------------------
-- #274 — organising a template list that has outgrown a flat one.
--
-- "A flat list works at five templates and collapses at thirty." Two things
-- fix that, and they fix different halves of it:
--
--   * SORT BY USE, for the picker. Somebody about to send is looking for the
--     reply they send twenty times a day, and alphabetical order puts it
--     wherever its name happens to fall. This needs no schema — the #475
--     ledger already knows.
--   * CATEGORY, for the settings list. Somebody maintaining thirty templates
--     is looking for a GROUP of them ("all the quoting ones"), which no amount
--     of ordering answers.
--
-- # Free text, not a fixed set
--
-- Same reasoning that settled #298's tag question: a plumber's categories are
-- not an HVAC company's, and a taxonomy we impose gets ignored in favour of
-- whatever people were doing already. The editor offers the categories this
-- workspace has already used, so the common path is one tap and the uncommon
-- one is still open.
--
-- Nullable, and most templates will stay that way. A category is worth typing
-- at thirty templates and pure friction at five, so nothing requires it.
-- ---------------------------------------------------------------------------

alter table public.templates
  add column if not exists category text;

alter table public.templates
  drop constraint if exists templates_category_len;
alter table public.templates
  add constraint templates_category_len
  check (category is null or char_length(btrim(category)) between 1 and 40);

comment on column public.templates.category is
  '#274: the crew''s own grouping for a saved reply. Free text and optional — '
  'a taxonomy we imposed would be ignored, and a category is worth typing at '
  'thirty templates and friction at five. 40 chars: a label, not a sentence.';

-- Listing one workspace's templates by category is the settings screen's whole
-- query. Partial, because the majority of rows are expected to be null and
-- indexing those buys nothing.
create index if not exists templates_company_category_idx
  on public.templates (company_id, category)
  where category is not null;

-- ---------------------------------------------------------------------------
-- The picker's list: every template, most-used first.
--
-- Returns the FULL row (the picker needs the body) with the usage counts
-- joined, so a composer opens its picker with one request rather than fetching
-- a list and then a separate usage table to sort it by.
--
-- Deleted templates are excluded here as everywhere: #419's delete is soft so
-- an accidental one is recoverable, but a deleted reply has no business in the
-- list you send from.
-- ---------------------------------------------------------------------------
create or replace function public.api_templates_by_use(p_company_id uuid)
returns table (
  id         uuid,
  name       text,
  body       text,
  category   text,
  updated_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  uses       bigint,
  last_used  timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id,
    t.name,
    t.body,
    t.category,
    t.updated_by,
    t.created_at,
    t.updated_at,
    count(u.id)::bigint,
    max(u.used_at)
  from public.templates t
  left join public.template_uses u on u.template_id = t.id
  where t.company_id = p_company_id
    and t.deleted_at is null
  group by t.id
  -- Most-used first, then the name so the tail is stable rather than arbitrary.
  -- A never-used template still appears: a picker that hid them would hide
  -- every template a crew has just written.
  order by count(u.id) desc, t.name
  limit 500
$$;

revoke execute on function public.api_templates_by_use(uuid)
  from public, anon, authenticated;
grant execute on function public.api_templates_by_use(uuid) to service_role;

-- The usage list gains the category too, so the settings screen can group the
-- same rows it already reads counts from.
drop function if exists public.api_template_usage(uuid);

create or replace function public.api_template_usage(p_company_id uuid)
returns table (
  template_id uuid,
  name        text,
  category    text,
  uses        bigint,
  edits       bigint,
  last_used   timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id,
    t.name,
    t.category,
    count(u.id)::bigint,
    count(u.id) filter (where u.edited)::bigint,
    max(u.used_at)
  from public.templates t
  left join public.template_uses u on u.template_id = t.id
  where t.company_id = p_company_id
    -- #419 soft delete: a deleted template is not in the picker, so it has no
    -- business in the list that sorts the picker. Its rows survive for the
    -- undelete; they just do not show.
    and t.deleted_at is null
  group by t.id, t.name, t.category
  -- Busiest first: the ones carrying the work are obvious, and the tail is
  -- where the dead ones live.
  order by count(u.id) desc, t.name
$$;

revoke execute on function public.api_template_usage(uuid)
  from public, anon, authenticated;
grant execute on function public.api_template_usage(uuid) to service_role;
