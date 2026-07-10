-- #98: model the per-forwarded-call transfer/dial fee in the cost projection.
--
-- Telnyx charges a ~$0.10 per-transfer fee on EVERY forwarded call (one dial
-- command per call, messaging/voice-webhook.ts). That fee scales with call
-- COUNT, not minutes, so the 300-minute voice cap-and-drop does not bound it: a
-- high-frequency short/unanswered-call flood accrues near-zero billable seconds
-- yet a real $0.10 per call. api_period_voice_seconds (minutes) cannot see this.
--
-- This period-sum RPC counts forwarded calls this period — one 'forward' leg per
-- call in call_records (recordCallDuration writes one row per dialed leg, keyed
-- on call_leg_id, for answered AND unanswered forwards) — so the #85 cost
-- projection (billing/overage-projection.ts) can price the transfer fee.
create or replace function public.api_period_forwarded_calls(
  p_company_id uuid,
  p_since      timestamptz
) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::bigint
  from public.call_records cr
  where cr.company_id = p_company_id
    and cr.created_at >= p_since
    and cr.leg = 'forward'
$$;
revoke execute on function public.api_period_forwarded_calls(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_period_forwarded_calls(uuid, timestamptz)
  to service_role;
