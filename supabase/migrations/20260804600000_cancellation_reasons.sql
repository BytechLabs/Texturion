-- #277 — why somebody left, which is the thing we were choosing not to ask.
--
-- Cancellation runs through the Stripe portal, so the only thing that reaches
-- us is a webhook. Ten cancellations for ten reasons is noise; ten for the same
-- reason is a roadmap, and today both look identical.
--
-- RECORDED AT INTENT, CONFIRMED BY THE WEBHOOK, and the two-step shape is the
-- whole design rather than an implementation detail.
--
-- The reason has to be asked BEFORE the handoff to Stripe: afterwards the
-- person has gone, and nobody answers a survey about a product they just left.
-- But stating a reason is not leaving. Some people read the screen, see the
-- pause offer or the export link, and stay.
--
-- So a row here means "somebody said why they were going", and `confirmed_at`
-- means the subscription actually ended afterwards. That gives two numbers
-- instead of one, and the second is arguably the more useful:
--
--   reasons WITH confirmation      why customers actually leave
--   reasons WITHOUT confirmation   who we talked out of it, and what we said
--
-- Collapsing them, by only writing the row when the webhook lands, would throw
-- the save away and leave nothing to measure a retention offer against.
--
-- THE REASON IS A FREE-TEXT CODE, not an enum. An enum needs a migration to add
-- a choice, and the list of reasons is exactly the thing expected to change as
-- we learn what people say. The check constraint bounds the length; the client
-- offers a short fixed list, and `detail` carries anything that did not fit.
--
-- NOTHING IS REQUIRED. #277's own devil's advocate is binding here: "a reason we
-- cannot skip is a reason we cannot trust", and cancelling must never take more
-- steps than subscribing did. Both columns are nullable, and a row with neither
-- is a legitimate record that somebody skipped the question.

create table if not exists public.cancellation_reasons (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  -- Who said it. Kept because "the owner left" and "an admin cancelled" are
  -- different stories, and the second is worth a phone call.
  user_id      uuid references auth.users(id) on delete set null,
  -- A short code the client picked from its list: 'too_expensive', 'seasonal',
  -- 'missing_feature', 'switched', 'not_using', 'other'. Deliberately not an
  -- enum: see above.
  reason       text check (reason is null or char_length(reason) <= 40),
  -- Their own words. The most valuable column in the table and the one most
  -- likely to be empty.
  detail       text check (detail is null or char_length(detail) <= 2000),
  -- Set when `customer.subscription.deleted` lands afterwards. Null means they
  -- said why and then did not go.
  confirmed_at timestamptz,
  created_at   timestamptz not null default now()
);

-- One open (unconfirmed) statement per workspace at a time. Somebody who opens
-- the cancel screen three times has not given three reasons, and three rows
-- would triple-count them in every report. The API upserts on this.
create unique index if not exists cancellation_reasons_open_idx
  on public.cancellation_reasons (company_id)
  where confirmed_at is null;

-- The report reads by company and recency.
create index if not exists cancellation_reasons_company_idx
  on public.cancellation_reasons (company_id, created_at desc);

comment on table public.cancellation_reasons is
  '#277: why a workspace said it was leaving, asked before the Stripe handoff. '
  'confirmed_at is stamped when the subscription actually ends; a row without '
  'it is somebody who said why and then stayed.';

alter table public.cancellation_reasons enable row level security;

-- Service-role only. Every read is a report the owner of THIS product runs, not
-- something a customer queries, and the API writes it with the service key.
-- RLS is enabled with no end-user policy, which is the house pattern for a
-- ledger of this kind (schema.test.sql T1 requires the enable either way).
