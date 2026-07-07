-- #12 outbound-MMS metering + cap. Sending picture messages is a gated but
-- UNCAPPED cost center (docs/PRICING-AUDIT.md §8): the "Picture messages" module
-- decides WHETHER a company can send MMS, but nothing bounds HOW MANY it sends,
-- and each outbound MMS costs ~$0.025 (Telnyx base + T-Mobile carrier surcharge).
-- A $5 module covers ~200; a shop texting job photos daily runs unbounded-
-- negative. This migration adds the period-count RPC so send.ts can (a) warn the
-- owner at 80/100% and (b) hard-cap-and-drop the media once a company is over its
-- plan's included allowance (the customer's TEXT still sends — only the picture
-- is shed). No new table is needed: message_attachments already records every
-- outbound picture (source_url NULL, mms-media bucket), so the count reads it —
-- the MMS analog of api_period_voice_seconds reading call_records.

-- Count of outbound MMS a company has SENT since a period start: the distinct
-- outbound messages in the window that Telnyx accepted (telnyx_message_id set)
-- and that carry at least one media attachment. Filtering on telnyx_message_id
-- means (a) only cost-incurring, accepted sends count — a queued/failed send that
-- never hit Telnyx is free and excluded — and (b) the in-flight message being
-- dispatched (id set, telnyx id still NULL at the cap check) is naturally
-- excluded, so the cap reads "already sent" with no off-by-one. Server-side count
-- via a security-definer function for the same reason api_period_voice_seconds
-- is an RPC: a PostgREST read would truncate at the row cap.
create or replace function public.api_period_outbound_mms(
  p_company_id uuid,
  p_since      timestamptz
) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::bigint
  from public.messages m
  where m.company_id = p_company_id
    and m.direction = 'outbound'
    and m.telnyx_message_id is not null
    and m.created_at >= p_since
    and exists (
      select 1 from public.message_attachments a
      where a.message_id = m.id
    )
$$;
revoke execute on function public.api_period_outbound_mms(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_period_outbound_mms(uuid, timestamptz)
  to service_role;

-- Supports the period scan (company + created_at window over accepted outbound),
-- mirroring call_records_company_period_idx. Partial so it stays small — the vast
-- majority of outbound rows are texts, and only accepted ones are ever counted.
create index messages_outbound_accepted_period_idx
  on public.messages (company_id, created_at)
  where direction = 'outbound' and telnyx_message_id is not null;

-- #12 mms alerts: allow the 'mms_messages' metric on usage_alerts so the usage-
-- alert cron can warn owners at 80%/100% of their included picture messages —
-- before the hard cap starts stripping media. Widens the existing metric check;
-- the PK (company_id, period_start, metric, threshold) already keeps it distinct
-- from the segment + storage + voice arms.
alter table public.usage_alerts drop constraint usage_alerts_metric_check;

alter table public.usage_alerts
  add constraint usage_alerts_metric_check
  check (metric in (
    'segments', 'mms_storage', 'attachment_storage', 'voice_minutes', 'mms_messages'
  ));
