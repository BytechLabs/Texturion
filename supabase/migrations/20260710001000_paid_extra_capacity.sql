-- #110 (#80): serialize paid-extra-number ADMISSION against the down-only
-- billing convergence, closing the race #108's review found: a port/enable
-- admitted into a paid slot in the same sub-second window the reconcile (or a
-- release-converge) credits that slot away left the company holding a number
-- it isn't billed for (never auto-charged; Sentry-flagged — but real).
--
-- The fix: paid-extra CAPACITY becomes a Postgres column kept equal to the
-- live Stripe extra-number quantity, and every capacity decision happens under
-- the SAME company-row lock the slot claims take:
--
--   companies.paid_extra_numbers   the capacity slot claims may admit into.
--   sync_paid_extra_capacity       lock + set column = the live billed
--                                  quantity (the buy, the converge outcomes,
--                                  the upgrade item swap, the reconcile
--                                  self-heal/backfill all call it).
--   claim_extra_lower              the converge's DECISION to credit down:
--                                  lock, re-count, shrink the column to the
--                                  formula — admits and credits now serialize.
--   slot RPCs                      compute max = p_included_numbers +
--                                  paid_extra_numbers INSIDE their lock; the
--                                  Worker no longer reads Stripe on the port /
--                                  text-enable paths at all.
--
-- Race replay (the #110 scenario): converge locks first → re-counts under the
-- lock → shrinks the column → commits → the port claim (queued on the lock)
-- reads the SHRUNK capacity → 409 plan_limit (honest fail-closed). Port first
-- → its row commits → converge re-counts, sees the new number, desired == billed
-- → noop. Either order, never a free number.
--
-- Stripe remains the money source of truth: a Stripe write that fails AFTER a
-- claim leaves the column ≤ billed (capacity fail-closed, customer over-billed
-- transiently) and the next converge retries the credit; the reconcile's sync
-- backfills/heals any drift each day. The column can never exceed what Stripe
-- bills for longer than one reconcile cycle.

alter table public.companies
  add column paid_extra_numbers int not null default 0
    check (paid_extra_numbers >= 0);

-- The RAISE fence: every claim_extra_lower bumps this epoch. A capacity RAISE
-- (sync with p_billed above the stored value) must present the epoch it read
-- BEFORE forming its billed conclusion — a claim in between invalidates the
-- raise (applied:false), so a stale conclusion can never resurrect capacity a
-- credit decision just shrank. Lowers are always safe and never fenced.
alter table public.companies
  add column paid_capacity_epoch bigint not null default 0;

comment on column public.companies.paid_extra_numbers is
  'Paid extra-number capacity (#110) — mirrors the live Stripe extra-number item quantity; slot claims admit into included + this, under the company-row lock.';

-- ---------------------------------------------------------------------------
-- sync_paid_extra_capacity: mirror the live billed quantity into the column,
-- under the company lock. LOWERS always apply (down-safe). RAISES are fenced:
-- the caller must present the paid_capacity_epoch it read BEFORE forming its
-- billed conclusion — if any claim_extra_lower ran since, the raise is refused
-- (applied:false) rather than resurrecting credited capacity (#110 review).
-- ---------------------------------------------------------------------------
create or replace function public.sync_paid_extra_capacity(
  p_company_id     uuid,
  p_billed         int,
  p_expected_epoch bigint default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current int;
  v_epoch   bigint;
begin
  if p_billed is null or p_billed < 0 then
    raise exception 'sync_paid_extra_capacity: p_billed must be >= 0';
  end if;
  select paid_extra_numbers, paid_capacity_epoch into v_current, v_epoch
  from public.companies where id = p_company_id for update;
  if not found then
    raise exception 'sync_paid_extra_capacity: company % not found', p_company_id;
  end if;

  if p_billed > v_current then
    -- A raise without a fresh epoch is never safe (the conclusion may predate
    -- a credit); with a stale epoch it is provably unsafe. Refuse both.
    if p_expected_epoch is null or p_expected_epoch <> v_epoch then
      return jsonb_build_object(
        'applied', false, 'capacity', v_current, 'epoch', v_epoch);
    end if;
  end if;

  if v_current is distinct from p_billed then
    update public.companies
       set paid_extra_numbers = p_billed
     where id = p_company_id;
  end if;
  return jsonb_build_object(
    'applied', true, 'capacity', p_billed, 'epoch', v_epoch);
end $$;

-- ---------------------------------------------------------------------------
-- claim_extra_lower: the converge's serialized decision to credit capacity
-- down to the formula (max(0, count − included)). Locks the company row,
-- re-counts UNDER the lock (a concurrent admit either committed — and is
-- counted — or is queued behind this lock), and shrinks the column when it
-- exceeds the formula. Never raises capacity. The Worker writes the Stripe
-- quantity after this returns; `allowed:false` (already at/below the formula)
-- does NOT skip that write — it only means capacity needed no shrink (e.g. a
-- prior run claimed then crashed before Stripe landed).
-- ---------------------------------------------------------------------------
create or replace function public.claim_extra_lower(
  p_company_id uuid,
  p_included   int
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current int;
  v_count   int;
  v_desired int;
  v_epoch   bigint;
begin
  if p_included is null or p_included < 0 then
    raise exception 'claim_extra_lower: p_included must be >= 0';
  end if;
  select paid_extra_numbers into v_current
  from public.companies where id = p_company_id for update;
  if not found then
    raise exception 'claim_extra_lower: company % not found', p_company_id;
  end if;

  select count(*) into v_count
  from public.phone_numbers
  where company_id = p_company_id and status <> 'released';

  v_desired := greatest(0, v_count - p_included);
  -- EVERY claim bumps the epoch — a Stripe credit may follow regardless of
  -- whether the column itself needed shrinking (a prior claim may have already
  -- shrunk it), and any raise formed before this moment is now suspect.
  update public.companies
     set paid_capacity_epoch = paid_capacity_epoch + 1,
         paid_extra_numbers  = least(paid_extra_numbers, v_desired)
   where id = p_company_id
  returning paid_capacity_epoch into v_epoch;

  return jsonb_build_object(
    'allowed', v_current > v_desired,
    'desired', v_desired,
    'count', v_count,
    'epoch', v_epoch);
end $$;

-- ---------------------------------------------------------------------------
-- provision_number_slot: p_max_numbers → p_included_numbers; the paid-extra
-- capacity is read from the column UNDER the lock. Body otherwise identical to
-- 20260709000700 (idempotent replay, sole-prop cap, churn cap). The signature
-- changes, so the old overload is dropped first.
-- ---------------------------------------------------------------------------
drop function if exists public.provision_number_slot(uuid, text, text, text, int, text, int);

create or replace function public.provision_number_slot(
  p_company_id          uuid,
  p_provisioning_key    text,
  p_requested_area_code text,
  p_country             text,
  p_included_numbers    int,
  p_chosen_number_e164  text default null,
  p_provision_cap       int  default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing    public.phone_numbers%rowtype;
  v_row         public.phone_numbers%rowtype;
  v_count       int;
  v_sole_prop   boolean;
  v_provisioned int;
  v_paid        int;
  v_max         int;
begin
  if p_provisioning_key is null or length(trim(p_provisioning_key)) = 0 then
    raise exception 'provision_number_slot: provisioning key is required';
  end if;
  if p_included_numbers is null or p_included_numbers < 1 then
    raise exception 'provision_number_slot: p_included_numbers must be >= 1';
  end if;
  if p_country not in ('US', 'CA') then
    raise exception 'provision_number_slot: country must be US or CA';
  end if;
  if p_chosen_number_e164 is not null
     and p_chosen_number_e164 !~ '^\+1\d{10}$' then
    raise exception 'provision_number_slot: chosen_number must be an E.164 NANP number';
  end if;

  -- Serialize per company: concurrent provisions, ports, enables, AND the
  -- converge's lower decision (#110) all queue on this lock, so the count and
  -- the paid capacity below are authoritative together.
  select paid_extra_numbers into v_paid
  from public.companies where id = p_company_id for update;
  if not found then
    raise exception 'provision_number_slot: company % not found', p_company_id;
  end if;
  v_max := p_included_numbers + v_paid;

  -- Idempotent replay: the same Idempotency-Key returns the same row (§7). This
  -- runs BEFORE the churn cap so a retried request never consumes churn budget.
  select * into v_existing
  from public.phone_numbers
  where provisioning_key = p_provisioning_key;
  if found then
    if v_existing.company_id <> p_company_id then
      raise exception 'provision_number_slot: provisioning key belongs to another company';
    end if;
    return jsonb_build_object('outcome', 'exists', 'number', to_jsonb(v_existing));
  end if;

  select count(*) into v_count
  from public.phone_numbers
  where company_id = p_company_id and status <> 'released';

  -- §4.2: Sole Proprietor brands are capped at 1 number regardless of plan.
  select exists (
    select 1 from public.messaging_registrations mr
    where mr.company_id = p_company_id
      and mr.kind = 'brand'
      and mr.sole_proprietor
  ) into v_sole_prop;

  if v_sole_prop and v_count >= 1 then
    return jsonb_build_object('outcome', 'sole_prop_cap', 'number', null);
  end if;
  if v_count >= v_max then
    return jsonb_build_object('outcome', 'plan_limit', 'number', null, 'max', v_max);
  end if;

  -- #74 churn cap: bound the lifetime number of provisions (each buys a fresh
  -- Telnyx number). Read under the company-row lock, so no concurrent burst can
  -- overshoot. Checked here, right before the insert, so a capped call inserts
  -- no row.
  if p_provision_cap is not null then
    select number_provision_count into v_provisioned
    from public.companies where id = p_company_id;
    if v_provisioned >= p_provision_cap then
      return jsonb_build_object(
        'outcome', 'provision_cap', 'number', null, 'limit', p_provision_cap);
    end if;
  end if;

  insert into public.phone_numbers
    (company_id, status, provisioning_key, requested_area_code, country, chosen_number_e164)
  values
    (p_company_id, 'provisioning', p_provisioning_key, p_requested_area_code, p_country, p_chosen_number_e164)
  returning * into v_row;

  update public.companies
     set number_provision_count = number_provision_count + 1
   where id = p_company_id;

  return jsonb_build_object('outcome', 'created', 'number', to_jsonb(v_row));
end $$;

-- ---------------------------------------------------------------------------
-- claim_port_slot: same p_included_numbers + column change. Body otherwise
-- identical to 20260702040000.
-- ---------------------------------------------------------------------------
drop function if exists public.claim_port_slot(uuid, text, text, int);

create or replace function public.claim_port_slot(
  p_company_id       uuid,
  p_provisioning_key text,
  p_country          text,
  p_included_numbers int
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing  public.phone_numbers%rowtype;
  v_row       public.phone_numbers%rowtype;
  v_count     int;
  v_sole_prop boolean;
  v_paid      int;
  v_max       int;
begin
  if p_provisioning_key is null or length(trim(p_provisioning_key)) = 0 then
    raise exception 'claim_port_slot: provisioning key is required';
  end if;
  if p_included_numbers is null or p_included_numbers < 1 then
    raise exception 'claim_port_slot: p_included_numbers must be >= 1';
  end if;
  if p_country not in ('US', 'CA') then
    raise exception 'claim_port_slot: country must be US or CA';
  end if;

  select paid_extra_numbers into v_paid
  from public.companies where id = p_company_id for update;
  if not found then
    raise exception 'claim_port_slot: company % not found', p_company_id;
  end if;
  v_max := p_included_numbers + v_paid;

  select * into v_existing
  from public.phone_numbers
  where provisioning_key = p_provisioning_key;
  if found then
    if v_existing.company_id <> p_company_id then
      raise exception 'claim_port_slot: provisioning key belongs to another company';
    end if;
    return jsonb_build_object('outcome', 'exists', 'number', to_jsonb(v_existing));
  end if;

  select count(*) into v_count
  from public.phone_numbers
  where company_id = p_company_id and status <> 'released';

  select exists (
    select 1 from public.messaging_registrations mr
    where mr.company_id = p_company_id
      and mr.kind = 'brand'
      and mr.sole_proprietor
  ) into v_sole_prop;

  if v_sole_prop and v_count >= 1 then
    return jsonb_build_object('outcome', 'sole_prop_cap', 'number', null);
  end if;
  if v_count >= v_max then
    return jsonb_build_object('outcome', 'plan_limit', 'number', null, 'max', v_max);
  end if;

  insert into public.phone_numbers
    (company_id, status, source, porting_status, provisioning_key, country)
  values
    (p_company_id, 'provisioning', 'ported', 'draft', p_provisioning_key, p_country)
  returning * into v_row;

  return jsonb_build_object('outcome', 'created', 'number', to_jsonb(v_row));
end $$;

-- ---------------------------------------------------------------------------
-- claim_text_enablement_slot: same p_included_numbers + column change. Body
-- otherwise identical to 20260703070000.
-- ---------------------------------------------------------------------------
drop function if exists public.claim_text_enablement_slot(uuid, text, text, text, int);

create or replace function public.claim_text_enablement_slot(
  p_company_id       uuid,
  p_provisioning_key text,
  p_phone_e164       text,
  p_country          text,
  p_included_numbers int
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order     public.text_enablement_orders%rowtype;
  v_number    public.phone_numbers%rowtype;
  v_count     int;
  v_sole_prop boolean;
  v_paid      int;
  v_max       int;
begin
  if p_provisioning_key is null or length(trim(p_provisioning_key)) = 0 then
    raise exception 'claim_text_enablement_slot: provisioning key is required';
  end if;
  if p_included_numbers is null or p_included_numbers < 1 then
    raise exception 'claim_text_enablement_slot: p_included_numbers must be >= 1';
  end if;
  if p_phone_e164 is null or length(trim(p_phone_e164)) = 0 then
    raise exception 'claim_text_enablement_slot: phone_e164 is required';
  end if;
  if p_country not in ('US', 'CA') then
    raise exception 'claim_text_enablement_slot: country must be US or CA';
  end if;

  select paid_extra_numbers into v_paid
  from public.companies where id = p_company_id for update;
  if not found then
    raise exception 'claim_text_enablement_slot: company % not found', p_company_id;
  end if;
  v_max := p_included_numbers + v_paid;

  select * into v_order
  from public.text_enablement_orders
  where provisioning_key = p_provisioning_key;
  if found then
    if v_order.company_id <> p_company_id then
      raise exception 'claim_text_enablement_slot: provisioning key belongs to another company';
    end if;
    select * into v_number
    from public.phone_numbers where id = v_order.phone_number_id;
    return jsonb_build_object(
      'outcome', 'exists',
      'number', to_jsonb(v_number),
      'order', to_jsonb(v_order));
  end if;

  select count(*) into v_count
  from public.phone_numbers
  where company_id = p_company_id and status <> 'released';

  select exists (
    select 1 from public.messaging_registrations mr
    where mr.company_id = p_company_id
      and mr.kind = 'brand'
      and mr.sole_proprietor
  ) into v_sole_prop;

  if v_sole_prop and v_count >= 1 then
    return jsonb_build_object('outcome', 'sole_prop_cap', 'number', null, 'order', null);
  end if;
  if v_count >= v_max then
    return jsonb_build_object('outcome', 'plan_limit', 'number', null, 'order', null, 'max', v_max);
  end if;

  begin
    insert into public.phone_numbers
      (company_id, status, source, provisioning_key, country, number_e164)
    values
      (p_company_id, 'provisioning', 'hosted', p_provisioning_key, p_country, p_phone_e164)
    returning * into v_number;
  exception when unique_violation then
    return jsonb_build_object('outcome', 'number_taken', 'number', null, 'order', null);
  end;

  insert into public.text_enablement_orders
    (company_id, phone_number_id, phone_e164, country, provisioning_key, status)
  values
    (p_company_id, v_number.id, p_phone_e164, p_country, p_provisioning_key, 'pending')
  returning * into v_order;

  return jsonb_build_object(
    'outcome', 'created',
    'number', to_jsonb(v_number),
    'order', to_jsonb(v_order));
end $$;

-- ---------------------------------------------------------------------------
-- Privileges: deny-by-default (SPEC §6) on every new signature.
-- ---------------------------------------------------------------------------
revoke execute on function public.sync_paid_extra_capacity(uuid, int, bigint)
  from public, anon, authenticated;
revoke execute on function public.claim_extra_lower(uuid, int)
  from public, anon, authenticated;
revoke execute on function
  public.provision_number_slot(uuid, text, text, text, int, text, int)
  from public, anon, authenticated;
revoke execute on function public.claim_port_slot(uuid, text, text, int)
  from public, anon, authenticated;
revoke execute on function
  public.claim_text_enablement_slot(uuid, text, text, text, int)
  from public, anon, authenticated;

grant execute on function public.sync_paid_extra_capacity(uuid, int, bigint)
  to service_role;
grant execute on function public.claim_extra_lower(uuid, int)
  to service_role;
grant execute on function
  public.provision_number_slot(uuid, text, text, text, int, text, int)
  to service_role;
grant execute on function public.claim_port_slot(uuid, text, text, int)
  to service_role;
grant execute on function
  public.claim_text_enablement_slot(uuid, text, text, text, int)
  to service_role;
