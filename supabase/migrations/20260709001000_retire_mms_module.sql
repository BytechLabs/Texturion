-- #97/#103: retire the "Picture messages" (mms) module. Picture messages are
-- free now — each outbound MMS meters as 3 segments through usage_events, so
-- the segment quota + overage billing bound them like text. The paid module is
-- gone from the code catalog (billing/modules.ts); this migration retires its
-- DB footprint:
--   1. delete company_modules rows for 'mms' (the code already ignores them —
--      isPlanModule('mms') is false — so they are inert history, not live state;
--      the customer-facing capability is ungated regardless);
--   2. tighten the module CHECK so 'mms' can never be written again;
--   3. drop api_period_outbound_mms — its last readers (the send-time cap, the
--      usage-alert arm, GET /v1/usage's meter, the cost projection) are gone.
--
-- Stripe: any live subscription still carrying the $5 mms line item is stripped
-- by the daily reconcile's retired-price sweep (billing/reconcile.ts) with a
-- prorated credit — no manual dashboard step required.
--
-- DEPLOY ORDER: deploy the Worker BEFORE applying this migration — the old
-- Worker still calls api_period_outbound_mms (usage route, alerts cron,
-- projection), and dropping the function under it would 500 those paths.

delete from public.company_modules where module = 'mms';

alter table public.company_modules
  drop constraint company_modules_module_check;
alter table public.company_modules
  add constraint company_modules_module_check
  check (module in ('voice', 'extra_storage', 'regions_ca'));

drop function if exists public.api_period_outbound_mms(uuid, timestamptz);
