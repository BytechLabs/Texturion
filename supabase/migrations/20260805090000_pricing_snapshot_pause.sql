-- #277 — the margin report values a paused workspace at what it actually pays.
--
-- ---------------------------------------------------------------------------
-- WHAT WAS WRONG
--
-- `api_pricing_snapshot` returns facts and `scripts/ops/pricing-report.mjs`
-- does the arithmetic with the real price table. A paid pause produces a
-- workspace that is `active`, still on its plan, and paying a holding fee of a
-- few dollars instead of $29 or $79 — and the snapshot had no field that said
-- so. So the report priced the paused cohort at list, and in the ONE report the
-- founder reads to find unprofitable customers, the least profitable cohort
-- rendered as the most profitable: full revenue, near-zero usage, healthy
-- margin. Nothing about that reading is visibly wrong, which is what makes it
-- expensive.
--
-- ---------------------------------------------------------------------------
-- WHY A FACT ON THE ROW RATHER THAN A RULE IN THE CALLER
--
-- The pause price is not in this repository at all — the founder provisions a
-- Stripe price and `companies.paused_price_cents` mirrors what the subscription
-- item actually bills. There is no constant the report could hold, so the
-- amount has to travel with the row.
--
-- That is also the shape the same defect has taken every previous time: revenue
-- INFERRED from a plan id instead of read from what is being invoiced.
-- Grandfathered modules, phantom extra numbers, the prepaid year and the #85
-- overage projection were each this bug (see the comment on
-- companies.paused_price_cents, which counts the first three). Adding the fact
-- to the snapshot is what stops the next reader of this data from making the
-- inference a sixth time.
--
-- ---------------------------------------------------------------------------
-- THE PAUSED COHORT STAYS IN THE SNAPSHOT
--
-- They are paying customers, and they cost us a held number and a live 10DLC
-- campaign every month whether or not anybody texts. Dropping them from the
-- report would hide exactly the rows it exists to surface — it would just hide
-- them by omission instead of by mis-valuation.
--
-- ---------------------------------------------------------------------------
-- DROP AND RECREATE, not CREATE OR REPLACE: Postgres refuses to replace a
-- function whose OUT columns change, and two columns are being added. Nothing
-- depends on this function inside the database — its only caller is the ops
-- script, over PostgREST — so the drop is a rename-shaped change, not a
-- cascade.

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
    c.paused_at,
    c.paused_price_cents,
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
  '(plan, modules, prepayment, pause, usage, real provider cost). Deliberately '
  'holds no prices and computes no margin — those live in apps/api/src/billing '
  'and mirroring them here would be the fourth copy of a number that has '
  'already drifted three times in this codebase. #277 added paused_at and '
  'paused_price_cents because the pause fee is the one price that is NOT in the '
  'repository — it is provisioned in Stripe — so a caller cannot look it up and '
  'would otherwise value a paused tenant at its plan''s list price.';
