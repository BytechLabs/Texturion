-- #581 — the widget's per-number cap is enforced across ALL companies, so the
-- lock that protects it has to span them too.
--
-- ## The defect
--
-- `api_claim_widget_verification` took ONE advisory lock, keyed on the company:
--
--     pg_advisory_xact_lock(hashtext('widget_verifications:' || p_company_id))
--
-- Two of its three counters live inside that partition and were safe. The
-- resend throttle is keyed (company, phone) and the daily company cap is keyed
-- (company) — both subsets of the lock key.
--
-- The third is not. The per-number cap counts `where phone_e164 = p_phone`
-- with NO company predicate, deliberately: it exists to stop one person's
-- number being blasted by a script that walks from one business's widget to the
-- next. But two claims arriving under different `p_company_id` values take
-- disjoint lock keys, so they never serialise against each other. Under READ
-- COMMITTED neither sees the other's uncommitted insert, both read the same
-- pre-burst count, and both insert. The cap is exceeded by exactly as many
-- workspaces as an attacker cares to walk through — which is the attack it was
-- written to stop.
--
-- ## The fix, and why it is two locks rather than one
--
-- A single global lock would serialise every widget claim in the product
-- against every other, turning an independent per-workspace path into one
-- queue. A single phone-keyed lock would leave the company cap unprotected
-- against two claims for different numbers in the same workspace.
--
-- So: both. Each counter is now covered by a lock whose key is at least as
-- coarse as the counter's own partition, which is the rule every other guarded
-- claim in this schema already follows — `route_abuse_caps.sql` locks per owner
-- for a per-owner count, and `contact_messages` takes a GLOBAL lock precisely
-- because its counter is global.
--
-- ## Deadlock
--
-- The order is fixed: company first, then phone, on every path through the
-- function. Two transactions can therefore never hold one another's next lock
-- — the classic ordered-acquisition argument. Nothing else in the schema takes
-- either of these keys, so there is no third party to close a cycle.
--
-- Recreated with CREATE OR REPLACE and the grants restated. A function that is
-- dropped and recreated regains the default PUBLIC execute grant, which
-- anon/authenticated inherit; restating them is cheap and makes the posture
-- readable at the point of change rather than several files away.

create or replace function public.api_claim_widget_verification(
  p_company_id      uuid,
  p_phone           text,
  p_code_hash       text,
  p_ip              text,
  p_ttl_seconds     int,
  p_company_cap     int,
  p_number_cap      int,
  p_resend_seconds  int
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recent  timestamptz;
  v_company int;
  v_number  int;
  v_id      uuid;
begin
  if p_ttl_seconds is null or p_ttl_seconds < 30 then
    raise exception 'api_claim_widget_verification: p_ttl_seconds must be >= 30';
  end if;

  -- A widget key outlives the workspace it belongs to: the embed sits in
  -- somebody's page source forever, and a widget left embedded on a site
  -- outlives the account behind it.
  if not exists (
    select 1 from public.companies
     where id = p_company_id
       and deleted_at is null
  ) then
    return jsonb_build_object('allowed', false, 'reason', 'unknown_company');
  end if;

  -- #581: TWO locks, in a fixed order, because the three counters below do not
  -- share one partition. Company first, then phone, on every path — so two
  -- transactions can never hold each other's next lock.
  perform pg_advisory_xact_lock(hashtext('widget_verifications:' || p_company_id::text));
  -- The per-number cap counts across ALL companies (see below), so the lock
  -- that protects it must too. Without this, two claims from two different
  -- workspaces for the SAME number never serialise, both read the same count,
  -- and both insert.
  perform pg_advisory_xact_lock(hashtext('widget_verifications_number:' || p_phone));

  -- The resend throttle first: it is the cheapest check and the commonest
  -- reason to refuse.
  select max(created_at) into v_recent
    from public.widget_verifications
   where company_id = p_company_id
     and phone_e164 = p_phone;
  if v_recent is not null
     and v_recent > now() - make_interval(secs => greatest(p_resend_seconds, 0)) then
    return jsonb_build_object('allowed', false, 'reason', 'too_soon');
  end if;

  select count(*) into v_company
    from public.widget_verifications
   where company_id = p_company_id
     and created_at >= date_trunc('day', now());
  if v_company >= p_company_cap then
    return jsonb_build_object('allowed', false, 'reason', 'company_cap');
  end if;

  -- Across ALL companies. See the index comment.
  select count(*) into v_number
    from public.widget_verifications
   where phone_e164 = p_phone
     and created_at >= date_trunc('day', now());
  if v_number >= p_number_cap then
    return jsonb_build_object('allowed', false, 'reason', 'number_cap');
  end if;

  insert into public.widget_verifications
    (company_id, phone_e164, code_hash, expires_at, ip)
  values
    (p_company_id, p_phone, p_code_hash,
     now() + make_interval(secs => p_ttl_seconds), p_ip)
  returning id into v_id;

  return jsonb_build_object('allowed', true, 'id', v_id);
end $$;

revoke execute on function public.api_claim_widget_verification(
  uuid, text, text, text, int, int, int, int)
  from public, anon, authenticated;
grant execute on function public.api_claim_widget_verification(
  uuid, text, text, text, int, int, int, int)
  to service_role;
