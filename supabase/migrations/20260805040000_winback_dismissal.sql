-- #277 follow-up — "I have read this, stop showing it to me."
--
-- The grace emails on day 1, 15 and 27 all link to /settings/billing, so that
-- page is already receiving win-back traffic on a cadence and has nothing to say
-- when somebody arrives. It will now answer the reason they gave for leaving,
-- beside the Resubscribe button. Anything shown three times needs a way to be
-- shown zero times, and there is no dismissal state anywhere in this schema.
--
-- A TIMESTAMP ON companies, COMPARED AGAINST canceled_at. Not a boolean, and
-- not a new table.
--
-- The property that matters is that a dismissal belongs to ONE cancellation.
-- Somebody who dismisses this, resubscribes, and cancels again a year later is a
-- different conversation, and the offer has to come back for it. A boolean would
-- stay true across that gap and silence the second cancellation with a decision
-- made about the first, which nobody could see and nothing would clear.
--
-- The grace ledger already solved this shape by keying
-- `(company_id, canceled_at, threshold_day)`, so the day-1 email sends again for
-- a second cancellation without anybody clearing a row. A timestamp gets the
-- same property with no table, no key and nothing to clear:
--
--     show the offer while  canceled_at is not null
--                     and  (winback_dismissed_at is null
--                            or winback_dismissed_at < canceled_at)
--
-- It works because the SECOND cancellation stamps a NEW canceled_at that is
-- later than the old dismissal — and because resubscribing nulls canceled_at
-- outright (the checkout activation claim clears it unconditionally; that column
-- IS the grace clock). So the dismissal ages out by itself, the moment there is
-- a newer cancellation to age out against. Nothing sweeps it, nothing resets it,
-- and there is no state that can be left behind wrong.
--
-- It is also honest under the clock going backwards: a dismissal recorded before
-- the cancellation it was meant for simply does not suppress it, which is the
-- safe direction — the offer reappears rather than silently never arriving.
--
-- NULLABLE, NO DEFAULT. Null means "never dismissed", which is what every
-- existing row is and what every new one should be. A default of now() would
-- mean every workspace has already declined an offer it has never seen.

alter table public.companies
  add column if not exists winback_dismissed_at timestamptz;

comment on column public.companies.winback_dismissed_at is
  '#277: when somebody dismissed the win-back answer on the billing screen. '
  'Meaningful only against canceled_at — the offer is suppressed while '
  'winback_dismissed_at >= canceled_at, so a LATER cancellation (which stamps a '
  'newer canceled_at) brings it back with nothing to clear. Null means never '
  'dismissed.';

-- No index. Every read of this column is for ONE company by primary key, on a
-- screen that already has the row loaded (it rides the companies select
-- GET /v1/company already runs). An index here would be write cost for a
-- lookup that never happens.
