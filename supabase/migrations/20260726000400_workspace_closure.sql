-- ===========================================================================
-- [#341 / D48] Closing a workspace — phase 1.
--
-- `DELETE FROM companies` cannot work: 38 foreign keys point at that row (25
-- restrict, 13 cascade), plus three Storage buckets, a Stripe customer, a
-- Telnyx number and every push registration. D48 splits the operation, and the
-- split is forced rather than preferred — Storage, Stripe and Telnyx are not
-- transactional, so a synchronous "delete now" can fail halfway with no way
-- back, which is the partial-teardown hazard the issue is about.
--
-- This is phase 1: the part the customer experiences as deletion, in ONE
-- transaction. The workspace closes, access ends, and `purge_after` records
-- when the erasure (phase 2, docs/DELETION.md) may run. Nothing is erased
-- here, and the copy says exactly that.
--
-- Reversible until the purge runs. A workspace closed by mistake — a wrong
-- click, a departing admin, a dispute between owners — is recoverable, and
-- that costs nothing to allow.
-- ===========================================================================

-- When the erasure may begin. NULL on a live workspace; a live workspace with
-- a `purge_after` is not a state that exists (the check below says so).
alter table public.companies
  add column if not exists purge_after timestamptz;

alter table public.companies
  drop constraint if exists companies_purge_after_requires_closed;
alter table public.companies
  add constraint companies_purge_after_requires_closed
  check (purge_after is null or deleted_at is not null);

-- The purge sweep's read path: closed workspaces whose window has passed.
create index if not exists companies_purge_due_idx
  on public.companies (purge_after)
  where purge_after is not null;

-- ---------------------------------------------------------------------------
-- [#341] Close a workspace, and hand back everything phase 1 has to clean up
-- OUTSIDE the database — read here, under the same lock, so the caller cannot
-- act on a stale picture of what the workspace owned.
--
-- Returns jsonb:
--   { "outcome": "closed",  "purge_after": ts, "user_ids": [...],
--     "phone_number_ids": [...], "stripe_subscription_id": …,
--     "stripe_customer_id": … }
--   { "outcome": "already", "purge_after": ts }   -- closed already; no-op
--   { "outcome": "not_found" }
-- ---------------------------------------------------------------------------
create or replace function public.close_workspace(
  p_company_id uuid,
  p_window     interval default interval '30 days'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted_at timestamptz;
  v_purge_after timestamptz;
  v_stripe_sub text;
  v_stripe_cus text;
  v_users uuid[];
  v_numbers uuid[];
begin
  select c.deleted_at, c.purge_after, c.stripe_subscription_id, c.stripe_customer_id
    into v_deleted_at, v_purge_after, v_stripe_sub, v_stripe_cus
    from public.companies c
   where c.id = p_company_id
   for update;

  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_deleted_at is not null then
    -- Idempotent: a retried request must not extend the window, and must not
    -- re-run the external cleanup against a workspace already torn down.
    return jsonb_build_object('outcome', 'already', 'purge_after', v_purge_after);
  end if;

  v_purge_after := now() + p_window;
  update public.companies
     set deleted_at = now(), purge_after = v_purge_after
   where id = p_company_id;

  -- EVERY member, deactivated ones included: a closed workspace signs out
  -- everyone who could still reach it, and someone deactivated last week can.
  select coalesce(array_agg(m.user_id), '{}')
    into v_users
    from public.company_members m
   where m.company_id = p_company_id;

  -- Numbers not already gone. Released ones need no second call.
  select coalesce(array_agg(n.id), '{}')
    into v_numbers
    from public.phone_numbers n
   where n.company_id = p_company_id and n.status <> 'released';

  return jsonb_build_object(
    'outcome', 'closed',
    'purge_after', v_purge_after,
    'user_ids', to_jsonb(v_users),
    'phone_number_ids', to_jsonb(v_numbers),
    'stripe_subscription_id', v_stripe_sub,
    'stripe_customer_id', v_stripe_cus
  );
end $$;

revoke execute on function public.close_workspace(uuid, interval)
  from public, anon, authenticated;
grant execute on function public.close_workspace(uuid, interval) to service_role;

-- ---------------------------------------------------------------------------
-- [#341] The undo, available until the purge runs.
--
-- It restores the workspace row only. The number was released and the
-- subscription cancelled in phase 1 — both are chargeable and neither should
-- idle for 30 days — so reopening means signing back in and buying a number
-- again. Say that; do not imply the workspace comes back as it was.
--
-- Refuses once `purge_after` has passed, because by then the erasure may have
-- started and a "restored" workspace would be a hollow one.
-- ---------------------------------------------------------------------------
create or replace function public.reopen_workspace(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted_at timestamptz;
  v_purge_after timestamptz;
begin
  select c.deleted_at, c.purge_after into v_deleted_at, v_purge_after
    from public.companies c where c.id = p_company_id for update;

  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_deleted_at is null then
    return jsonb_build_object('outcome', 'not_closed');
  end if;
  if v_purge_after is null or v_purge_after <= now() then
    return jsonb_build_object('outcome', 'too_late');
  end if;

  update public.companies
     set deleted_at = null, purge_after = null
   where id = p_company_id;
  return jsonb_build_object('outcome', 'reopened');
end $$;

revoke execute on function public.reopen_workspace(uuid)
  from public, anon, authenticated;
grant execute on function public.reopen_workspace(uuid) to service_role;
