-- #277 follow-up — coming back must not leave a workspace paused forever.
--
-- THE TRAP THIS CLOSES. `claim_checkout_activation` is the one place a checkout
-- completion writes a company's subscription facts, and it already clears
-- `canceled_at` there for a reason that applies word for word to the pause: the
-- fact belongs to the subscription being REPLACED, not to the company. The pause
-- fact was left behind, so:
--
--   pause         the licensed item becomes the pause price, paused_at stamped
--   then cancel   handleSubscriptionDeleted writes subscription_status only, so
--                 paused_at survives — and the daily reconcile deliberately
--                 skips canceled tenants, so nothing re-reads it
--   then resubscribe
--                 a NEW Stripe subscription on a PLAN price; this function makes
--                 the company `active` on that plan and clears canceled_at
--
-- and the workspace comes back active, on a plan, PAYING THE FULL PRICE, with
-- paused_at still set. company_send_block then answers 'workspace_paused' in all
-- five SQL send gates, the TypeScript gate refuses every outbound path, and
-- routes/calls.ts refuses every dial — while the customer is charged $29 or $79 a
-- month for it.
--
-- What makes it the worst shape a billing bug can take is that the customer
-- cannot get out on their own. Every door is locked from the inside:
--   * POST /v1/billing/pause    refuses — `already_paused`.
--   * POST /v1/billing/change-plan refuses — paused workspaces are told to resume
--     first (and that refusal is correct; it exists so a plan change during a
--     pause is not a silent guess).
--   * POST /v1/billing/resume   409s — resume swaps the PAUSE price back, and the
--     new subscription has never carried one, so there is no item to swap.
-- The state lifts only if Stripe happens to emit another
-- customer.subscription.updated for the new subscription, which in practice means
-- the next renewal: up to a full billing period of paying for a product that
-- refuses to send a single message, with a support ticket as the only exit.
--
-- WHY THE FIX IS HERE AND NOT A syncSubscription CALL IN handleCheckoutCompleted.
--
--  1. ATOMICITY, which is the whole point. This claim is a row-locked
--     conditional attach: one statement decides that this subscription now owns
--     this company and writes every fact that follows from it. A separate mirror
--     call afterwards leaves a window in which the company is active-on-plan and
--     still blocked, and anything that ends the request inside that window — a
--     Workers CPU limit, a deploy, a PostgREST blip, the webhook sweeper
--     abandoning the row after five attempts — recreates exactly the trap above.
--     A defect whose defining property is that it has no self-serve exit must not
--     be repaired by a step that can be skipped.
--  2. IT WOULD BUY NOTHING. syncSubscription clears the pause only when it
--     recognises a PLAN licensed price on the subscription — which is precisely
--     what `p_plan is not null` already says here, from the same
--     `planForLicensedPrice` catalog, computed from the subscription object the
--     caller has already re-fetched.
--  3. COST AND BLAST RADIUS. syncSubscription is a second Stripe round trip plus
--     a full re-mirror, module reconcile, voice-item convergence and
--     cancellation-notice pass, on the hottest path in the product (signup), and
--     its unconditional status/period write would race the claim that just ran.
--
-- WHY IT IS CONDITIONED ON p_plan, AND NOT WRITTEN `paused_at = null`.
--
-- p_plan is `subscriptionPlan(env, subscription)`: the plan whose LICENSED price
-- is on the subscription being attached. A paused subscription carries the pause
-- price on that item, and pauseLicensedPrice is deliberately NOT resolvable
-- through planForLicensedPrice, so a paused subscription yields null here. Null
-- therefore means one of two things — this activation is not on a plan price, or
-- the price catalog is not currently readable (STRIPE_STARTER_PRICE_ID missing
-- from a deploy) — and the honest answer to both is to leave the stored fact
-- alone. That is the same three-answer discipline the mirror uses in
-- webhooks/stripe.ts (`paused` / `not_paused` / `unknown`), and it is what keeps
-- the unconditional version's failure mode out of reach: `paused_at = null`
-- written blind would hand full service to every paused workspace that completed
-- any checkout on the day the plan price ids went missing.
--
-- Recreated verbatim from 20260709000400_billing_double_charge_failsafes.sql,
-- with the two pause columns added to the activation update.

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
  --
  -- This is also what keeps the clear below off a genuinely paused workspace: a
  -- paused subscription is `active` in Stripe, so a second checkout completing
  -- against a still-paused company is answered 'duplicate' and cancelled, and
  -- the pause is never reached.
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
    -- #277: the pause fact belongs to the subscription being replaced, exactly
    -- like canceled_at on the line above. Cleared ONLY when this activation
    -- carries a plan licensed price (see the header) — a null p_plan means we
    -- cannot see one, and an unreadable fact is never treated as a changed one.
    paused_at              = case when p_plan is not null then null else paused_at end,
    paused_price_cents     = case when p_plan is not null then null else paused_price_cents end,
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

