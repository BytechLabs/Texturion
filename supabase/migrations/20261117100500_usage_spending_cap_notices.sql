alter table public.usage_alerts drop constraint usage_alerts_metric_check;

alter table public.usage_alerts add constraint usage_alerts_metric_check check (
  metric = any (array[
    'segments', 'mms_storage', 'attachment_storage', 'voice_minutes',
    'voice_minutes_grandfathered', 'mms_messages', 'egress', 'cost_projection',
    'storage_abuse', 'voice_dials', 'inbound_volume', 'carrier_daily',
    'segments_cap', 'voice_cap'
  ])
);
