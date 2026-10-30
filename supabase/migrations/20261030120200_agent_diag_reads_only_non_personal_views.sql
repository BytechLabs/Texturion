-- D142: production evidence an agent can read without reading a customer.
--
-- `ops_diag` is the slice of production's database that carries no personal
-- data, and `agent_diag` is a login that can read that slice and nothing else.
-- `scripts/ops/call-trace.mjs` is its reader.
--
-- WHAT A VIEW MAY CARRY. Timings, states, codes, versions, counts, and
-- identifiers that are either the provider's (a Telnyx call session or leg id)
-- or hashed. No number, name, body, address, payload, recording or transcript,
-- and no raw row id: every uuid is replaced by `ops_diag.ref()`, so nothing an
-- agent copies out of here can be joined back to a customer's row without
-- production access it does not have. agent_diag.test.sql enforces the column
-- rules on every view, including ones added later.
--
-- WHY SECURITY BARRIER. The views run with their owner's rights, which is how
-- agent_diag reads them with no grant on any table under them. A barrier
-- stops a function in the reader's own query from being evaluated against
-- rows a view's filter (the 35-day windows) excludes.
--
-- THE LOGIN HAS NO PASSWORD HERE. A migration is public; the password is set
-- once in production with `alter role agent_diag password ...` and kept with
-- the other read-tier credentials. Until then the role cannot log in at all.

create schema if not exists ops_diag;
revoke all on schema ops_diag from public;
comment on schema ops_diag is
  'D142: non-personal diagnostic views over production, readable by agent_diag.';

-- The workspace hash a repro issue carries instead of the id: the first 16 hex
-- characters of sha256 over the uuid's canonical text. call-trace.mjs computes
-- the same thing locally, and both are pinned to one vector in their tests.
create or replace function ops_diag.ref(p_id uuid)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select left(encode(pg_catalog.sha256(pg_catalog.convert_to(p_id::text, 'UTF8')), 'hex'), 16);
$$;

create view ops_diag.push_attempts with (security_barrier = true) as
select
  ops_diag.ref(pa.company_id) as company_ref,
  ops_diag.ref(pa.user_id)    as member_ref,
  ops_diag.ref(pa.target_id)  as channel_ref,
  pa.call_session_id,
  pa.purpose,
  pa.channel,
  pa.platform,
  pa.priority,
  pa.response_class,
  pa.http_status,
  pa.latency_ms,
  pa.attempted_at
from public.push_attempts pa;

create view ops_diag.ring_beacons with (security_barrier = true) as
select
  ops_diag.ref(b.company_id)      as company_ref,
  ops_diag.ref(b.user_id)         as member_ref,
  ops_diag.ref(b.auth_session_id) as session_ref,
  b.call_session_id,
  b.platform,
  b.stage,
  b.occurred_at,
  b.created_at as recorded_at,
  b.app_version,
  b.os,
  b.permissions,
  b.standby_bucket,
  b.power_save,
  b.device_idle,
  b.screen_locked
from public.ring_beacons b;

-- The call itself, without who called. `customer_call_control_id` is Telnyx's
-- id for the caller's leg, which is what the guard's diag class reads events
-- by (with numbers already cut to their last four digits there).
create view ops_diag.call_sessions with (security_barrier = true) as
select
  ops_diag.ref(c.company_id)         as company_ref,
  ops_diag.ref(c.phone_number_id)    as number_ref,
  ops_diag.ref(c.answered_by_user_id) as answered_by_ref,
  c.call_session_id,
  c.customer_call_control_id,
  c.direction,
  c.state,
  c.outcome,
  c.unattended,
  c.stir_attestation,
  c.started_at,
  c.answered_at,
  c.ended_at,
  c.forward_seconds,
  c.voicemail_seconds
from public.calls c
where c.started_at >= now() - interval '35 days';

create view ops_diag.call_legs with (security_barrier = true) as
select
  ops_diag.ref(l.company_id) as company_ref,
  ops_diag.ref(l.user_id)    as member_ref,
  l.call_session_id,
  l.call_control_id,
  l.kind,
  l.state,
  l.created_at
from public.call_member_legs l
where l.created_at >= now() - interval '35 days';

-- Fleet-wide, so the guard can find production's six quietest hours. No
-- workspace dimension: the question is about the account Telnyx sees.
create view ops_diag.hourly_call_counts with (security_barrier = true) as
select
  date_trunc('hour', c.started_at) as hour,
  c.direction,
  count(*)::int                                        as calls,
  count(*) filter (where c.outcome = 'answered')::int  as answered,
  count(*) filter (where c.outcome = 'voicemail')::int as voicemail,
  count(*) filter (where c.outcome = 'missed')::int    as missed
from public.calls c
where c.started_at >= now() - interval '35 days'
group by 1, 2;

-- How many legs one inbound call on each active number can open at once, for
-- the guard's production reserve (largest ring audience plus one).
--
-- `ring_legs_ceiling` asks the ring path's own number-level resolver, then
-- counts members holding a calling credential. The call engine also drops
-- members whose role cannot take a call, so this can only overcount: the safe
-- direction for a reserve. `peak_legs_28d` is the observed maximum.
--
-- A security-definer function rather than a view over the resolver: a view
-- calls functions with the READER's rights, and the resolver is service-role
-- only. It returns only counts and hashes.
create or replace function ops_diag.ring_audience_sizes_now()
returns table (
  company_ref       text,
  number_ref        text,
  ring_legs_ceiling int,
  peak_legs_28d     int
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    ops_diag.ref(pn.company_id),
    ops_diag.ref(pn.id),
    (select count(*)::int
       from public.number_member_levels(pn.id) lvl
       join public.member_telephony_credentials mtc
         on mtc.company_id = pn.company_id and mtc.user_id = lvl.user_id
      where lvl.level = 'text'),
    coalesce((
      select max(per_call.legs)::int
        from (select count(*) as legs
                from public.call_member_legs l
                join public.calls c on c.call_session_id = l.call_session_id
               where c.phone_number_id = pn.id
                 and l.kind = 'ring'
                 and l.created_at >= now() - interval '28 days'
               group by l.call_session_id) per_call
    ), 0)
  from public.phone_numbers pn
  where pn.status = 'active';
$$;

create view ops_diag.ring_audience_sizes with (security_barrier = true) as
select * from ops_diag.ring_audience_sizes_now();

-- Nothing here is for a browser. The schema grants no client USAGE either, so
-- this is the second lock rather than the only one.
revoke all on all tables in schema ops_diag from public, anon, authenticated;
revoke execute on function ops_diag.ref(uuid) from public, anon, authenticated;
revoke execute on function ops_diag.ring_audience_sizes_now()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The login. Created only if absent: roles belong to the cluster, so a local
-- `supabase db reset` finds the previous run's role still there.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'agent_diag') then
    create role agent_diag with
      login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls
      connection limit 3;
  end if;
end $$;

-- Defaults for an honest client, not controls: any session may change them.
-- The controls are the absent write grants and the connection limit of 3.
-- These keep call-trace.mjs well behaved and make a forgotten psql session
-- give its snapshot back.
alter role agent_diag set default_transaction_read_only = on;
alter role agent_diag set statement_timeout = '15s';
alter role agent_diag set idle_in_transaction_session_timeout = '30s';
alter role agent_diag set search_path = ops_diag;

grant usage on schema ops_diag to agent_diag;
grant select on all tables in schema ops_diag to agent_diag;
grant execute on function ops_diag.ref(uuid) to agent_diag;
grant execute on function ops_diag.ring_audience_sizes_now() to agent_diag;
