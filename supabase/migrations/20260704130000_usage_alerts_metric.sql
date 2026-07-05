-- #12 storage alerts: usage_alerts gains a `metric` axis so the point-in-time
-- storage-budget alerts (mms_storage, attachment_storage) can coexist with the
-- per-period outbound-segment alerts at the same (company, period, threshold).
-- Every row that predates this migration is a segment alert, so 'segments' is
-- the backfill default. The primary key grows to include the metric.

alter table public.usage_alerts
  add column metric text not null default 'segments'
    check (metric in ('segments', 'mms_storage', 'attachment_storage'));

alter table public.usage_alerts drop constraint usage_alerts_pkey;

alter table public.usage_alerts
  add primary key (company_id, period_start, metric, threshold);

comment on column public.usage_alerts.metric is
  'Which budget this alert measured: segments (per-period outbound quota) | '
  'mms_storage | attachment_storage (#12 point-in-time storage budgets).';
