-- SPEC §4.3 — double-order fail-safes for the number-provisioning saga.
--
-- The saga has FIVE triggers that can fire on ONE phone_numbers row at once: the
-- paid checkout.session.completed webhook, the setting-up screen's
-- POST /v1/billing/confirm-checkout, the 15-minute reconcile cron,
-- /settings/numbers remediation, and POST /v1/numbers/provision. Before this
-- migration none of them held a per-row lock, so the webhook racing
-- confirm-checkout on a single signup — the DESIGNED common case, both firing in
-- the same 1-2s — placed TWO Telnyx number_orders for ONE paid slot. The second
-- number is Telnyx-owned but orphaned from every row, billing the founder
-- forever (the reconcile orphan scan only warned, never reclaimed).
--
-- Two columns back the fix (apps/api/src/telnyx/provisioning.ts):
--
--   provisioning_lease_until      PRIMARY. A per-row lease. resumeProvisioning
--                                 claims it atomically at the single chokepoint
--                                 all five paths funnel through; exactly one
--                                 execution runs the saga, the rest return the
--                                 row untouched. A crash mid-lease is healed by
--                                 EXPIRY (the next execution reclaims and recovers
--                                 from the persisted order id / customer_reference
--                                 orphan), never a double purchase.
--
--   telnyx_order_idempotency_key  BACKSTOP. A deterministic Telnyx Idempotency-Key
--                                 persisted BEFORE the order POST. If a lease
--                                 holder crashes after the POST but before it
--                                 persists telnyx_order_id (and the lease later
--                                 expires), the next execution re-sends the SAME
--                                 key and Telnyx REPLAYS the first order instead
--                                 of buying a second — closing the cross-isolate
--                                 crash window the lease alone cannot.

alter table public.phone_numbers
  add column provisioning_lease_until     timestamptz,
  add column telnyx_order_idempotency_key text;

-- The cron scans provisioning/provision_failed rows every 15 minutes; the partial
-- index keeps the lease-expiry predicate cheap as the table grows.
create index phone_numbers_lease_idx
  on public.phone_numbers (provisioning_lease_until)
  where provisioning_lease_until is not null;

-- claim_provisioning_lease: the atomic per-row lease claim. A single UPDATE with
-- a server-side now() guard — concurrent executions serialize on the row lock;
-- the first sets the lease and gets the row back, the rest match zero rows and
-- get null (another execution owns the saga). Returns the FRESH row (jsonb) so
-- the winner acts on the latest chosen_number_e164 / requested_area_code (e.g. a
-- remediation written an instant earlier), never a stale caller snapshot.
create or replace function public.claim_provisioning_lease(
  p_row_id        uuid,
  p_lease_seconds int
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.phone_numbers%rowtype;
begin
  if p_lease_seconds is null or p_lease_seconds < 1 then
    raise exception 'claim_provisioning_lease: p_lease_seconds must be >= 1';
  end if;

  update public.phone_numbers
     set provisioning_lease_until = now() + make_interval(secs => p_lease_seconds)
   where id = p_row_id
     and (provisioning_lease_until is null or provisioning_lease_until < now())
  returning * into v_row;

  if not found then
    return null; -- lease held by another execution; caller returns row untouched
  end if;
  return to_jsonb(v_row);
end $$;

-- claim_order_idempotency_key: COALESCE-claim the per-row Telnyx Idempotency-Key.
-- Two concurrent executions (or a retry after a crash) get the SAME key: the
-- first generates it, the rest read the existing value — so a replayed POST
-- collapses to ONE Telnyx number_order. The saga nulls the key when it clears
-- telnyx_order_id on an authoritatively-dead order (OrderDeadError) and before a
-- chosen-number taken-fallback re-POST, so a genuinely fresh reorder mints a
-- fresh key rather than replaying a dead / rejected order.
create or replace function public.claim_order_idempotency_key(
  p_row_id uuid
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  update public.phone_numbers
     set telnyx_order_idempotency_key =
           coalesce(telnyx_order_idempotency_key, gen_random_uuid()::text)
   where id = p_row_id
  returning telnyx_order_idempotency_key into v_key;

  if not found then
    raise exception 'claim_order_idempotency_key: row % not found', p_row_id;
  end if;
  return v_key;
end $$;

-- Service-role-only, like every RPC in this schema (SPEC §6 RLS posture):
-- end-user roles never touch PostgREST.
revoke execute on function public.claim_provisioning_lease(uuid, int)
  from public, anon, authenticated;
grant execute on function public.claim_provisioning_lease(uuid, int)
  to service_role;

revoke execute on function public.claim_order_idempotency_key(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_order_idempotency_key(uuid)
  to service_role;
