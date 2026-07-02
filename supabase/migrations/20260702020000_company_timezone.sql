-- D15 — company timezone (DECISIONS.md, user note 2026-07-01).
--
-- companies.timezone: IANA zone name, NOT NULL with default 'America/Toronto'
-- so existing rows migrate safely. Set from the creating browser at
-- onboarding (POST /v1/companies), editable in Settings → Workspace
-- (PATCH /v1/company, O/A). Validity is enforced at the API layer
-- (Intl-based IANA check on every write); the column stays plain text.
-- Quiet hours remain DESTINATION-local per D4 — unchanged.

alter table public.companies
  add column timezone text not null default 'America/Toronto';

-- ---------------------------------------------------------------------------
-- api_create_company grows a p_timezone parameter. The old 5-arg signature is
-- dropped (an overload would make PostgREST RPC dispatch ambiguous) and the
-- function recreated — same body as 20260701010000 plus the timezone column.
-- ---------------------------------------------------------------------------
drop function if exists public.api_create_company(uuid, text, text, text, boolean);

create function public.api_create_company(
  p_owner_user_id       uuid,
  p_name                text,
  p_country             text,
  p_requested_area_code text,
  p_us_texting_enabled  boolean,
  p_timezone            text default 'America/Toronto'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company public.companies;
begin
  insert into public.companies
    (name, owner_user_id, country, us_texting_enabled, requested_area_code,
     timezone, aup_accepted_at)
  values
    (p_name, p_owner_user_id, p_country, p_us_texting_enabled,
     p_requested_area_code, coalesce(p_timezone, 'America/Toronto'), now())
  returning * into v_company;

  insert into public.company_members (company_id, user_id, role)
  values (v_company.id, p_owner_user_id, 'owner');

  insert into public.tags (company_id, name)
  values (v_company.id, 'Quote sent'),
         (v_company.id, 'Scheduled'),
         (v_company.id, 'Won'),
         (v_company.id, 'Lost');

  insert into public.notification_prefs (user_id, company_id)
  values (p_owner_user_id, v_company.id);

  return to_jsonb(v_company);
end $$;

-- Same privilege posture as 20260701010000: deny-by-default, service_role only.
revoke execute on function public.api_create_company(uuid, text, text, text, boolean, text)
  from public, anon, authenticated;

grant execute on function public.api_create_company(uuid, text, text, text, boolean, text)
  to service_role;
