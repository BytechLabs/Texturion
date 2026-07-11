-- D36 (#128): voice joins the fair-use metering pipeline. The 300-min
-- cap-and-drop becomes an included fair-use allowance (2,500 min Starter /
-- 6,000 min Pro) with metered 1¢/min overage billed through a second Stripe
-- Billing Meter, and forwarding now pauses only at the spending cap
-- (allowance × companies.overage_cap_multiplier — the same owner-controlled
-- cap that bounds text overage). Two pieces of substrate:
--
--   1. call_records.stripe_reported_at — the voice twin of
--      usage_events.stripe_reported_at: NULL means "billable minutes not yet
--      reported to Stripe", the hourly re-reporter's work queue. Only forward
--      legs with billable seconds are ever left NULL (the webhook stamps
--      inbound legs and zero-second legs at insert — nothing to bill).
--
--   2. api_period_forward_seconds — the billed measure. A customer's "minute"
--      is a minute their call was actually forwarded (the dialed leg), the
--      phone-bill meaning of the word — NOT the both-legs internal sum that
--      api_period_voice_seconds returns (which stays for cost analysis).

alter table public.call_records
  add column stripe_reported_at timestamptz;

-- Backfill: every leg recorded before this decision is stamped as reported.
-- Billing starts at deploy — pre-D36 minutes were sold under "pause, never
-- bill" and must NEVER retroactively hit an invoice (meter events created by
-- the re-reporter carry a report-time timestamp, so an unstamped backlog
-- would bill weeks-old calls into the current period).
update public.call_records
set stripe_reported_at = now()
where stripe_reported_at is null;

-- The re-reporter's work queue: unstamped rows only, so the index stays tiny.
create index call_records_unreported_idx
  on public.call_records (created_at)
  where stripe_reported_at is null;

-- Forwarded (dialed-leg) SECONDS a company has used since a period start —
-- the customer-facing measure the allowance, cap, alerts, and Stripe meter
-- all share. Security-definer RPC for the same row-cap reason as
-- api_period_voice_seconds.
create or replace function public.api_period_forward_seconds(
  p_company_id uuid,
  p_since      timestamptz
) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(cr.billable_seconds), 0)::bigint
  from public.call_records cr
  where cr.company_id = p_company_id
    and cr.leg = 'forward'
    and cr.created_at >= p_since
$$;
revoke execute on function public.api_period_forward_seconds(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_period_forward_seconds(uuid, timestamptz)
  to service_role;
