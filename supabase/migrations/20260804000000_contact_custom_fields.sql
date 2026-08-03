-- ---------------------------------------------------------------------------
-- #291 — the fields this trade needs, which are not the fields the next one
-- needs.
--
-- "The equipment fields an HVAC company needs are not the ones a plumber
-- needs, and we should not guess for either." Boiler model and serial, gate
-- code, warranty expiry, which rooftop the plant is on — all of it currently
-- lives in the notes blob or nowhere.
--
-- The issue calls this the real prize: "A crew that knows the boiler model
-- before the truck leaves the shop wins the job; one that finds out on site
-- loses an hour."
--
-- ---------------------------------------------------------------------------
-- THE PRIVACY DECISION, MADE HERE RATHER THAN DISCOVERED LATER
--
-- #291 flags it plainly: "Custom fields let a customer store data classes we
-- have not declared — worth a deliberate decision about what we tell them not
-- to put there."
--
-- The decision: these fields are DECLARED AS CONTACT DATA and nothing more.
-- Our store data-safety declarations (#254), our retention policy (#284) and
-- our export/erasure promises (#227) all cover "information about the
-- customer", which is what an equipment serial or a gate code is.
--
-- What a workspace must NOT put here is anything from a category we have not
-- declared and could not honour: payment card numbers, government
-- identifiers, or health information. We cannot enforce that — a text field
-- accepts anything — so the product SAYS it, at the moment somebody defines a
-- field, which is the only moment they are thinking about what goes in it.
-- The copy lives in @loonext/shared so all three clients say it identically.
--
-- ---------------------------------------------------------------------------
-- WHY DEFINITIONS ARE ROWS AND VALUES ARE JSONB
--
-- The definitions are workspace configuration: a handful of rows, edited
-- rarely, ordered deliberately, and needing a stable key that survives a
-- relabel. Rows.
--
-- The values are per contact, always read WITH the contact, and never queried
-- independently of it. A join table would add a round trip to every contact
-- read to hold at most ten short strings. JSONB, keyed by the definition's
-- key — the same shape #297's delivery preferences use, for the same reason.
-- ---------------------------------------------------------------------------

create table if not exists public.contact_field_defs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,

  -- The stable identity. Values are keyed on THIS, so renaming the label
  -- ("Boiler model" -> "Appliance model") keeps every value attached.
  key         text not null,

  label       text not null,

  -- Deliberately few. Every type here is one a crew can fill in from a van
  -- without thinking about it; a "formula" or a "lookup" is a spreadsheet
  -- feature that would arrive with its own support burden.
  kind        text not null check (kind in ('text', 'number', 'date', 'select', 'checkbox')),

  -- Only for 'select'. NULL for everything else.
  options     text[],

  -- Display order, so an owner can put the field they read most at the top.
  position    integer not null default 0,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- One definition per key per workspace. Two fields called "serial" is a
  -- record nobody can read.
  unique (company_id, key),

  -- A select with no options is a dropdown that cannot be used, and options on
  -- anything else are a promise the input will not keep.
  constraint contact_field_defs_options_ck check (
    (kind = 'select' and options is not null and array_length(options, 1) between 1 and 40)
    or (kind <> 'select' and options is null)
  ),

  -- A key has to survive being a JSON key and a CSV header (#248 import
  -- mapping, #227 export), so it is snake_case and nothing else.
  constraint contact_field_defs_key_ck
    check (key ~ '^[a-z][a-z0-9_]{0,39}$')
);

comment on table public.contact_field_defs is
  '#291: a workspace''s own contact fields. DECLARED AS CONTACT DATA — the '
  'same class as a name or an address, covered by the same retention, export '
  'and erasure promises. A workspace must not store payment, government-ID or '
  'health data here; the product says so where fields are defined, because we '
  'cannot enforce it in a text column.';

create index if not exists contact_field_defs_company_idx
  on public.contact_field_defs (company_id, position, created_at);

alter table public.contact_field_defs enable row level security;
revoke all on public.contact_field_defs from public, anon, authenticated;
grant select, insert, update, delete on public.contact_field_defs to service_role;

-- ---------------------------------------------------------------------------
-- The values.
-- ---------------------------------------------------------------------------
alter table public.contacts
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;

comment on column public.contacts.custom_fields is
  '#291: values for this workspace''s own fields, keyed by '
  'contact_field_defs.key. An ABSENT key means unanswered, which is different '
  'from an empty one — "we asked and they have no gate code" is a fact, and '
  'the blank string records it.';

-- Searchable and filterable, which is half the issue's complaint: "#291 asks
-- for searchable, filterable, available as merge fields, and included in
-- export". A GIN index over the whole object supports containment queries
-- ("every contact whose boiler_model is X") without an index per field.
create index if not exists contacts_custom_fields_gin
  on public.contacts using gin (custom_fields jsonb_path_ops);

-- Cap the payload, because an unbounded JSONB column on a row every read
-- touches is weight nobody chose to pay for.
--
-- A SIZE cap rather than a key count: Postgres forbids a subquery in a CHECK,
-- so counting keys is not expressible here — and size is the honest concern
-- anyway. Ten fields of a few dozen characters is well under this; four
-- kilobytes of "custom field" is somebody pasting a document into a contact
-- record, which the API refuses per field and this catches wholesale.
alter table public.contacts
  add constraint contacts_custom_fields_size_ck
  check (
    jsonb_typeof(custom_fields) = 'object'
    and length(custom_fields::text) <= 4000
  )
  not valid;
