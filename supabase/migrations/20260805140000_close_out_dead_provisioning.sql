-- #526/#523 — the rows that are NOT numbers, closed out wherever they are
-- rather than only at the instant a workspace cancels.
--
-- ── WHAT #523 SHIPPED, AND THE THREE SHAPES THAT WALKED PAST IT ───────────
--
-- `suspendCompanyNumbers` learned to close out a dead provisioning row on the
-- cancellation webhook, because every slot claim in this schema counts anything
-- that is not `released` — so a row with no phone number in it occupied the
-- plan's allowance on the way back in, and a Starter workspace resubscribing
-- with one of those plus one real number got `restored: 0, held: 1`. Its only
-- working number stayed held, and the thing holding the slot had no number.
--
-- The close-out required `number_e164`, `telnyx_phone_number_id` AND
-- `telnyx_order_id` to all be null, and ran at one moment in time. Three shapes
-- survived it, and every one of them is the same defect:
--
--  1. `recordProvisionFailure`'s transport/5xx branch DELIBERATELY keeps
--     `telnyx_order_id` — clearing it would strand an order that may still be
--     succeeding and let the next retry buy a second number. That reasoning is
--     right and is not touched here. But the row it leaves behind still has no
--     number, and it still ate the allowance.
--  2. A `provisioning` row whose 180-second saga lease expired and was never
--     cleared. `provisioning_lease_until is null` cannot tell a live saga from a
--     dead one; only a comparison against the clock can.
--  3. Every workspace ALREADY sitting in the 30-day grace window. The close-out
--     ran on the cancellation webhook, so a ghost that existed before that
--     deploy — or one created by a saga that finished a second AFTER the webhook
--     passed — was never reached by anything.
--
-- ── WHY A FUNCTION, AND WHY THE PREDICATE LIVES HERE ──────────────────────
--
-- This statement updates phone-number rows in a live database on a predicate
-- with six terms, and the cost of one wrong term is handing a working business
-- number back to a carrier that reassigns it (#413). Two things follow.
--
-- It is ONE definition, not two. The cancellation webhook and the daily grace
-- job both need it, and a predicate copied into two callers is a predicate that
-- drifts. Here there is one statement to read and one to break in a test.
--
-- And it uses the DATABASE's clock. The lease is written by
-- `claim_provisioning_lease` with `now()`; comparing it against a Worker's
-- `Date.now()` would decide whether a saga is alive using a different clock from
-- the one that declared it alive.
--
-- ── WHAT MAKES CLOSING A ROW OUT SAFE ─────────────────────────────────────
--
-- It is not a release. `number_e164` and `telnyx_phone_number_id` are both null,
-- which is the whole proof: those are the only two columns that can name a
-- number, so there is provably no number on the row and nothing is handed back
-- to anyone. This writes exactly the `released` marker `releaseNumberRow` would
-- write for such a row at grace expiry, minus the carrier call it would not make
-- — thirty days earlier, because the allowance is spent at resubscribe and
-- resubscribe happens inside those thirty days.
--
-- `telnyx_order_id` is now allowed to be set, and is deliberately LEFT on the
-- row. An order id names a purchase attempt, not a number. If that order does
-- land one, two nets already exist and neither needs this row: the next
-- provision adopts it (`adoptOrphanNumber` matches on
-- `customer_reference = company_id`), and failing that the reconcile orphan scan
-- reclaims it. Keeping the row open, by contrast, has exactly one effect — it
-- spends the slot the customer's real number needs.
--
-- ── AND THE ONE THING THAT MAKES ALL OF IT TRUE: `canceled` ONLY ──────────
--
-- Every clause above rests on "nothing will ever resume this row", and that is
-- true for exactly one cohort. `reconcileNumbers` skips companies whose
-- subscription_status is `canceled` (the grace/release path owns them), so for a
-- cancelled workspace a `provisioning` or `provision_failed` row is genuinely
-- inert. For a LIVE workspace the same row is the opposite thing: a number the
-- customer paid for, that the 15-minute retry cron is still working on, or that
-- is waiting on the "Choose a number" remediation the owner was told to use.
-- Closing that out would destroy a purchase in flight.
--
-- So the gate is in the function rather than in each caller. A caller that
-- forgets it is a caller that deletes a customer's pending number, and that is
-- not a mistake worth leaving available.

create or replace function public.close_out_dead_provisioning(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- The ENUM, not text. The prose in this repo spells it "cancelled"; the
  -- column spells it 'canceled'. Held as text, that one letter would make this
  -- function a permanent no-op indistinguishable from "no ghosts today". Held
  -- as the enum, the comparison below refuses to run at all.
  v_status public.subscription_status;
  v_closed jsonb;
begin
  select subscription_status
    into v_status
    from public.companies
   where id = p_company_id;
  if not found then
    raise exception 'close_out_dead_provisioning: company % not found', p_company_id;
  end if;

  -- See the header: a live workspace's in-flight row is a purchase, not a ghost.
  if v_status is distinct from 'canceled' then
    return jsonb_build_object('eligible', false, 'closed', '[]'::jsonb);
  end if;

  with dead as (
    update public.phone_numbers
       set status = 'released', released_at = now()
     where company_id = p_company_id
       -- A ported row is fulfilled by the port saga and a hosted row by the
       -- text-enablement saga; an open port sits in exactly this shape for
       -- weeks, and neither is this function's to judge.
       and source = 'provisioned'
       -- `active` and `suspended` are working lines; `released` is already done.
       and status in ('provisioning', 'provision_failed')
       -- The proof that there is no number. Dropping either of these would
       -- release a real line: `number_e164` is the number itself, and marking a
       -- row released also frees it from `phone_numbers_e164_uq`, which is what
       -- lets another workspace claim it.
       and number_e164 is null
       and telnyx_phone_number_id is null
       -- Free, or held by a saga that is already dead. A LIVE lease means an
       -- execution is on this row right now and its own terminal write is
       -- moments away, which would resurrect a row we had just closed. `is
       -- null` alone — what #523 had — cannot tell the two apart, which is why
       -- a lease that expired days ago survived every cancellation.
       and (provisioning_lease_until is null or provisioning_lease_until <= now())
    returning id, telnyx_order_id, created_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id,
           -- Reported so the caller can say, in one line, that it closed out a
           -- row whose order may still land — the case the reconcile orphan net
           -- picks up from here.
           'telnyx_order_id', telnyx_order_id) order by created_at, id), '[]'::jsonb)
    into v_closed
    from dead;

  return jsonb_build_object('eligible', true, 'closed', v_closed);
end $$;

comment on function public.close_out_dead_provisioning(uuid) is
  '#526/#523: mark released the provisioning rows of a CANCELLED workspace that '
  'provably never became a number (no number_e164, no telnyx_phone_number_id, no '
  'live saga lease), so they stop occupying the plan allowance a resubscribe '
  'settles against. Never touches a row that names a number.';

-- Deny by default (SPEC §6): this writes phone-number state, so only the
-- Worker's service role may call it.
revoke execute on function public.close_out_dead_provisioning(uuid)
  from public, anon, authenticated;
grant execute on function public.close_out_dead_provisioning(uuid)
  to service_role;
