-- #583 / D131 — a plan change inside a prepaid window converts instead of refusing.
--
-- `change-plan` has refused outright since 5c80385b, which closed a money hole (an
-- upgrade re-pointed a live 100%-off coupon at the Pro price and handed over a free
-- Pro year) and left a customer who outgrows Starter in month three unable to pay us
-- more for nine months.
--
-- D131 settles the conversion in MONEY rather than in months: revoke the coupon,
-- credit the unconsumed value to the customer's Stripe balance in the currency we
-- collected, and put them on the ordinary price of the plan they asked for. D107
-- rejected customer credit for DELIVERING a year, because dollars cannot promise
-- "twelve months for the price of ten" — that objection is about the sell, and at
-- conversion time there is no term left to promise. What is owed is a value, and a
-- value is what dollars are.
--
-- Why not a smaller re-granted coupon: $217.50 of remaining Starter buys two whole
-- months of Pro and leaves $59.50, and every way of placing that remainder is worse
-- than not having one (D131 has the table). In dollars there is no remainder.

-- ---------------------------------------------------------------------------
-- The columns. Bookkeeping only — no existing column changes meaning.
-- ---------------------------------------------------------------------------
alter table public.prepayments
  -- When the window was ended early by a plan change. Distinct from `revoked_at`,
  -- which this also sets: support needs to tell a conversion from a refund, and
  -- both stop the year.
  add column if not exists converted_at      timestamptz,
  add column if not exists converted_to_plan text,
  -- What we owe back, computed once, in `currency`. Written in the same transaction
  -- that ends the window, so a failure afterwards leaves an amount somebody can
  -- find rather than an amount somebody has to reconstruct.
  add column if not exists credit_cents      int,
  -- Null until Stripe confirms the balance transaction. `converted_at is not null
  -- and credited_at is null` is the resume set: money owed, not yet moved.
  add column if not exists credited_at       timestamptz,
  add column if not exists stripe_credit_txn text;

comment on column public.prepayments.credit_cents is
  '#583/D131: the unconsumed value of a year ended early by a plan change, in '
  '`currency`. Consumed months are valued at the amortised rate (amount collected / '
  'months granted) and floored, so a fraction of a cent stays with the customer.';

comment on column public.prepayments.credited_at is
  '#583/D131: when the credit actually reached Stripe. A row with `converted_at` set '
  'and this null is money we owe and have not moved — the resume set.';

-- Finding that resume set is a sweep, and it is tiny. Partial so it indexes only
-- the rows that are actually outstanding rather than every prepayment ever taken.
create index if not exists prepayments_awaiting_credit_idx
  on public.prepayments (converted_at)
  where converted_at is not null and credited_at is null;

