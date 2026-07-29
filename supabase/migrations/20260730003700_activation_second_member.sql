-- #281 item 2 — a one-person workspace is a trial; a crew is a customer.
--
-- The issue's own words: "The first send by a SECOND member is very likely the
-- real retention predictor, and it is invisible."
--
-- It is a plausible claim and it deserves to be measurable before it is relied
-- on. A workspace where the owner alone texts has not changed how the business
-- runs; a workspace where a second person answers customers from the shared
-- number has. That is the behaviour the product exists to create, and D12's
-- 85% week-4 retention target is the number it should move.
--
-- WHY A COLUMN. The detection is "how many DISTINCT members have ever sent",
-- and that is the one funnel question that cannot be answered cheaply on the
-- hot path: without a stamp the count would run on every send for the life of
-- the workspace. Stamped once, it runs until the second member sends and never
-- again. Same reason `first_inbound_reply_at` is a column (#281 item 1).
--
-- Guarded on null like its sibling, so two members sending simultaneously
-- produce one stamp and one event.

alter table public.companies
  add column if not exists second_member_sent_at timestamptz;

comment on column public.companies.second_member_sent_at is
  'When a SECOND distinct member first sent an outbound message (#281). Null means one person is doing all the texting, which is a trial rather than a crew however long they have paid. Stamped once, guarded on null, never cleared. Counts distinct senders, so the owner sending twice does not set it.';

create index if not exists companies_second_member_sent_at_idx
  on public.companies (second_member_sent_at)
  where second_member_sent_at is not null;
