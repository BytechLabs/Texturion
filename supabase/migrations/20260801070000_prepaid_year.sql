-- #400 / D107 — a prepaid year, as a discount on the licensed line.
--
-- The customer buys a one-time price; we then apply a 100%-off coupon to the
-- LICENSED subscription item for twelve months. The subscription itself does
-- not change: same id, same monthly period, metered overage and modules still
-- billing normally. D107 records why the three earlier designs (an annual
-- interval, a customer-balance credit, two subscriptions) were each wrong.
--
-- ---------------------------------------------------------------------------
-- WHY A TABLE, WHEN THE DISCOUNT ALREADY EXISTS IN STRIPE
--
-- Because re-applying the coupon RESTARTS its twelve months. `confirm-checkout`
-- lets a browser replay a completed session on demand, and the webhook sweeper
-- re-dispatches any handler that threw five times over ~25 minutes — so one
-- payment could buy unbounded free service, and a transient failure would do it
-- by accident with the last write winning.
--
-- So the Stripe discount is NOT the record of the entitlement. This row is. The
-- grant path reads the claim first: a row that already exists means verify the
-- item still carries that discount and stop. The discount becomes a derived
-- projection of this table, re-assertable the way `ensureVoiceMeteredItem`
-- converges the voice item — which is also what makes a cancel-and-resubscribe
-- self-heal instead of silently destroying months somebody paid for.
--
-- ---------------------------------------------------------------------------
-- WHY THE CLAIM HAS THREE OUTCOMES AND NOT TWO
--
-- The reverted first attempt (61855d03) had two, and a review found the hole:
-- a claim that COMMITS but whose response never reaches the Worker — a lost
-- ack, an evicted isolate — leaves a row with nothing granted, and every retry
-- then reads "duplicate" and reports success. Money taken, nothing delivered,
-- no exception, no alert.
--
-- `granted` and `resume` are therefore different answers. `resume` means the
-- row exists but the grant never landed, and the caller must try again.

create table if not exists public.prepayments (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  -- The claim key. One prepaid year per Checkout Session, forever.
  stripe_session_id   text not null,
  -- The plan the pack was bought FOR. A plan change during the window has to
  -- know what was paid for, because a 100%-off coupon left on an upgraded item
  -- would hand over a free Pro year for a Starter price.
  plan                text not null,
  -- What we actually collected, from the session rather than from our catalog:
  -- a promotion code changes the amount, and every downstream number (the
  -- refund posture, the amortised revenue figure) has to use what we took.
  amount_cents        int  not null check (amount_cents > 0),
  currency            text not null default 'usd',
  months_granted      int  not null default 12 check (months_granted > 0),

  -- Null until Stripe confirms. A row with a null discount id is a claim that
  -- was taken and never completed — the `resume` case above.
  stripe_discount_id  text,
  granted_at          timestamptz,
  -- When the free months run out. Stored rather than computed so a report can
  -- answer "who is still inside a prepaid window" without replaying Stripe.
  granted_through     timestamptz,

  -- Set when a refund or a won chargeback takes the money back. The coupon is
  -- removed at the same time; this column is why support can tell a revoked
  -- year from one that simply ended.
  revoked_at          timestamptz,
  revoked_reason      text,

  created_at          timestamptz not null default now()
);

comment on table public.prepayments is
  '#400/D107: a year bought up front, delivered as a 100%-off discount on the '
  'licensed subscription item. This row is the record of the entitlement — the '
  'Stripe discount is a derived projection, because re-applying the coupon '
  'restarts its twelve months.';

-- The link a refund or a chargeback arrives on. `charge.dispute.*` carries a
-- payment intent and nothing else we store, so without this a won chargeback
-- could take the money back and leave the free months running — the largest
-- single loss any of these paths can produce.
alter table public.prepayments
  add column if not exists stripe_payment_intent text;

create index if not exists prepayments_payment_intent_idx
  on public.prepayments (stripe_payment_intent)
  where stripe_payment_intent is not null;

create unique index if not exists prepayments_session_uq
  on public.prepayments (stripe_session_id);

-- "Is a prepaid window open for this company right now" — the eligibility gate
-- that stops a second purchase, and the projection every money figure reads.
create index if not exists prepayments_company_open_idx
  on public.prepayments (company_id, granted_through desc)
  where granted_at is not null and revoked_at is null;

-- ---------------------------------------------------------------------------
-- RLS: deny by default. The Worker holds the service-role key and bypasses it;
-- nothing else may read this. What a customer sees about their year is what the
-- API chooses to publish, never this ledger.
-- ---------------------------------------------------------------------------
alter table public.prepayments enable row level security;
revoke all on public.prepayments from public, anon, authenticated;
grant select, insert, update, delete on public.prepayments to service_role;

