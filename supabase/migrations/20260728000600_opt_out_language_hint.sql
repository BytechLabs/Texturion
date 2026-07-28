-- #396: a plain-English opt-out is legally binding and we only ever saw the
-- keyword.
--
-- Since April 2025 an opt-out must be honoured however it is phrased. Our own
-- blog tells customers exactly that. Everything that detects one today needs
-- the literal STOP: Telnyx's profile block matches an exact keyword,
-- `stop_keyword` matches the same, and the carrier reconciliation only learns
-- from a 40300 that a keyword already caused. "Please stop texting me" lands in
-- the inbox as ordinary text and the contact stays textable.
--
-- Worse in a SHARED inbox, which is the product's whole point: the tech who
-- reads it at 4pm is not the one who follows up at 9am.
--
-- THIS IS A FLAG, NOT AN OPT-OUT, and the column name says so. An opt-out
-- cannot be lifted by us by design — only the customer texting START clears it,
-- because the record is theirs (#331). So a false positive here would
-- PERMANENTLY silence a paying customer's real lead with no way back for either
-- of us. A missed opt-out is a violation; a wrong one is unrecoverable. The
-- product warns loudly and a human decides.
alter table public.conversations
  add column if not exists opt_out_hint_at timestamptz;

comment on column public.conversations.opt_out_hint_at is
  '#396: when an inbound message on this thread last READ as a plain-English '
  'opt-out ("stop texting me", "take me off your list"). A WARNING for the '
  'crew, never an opt-out — only the contact can opt out, and only they can '
  'lift it. Cleared when a human dismisses it or the contact opts out for real.';

-- Partial index: the inbox only ever asks for the flagged ones, and flagged
-- threads are rare by construction.
create index if not exists conversations_opt_out_hint_idx
  on public.conversations (company_id, opt_out_hint_at desc)
  where opt_out_hint_at is not null;
