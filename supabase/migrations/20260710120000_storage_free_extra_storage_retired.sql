-- #121: storage is FREE — retire the "Extra storage" (extra_storage) module
-- and the storage-budget enforcement posture it belonged to. Marketing, the
-- app, and the API catalog no longer sell or gate on storage; the only
-- backstop left is the usage-alerts cron's ABUSE arm (absolute tiers, emails
-- the customer and ops, never blocks). This migration retires the DB
-- footprint:
--   1. delete company_modules rows for 'extra_storage' (the code already
--      ignores them — isPlanModule('extra_storage') is false — so they are
--      inert history, not live state; storage was ungated in the same Worker
--      deploy);
--   2. tighten the module CHECK so 'extra_storage' can never be written again;
--   3. widen usage_alerts for the new abuse arm: allow the 'storage_abuse'
--      metric, and relax the threshold CHECK — the classic percent arms keep
--      using 80/100, while storage_abuse stores its ABSOLUTE GB tier
--      (25/50/100/200/400) as the once-per-tier-per-period dedupe key. The
--      PK (company_id, period_start, metric, threshold) already dedupes.
--
-- The claim_attachment_storage RPC keeps its p_budget_bytes gate parameter;
-- the Worker now passes an unbounded budget so it never rejects (kept for its
-- atomic row-insert + accounting, which the abuse arm reads). A later
-- cleanup migration may drop the parameter once no deployed Worker passes it.
--
-- Stripe: any live subscription still carrying the $5 extra-storage line item
-- is stripped by the daily reconcile's retired-price sweep (billing/
-- reconcile.ts) with a prorated credit — KEEP STRIPE_MODULE_EXTRA_STORAGE_
-- PRICE_ID set in production so the sweep can identify the price.
--
-- DEPLOY ORDER: deploy the Worker BEFORE applying this migration — the old
-- Worker still reads extra_storage rows via isModuleEnabled for its budget
-- math, and this migration deletes them.

delete from public.company_modules where module = 'extra_storage';

alter table public.company_modules
  drop constraint company_modules_module_check;
alter table public.company_modules
  add constraint company_modules_module_check
  check (module in ('voice', 'regions_ca'));

alter table public.usage_alerts
  drop constraint usage_alerts_metric_check;
alter table public.usage_alerts
  add constraint usage_alerts_metric_check
  check (metric in (
    'segments', 'mms_storage', 'attachment_storage', 'voice_minutes',
    'mms_messages', 'egress', 'cost_projection', 'storage_abuse'
  ));

alter table public.usage_alerts
  drop constraint usage_alerts_threshold_check;
alter table public.usage_alerts
  add constraint usage_alerts_threshold_check
  check (threshold > 0);
