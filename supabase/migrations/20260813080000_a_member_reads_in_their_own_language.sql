-- #228 Phase 1 — the THIRD locale, and the one the app itself is drawn in.
--
-- Two already exist and neither answers this question. `companies.locale`
-- (20260804520000) is the language the BUSINESS texts its customers in.
-- `contacts.locale` is the language ONE customer is texted in. Both are about
-- what a customer receives. Neither says anything about the person holding the
-- phone that sends it.
--
-- A crew is not one language. The owner of a Montreal shop may run the business
-- in French and employ a tech who reads English, or the reverse — and the
-- setting that decides what the CUSTOMER receives must not also decide what the
-- CREW reads, because those are different people making different choices.
-- Collapsing them would mean a bilingual shop has to pick which half of its
-- staff can use the app comfortably.
--
-- NULLABLE, and the null is load-bearing in the same way `contacts.locale`'s
-- is — but it means something different, so it is worth stating rather than
-- assuming the pattern carries:
--
--   contacts.locale  null → "whatever the BUSINESS works in"
--   profiles.locale  null → "whatever this DEVICE is set to, and only then the
--                            business" (#228: user > device > company > English)
--
-- The device is in the middle because a phone's language is a choice its owner
-- already made, once, for everything on it — and it is a better guess about
-- what somebody reads than a company setting made by their employer. It cannot
-- be stored here, because the answer differs per device for the same person:
-- the resolution happens on the client, and this column is only the override
-- that outranks it.
--
-- Per USER, not per membership. Somebody in two workspaces reads in one
-- language, and putting this on `company_members` would let one workspace's
-- setting silently change what they read in the other.

alter table public.profiles
  add column if not exists locale text
    check (locale is null or locale in ('en', 'fr-CA'));

comment on column public.profiles.locale is
  '#228: the language this MEMBER reads the app in. Null means "ask the '
  'device, then the workspace" — never English directly. Distinct from '
  'companies.locale (what customers are texted in), because a bilingual shop '
  'must not have to choose which half of its crew can use the app.';