-- ---------------------------------------------------------------------------
-- convert_prepayment — end the window, and say what is owed.
--
-- One transaction. It closes the entitlement AND records the credit, because the
-- two must not be able to disagree: a closed window with no recorded amount is a
-- customer we have quietly stopped owing.
--
-- Outcomes: 'converted' (closed now, `credit_cents` is what to move) or 'noop'
-- (there was no open window).
--
-- REPLAY SAFETY IS THE `where` CLAUSE, and there is deliberately no 'already'
-- outcome to go looking for. It sets `revoked_at` as well as `converted_at`, which
-- reuses the invariant the rest of this feature is already built on rather than
-- adding a parallel one:
--
--   * this function only ever selects `revoked_at is null`, so a converted row can
--     never be converted a second time and the credit cannot be recomputed against
--     a later `now()` — which would shrink it every time a month ticked over;
--   * `open_prepayment` filters the same way, so the refusal in `change-plan` stops
--     firing the moment the window closes;
--   * `claim_prepayment` answers 'revoked' from it, so a replayed checkout webhook
--     cannot re-grant the year that was just converted.
--
-- A refund that got here first also leaves `revoked_at` set, so it is excluded by
-- the same clause: the money already went back, and crediting on top of a clawback
-- would pay for the year twice.
--
-- The Stripe half failing is NOT this function's problem to re-answer. That leaves
-- `converted_at is not null and credited_at is null`, which is what
-- `prepayments_awaiting_credit` below is for.
-- ---------------------------------------------------------------------------
create or replace function public.convert_prepayment(
  p_company_id uuid,
  p_to_plan    text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row      public.prepayments%rowtype;
  v_consumed int;
  v_credit   int;
begin
  -- The open window, locked. `for update` is what makes two concurrent plan
  -- changes settle to one conversion instead of two credits.
  select * into v_row
    from public.prepayments
   where company_id = p_company_id
     and granted_at is not null
     and revoked_at is null
     and granted_through > now()
   order by granted_through desc
   limit 1
     for update;

  if v_row.id is null then
    return jsonb_build_object('outcome', 'noop');
  end if;

  -- Whole months elapsed, counted the same way `granted_through` was computed:
  -- calendar steps from `granted_at`, not an average month. Set-based rather than
  -- epoch arithmetic so it cannot drift from the column it has to agree with.
  select count(*) into v_consumed
    from generate_series(1, v_row.months_granted) as m
   where v_row.granted_at + make_interval(months => m) <= now();

  -- Amortised, and floored in the customer's favour (D131). `floor` on the
  -- CONSUMED side is what leaves the fraction of a cent in the credit.
  v_credit := v_row.amount_cents
              - floor(v_row.amount_cents::numeric * v_consumed / v_row.months_granted);
  if v_credit < 0 then v_credit := 0; end if;

  update public.prepayments
     set converted_at      = now(),
         converted_to_plan = p_to_plan,
         credit_cents      = v_credit,
         revoked_at        = now(),
         revoked_reason    = 'converted_to_' || p_to_plan
   where id = v_row.id
  returning * into v_row;

  return jsonb_build_object(
    'outcome', 'converted',
    'prepayment_id', v_row.id,
    'session_id', v_row.stripe_session_id,
    'plan', v_row.plan,
    'converted_to_plan', v_row.converted_to_plan,
    'currency', v_row.currency,
    'amount_cents', v_row.amount_cents,
    'months_granted', v_row.months_granted,
    'consumed_months', v_consumed,
    'credit_cents', v_credit,
    'credited_at', null,
    'discount_id', v_row.stripe_discount_id);
end $$;

revoke execute on function public.convert_prepayment(uuid, text)
  from public, anon, authenticated;
grant execute on function public.convert_prepayment(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- What a conversion WOULD pay back, without doing it.
--
-- The refusal that asks for consent has to quote a figure, and it must be the same
-- figure the conversion will use. Two expressions of one rule is how they drift, so
-- the preview reads the same amortisation — and `convert_prepayment` is still the
-- only writer, so a preview can never move money.
-- ---------------------------------------------------------------------------
create or replace function public.prepayment_conversion_preview(p_company_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'session_id', p.stripe_session_id,
           'plan', p.plan,
           'currency', p.currency,
           'amount_cents', p.amount_cents,
           'months_granted', p.months_granted,
           'granted_through', p.granted_through,
           'consumed_months', c.consumed,
           'credit_cents', greatest(
             0,
             p.amount_cents
               - floor(p.amount_cents::numeric * c.consumed / p.months_granted)
           )::int)
    from public.prepayments p
    cross join lateral (
      select count(*)::int as consumed
        from generate_series(1, p.months_granted) as m
       where p.granted_at + make_interval(months => m) <= now()
    ) c
   where p.company_id = p_company_id
     and p.granted_at is not null
     and p.revoked_at is null
     and p.granted_through > now()
   order by p.granted_through desc
   limit 1
$$;

revoke execute on function public.prepayment_conversion_preview(uuid)
  from public, anon, authenticated;
grant execute on function public.prepayment_conversion_preview(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Stamp the credit once it has actually moved. Guarded on `credited_at is null`
-- so a retry whose first attempt landed cannot record a second transaction id.
-- ---------------------------------------------------------------------------
create or replace function public.stamp_prepayment_credit(
  p_prepayment_id uuid,
  p_txn           text
) returns void
language sql
security definer
set search_path = ''
as $$
  update public.prepayments
     set credited_at       = now(),
         stripe_credit_txn = p_txn
   where id = p_prepayment_id
     and credited_at is null
$$;

revoke execute on function public.stamp_prepayment_credit(uuid, text)
  from public, anon, authenticated;
grant execute on function public.stamp_prepayment_credit(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- The resume set: conversions whose credit never reached Stripe.
--
-- D131 chose this failure deliberately — a customer at full price who is owed a
-- recorded amount, rather than a live 100%-off coupon nothing is looking for. That
-- choice is only defensible because something looks for these.
-- ---------------------------------------------------------------------------
create or replace function public.prepayments_awaiting_credit(p_limit int default 50)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    from (
      select p.id            as prepayment_id,
             p.company_id,
             p.stripe_session_id as session_id,
             p.currency,
             p.credit_cents,
             p.converted_at,
             p.converted_to_plan
        from public.prepayments p
       where p.converted_at is not null
         and p.credited_at is null
         and coalesce(p.credit_cents, 0) > 0
       order by p.converted_at
       limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) t
$$;

revoke execute on function public.prepayments_awaiting_credit(int)
  from public, anon, authenticated;
grant execute on function public.prepayments_awaiting_credit(int) to service_role;
