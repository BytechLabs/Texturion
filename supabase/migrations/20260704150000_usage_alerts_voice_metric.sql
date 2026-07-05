-- #12 voice alerts: allow the 'voice_minutes' metric on usage_alerts so the
-- usage-alert cron can warn owners at 80%/100% of their call-forwarding
-- allowance — before the hard cap starts rejecting calls. Widens the existing
-- metric check; the PK (company_id, period_start, metric, threshold) already
-- keeps it distinct from the segment + storage arms.

alter table public.usage_alerts drop constraint usage_alerts_metric_check;

alter table public.usage_alerts
  add constraint usage_alerts_metric_check
  check (metric in ('segments', 'mms_storage', 'attachment_storage', 'voice_minutes'));
