-- #400 / D106 — a year paid up front, as a credit rather than a billing interval.
--
-- WHAT THIS IS FOR. The customer pays ten months' money once; it lands as a
-- CREDIT on their Stripe customer and every existing monthly invoice draws it
-- down before touching a card. The subscription, its allowances, its overage
-- cap and its proration are all untouched — D106 explains at length why the
-- obvious alternative (a twelve-month billing interval) breaks a metered
-- product, and the short version is that a crew who lands a big job in January
-- would spend the year's allowance in three weeks and then be throttled by the
-- period-scoped overage cap until December.
--
-- WHY A TABLE AND NOT JUST THE STRIPE CALL. `customers.createBalanceTransaction`
-- is not idempotent. Our Stripe webhook re-dispatches any event whose handler
-- threw, on every five-minute sweeper run, and `stripe.test.ts` pins that
-- contract deliberately — so a credit granted before a later throw would be
-- granted again on the retry, and again, silently, in the customer's favour and
-- our loss. This table is the claim: one row per checkout session, taken
-- BEFORE Stripe is called, so the second delivery finds the row and stops.
--
-- That is the same shape the $29 US-registration fee already uses (an atomic
-- claim, then withdraw on failure) rather than a new invention.

create table if not exists public.prepayments (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  -- The claim key. One prepayment per Checkout Session, forever.
  stripe_session_id   text not null,
  -- What we actually collected, from the session rather than from our own
  -- catalog: a promotion code changes the amount, and crediting the list price
  -- for a discounted payment would hand out money we never took.
  amount_cents        int  not null check (amount_cents > 0),
  currency            text not null default 'usd',
  plan                text,
  -- Null until Stripe confirms the credit. A row with a null id is a claim
  -- that was taken and never completed, which is exactly what the withdraw
  -- path deletes so a retry can try again.
  stripe_balance_txn  text,
  granted_at          timestamptz,
  created_at          timestamptz not null default now()
);

comment on table public.prepayments is
  '#400/D106: a year bought up front, held as Stripe customer credit. One row '
  'per Checkout Session — the row IS the idempotency claim, taken before the '
  'Stripe call, because createBalanceTransaction is not idempotent and our '
  'webhook retries any handler that throws.';

-- The claim itself. Unique rather than a primary key so the surrogate id stays
-- the join target if anything ever references a prepayment.
create unique index if not exists prepayments_session_uq
  on public.prepayments (stripe_session_id);

-- "What has this company bought, newest first" — the settings surface, and the
-- refund conversation D106 commits to.
create index if not exists prepayments_company_idx
  on public.prepayments (company_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS, per SPEC §6's deny-by-default posture.
--
-- No policy: the Worker holds the service-role key and bypasses RLS, and
-- nothing else may read this at all. What a customer sees about their credit is
-- what the API chooses to publish, which is the remaining BALANCE from Stripe —
-- the authoritative number — never this ledger.
-- ---------------------------------------------------------------------------
alter table public.prepayments enable row level security;
revoke all on public.prepayments from public, anon, authenticated;
grant select, insert, update, delete on public.prepayments to service_role;

-- ---------------------------------------------------------------------------
-- The claim, atomically.
--
-- Returns 'claimed' the first time a session is seen and 'duplicate' every time
-- after, whether or not the first attempt finished. The caller grants the
-- credit only on 'claimed', and deletes the row if Stripe then refuses — so a
-- failure is retryable and a success can never be repeated.
--
-- `on conflict do nothing` is what makes it atomic: two concurrent deliveries
-- of the same checkout.session.completed race into one insert, and exactly one
-- of them sees a returned row.
-- ---------------------------------------------------------------------------
create or replace function public.claim_prepayment(
  p_company_id       uuid,
  p_stripe_session_id text,
  p_amount_cents     int,
  p_currency         text,
  p_plan             text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.prepayments (
    company_id, stripe_session_id, amount_cents, currency, plan
  )
  values (
    p_company_id, p_stripe_session_id, p_amount_cents, coalesce(p_currency, 'usd'), p_plan
  )
  on conflict (stripe_session_id) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('outcome', 'duplicate');
  end if;
  return jsonb_build_object('outcome', 'claimed', 'prepayment_id', v_id);
end $$;

revoke execute on function public.claim_prepayment(uuid, text, int, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_prepayment(uuid, text, int, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Stamping the grant, and withdrawing a claim that never completed.
-- ---------------------------------------------------------------------------
create or replace function public.stamp_prepayment(
  p_stripe_session_id text,
  p_balance_txn       text
) returns void
language sql
security definer
set search_path = ''
as $$
  update public.prepayments
     set stripe_balance_txn = p_balance_txn,
         granted_at         = now()
   where stripe_session_id = p_stripe_session_id
     and granted_at is null
$$;

revoke execute on function public.stamp_prepayment(text, text)
  from public, anon, authenticated;
grant execute on function public.stamp_prepayment(text, text) to service_role;

/**
 * Give the claim back when Stripe refused the credit.
 *
 * Guarded on `granted_at is null` so it can never delete a prepayment that
 * actually landed — the difference between "retry this" and "erase the record
 * that we owe this customer a year".
 */
create or replace function public.withdraw_prepayment(
  p_stripe_session_id text
) returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.prepayments
   where stripe_session_id = p_stripe_session_id
     and granted_at is null
$$;

revoke execute on function public.withdraw_prepayment(text)
  from public, anon, authenticated;
grant execute on function public.withdraw_prepayment(text) to service_role;
