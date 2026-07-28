-- #387 — noticing that an expected thing did NOT happen.
--
-- Sentry answers "what threw?". Every failure in #387's table is a non-event:
-- the carrier accepted the message and dropped it, Resend accepted the request
-- and the mailbox bounced it, the cron did not fire. Nothing throws, because
-- the defining characteristic is that the thing did not occur — and silence is
-- byte-for-byte identical to health.
--
-- For THIS product that is not ops hygiene. A plumber gets no error when their
-- texts stop arriving; the phone just stops buzzing, which is also what a slow
-- week looks like. Per #382 they cannot tell us either, so the detection path
-- is: we do not notice, and they cannot report it.
--
-- ONE PRIMITIVE, not nine detectors. A declared expectation ("X should happen
-- at least every N minutes"), a recorded occurrence, and an alert on absence.
-- The declaration lives in TypeScript where the compiler can require it
-- (apps/api/src/observability/liveness.ts); this table is only the ledger of
-- what actually happened.
--
-- Everything is a heartbeat, including the things that are really probes. A
-- cron records its heartbeat by firing. A delivery channel records its
-- heartbeat from a small job that checks whether anything actually got through
-- in the window. Same ledger, same alert path, one contract — which is the
-- whole point of #387 rather than nine bespoke mechanisms with nine failure
-- modes of their own.

create table if not exists public.liveness_heartbeats (
  key             text primary key,
  last_seen_at    timestamptz not null,
  -- Alert state, kept here rather than derived, so the alert is throttled
  -- across Worker isolates and deploys. An outage that emails the founder
  -- every minute for six hours is an outage nobody reads the emails of.
  alerting        boolean not null default false,
  last_alerted_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.liveness_heartbeats is
  '#387: the ledger of things that DID happen, so the checker can alert on the ones that did not. Keys are declared in apps/api/src/observability/liveness.ts.';

drop trigger if exists set_updated_at on public.liveness_heartbeats;
create trigger set_updated_at
  before update on public.liveness_heartbeats
  for each row execute function moddatetime('updated_at');

-- ---------------------------------------------------------------------------
-- record_heartbeat — "this happened"
-- ---------------------------------------------------------------------------
-- Deliberately clears the alert state and reports whether it was alerting, so
-- the caller can send ONE recovery notice. A founder who was told the cron
-- stopped must be told when it starts again; otherwise the next alert is read
-- against an unknown baseline and the whole channel loses its meaning.
create or replace function public.record_heartbeat(p_key text, p_now timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $function$
declare
  v_was_alerting boolean := false;
begin
  -- Read the PRE-state first. `returning` on an upsert reports the row after
  -- the update, so it is always false here by construction — reading it there
  -- would silently mean a recovery notice is never sent, which is the same
  -- class of quiet nothing-happened bug this whole table exists to catch.
  select alerting into v_was_alerting
    from public.liveness_heartbeats where key = p_key;

  insert into public.liveness_heartbeats (key, last_seen_at)
  values (p_key, p_now)
  on conflict (key) do update
     set last_seen_at = greatest(public.liveness_heartbeats.last_seen_at, p_now),
         alerting = false;

  return jsonb_build_object('key', p_key, 'recovered', coalesce(v_was_alerting, false));
end;
$function$;

-- ---------------------------------------------------------------------------
-- api_liveness_check — one call: what is overdue, and what just came back
-- ---------------------------------------------------------------------------
-- Takes the declared expectations as a parameter rather than storing them,
-- because the declaration is a compile-time contract in the Worker and a copy
-- in this table would be a second source of truth that drifts. The table
-- records occurrences; the code declares expectations.
--
-- A key with NO ROW has never been seen. That is the state of every key on the
-- first deploy, and alerting on it would mean an alert storm the moment this
-- ships — which would teach the founder to ignore exactly the channel that
-- exists to be believed. So an unknown key is SEEDED at `p_now` and stays
-- quiet; it becomes alertable one cadence later, on its own merits.
create or replace function public.api_liveness_check(
  p_expectations jsonb,
  p_now          timestamptz default now(),
  p_realert_after_minutes int default 360
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $function$
declare
  v_row     jsonb;
  v_key     text;
  v_overdue jsonb := '[]'::jsonb;
  v_seeded  jsonb := '[]'::jsonb;
  v_hb      public.liveness_heartbeats%rowtype;
  v_deadline timestamptz;
begin
  for v_row in select * from jsonb_array_elements(p_expectations)
  loop
    v_key := v_row->>'key';

    select * into v_hb from public.liveness_heartbeats where key = v_key;

    if not found then
      insert into public.liveness_heartbeats (key, last_seen_at)
      values (v_key, p_now)
      on conflict (key) do nothing;
      v_seeded := v_seeded || to_jsonb(v_key);
      continue;
    end if;

    -- Overdue = the cadence it promised, plus the grace it was given. Grace is
    -- per-expectation because a once-a-minute sweeper and a once-a-day
    -- reconcile do not deserve the same patience.
    v_deadline := v_hb.last_seen_at
      + make_interval(mins => (v_row->>'every_minutes')::int)
      + make_interval(mins => (v_row->>'grace_minutes')::int);

    if p_now <= v_deadline then
      continue;
    end if;

    -- Already shouting and not yet time to shout again.
    if v_hb.alerting
       and v_hb.last_alerted_at is not null
       and v_hb.last_alerted_at > p_now - make_interval(mins => p_realert_after_minutes) then
      continue;
    end if;

    update public.liveness_heartbeats
       set alerting = true, last_alerted_at = p_now
     where key = v_key;

    v_overdue := v_overdue || jsonb_build_object(
      'key', v_key,
      'what', v_row->>'what',
      'last_seen_at', v_hb.last_seen_at,
      'due_by', v_deadline,
      'first_alert', not v_hb.alerting);
  end loop;

  return jsonb_build_object('overdue', v_overdue, 'seeded', v_seeded);
end;
$function$;

revoke execute on function public.record_heartbeat(text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_heartbeat(text, timestamptz)
  to service_role;
revoke execute on function public.api_liveness_check(jsonb, timestamptz, int)
  from public, anon, authenticated;
grant execute on function public.api_liveness_check(jsonb, timestamptz, int)
  to service_role;

alter table public.liveness_heartbeats enable row level security;
-- No policies: this is platform state, not tenant data. Reachable by
-- service_role only, exactly like the ledger tables around it.
