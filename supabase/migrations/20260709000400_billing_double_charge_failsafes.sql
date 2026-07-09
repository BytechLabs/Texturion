-- SPEC §2/§4/§9 — double-charge fail-safes for the remaining buyable paths.
--
-- A follow-on to 20260709000300 (which fixed the INITIAL number double-order).
-- An adversarial audit of every buyable surface confirmed three more places where
-- two concurrent/retried intents bill twice for one purchase — and the same
-- lease + idempotency-key pattern closes them:
--
--   1. CHECKOUT — two checkout completions (a raced second checkout, or two
--      Checkout Sessions) both ran the UNCONDITIONAL companies activation
--      overwrite (webhooks/stripe.ts): last-write-wins attached the second
--      subscription and orphaned the first, which kept billing forever. Fix =
--      claim_checkout_activation: an atomic, row-locked conditional claim that
--      attaches exactly ONE live subscription per company and reports a duplicate
--      completion so the caller cancels the orphan.
--
--   2. TEXT-ENABLEMENT — resumeTextEnablement had NO per-row lease and NO
--      persisted Telnyx idempotency key (unlike the numbers saga), so two
--      concurrent resubmits — or the reconcile cron racing the inline saga —
--      both POSTed messaging_hosted_number_orders and bought TWO hosted orders
--      for one number. Fix = the same lease + order-key columns/RPCs the numbers
--      path uses, on text_enablement_orders.
--
--   3. US-REGISTRATION $29 FEE — both concurrent enable-us calls read
--      registration_fee_paid_at=null (it is stamped only later by the async
--      invoice.paid webhook) and each finalized a $29 invoice. Fix = a
--      registration_fee_charge_started_at start-marker claimed atomically before
--      the invoice, so the fee is charged at most once (cleared on payment
--      failure so a genuine retry is never blocked).

-- ---------------------------------------------------------------------------
-- (1) CHECKOUT — one live subscription per company, claimed atomically.
-- ---------------------------------------------------------------------------

-- claim_checkout_activation: apply a checkout completion's activation to the
-- company row UNDER A ROW LOCK, but only when no DIFFERENT live subscription is
-- already attached. Concurrent completions serialize on the FOR UPDATE lock:
--   'claimed'   — attached this subscription (fresh, or replacing a dead one).
--   'noop'      — this subscription is already attached (the confirm-checkout vs
--                 webhook double-fire on the SAME session) — refreshed, proceed.
--   'duplicate' — a DIFFERENT still-live subscription already owns the company;
--                 the caller cancels THIS one so it never bills.
-- Live statuses mirror billing/plans.ts hasLiveSubscription (active/past_due/unpaid).
create or replace function public.claim_checkout_activation(
  p_company_id           uuid,
  p_customer_id          text,
  p_subscription_id      text,
  p_status               text,
  p_period_start         timestamptz,
  p_period_end           timestamptz,
  p_cancel_at_period_end boolean,
  p_plan                 text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub     text;
  v_status  text;
  v_modules jsonb;
begin
  select stripe_subscription_id, subscription_status
    into v_sub, v_status
    from public.companies
   where id = p_company_id
     for update;
  if not found then
    raise exception 'claim_checkout_activation: company % not found', p_company_id;
  end if;

  -- A DIFFERENT, still-live subscription already owns this company → this
  -- completion is a raced duplicate. Do NOT overwrite (that would orphan the
  -- live one to bill forever); the caller cancels THIS subscription instead.
  if v_sub is not null
     and v_sub <> p_subscription_id
     and v_status in ('active', 'past_due', 'unpaid') then
    return jsonb_build_object(
      'outcome', 'duplicate',
      'existing_subscription_id', v_sub);
  end if;

  update public.companies set
    stripe_customer_id     = p_customer_id,
    stripe_subscription_id = p_subscription_id,
    subscription_status    = p_status::public.subscription_status,
    current_period_start   = p_period_start,
    current_period_end     = p_period_end,
    canceled_at            = null,
    cancel_at_period_end   = p_cancel_at_period_end,
    plan                   = coalesce(p_plan::public.plan_id, plan)
  where id = p_company_id;

  -- Return the company_modules truth alongside the claim so the caller's #17
  -- reconcile needs no second read (as the old embedded activation select did).
  select coalesce(
           jsonb_agg(jsonb_build_object(
             'module', module,
             'disabled_at', disabled_at,
             'grandfathered', grandfathered)),
           '[]'::jsonb)
    into v_modules
    from public.company_modules
   where company_id = p_company_id;

  return jsonb_build_object(
    'outcome',
    case when v_sub = p_subscription_id then 'noop' else 'claimed' end,
    'existing_subscription_id', v_sub,
    'modules', v_modules);
end $$;

-- ---------------------------------------------------------------------------
-- (2) TEXT-ENABLEMENT — per-row lease + deterministic Telnyx order key, exactly
--     as the numbers saga (20260709000300).
-- ---------------------------------------------------------------------------

alter table public.text_enablement_orders
  add column provisioning_lease_until     timestamptz,
  add column telnyx_order_idempotency_key text;

create index text_enablement_orders_lease_idx
  on public.text_enablement_orders (provisioning_lease_until)
  where provisioning_lease_until is not null;

-- Mirrors claim_provisioning_lease on text_enablement_orders.
create or replace function public.claim_text_enablement_lease(
  p_row_id        uuid,
  p_lease_seconds int
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.text_enablement_orders%rowtype;
begin
  if p_lease_seconds is null or p_lease_seconds < 1 then
    raise exception 'claim_text_enablement_lease: p_lease_seconds must be >= 1';
  end if;

  update public.text_enablement_orders
     set provisioning_lease_until = now() + make_interval(secs => p_lease_seconds)
   where id = p_row_id
     and (provisioning_lease_until is null or provisioning_lease_until < now())
  returning * into v_row;

  if not found then
    return null; -- lease held by another execution
  end if;
  return to_jsonb(v_row);
end $$;

-- Mirrors claim_order_idempotency_key on text_enablement_orders.
create or replace function public.claim_text_enablement_order_key(
  p_row_id uuid
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  update public.text_enablement_orders
     set telnyx_order_idempotency_key =
           coalesce(telnyx_order_idempotency_key, gen_random_uuid()::text)
   where id = p_row_id
  returning telnyx_order_idempotency_key into v_key;

  if not found then
    raise exception 'claim_text_enablement_order_key: row % not found', p_row_id;
  end if;
  return v_key;
end $$;

-- ---------------------------------------------------------------------------
-- (3) US-REGISTRATION $29 fee — a start-marker so the fee invoices at most once.
-- ---------------------------------------------------------------------------

alter table public.companies
  add column registration_fee_charge_started_at timestamptz;

-- ---------------------------------------------------------------------------
-- Grants — service-role-only, like every RPC in this schema (SPEC §6).
-- ---------------------------------------------------------------------------
revoke execute on function public.claim_checkout_activation(uuid, text, text, text, timestamptz, timestamptz, boolean, text)
  from public, anon, authenticated;
grant execute on function public.claim_checkout_activation(uuid, text, text, text, timestamptz, timestamptz, boolean, text)
  to service_role;

revoke execute on function public.claim_text_enablement_lease(uuid, int)
  from public, anon, authenticated;
grant execute on function public.claim_text_enablement_lease(uuid, int)
  to service_role;

revoke execute on function public.claim_text_enablement_order_key(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_text_enablement_order_key(uuid)
  to service_role;
