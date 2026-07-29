-- #281 — the half of activation D12 defines and nothing could measure.
--
-- D12: "company sends its first outbound SMS AND receives an inbound reply
-- within 7 days of payment. Target: 60% of paying signups activated in week 1."
--
-- Four funnel events already exist (checkout_completed, registration_submitted,
-- registration_approved, first_outbound_sent), and they cover payment → send
-- with the 10DLC wait isolated. But the REPLY was never recorded, so the number
-- we could compute was the outbound half only — which counts every workspace
-- that texted once into silence as activated, and systematically OVERSTATES the
-- metric. A 60% target is unfalsifiable while the numerator is a different
-- quantity from the definition.
--
-- WHY A COLUMN AND NOT JUST AN EVENT. Two reasons.
--
--   1. "First ever" has to be exact. A heuristic existence check over messages
--      cannot cheaply distinguish "our first reply" from "an inbound on a
--      thread the customer started" — the second is the product working but it
--      is not a reply to us, and conflating them re-introduces the overstating
--      this issue is about. A stamped column answers it in one indexed write.
--   2. D12's target has to be REPORTABLE, which means the 7-day window needs
--      computing against payment. PostHog can do that for funnels; a column
--      lets the same question be asked in SQL, next to the subscription dates
--      it has to be compared with.
--
-- The write is guarded `where first_inbound_reply_at is null`, so two replies
-- landing together produce one stamp and the loser writes nothing.

alter table public.companies
  add column if not exists first_inbound_reply_at timestamptz;

comment on column public.companies.first_inbound_reply_at is
  'When this workspace first received an inbound message on a conversation it had already texted — the REPLY half of D12 activation (#281). Null means the loop has never closed: they may have sent, but nobody answered. Stamped once, guarded on null, and never cleared. An inbound on a thread the CUSTOMER started does not set it: that is the product working, but it is not a reply to us, and counting it would overstate activation exactly as the outbound-only metric did.';

-- The activation question is always "of the companies that paid, how many
-- replied within 7 days", so it is asked by subscription date and answered by
-- this column. Partial index: the rows that matter are the ones that HAVE a
-- reply, and a null-heavy column indexed whole is mostly dead weight.
create index if not exists companies_first_inbound_reply_at_idx
  on public.companies (first_inbound_reply_at)
  where first_inbound_reply_at is not null;
