-- Route-level abuse/cost caps (launch-audit issues #31 and #38). Two durable
-- SQL guards behind the P2 hardening batch — both reuse the repo's guarded-
-- claim idioms (advisory-lock re-count from claim_attachment_storage /
-- claim_signed_url_egress; guarded UPDATE-RETURNING counter from
-- bump_text_enablement_counter). A NEW migration (never edits a shipped one).

-- ===========================================================================
-- #31 — cap company creation per user. POST /v1/companies is the one
-- authenticated write with no ceiling of any kind: a confirmed account can
-- loop it into unbounded tenants (company + owner membership + 4 tags +
-- prefs per call). The cap lives INSIDE api_create_company so it is race-safe:
-- a per-user advisory xact lock serializes concurrent creates, then the owner
-- count is re-read under that lock — a parallel burst can never overshoot.
--
-- Same 6-arg signature and success payload as 20260702020000 (the D15-2 suite
-- asserts exactly one 6-arg overload); a capped call returns the sentinel
-- jsonb { "outcome": "owner_cap", "limit": N } instead of the company row —
-- the route maps it to the SPEC §7 409 `conflict`.
-- ===========================================================================
create or replace function public.api_create_company(
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
  v_company   public.companies;
  v_owned     int;
  -- #31 lifetime ceiling: 5 owned workspaces is far above any legitimate
  -- 1–10-person shop (one business, maybe a second brand) while making
  -- churn-a-tenant row spam pointless.
  v_owner_cap constant int := 5;
begin
  -- Serialize this user's creates (claim_* advisory-lock idiom) so the count
  -- below cannot race a concurrent create by the same user.
  perform pg_advisory_xact_lock(
    hashtext('company_create:' || p_owner_user_id::text));

  select count(*) into v_owned
    from public.company_members m
    join public.companies co on co.id = m.company_id
   where m.user_id = p_owner_user_id
     and m.role = 'owner'
     and m.deactivated_at is null
     and co.deleted_at is null;
  if v_owned >= v_owner_cap then
    return jsonb_build_object('outcome', 'owner_cap', 'limit', v_owner_cap);
  end if;

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

-- CREATE OR REPLACE preserves ACLs, but restate the posture so this migration
-- stands alone: deny-by-default, service_role only (as 20260702020000).
revoke execute on function
  public.api_create_company(uuid, text, text, text, boolean, text)
  from public, anon, authenticated;
grant execute on function
  public.api_create_company(uuid, text, text, text, boolean, text)
  to service_role;

-- ===========================================================================
-- #38 — durable lifetime cap on brand OTP resends. Each
-- POST /v1/registration/otp/resend triggers a Telnyx brand-OTP SMS to the
-- registered sole-prop mobile: a provider-committing action with, until now,
-- neither a rate limit nor a lifetime counter (its text-enablement sibling
-- has both). The route now keys VERIFY_RATE_LIMITER on the target mobile for
-- the RATE; this column + RPC are the durable LIFETIME budget, per brand row.
-- Additive column only — the messaging_registrations service-role DML grant
-- already covers it.
-- ===========================================================================
alter table public.messaging_registrations
  add column otp_resend_count int not null default 0
    check (otp_resend_count >= 0);

-- bump_registration_otp_counter — atomically consume one unit of a brand
-- row's lifetime OTP-resend budget. A read-check-increment in the app would
-- race (two concurrent requests both read 9 < 10 and both send); this single
-- guarded UPDATE ... RETURNING is the §10-safe form (the
-- bump_text_enablement_counter idiom): 0 rows means the budget is exhausted
-- or the row is not this company's brand.
--
-- Returns jsonb: { "allowed": true, "count": <new value> } or
--                { "allowed": false }.
create or replace function public.bump_registration_otp_counter(
  p_registration_id uuid,
  p_company_id      uuid,
  p_cap             int
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if p_cap is null or p_cap < 1 then
    raise exception 'bump_registration_otp_counter: p_cap must be >= 1';
  end if;

  update public.messaging_registrations
     set otp_resend_count = otp_resend_count + 1
   where id = p_registration_id
     and company_id = p_company_id
     and kind = 'brand'
     and otp_resend_count < p_cap
  returning otp_resend_count into v_count;

  if v_count is null then
    return jsonb_build_object('allowed', false);
  end if;
  return jsonb_build_object('allowed', true, 'count', v_count);
end $$;

revoke execute on function
  public.bump_registration_otp_counter(uuid, uuid, int)
  from public, anon, authenticated;
grant execute on function
  public.bump_registration_otp_counter(uuid, uuid, int)
  to service_role;
