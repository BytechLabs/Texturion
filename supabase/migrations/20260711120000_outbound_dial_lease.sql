-- #133 review fix: the per-conversation double-dial guard was a racy
-- check-then-act — two POST /v1/calls inside the Telnyx round-trip window
-- both saw no in-flight session and BOTH dialed (double spend, the customer
-- rung twice). The guard becomes two layers:
--
--   1. THIS lease — an atomic claim taken BEFORE any Telnyx dial. The upsert
--      lands for exactly one concurrent caller (the conflict arm only steals
--      a lease older than the TTL, which generously covers dial + persist);
--      the loser 409s without spending a cent. The route releases the lease
--      once the calls row is durably visible (or on any dial failure), and a
--      crashed worker's lease simply expires — nothing to sweep.
--   2. The route's state check on `calls` (outcome IS NULL, now matched to
--      the 4h sweeper window) — honest for the WHOLE life of a bridged call,
--      not the first 10 minutes.

create table public.outbound_dial_leases (
  conversation_id uuid primary key
    references public.conversations(id) on delete cascade,
  company_id      uuid not null references public.companies(id) on delete cascade,
  claimed_at      timestamptz not null default now()
);

alter table public.outbound_dial_leases enable row level security;
-- deny-by-default: only the service role (API) touches leases.

create or replace function public.api_claim_outbound_dial(
  p_company_id      uuid,
  p_conversation_id uuid
) returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  with claimed as (
    insert into public.outbound_dial_leases (conversation_id, company_id)
    values (p_conversation_id, p_company_id)
    on conflict (conversation_id) do update
      set claimed_at = now(), company_id = excluded.company_id
      where public.outbound_dial_leases.claimed_at < now() - interval '2 minutes'
    returning 1
  )
  select exists (select 1 from claimed)
$$;
revoke execute on function public.api_claim_outbound_dial(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.api_claim_outbound_dial(uuid, uuid)
  to service_role;

-- #133 review: the voice alert ledger key must distinguish WHICH allowance a
-- threshold was measured against. A grandfathered tenant who crosses 80% of
-- the legacy 300-minute line and then buys the paid module mid-period would
-- otherwise never hear about 80%/100% of the REAL plan allowance — the
-- (company, period, metric, threshold) row already exists. Grandfathered
-- alerts record under their own metric.
alter table public.usage_alerts
  drop constraint usage_alerts_metric_check;
alter table public.usage_alerts
  add constraint usage_alerts_metric_check
  check (metric in (
    'segments', 'mms_storage', 'attachment_storage', 'voice_minutes',
    'voice_minutes_grandfathered',
    'mms_messages', 'egress', 'cost_projection', 'storage_abuse'
  ));
