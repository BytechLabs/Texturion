-- #370 — how big is the crew, captured once at signup.
--
-- WHY THIS COLUMN EXISTS. Every competitor priced in the teardown bills per
-- seat and we do not, so our price advantage is not a fixed discount — it
-- widens with every person the customer hires. Crew size is therefore the fact
-- that most changes how strong our own pitch is, and nothing in the funnel
-- knew it.
--
-- A BUCKET, NOT A NUMBER. "How many people" invites a question the asker cannot
-- answer confidently (does the owner count themselves? the part-timer?) and
-- produces false precision in every report built on it. The vocabulary lives in
-- packages/shared/src/crew-size.ts; text rather than an enum so adding a bucket
-- is a deploy rather than a migration plus a deploy.
--
-- NULLABLE, and it stays nullable. Every workspace that signed up before this
-- has no answer, and inventing one would poison the first cohort comparison
-- this is meant to enable. "Not asked" is a real value.
alter table public.companies
  add column if not exists crew_size text;

comment on column public.companies.crew_size is
  '#370: the crew-size bucket chosen at signup (solo | 2_3 | 4_10 | 11_plus), '
  'or null for a workspace that was never asked. Segments activation and '
  'retention reporting by the variable that decides how strong our per-seat '
  'price comparison is.';

-- Reporting reads "the cohort in this bucket", never one company's answer.
create index if not exists companies_crew_size_idx
  on public.companies (crew_size)
  where crew_size is not null;
