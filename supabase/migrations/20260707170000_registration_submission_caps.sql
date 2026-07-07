-- Telnyx saga hardening #40 — durable LIFETIME caps on the paid 10DLC
-- campaign submissions. Every POST /v2/10dlc/campaignBuilder buys a fresh
-- ~$15 vetting + ~$4.50 upfront campaign fee chain (SPEC §1179 prices ONE
-- resubmission into the $29 registration fee), yet submission_count was only
-- ever incremented, never budgeted. This migration is the durable substrate
-- for the cap-and-drop:
--
--   submission_count   — review-cycle campaign submissions (R2 first submit +
--                        rejected-resubmits). From this migration on the app
--                        consumes it through the guarded RPC below BEFORE the
--                        Telnyx call (fail-closed, like text-enablement's
--                        resubmit_count) and stops at MAX_CAMPAIGN_SUBMISSIONS.
--   reactivation_count — NEW: the §4.4 post-grace reactivation path gets its
--                        OWN small budget (a reactivation is driven by a paying
--                        resubscribe, not by carrier rejections, so it must not
--                        drain — nor be drained by — the review budget). From
--                        this migration on a reactivation increments ONLY this
--                        counter, not submission_count.
--
-- Pre-existing rows keep their historical submission_count (it measures real
-- Telnyx spend, which is exactly what the lifetime budget should count).
--
-- Mirrors 20260704010000_verification_caps.sql (the audit's declared model to
-- copy). Additive column only — the table-level service_role DML grant already
-- covers it; no policy changes needed. A NEW migration (never edits a shipped
-- one, D7/D14).
alter table public.messaging_registrations
  add column reactivation_count int not null default 0;

-- ===========================================================================
-- bump_registration_counter — atomically consume one unit of a lifetime
-- budget on a messaging_registrations row. A read-check-increment in the app
-- would race (the paid-checkout webhook, the sweeper replay, and
-- POST /v1/registration/submit can all converge the same company at once —
-- two concurrent callers both reading 2 < 3 would both buy a campaign); this
-- single guarded UPDATE ... RETURNING is the race-safe form: 0 rows means the
-- budget is exhausted (or the row/company pair does not match — the caller
-- has already loaded the row company-scoped, so that is a pure backstop).
--
-- Returns jsonb: { "allowed": true, "count": <new value> } or
--                { "allowed": false }.
-- SECURITY DEFINER, service-role-only (SPEC §6) like the other claim_* RPCs.
-- ===========================================================================
create or replace function public.bump_registration_counter(
  p_row_id     uuid,
  p_company_id uuid,
  p_counter    text,  -- 'submission_count' | 'reactivation_count'
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
    raise exception 'bump_registration_counter: p_cap must be >= 1';
  end if;

  if p_counter = 'submission_count' then
    update public.messaging_registrations
       set submission_count = submission_count + 1
     where id = p_row_id
       and company_id = p_company_id
       and submission_count < p_cap
    returning submission_count into v_count;
  elsif p_counter = 'reactivation_count' then
    update public.messaging_registrations
       set reactivation_count = reactivation_count + 1
     where id = p_row_id
       and company_id = p_company_id
       and reactivation_count < p_cap
    returning reactivation_count into v_count;
  else
    raise exception 'bump_registration_counter: unknown counter %', p_counter;
  end if;

  if v_count is null then
    return jsonb_build_object('allowed', false);
  end if;
  return jsonb_build_object('allowed', true, 'count', v_count);
end $$;

revoke execute on function
  public.bump_registration_counter(uuid, uuid, text, int)
  from public, anon, authenticated;
grant execute on function
  public.bump_registration_counter(uuid, uuid, text, int)
  to service_role;
