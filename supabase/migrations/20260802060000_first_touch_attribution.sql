-- [#296] Which page produced this signup.
--
-- Six trade landing pages and three comparison pages are a real investment
-- with no feedback loop: nothing could say whether /compare or /for/plumbers
-- produced a customer, and #296's ask for per-competitor pages is explicitly
-- gated on that answer.
--
-- FIRST touch, which is the opposite of the referral capture. A reward follows
-- the link somebody actually arrived through (last touch); this asks which
-- page STARTED it. Every signup passes through /pricing, so last touch would
-- credit /pricing for everything and teach us nothing.
--
-- Two shapes on purpose. `signup_landing_path` is a column because it is the
-- thing every report groups by, and a jsonb key is a poor group-by. The rest
-- rides in `signup_first_touch` because campaign parameters are a bag whose
-- membership changes with whatever the ad platform emits, and widening a
-- column set for that would be a migration per campaign tool.
--
-- NOTHING HERE MAY CARRY PERSONAL DATA. The values are allow-listed and
-- sanitised in packages/shared/src/attribution.ts and re-sanitised server-side
-- on the way in: the web scrubber cuts every other query string precisely
-- because a query string can carry a contact name, and this is the one
-- enumerated exception to that rule.

alter table public.companies
  add column if not exists signup_landing_path text;

alter table public.companies
  add column if not exists signup_first_touch jsonb;

comment on column public.companies.signup_landing_path is
  '#296: the marketing path this workspace''s owner FIRST landed on, query '
  'stripped. A column rather than a jsonb key because every attribution report '
  'groups by it. Null for a signup with no recorded touch, which includes '
  'every workspace created before this shipped.';

comment on column public.companies.signup_first_touch is
  '#296: the rest of the first touch — referrer host and allow-listed campaign '
  'parameters. Never personal data: the allow-list is closed (utm_*, gclid, '
  'fbclid) and every value is length-capped and character-filtered.';

-- Reporting groups by landing path over a signup window, and only rows that
-- recorded one are interesting.
create index if not exists companies_signup_landing_idx
  on public.companies (signup_landing_path, created_at)
  where signup_landing_path is not null;
