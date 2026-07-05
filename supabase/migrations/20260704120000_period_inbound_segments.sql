-- #12 Increment A (metering foundation) — inbound VISIBILITY. Inbound SMS/MMS is
-- the audit's #1 unmeasured cost center (docs/PRICING-AUDIT.md): we pay Telnyx
-- to receive every message but never even count it. This RPC DERIVES the
-- current-period inbound segment volume from the messages table (no new
-- recording, no hot-path write, no billing) so /v1/usage can surface it — the
-- foundation for an eventual inbound allowance/cap.
--
-- coalesce(segments, 1): inbound rows don't always carry a parts count, so each
-- inbound message counts as at least one segment (a conservative floor). Server-
-- side sum via a security-definer function for the same reason api_period_
-- segments is an RPC — a PostgREST read would truncate at the row cap.
create or replace function public.api_period_inbound_segments(
  p_company_id uuid,
  p_since      timestamptz
) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(coalesce(m.segments, 1)), 0)::bigint
  from public.messages m
  where m.company_id = p_company_id
    and m.direction = 'inbound'
    and m.created_at >= p_since
$$;
revoke execute on function public.api_period_inbound_segments(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_period_inbound_segments(uuid, timestamptz)
  to service_role;
