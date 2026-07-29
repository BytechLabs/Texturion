-- ===========================================================================
-- [#308] A broken inbound webhook looks exactly like a slow day.
--
-- Everything inbound arrives by webhook: messages, message status, every call
-- event. If they stop, nothing throws — there is only an absence, and an
-- absence reads as a quiet Tuesday. It is the most dangerous failure shape a
-- communications product has, because it is silent AND total: the customer's
-- business number rings into nothing and the first signal is an angry phone
-- call hours later.
--
-- #387/D55 already built the mechanism for "an expected thing did not happen".
-- This adds the two inbound observations it was missing.
--
-- ---------------------------------------------------------------------------
-- 1. THE REJECTION LEDGER — the sharper of the two, and the one with no
--    equivalent anywhere.
--
-- `webhooks/telnyx.ts:46`, `resend.ts:129` and `stripe.ts:75` all return 400
-- on a bad signature and record NOTHING — no counter, no log line, no Sentry
-- event. So the rotated-secret failure ("the requests arrive and we discard
-- every one") produces no signal on either side. It is worse than the webhook
-- stopping, because the provider believes it is delivering.
--
-- ONLY REQUESTS THAT LOOK LIKE REAL DELIVERIES ARE COUNTED — the caller checks
-- for the provider's signature header before recording. Two reasons, and the
-- second is the important one: an unauthenticated public endpoint must not let
-- a scanner drive a database write per request; and a random POST is not
-- evidence about our secret, so counting it would only dilute the signal.
--
-- ---------------------------------------------------------------------------
-- 2. THE INBOUND PROBE — per event class, because they fail independently.
--
-- Messages, message status and call events are separate paths. Message
-- webhooks fine + call webhooks dead is a real shape, and nobody would spot it
-- until somebody missed a call.
--
-- Probed from `webhook_events` rather than heartbeat-written on the hot path,
-- exactly as the outbound-SMS probe reads `messages`: a liveness write per
-- inbound webhook would add a round trip to the hottest path in the product to
-- learn something one query per cadence answers just as well.
--
-- ONE RPC RETURNS ALL OF IT so the checker makes one round trip rather than
-- five.
-- ===========================================================================

create table if not exists public.webhook_rejections (
  provider   text        not null,
  -- Hour bucket, UTC. This is an operational counter about OUR infrastructure,
  -- not a customer-facing daily figure, so it is deliberately not keyed on any
  -- company's local day (unlike the #343/#452 ledgers).
  hour       timestamptz not null,
  rejections int         not null default 0 check (rejections >= 0),
  primary key (provider, hour),
  constraint webhook_rejections_provider_check
    check (provider in ('telnyx', 'stripe', 'resend'))
);

comment on table public.webhook_rejections is
  '#308: signature-verification failures per provider per UTC hour. Only requests carrying the provider signature header are counted, so scanners cannot drive writes or dilute the signal.';

-- Service-role only, like every other internal ledger.
alter table public.webhook_rejections enable row level security;

-- ---------------------------------------------------------------------------
-- Record one rejection. Deliberately tiny: this runs on an unauthenticated
-- public route, so it does exactly one upsert against one narrow row.
-- ---------------------------------------------------------------------------
create or replace function public.record_webhook_rejection(
  p_provider text,
  p_now      timestamptz default now()
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.webhook_rejections as r (provider, hour, rejections)
  values (p_provider, date_trunc('hour', p_now), 1)
  on conflict (provider, hour) do update
    set rejections = r.rejections + 1;
$$;

revoke execute on function public.record_webhook_rejection(text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_webhook_rejection(text, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- Everything the liveness checker needs about the inbound path, in one call.
--
-- Per-class counts of ACCEPTED webhooks in the window, plus the rejection
-- count over the same window. The checker turns these into heartbeats; the
-- policy lives in TypeScript beside the expectations it feeds, not here.
--
-- Classes mirror `messaging/dispatch.ts` and `calls/webhook-router.ts`:
--   inbound_message — message.received
--   message_status  — message.sent / message.finalized
--   call_event      — call.*
-- ---------------------------------------------------------------------------
create or replace function public.api_webhook_inbound_probe(
  p_since timestamptz,
  p_now   timestamptz default now()
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'inbound_message', coalesce((
      select count(*) from public.webhook_events e
       where e.received_at >= p_since
         and e.event_type = 'message.received'), 0),
    'message_status', coalesce((
      select count(*) from public.webhook_events e
       where e.received_at >= p_since
         and e.event_type in ('message.sent', 'message.finalized')), 0),
    'call_event', coalesce((
      select count(*) from public.webhook_events e
       where e.received_at >= p_since
         and e.event_type like 'call.%'), 0),
    -- Any accepted Telnyx webhook at all. This is the denominator of the
    -- rejection signal: rejections alongside acceptances are ordinary noise
    -- (a retry, a stale delivery); rejections with ZERO acceptances is the
    -- rotated-secret shape.
    'telnyx_accepted', coalesce((
      select count(*) from public.webhook_events e
       where e.received_at >= p_since
         and e.provider = 'telnyx'), 0),
    'rejections', coalesce((
      select jsonb_object_agg(t.provider, t.n) from (
        select r.provider, sum(r.rejections)::int as n
          from public.webhook_rejections r
         where r.hour >= date_trunc('hour', p_since)
         group by r.provider) t), '{}'::jsonb))
$$;

revoke execute on function public.api_webhook_inbound_probe(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_webhook_inbound_probe(timestamptz, timestamptz)
  to service_role;

-- The probe is a time-range scan over the busiest table in the product, run
-- every cadence. Without this it is a sequential scan that grows with volume.
create index if not exists webhook_events_received_at_idx
  on public.webhook_events (received_at desc);
