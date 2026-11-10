-- #722 phase 2: a quote send claims the draft with a short lease instead of
-- writing `sent` first and rolling back to `draft` when the text fails. The
-- quote machine allows no move back to draft, and now nothing makes one.
--
-- The lease is what still stops two taps sending one quote twice: a second
-- send finds the draft already claimed and is refused, until the claim is two
-- minutes old (a Worker that died mid-send).

alter table public.quotes
  add column if not exists sending_at timestamptz;

comment on column public.quotes.sending_at is
  'A send in progress claimed this draft at this time (a lease, not a state). '
  'Cleared when the send finishes, either way.';
