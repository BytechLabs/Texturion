-- #12 voice metering + cap. Call forwarding is an unmeasured, uncapped cost
-- center (docs/PRICING-AUDIT.md §9): every inbound call we forward runs TWO
-- billable Telnyx legs (the answered inbound leg + the dial to the owner's
-- cell) and nothing records or bounds the minutes. This migration adds the
-- recording substrate + a period-sum RPC so the webhook can (a) meter each
-- leg's duration, (b) warn the owner at 80/100%, and (c) hard-cap forwarding
-- once a company is over its plan's voice allowance.

create table public.call_records (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete restrict,
  phone_number_id  uuid references public.phone_numbers(id) on delete set null,
  call_session_id  text,                                   -- groups the legs of one call
  call_leg_id      text not null,                          -- unique per leg; idempotency key
  leg              text not null check (leg in ('inbound','forward')),
  caller_e164      text,
  billable_seconds int  not null default 0 check (billable_seconds >= 0),
  hangup_cause     text,
  created_at       timestamptz not null default now(),
  unique (call_leg_id)                                     -- webhook replay is a no-op
);

-- Period-sum read path (service-role RPC, like usage_events): keyed on the
-- company + created_at window.
create index call_records_company_period_idx
  on public.call_records (company_id, created_at);

-- Service-role only, like usage_events. The rls.sql default-privilege revoke
-- already strips anon/authenticated from future tables; enabling RLS with no
-- end-user policy makes the denial explicit (service_role bypasses RLS).
alter table public.call_records enable row level security;

-- Billable voice SECONDS a company has used since a period start — the sum over
-- BOTH legs of every forwarded call in the window. Server-side sum via a
-- security-definer function for the same reason api_period_inbound_segments is
-- an RPC: a PostgREST read would truncate at the row cap.
create or replace function public.api_period_voice_seconds(
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
    and cr.created_at >= p_since
$$;
revoke execute on function public.api_period_voice_seconds(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_period_voice_seconds(uuid, timestamptz)
  to service_role;
