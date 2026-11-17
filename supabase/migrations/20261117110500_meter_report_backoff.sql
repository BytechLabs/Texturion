alter table public.usage_events
  add column report_attempts integer not null default 0,
  add column report_next_at timestamptz not null default '-infinity';

alter table public.call_records
  add column report_attempts integer not null default 0,
  add column report_next_at timestamptz not null default '-infinity';

create index usage_events_meter_due_idx on public.usage_events (report_next_at, created_at)
  where stripe_reported_at is null and quantity > 0;

create index call_records_meter_due_idx on public.call_records (report_next_at, created_at)
  where stripe_reported_at is null and billable_seconds > 0
    and leg in ('forward', 'out_customer', 'in_browser');
