-- #85 (child 3 / #92) dynamic overage warning: allow the 'cost_projection'
-- metric on usage_alerts so the hourly cron can email an owner AT MOST ONCE per
-- billing period when the tenant is projected (from usage so far) to cost more
-- than they pay. Unlike the static 80%/100% arms this is not a percentage of a
-- fixed quota; it fires on the dynamic decideOverage() signal and uses a single
-- fixed threshold (100) purely as the ledger's once-per-period key. Widens the
-- existing metric check; the PK (company_id, period_start, metric, threshold)
-- already keeps it distinct from the static arms.
-- ---------------------------------------------------------------------------
alter table public.usage_alerts drop constraint usage_alerts_metric_check;

alter table public.usage_alerts
  add constraint usage_alerts_metric_check
  check (metric in (
    'segments', 'mms_storage', 'attachment_storage', 'voice_minutes',
    'mms_messages', 'egress', 'cost_projection'
  ));
