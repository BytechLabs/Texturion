-- #216 — actual provider (Telnyx) cost, fed into the #85 fair-use cost model.
--
-- The model ESTIMATES telecom cost from usage units × assumed rates. Telnyx now
-- webhooks the ACTUAL cost of every call (`call.cost`, per leg) and message
-- (`message.finalized`, carries `cost`). MESSAGE cost is already captured on
-- messages.provider_cost (COGS dollars, written by messaging/status.ts). VOICE
-- cost has no home — this ledger is it (per leg; the calls table is per session,
-- so a per-leg column would need racy increments). The reader UNIONS the two so
-- the projection can price telecom from ground truth (catching estimate misses
-- like Canada SMS, which costs more than our per-segment estimate).
--
-- Append-once ledger: one row per costed leg, keyed (kind, ref) so a webhook
-- REPLAY can never double-count. cost_usd is dollars (matches Telnyx's decimal
-- amount); the reader converts to cents.
create table public.provider_costs (
  -- 'voice' — ref = call_leg_id (call.cost fires per leg). 'message' is reserved
  -- for symmetry but unused today: message cost rides messages.provider_cost.
  kind        text not null check (kind in ('voice', 'message')),
  ref         text not null,
  company_id  uuid not null references public.companies(id) on delete cascade,
  cost_usd    numeric(12, 6) not null default 0,
  occurred_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  primary key (kind, ref)
);

-- The period sum is company-scoped, occurred_at-ranged — index for it.
create index provider_costs_company_period_idx
  on public.provider_costs (company_id, occurred_at);

-- Service-role only (the api Worker records + reads); no client access.
alter table public.provider_costs enable row level security;

-- api_period_provider_cost — total ACTUAL telecom cost (USD dollars) a company
-- has incurred since `p_since` (the billing period start): the voice ledger PLUS
-- message COGS (messages.provider_cost, keyed on created_at ≈ send time). Same
-- arg convention as the other api_period_* readers; the model scales ×100 to
-- cents.
create or replace function public.api_period_provider_cost(
  p_company_id uuid,
  p_since      timestamptz
) returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((
      select sum(pc.cost_usd)
        from public.provider_costs pc
       where pc.company_id = p_company_id
         and pc.occurred_at >= p_since
    ), 0)
    + coalesce((
      select sum(m.provider_cost)
        from public.messages m
       where m.company_id = p_company_id
         and m.created_at >= p_since
         and m.provider_cost is not null
    ), 0);
$$;

revoke execute on function public.api_period_provider_cost(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_period_provider_cost(uuid, timestamptz)
  to service_role;
