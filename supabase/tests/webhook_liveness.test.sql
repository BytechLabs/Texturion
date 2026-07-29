-- #308 — noticing that inbound webhooks stopped, and that we are receiving
-- and discarding every one of them.
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run: psql -v ON_ERROR_STOP=1 -f supabase/tests/webhook_liveness.test.sql
-- The whole suite runs in one transaction and ROLLS BACK — it never pollutes
-- the local database.

\set ON_ERROR_STOP on

begin;

-- Deterministic clock: every assertion below is about a WINDOW, so a probe
-- anchored on now() would be untestable.
\set t0 '2026-07-28T12:00:00Z'

-- Isolate from whatever the local database already holds.
delete from public.webhook_events where received_at >= '2026-07-28T00:00:00Z';
delete from public.webhook_rejections where hour >= '2026-07-28T00:00:00Z';

insert into public.webhook_events (provider, event_id, event_type, payload, received_at)
values
  ('telnyx', 'wl-1', 'message.received',  '{}'::jsonb, '2026-07-28T11:30:00Z'),
  ('telnyx', 'wl-2', 'message.received',  '{}'::jsonb, '2026-07-28T11:40:00Z'),
  ('telnyx', 'wl-3', 'message.sent',      '{}'::jsonb, '2026-07-28T11:45:00Z'),
  ('telnyx', 'wl-4', 'message.finalized', '{}'::jsonb, '2026-07-28T11:50:00Z'),
  ('telnyx', 'wl-5', 'call.answered',     '{}'::jsonb, '2026-07-28T11:55:00Z'),
  -- Outside the window: proves the probe is a window and not a lifetime count.
  ('telnyx', 'wl-6', 'message.received',  '{}'::jsonb, '2026-07-27T01:00:00Z');

-- ===========================================================================
-- WL-1. The probe counts each event CLASS separately.
--
--       Three classes rather than one because they fail independently:
--       "message webhooks fine, call webhooks dead" is a real shape, and a
--       single combined counter would report the inbound path as healthy
--       while every inbound call rang nowhere.
-- ===========================================================================
do $$
declare
  p jsonb;
begin
  p := public.api_webhook_inbound_probe('2026-07-28T09:00:00Z', '2026-07-28T12:00:00Z');
  if (p->>'inbound_message')::int <> 2 then
    raise exception 'WL-1 FAILED: inbound_message = % (want 2): %', p->>'inbound_message', p;
  end if;
  -- message.sent AND message.finalized both count as status.
  if (p->>'message_status')::int <> 2 then
    raise exception 'WL-1 FAILED: message_status = % (want 2): %', p->>'message_status', p;
  end if;
  if (p->>'call_event')::int <> 1 then
    raise exception 'WL-1 FAILED: call_event = % (want 1): %', p->>'call_event', p;
  end if;
  -- Every telnyx row in the window, whatever its class.
  if (p->>'telnyx_accepted')::int <> 5 then
    raise exception 'WL-1 FAILED: telnyx_accepted = % (want 5): %', p->>'telnyx_accepted', p;
  end if;
end $$;

-- ===========================================================================
-- WL-2. It is a WINDOW. An event older than p_since must not keep a dead
--       channel looking alive — which is the entire failure this issue is
--       about, one level up.
-- ===========================================================================
do $$
declare
  p jsonb;
begin
  p := public.api_webhook_inbound_probe('2026-07-28T11:52:00Z', '2026-07-28T12:00:00Z');
  if (p->>'inbound_message')::int <> 0 then
    raise exception 'WL-2 FAILED: a stale event counted inside a narrow window: %', p;
  end if;
  if (p->>'call_event')::int <> 1 then
    raise exception 'WL-2 FAILED: call_event = % (want 1): %', p->>'call_event', p;
  end if;
end $$;

-- ===========================================================================
-- WL-3. Rejections are counted per provider, into hour buckets, and the
--       counter is additive.
-- ===========================================================================
do $$
declare
  p jsonb;
  n int;
begin
  perform public.record_webhook_rejection('telnyx', '2026-07-28T11:05:00Z');
  perform public.record_webhook_rejection('telnyx', '2026-07-28T11:59:00Z');
  perform public.record_webhook_rejection('stripe', '2026-07-28T11:10:00Z');

  -- Both telnyx rejections land in the SAME hour bucket.
  select rejections into n from public.webhook_rejections
   where provider = 'telnyx' and hour = '2026-07-28T11:00:00Z';
  if n <> 2 then
    raise exception 'WL-3 FAILED: telnyx 11:00 bucket = % (want 2)', n;
  end if;

  p := public.api_webhook_inbound_probe('2026-07-28T09:00:00Z', '2026-07-28T12:00:00Z');
  if (p->'rejections'->>'telnyx')::int <> 2 then
    raise exception 'WL-3 FAILED: probe telnyx rejections = %: %', p->'rejections'->>'telnyx', p;
  end if;
  if (p->'rejections'->>'stripe')::int <> 1 then
    raise exception 'WL-3 FAILED: probe stripe rejections = %: %', p->'rejections'->>'stripe', p;
  end if;
