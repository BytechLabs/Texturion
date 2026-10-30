-- D142: what happened to one push, and to one ring on the device that got it.
--
-- "A customer's phone didn't ring" splits four ways: no push was sent, the
-- provider accepted it and it never arrived, it arrived and no ring was shown,
-- or it rang and answering failed. These two tables tell them apart.
--
--   push_attempts  one row per push sent; written by the push send paths
--                  (apps/api/src/notifications/push-attempts.ts).
--   ring_beacons   one row per ring stage a device reached; written by
--                  POST /v1/ring-beacons (apps/api/src/routes/ring-beacons.ts).
--
-- NOTHING PERSONAL, BY CONSTRUCTION. No number, name, body, endpoint or device
-- token: identifiers are the member, the call session and the opaque row id
-- of the push channel. Every free-text column is held to a fixed vocabulary
-- or a fixed shape by a CHECK. The call session id, the one the client names,
-- is held to identifier characters, which refuses the shapes personal data
-- takes by accident (a number with its plus, bare digits, an email, a name
-- with spaces). It cannot refuse what a hostile member writes on purpose into
-- their own evidence.
--
-- FOURTEEN DAYS. Diagnostics for a ring that went missing this week, not a
-- history. Each insert sweeps whatever has aged out (bounded), so the window
-- holds without a cron to forget.
--
-- ERASED WITH THE PERSON. Both cascade from `company_members`, so a workspace
-- purge (which deletes that table) takes the evidence with it. Account deletion
-- keeps the membership row, so `delete_account` erases a member's own rows
-- (20261030120300).

create table public.push_attempts (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null,
  user_id         uuid not null,
  call_session_id text
    constraint push_attempts_call_session_shape
    check (call_session_id is null
           or (length(call_session_id) between 1 and 128
               and call_session_id ~ '^[A-Za-z0-9:_.-]+$'
               and call_session_id !~ '^[0-9]+$')),
  purpose         text not null
    constraint push_attempts_purpose check (purpose in ('ring', 'call_end', 'alert')),
  channel         text not null
    constraint push_attempts_channel check (channel in ('webpush', 'fcm')),
  platform        text not null
    constraint push_attempts_platform check (platform in ('web', 'android', 'ios')),
  priority        text not null
    constraint push_attempts_priority check (priority in ('high', 'normal')),
  -- The provider's error text is deliberately not kept: a rejection can quote
  -- the payload back.
  response_class  text not null
    constraint push_attempts_response_class check (response_class in (
      'accepted', 'gone', 'unauthorized', 'rejected', 'throttled',
      'provider_error', 'transport_error')),
  http_status     smallint
    constraint push_attempts_http_status check (http_status is null or http_status between 100 and 599),
  latency_ms      int not null
    constraint push_attempts_latency check (latency_ms between 0 and 600000),
  -- The push_subscriptions or device_push_tokens row it went to. No foreign
  -- key: a gone channel is deleted in the same fan-out that records it.
  target_id       uuid,
  attempted_at    timestamptz not null default now(),
  constraint push_attempts_member_fk foreign key (company_id, user_id)
    references public.company_members (company_id, user_id) on delete cascade,
  constraint push_attempts_channel_platform check (
    (channel = 'webpush') = (platform = 'web'))
);

comment on table public.push_attempts is
  'D142: one row per push sent, with the provider''s response class, priority '
  'and latency. Nothing personal. Kept 14 days; erased with the membership.';

create index push_attempts_company_recency
  on public.push_attempts (company_id, attempted_at desc);
create index push_attempts_member
  on public.push_attempts (company_id, user_id);
create index push_attempts_session
  on public.push_attempts (call_session_id) where call_session_id is not null;
create index push_attempts_age on public.push_attempts (attempted_at);

alter table public.push_attempts enable row level security;
revoke all on public.push_attempts from anon, authenticated;

