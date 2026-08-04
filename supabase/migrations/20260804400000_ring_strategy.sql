-- [#278] How the phones ring, and for how long.
--
-- The last unmet line in #278's Acceptance: "Ring strategy and timeout are
-- configurable per number." Today every inbound call rings every eligible
-- phone at once for a fixed 45 seconds — which is the call-side twin of the
-- alert-fatigue problem #244 solved for notifications, and the reason people
-- put work phones on silent.
--
-- ---------------------------------------------------------------------------
-- WHY "IN TURN" IS A CASCADE AND NOT A HUNT.
--
-- Scope words the middle option as ringing "in order", and the obvious reading
-- is a hunt group: ring one phone, hang it up, ring the next. This does not do
-- that, deliberately. A hunt has a window on every hop where NOBODY's phone is
-- ringing — the previous leg is torn down before the next one connects — and
-- "the call reached nobody" is the failure this whole product is built to
-- avoid. It also loses the person who was reaching for their phone.
--
-- So each phone JOINS the ring rather than replacing it: the first member's
-- phone rings alone, then the second joins them, then the third. The owner
-- still gets first refusal, which is the thing a small crew actually wants,
-- and nobody is ever cut off mid-reach.
--
-- The ORDER is membership order, oldest first, which is what
-- computeRingContext already returns. That is deliberately the thing #366
-- called unfair for ring-all — "a member who sorts 25th is 25th on every call,
-- forever" — because here it is the POINT: the owner joined first, so the
-- owner's phone rings first. No new column, no new screen, and the one order a
-- crew can predict without being told.
-- ---------------------------------------------------------------------------

alter table public.companies
  add column if not exists ring_strategy text not null default 'all';

alter table public.companies
  drop constraint if exists companies_ring_strategy_check;
alter table public.companies
  add constraint companies_ring_strategy_check
  check (ring_strategy in ('all', 'in_turn'));

-- Per number, and NULL means inherit — the same rule as every other identity
-- column since #307, and never "ring all".
alter table public.phone_numbers
  add column if not exists ring_strategy text;

alter table public.phone_numbers
  drop constraint if exists phone_numbers_ring_strategy_check;
alter table public.phone_numbers
  add constraint phone_numbers_ring_strategy_check
  check (ring_strategy is null or ring_strategy in ('all', 'in_turn'));

-- ---------------------------------------------------------------------------
-- How long the phones ring before the caller gets the greeting.
--
-- The ceiling is 45 and is NOT arbitrary: it is RING_TIMEOUT_SECS, the
-- leg-level bound each dial carries, which the calls-v3 spec marks load-bearing
-- ("the outer bound on §7.7's ambiguous-dial orphans — must not be raised").
-- A session window longer than the leg timeout would be a window during which
-- the legs have already died, so the column refuses to express it rather than
-- letting a screen promise sixty seconds of ringing that cannot happen.
--
-- The floor is 10. Below that a mobile member has not finished being woken by
-- a push, so the call is decided before the crew could possibly have answered
-- it — which reads to a caller as nobody being there, and reads to the crew as
-- calls that never rang.
-- ---------------------------------------------------------------------------
alter table public.companies
  add column if not exists ring_seconds integer not null default 45;

alter table public.companies
  drop constraint if exists companies_ring_seconds_check;
alter table public.companies
  add constraint companies_ring_seconds_check
  check (ring_seconds between 10 and 45);

alter table public.phone_numbers
  add column if not exists ring_seconds integer;

alter table public.phone_numbers
  drop constraint if exists phone_numbers_ring_seconds_check;
alter table public.phone_numbers
  add constraint phone_numbers_ring_seconds_check
  check (ring_seconds is null or ring_seconds between 10 and 45);

comment on column public.companies.ring_strategy is
  'How eligible phones ring (#278). all = every phone at once (the pre-#278 behaviour and the default); in_turn = they join the ring one at a time, oldest member first.';
comment on column public.phone_numbers.ring_strategy is
  'Per-line override (#278/#307). NULL = inherit the workspace setting.';
comment on column public.companies.ring_seconds is
  'Seconds the phones ring before voicemail (#278). Capped at RING_TIMEOUT_SECS (45): a longer window would outlive the legs it is waiting on.';
comment on column public.phone_numbers.ring_seconds is
  'Per-line override (#278/#307). NULL = inherit the workspace setting.';
