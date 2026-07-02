-- SPEC §7, §10 — telnyx-track SQL function (telnyx track).
--
-- provision_number_slot: the atomic slot claim behind POST /v1/numbers/provision.
-- PostgREST gives each RPC its own transaction; locking the company row makes
-- the count-vs-plan check and the §4.2 sole-prop cap race-safe (two concurrent
-- provision requests serialize; exactly one can win the last slot), and the
-- unique provisioning_key makes Idempotency-Key replays return the same row.
--
-- Plan allowances are passed in by the Worker (billing/plans.ts is the single
-- source of the SPEC §2 limits) — the function enforces, it does not define.
--
-- Outcomes (jsonb { outcome, number }):
--   created       — row inserted with status='provisioning'; the caller runs
--                   the §4.3 saga from S2.
--   exists        — this provisioning key already claimed a slot (idempotent
--                   replay); `number` is the existing row.
--   plan_limit    — non-released numbers ≥ the plan allowance (409 conflict).
--   sole_prop_cap — §4.2: the brand row has sole_proprietor=true and a
--                   non-released number exists (409 conflict).

create or replace function public.provision_number_slot(
  p_company_id         uuid,
  p_provisioning_key   text,
  p_requested_area_code text,
  p_country            text,
  p_max_numbers        int
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

  -- Serialize per company: concurrent provision requests queue here, so the
  -- count below is authoritative for the winner and the loser alike.
  perform 1 from public.companies where id = p_company_id for update;
  if not found then
    raise exception 'provision_number_slot: company % not found', p_company_id;
  end if;

  -- Idempotent replay: the same Idempotency-Key returns the same row (§7).
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

  insert into public.phone_numbers
    (company_id, status, provisioning_key, requested_area_code, country)
  values
    (p_company_id, 'provisioning', p_provisioning_key, p_requested_area_code, p_country)
  returning * into v_row;

  return jsonb_build_object('outcome', 'created', 'number', to_jsonb(v_row));
end $$;

-- Service-role-only, like every RPC in this schema (SPEC §6 RLS posture):
-- end-user roles never touch PostgREST.
revoke execute on function
  public.provision_number_slot(uuid, text, text, text, int)
  from public, anon, authenticated;
grant execute on function
  public.provision_number_slot(uuid, text, text, text, int)
  to service_role;
