-- ---------------------------------------------------------------------------
-- #291 — a customer record with room for what a crew actually knows.
--
-- Today a contact is a phone, a name, one address and a notes blob. Everything
-- else a crew learns has to go in the notes, which means it is unstructured,
-- unsearchable as fields, unfilterable, and different for every person who
-- types it.
--
-- This migration adds the three things whose absence forecloses other features
-- outright:
--
--   EMAIL, because it is one of the two ways to reach a customer and we do not
--   store it — which also blocks quote delivery (#287), receipts (#224), and
--   simply having an address to fall back on when a text fails.
--
--   BUSINESS NAME, because a large share of this market's customers ARE
--   businesses. There is nowhere to record that "Dave" is Dave at Maple
--   Property Group, so the crew loses the relationship that pays them.
--
--   ADDRESSES, plural. A property manager has forty. A homeowner has one now
--   and a different one after they move, and the old job history must not
--   follow them to the wrong building.
--
-- ---------------------------------------------------------------------------
-- WHY ADDRESSES BECOME ROWS AND THE OLD COLUMN STAYS
--
-- `contacts.address` is read by the map (#214), by task addresses, and by merge
-- fields. Dropping it in the same migration that adds the table would mean a
-- deploy window where those read a column that no longer exists — the
-- expand/contract lesson this repo has already paid for once.
--
-- So this EXPANDS only: the table arrives, the column stays and keeps working,
-- and a later migration retires it once every reader has moved. The column is
-- the PRIMARY address until then, and the table's `is_primary` row mirrors it.
-- ---------------------------------------------------------------------------

alter table public.contacts
  -- One email. Not a list: a second email is a different person in practice,
  -- and every product that offered "email 2" ended up with a field nobody
  -- maintains and nobody trusts.
  add column if not exists email text,
  -- Who they work for, when that is the relationship. NULL for a homeowner,
  -- which is most of them.
  add column if not exists business_name text;

comment on column public.contacts.email is
  '#291: the customer''s email. NOT a second channel we may message on its own '
  'authority — consent (#226) is per channel, and nothing in this product may '
  'email a CONTACT without its own decision. Stored so a quote or a receipt '
  'has somewhere to go, and so a failed text has a fallback a human can use.';

comment on column public.contacts.business_name is
  '#291: the company this customer represents, when they represent one. A '
  'large share of this market''s customers are property managers, general '
  'contractors and stratas.';

-- Cheap sanity, not validation. An address-shaped string is the caller's
-- problem; a 400-character "email" is ours.
alter table public.contacts
  add constraint contacts_email_shape_ck
  check (email is null or (length(email) <= 254 and position('@' in email) > 1))
  not valid;

-- Searchable, because #291's whole complaint is that this knowledge is
-- unfindable. Same trigram arm the name and phone already use.
create index if not exists contacts_email_trgm
  on public.contacts using gin (email extensions.gin_trgm_ops);
create index if not exists contacts_business_trgm
  on public.contacts using gin (business_name extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Addresses, plural.
-- ---------------------------------------------------------------------------
create table if not exists public.contact_addresses (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  contact_id  uuid not null references public.contacts(id) on delete cascade,

  -- What the crew calls it: "Site", "Billing", "Unit 4". Free text because a
  -- fixed vocabulary would be wrong for the second trade that used it.
  label       text,
  address     text not null,

  -- Where the van goes by default. Exactly one per contact, enforced below —
  -- "which address" is a question with one answer, and a record that cannot
  -- answer it sends somebody to the wrong building.
  is_primary  boolean not null default false,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.contact_addresses is
  '#291: a customer''s addresses. A property manager has forty; a homeowner '
  'has one now and another after they move. EXPAND-only for now — '
  'contacts.address is still the primary and still read by the map, tasks and '
  'merge fields, and is retired in a later migration.';

create index if not exists contact_addresses_contact_idx
  on public.contact_addresses (company_id, contact_id, is_primary desc);

-- One primary, not zero-or-many. A partial unique index rather than a trigger:
-- the database enforces it on every path, including the ones nobody has
-- written yet.
create unique index if not exists contact_addresses_one_primary_uq
  on public.contact_addresses (contact_id)
  where is_primary;

alter table public.contact_addresses enable row level security;
revoke all on public.contact_addresses from public, anon, authenticated;
grant select, insert, update, delete on public.contact_addresses to service_role;
