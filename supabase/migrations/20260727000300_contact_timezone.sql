-- ===========================================================================
-- [#292 / D49] contacts.timezone — the correction, and only the correction.
--
-- Quiet hours are destination-local (D4), inferred from the area code. Area
-- codes lie: a mobile number keeps its original code when its owner moves
-- provinces, which is common and getting more so. Before this there was no way
-- for a dispatcher who KNOWS a customer is in Alberta to say so, and every
-- future send re-derived the same wrong answer.
--
-- NULL MEANS "ASK THE INFERENCE", and that is the whole design. Storing the
-- inferred zone alongside the override would look tidier and would rot: the
-- NANP table gets corrected, and every contact keeps whatever answer it was
-- given the day it was created, with nothing to distinguish a stale copy from
-- a deliberate choice. A null column is always current, and provenance —
-- inferred vs set by a person — falls out of it instead of needing a second
-- column that can disagree with the first.
--
-- The check is deliberately loose (an "Area/Location" shape, or the canonical
-- "UTC"), because Postgres cannot see the runtime's tzdata and a strict list
-- here would go stale every time IANA renames a zone. The API validates
-- against `Intl.DateTimeFormat` (routes/core/timezone.ts) the same way it does
-- for companies.timezone; this constraint is the backstop that keeps obvious
-- rubbish out of the column.
-- ===========================================================================

alter table public.contacts
  add column if not exists timezone text;

alter table public.contacts
  drop constraint if exists contacts_timezone_shape;
alter table public.contacts
  add constraint contacts_timezone_shape
  check (
    timezone is null
    or timezone = 'UTC'
    or timezone ~ '^[A-Za-z][A-Za-z_+-]*/[A-Za-z0-9_+/-]+$'
  );

comment on column public.contacts.timezone is
  '#292/D49: a human correction to the area-code inference. NULL means infer — never a cached copy of the inferred value, which would go stale when the NANP table is corrected.';
