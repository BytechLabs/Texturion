-- Issue #75 (explicit number action): the Pro second-number flow must let the
-- user pick a SPECIFIC number before we order, never auto-assign a random one.
-- POST /v1/numbers/provision now carries an optional chosen_number_e164 (the
-- exact E.164 to order); provision_number_slot must persist it onto the new row
-- so the §4.3 saga orders that number exactly (orderNumberForRow), instead of
-- auto-searching the area code. A bare area-code pick (masked/CA inventory)
-- still passes chosen = null and keeps today's in-area-code search.
--
-- Adding a parameter changes the function signature, so the old 5-arg overload
-- is dropped first (a bare create-or-replace would leave TWO overloads and make
-- the PostgREST call ambiguous). Additive + backward compatible: p_chosen_number
-- defaults null, so an un-upgraded caller behaves exactly as before.
drop function if exists public.provision_number_slot(uuid, text, text, text, int);

create or replace function public.provision_number_slot(
  p_company_id          uuid,
  p_provisioning_key    text,
  p_requested_area_code text,
  p_country             text,
  p_max_numbers         int,
  p_chosen_number_e164  text default null
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
    (company_id, status, provisioning_key, requested_area_code, country, chosen_number_e164)
  values
    (p_company_id, 'provisioning', p_provisioning_key, p_requested_area_code, p_country, p_chosen_number_e164)
  returning * into v_row;

  return jsonb_build_object('outcome', 'created', 'number', to_jsonb(v_row));
end $$;

-- Service-role-only, like every RPC in this schema (SPEC §6 RLS posture):
-- end-user roles never touch PostgREST.
revoke execute on function
  public.provision_number_slot(uuid, text, text, text, int, text)
  from public, anon, authenticated;
grant execute on function
  public.provision_number_slot(uuid, text, text, text, int, text)
  to service_role;
