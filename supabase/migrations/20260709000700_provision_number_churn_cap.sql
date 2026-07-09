-- Issue #74 (release/re-provision cost): a number is included in every plan, so
-- releasing and re-provisioning within the plan allowance is free to the
-- customer — but each provision BUYS A FRESH TELNYX NUMBER (a real cost to us,
-- and 10DLC/carrier reputation churn). The plan-limit count in
-- provision_number_slot bounds STEADY-STATE holdings (a released row frees the
-- slot), but nothing bounds the release -> re-provision FLOW: an admin could
-- cycle it without limit. This adds a durable, lifetime per-company churn cap
-- (cost-protection mandate: cap every cost center).
--
-- The cap lives INSIDE provision_number_slot so it is race-safe under the same
-- company-row lock as the plan/sole-prop checks, and counts only genuinely-new
-- provisions ('created') — never idempotent replays ('exists'), and never the
-- first number bought at checkout (that path is provisionCompanyNumber, not this
-- RPC). A capped call returns { outcome: 'provision_cap', limit: N } WITHOUT
-- inserting a row (no orphan), which the route maps to a SPEC §7 409 conflict.
--
-- Additive column + a new p_provision_cap arg (defaults null = uncapped, fully
-- backward compatible). Adding the arg changes the signature, so the 6-arg
-- overload from 20260709000600 is dropped first (a bare create-or-replace would
-- leave two overloads and make the PostgREST call ambiguous).
alter table public.companies
  add column number_provision_count int not null default 0
    check (number_provision_count >= 0);

comment on column public.companies.number_provision_count is
  'Lifetime count of numbers provisioned via POST /v1/numbers/provision (issue #74 churn cap); the checkout first-number buy does not go through that endpoint and is not counted.';

drop function if exists public.provision_number_slot(uuid, text, text, text, int, text);

create or replace function public.provision_number_slot(
  p_company_id          uuid,
  p_provisioning_key    text,
  p_requested_area_code text,
  p_country             text,
  p_max_numbers         int,
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
begin
  if p_provisioning_key is null or length(trim(p_provisioning_key)) = 0 then
    raise exception 'provision_number_slot: provisioning key is required';
  end if;
  if p_max_numbers is null or p_max_numbers < 1 then
    raise exception 'provision_number_slot: p_max_numbers must be >= 1';
  end if;
  if p_country not in ('US', 'CA') then
    raise exception 'provision_number_slot: country must be US or CA';
  end if;
  -- A chosen number, when present, must be a NANP E.164 (the Worker validates
  -- country + area code against the shared NANP table; the shape is enforced
  -- here so a malformed value can never reach an order).
  if p_chosen_number_e164 is not null
     and p_chosen_number_e164 !~ '^\+1\d{10}$' then
    raise exception 'provision_number_slot: chosen_number must be an E.164 NANP number';
  end if;

  -- Serialize per company: concurrent provision requests queue here, so the
  -- count below is authoritative for the winner and the loser alike.
  perform 1 from public.companies where id = p_company_id for update;
  if not found then
    raise exception 'provision_number_slot: company % not found', p_company_id;
  end if;

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
  if v_count >= p_max_numbers then
    return jsonb_build_object('outcome', 'plan_limit', 'number', null);
  end if;

  -- #74 churn cap: bound the lifetime number of provisions (each buys a fresh
  -- Telnyx number). Read under the company-row lock, so no concurrent burst can
  -- overshoot. Checked here, right before the insert, so a capped call inserts
  -- no row.
  if p_provision_cap is not null then
    select number_provision_count into v_provisioned
    from public.companies where id = p_company_id;
    if v_provisioned >= p_provision_cap then
      return jsonb_build_object('outcome', 'provision_cap', 'limit', p_provision_cap);
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

-- Service-role-only, like every RPC in this schema (SPEC §6 RLS posture):
-- end-user roles never touch PostgREST.
revoke execute on function
  public.provision_number_slot(uuid, text, text, text, int, text, int)
  from public, anon, authenticated;
grant execute on function
  public.provision_number_slot(uuid, text, text, text, int, text, int)
  to service_role;
