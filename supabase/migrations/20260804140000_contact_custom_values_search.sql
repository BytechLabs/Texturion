-- #291 — find a customer by what is IN their custom fields.
--
-- "A crew that knows the boiler model before the truck leaves the shop wins
-- the job." That only pays if somebody can also go the other way: type the
-- serial off the unit in front of them and get the customer.
--
-- THE DECISION THAT SHAPES THIS FILE: values only, never keys.
--
-- The one-line version of this feature is `custom_fields::text ilike '%q%'`,
-- and it is wrong. That text carries the field KEYS as well, so a workspace
-- with a `boiler_model` field would return every contact that merely HAS the
-- field — including every one where it is blank — the moment somebody typed
-- "boiler". A search that answers with the whole address book is a search
-- people stop using, and it would look like it was working.
--
-- So the projection strips the keys, and the index is built on that.

-- ---------------------------------------------------------------------------
-- The values, and only the values.
-- ---------------------------------------------------------------------------
create or replace function public.contact_custom_values(p_fields jsonb)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  -- `order by key` because a generated column has to be deterministic: without
  -- it the aggregate order is whatever the hash iteration happens to give, and
  -- a value that changed order would rewrite the row for no reason.
  select coalesce(string_agg(entry.value, ' ' order by entry.key), '')
    from jsonb_each_text(coalesce(p_fields, '{}'::jsonb)) as entry
$$;

comment on function public.contact_custom_values(jsonb) is
  '#291: the VALUES of a contact''s custom fields, joined for search. Keys are '
  'deliberately excluded — including them would match every contact that has a '
  'field rather than every contact whose field says something.';

-- ---------------------------------------------------------------------------
-- Kept on the row, so search does not compute it per query.
-- ---------------------------------------------------------------------------
alter table public.contacts
  add column custom_values text
  generated always as (public.contact_custom_values(custom_fields)) stored;

comment on column public.contacts.custom_values is
  '#291: derived from custom_fields for search. Never written directly; it '
  'holds no information the row does not already carry.';

-- The same trgm treatment the name and phone arms already get, because this
-- joins the same `or` and a sequential scan on one arm makes the whole search
-- slow.
create index contacts_custom_values_trgm
  on public.contacts using gin (custom_values extensions.gin_trgm_ops);
