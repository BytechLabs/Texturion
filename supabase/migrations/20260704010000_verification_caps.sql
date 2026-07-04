-- SECURITY follow-up (voice wave) — durable LIFETIME caps on the two
-- Telnyx-committing text-enablement actions. The per-number VERIFY_RATE_LIMITER
-- bounds the RATE of ownership-verification sends (3/min against a number the
-- company has not yet proven it owns) but not their LIFETIME: a patient abuser
-- inside the rate limit could drip SMS/calls at a victim landline for days.
-- These columns are the durable budget; the guarded-increment RPC below is the
-- race-safe consumer. A NEW migration (never edits a shipped one, D7/D14).
--
-- Both caps are PER ORDER ROW by design: a cancel/recreate mints a fresh order
-- (and a fresh budget), and the per-NUMBER rate limiter remains the cross-order
-- guard. Additive columns only — the table-level service_role DML grant from
-- 20260703050000 already covers them; no policy or grant changes needed.
--
-- verification_requests: lifetime count of ownership-verification code SENDS
--   for this order (POST /:id/verification-codes). The route stops at 10.
-- resubmit_count: lifetime count of resubmits for this order
--   (POST /:id/resubmit). The route stops at 5. Distinct from `attempts`,
--   which is the saga's POLL budget (reset to 0 by every resubmit) — reusing
--   it would let each resubmit refill the cap it is supposed to enforce.
alter table public.text_enablement_orders
  add column verification_requests int not null default 0,
  add column resubmit_count        int not null default 0;

-- ===========================================================================
-- bump_text_enablement_counter — atomically consume one unit of a lifetime
-- budget on a text_enablement_orders row. A read-check-increment in the app
-- would race (two concurrent requests both read 9 < 10 and both send); this
-- single guarded UPDATE ... RETURNING is the §10-safe form: 0 rows means the
-- budget is exhausted (or the order/company pair does not match — the caller
-- has already loaded the row company-scoped, so that is a pure backstop).
--
-- Returns jsonb: { "allowed": true, "count": <new value> } or
--                { "allowed": false }.
-- SECURITY DEFINER, service-role-only (SPEC §6) like the other claim_* RPCs.
-- ===========================================================================
create or replace function public.bump_text_enablement_counter(
  p_order_id   uuid,
  p_company_id uuid,
  p_counter    text,  -- 'verification_requests' | 'resubmit_count'
  p_cap        int
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if p_cap is null or p_cap < 1 then
    raise exception 'bump_text_enablement_counter: p_cap must be >= 1';
  end if;

  if p_counter = 'verification_requests' then
    update public.text_enablement_orders
       set verification_requests = verification_requests + 1
     where id = p_order_id
       and company_id = p_company_id
       and verification_requests < p_cap
    returning verification_requests into v_count;
  elsif p_counter = 'resubmit_count' then
    update public.text_enablement_orders
       set resubmit_count = resubmit_count + 1
     where id = p_order_id
       and company_id = p_company_id
       and resubmit_count < p_cap
    returning resubmit_count into v_count;
  else
    raise exception 'bump_text_enablement_counter: unknown counter %', p_counter;
  end if;

  if v_count is null then
    return jsonb_build_object('allowed', false);
  end if;
  return jsonb_build_object('allowed', true, 'count', v_count);
end $$;

revoke execute on function
  public.bump_text_enablement_counter(uuid, uuid, text, int)
  from public, anon, authenticated;
grant execute on function
  public.bump_text_enablement_counter(uuid, uuid, text, int)
  to service_role;
