-- #422 — a disputed charge was invisible and the service kept running.
--
-- The Stripe webhook handles seven event types and `charge.dispute.created` is
-- not one of them; the endpoint is not even subscribed to it. So when a
-- customer disputes their $29, Stripe leaves the subscription `active`, our
-- mirror faithfully copies `active`, and nothing anywhere records that it
-- happened. The number keeps sending, the number rental and the 10DLC campaign
-- keep accruing, and the founder finds out from a bank statement.
--
-- THE ARITHMETIC IS THE ISSUE'S BEST POINT. A $29 charge disputed costs $29
-- clawed back plus Stripe's $15 dispute fee — $44 out on a $29 sale, against a
-- net-of-fees revenue of $27.71. One dispute erases roughly a month and a half
-- of a tenant's contribution, and we go on paying that tenant's carrier costs
-- while it is happening.
--
-- KEYED ON THE PAYMENT INTENT, not the charge or the invoice. `Stripe.Charge`
-- has no `invoice` property in the pinned SDK and `Stripe.Invoice` has no
-- top-level `charge`; the payment intent is the one id that appears on the
-- charge, the dispute, and the invoice's payment records. Keying on anything
-- else produces a table that never joins to anything and a refund path that
-- silently matches zero rows forever.

create table if not exists public.billing_disputes (
  stripe_dispute_id        text primary key,
  -- Nullable ON PURPOSE. A dispute can arrive for a charge we cannot attribute
  -- to a company (a deleted customer, a charge made outside the subscription
  -- flow). An unattributable dispute is MORE alarming than an attributable
  -- one, not less, so it must still be recordable — a NOT NULL here would mean
  -- the strangest disputes are the ones we drop.
  company_id               uuid references public.companies(id) on delete set null,
  stripe_charge_id         text,
  stripe_payment_intent_id text,
  amount_cents             integer not null,
  /** Stripe's dispute fee, which is the part that turns a refund into a loss. */
  fee_cents                integer not null default 0,
  reason                   text not null,
  status                   text not null,
  evidence_due_by          timestamptz,
  opened_at                timestamptz not null,
  closed_at                timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

comment on table public.billing_disputes is
  '#422: every chargeback, recorded. Nothing existed before — a disputed charge left no trace in the product at all, and the subscription stayed active because Stripe leaves it active.';

create index if not exists billing_disputes_opened_idx
  on public.billing_disputes (opened_at desc);
create index if not exists billing_disputes_company_idx
  on public.billing_disputes (company_id)
  where company_id is not null;

drop trigger if exists set_updated_at on public.billing_disputes;
create trigger set_updated_at
  before update on public.billing_disputes
  for each row execute function moddatetime('updated_at');

-- The per-tenant state the product had no way to express.
alter table public.companies
  add column if not exists disputed_at timestamptz;

comment on column public.companies.disputed_at is
  '#422: when this workspace most recently had a charge disputed. Deliberately NOT a subscription_status value — Stripe keeps the subscription active during a dispute and mirroring a fiction into that column would break every consumer of it. This is a separate fact about the same tenant.';

-- ---------------------------------------------------------------------------
-- record_billing_dispute — the ledger write, and the tenant flag with it
-- ---------------------------------------------------------------------------
-- One call so the two can never disagree: a dispute row without the company
-- flag is a dispute nobody sees, and a flag without a row is a workspace
-- marked with no evidence why.
create or replace function public.record_billing_dispute(
  p_dispute_id     text,
  p_company_id     uuid,
  p_charge_id      text,
  p_payment_intent text,
  p_amount_cents   int,
  p_fee_cents      int,
  p_reason         text,
  p_status         text,
  p_opened_at      timestamptz,
  p_evidence_due   timestamptz default null,
  p_closed_at      timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $function$
declare
  v_first boolean;
begin
  v_first := not exists (
    select 1 from public.billing_disputes where stripe_dispute_id = p_dispute_id
  );

  insert into public.billing_disputes (
    stripe_dispute_id, company_id, stripe_charge_id, stripe_payment_intent_id,
    amount_cents, fee_cents, reason, status, evidence_due_by, opened_at, closed_at)
  values (
    p_dispute_id, p_company_id, p_charge_id, p_payment_intent,
    p_amount_cents, p_fee_cents, p_reason, p_status, p_evidence_due, p_opened_at, p_closed_at)
  on conflict (stripe_dispute_id) do update
     set status = excluded.status,
         fee_cents = greatest(public.billing_disputes.fee_cents, excluded.fee_cents),
         closed_at = coalesce(excluded.closed_at, public.billing_disputes.closed_at),
         -- Never overwrite a resolved company with a null one: a later event
         -- carrying less context must not erase attribution we already made.
         company_id = coalesce(excluded.company_id, public.billing_disputes.company_id);

  -- Only stamp the tenant on the way IN. A closed dispute leaves the mark:
  -- whether we won or lost, this workspace disputed a charge, and that is the
  -- fact a human wants when deciding whether to keep serving them.
  if p_company_id is not null and p_closed_at is null then
    update public.companies
       set disputed_at = greatest(coalesce(disputed_at, p_opened_at), p_opened_at)
     where id = p_company_id;
  end if;

  return jsonb_build_object('recorded', true, 'first_seen', v_first);
end;
$function$;

-- ---------------------------------------------------------------------------
-- api_dispute_health — how many, how recently, and how much it cost
-- ---------------------------------------------------------------------------
-- Deliberately a COUNT and a SUM rather than a rate. At this volume a rate has
-- a denominator of a handful and swings wildly on one event; the count is the
-- signal, and every single dispute is worth an email. The window exists so a
-- run of them reads differently from one unlucky customer.
create or replace function public.api_dispute_health(
  p_now          timestamptz default now(),
  p_window_days  int default 120
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $function$
  select jsonb_build_object(
    'window_days', p_window_days,
    'disputes', count(*),
    'companies', count(distinct company_id) filter (where company_id is not null),
    'unattributed', count(*) filter (where company_id is null),
    'amount_cents', coalesce(sum(amount_cents), 0),
    'fee_cents', coalesce(sum(fee_cents), 0),
    -- What it actually cost: the clawback AND the fee, which is the number the
    -- issue's $44-on-a-$29-sale arithmetic is about.
    'cost_cents', coalesce(sum(amount_cents + fee_cents), 0),
    'open', count(*) filter (where closed_at is null))
  from public.billing_disputes
  where opened_at > p_now - make_interval(days => p_window_days)
$function$;

revoke execute on function public.record_billing_dispute(text, uuid, text, text, int, int, text, text, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_billing_dispute(text, uuid, text, text, int, int, text, text, timestamptz, timestamptz, timestamptz)
  to service_role;
revoke execute on function public.api_dispute_health(timestamptz, int)
  from public, anon, authenticated;
grant execute on function public.api_dispute_health(timestamptz, int) to service_role;

alter table public.billing_disputes enable row level security;
-- No policies: platform billing state, service_role only, like the ledgers
-- around it. A tenant must never be able to enumerate anybody's disputes.