end $$;

-- ===========================================================================
-- WL-4. With no rejections at all, the probe reports an EMPTY OBJECT rather
--       than null.
--
--       The checker sums these values. A null would make the sum NaN in
--       JavaScript, and NaN > 0 is false — so a null here would silently
--       disable the sharpest alarm in the product rather than failing loudly.
-- ===========================================================================
do $$
declare
  p jsonb;
begin
  p := public.api_webhook_inbound_probe('2026-07-28T13:00:00Z', '2026-07-28T14:00:00Z');
  if p->'rejections' is null or jsonb_typeof(p->'rejections') <> 'object' then
    raise exception 'WL-4 FAILED: rejections must be an object, got %: %',
      jsonb_typeof(p->'rejections'), p;
  end if;
  if p->'rejections' <> '{}'::jsonb then
    raise exception 'WL-4 FAILED: expected an empty object, got %', p->'rejections';
  end if;
  -- Every count is a real zero, never null, for the same reason.
  if (p->>'inbound_message')::int <> 0 or (p->>'telnyx_accepted')::int <> 0 then
    raise exception 'WL-4 FAILED: counts must be 0 not null: %', p;
  end if;
end $$;

-- ===========================================================================
-- WL-5. An unknown provider cannot be recorded. The vocabulary is a CHECK, so
--       a typo in a caller fails loudly instead of quietly counting into a
--       bucket nothing ever reads.
-- ===========================================================================
do $$
begin
  begin
    perform public.record_webhook_rejection('nonsense', '2026-07-28T11:00:00Z');
    raise exception 'WL-5 FAILED: an unknown provider was accepted';
  exception when check_violation then
    null; -- expected
  end;
end $$;

-- ===========================================================================
-- WL-6. RLS on, and neither the ledger nor either function is reachable by an
--       end-user role. This is infrastructure telemetry: it says when our
--       secrets rotated and how much traffic we are refusing.
-- ===========================================================================
do $$
declare
  leaked text;
begin
  if not exists (
    select 1 from pg_tables
     where schemaname = 'public' and tablename = 'webhook_rejections'
       and rowsecurity)
  then
    raise exception 'WL-6 FAILED: RLS not enabled on webhook_rejections';
  end if;

  select string_agg(grantee, ', ') into leaked
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'webhook_rejections'
    and grantee in ('anon', 'authenticated');
  if leaked is not null then
    raise exception 'WL-6 FAILED: end-user grants present: %', leaked;
  end if;

  select string_agg(distinct grantee, ', ') into leaked
  from information_schema.role_routine_grants
  where routine_schema = 'public'
    and routine_name in ('record_webhook_rejection', 'api_webhook_inbound_probe')
    and grantee in ('anon', 'authenticated', 'public');
  if leaked is not null then
    raise exception 'WL-6 FAILED: end-user execute grants present: %', leaked;
  end if;
end $$;


-- ===========================================================================
-- WL-7. The canary confirms on its TOKEN, not merely on an arrival.
--
--       Matching on the destination number alone would let ANY inbound to that
--       number confirm the canary — including the PREVIOUS hour's, which is
--       exactly the stale-evidence failure this whole issue is about one level
--       up. A canary that can be confirmed by old traffic proves nothing.
-- ===========================================================================
do $$
declare
  r jsonb;
begin
  insert into public.inbound_canary_runs (token, sent_at)
  values ('CANARY-OLD', '2026-07-28T10:00:00Z'),
         ('CANARY-NEW', '2026-07-28T11:00:00Z');

  -- An inbound webhook carrying the OLD token, arriving after the NEW send.
  insert into public.webhook_events (provider, event_id, event_type, payload, received_at)
  values ('telnyx', 'wl-c1', 'message.received',
          '{"data":{"payload":{"text":"CANARY-OLD"}}}'::jsonb,
          '2026-07-28T11:30:00Z');

  -- The newest pending run is CANARY-NEW, and nothing carrying that token has
  -- arrived, so it must NOT be confirmed by the CANARY-OLD delivery.
  r := public.confirm_inbound_canary('2026-07-28T11:45:00Z', 60);
  if r->>'confirmed' is not null then
    raise exception 'WL-7 FAILED: a stale token confirmed the current canary: %', r;
  end if;
  if (r->>'pending')::boolean is not true then
    raise exception 'WL-7 FAILED: expected the run to still be pending: %', r;
  end if;
