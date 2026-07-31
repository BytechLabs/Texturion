-- #481 — the off-ramp: point a departing business's customers at their new
-- number, while we still hold the old one.
--
-- WHAT #413 ALREADY DOES is warn: it tells a cancelling customer that their
-- number goes back to the carrier and is eventually sold to somebody else, and
-- suggests they message their own contacts before the deadline. This is the
-- version where we help instead of only warning.
--
-- WHY IT IS A PRE-RELEASE FEATURE, AND MUST READ AS ONE. After release the
-- number is not ours and nothing can answer from it. So this only works inside
-- the 30-day grace window, and the framing that is true is "tell the people who
-- text you, while we still can" — never "forwarding after you leave". A feature
-- whose name promises what it cannot do is worse than its absence.
--
-- THE MESSAGE IS THEIRS, NOT OURS. Every other automated send in this product
-- is words the business wrote — the away reply, the missed-call text-back. A
-- sentence we compose and send to people who never agreed to hear from us would
-- be us speaking for a company that has left. So the copy is authored by the
-- departing owner and stored here, and nothing is sent without an explicit
-- opt-in recorded alongside it.
--
-- FREE, AND CAPPED. The argument for charging is real carrier cost after the
-- subscription ended. The argument against is #399: being the vendor who was
-- straight with you on the way out is the referral channel, and invoicing
-- somebody for a courtesy as they leave is the story they tell instead. At a
-- cent a message and a per-workspace ceiling the exposure is a couple of
-- dollars per departure, which is the cheapest goodwill this product can buy.
-- Bounded rather than unlimited, per the cost posture: capped BEFORE prompted,
-- and the ceiling is on the workspace, not on us.

alter table public.companies
  add column if not exists offramp_message text
    check (offramp_message is null or length(btrim(offramp_message)) between 1 and 320),
  add column if not exists offramp_opted_in_at timestamptz;

comment on column public.companies.offramp_message is
  '#481: the departing owner''s OWN words, sent once to each contact who texts '
  'the old number during the grace window. Never composed by us — this is a '
  'message from a business to its own customers.';

comment on column public.companies.offramp_opted_in_at is
  '#481: when the owner explicitly turned the off-ramp on. NULL means nothing '
  'is sent, whatever else is set. Recorded as a timestamp rather than a boolean '
  'because "when did they agree" is the question an audit asks.';

-- The two are meaningless apart: a message with no opt-in is a draft, and an
-- opt-in with no message is a send with nothing to say. Enforced here so the
-- pair cannot come apart through a route nobody thought about.
alter table public.companies
  drop constraint if exists companies_offramp_pair;
alter table public.companies
  add constraint companies_offramp_pair check (
    (offramp_message is null and offramp_opted_in_at is null)
    or (offramp_message is not null and offramp_opted_in_at is not null)
  );

-- ---------------------------------------------------------------------------
-- Once per contact, for the whole window.
--
-- The away reply's throttle is per conversation and measured in minutes, which
-- is the right rule for "we are closed" and the wrong one here: a customer who
-- texts the old number in week one and again in week three should be told once,
-- not twice. So this records the fact per conversation rather than relying on a
-- rolling window, and the send path checks it.
-- ---------------------------------------------------------------------------
alter table public.conversations
  add column if not exists offramp_sent_at timestamptz;

comment on column public.conversations.offramp_sent_at is
  '#481: when this contact was told the business has moved. Set once; the send '
  'path refuses a second one for the whole grace window.';

-- The send path asks "has this conversation been told yet", which is a primary
-- key lookup, and the JOB asks "how many have been told" for the ceiling. The
-- partial index serves the second; the first needs nothing.
create index if not exists conversations_offramp_idx
  on public.conversations (company_id)
  where offramp_sent_at is not null;
