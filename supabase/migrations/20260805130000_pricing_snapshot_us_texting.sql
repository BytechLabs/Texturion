-- #525 — the margin report can see the 10DLC campaign it is paying for.
--
-- ---------------------------------------------------------------------------
-- WHAT WAS WRONG
--
-- `scripts/ops/pricing-report.mjs` computed a workspace's cost as
-- `provider_cost_cents` alone — the METERED per-message spend, and nothing
-- else. `apps/api/src/billing/costs.ts` has always held a second term the
-- report could not see: FIXED_MONTHLY_COST_CENTS, the number rent and the
-- recurring US 10DLC campaign fee that arrive whether or not anybody texts.
-- The in-app underwater alert (`overage-projection.ts` fixedMonthlyCostCents)
-- adds them. The founder's report did not, so two views of the same cost model
-- disagreed, and only one of them was being read to decide prices.
--
-- It fails hardest on exactly the cohort #277 added to this snapshot. A PAUSED
-- workspace has deliberately stopped texting, so its metered cost is ~$0 and
-- the report showed a clean margin against the holding fee — while its whole
-- real cost is the two lines the report was omitting. #277 fixed the revenue
-- side of that row and left the cost side saying zero, which is the same
-- mis-reading arriving from the other direction.
--
-- ---------------------------------------------------------------------------
-- WHY THIS COLUMN AND NOT AN AMOUNT
--
-- The snapshot returns FACTS and holds no prices — the rule the #255 header
-- states, for the reason it states: a price mirrored into SQL is the fourth
-- copy of a number this codebase has already watched drift three times. The
-- campaign fee lives in `FIXED_MONTHLY_COST_CENTS.us10dlcCampaign` and is
-- MIRRORED into the report under a guard (`pricing-report-mirror.test.ts`).
--
-- So what travels is the fact that decides whether the fee applies at all:
-- does this workspace have US texting on. The number count it multiplies the
-- per-number rent by is already here as `numbers_used`.
--
-- `companies.us_texting_enabled` is the RIGHT fact rather than a convenient
-- one: it is precisely what `fixedMonthlyCostCents` keys on, so the report and
-- the alert cannot answer differently for one workspace. It is true for every
-- US company by construction (`POST /v1/companies` refuses `false` for country
-- US) and true for a Canadian one only once somebody has paid the $29 and
-- turned it on.
--
-- A campaign is NOT deactivated by a pause, which is why the flag keeps
-- reading true for a paused tenant and should: `deactivateCampaign` has one
-- caller (`billing/grace.ts`) and every selection scan behind it requires
-- `subscription_status = 'canceled'`. A paused workspace is genuinely `active`,
-- so we keep paying the campaign fee for the whole pause — deliberately, since
-- taking it down would cost the customer another 3-7 business day carrier wait
-- on their return out of a lifetime budget of four reactivations.
--
-- ---------------------------------------------------------------------------
-- DROP AND RECREATE, not CREATE OR REPLACE: Postgres refuses to replace a
-- function whose OUT columns change, and one is being added. Nothing inside the
-- database depends on this function — its only caller is the ops script, over
-- PostgREST — so the drop is a rename-shaped change, not a cascade.

drop function if exists public.api_pricing_snapshot();

create function public.api_pricing_snapshot()
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
  -- #277: the same problem in the other direction. A paused workspace is
  -- `active` on its plan and invoiced a holding fee, so the plan price is not
  -- what it pays. `paused_at` is the FACT (never null-when-paused) and
  -- `paused_price_cents` is the amount, which is null when the pause item
  -- carried no unit_amount. The caller must branch on the fact and refuse to
  -- guess the amount: falling back to the plan price on a null fee is the exact
  -- mis-valuation these two columns exist to prevent.
  paused_at             timestamptz,
  paused_price_cents    integer,
  -- #525: does this workspace carry a US 10DLC campaign, and therefore its
  -- recurring monthly fee? The COST counterpart of the two columns above — the
  -- fee is ours every month whether or not a single message is sent, and it is
  -- most of what a paused workspace costs us. The amount is NOT here: it lives
  -- in FIXED_MONTHLY_COST_CENTS and is mirrored into the caller under a guard,
  -- for the same reason no other price is in this function.
  us_texting_enabled    boolean,
  -- Usage this billing period, against limits the caller holds.
  segments_used         bigint,
  seats_used            bigint,
  -- Doubles as the COST term for number rent: it counts the numbers we are
  -- still renting (`released_at is null`), which is what Telnyx bills us for.
  numbers_used          bigint,
  -- Real metered telecom cost this period, in cents. PER-MESSAGE ONLY — the
  -- fixed monthly lines are the caller's arithmetic, from the two facts above.
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
    c.paused_at,
    c.paused_price_cents,
    c.us_texting_enabled,
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
    --
    -- A PAUSED workspace passes this filter, and should: the pause leaves the
    -- status `active` on purpose, and a workspace paying us a holding fee while
    -- we pay for its number is precisely the row this report is read for.
    and c.subscription_status in ('active', 'past_due', 'unpaid', 'canceled')
  order by c.created_at
$$;

revoke execute on function public.api_pricing_snapshot() from public, anon, authenticated;
grant execute on function public.api_pricing_snapshot() to service_role;

comment on function public.api_pricing_snapshot is
  '#255: one row per paying workspace with the facts a pricing decision needs '
  '(plan, modules, prepayment, pause, US registration, usage, real provider '
  'cost). Deliberately holds no prices and computes no margin — those live in '
  'apps/api/src/billing and mirroring them here would be the fourth copy of a '
  'number that has already drifted three times in this codebase. #277 added '
  'paused_at and paused_price_cents because the pause fee is the one price that '
  'is NOT in the repository — it is provisioned in Stripe — so a caller cannot '
  'look it up and would otherwise value a paused tenant at its plan''s list '
  'price. #525 added us_texting_enabled for the cost side of the same row: the '
  'recurring 10DLC campaign fee is charged whether or not anybody texts, it is '
  'most of what a paused workspace costs us, and a report built on metered '
  'usage alone could not see it.';
