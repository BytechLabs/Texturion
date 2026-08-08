-- #288 — "How did you hear about us?", asked once, at signup.
--
-- ## Why passive attribution cannot answer this
--
-- #296 records the marketing page an owner first landed on and the referring
-- host, and #288 added `(referral)` for anyone who arrived through a link. Both
-- are real, and neither can see the case this business actually runs on: a
-- plumber is told about us at a supply-house counter, types the name into Google
-- a week later, and lands on the home page with no parameters, no referrer and
-- no campaign. Passively that is direct traffic — indistinguishable from a
-- stranger who found us by accident.
--
-- #288's devil's advocate asks for exactly this, and calls it the cheap step
-- worth doing BEFORE building a referral programme: "ask new signups how they
-- heard about us, and find out whether this channel exists before investing in
-- amplifying it."
--
-- ## Nullable, with no default and no CHECK
--
-- NULL means never answered, and that has to stay distinguishable from every
-- answer — a skipped optional question reported as "other" would quietly inflate
-- the one bucket nobody can act on. The same rule #370's crew_size follows.
--
-- No CHECK for the same reason crew_size has none: the vocabulary is validated
-- by Zod at the one route that writes it, and a constraint here would be a second
-- place to update the day a fifth answer is worth offering.

alter table public.companies
  add column if not exists signup_source text;

comment on column public.companies.signup_source is
  '#288: how this owner says they heard about us — SIGNUP_SOURCES in '
  'packages/shared/src/signup-source.ts. NULL means the question was skipped or '
  'predates it, which is deliberately not the same as any answer. Self-reported, '
  'and the only signal that can see word of mouth: a referred owner who arrives '
  'by typing our name into Google carries no landing path, no referrer and no '
  'campaign, so every passive measure reads them as direct traffic.';

-- Grouped by, never filtered on a single value, and the table is one row per
-- workspace — so the index is for the report rather than for a hot path.
create index if not exists companies_signup_source_idx
  on public.companies (signup_source)
  where signup_source is not null;
