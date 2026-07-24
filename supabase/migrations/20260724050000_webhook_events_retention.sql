-- `webhook_events` is the provider idempotency ledger: one row per Telnyx and
-- Stripe webhook, carrying the FULL payload jsonb. Every message status
-- callback, every call leg event, every billing event appends a row — and
-- nothing has ever removed one. The */5 sweeper only REPLAYS the unprocessed
-- tail; processed rows accumulate forever, so the table grows without bound
-- for the life of the product (already the largest table in prod, at ~110
-- rows/day on a near-idle install — it scales linearly with messages+calls).
--
-- Bound it. Retention is driven by the ONLY thing the ledger guarantees:
-- dedupe of a provider RE-delivery. Stripe retries for up to ~3 days (and an
-- event stays manually re-sendable for 30); Telnyx gives up far sooner. A
-- 30-day floor therefore keeps the dedupe window strictly wider than any
-- redelivery either provider can produce, while still capping growth.
--
-- Only PROCESSED rows are ever eligible: an unprocessed row is still owed a
-- replay, and one that exhausted its attempts is the forensic record behind a
-- Sentry alert — neither is retention's business.

-- The sweeper's existing index is partial on `processed_at IS NULL`, i.e. the
-- exact complement of what the prune scans. Without its own index the prune
-- would seq-scan the whole ledger; with it, both the filter and the
-- oldest-first ordering are index-served.
create index if not exists webhook_events_processed_received_idx
  on public.webhook_events (received_at)
  where processed_at is not null;

-- Bounded, oldest-first prune. Returns the number of rows removed so the cron
-- can log/observe progress and tell "nothing to do" from "still draining".
create or replace function public.api_prune_webhook_events(
  p_before timestamptz,
  p_limit integer
)
returns integer
language sql
security definer
set search_path = ''
as $$
  with doomed as (
    select w.provider, w.event_id
    from public.webhook_events w
    where w.processed_at is not null
      and w.received_at < p_before
    order by w.received_at
    limit greatest(p_limit, 0)
  ),
  removed as (
    delete from public.webhook_events t
    using doomed d
    where t.provider = d.provider
      and t.event_id = d.event_id
    returning 1
  )
  select count(*)::int from removed;
$$;

-- Only the API's service-role key calls it; end-user roles must never be able
-- to erase the idempotency ledger (replaying a pruned event re-runs its
-- handler).
revoke execute on function public.api_prune_webhook_events(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.api_prune_webhook_events(timestamptz, integer)
  to service_role;
