-- #151 native device push: FCM/APNs device tokens for the Android/iOS apps —
-- the native sibling of push_subscriptions (§6). Rows are per-USER (no company
-- column), exactly like Web Push subscriptions: the audience/prefs split
-- happens at send time (§8). `token` is the opaque FCM registration token the
-- device SDK hands the app (iOS delivery rides FCM's APNs bridge, so both
-- platforms store an FCM token); `platform` steers the message shape
-- (data-only Android message vs alert push with apns headers).
--
-- The API layer enforces the #30-style cap (at most 10 tokens per user,
-- oldest silently evicted on register — routes/device-push-tokens.ts) and
-- prunes rows FCM reports 404/UNREGISTERED, mirroring the Web Push 404/410
-- dead-subscription cleanup.
create table public.device_push_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  platform     text not null check (platform in ('android', 'ios')),
  token        text not null,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (user_id, token)
);

alter table public.device_push_tokens enable row level security;
-- Deny-by-default (20260701000300_rls.sql posture): anon/authenticated keep
-- zero grants, so RLS-with-no-policies exposes nothing over PostgREST. The
-- Worker's service_role reaches the table via the default privileges from
-- 20260701030000_service_role_grants.sql.