end $$;

-- ===========================================================================
-- WL-8. A matching token DOES confirm, once the run is old enough, and the
--       round trip is measured.
-- ===========================================================================
do $$
declare
  r jsonb;
  c timestamptz;
begin
  insert into public.webhook_events (provider, event_id, event_type, payload, received_at)
  values ('telnyx', 'wl-c2', 'message.received',
          '{"data":{"payload":{"text":"CANARY-NEW"}}}'::jsonb,
          '2026-07-28T11:00:30Z');

  r := public.confirm_inbound_canary('2026-07-28T11:45:00Z', 60);
  if r->>'confirmed' <> 'CANARY-NEW' then
    raise exception 'WL-8 FAILED: expected CANARY-NEW to confirm: %', r;
  end if;
  if (r->>'round_trip_seconds')::int <> 2700 then
    raise exception 'WL-8 FAILED: round trip = %s (want 2700): %', r->>'round_trip_seconds', r;
  end if;

  select confirmed_at into c from public.inbound_canary_runs where token = 'CANARY-NEW';
  if c is null then
    raise exception 'WL-8 FAILED: confirmed_at was not stamped';
  end if;
end $$;

-- ===========================================================================
-- WL-9. A run younger than the minimum age is not judged.
--
--       The webhook arrives seconds later. Treating a 5-second-old silence as
--       evidence would alert on every single run.
-- ===========================================================================
do $$
declare
  r jsonb;
begin
  -- Clear the earlier fixtures: `confirm_inbound_canary` deliberately picks the
  -- MOST RECENT run that is old enough, so an older pending run left lying
  -- around would be the one judged here and the assertion would be about the
  -- wrong row. (That selection is correct — the freshest evidence is the
  -- evidence that matters, and older unanswered runs keep driving the cap.)
  delete from public.inbound_canary_runs;
  insert into public.inbound_canary_runs (token, sent_at)
  values ('CANARY-FRESH', '2026-07-28T11:59:30Z');

  r := public.confirm_inbound_canary('2026-07-28T12:00:00Z', 60);
  if (r->>'pending')::boolean is not false or r->>'confirmed' is not null then
    raise exception 'WL-9 FAILED: a 30-second-old run was judged: %', r;
  end if;
end $$;

-- ===========================================================================
-- WL-10. A run whose SEND failed is never inbound evidence, in either
--        direction: it is not confirmable, and it is not counted as
--        unanswered. A canary that never left says nothing about inbound —
--        that outage belongs to channel:sms-outbound.
-- ===========================================================================
do $$
declare
  r jsonb;
  n int;
begin
  delete from public.inbound_canary_runs;
  insert into public.inbound_canary_runs (token, sent_at, send_error)
  values ('CANARY-DEAD', '2026-07-28T10:00:00Z', 'Telnyx HTTP 500');

  r := public.confirm_inbound_canary('2026-07-28T12:00:00Z', 60);
  if (r->>'pending')::boolean is not false then
    raise exception 'WL-10 FAILED: a failed send was treated as pending: %', r;
  end if;

  n := public.inbound_canary_unanswered('2026-07-28T00:00:00Z');
  if n <> 0 then
    raise exception 'WL-10 FAILED: unanswered = % (a failed send must not count)', n;
  end if;

  -- A genuine unanswered run does count — that is what drives the cap.
  insert into public.inbound_canary_runs (token, sent_at)
  values ('CANARY-SILENT', '2026-07-28T10:30:00Z');
  n := public.inbound_canary_unanswered('2026-07-28T00:00:00Z');
  if n <> 1 then
    raise exception 'WL-10 FAILED: unanswered = % (want 1)', n;
  end if;
end $$;

-- ===========================================================================
-- WL-11. The canary ledger is service-role only, like the rest.
-- ===========================================================================
do $$
declare
  leaked text;
begin
  if not exists (
    select 1 from pg_tables
     where schemaname = 'public' and tablename = 'inbound_canary_runs'
       and rowsecurity)
  then
    raise exception 'WL-11 FAILED: RLS not enabled on inbound_canary_runs';
  end if;

  select string_agg(distinct grantee, ', ') into leaked
  from information_schema.role_routine_grants
  where routine_schema = 'public'
    and routine_name in ('confirm_inbound_canary', 'inbound_canary_unanswered')
    and grantee in ('anon', 'authenticated', 'public');
  if leaked is not null then
    raise exception 'WL-11 FAILED: end-user execute grants present: %', leaked;
  end if;
end $$;

\echo 'webhook_liveness.test.sql: WL-1..WL-11 PASSED'

rollback;
