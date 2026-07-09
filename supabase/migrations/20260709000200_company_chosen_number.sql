-- Choose-your-number, phase 4: the number a user picks during ONBOARDING,
-- staged on the company pre-checkout. It's drained onto the phone_numbers row
-- by provisionCompanyNumber when the paid checkout webhook fires (and nulled
-- here), so the webhook orders the EXACT number the user chose instead of
-- auto-searching. Additive + nullable; no backfill; null = auto-search.
alter table public.companies
  add column chosen_number_e164 text null;

comment on column public.companies.chosen_number_e164 is
  'Onboarding-picked E.164, staged pre-checkout; drained onto the phone_numbers row (and nulled) by provisionCompanyNumber. Null = auto-search the requested area code.';
