-- #449: inbound segments are the one cost centre with no ceiling and no way to
-- get one. Inbound is free to the customer, costs us 0.7c a segment, and is
-- already paid for by the time our webhook runs — Telnyx received and billed it
-- before any code of ours could have refused it.
--
-- So this metric is NOT a cap arm. It is the storage-abuse shape (#121):
-- absolute tiers, customer and ops both told, nothing blocked. Its own metric
-- so it can never collide with the notification budget, which is about
-- ATTENTION and happens to correlate — a flood into one already-active
-- conversation spends money while claiming almost no notifications.
alter table public.usage_alerts
  drop constraint usage_alerts_metric_check;
alter table public.usage_alerts
  add constraint usage_alerts_metric_check
  check (metric in (
    'segments', 'mms_storage', 'attachment_storage', 'voice_minutes',
    'voice_minutes_grandfathered',
    'mms_messages', 'egress', 'cost_projection', 'storage_abuse',
    'voice_dials', 'inbound_volume'
  ));