-- ---------------------------------------------------------------------------
-- The claim.
--
-- 'claimed' — first time this session has been seen; grant it.
-- 'resume'  — a row exists but nothing was granted; try the grant again. This
--             is the lost-ack case, and reporting it as a duplicate is how the
--             first attempt lost money silently.
-- 'granted' — already delivered; do nothing.
-- 'revoked' — refunded or charged back; do NOT re-grant.
--
-- `on conflict do nothing` is what makes it atomic: two concurrent deliveries
-- race into one insert and exactly one sees a returned row.
-- ---------------------------------------------------------------------------
create or replace function public.claim_prepayment(
  p_company_id        uuid,
  p_stripe_session_id text,
  p_plan              text,
  p_amount_cents      int,
  p_currency          text,
  p_months            int default 12,
  p_payment_intent    text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_row     public.prepayments%rowtype;
begin
  insert into public.prepayments (
    company_id, stripe_session_id, plan, amount_cents, currency, months_granted,
    stripe_payment_intent
  )
  values (
    p_company_id, p_stripe_session_id, p_plan, p_amount_cents,
    coalesce(p_currency, 'usd'), coalesce(p_months, 12), p_payment_intent
  )
  on conflict (stripe_session_id) do nothing
  returning id into v_id;

  if v_id is not null then
    return jsonb_build_object('outcome', 'claimed', 'prepayment_id', v_id);
  end if;

  select * into v_row
    from public.prepayments
   where stripe_session_id = p_stripe_session_id;

  if v_row.revoked_at is not null then
    return jsonb_build_object('outcome', 'revoked', 'prepayment_id', v_row.id);
  end if;
  if v_row.granted_at is null then
    -- The row exists and the grant never landed. Try again rather than
    -- reporting success — this is the case that silently ate a payment.
    return jsonb_build_object('outcome', 'resume', 'prepayment_id', v_row.id);
  end if;
  return jsonb_build_object(
    'outcome', 'granted',
    'prepayment_id', v_row.id,
    'discount_id', v_row.stripe_discount_id);
end $$;

revoke execute on function public.claim_prepayment(uuid, text, text, int, text, int, text)
  from public, anon, authenticated;
grant execute on function public.claim_prepayment(uuid, text, text, int, text, int, text)
  to service_role;

-- Stamp the grant. Idempotent: a second stamp for the same session is a no-op,
-- so a retry that succeeds twice cannot move `granted_through` forward.
create or replace function public.stamp_prepayment(
  p_stripe_session_id text,
  p_discount_id       text,
  p_granted_through   timestamptz
) returns void
language sql
security definer
set search_path = ''
as $$
  update public.prepayments
     set stripe_discount_id = p_discount_id,
         granted_at         = now(),
         granted_through    = p_granted_through
   where stripe_session_id = p_stripe_session_id
     and granted_at is null
$$;

revoke execute on function public.stamp_prepayment(text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.stamp_prepayment(text, text, timestamptz) to service_role;

-- Take the year back when the money goes back. Guarded on `granted_at is not
-- null` so it only ever marks a year that actually landed, and the caller
-- removes the coupon in the same breath.
create or replace function public.revoke_prepayment(
  p_stripe_session_id text,
  p_reason            text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.prepayments%rowtype;
begin
  update public.prepayments
     set revoked_at = now(), revoked_reason = p_reason
   where stripe_session_id = p_stripe_session_id
     and revoked_at is null
  returning * into v_row;

  if v_row.id is null then
    return jsonb_build_object('outcome', 'noop');
  end if;
  return jsonb_build_object(
    'outcome', 'revoked',
    'company_id', v_row.company_id,
    'discount_id', v_row.stripe_discount_id);
end $$;

revoke execute on function public.revoke_prepayment(text, text)
  from public, anon, authenticated;
grant execute on function public.revoke_prepayment(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- The open window for a company, or null.
--
-- One place answers "is a year running, what was paid for it, and until when",
-- because five callers need it: the eligibility gate, the plan-change branch,
-- the amortised revenue figure, the refund conversation, and the settings
-- surface. Five hand-rolled queries would drift.
-- ---------------------------------------------------------------------------
create or replace function public.open_prepayment(p_company_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'session_id', p.stripe_session_id,
           'plan', p.plan,
           'amount_cents', p.amount_cents,
           'months_granted', p.months_granted,
           'granted_at', p.granted_at,
           'granted_through', p.granted_through,
           'discount_id', p.stripe_discount_id)
    from public.prepayments p
   where p.company_id = p_company_id
     and p.granted_at is not null
     and p.revoked_at is null
     and p.granted_through > now()
   order by p.granted_through desc
   limit 1
$$;

revoke execute on function public.open_prepayment(uuid) from public, anon, authenticated;
grant execute on function public.open_prepayment(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The session behind a payment intent, for the refund/chargeback path.
-- ---------------------------------------------------------------------------
create or replace function public.prepayment_for_payment_intent(p_payment_intent text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select stripe_session_id
    from public.prepayments
   where stripe_payment_intent = p_payment_intent
     and revoked_at is null
   limit 1
$$;

revoke execute on function public.prepayment_for_payment_intent(text)
  from public, anon, authenticated;
grant execute on function public.prepayment_for_payment_intent(text) to service_role;
