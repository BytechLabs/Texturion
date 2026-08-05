-- #523 — coming back must not hand a workspace more numbers than it just paid
-- for, and must not take any of them away either.
--
-- WHAT WAS THERE. `handleCheckoutCompleted` un-suspended every held number with
-- one unfiltered statement:
--
--     update phone_numbers set status = 'active', suspended_at = null
--      where company_id = $1 and status = 'suspended'
--
-- No plan term, no count, no ceiling. A Pro workspace holding two numbers that
-- cancelled, sat in the 30-day grace window and then pressed the #277 win-back's
-- "Come back on Starter" came back holding both — on a plan that includes one.
-- `convergeExtraNumberQuantity` is deliberately down-only (#105), so the second
-- number was never billed either: it reported `over_included_unbilled` into
-- Sentry every day and we paid the $1.10/mo Telnyx rent on it forever. Nothing
-- else reclaims it — `runGraceJob` only scans CANCELLED companies, and this one
-- is live and paying.
--
-- WHAT REPLACES IT, AND WHY IT IS ONE FUNCTION RATHER THAN A READ AND A WRITE.
--
-- The allowance and the un-suspend are one decision. Deciding "this workspace
-- may hold two" in the Worker and then writing it in a second statement leaves a
-- window in which a port claim, a text-enablement claim or a manual provision —
-- every one of which takes THIS row lock and admits against
-- `p_included + paid_extra_numbers` — can land in between. The number they were
-- admitted into is then handed out twice, which is the exact race #110 built the
-- company-row lock to close. So the capacity write, the count and the restore
-- all happen under one lock, in one statement, like every other slot claim.
--
-- WHAT IT DELIBERATELY DOES NOT DO.
--
--  * It never RELEASES anything. A number over the allowance stays `suspended`:
--    inbound still lands on it and the history is intact, so nothing the
--    customer still wants is destroyed. Releasing hands the number back to the
--    carrier, where it is reassigned to another business (#413), and doing that
--    to somebody in the act of paying us again would be indefensible.
--  * It never refuses the checkout. This function runs AFTER the money has
--    moved; there is no branch here that can fail a resubscribe. That is #277's
--    rule and it is not re-litigated: coming back is never refused.
--
-- OLDEST FIRST. When only some of the held numbers fit, the ones that come back
-- are the ones the workspace has had longest. That is the number on the van, the
-- invoices and the Google listing; a number bought last month is the one whose
-- absence costs least. `created_at, id` so the order is total and a re-run picks
-- the same rows.
--
-- IDEMPOTENT. Restored rows are no longer `suspended`, so they count as occupied
-- on the next call and nothing further is restored. The webhook and the
-- `confirm-checkout` poller both call this for the same session, and the sweeper
-- replays the whole handler — all three converge on the same set.
--
-- ── p_prefer_id: THE PAID REINSTATE IS ALL-OR-NOTHING ──────────────────────
--
-- `POST /v1/billing/held-numbers/:id/reinstate` buys capacity for ONE named
-- number, and the charge is only honest if that number is what comes back. Two
-- things follow, and both live here rather than in the Worker, because both are
-- decisions about the same locked row.
--
--  1. RANK IT FIRST. Oldest-first is the right default for a resubscribe, where
--     nobody named a number — it brings back the one on the van. It is the
--     WRONG answer for a purchase: a workspace holding two numbers that pays to
--     un-hold the newer one would get the older one back instead, and the card
--     it pressed the button on would still say "on hold" after the money moved.
--
--  2. DELIVER OR CHANGE NOTHING. If the raise would not actually bring that
--     number back — the #110 fence refused it, or the workspace's other numbers
--     already fill the allowance (a port mid-transfer, a row mid-provision) —
--     this writes NO capacity, restores NOTHING, and says so. The route then
--     charges nothing. That is what makes "charged ⇒ the number is back" true:
--     the claim is the authority on whether the number can come back, and the
--     charge follows what it actually did.
--
-- Null (every other caller: checkout, change-plan) leaves both behaviours off —
-- `id = null` is NULL, so the rank expression is constant and the ordering is
-- exactly the oldest-first it always was.

create or replace function public.claim_number_allowance(
  p_company_id     uuid,
  -- The plan's INCLUDED numbers (PLAN_LIMITS[plan].numbers). NULL means the
  -- caller could not read the plan at all — see the branch below.
  p_included       int,
  -- Paid extra numbers actually billed on the subscription right now.
  p_paid_extras    int default 0,
  -- #110 raise fence, read BEFORE the billed conclusion was formed. Required
  -- only to RAISE the stored capacity; a lower or an equal never needs one.
  p_expected_epoch bigint default null,
  -- The one number a PURCHASE is for — see the note above.
  p_prefer_id      uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stored    int;
  v_epoch     bigint;
  v_capacity  int;
  v_allowance int;
  v_occupied  int;
  v_budget    int;
  v_restored  jsonb;
  v_held      jsonb;
  v_fenced    boolean := false;
  v_wanted    boolean := false;
begin
  if p_paid_extras is null or p_paid_extras < 0 then
    raise exception 'claim_number_allowance: p_paid_extras must be >= 0';
  end if;

  select paid_extra_numbers, paid_capacity_epoch
    into v_stored, v_epoch
    from public.companies
   where id = p_company_id
     for update;
  if not found then
    raise exception 'claim_number_allowance: company % not found', p_company_id;
  end if;

  -- The plan is unreadable. `subscriptionPlan` answers null when the licensed
  -- price on the subscription is not in this deploy's catalog — a missing
  -- STRIPE_STARTER_PRICE_ID, or a paused subscription whose licensed item is the
  -- pause price. Neither is a statement about how many numbers this workspace
  -- may hold, and an unreadable fact is never treated as a changed one (the
  -- argument 20260805080000_resubscribe_clears_pause.sql makes for the pause
  -- applies here word for word). So: restore everything, exactly as the old
  -- unfiltered statement did, and touch no capacity. A deploy that cannot read
  -- its own price ids must not hold a paying customer's phone numbers hostage.
  if p_included is null then
    with restored as (
      update public.phone_numbers
         set status = 'active', suspended_at = null
       where company_id = p_company_id
         and status = 'suspended'
      returning id, number_e164, created_at
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', id, 'number_e164', number_e164) order by created_at, id), '[]'::jsonb)
      into v_restored
      from restored;
    return jsonb_build_object(
      'applied', true,
      'plan_known', false,
      'allowance', null,
      'capacity', v_stored,
      'restored', v_restored,
      'held', '[]'::jsonb);
  end if;

  if p_included < 0 then
    raise exception 'claim_number_allowance: p_included must be >= 0';
  end if;

  -- #110: a RAISE without the epoch that was read before the billed conclusion
  -- was formed may be resurrecting capacity a credit decision just took away.
  -- Refused rather than trusted, and the allowance below is then computed from
  -- the STORED capacity — fail closed, hold one more, never hand out a free
  -- number. The caller's next converge re-mirrors.
  v_capacity := p_paid_extras;
  if p_paid_extras > v_stored
     and (p_expected_epoch is null or p_expected_epoch <> v_epoch) then
    v_capacity := v_stored;
    v_fenced := true;
  end if;

  v_allowance := p_included + v_capacity;

  -- What already occupies the allowance. `<> 'released'` is what every slot
  -- claim counts (provision_number_slot, claim_port_slot,
  -- claim_text_enablement_slot), minus the suspended rows this call is deciding
  -- about — a row mid-provision or a ported row still owes us its rent and must
  -- not be displaced by a number we bring back.
  select count(*)
    into v_occupied
    from public.phone_numbers
   where company_id = p_company_id
     and status not in ('released', 'suspended');

  v_budget := greatest(0, v_allowance - v_occupied);

  -- DELIVER OR CHANGE NOTHING (see p_prefer_id in the header). Decided BEFORE
  -- the capacity write below, so a purchase that cannot be delivered leaves the
  -- workspace untouched and the caller with nothing to charge for. The row must
  -- still be suspended and on THIS company — a caller racing a change-plan
  -- upgrade that already reinstated it must be told, not charged.
  if p_prefer_id is not null then
    select exists (
      select 1 from public.phone_numbers
       where id = p_prefer_id
         and company_id = p_company_id
         and status = 'suspended'
    ) into v_wanted;

    -- A FENCED raise refuses too, even when the stored allowance happens to
    -- have room. The caller is about to charge for the unit of capacity this
    -- call declined to record; letting the number back on the plan's OWN
    -- allowance would deliver it and take the money for capacity nobody ends up
    -- holding. Refuse, and the retry (with the epoch the credit left behind)
    -- either buys it properly or finds it already covered for free.
    if not v_wanted or v_budget < 1 or v_fenced then
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', id,
               'number_e164', number_e164,
               'suspended_at', suspended_at) order by created_at, id), '[]'::jsonb)
        into v_held
        from public.phone_numbers
       where company_id = p_company_id
         and status = 'suspended';
      -- The STORED capacity, not v_capacity: nothing was written, and reporting
      -- the figure we declined to write would tell the caller it had been.
      return jsonb_build_object(
        'applied', false,
        'plan_known', true,
        'allowance', p_included + v_stored,
        'capacity', v_stored,
        'capacity_fenced', v_fenced,
        'restored', '[]'::jsonb,
        'held', v_held);
    end if;
  end if;

  -- Every capacity decision bumps the epoch, for the same reason
  -- claim_extra_lower does: any raise formed before this moment is now suspect.
  update public.companies
     set paid_extra_numbers = v_capacity,
         paid_capacity_epoch = paid_capacity_epoch + 1
   where id = p_company_id;

  with candidates as (
    select id, number_e164, created_at,
           -- The number a purchase named comes back first; everything else is
           -- oldest-first. p_prefer_id null → the case is 1 for every row and
           -- the order is unchanged.
           row_number() over (
             order by (case when id = p_prefer_id then 0 else 1 end),
                      created_at, id) as rank
      from public.phone_numbers
     where company_id = p_company_id
       and status = 'suspended'
  ),
  restored as (
    update public.phone_numbers pn
       set status = 'active', suspended_at = null
      from candidates c
     where pn.id = c.id
       and c.rank <= v_budget
    returning pn.id, pn.number_e164, c.created_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'number_e164', number_e164) order by created_at, id), '[]'::jsonb)
    into v_restored
    from restored;

  -- Whatever is still suspended after the restore is what is HELD. Read back
  -- rather than derived from the candidate list, so the answer is the row state
  -- the owner will be shown and not this function's opinion of it.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id,
           'number_e164', number_e164,
           'suspended_at', suspended_at) order by created_at, id), '[]'::jsonb)
    into v_held
    from public.phone_numbers
   where company_id = p_company_id
     and status = 'suspended';

  return jsonb_build_object(
    -- Something was written: the capacity, the epoch, and whatever the budget
    -- covered. False only on the all-or-nothing refusal above.
    'applied', true,
    'plan_known', true,
    'allowance', v_allowance,
    'capacity', v_capacity,
    -- True when the raise fence refused the caller's billed figure. Surfaced so
    -- a caller can log it rather than wonder why fewer numbers came back.
    'capacity_fenced', v_fenced,
    'restored', v_restored,
    'held', v_held);
end $$;

comment on function public.claim_number_allowance(uuid, int, int, bigint, uuid) is
  '#523: bring back what the plan plus paid extras cover, hold the rest '
  'suspended, never release anything. One row-locked statement so the allowance '
  'and the un-suspend cannot be split by a concurrent slot claim. p_prefer_id '
  'makes a paid reinstate all-or-nothing: that number first, or no change at all.';

-- Deny by default (SPEC §6): this writes billing capacity and phone-number
-- state, so only the Worker's service role may call it.
revoke execute on function
  public.claim_number_allowance(uuid, int, int, bigint, uuid)
  from public, anon, authenticated;
grant execute on function
  public.claim_number_allowance(uuid, int, int, bigint, uuid)
  to service_role;
