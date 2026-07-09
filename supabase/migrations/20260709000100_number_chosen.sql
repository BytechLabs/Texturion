-- Choose-your-number, phase 3/4: the SPECIFIC number a user picked (from the
-- refreshable picker) to be ordered exactly, instead of the auto-search picking
-- the first available. Kept SEPARATE from number_e164 (which stays "purchased/
-- owned only", written solely on activation) so the unique-when-not-released
-- index on number_e164 is never tripped by an unbought pick.
--
-- Set by the remediation route (on the existing paid row) and by
-- provisionCompanyNumber (drained from companies.chosen_number_e164 at checkout);
-- read by orderNumberForRow, which orders it directly and clears it on success
-- or on a 4xx (taken) fall-back. Additive + nullable; no backfill; null =
-- today's auto-search behavior, fully backward compatible.
alter table public.phone_numbers
  add column chosen_number_e164 text null;

comment on column public.phone_numbers.chosen_number_e164 is
  'A specific user-picked E.164 to order exactly (choose-your-number); null = auto-search the requested area code. Cleared on activation or on a taken-number fallback.';
