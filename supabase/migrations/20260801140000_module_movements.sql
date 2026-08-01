-- #255 — expansion and contraction, from the timestamps that already record it.
--
-- ---------------------------------------------------------------------------
-- NO NEW WRITES
--
-- #255 asks for "module attached after signup, module dropped, plan changed,
-- and what preceded each" as first-class events. Two of the three are already
-- written down: `company_modules.enabled_at` and `disabled_at` have stamped
-- every attach and drop since the table existed. What was missing is a read.
--
-- Adding an events table would mean the history starts today, and the history
-- we already have is the more valuable half.
--
-- ---------------------------------------------------------------------------
-- AT SIGNUP VERSUS AFTER, WHICH IS THE WHOLE POINT
--
-- A module attached during checkout is a pricing-PAGE decision: somebody read
-- the plan builder and decided. A module attached weeks later is EXPANSION —
-- somebody used the product, hit a need, and paid more. They look identical in
-- a total and they answer different questions, so they are separate columns.
--
-- The boundary is 24 hours from subscription start. Generous on purpose: a
-- signup that stalls on a registration step and finishes the next morning is
-- still one decision, and calling that expansion would inflate the number this
-- exists to keep honest.
--
-- ---------------------------------------------------------------------------
-- WHAT IS DELIBERATELY ABSENT
--
-- Plan changes. `companies.plan` holds the current tier and nothing records the
-- previous one, so a plan-change history cannot be reconstructed from what
-- exists — and inferring it from Stripe would be a different, slower report
-- that could still only see what Stripe kept. Reporting attach and drop
-- honestly beats reporting all three with one of them quietly guessed.

create or replace function public.api_module_movements(p_days integer default 90)
returns table (
  module            text,
  attached_at_signup bigint,
  attached_later     bigint,
  dropped            bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.module,
    count(*) filter (
      where c.subscription_started_at is not null
        and m.enabled_at <= c.subscription_started_at + interval '24 hours'
    )::bigint,
    count(*) filter (
      where c.subscription_started_at is null
         or m.enabled_at > c.subscription_started_at + interval '24 hours'
    )::bigint,
    count(*) filter (where m.disabled_at is not null)::bigint
  from public.company_modules m
  join public.companies c on c.id = m.company_id
  where c.deleted_at is null
    -- Our own workspaces are not customers and would flatter every figure, the
    -- same exclusion the retention cohorts make.
    and coalesce(c.is_internal, false) = false
    and m.enabled_at >= now() - make_interval(days => p_days)
  group by m.module
  order by m.module
$$;

revoke execute on function public.api_module_movements(integer)
  from public, anon, authenticated;
grant execute on function public.api_module_movements(integer) to service_role;

comment on function public.api_module_movements is
  '#255: add-on attach and drop counts over a window, split by whether the '
  'attach happened at signup or later. Attaching during checkout is a pricing-'
  'page decision; attaching weeks later is expansion, and a total that mixes '
  'them answers neither question. Reads existing timestamps — no new writes.';
