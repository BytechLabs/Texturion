-- #581/16 — the rotated-secret alarm can see a rotated Stripe or Resend secret.
--
-- `channel:webhook-signature` fires when we are "rejecting signed deliveries and
-- accepting none of them". The rejections were summed across EVERY provider; the
-- acceptances counted Telnyx only. Inbound texts arrive all day, so that denominator
-- is essentially never zero, and the alarm could not fire for the two providers whose
-- secrets a human actually rotates by hand.
--
-- What that hides:
--
--   * A rotated or mis-copied Stripe secret 400s every delivery. A rejected delivery
--     never becomes a `webhook_events` row, so the five-minute sweeper has nothing to
--     replay, and `charge.dispute.created/updated/closed` has no other entry point in
--     the product — a customer disputes a charge and their workspace keeps full
--     service, with nothing anywhere saying so.
--   * A rotated Resend secret means no bounce or complaint is ever recorded, so no
--     address is suppressed and we keep mailing addresses that have already hard
--     bounced — which is how a sending domain's reputation goes.
--
-- The probe now returns acceptances per provider, shaped like the rejections it is
-- weighed against, so the caller can ask the question once per provider instead of
-- once for the whole platform.
--
-- Body EXTRACTED from 20260728001800_webhook_liveness.sql with one block replaced,
-- diffed against the original.
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
    -- Any accepted Telnyx webhook at all.
    --
    -- KEPT, and only for the deploy window: the Worker ships separately from this
    -- migration, so the version running right now still reads this key. The new
    -- reader uses `accepted` below. Remove this once a release has gone out.
    'telnyx_accepted', coalesce((
      select count(*) from public.webhook_events e
       where e.received_at >= p_since
         and e.provider = 'telnyx'), 0),
    -- #581/16 — ACCEPTANCES PER PROVIDER, which is what the rejection signal needs.
    --
    -- The signal is "we rejected signed deliveries and accepted none of them", and it
    -- was computed by dividing every provider's rejections by TELNYX's acceptances.
    -- Texts arrive constantly, so that denominator is almost never zero: rotate the
    -- Stripe secret and every Stripe delivery 400s while inbound texts keep the alarm
    -- quiet. Nothing else notices either — a rejected delivery never becomes a
    -- `webhook_events` row, so the five-minute sweeper has nothing to replay, and
    -- `charge.dispute.*` has no other way into this product.
    --
    -- Shaped like `rejections` so the two can be zipped per provider. A provider with
    -- no traffic at all is simply absent from both, which reads as healthy — and has
    -- to, or an idle platform alarms about itself.
    'accepted', coalesce((
      select jsonb_object_agg(t.provider, t.n) from (
        select e.provider, count(*)::int as n
          from public.webhook_events e
         where e.received_at >= p_since
         group by e.provider) t), '{}'::jsonb),
    'rejections', coalesce((
      select jsonb_object_agg(t.provider, t.n) from (
        select r.provider, sum(r.rejections)::int as n
          from public.webhook_rejections r
         where r.hour >= date_trunc('hour', p_since)
         group by r.provider) t), '{}'::jsonb))
$$;


-- Recreating a function hands it back the default PUBLIC execute grant, which anon and
-- authenticated inherit. Re-revoked rather than assumed.
revoke execute on function public.api_webhook_inbound_probe(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_webhook_inbound_probe(timestamptz, timestamptz)
  to service_role;
