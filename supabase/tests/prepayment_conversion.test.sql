-- [#583 / D131] A prepaid year that ends early pays the rest back, once.
--
-- The arithmetic here IS the product promise: a crew that prepaid a Starter year
-- and upgrades in month three is owed the value of the nine months they will not
-- take. Every assertion below is a sentence somebody could be told on the phone.
--
-- The failures being guarded are all of the shape "money moved twice" or "money
-- quietly stopped being owed":
--
--   * converting a window that was already converted, which would credit again;
--   * recomputing the credit on a later attempt, which shrinks it every time a
--     month ticks over;
--   * crediting on top of a refund, which pays for the year twice;
--   * a preview that disagrees with what the conversion will actually do.
--
-- One transaction, rolled back. Fixtures use a '5b' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('5b000000-0000-4000-8000-00000000000a'::uuid, 'prepay-owner@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('5b000000-0000-4000-8000-0000000000c1'::uuid, 'Prepaid Plumbing',
   '5b000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now()),
  ('5b000000-0000-4000-8000-0000000000c2'::uuid, 'Refunded Roofing',
   '5b000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now()),
  ('5b000000-0000-4000-8000-0000000000c3'::uuid, 'Nothing Prepaid Co',
   '5b000000-0000-4000-8000-00000000000a'::uuid, 'CA', '416', now());

-- $290 for twelve months of Starter, bought three months and a day ago. The
-- fixture is the worked example from #583 so the numbers below can be read
-- against it: 3 of 12 months consumed at the amortised $24.17, $217.50 left.
insert into public.prepayments
  (company_id, stripe_session_id, plan, amount_cents, currency,
   months_granted, stripe_discount_id, granted_at, granted_through)
values
  ('5b000000-0000-4000-8000-0000000000c1'::uuid, 'cs_583_starter', 'starter',
   29000, 'usd', 12, 'loonext_prepaid_year',
   now() - interval '3 months' - interval '1 day',
   now() - interval '3 months' - interval '1 day' + interval '12 months');

-- ---------------------------------------------------------------------------
-- PC-1. The preview quotes the figure the conversion will use.
--
-- The consent step is a refusal carrying an amount, and the customer agrees to
-- THAT amount. If the preview and the conversion are two expressions of one
-- rule they will drift, and the drift is money — so this asserts the preview
-- first, then asserts the conversion produced the same number.
do $$
declare
  v_preview jsonb;
begin
  select public.prepayment_conversion_preview(
           '5b000000-0000-4000-8000-0000000000c1'::uuid) into v_preview;

  if v_preview is null then
    raise exception 'PC-1 FAILED: no preview for a workspace with an open year.';
  end if;
  if (v_preview ->> 'consumed_months')::int is distinct from 3 then
    raise exception 'PC-1 FAILED: three months and a day into a year reads as % '
      'consumed months. Whole calendar months elapsed is the unit, counted the '
      'same way granted_through was.', v_preview ->> 'consumed_months';
  end if;
  if (v_preview ->> 'credit_cents')::int is distinct from 21750 then
    raise exception 'PC-1 FAILED: $290 with 3 of 12 months consumed leaves % '
      'cents, not 21750. The amortised rate is 29000/12 = 2416.67, so three '
      'months is 7250 and the customer is owed 21750.',
      v_preview ->> 'credit_cents';
  end if;
  if v_preview ->> 'currency' is distinct from 'usd' then
    raise exception 'PC-1 FAILED: the preview drops the currency (%). A credit '
      'in the wrong currency is unusable — Stripe holds a balance per '
      'currency.', v_preview ->> 'currency';
  end if;
  raise notice 'PC-1 PASSED: the preview says $217.50 of $290 comes back';
end $$;

-- ---------------------------------------------------------------------------
-- PC-2. A preview moves no money.
--
-- It is `stable` and reads only. Asserted rather than assumed because a preview
-- that converted would convert on every render of the confirmation dialog.
do $$
declare
  v_converted timestamptz;
begin
  perform public.prepayment_conversion_preview(
            '5b000000-0000-4000-8000-0000000000c1'::uuid);
  select converted_at into v_converted
    from public.prepayments where stripe_session_id = 'cs_583_starter';
  if v_converted is not null then
    raise exception 'PC-2 FAILED: previewing the conversion performed it.';
  end if;
  raise notice 'PC-2 PASSED: the preview is a read';
end $$;

-- ---------------------------------------------------------------------------
-- PC-3. Converting closes the window and records what is owed, in one write.
--
-- `revoked_at` is set deliberately: it is the column `open_prepayment` and
-- `claim_prepayment` already filter on, so closing the window here is what stops
-- the change-plan refusal firing and stops a replayed checkout webhook
-- re-granting the year. A conversion that recorded `converted_at` alone would
-- leave the year looking live to both of them.
do $$
declare
  v_result jsonb;
  v_row    public.prepayments%rowtype;
begin
  select public.convert_prepayment(
           '5b000000-0000-4000-8000-0000000000c1'::uuid, 'pro') into v_result;

  if v_result ->> 'outcome' is distinct from 'converted' then
    raise exception 'PC-3 FAILED: converting an open window answered %.',
      v_result ->> 'outcome';
  end if;
  if (v_result ->> 'credit_cents')::int is distinct from 21750 then
    raise exception 'PC-3 FAILED: the conversion owes % cents, the preview said '
      '21750. The customer agreed to the preview.', v_result ->> 'credit_cents';
  end if;

  select * into v_row from public.prepayments
   where stripe_session_id = 'cs_583_starter';

  if v_row.converted_at is null then
    raise exception 'PC-3 FAILED: nothing recorded the conversion.';
  end if;
  if v_row.converted_to_plan is distinct from 'pro' then
    raise exception 'PC-3 FAILED: the row does not say which plan it converted '
      'to (%), so support cannot answer what happened.', v_row.converted_to_plan;
  end if;
  if v_row.credit_cents is distinct from 21750 then
    raise exception 'PC-3 FAILED: the owed amount is not on the row (%). A '
      'closed window with no recorded amount is a customer we quietly stopped '
      'owing.', v_row.credit_cents;
  end if;
  if v_row.revoked_at is null then
    raise exception 'PC-3 FAILED: revoked_at is null after a conversion, so '
      'open_prepayment still reports a live year and claim_prepayment would '
      're-grant it.';
  end if;
  if v_row.credited_at is not null then
    raise exception 'PC-3 FAILED: the row claims the credit already reached '
      'Stripe. Nothing has called Stripe yet — this is the state the sweep '
      'exists to finish.';
  end if;
  raise notice 'PC-3 PASSED: the window is closed and $217.50 is recorded as owed';
end $$;

-- ---------------------------------------------------------------------------
-- PC-4. `open_prepayment` stops seeing it, which is what un-refuses change-plan.
do $$
begin
  if public.open_prepayment('5b000000-0000-4000-8000-0000000000c1'::uuid)
     is not null then
    raise exception 'PC-4 FAILED: a converted year still reads as open, so the '
      'change-plan refusal would keep firing after the customer converted.';
  end if;
  raise notice 'PC-4 PASSED: a converted year is no longer an open one';
end $$;

-- ---------------------------------------------------------------------------
-- PC-5. THE ONE THAT MATTERS. Converting twice credits once.
--
-- The acceptance criterion is that a replay does nothing the second time. There
-- is no 'already' outcome to look for: the function only ever selects
-- `revoked_at is null`, so the converted row is invisible to it. If that clause
-- were relaxed, this call would compute a SECOND credit — and worse, compute it
-- against a later now(), so the two would not even agree.
do $$
declare
  v_result jsonb;
  v_count  int;
  v_credit int;
begin
  select public.convert_prepayment(
           '5b000000-0000-4000-8000-0000000000c1'::uuid, 'pro') into v_result;

  if v_result ->> 'outcome' is distinct from 'noop' then
    raise exception 'PC-5 FAILED: a second conversion answered % rather than '
      'noop. That is a second credit for one prepaid year.',
      v_result ->> 'outcome';
  end if;

  select count(*), max(credit_cents) into v_count, v_credit
    from public.prepayments where company_id =
      '5b000000-0000-4000-8000-0000000000c1'::uuid;
  if v_count is distinct from 1 then
    raise exception 'PC-5 FAILED: % prepayment rows after two conversions.',
      v_count;
  end if;
  if v_credit is distinct from 21750 then
    raise exception 'PC-5 FAILED: the recorded credit moved to % on the second '
      'call. Recomputing on a replay shrinks it every time a month ticks over.',
      v_credit;
  end if;
  raise notice 'PC-5 PASSED: converting twice owes $217.50 once';
end $$;

-- ---------------------------------------------------------------------------
-- PC-6. The credit is stamped once, and a retry cannot overwrite the id.
do $$
declare
  v_row public.prepayments%rowtype;
begin
  select * into v_row from public.prepayments
   where stripe_session_id = 'cs_583_starter';

  perform public.stamp_prepayment_credit(v_row.id, 'cbtxn_first');
  perform public.stamp_prepayment_credit(v_row.id, 'cbtxn_second');

  select * into v_row from public.prepayments
   where stripe_session_id = 'cs_583_starter';
  if v_row.stripe_credit_txn is distinct from 'cbtxn_first' then
    raise exception 'PC-6 FAILED: the recorded transaction id is %, so a retry '
      'overwrote the one that actually moved the money and support can no '
      'longer find it in Stripe.', v_row.stripe_credit_txn;
  end if;
  if v_row.credited_at is null then
    raise exception 'PC-6 FAILED: stamping did not record when it happened.';
  end if;
  raise notice 'PC-6 PASSED: the first stamp wins and the second is a no-op';
end $$;

-- ---------------------------------------------------------------------------
-- PC-7. A refund already took the money back, so nothing is owed.
--
-- Crediting on top of a clawback pays for the year twice, out of our pocket, and
-- it is reachable: a refund and a plan change can arrive in either order.
do $$
declare
  v_result jsonb;
begin
  insert into public.prepayments
    (company_id, stripe_session_id, plan, amount_cents, currency,
     months_granted, stripe_discount_id, granted_at, granted_through,
     revoked_at, revoked_reason)
  values
    ('5b000000-0000-4000-8000-0000000000c2'::uuid, 'cs_583_refunded', 'pro',
     79000, 'usd', 12, 'loonext_prepaid_year',
     now() - interval '2 months',
     now() - interval '2 months' + interval '12 months',
     now(), 'refunded');

  select public.convert_prepayment(
           '5b000000-0000-4000-8000-0000000000c2'::uuid, 'starter') into v_result;

  if v_result ->> 'outcome' is distinct from 'noop' then
    raise exception 'PC-7 FAILED: a refunded year converted (%), which credits '
      'the customer for months we already refunded.', v_result ->> 'outcome';
  end if;
  if public.prepayment_conversion_preview(
       '5b000000-0000-4000-8000-0000000000c2'::uuid) is not null then
    raise exception 'PC-7 FAILED: the preview offers a credit on a refunded '
      'year, so the dialog would promise money that is not owed.';
  end if;
  raise notice 'PC-7 PASSED: a refunded year owes nothing';
end $$;

-- ---------------------------------------------------------------------------
-- PC-8. Nothing prepaid converts to nothing, quietly.
--
-- The ordinary case. Every plan change in the product reaches this path, so a
-- throw here would break plan changes for everybody who never prepaid.
do $$
declare
  v_result jsonb;
begin
  select public.convert_prepayment(
           '5b000000-0000-4000-8000-0000000000c3'::uuid, 'pro') into v_result;
  if v_result ->> 'outcome' is distinct from 'noop' then
    raise exception 'PC-8 FAILED: a workspace that never prepaid answered %.',
      v_result ->> 'outcome';
  end if;
  if public.prepayment_conversion_preview(
       '5b000000-0000-4000-8000-0000000000c3'::uuid) is not null then
    raise exception 'PC-8 FAILED: a preview exists where no year was bought.';
  end if;
  raise notice 'PC-8 PASSED: no prepaid year converts to noop';
end $$;

-- ---------------------------------------------------------------------------
-- PC-9. The rounding goes to the customer.
--
-- A promotion code makes `amount_cents` a figure that does not divide by twelve,
-- and the direction of the rounding is a decision (D131), not an accident. The
-- consumed side is floored, so the fraction of a cent stays in the credit.
--
-- 28750 with 5 of 12 consumed: 28750 * 5/12 = 11979.1666..., floored to 11979,
-- leaving 16771. Rounding the consumed side UP would leave 16770 and take a cent
-- off somebody who prepaid.
do $$
declare
  v_preview jsonb;
begin
  insert into public.prepayments
    (company_id, stripe_session_id, plan, amount_cents, currency,
     months_granted, stripe_discount_id, granted_at, granted_through)
  values
    ('5b000000-0000-4000-8000-0000000000c3'::uuid, 'cs_583_promo', 'starter',
     28750, 'usd', 12, 'loonext_prepaid_year',
     now() - interval '5 months' - interval '2 days',
     now() - interval '5 months' - interval '2 days' + interval '12 months');

  select public.prepayment_conversion_preview(
           '5b000000-0000-4000-8000-0000000000c3'::uuid) into v_preview;

  if (v_preview ->> 'consumed_months')::int is distinct from 5 then
    raise exception 'PC-9 FAILED: five months and two days reads as %.',
      v_preview ->> 'consumed_months';
  end if;
  if (v_preview ->> 'credit_cents')::int is distinct from 16771 then
    raise exception 'PC-9 FAILED: a promo-priced year leaves % cents, not '
      '16771. The half cent belongs to the customer, not to us.',
      v_preview ->> 'credit_cents';
  end if;
  raise notice 'PC-9 PASSED: the fraction of a cent stays with the customer';
end $$;

-- ---------------------------------------------------------------------------
-- PC-10. The resume set is exactly the conversions whose money never moved.
--
-- D131 chose the recoverable failure — a customer at full price who is owed a
-- recorded amount, rather than a live 100%-off coupon nothing looks for. That
-- choice is only defensible because something looks for these.
do $$
declare
  v_rows jsonb;
  v_ids  text[];
begin
  -- Convert the promo year and leave it uncredited, which is the failure state.
  perform public.convert_prepayment(
            '5b000000-0000-4000-8000-0000000000c3'::uuid, 'pro');

  select public.prepayments_awaiting_credit(50) into v_rows;
  select array_agg(x ->> 'session_id' order by x ->> 'session_id')
    into v_ids from jsonb_array_elements(v_rows) x;

  if v_ids is distinct from array['cs_583_promo'] then
    raise exception 'PC-10 FAILED: the resume set is %, expected just the '
      'conversion whose credit never reached Stripe. cs_583_starter is stamped '
      'and must not be swept again; the refunded year owes nothing.',
      coalesce(v_ids::text, 'empty');
  end if;
  raise notice 'PC-10 PASSED: only the unpaid conversion is waiting';
end $$;

rollback;