-- Same grants as the original definition (service-role only, SPEC §6). Restated
-- because `create or replace` keeps the existing ACL and a reader of this file
-- should not have to go and check that.
revoke execute on function public.claim_checkout_activation(uuid, text, text, text, timestamptz, timestamptz, boolean, text)
  from public, anon, authenticated;
grant execute on function public.claim_checkout_activation(uuid, text, text, text, timestamptz, timestamptz, boolean, text)
  to service_role;


-- ---------------------------------------------------------------------------
-- The column comment, corrected.
--
-- 20260805060000_paid_pause.sql claimed the pause fact "converges here within a
-- day" because the mirror re-reads it on every sync. That was not true when it
-- was written: runSubscriptionReconcileJob re-mirrored non-active companies plus
-- active ones whose period had already ended, and a paused workspace is active
-- with a fresh period — in NEITHER scan. Nothing re-read a paused company at all,
-- so a resume that landed at Stripe and not in our mirror (see P1-5: the resume
-- route charges, then syncSubscription can throw) left a paying workspace blocked
-- with no scheduled second chance.
--
-- The claim is now true rather than deleted: billing/reconcile.ts re-mirrors
-- every workspace this column says is paused, every day, and checks the pause
-- fact of every subscription the orphan sweep already lists. Both directions
-- converge, and both go through syncSubscription so this column keeps exactly
-- one writer.
--
-- The convergence covers a LIVE workspace, and the comment below says `active`
-- rather than "paused" for a reason worth stating once: the paused scan is
-- `subscription_status = active AND paused_at is not null`, so a workspace that
-- paused and then CANCELLED keeps a stale pause fact until it comes back. That
-- is deliberate and harmless — a cancelled workspace is already refused by
-- every gate on its status alone, the daily re-mirror deliberately skips
-- cancelled tenants (they keep their subscription id forever, so including them
-- would grow the scan with lifetime churn for a no-op), and the resubscribe is
-- exactly what claim_checkout_activation above clears the fact on. Writing
-- "every paused company" here would promise a sweep that does not run, which is
-- the defect this whole comment exists to stop repeating.
-- ---------------------------------------------------------------------------
comment on column public.companies.paused_at is
  '#277: when this workspace''s plan was paused. NOT a subscription_status and '
  'NOT a plan — the Stripe subscription stays genuinely active on a pause '
  'PRICE, and companies.plan keeps holding the plan to resume onto. Written only '
  'by syncSubscription, from the subscription''s licensed item: on every Stripe '
  'subscription event, and daily by the reconcile job, which re-mirrors every '
  'ACTIVE company this column marks paused and re-reads the licensed item of '
  'every subscription its orphan sweep lists — so a swap made in the Stripe '
  'dashboard, or a mirror write that was lost, converges here within a day. '
  'Both reconcile scans are capped per run and alert when the base outgrows one '
  'invocation. A CANCELLED workspace keeps its stale pause fact instead: every '
  'gate already refuses it on status, and claim_checkout_activation clears the '
  'fact when it resubscribes. Null means not paused.';
