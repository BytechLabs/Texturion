-- ---------------------------------------------------------------------------
-- #297 — one notification a day, and a way to know it already went.
--
-- "An owner does not want every event; they want to know how the day went —
-- what came in, what is still unanswered, what is due tomorrow. That is one
-- notification a day and it is probably the most-read thing we could send."
--
-- ---------------------------------------------------------------------------
-- WHY A DATE COLUMN AND NOT A LEDGER TABLE
--
-- The only question this has to answer is "has today's gone yet", and it is
-- asked once per member per tick against a row the sweep is already reading.
-- A ledger would hold one row per member per day forever to answer a question
-- whose useful lifetime is 24 hours.
--
-- It stores the member's LOCAL date, not a timestamp. "Has today's summary
-- gone" is a question about their calendar day, and comparing instants would
-- send a second one to anybody whose clock crossed midnight differently from
-- the server's.
-- ---------------------------------------------------------------------------

alter table public.notification_prefs
  add column if not exists summary_sent_on date;

comment on column public.notification_prefs.summary_sent_on is
  '#297: the member''s own local date on which their daily summary last went. '
  'NULL means never. Compared against their local date rather than an '
  'instant, because "has today''s gone" is a question about their calendar.';

-- The sweep's only read: members who asked for a summary at all. Partial,
-- because almost nobody will — this is an opt-in, and the index should cost
-- nothing for the workspaces that never touch it.
create index if not exists notification_prefs_summary_idx
  on public.notification_prefs (company_id, user_id)
  where summary_at is not null;
