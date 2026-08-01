-- #255 — the facts a pricing decision needs, in one read.
--
-- ---------------------------------------------------------------------------
-- WHY A SNAPSHOT FUNCTION AND NOT A DASHBOARD
--
-- #255: "for a solo-founder business, pricing is the highest-leverage variable
-- there is — a correct price change is worth more than a quarter of feature
-- work and costs a day. Right now we cannot make one with evidence."
--
-- The evidence is already in the database. Revenue is a plan and a module list;
-- cost is metered per company by #216 and `api_period_provider_cost`; usage
-- against a limit is a count. Nothing here is new data. What was missing is a
-- read that puts them on the same row, because the questions #255 asks —
-- "which customers are unprofitable", "how many sit at 90% of a limit" — are
-- joins nobody had written.
--
-- This returns FACTS ONLY. No prices, no margin, no verdict. The price table
-- lives in `apps/api/src/billing/costs.ts` and the limits in `plans.ts`, and
-- mirroring either into SQL would create the fourth copy of a number this
-- codebase has already been bitten by drifting three times. The caller does the
-- arithmetic with the real constants.
--
-- ---------------------------------------------------------------------------
-- WHAT IS DELIBERATELY EXCLUDED
--
-- Deleted workspaces, and workspaces that never checked out. A margin figure
-- for a company that has never paid is a division by an intention.
--
-- The one-time US registration fee is not revenue here either: it is charged
-- once ever and offsets the one-time 10DLC brand and campaign cost, not any
-- recurring monthly cost. `costs.ts` states the same exclusion for the same
-- reason.

create or replace function public.api_pricing_snapshot()
returns table (
  company_id            uuid,
  name                  text,
  plan                  text,
  subscription_status   text,
  created_at            timestamptz,
  current_period_start  timestamptz,
  -- The enabled add-ons, so the caller can price them from MODULE_CATALOG.
  modules               text[],
  -- #400/D107: a prepaid year invoices the licensed line at $0, so counting
  -- list price would credit revenue nobody is collecting. The caller amortises.
  prepaid_cents         bigint,
  prepaid_months        integer,
  -- Usage this billing period, against limits the caller holds.
  segments_used         bigint,
  seats_used            bigint,
  numbers_used          bigint,
  -- Real metered telecom cost this period, in cents.
  provider_cost_cents   bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.name,
    c.plan::text,
    c.subscription_status::text,
    c.created_at,
    c.current_period_start,
    coalesce((
      select array_agg(m.module order by m.module)
        from public.company_modules m
       where m.company_id = c.id and m.disabled_at is null), '{}'::text[]),
    coalesce((
      select p.amount_cents from public.prepayments p
       where p.company_id = c.id
         and p.granted_at is not null
         and p.revoked_at is null
       order by p.granted_at desc limit 1), 0)::bigint,
    coalesce((
      select p.months_granted from public.prepayments p
       where p.company_id = c.id
         and p.granted_at is not null
         and p.revoked_at is null
       order by p.granted_at desc limit 1), 0)::integer,
    coalesce((
      select sum(u.quantity) from public.usage_events u
       where u.company_id = c.id
         and u.created_at >= coalesce(c.current_period_start, c.created_at)), 0)::bigint,
    (select count(*) from public.company_members mem
      where mem.company_id = c.id and mem.deactivated_at is null)::bigint,
    (select count(*) from public.phone_numbers n
      where n.company_id = c.id and n.released_at is null)::bigint,
    round(coalesce(public.api_period_provider_cost(
      c.id, coalesce(c.current_period_start, c.created_at)), 0) * 100)::bigint
  from public.companies c
  where c.deleted_at is null
    -- Never checked out is not a customer. A margin for a workspace that has
    -- never paid divides by an intention.
    and c.subscription_status in ('active', 'past_due', 'unpaid', 'canceled')
  order by c.created_at
$$;

revoke execute on function public.api_pricing_snapshot() from public, anon, authenticated;
grant execute on function public.api_pricing_snapshot() to service_role;

comment on function public.api_pricing_snapshot is
  '#255: one row per paying workspace with the facts a pricing decision needs '
  '(plan, modules, prepayment, usage, real provider cost). Deliberately holds '
  'no prices and computes no margin — those live in apps/api/src/billing and '
  'mirroring them here would be the fourth copy of a number that has already '
  'drifted three times in this codebase.';