-- The vocabularies below are the route's (RING_BEACON_* in
-- apps/api/src/routes/ring-beacons.ts); push-evidence-schema.test.ts fails when
-- the two disagree.
create or replace function public.ring_beacon_permissions_ok(p_permissions jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_permissions) = 'object'
     and not exists (
       select 1
         from jsonb_each(p_permissions) e
        where e.key not in ('notifications', 'microphone', 'full_screen_intent',
                            'battery_unrestricted')
           or jsonb_typeof(e.value) is distinct from 'string'
           or (e.value #>> '{}') not in ('granted', 'denied', 'prompt', 'unknown')
     );
$$;

revoke execute on function public.ring_beacon_permissions_ok(jsonb)
  from public, anon, authenticated;
grant execute on function public.ring_beacon_permissions_ok(jsonb) to service_role;

create table public.ring_beacons (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null,
  user_id         uuid not null,
  -- The GoTrue session that posted it: which of the member's devices, without
  -- naming the device. No foreign key, because sessions are revoked and swept.
  auth_session_id uuid,
  call_session_id text not null
    constraint ring_beacons_call_session_shape
    check (length(call_session_id) between 1 and 128
           and call_session_id ~ '^[A-Za-z0-9:_.-]+$'
           -- Session ids carry a colon or a hyphen; all digits is a phone
           -- number in the wrong field.
           and call_session_id !~ '^[0-9]+$'),
  platform        text not null
    constraint ring_beacons_platform check (platform in ('web', 'android', 'ios')),
  stage           text not null
    constraint ring_beacons_stage check (stage in (
      'push_received', 'os_reported', 'ring_me_sent', 'ringing_shown',
      'answered', 'declined')),
  -- The device's clock, kept only when the route found it believable.
  occurred_at     timestamptz,
  app_version     text
    constraint ring_beacons_app_version check (
      app_version is null or app_version ~ '^[0-9]{1,4}(\.[0-9]{1,4}){0,3}$'),
  -- What each client sends and nothing else: an Android SDK level, an iOS
  -- version of at most six digits, or a browser's coarse platform. A phone
  -- number with its plus stripped fits none of them.
  os              text
    constraint ring_beacons_os check (
      os is null or os ~ '^(android-[0-9]{1,3}|ios-[0-9]{1,2}(\.[0-9]{1,2}){0,2}|web(-(android|chrome-os|chromium-os|fuchsia|ios|linux|macos|unknown|windows))?)$'),
  permissions     jsonb not null default '{}'::jsonb
    constraint ring_beacons_permissions check (public.ring_beacon_permissions_ok(permissions)),
  standby_bucket  text
    constraint ring_beacons_standby_bucket check (standby_bucket is null or standby_bucket in (
      'exempted', 'active', 'working_set', 'frequent', 'rare', 'restricted', 'unknown')),
  power_save      boolean,
  device_idle     boolean,
  screen_locked   boolean,
  created_at      timestamptz not null default now(),
  constraint ring_beacons_member_fk foreign key (company_id, user_id)
    references public.company_members (company_id, user_id) on delete cascade
);

comment on table public.ring_beacons is
  'D142: one row per stage a member''s device reached for a ring, with app, OS, '
  'permission and standby state. Nothing personal. Kept 14 days; erased with '
  'the membership.';

-- The route's per-member daily cap counts on exactly this prefix.
create index ring_beacons_member_recency
  on public.ring_beacons (company_id, user_id, created_at desc);
create index ring_beacons_session on public.ring_beacons (call_session_id);
create index ring_beacons_age on public.ring_beacons (created_at);

alter table public.ring_beacons enable row level security;
revoke all on public.ring_beacons from anon, authenticated;

-- 500 a statement, so no insert carries a large delete and the sweep still
-- outpaces the write rate. SKIP LOCKED so two concurrent sweeps never queue on
-- each other: the writer is a push fan-out that must not wait on housekeeping.
create or replace function public.prune_push_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'push_attempts' then
    delete from public.push_attempts
     where id in (
       select id from public.push_attempts
        where attempted_at < now() - interval '14 days'
        order by attempted_at
        limit 500
        for update skip locked);
  elsif tg_table_name = 'ring_beacons' then
    delete from public.ring_beacons
     where id in (
       select id from public.ring_beacons
        where created_at < now() - interval '14 days'
        order by created_at
        limit 500
        for update skip locked);
  end if;
  return null;
end $$;

revoke execute on function public.prune_push_evidence()
  from public, anon, authenticated;

create trigger push_attempts_retention
  after insert on public.push_attempts
  for each statement execute function public.prune_push_evidence();

create trigger ring_beacons_retention
  after insert on public.ring_beacons
  for each statement execute function public.prune_push_evidence();
