-- D16 / PORTING.md §6 — port-in slot claim (schema track).
--
-- claim_port_slot: the atomic slot claim behind POST /v1/port-requests, the
-- direct analogue of provision_number_slot (20260701001200) for the port path.
-- D16 is explicit — "a port counts as the one number" and "sole-prop companies
-- keep their 1-number cap" — and PORTING.md §6 puts a "sole-prop cap" gate in
-- the create gate order. The provisioned path claims its slot atomically here;
-- the port path MUST use the SAME count-vs-plan + §4.2 sole-prop check rather
-- than an ad-hoc application-side test (which cannot see a concurrent claim and
-- previously only conflicted when an existing live number was already a port).
--
-- Like provision_number_slot: PostgREST gives each RPC its own transaction, and
-- locking the company row FOR UPDATE serialises concurrent claims so the count
-- is authoritative for the winner and loser alike; the unique provisioning_key
-- makes Idempotency-Key replays return the same row. The ONLY differences from
-- provision_number_slot are the inserted row's shape (source='ported',
-- porting_status='draft', no requested_area_code — a port buys no inventory) and
-- that this function reports the same outcomes so the route maps them to the
-- existing §7 error codes (NO new codes — plan_limit / sole_prop_cap → conflict).
--
-- Plan allowance is passed in by the Worker (billing/plans.ts is the single
-- source of the SPEC §2 limits) — the function enforces, it does not define. On
-- the onboarding path (no plan chosen yet) the Worker passes the minimum
-- allowance (1), so a still-incomplete company cannot stack a second number
-- before it has paid for a multi-number plan; a fresh port-only signup (count 0)
-- passes cleanly.
--
-- Outcomes (jsonb { outcome, number }):
--   created       — port phone_numbers row inserted (source='ported',
--                   status='provisioning', porting_status='draft'); the caller
--                   inserts the port_requests row + runs the saga.
--   exists        — this provisioning key already claimed a slot (idempotent
--                   replay); `number` is the existing row.
--   plan_limit    — non-released numbers >= the plan allowance (409 conflict).
--   sole_prop_cap — §4.2: the brand row has sole_proprietor=true and a
--                   non-released number exists (409 conflict).

create or replace function public.claim_port_slot(
  p_company_id       uuid,
  p_provisioning_key text,
  p_country          text,
  p_max_numbers      int
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
    raise exception 'claim_port_slot: provisioning key is required';
  end if;
  if p_max_numbers is null or p_max_numbers < 1 then
    raise exception 'claim_port_slot: p_max_numbers must be >= 1';
  end if;
  if p_country not in ('US', 'CA') then
    raise exception 'claim_port_slot: country must be US or CA';
  end if;

  -- Serialize per company: concurrent claims (provision OR port) queue here, so
  -- the count below is authoritative for the winner and the loser alike.
  perform 1 from public.companies where id = p_company_id for update;
  if not found then
    raise exception 'claim_port_slot: company % not found', p_company_id;
  end if;

  -- Idempotent replay: the same Idempotency-Key returns the same row (§7).
  select * into v_existing
  from public.phone_numbers
  where provisioning_key = p_provisioning_key;
  if found then
    if v_existing.company_id <> p_company_id then
      raise exception 'claim_port_slot: provisioning key belongs to another company';
    end if;
    return jsonb_build_object('outcome', 'exists', 'number', to_jsonb(v_existing));
  end if;

  -- Count against the SAME "non-released number" universe as provision_number_slot
  -- so a provisioned number and a pending port share the one slot (D16).
  select count(*) into v_count
  from public.phone_numbers
  where company_id = p_company_id and status <> 'released';

  -- §4.2: Sole Proprietor brands are capped at 1 number regardless of plan — a
  -- port counts as that one number (D16).
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

  -- The port row: source='ported', status='provisioning' (invisible to the
  -- send/inbox path until P6 flips it to 'active'), porting_status='draft'
  -- mirror. No requested_area_code — a port buys no new inventory.
  insert into public.phone_numbers
    (company_id, status, source, porting_status, provisioning_key, country)
  values
    (p_company_id, 'provisioning', 'ported', 'draft', p_provisioning_key, p_country)
  returning * into v_row;

  return jsonb_build_object('outcome', 'created', 'number', to_jsonb(v_row));
end $$;

-- Service-role-only, like every RPC in this schema (SPEC §6 RLS posture):
-- end-user roles never touch PostgREST.
revoke execute on function
  public.claim_port_slot(uuid, text, text, int)
  from public, anon, authenticated;
grant execute on function
  public.claim_port_slot(uuid, text, text, int)
  to service_role;
