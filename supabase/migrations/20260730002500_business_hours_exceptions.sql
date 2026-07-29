-- #402 — the shop is closed on Christmas and a weekly loop cannot know it.
--
-- Business hours are seven recurring weekdays. Christmas Day falls on a
-- Thursday, the schedule says Thursday 08:00-17:00, and so at 10am on
-- Christmas morning the product believed the shop was open. A homeowner with
-- a burst pipe texted and got SILENCE, because the away-reply only fires
-- outside the weekly window.
--
-- An auto-reply matters MORE on a holiday than on an ordinary evening. At 9pm
-- on a Tuesday the customer knows why nobody replied and waits until morning.
-- On Christmas Day silence is ambiguous -- closed, or ignoring me? -- and the
-- customer resolves that ambiguity by calling somebody else.
--
-- ---------------------------------------------------------------------------
-- OWNER-SET DATES, NOT A BUILT-IN HOLIDAY CALENDAR.
--
-- A calendar needs per-province and per-state data maintained forever, and
-- Canadian statutory holidays vary BY PROVINCE -- Quebec observes
-- St-Jean-Baptiste on 24 June, which is a holiday nowhere else in the country.
-- It would also be wrong for the trades we sell to: emergency plumbing and
-- HVAC are busiest exactly when everyone else is closed, and a shop that works
-- Boxing Day would spend every year fighting the default.
--
-- The same mechanism covers a vacation week, a funeral and a training day,
-- which a holiday calendar never would.

alter table public.companies
  add column if not exists business_hours_exceptions jsonb not null default '[]'::jsonb;

comment on column public.companies.business_hours_exceptions is
  '#402: dates that override the weekly business_hours loop. An array of '
  '{from, to, hours, note} -- hours null means closed all day, and a range '
  'covers a vacation week as one entry. Validated in packages/shared '
  '(isValidHoursExceptions); the shape is enforced there, not here, so the '
  'four surfaces share one rule.';

-- An array, always. A null would make every reader decide what null means,
-- and the answers would drift.
alter table public.companies
  drop constraint if exists companies_hours_exceptions_is_array;
alter table public.companies
  add constraint companies_hours_exceptions_is_array
  check (jsonb_typeof(business_hours_exceptions) = 'array');
