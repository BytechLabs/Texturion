-- ===========================================================================
-- [#308] The synthetic canary: prove the inbound path instead of inferring it.
--
-- The traffic probes in 20260728001800 are an honest backstop and nothing
-- more. They read customer traffic, and customer traffic cannot distinguish
-- "broken" from "quiet" quickly at this platform's size — which is why their
-- graces are twelve hours and two days rather than something that would page
-- at 3am and be muted by Friday.
--
-- A canary removes the ambiguity by GENERATING the traffic. We send a text
-- from a number we own to a number we own and wait for its `message.received`
-- webhook to come back. That exercises the entire path end to end — Telnyx
-- accepted it, Telnyx delivered the webhook, Cloudflare routed it, our
-- signature verification passed, our handler ran — so its silence means
-- something specific rather than "nobody texted a plumber this hour".
--
-- ONE ROW PER ROUND TRIP, because the confirmation cannot happen in the run
-- that sent it: the webhook arrives seconds later, and a job that blocked
-- waiting for it would be holding a request open on a guess. Run N sends and
-- confirms what run N-1 sent.
--
-- THE TOKEN IS THE CORRELATION. Matching on the destination number alone would
-- let ANY inbound message to that number confirm the canary — including the
-- previous hour's, which is exactly the stale-evidence failure this issue is
-- about one level up. The token is what makes the confirmation mean "the
-- message I sent 60 minutes ago arrived", rather than "something arrived".
-- ===========================================================================

create table if not exists public.inbound_canary_runs (
  -- The correlation token, also the body of the text we send.
  token        text        primary key,
  sent_at      timestamptz not null default now(),
  confirmed_at timestamptz,
  -- Set when the SEND itself failed. A send that never left is not evidence
  -- about the INBOUND path, so it must never age into an inbound alert — it is
  -- a different outage, already covered by channel:sms-outbound.
  send_error   text
);

comment on table public.inbound_canary_runs is
  '#308: one row per synthetic inbound round trip. `confirmed_at` is stamped when the message.received webhook for that token arrives; a row with send_error never counts as inbound evidence.';

-- The only read is "the most recent unconfirmed run", every cadence.
create index if not exists inbound_canary_runs_pending_idx
  on public.inbound_canary_runs (sent_at desc)
  where confirmed_at is null and send_error is null;

-- Service-role only, like every other operational ledger.
alter table public.inbound_canary_runs enable row level security;

-- ---------------------------------------------------------------------------
-- Confirm a pending run by looking for its token in the webhook ledger.
--
-- Reads `webhook_events` rather than `messages` deliberately: the canary's
-- destination is a number no workspace owns, so the inbound pipeline never
-- threads it into a conversation. The webhook ledger is the earliest and most
-- honest evidence that the round trip completed — it is written by the route
-- itself, after signature verification, before any business logic that could
-- be the thing that is broken.
--
-- Returns the token it confirmed, or null.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_inbound_canary(
  p_now         timestamptz default now(),
  -- Give the webhook time to arrive before treating silence as evidence.
  p_min_age_seconds int default 60
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run   public.inbound_canary_runs%rowtype;
  v_found boolean;
begin
  select * into v_run
    from public.inbound_canary_runs r
   where r.confirmed_at is null
     and r.send_error is null
     and r.sent_at <= p_now - make_interval(secs => p_min_age_seconds)
   order by r.sent_at desc
   limit 1;
  if not found then
    return jsonb_build_object('confirmed', null, 'pending', false);
  end if;

  -- The token rides in the message body, so it surfaces in the webhook payload
  -- as the inbound text. Matching on the token and not merely the number is
  -- what stops last hour's delivery confirming this hour's send.
  select exists (
    select 1 from public.webhook_events e
     where e.provider = 'telnyx'
       and e.event_type = 'message.received'
       and e.received_at >= v_run.sent_at
       and e.payload::text like '%' || v_run.token || '%'
  ) into v_found;

  if not v_found then
    return jsonb_build_object(
      'confirmed', null, 'pending', true, 'token', v_run.token,
      'sent_at', v_run.sent_at);
  end if;

  update public.inbound_canary_runs
     set confirmed_at = p_now
   where token = v_run.token;

  return jsonb_build_object(
    'confirmed', v_run.token,
    'pending', false,
    'sent_at', v_run.sent_at,
    'round_trip_seconds',
      extract(epoch from (p_now - v_run.sent_at))::int);
end $$;

revoke execute on function public.confirm_inbound_canary(timestamptz, int)
  from public, anon, authenticated;
grant execute on function public.confirm_inbound_canary(timestamptz, int)
  to service_role;

-- ---------------------------------------------------------------------------
-- How many canaries have gone unanswered lately.
--
-- This is the CAP arm, and it is the shape the cost mandate asks for: when the
-- inbound path is dead, every further canary is money spent to re-learn a fact
-- we already know and have already alerted on. Past the ceiling the canary
-- stops sending — the alert is already raised and does not need re-proving at
-- 1.7c a go.
-- ---------------------------------------------------------------------------
create or replace function public.inbound_canary_unanswered(
  p_since timestamptz
) returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(count(*), 0)::int
    from public.inbound_canary_runs r
   where r.sent_at >= p_since
     and r.confirmed_at is null
     and r.send_error is null
$$;

revoke execute on function public.inbound_canary_unanswered(timestamptz)
  from public, anon, authenticated;
grant execute on function public.inbound_canary_unanswered(timestamptz)
  to service_role;
