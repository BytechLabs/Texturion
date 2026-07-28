-- #448: the per-dial fee is the one voice cost the spending cap cannot bound.
--
-- The cap is denominated in SECONDS (api_period_forward_seconds), and a dial
-- costs ~10c whatever happens next. A run of very short calls therefore accrues
-- almost nothing against the cap and a real 10c each — the hole
-- `billing/costs.ts` and `billing/overage-projection.ts` both already named and
-- neither closed.
--
-- The alert arm records under its own metric so it cannot collide with the
-- minute arm at the same (company, period, threshold): they measure different
-- things against different ceilings, and a tenant that crossed 80% of its
-- MINUTES must still be able to trigger the dial alert in the same period.
--
-- Ops-only by design. The fee is our cost, never the customer's bill, so the
-- customer arm says "unusual call volume" and the money stays in the ops mail.
alter table public.usage_alerts
  drop constraint usage_alerts_metric_check;
alter table public.usage_alerts
  add constraint usage_alerts_metric_check
  check (metric in (
    'segments', 'mms_storage', 'attachment_storage', 'voice_minutes',
    'voice_minutes_grandfathered',
    'mms_messages', 'egress', 'cost_projection', 'storage_abuse',
    'voice_dials'
  ));
