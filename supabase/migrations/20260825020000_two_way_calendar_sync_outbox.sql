-- #245 / D137 -- the durable, provider-neutral half of two-way calendar sync.
--
-- This migration deliberately stops at tasks which already have a provider
-- mapping.  A random event in somebody's calendar is not a Loonext task, and
-- no database trigger may manufacture one.  What is made structural here is:
--
-- * one recoverable Google OR Microsoft connection per member/workspace;
-- * encrypted bearer credentials (ciphertext + IV + key version, never a
--   refresh token in plaintext);
-- * one-use OAuth state and renewable webhook-subscription records;
-- * a per-(task, calendar) three-way-diff base and exact last-sent snapshot;
-- * an outbox written in the task transaction, with one live action and a
--   non-overlapping claim lease; and
-- * provider application under a transaction-local echo-suppression flag.
--
-- Provider timestamps are intentionally absent from every decision below.
-- D137 rejects "last write wins": a provider's timestamp says when its server
-- received a change, not when a person decided it.

-- ---------------------------------------------------------------------------
-- Canonical scheduling snapshots.
--
-- These keys are the exact CalendarScheduleSnapshot wire contract used by the
-- provider boundary.  Timestamps are normalized by Postgres before comparison,
-- and descriptions participate by SHA-256 only: provider descriptions can
-- contain customer details, but conflict detection needs equality, not a
-- second plaintext copy.
-- ---------------------------------------------------------------------------
create or replace function public.calendar_normalize_text(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(
    replace(normalize(coalesce(p_value, ''), NFC), E'\r\n', E'\n'),
    E'\r', E'\n'
  )
$$;

create or replace function public.calendar_snapshot_is_canonical(p_snapshot jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_snapshot is not null
     and jsonb_typeof(p_snapshot) = 'object'
     and p_snapshot ?& array['start', 'end', 'timeZone', 'title', 'descriptionHash']
     and jsonb_typeof(p_snapshot->'start') = 'string'
     and jsonb_typeof(p_snapshot->'end') = 'string'
     and jsonb_typeof(p_snapshot->'timeZone') = 'string'
     and jsonb_typeof(p_snapshot->'title') = 'string'
     and jsonb_typeof(p_snapshot->'descriptionHash') = 'string'
     and length(p_snapshot->>'timeZone') between 1 and 100
     and length(p_snapshot->>'title') between 1 and 500
     and p_snapshot->>'title' = public.calendar_normalize_text(p_snapshot->>'title')
     and (p_snapshot->>'descriptionHash') ~ '^[0-9a-f]{64}$'
     and (p_snapshot->>'end')::timestamptz > (p_snapshot->>'start')::timestamptz
$$;

create or replace function public.calendar_snapshot_from_fields(
  p_start_at    timestamptz,
  p_end_at      timestamptz,
  p_time_zone   text,
  p_title       text,
  p_description text
) returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_start_at is null or p_end_at is null or p_end_at <= p_start_at then
    raise exception 'calendar snapshot requires an end after its start';
  end if;
  if nullif(btrim(p_time_zone), '') is null then
    raise exception 'calendar snapshot requires an IANA time zone';
  end if;
  if nullif(btrim(public.calendar_normalize_text(p_title)), '') is null
     or length(public.calendar_normalize_text(p_title)) > 500 then
    raise exception 'calendar snapshot title must contain 1..500 characters';
  end if;

  return jsonb_build_object(
    'start', to_jsonb(p_start_at),
    'end', to_jsonb(p_end_at),
    'timeZone', p_time_zone,
    'title', public.calendar_normalize_text(p_title),
    'descriptionHash', encode(
      extensions.digest(
        convert_to(public.calendar_normalize_text(p_description), 'UTF8'),
        'sha256'
      ),
      'hex'
    )
  );
end $$;

create or replace function public.calendar_normalize_snapshot(p_snapshot jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
begin
  if not public.calendar_snapshot_is_canonical(p_snapshot) then
    raise exception 'calendar snapshot is not canonical';
  end if;
  return jsonb_build_object(
    'start', to_jsonb((p_snapshot->>'start')::timestamptz),
    'end', to_jsonb((p_snapshot->>'end')::timestamptz),
    'timeZone', p_snapshot->>'timeZone',
    'title', p_snapshot->>'title',
    'descriptionHash', lower(p_snapshot->>'descriptionHash')
  );
end $$;

-- Rebuild the provider shape from the CURRENT task at worker-decision time.
-- A task stores an instant but not a duration, so the last agreed snapshot is
-- the duration source.  Moving a one-hour job moves its end by the same amount
-- rather than leaving the old end behind.
create or replace function public.calendar_task_snapshot(
  p_due_at            timestamptz,
  p_title             text,
  p_description       text,
  p_reference         jsonb,
  p_fallback_timezone text
) returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_reference jsonb;
  v_duration  interval := interval '1 hour';
  v_zone      text;
begin
  if p_due_at is null then
    return null;
  end if;
  if p_reference is not null then
    v_reference := public.calendar_normalize_snapshot(p_reference);
    v_duration := (v_reference->>'end')::timestamptz
                - (v_reference->>'start')::timestamptz;
  end if;
  v_zone := coalesce(v_reference->>'timeZone', p_fallback_timezone);
  return public.calendar_snapshot_from_fields(
    p_due_at, p_due_at + v_duration, v_zone, p_title, p_description
  );
end $$;

revoke execute on function public.calendar_normalize_text(text)
  from public, anon, authenticated;
revoke execute on function public.calendar_snapshot_is_canonical(jsonb)
  from public, anon, authenticated;
revoke execute on function public.calendar_snapshot_from_fields(
  timestamptz, timestamptz, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.calendar_normalize_snapshot(jsonb)
  from public, anon, authenticated;
revoke execute on function public.calendar_task_snapshot(
  timestamptz, text, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.calendar_normalize_text(text)
  to service_role;
grant execute on function public.calendar_snapshot_is_canonical(jsonb)
  to service_role;
grant execute on function public.calendar_snapshot_from_fields(
  timestamptz, timestamptz, text, text, text)
  to service_role;
grant execute on function public.calendar_normalize_snapshot(jsonb)
  to service_role;
grant execute on function public.calendar_task_snapshot(
  timestamptz, text, text, jsonb, text)
  to service_role;

-- Display-only evidence of a human schedule change.  These values never decide
-- a conflict.  The provider-apply path preserves them deliberately.
alter table public.tasks
  add column if not exists schedule_changed_at timestamptz;
alter table public.tasks
  add column if not exists schedule_changed_by uuid
    references auth.users(id) on delete set null;

-- Content-free evidence carried to the existing purge-receipt email path when
-- the retention deadline forces local erasure before provider cleanup can be
-- confirmed.  The purge worker can include this boolean/count in the final
-- external receipt even though every member session/push token is already gone.
alter table public.companies
  add column if not exists calendar_cleanup_unconfirmed_at timestamptz;
alter table public.companies
  add column if not exists calendar_cleanup_unconfirmed_count integer
    not null default 0 check (calendar_cleanup_unconfirmed_count >= 0);

comment on column public.companies.calendar_cleanup_unconfirmed_at is
  '#245/D137: content-free evidence that provider calendar cleanup could not be confirmed before local erasure; included in the purge receipt.';
comment on column public.companies.calendar_cleanup_unconfirmed_count is
  '#245/D137: number of calendar connections whose remote cleanup remained unconfirmed at terminal abandonment.';

comment on column public.tasks.schedule_changed_at is
  '#245/D137: when a non-provider due_at write happened; display only, never conflict authority.';
comment on column public.tasks.schedule_changed_by is
  '#245/D137: actor for a human due_at write when known; provider apply preserves it.';

-- Composite task identity lets every child FK prove that its company_id and
-- task_id describe the same tenant, not merely two independently valid rows.
create unique index if not exists tasks_company_id_id_uq
  on public.tasks (company_id, id);

create table public.calendar_connections (
  id                         uuid primary key default gen_random_uuid(),
  company_id                 uuid not null references public.companies(id) on delete cascade,
  user_id                    uuid not null,
  provider                   text not null check (provider in ('google', 'microsoft')),
  provider_account_id        text not null check (length(provider_account_id) between 1 and 500),
  provider_account_label     text check (provider_account_label is null or length(provider_account_label) <= 500),
  selected_calendar_id       text not null check (length(selected_calendar_id) between 1 and 1000),
  selected_calendar_name     text check (selected_calendar_name is null or length(selected_calendar_name) <= 500),
  selected_calendar_timezone text not null check (length(selected_calendar_timezone) between 1 and 100),

  -- AES-GCM values are base64url strings produced by the Worker.  Revocation
  -- wipes them; a disabled/error connection keeps them so it can recover.
  credential_ciphertext      text,
  credential_iv              text,
  credential_key_version     text,
  credential_generation      bigint not null default 1
    check (credential_generation >= 1),
  credential_refresh_lease_owner text,
  credential_refresh_lease_expires_at timestamptz,
  disconnect_cleanup_action  text
    check (disconnect_cleanup_action is null
      or disconnect_cleanup_action in ('unlink', 'scrub')),
  remote_cleanup_unconfirmed boolean not null default false,

  status                     text not null default 'active'
    check (status in ('active', 'reauth_required', 'disconnected', 'revoked')),
  sync_cursor                text,
  cursor_updated_at          timestamptz,
  -- Webhook notifications coalesce into one durable pull.  Generation keeps a
  -- notification arriving DURING a pull from being cleared by that stale pull.
  sync_due_at                timestamptz,
  -- Delta cursors are scoped to their initial window.  A weekly full-window
  -- reseed slides that window forward instead of freezing it forever.
  last_full_sync_at          timestamptz,
  full_sync_due_at           timestamptz not null default now(),
  pull_full_sync             boolean not null default false,
  pull_followup_requested    boolean not null default false,
  pull_generation            bigint not null default 0 check (pull_generation >= 0),
  pull_lease_owner           text,
  pull_lease_expires_at      timestamptz,
  last_verified_at           timestamptz,
  last_sync_started_at       timestamptz,
  last_sync_completed_at     timestamptz,
  last_error_code            text check (last_error_code is null or length(last_error_code) <= 100),
  last_error_detail          text check (last_error_detail is null or length(last_error_detail) <= 1000),
  last_error_at              timestamptz,
  -- Privacy-safe operational evidence for D137 rule 5.  This counts only a
  -- transition into a real three-way conflict; it stores no task/event data.
  conflict_window_started_at timestamptz,
  conflict_window_count      integer not null default 0
    check (conflict_window_count >= 0),
  last_conflict_at           timestamptz,
  -- Exact rolling evidence.  Keeping only timestamps (no task/link identity)
  -- lets operations evaluate the previous 168 hours across arbitrary window
  -- boundaries.  The array is pruned on every new conflict and bounded.
  conflict_occurrences_at    timestamptz[] not null default '{}'::timestamptz[],
  -- One content-free, one-time owner disclosure per unhealthy episode.
  owner_disclosure_reason    text
    check (owner_disclosure_reason is null
      or owner_disclosure_reason in (
        'reauth_required', 'sync_stale', 'cleanup_failed'
      )),
  owner_disclosure_generation bigint not null default 0
    check (owner_disclosure_generation >= 0),
  owner_disclosure_sent_generation bigint not null default 0
    check (owner_disclosure_sent_generation >= 0
      and owner_disclosure_sent_generation <= owner_disclosure_generation),
  owner_disclosure_sent_at timestamptz,
  owner_disclosure_started_at timestamptz,
  owner_disclosure_available_at timestamptz,
  owner_disclosure_attempts integer not null default 0
    check (owner_disclosure_attempts >= 0),
  owner_disclosure_lease_owner text,
  owner_disclosure_lease_expires_at timestamptz,
  owner_disclosure_last_error_code text
    check (owner_disclosure_last_error_code is null
      or length(owner_disclosure_last_error_code) <= 100),
  owner_disclosure_last_error_detail text
    check (owner_disclosure_last_error_detail is null
      or length(owner_disclosure_last_error_detail) <= 1000),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  revoked_at                 timestamptz,

  foreign key (company_id, user_id)
    references public.company_members(company_id, user_id) on delete cascade,
  unique (company_id, id),
  constraint calendar_connections_live_shape_ck check (
    (
      revoked_at is null
      and status <> 'revoked'
      and credential_ciphertext is not null
      and credential_iv is not null
      and credential_key_version is not null
      and credential_ciphertext ~ '^[A-Za-z0-9_-]+$'
      and credential_iv ~ '^[A-Za-z0-9_-]{16}$'
      and length(credential_key_version) between 1 and 100
    )
    or (
      revoked_at is not null
      and status = 'revoked'
      and credential_ciphertext is null
      and credential_iv is null
      and credential_key_version is null
      and credential_refresh_lease_owner is null
      and credential_refresh_lease_expires_at is null
      and disconnect_cleanup_action is null
    )
  ),
  constraint calendar_connections_sync_clock_ck check (
    last_sync_completed_at is null
    or last_sync_started_at is null
    or last_sync_completed_at >= last_sync_started_at
  ),
  constraint calendar_connections_pull_lease_ck check (
    (pull_lease_owner is null) = (pull_lease_expires_at is null)
    and (not pull_full_sync or pull_lease_owner is not null)
  ),
  constraint calendar_connections_credential_refresh_lease_ck check (
    (credential_refresh_lease_owner is null)
      = (credential_refresh_lease_expires_at is null)
    and (
      credential_refresh_lease_owner is null
      or length(btrim(credential_refresh_lease_owner)) between 1 and 200
    )
  ),
  constraint calendar_connections_conflict_counter_ck check (
    cardinality(conflict_occurrences_at) <= 1000
    and conflict_window_count = cardinality(conflict_occurrences_at)
    and (
      (conflict_window_count = 0 and conflict_window_started_at is null
       and last_conflict_at is null)
      or (conflict_window_count > 0 and conflict_window_started_at is not null
        and last_conflict_at is not null
        and last_conflict_at >= conflict_window_started_at)
    )
  ),
  constraint calendar_connections_owner_disclosure_ck check (
    (owner_disclosure_lease_owner is null)
      = (owner_disclosure_lease_expires_at is null)
    and (
      owner_disclosure_reason is not null
      or (
        owner_disclosure_available_at is null
        and owner_disclosure_lease_owner is null
      )
    )
  )
);

-- A disabled/error connection remains the live connection: it can be repaired.
-- Reconnecting replaces it atomically through the completion RPC below.
create unique index calendar_connections_one_live_member_uq
  on public.calendar_connections (company_id, user_id)
  where revoked_at is null;
create index calendar_connections_sync_idx
  on public.calendar_connections (
    status, sync_due_at, full_sync_due_at, last_verified_at
  )
  where revoked_at is null;
create index calendar_connections_owner_disclosure_claim_idx
  on public.calendar_connections (owner_disclosure_available_at, id)
  where owner_disclosure_reason is not null;
create trigger set_updated_at before update on public.calendar_connections
  for each row execute function extensions.moddatetime(updated_at);

create or replace function public.calendar_connection_disclosure_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.remote_cleanup_unconfirmed
     and not old.remote_cleanup_unconfirmed then
    new.owner_disclosure_reason := 'cleanup_failed';
    new.owner_disclosure_generation := old.owner_disclosure_generation + 1;
    new.owner_disclosure_available_at := now();
    new.owner_disclosure_started_at := now();
    new.owner_disclosure_attempts := 0;
    new.owner_disclosure_sent_at := null;
    new.owner_disclosure_lease_owner := null;
    new.owner_disclosure_lease_expires_at := null;
    new.owner_disclosure_last_error_code := null;
    new.owner_disclosure_last_error_detail := null;
  elsif new.status = 'reauth_required'
     and old.status is distinct from 'reauth_required' then
    new.owner_disclosure_reason := 'reauth_required';
    new.owner_disclosure_generation := old.owner_disclosure_generation + 1;
    new.owner_disclosure_available_at := now();
    new.owner_disclosure_started_at := now();
    new.owner_disclosure_attempts := 0;
    new.owner_disclosure_sent_at := null;
    new.owner_disclosure_lease_owner := null;
    new.owner_disclosure_lease_expires_at := null;
    new.owner_disclosure_last_error_code := null;
    new.owner_disclosure_last_error_detail := null;
  elsif new.status = 'revoked'
        and new.last_error_code = 'cleanup_abandoned_invalid_grant' then
    new.owner_disclosure_reason := 'cleanup_failed';
    new.owner_disclosure_generation := old.owner_disclosure_generation + 1;
    new.owner_disclosure_available_at := now();
    new.owner_disclosure_started_at := now();
    new.owner_disclosure_attempts := 0;
    new.owner_disclosure_sent_at := null;
    new.owner_disclosure_lease_owner := null;
    new.owner_disclosure_lease_expires_at := null;
    new.owner_disclosure_last_error_code := null;
    new.owner_disclosure_last_error_detail := null;
  elsif new.status in ('active', 'disconnected', 'revoked')
        and not new.remote_cleanup_unconfirmed
        and old.status is distinct from new.status then
    new.owner_disclosure_reason := null;
    new.owner_disclosure_available_at := null;
    new.owner_disclosure_lease_owner := null;
    new.owner_disclosure_lease_expires_at := null;
  end if;
  return new;
end $$;

create trigger calendar_connection_disclosure_transition
before update of status, remote_cleanup_unconfirmed on public.calendar_connections
for each row execute function public.calendar_connection_disclosure_transition();

revoke execute on function public.calendar_connection_disclosure_transition()
  from public, anon, authenticated;

create or replace function public.calendar_record_connection_conflict(
  p_connection_id uuid
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_occurrences timestamptz[];
  v_count integer;
begin
  select coalesce(array_agg(observed_at order by observed_at), '{}'::timestamptz[])
    into v_occurrences
    from unnest(coalesce((
      select conflict_occurrences_at
        from public.calendar_connections
       where id = p_connection_id
       for update
    ), '{}'::timestamptz[])) observed_at
   where observed_at > v_now - interval '7 days';
  v_occurrences := v_occurrences || v_now;
  -- The alert threshold is >1.  A pathological tenant cannot turn operational
  -- evidence into an unbounded row; 1000 still preserves useful magnitude.
  if cardinality(v_occurrences) > 1000 then
    v_occurrences := v_occurrences[
      cardinality(v_occurrences) - 999 : cardinality(v_occurrences)
    ];
  end if;
  update public.calendar_connections
     set conflict_occurrences_at = v_occurrences,
         conflict_window_started_at = v_occurrences[1],
         conflict_window_count = cardinality(v_occurrences),
         last_conflict_at = v_occurrences[cardinality(v_occurrences)]
   where id = p_connection_id
  returning conflict_window_count into v_count;
  return v_count;
end $$;

revoke execute on function public.calendar_record_connection_conflict(uuid)
  from public, anon, authenticated;
grant execute on function public.calendar_record_connection_conflict(uuid)
  to service_role;

create table public.oauth_states (
  id                       uuid primary key default gen_random_uuid(),
  company_id               uuid not null references public.companies(id) on delete cascade,
  user_id                  uuid not null,
  provider                 text not null check (provider in ('google', 'microsoft')),
  state_hash               text not null unique check (state_hash ~ '^[0-9a-f]{64}$'),
  verifier_ciphertext      text not null check (verifier_ciphertext ~ '^[A-Za-z0-9_-]+$'),
  verifier_iv              text not null check (verifier_iv ~ '^[A-Za-z0-9_-]{16}$'),
  verifier_key_version     text not null check (length(verifier_key_version) between 1 and 100),
  redirect_uri             text not null check (length(redirect_uri) between 1 and 2000),
  return_to                text check (return_to is null or length(return_to) <= 2000),
  created_at               timestamptz not null default now(),
  expires_at               timestamptz not null,
  consumed_at              timestamptz,
  foreign key (company_id, user_id)
    references public.company_members(company_id, user_id) on delete cascade,
  constraint oauth_states_expiry_ck check (expires_at > created_at),
  constraint oauth_states_consumed_ck check (consumed_at is null or consumed_at >= created_at)
);

create unique index oauth_states_one_pending_flow_uq
  on public.oauth_states (company_id, user_id, provider)
  where consumed_at is null;
create index oauth_states_hash_live_idx
  on public.oauth_states (state_hash)
  where consumed_at is null;

create table public.webhook_subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  company_id               uuid not null references public.companies(id) on delete cascade,
  connection_id            uuid not null,
  provider_subscription_id text not null
    check (length(provider_subscription_id) between 1 and 1000),
  provider_resource_id     text check (provider_resource_id is null or length(provider_resource_id) <= 2000),
  provider_calendar_id     text not null check (length(provider_calendar_id) between 1 and 1000),
  client_state_hash        text check (client_state_hash is null or client_state_hash ~ '^[0-9a-f]{64}$'),
  status                   text not null default 'active'
    check (status in ('active', 'renewing', 'error', 'expired', 'revoking', 'revoked')),
  expires_at               timestamptz not null,
  last_notification_at     timestamptz,
  last_renewed_at          timestamptz,
  last_error_code          text check (last_error_code is null or length(last_error_code) <= 100),
  last_error_detail        text check (last_error_detail is null or length(last_error_detail) <= 1000),
  renewal_generation       bigint not null default 1 check (renewal_generation > 0),
  renewal_attempts         integer not null default 0 check (renewal_attempts >= 0),
  renewal_available_at     timestamptz not null default now(),
  renewal_lease_owner      text,
  renewal_lease_expires_at timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  revoked_at               timestamptz,
  foreign key (company_id, connection_id)
    references public.calendar_connections(company_id, id) on delete cascade,
  unique (company_id, id),
  constraint webhook_subscriptions_revoked_shape_ck check (
    (revoked_at is null and status <> 'revoked')
    or (revoked_at is not null and status = 'revoked')
  ),
  constraint webhook_subscriptions_renewal_lease_shape_ck check (
    (renewal_lease_owner is null) = (renewal_lease_expires_at is null)
  )
);

create unique index webhook_subscriptions_provider_live_uq
  on public.webhook_subscriptions (provider_subscription_id)
  where revoked_at is null;
create unique index webhook_subscriptions_one_live_connection_uq
  on public.webhook_subscriptions (connection_id)
  -- A serving watch and one or more durable stopWatch intents may coexist
  -- during in-place reauthorization.  Revoking rows are no longer serving.
  where revoked_at is null and status <> 'revoking';
create index webhook_subscriptions_renew_idx
  on public.webhook_subscriptions (renewal_available_at, expires_at)
  where revoked_at is null and status = 'active';
create index webhook_subscriptions_revoke_idx
  on public.webhook_subscriptions (renewal_available_at, id)
  where revoked_at is null and status = 'revoking';
create trigger set_updated_at before update on public.webhook_subscriptions
  for each row execute function extensions.moddatetime(updated_at);

create table public.task_calendar_links (
  id                         uuid primary key default gen_random_uuid(),
  company_id                 uuid not null references public.companies(id) on delete cascade,
  connection_id              uuid not null,
  task_id                    uuid not null,

  -- event_id is the provider resource id; instance_id is the occurrence id
  -- used for every read/write.  A series/master id is context only and can
  -- never be substituted for instance_id.
  provider_event_id          text not null check (length(provider_event_id) between 1 and 1000),
  provider_instance_id       text not null check (length(provider_instance_id) between 1 and 1000),
  provider_series_id         text check (provider_series_id is null or length(provider_series_id) between 1 and 1000),
  provider_version           text,

  link_state                 text not null default 'active'
    check (link_state in ('active', 'conflict', 'event_removed', 'refused', 'unlinked')),
  base_snapshot              jsonb not null
    check (public.calendar_snapshot_is_canonical(base_snapshot)),
  last_sent_snapshot         jsonb
    check (last_sent_snapshot is null or public.calendar_snapshot_is_canonical(last_sent_snapshot)),
  last_sent_provider_version text,
  last_sent_at               timestamptz,
  conflict_ours_snapshot     jsonb
    check (conflict_ours_snapshot is null or public.calendar_snapshot_is_canonical(conflict_ours_snapshot)),
  conflict_theirs_snapshot   jsonb
    check (conflict_theirs_snapshot is null or public.calendar_snapshot_is_canonical(conflict_theirs_snapshot)),
  conflict_detected_at       timestamptz,
  event_removed_at           timestamptz,
  refusal_code               text check (refusal_code is null or length(refusal_code) <= 100),
  refusal_detail             text check (refusal_detail is null or length(refusal_detail) <= 1000),
  refused_at                 timestamptz,
  last_provider_seen_at      timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  unlinked_at                timestamptz,

  foreign key (company_id, connection_id)
    references public.calendar_connections(company_id, id) on delete cascade,
  foreign key (company_id, task_id)
    references public.tasks(company_id, id) on delete cascade,
  unique (company_id, id),
  unique (company_id, id, connection_id, task_id),
  unique (connection_id, task_id),
  unique (connection_id, provider_instance_id),
  constraint task_calendar_links_instance_not_series_ck check (
    provider_series_id is null or provider_series_id <> provider_instance_id
  ),
  constraint task_calendar_links_state_shape_ck check (
       (link_state = 'active'
        and conflict_detected_at is null and event_removed_at is null
        and refused_at is null and unlinked_at is null)
    or (link_state = 'conflict' and conflict_detected_at is not null
        and conflict_ours_snapshot is not null and conflict_theirs_snapshot is not null)
    or (link_state = 'event_removed' and event_removed_at is not null)
    or (link_state = 'refused' and refused_at is not null and refusal_code is not null)
    or (link_state = 'unlinked' and unlinked_at is not null)
  )
);

create index task_calendar_links_task_idx
  on public.task_calendar_links (company_id, task_id);
create index task_calendar_links_provider_idx
  on public.task_calendar_links (connection_id, provider_event_id);
create index task_calendar_links_attention_idx
  on public.task_calendar_links (company_id, link_state)
  where link_state <> 'active';
create trigger set_updated_at before update on public.task_calendar_links
  for each row execute function extensions.moddatetime(updated_at);

create table public.calendar_outbox (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,
  connection_id         uuid not null,
  task_id               uuid not null,
  link_id               uuid,
  action                text not null
    check (action in ('create', 'upsert', 'unlink', 'scrub')),
  requested_snapshot    jsonb,
  provider_precondition text,
  generation            bigint not null default 1 check (generation > 0),
  state                 text not null default 'queued'
    check (state in ('queued', 'leased', 'completed', 'cancelled')),
  attempts              integer not null default 0 check (attempts >= 0),
  lease_generation      bigint not null default 0 check (lease_generation >= 0),
  provider_effect_ambiguous boolean not null default false,
  provider_effect_lease_generation bigint,
  available_at          timestamptz not null default now(),
  lease_owner           text,
  lease_expires_at      timestamptz,
  last_error_code       text check (last_error_code is null or length(last_error_code) <= 100),
  last_error_detail     text check (last_error_detail is null or length(last_error_detail) <= 1000),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  completed_at          timestamptz,
  cancelled_at          timestamptz,

  foreign key (company_id, connection_id)
    references public.calendar_connections(company_id, id) on delete cascade,
  foreign key (company_id, task_id)
    references public.tasks(company_id, id) on delete cascade,
  foreign key (company_id, link_id, connection_id, task_id)
    references public.task_calendar_links(company_id, id, connection_id, task_id)
    on delete cascade,
  constraint calendar_outbox_snapshot_shape_ck check (
    (action = 'create'
       and public.calendar_snapshot_is_canonical(requested_snapshot)
       -- Initial connection creates have no link yet.  Resolving a provider
       -- removal as "Moved" recreates the occurrence through its existing
       -- attention/link row, which commit-created reactivates atomically.
       and (state <> 'completed' or link_id is not null))
    or (action = 'upsert' and link_id is not null
       and public.calendar_snapshot_is_canonical(requested_snapshot))
    or (action in ('unlink', 'scrub')
      and link_id is not null and requested_snapshot is null)
  ),
  constraint calendar_outbox_lease_shape_ck check (
    (state = 'leased') = (lease_owner is not null and lease_expires_at is not null)
  ),
  constraint calendar_outbox_provider_effect_shape_ck check (
    (not provider_effect_ambiguous and provider_effect_lease_generation is null)
    or (
      provider_effect_ambiguous
      and provider_effect_lease_generation between 1 and lease_generation
    )
  ),
  constraint calendar_outbox_terminal_shape_ck check (
    (state = 'completed') = (completed_at is not null)
    and (state = 'cancelled') = (cancelled_at is not null)
  )
);

create unique index calendar_outbox_one_live_action_uq
  on public.calendar_outbox (connection_id, task_id)
  where state in ('queued', 'leased');
create index calendar_outbox_claim_idx
  on public.calendar_outbox (available_at, created_at)
  where state in ('queued', 'leased');
create trigger set_updated_at before update on public.calendar_outbox
  for each row execute function extensions.moddatetime(updated_at);

-- Route-driven calendar decisions have no provider cursor to replay them.
-- This small queue makes reminder-rule re-evaluation durable for use-calendar
-- and moved decisions; cancellation is completed synchronously in SQL instead.
create table public.calendar_reminder_replans (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  task_id          uuid not null,
  requester_user_id uuid not null,
  generation       bigint not null default 1 check (generation > 0),
  state            text not null default 'queued'
    check (state in ('queued', 'leased', 'completed', 'cancelled')),
  attempts         integer not null default 0 check (attempts >= 0),
  available_at     timestamptz not null default now(),
  lease_owner      text,
  lease_expires_at timestamptz,
  last_error_code  text check (last_error_code is null or length(last_error_code) <= 100),
  last_error_detail text check (last_error_detail is null or length(last_error_detail) <= 1000),
  created_at       timestamptz not null default now(),
  completed_at     timestamptz,
  cancelled_at     timestamptz,
  foreign key (company_id, task_id)
    references public.tasks(company_id, id) on delete cascade,
  foreign key (company_id, requester_user_id)
    references public.company_members(company_id, user_id) on delete cascade,
  unique (company_id, id),
  constraint calendar_reminder_replans_lease_shape_ck check (
    (state = 'leased') = (lease_owner is not null and lease_expires_at is not null)
  ),
  constraint calendar_reminder_replans_terminal_shape_ck check (
    (state = 'completed') = (completed_at is not null)
    and (state = 'cancelled') = (cancelled_at is not null)
  )
);
create unique index calendar_reminder_replans_one_live_task_uq
  on public.calendar_reminder_replans (company_id, task_id)
  where state in ('queued', 'leased');
create index calendar_reminder_replans_claim_idx
  on public.calendar_reminder_replans (available_at, created_at)
  where state in ('queued', 'leased');

-- Every connector table is service-role-only.  RLS is a deny-by-default belt;
-- the Worker remains the sole caller and holds the service key.
alter table public.calendar_connections enable row level security;
alter table public.oauth_states enable row level security;
alter table public.webhook_subscriptions enable row level security;
alter table public.task_calendar_links enable row level security;
alter table public.calendar_outbox enable row level security;
alter table public.calendar_reminder_replans enable row level security;

revoke all on public.calendar_connections from public, anon, authenticated;
revoke all on public.oauth_states from public, anon, authenticated;
revoke all on public.webhook_subscriptions from public, anon, authenticated;
revoke all on public.task_calendar_links from public, anon, authenticated;
revoke all on public.calendar_outbox from public, anon, authenticated;
revoke all on public.calendar_reminder_replans from public, anon, authenticated;
grant select, insert, update, delete on public.calendar_connections to service_role;
grant select, insert, update, delete on public.oauth_states to service_role;
grant select, insert, update, delete on public.webhook_subscriptions to service_role;
grant select, insert, update, delete on public.task_calendar_links to service_role;
grant select, insert, update, delete on public.calendar_outbox to service_role;
grant select, insert, update, delete on public.calendar_reminder_replans to service_role;

comment on table public.calendar_connections is
  '#245: encrypted Google/Microsoft calendar credentials and provider liveness, one live connection per member/workspace.';
comment on table public.oauth_states is
  '#245: one-use hashed OAuth state and encrypted PKCE verifier; short-lived and service-role-only.';
comment on table public.webhook_subscriptions is
  '#245: renewable Google watch / Microsoft Graph subscription identities and liveness.';
comment on table public.task_calendar_links is
  '#245/D137: per-task/provider-instance mapping with three-way-diff base, exact last-send, and attention state.';
comment on table public.calendar_outbox is
  '#245/D137: transactional provider-write intents, one live per mapping and claimed under a lease.';
comment on table public.calendar_reminder_replans is
  '#245/D137: durable reminder-rule replanning after route-driven calendar decisions.';

-- ---------------------------------------------------------------------------
-- Task hooks: rescheduling invalidates confirmation, and every mapped local
-- scheduling change writes/refreshes one outbox action IN THE SAME TRANSACTION.
-- ---------------------------------------------------------------------------
create or replace function public.calendar_task_before_schedule_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_actor text;
begin
  if new.due_at is distinct from old.due_at then
    -- Confirmation is evidence for one particular instant.  It cannot follow
    -- a job to a different time, regardless of which side moved it.
    new.confirmed_at := null;
    new.confirmed_by := null;

    -- Every recoverable hold still contains the OLD literal appointment time,
    -- regardless of why it was held (calendar, quiet/provider availability,
    -- subscription, etc.). Terminalize it while retaining disclosure evidence
    -- so a failed best-effort replan can never later fire stale copy.
    update public.scheduled_messages
       set status = 'canceled',
           canceled_at = now(),
           claimed_at = null,
           updated_at = now()
     where company_id = old.company_id
       and task_id = old.id
       and origin = 'reminder'
       and status = 'held';

    -- Provider sync is not a human edit and must not acquire a newer display
    -- clock.  The flag is transaction-local and only set inside the provider
    -- RPCs below.
    if coalesce(current_setting('loonext.calendar_provider_apply', true), '') <> 'on' then
      new.schedule_changed_at := statement_timestamp();
      v_actor := nullif(current_setting('loonext.schedule_actor', true), '');
      new.schedule_changed_by := case when v_actor is null then null else v_actor::uuid end;
    end if;
  end if;
  return new;
end $$;

create trigger calendar_task_before_schedule_change
before update of due_at on public.tasks
for each row execute function public.calendar_task_before_schedule_change();

-- Reminder regeneration keeps a held row's disclosure but never its stale
-- literal appointment.  Matching offsets are refreshed in place; held offsets
-- removed from the plan become explicit cancelled history.  Pending rows keep
-- the established delete/rebuild behavior.
create or replace function public.api_sync_task_reminders(
  p_company_id     uuid,
  p_task_id        uuid,
  p_user_id        uuid,
  p_reminders      jsonb,
  p_clock_timezone text,
  p_clock_source   text,
  p_expires_at     timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task           public.tasks%rowtype;
  v_removed        integer := 0;
  v_added          integer := 0;
  v_updated_held   integer := 0;
  v_cancelled_held integer := 0;
  v_reminder       jsonb;
begin
  select * into v_task
    from public.tasks t
   where t.id = p_task_id and t.company_id = p_company_id
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  with gone as (
    delete from public.scheduled_messages
     where task_id = p_task_id
       and company_id = p_company_id
       and origin = 'reminder'
       and status = 'pending'
    returning 1
  ) select count(*) into v_removed from gone;

  if v_task.deleted_at is null and not v_task.reminders_off then
    with planned as (
      select
        (item->>'offset_minutes')::integer as offset_minutes,
        item->>'body' as body,
        (item->>'send_at')::timestamptz as send_at
      from jsonb_array_elements(coalesce(p_reminders, '[]'::jsonb)) item
    )
    update public.scheduled_messages s
       set body = p.body,
           send_at = p.send_at,
           clock_timezone = p_clock_timezone,
           clock_source = p_clock_source,
           expires_at = p_expires_at,
           claimed_at = null,
           updated_at = now()
      from planned p
     where s.company_id = p_company_id
       and s.task_id = p_task_id
       and s.origin = 'reminder'
       and s.status = 'held'
       and s.reminder_offset_minutes = p.offset_minutes;
    get diagnostics v_updated_held = row_count;
  end if;

  with planned as (
    select (item->>'offset_minutes')::integer as offset_minutes
      from jsonb_array_elements(coalesce(p_reminders, '[]'::jsonb)) item
  )
  update public.scheduled_messages s
     set status = 'canceled',
         canceled_at = now(),
         claimed_at = null,
         updated_at = now()
   where s.company_id = p_company_id
     and s.task_id = p_task_id
     and s.origin = 'reminder'
     and s.status = 'held'
     and (
       v_task.deleted_at is not null
       or v_task.reminders_off
       or not exists (
         select 1 from planned p
          where p.offset_minutes = s.reminder_offset_minutes
       )
     );
  get diagnostics v_cancelled_held = row_count;

  if v_task.deleted_at is not null or v_task.reminders_off then
    return jsonb_build_object(
      'outcome', 'synced',
      'removed', v_removed,
      'added', 0,
      'updated_held', v_updated_held,
      'cancelled_held', v_cancelled_held,
      'reason', case when v_task.deleted_at is not null
                     then 'task_deleted' else 'reminders_off' end
    );
  end if;

  for v_reminder in
    select * from jsonb_array_elements(coalesce(p_reminders, '[]'::jsonb))
  loop
    insert into public.scheduled_messages (
      company_id, conversation_id, task_id, origin, reminder_offset_minutes,
      body, send_at, clock_timezone, clock_source, expires_at, created_by
    ) values (
      p_company_id, v_task.conversation_id, p_task_id, 'reminder',
      (v_reminder->>'offset_minutes')::integer,
      v_reminder->>'body', (v_reminder->>'send_at')::timestamptz,
      p_clock_timezone, p_clock_source, p_expires_at, p_user_id
    ) on conflict do nothing;
    if found then v_added := v_added + 1; end if;
  end loop;

  return jsonb_build_object(
    'outcome', 'synced',
    'removed', v_removed,
    'added', v_added,
    'updated_held', v_updated_held,
    'cancelled_held', v_cancelled_held
  );
end $$;

revoke execute on function public.api_sync_task_reminders(
  uuid, uuid, uuid, jsonb, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_sync_task_reminders(
  uuid, uuid, uuid, jsonb, text, text, timestamptz)
  to service_role;

create or replace function public.calendar_task_in_sync_window(
  p_due_at timestamptz
) returns boolean
language sql
stable
set search_path = ''
as $$
  select p_due_at is not null
     and p_due_at >= now() - interval '90 days'
     and p_due_at <= now() + interval '365 days';
$$;

revoke execute on function public.calendar_task_in_sync_window(timestamptz)
  from public, anon, authenticated;

create or replace function public.calendar_task_access_allowed(
  p_user_id         uuid,
  p_company_id      uuid,
  p_conversation_id uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.company_members m
      join public.conversations c
        on c.id = p_conversation_id and c.company_id = m.company_id
     where m.company_id = p_company_id
       and m.user_id = p_user_id
       and m.deactivated_at is null
       and public.member_number_level(p_user_id, c.phone_number_id) <> 'none'
  );
$$;

revoke execute on function public.calendar_task_access_allowed(uuid, uuid, uuid)
  from public, anon, authenticated;

create or replace function public.calendar_enqueue_mapped_task_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('loonext.calendar_provider_apply', true), '') = 'on' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.due_at is not distinct from old.due_at
       and new.title is not distinct from old.title
       and new.description is not distinct from old.description
       and new.deleted_at is not distinct from old.deleted_at
       and new.assigned_user_id is not distinct from old.assigned_user_id then
      return new;
    end if;
  end if;

  -- A newly connected calendar has create intents before links exist.  They
  -- are still transactional task mirrors: a move rebuilds the one live body,
  -- and deletion/reassignment cancels creation instead of producing a ghost
  -- event from the stale queue row.
  update public.calendar_outbox o
     set state = 'cancelled', cancelled_at = now(),
         lease_owner = null, lease_expires_at = null,
         generation = o.generation + 1,
         updated_at = now()
    from public.calendar_connections c
   where o.connection_id = c.id
     and o.company_id = new.company_id
     and o.task_id = new.id
     and o.action = 'create'
     and o.state = 'queued'
     and not o.provider_effect_ambiguous
     and (
       new.deleted_at is not null
       or new.due_at is null
       or not public.calendar_task_in_sync_window(new.due_at)
       or new.assigned_user_id is distinct from c.user_id
       or not public.calendar_task_access_allowed(
         c.user_id, new.company_id, new.conversation_id
       )
     );

  -- A leased create may already exist remotely.  Never cancel its DB record
  -- out from under the worker: bumping generation tells commit-create to map
  -- the returned event and immediately queue the now-current follow-up.
  update public.calendar_outbox o
     set generation = o.generation + 1,
         attempts = 0,
         updated_at = now()
    from public.calendar_connections c
   where o.connection_id = c.id
     and o.company_id = new.company_id
     and o.task_id = new.id
     and o.action = 'create'
     and o.state = 'leased'
     and (
       new.deleted_at is not null
       or new.due_at is null
       or not public.calendar_task_in_sync_window(new.due_at)
       or new.assigned_user_id is distinct from c.user_id
       or not public.calendar_task_access_allowed(
         c.user_id, new.company_id, new.conversation_id
       )
     );

  update public.calendar_outbox o
     set requested_snapshot = public.calendar_task_snapshot(
           new.due_at, new.title, new.description, null, c.selected_calendar_timezone
         ),
         generation = o.generation + 1,
         attempts = 0,
         available_at = least(o.available_at, now()),
         last_error_code = null,
         last_error_detail = null,
         updated_at = now()
    from public.calendar_connections c
   where o.connection_id = c.id
     and o.company_id = new.company_id
     and o.task_id = new.id
     and o.action = 'create'
     and o.state in ('queued', 'leased')
     and not o.provider_effect_ambiguous
     and new.deleted_at is null
     and new.due_at is not null
     and public.calendar_task_in_sync_window(new.due_at)
     and new.assigned_user_id = c.user_id
     and public.calendar_task_access_allowed(
       c.user_id, new.company_id, new.conversation_id
     );

  insert into public.calendar_outbox (
    company_id, connection_id, task_id, link_id, action,
    requested_snapshot, provider_precondition
  )
  select
    new.company_id,
    l.connection_id,
    new.id,
    l.id,
    case
      when not public.calendar_task_access_allowed(
        c.user_id, new.company_id, new.conversation_id
      ) then 'scrub'
      when new.deleted_at is not null
        or new.due_at is null
        or not public.calendar_task_in_sync_window(new.due_at)
        or new.assigned_user_id is distinct from c.user_id
      then 'unlink'
      else 'upsert'
    end,
    case
      when new.deleted_at is not null
        or new.due_at is null
        or not public.calendar_task_in_sync_window(new.due_at)
        or new.assigned_user_id is distinct from c.user_id
        or not public.calendar_task_access_allowed(
          c.user_id, new.company_id, new.conversation_id
        )
      then null
      else public.calendar_task_snapshot(
        new.due_at, new.title, new.description, l.base_snapshot, co.timezone
      )
    end,
    l.provider_version
  from public.task_calendar_links l
  join public.calendar_connections c
    on c.id = l.connection_id and c.company_id = l.company_id
  join public.companies co on co.id = new.company_id
  where l.company_id = new.company_id
    and l.task_id = new.id
    and l.link_state <> 'unlinked'
    and (
      l.link_state = 'active'
      or new.deleted_at is not null
      or new.due_at is null
      or not public.calendar_task_in_sync_window(new.due_at)
      or new.assigned_user_id is distinct from c.user_id
      or not public.calendar_task_access_allowed(
        c.user_id, new.company_id, new.conversation_id
      )
    )
    and c.revoked_at is null
  on conflict (connection_id, task_id)
    where state in ('queued', 'leased')
  do update set
    link_id = case when public.calendar_outbox.provider_effect_ambiguous
      then public.calendar_outbox.link_id else excluded.link_id end,
    action = case when public.calendar_outbox.provider_effect_ambiguous
      then public.calendar_outbox.action else excluded.action end,
    requested_snapshot = case when public.calendar_outbox.provider_effect_ambiguous
      then public.calendar_outbox.requested_snapshot else excluded.requested_snapshot end,
    provider_precondition = case when public.calendar_outbox.provider_effect_ambiguous
      then public.calendar_outbox.provider_precondition else excluded.provider_precondition end,
    generation = public.calendar_outbox.generation + 1,
    attempts = case when public.calendar_outbox.provider_effect_ambiguous
      then public.calendar_outbox.attempts else 0 end,
    available_at = least(public.calendar_outbox.available_at, now()),
    last_error_code = null,
    last_error_detail = null,
    updated_at = now();

  -- Tasks can become calendar-eligible after the connection exists: both a
  -- brand-new assigned/due task and a reassignment to this member need their
  -- first provider occurrence.  A non-unlinked mapping remains authoritative
  -- (including attention states), while an unlinked mapping is deliberately
  -- reused so the connection/task uniqueness and attention identity survive.
  insert into public.calendar_outbox (
    company_id, connection_id, task_id, link_id, action,
    requested_snapshot, provider_precondition
  )
  select
    new.company_id,
    c.id,
    new.id,
    l_unlinked.id,
    'create',
    public.calendar_task_snapshot(
      new.due_at, new.title, new.description, null,
      c.selected_calendar_timezone
    ),
    null
  from public.calendar_connections c
  left join public.task_calendar_links l_unlinked
    on l_unlinked.connection_id = c.id
   and l_unlinked.task_id = new.id
   and l_unlinked.link_state = 'unlinked'
  where new.deleted_at is null
    and new.due_at is not null
    and public.calendar_task_in_sync_window(new.due_at)
    and new.assigned_user_id = c.user_id
    and public.calendar_task_access_allowed(
      c.user_id, new.company_id, new.conversation_id
    )
    and c.company_id = new.company_id
    and c.status = 'active'
    and c.revoked_at is null
    and not exists (
      select 1
        from public.task_calendar_links l
       where l.connection_id = c.id
         and l.task_id = new.id
         and l.link_state <> 'unlinked'
    )
    and not exists (
      select 1
        from public.calendar_outbox o
       where o.connection_id = c.id
         and o.task_id = new.id
         and o.state in ('queued', 'leased')
    )
  on conflict (connection_id, task_id)
    where state in ('queued', 'leased')
  do nothing;

  return new;
end $$;

create trigger calendar_enqueue_mapped_task_change
after insert or update on public.tasks
for each row execute function public.calendar_enqueue_mapped_task_change();

create or replace function public.calendar_enqueue_connection_horizon(
  p_connection_id uuid
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.calendar_outbox (
    company_id, connection_id, task_id, link_id, action,
    requested_snapshot, provider_precondition
  )
  select t.company_id, c.id, t.id, l_unlinked.id, 'create',
         public.calendar_task_snapshot(
           t.due_at, t.title, t.description, null,
           c.selected_calendar_timezone
         ),
         null
    from public.calendar_connections c
    join public.tasks t
      on t.company_id = c.company_id and t.assigned_user_id = c.user_id
    left join public.task_calendar_links l_unlinked
      on l_unlinked.connection_id = c.id and l_unlinked.task_id = t.id
     and l_unlinked.link_state = 'unlinked'
   where c.id = p_connection_id and c.status = 'active'
     and c.revoked_at is null
     and t.deleted_at is null
     and public.calendar_task_in_sync_window(t.due_at)
     and public.calendar_task_access_allowed(
       c.user_id, t.company_id, t.conversation_id
     )
     and not exists (
       select 1 from public.task_calendar_links l
        where l.connection_id = c.id and l.task_id = t.id
          and l.link_state <> 'unlinked'
     )
     and not exists (
       select 1 from public.calendar_outbox o
        where o.connection_id = c.id and o.task_id = t.id
          and o.state in ('queued', 'leased')
     )
  on conflict (connection_id, task_id)
    where state in ('queued', 'leased')
  do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.calendar_pull_claim_enqueue_horizon()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' and new.revoked_at is null
     and new.last_sync_started_at is distinct from old.last_sync_started_at then
    perform public.calendar_enqueue_connection_horizon(new.id);
  end if;
  return null;
end $$;

create trigger calendar_pull_claim_enqueue_horizon
after update of last_sync_started_at on public.calendar_connections
for each row execute function public.calendar_pull_claim_enqueue_horizon();

revoke execute on function public.calendar_enqueue_connection_horizon(uuid)
  from public, anon, authenticated;
revoke execute on function public.calendar_pull_claim_enqueue_horizon()
  from public, anon, authenticated;

create or replace function public.calendar_reconcile_number_access(
  p_company_id      uuid,
  p_phone_number_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  v_eligible boolean;
  v_access_allowed boolean;
  v_action text;
  v_snapshot jsonb;
begin
  -- A rule can change the default for EVERY ordinary member on a number (the
  -- first rule closes an otherwise-open number; deleting the last opens it),
  -- so reconcile all live personal connections, not merely a named principal.
  for v in
    select
      c.id as connection_id, c.user_id, c.selected_calendar_timezone,
      c.status as connection_status,
      t.id as task_id, t.company_id, t.conversation_id, t.assigned_user_id,
      t.due_at, t.title, t.description, t.deleted_at,
      l.id as link_id, l.link_state, l.provider_version, l.base_snapshot
    from public.calendar_connections c
    join public.tasks t on t.company_id = c.company_id
    join public.conversations cv
      on cv.id = t.conversation_id and cv.company_id = t.company_id
    left join public.task_calendar_links l
      on l.connection_id = c.id and l.task_id = t.id
    where c.company_id = p_company_id
      and c.status in ('active', 'reauth_required')
      and c.revoked_at is null
      and cv.phone_number_id = p_phone_number_id
      and (
        t.assigned_user_id = c.user_id
        or l.id is not null
        or exists (
          select 1 from public.calendar_outbox live
           where live.connection_id = c.id and live.task_id = t.id
             and live.state in ('queued', 'leased')
        )
      )
  loop
    v_access_allowed := public.calendar_task_access_allowed(
      v.user_id, v.company_id, v.conversation_id
    );
    v_eligible := v.deleted_at is null
      and v.due_at is not null
      and public.calendar_task_in_sync_window(v.due_at)
      and v.assigned_user_id = v.user_id
      and v_access_allowed;

    if not v_eligible then
      -- A create with no possible provider effect can disappear.  Once an
      -- effect is ambiguous its original request is recovery evidence and is
      -- preserved until commit-create maps it and queues the current unlink.
      update public.calendar_outbox o
         set state = 'cancelled', cancelled_at = now(),
             lease_owner = null, lease_expires_at = null,
             generation = o.generation + 1
       where o.connection_id = v.connection_id and o.task_id = v.task_id
         and o.action = 'create' and o.state = 'queued'
         and not o.provider_effect_ambiguous;
      update public.calendar_outbox o
         set generation = o.generation + 1, attempts = 0
       where o.connection_id = v.connection_id and o.task_id = v.task_id
         and o.action = 'create' and o.state = 'leased';

      if v.connection_status = 'reauth_required' then
        -- Access cannot wait for an OAuth repair.  The sealed credential is
        -- already known unusable, so there is no honest provider cleanup we
        -- can claim.  Release local holds, retain the occurrence identity as a
        -- tombstone, and disclose that remote cleanup is unconfirmed.
        update public.calendar_outbox o
           set state = 'cancelled', cancelled_at = now(),
               lease_owner = null, lease_expires_at = null,
               last_error_code = 'access_revoked_while_reauth_required',
               last_error_detail = 'Remote security scrub could not be confirmed.'
         where o.connection_id = v.connection_id
           and o.task_id = v.task_id
           and o.state in ('queued', 'leased');
        if v.link_id is not null and v.link_state <> 'unlinked' then
          update public.task_calendar_links
             set link_state = 'unlinked', unlinked_at = now(),
                 last_sent_snapshot = null,
                 last_sent_provider_version = null,
                 last_sent_at = null,
                 conflict_ours_snapshot = null,
                 conflict_theirs_snapshot = null,
                 conflict_detected_at = null,
                 event_removed_at = null,
                 refusal_code = null,
                 refusal_detail = null,
                 refused_at = null
           where id = v.link_id;
        end if;
        update public.calendar_connections
           set remote_cleanup_unconfirmed = true,
               last_error_code = 'access_revoked_while_reauth_required',
               last_error_detail = 'Remote security scrub could not be confirmed.',
               last_error_at = now()
         where id = v.connection_id;
        continue;
      end if;

      if v.link_id is null or v.link_state = 'unlinked' then
        continue;
      end if;
      v_action := case when v_access_allowed then 'unlink' else 'scrub' end;
      v_snapshot := null;
    else
      if v.link_id is not null and v.link_state <> 'unlinked' then
        -- A number rule changed, not the task.  Existing eligible mappings need
        -- no PATCH at all: cancel only a scrub that has definitely not crossed
        -- the provider boundary.  An ambiguous scrub remains recovery work and
        -- its commit will create current truth after neutralising the old copy.
        update public.calendar_outbox o
           set state = 'cancelled', cancelled_at = now(),
               lease_owner = null, lease_expires_at = null,
               generation = o.generation + 1
         where o.connection_id = v.connection_id and o.task_id = v.task_id
           and o.action = 'scrub' and o.state in ('queued', 'leased')
           and not o.provider_effect_ambiguous;
        continue;
      end if;
      v_action := 'create';
      v_snapshot := public.calendar_task_snapshot(
        v.due_at, v.title, v.description, null,
        v.selected_calendar_timezone
      );
    end if;

    insert into public.calendar_outbox (
      company_id, connection_id, task_id, link_id, action,
      requested_snapshot, provider_precondition
    ) values (
      v.company_id, v.connection_id, v.task_id, v.link_id, v_action,
      v_snapshot, case when v_action = 'create' then null else v.provider_version end
    )
    on conflict (connection_id, task_id)
      where state in ('queued', 'leased')
    do update set
      link_id = case when public.calendar_outbox.provider_effect_ambiguous
        then public.calendar_outbox.link_id else excluded.link_id end,
      action = case when public.calendar_outbox.provider_effect_ambiguous
        then public.calendar_outbox.action else excluded.action end,
      requested_snapshot = case when public.calendar_outbox.provider_effect_ambiguous
        then public.calendar_outbox.requested_snapshot else excluded.requested_snapshot end,
      provider_precondition = case when public.calendar_outbox.provider_effect_ambiguous
        then public.calendar_outbox.provider_precondition else excluded.provider_precondition end,
      generation = public.calendar_outbox.generation + 1,
      attempts = case when public.calendar_outbox.provider_effect_ambiguous
        then public.calendar_outbox.attempts else 0 end,
      available_at = least(public.calendar_outbox.available_at, now()),
      last_error_code = null,
      last_error_detail = null;
  end loop;
end $$;

create or replace function public.calendar_number_access_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.calendar_reconcile_number_access(
      old.company_id, old.phone_number_id
    );
  elsif tg_op = 'INSERT' then
    perform public.calendar_reconcile_number_access(
      new.company_id, new.phone_number_id
    );
  else
    if (new.company_id, new.phone_number_id)
         is distinct from (old.company_id, old.phone_number_id) then
      perform public.calendar_reconcile_number_access(
        old.company_id, old.phone_number_id
      );
    end if;
    perform public.calendar_reconcile_number_access(
      new.company_id, new.phone_number_id
    );
  end if;
  return null;
end $$;

create trigger calendar_number_access_changed
after insert or update or delete on public.number_access
for each row execute function public.calendar_number_access_changed();

create or replace function public.calendar_member_access_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number_id uuid;
  v_connection_id uuid;
begin
  if new.role is not distinct from old.role
     and new.deactivated_at is not distinct from old.deactivated_at then
    return null;
  end if;

  -- Role precedence and active membership are inputs to member_number_level.
  -- Re-evaluate every number: unruled numbers are open for an active member
  -- but become hidden on deactivation, while ruled numbers can flip on role.
  for v_number_id in
    select pn.id from public.phone_numbers pn
     where pn.company_id = new.company_id
  loop
    perform public.calendar_reconcile_number_access(
      new.company_id, v_number_id
    );
  end loop;

  if old.deactivated_at is null and new.deactivated_at is not null then
    select c.id into v_connection_id
      from public.calendar_connections c
     where c.company_id = new.company_id and c.user_id = new.user_id
       and c.revoked_at is null
     for update;
    if found then
      perform public.calendar_begin_connection_disconnect(
        v_connection_id, 'scrub'
      );
    end if;
  end if;
  return null;
end $$;

create trigger calendar_member_access_changed
after update of role, deactivated_at on public.company_members
for each row execute function public.calendar_member_access_changed();

create or replace function public.calendar_company_closed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection_id uuid;
begin
  if old.deleted_at is null and new.deleted_at is not null then
    -- Closing a workspace is also a confidentiality revocation.  Every mapped
    -- provider occurrence is scrubbed and every watch is durably stopped while
    -- the sealed credential is retained solely for that bounded cleanup.
    for v_connection_id in
      select c.id
        from public.calendar_connections c
       where c.company_id = new.id and c.revoked_at is null
       order by c.id
    loop
      perform public.calendar_begin_connection_disconnect(
        v_connection_id, 'scrub'
      );
    end loop;
  end if;
  return null;
end $$;

create trigger calendar_company_closed
after update of deleted_at on public.companies
for each row execute function public.calendar_company_closed();

revoke execute on function public.calendar_reconcile_number_access(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.calendar_number_access_changed()
  from public, anon, authenticated;
revoke execute on function public.calendar_member_access_changed()
  from public, anon, authenticated;
revoke execute on function public.calendar_company_closed()
  from public, anon, authenticated;

create or replace function public.calendar_enqueue_reminder_replan(
  p_company_id uuid,
  p_task_id    uuid,
  p_requester_user_id uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.calendar_reminder_replans (
    company_id, task_id, requester_user_id
  ) values (p_company_id, p_task_id, p_requester_user_id)
  on conflict (company_id, task_id)
    where state in ('queued', 'leased')
  do update set
    generation = public.calendar_reminder_replans.generation + 1,
    requester_user_id = excluded.requester_user_id,
    attempts = 0,
    available_at = least(public.calendar_reminder_replans.available_at, now()),
    last_error_code = null,
    last_error_detail = null
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.calendar_task_before_schedule_change()
  from public, anon, authenticated;
revoke execute on function public.calendar_enqueue_mapped_task_change()
  from public, anon, authenticated;
revoke execute on function public.calendar_enqueue_reminder_replan(uuid, uuid, uuid)
  from public, anon, authenticated;

-- The canonical human task-mutation RPC already knows the actor.  Passing that
-- fact into the BEFORE trigger through a transaction-local setting keeps the
-- actor write atomic without adding a second update (which would queue twice).
create or replace function public.update_task(
  p_company_id       uuid,
  p_task_id          uuid,
  p_title            text,
  p_description      text,
  p_due_at           timestamptz,
  p_clear_due        boolean,
  p_actor_user_id    uuid,
  p_set_address      boolean default false,
  p_addr_street      text default null,
  p_addr_unit        text default null,
  p_addr_city        text default null,
  p_addr_state       text default null,
  p_addr_postal_code text default null,
  p_addr_country     text default null,
  p_addr_provenance  text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task         public.tasks%rowtype;
  v_new_title    text;
  v_new_desc     text;
  v_new_due      timestamptz;
  v_new_prov     text;
  v_has_address  boolean;
  v_due_changed  boolean := false;
  v_addr_changed boolean := false;
  v_changed      boolean := false;
  v_prior_actor  text := coalesce(current_setting('loonext.schedule_actor', true), '');
begin
  select * into v_task
    from public.tasks t
   where t.company_id = p_company_id
     and t.id = p_task_id
     and t.deleted_at is null
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found', 'task', null);
  end if;

  v_new_title := coalesce(p_title, v_task.title);
  v_new_desc  := coalesce(p_description, v_task.description);
  if p_clear_due then
    v_new_due := null;
  elsif p_due_at is not null then
    v_new_due := p_due_at;
  else
    v_new_due := v_task.due_at;
  end if;

  if p_set_address then
    v_has_address := coalesce(
      p_addr_street, p_addr_unit, p_addr_city, p_addr_state,
      p_addr_postal_code, p_addr_country) is not null;
    v_new_prov := case when v_has_address then p_addr_provenance else null end;
    v_addr_changed :=
         (p_addr_street      is distinct from v_task.addr_street)
      or (p_addr_unit        is distinct from v_task.addr_unit)
      or (p_addr_city        is distinct from v_task.addr_city)
      or (p_addr_state       is distinct from v_task.addr_state)
      or (p_addr_postal_code is distinct from v_task.addr_postal_code)
      or (p_addr_country     is distinct from v_task.addr_country)
      or (v_new_prov         is distinct from v_task.addr_provenance);
  end if;

  v_changed := (v_new_title is distinct from v_task.title)
            or (v_new_desc  is distinct from v_task.description)
            or (v_new_due   is distinct from v_task.due_at)
            or v_addr_changed;
  if not v_changed then
    return jsonb_build_object('outcome', 'unchanged', 'task', to_jsonb(v_task));
  end if;

  v_due_changed := v_new_due is distinct from v_task.due_at;
  if v_due_changed then
    perform set_config('loonext.schedule_actor', p_actor_user_id::text, true);
  end if;

  update public.tasks
     set title = v_new_title,
         description = v_new_desc,
         due_at = v_new_due,
         addr_street      = case when p_set_address then p_addr_street      else addr_street end,
         addr_unit        = case when p_set_address then p_addr_unit        else addr_unit end,
         addr_city        = case when p_set_address then p_addr_city        else addr_city end,
         addr_state       = case when p_set_address then p_addr_state       else addr_state end,
         addr_postal_code = case when p_set_address then p_addr_postal_code else addr_postal_code end,
         addr_country     = case when p_set_address then p_addr_country     else addr_country end,
         addr_provenance  = case when p_set_address then v_new_prov         else addr_provenance end
   where id = v_task.id
  returning * into v_task;

  if v_due_changed then
    perform set_config('loonext.schedule_actor', v_prior_actor, true);
    insert into public.conversation_events
      (company_id, conversation_id, actor_user_id, type, payload)
    values
      (p_company_id, v_task.conversation_id, p_actor_user_id, 'task_due_set',
       jsonb_build_object('task_id', v_task.id, 'due_at', v_new_due));
  end if;

  return jsonb_build_object('outcome', 'updated', 'task', to_jsonb(v_task));
end $$;

revoke execute on function public.update_task(
  uuid, uuid, text, text, timestamptz, boolean, uuid,
  boolean, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.update_task(
  uuid, uuid, text, text, timestamptz, boolean, uuid,
  boolean, text, text, text, text, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- OAuth and connection lifecycle.
-- ---------------------------------------------------------------------------
create or replace function public.api_create_calendar_oauth_state(
  p_company_id           uuid,
  p_user_id              uuid,
  p_provider             text,
  p_state_hash           text,
  p_verifier_ciphertext  text,
  p_verifier_iv          text,
  p_verifier_key_version text,
  p_redirect_uri         text,
  p_return_to            text,
  p_expires_at           timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_expires_at <= now() + interval '1 minute'
     or p_expires_at > now() + interval '30 minutes' then
    raise exception 'calendar OAuth state expiry must be 1..30 minutes away';
  end if;

  perform 1
    from public.companies
   where id = p_company_id and deleted_at is null
   for key share;
  if not found then
    raise exception 'calendar OAuth state requires a live workspace';
  end if;

  perform 1
    from public.company_members
   where company_id = p_company_id and user_id = p_user_id
     and deactivated_at is null
   for update;
  if not found then
    raise exception 'calendar OAuth state requires an active member';
  end if;

  -- Starting again invalidates the abandoned browser flow.  This also prevents
  -- an expired-but-never-returned row from blocking the partial unique index.
  update public.oauth_states
     set consumed_at = now()
   where company_id = p_company_id
     and user_id = p_user_id
     and provider = p_provider
     and consumed_at is null;

  insert into public.oauth_states (
    company_id, user_id, provider, state_hash,
    verifier_ciphertext, verifier_iv, verifier_key_version,
    redirect_uri, return_to, expires_at
  ) values (
    p_company_id, p_user_id, p_provider, lower(p_state_hash),
    p_verifier_ciphertext, p_verifier_iv, p_verifier_key_version,
    p_redirect_uri, p_return_to, p_expires_at
  ) returning id into v_id;

  return v_id;
end $$;

create or replace function public.api_consume_calendar_oauth_state(
  p_state_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.oauth_states%rowtype;
begin
  update public.oauth_states s
     set consumed_at = now()
   where s.state_hash = lower(p_state_hash)
     and s.consumed_at is null
     and s.expires_at > now()
     and exists (
       select 1 from public.companies c
        where c.id = s.company_id and c.deleted_at is null
     )
     and exists (
       select 1 from public.company_members m
        where m.company_id = s.company_id and m.user_id = s.user_id
          and m.deactivated_at is null
     )
  returning * into v_state;

  if not found then
    -- Expired, replayed and invented states are deliberately indistinguishable.
    return jsonb_build_object('outcome', 'invalid');
  end if;
  return jsonb_build_object('outcome', 'consumed', 'state', to_jsonb(v_state));
end $$;

create or replace function public.api_purge_calendar_oauth_states(
  p_limit integer default 1000
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_limit < 1 or p_limit > 1000 then
    raise exception 'calendar OAuth state purge limit must be 1..1000';
  end if;
  with doomed as (
    select s.id
      from public.oauth_states s
     where s.consumed_at is not null or s.expires_at <= now()
     order by coalesce(s.consumed_at, s.expires_at), s.id
     for update skip locked
     limit p_limit
  )
  delete from public.oauth_states s
   using doomed d
   where s.id = d.id;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.api_complete_calendar_connection(
  p_company_id                  uuid,
  p_user_id                     uuid,
  p_provider                    text,
  p_provider_account_id         text,
  p_provider_account_label      text,
  p_selected_calendar_id        text,
  p_selected_calendar_name      text,
  p_selected_calendar_timezone  text,
  p_credential_ciphertext       text,
  p_credential_iv               text,
  p_credential_key_version      text,
  p_provider_subscription_id    text,
  p_provider_resource_id        text,
  p_client_state_hash           text,
  p_webhook_expires_at          timestamptz,
  p_sync_cursor                 text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection_id  uuid;
  v_existing       public.calendar_connections%rowtype;
  v_reauthorizing  boolean := false;
  v_webhook_id     uuid;
  v_ics_revoked    integer := 0;
  v_creates        integer := 0;
begin
  -- Serialize against workspace close before the member/connection locks.  A
  -- callback for OAuth state minted before closure must not recreate a live
  -- watch inside the retention window.
  perform 1
    from public.companies
   where id = p_company_id and deleted_at is null
   for key share;
  if not found then
    return jsonb_build_object('outcome', 'workspace_closed');
  end if;

  -- Serialises reconnect races for the same member and proves membership in
  -- the same lock that protects the partial-unique replacement.
  perform 1
    from public.company_members
   where company_id = p_company_id and user_id = p_user_id
     and deactivated_at is null
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_member');
  end if;

  -- The callback creates a provisional remote watch BEFORE entering this
  -- transaction.  Validate every watch field before touching the prior setup;
  -- any later exception rolls the whole replacement back as one unit.
  if nullif(btrim(p_provider_subscription_id), '') is null
     or length(p_provider_subscription_id) > 1000 then
    raise exception 'calendar provider subscription id is required (max 1000 chars)';
  end if;
  if p_provider_resource_id is not null
     and length(p_provider_resource_id) > 2000 then
    raise exception 'calendar provider resource id exceeds 2000 chars';
  end if;
  if p_provider = 'google' and nullif(p_provider_resource_id, '') is null then
    raise exception 'Google calendar watch requires a provider resource id';
  end if;
  if p_client_state_hash is null
     or lower(p_client_state_hash) !~ '^[0-9a-f]{64}$' then
    raise exception 'calendar client state hash must be 64 lowercase hex chars';
  end if;
  if p_webhook_expires_at is null or p_webhook_expires_at <= now() then
    raise exception 'calendar webhook subscription must expire in the future';
  end if;
  if exists (
    select 1
      from public.webhook_subscriptions s
      join public.calendar_connections c on c.id = s.connection_id
     where s.provider_subscription_id = p_provider_subscription_id
       and s.revoked_at is null
       and (c.company_id, c.user_id) is distinct from (p_company_id, p_user_id)
  ) then
    return jsonb_build_object('outcome', 'webhook_conflict');
  end if;

  select * into v_existing
    from public.calendar_connections
   where company_id = p_company_id
     and user_id = p_user_id
     and revoked_at is null
   for update;
  if found then
    if v_existing.status = 'disconnected' then
      return jsonb_build_object(
        'outcome', 'disconnect_in_progress',
        'connection_id', v_existing.id
      );
    end if;
    -- Reauthorization is an in-place credential/watch rotation only.  A
    -- different provider account or calendar is a product-level replacement:
    -- returning before the first write lets the caller stop its provisional
    -- watch and require an explicit disconnect without damaging mappings.
    if v_existing.provider is distinct from p_provider
       or v_existing.provider_account_id is distinct from p_provider_account_id
       or v_existing.selected_calendar_id is distinct from p_selected_calendar_id then
      return jsonb_build_object(
        'outcome', 'replacement_requires_disconnect',
        'connection_id', v_existing.id,
        'provider', v_existing.provider,
        'provider_account_id', v_existing.provider_account_id,
        'selected_calendar_id', v_existing.selected_calendar_id
      );
    end if;
    v_connection_id := v_existing.id;
    v_reauthorizing := true;
  end if;

  update public.webhook_subscriptions s
     set status = 'revoking', revoked_at = null,
         renewal_generation = renewal_generation + 1,
         renewal_available_at = now(),
         renewal_lease_owner = null, renewal_lease_expires_at = null
   where s.revoked_at is null
     and s.connection_id = v_connection_id;

  if v_reauthorizing then
    update public.calendar_connections
       set provider_account_label = p_provider_account_label,
           selected_calendar_name = p_selected_calendar_name,
           selected_calendar_timezone = p_selected_calendar_timezone,
           credential_ciphertext = p_credential_ciphertext,
           credential_iv = p_credential_iv,
           credential_key_version = p_credential_key_version,
           credential_generation = credential_generation + 1,
           credential_refresh_lease_owner = null,
           credential_refresh_lease_expires_at = null,
           status = 'active',
           sync_cursor = p_sync_cursor,
           cursor_updated_at = case when p_sync_cursor is null then null else now() end,
           sync_due_at = now(),
           full_sync_due_at = now(),
           pull_full_sync = false,
           pull_followup_requested = false,
           pull_generation = pull_generation + 1,
           pull_lease_owner = null,
           pull_lease_expires_at = null,
           last_error_code = null,
           last_error_detail = null,
           last_error_at = null
     where id = v_connection_id;
  else
    insert into public.calendar_connections (
      company_id, user_id, provider, provider_account_id, provider_account_label,
      selected_calendar_id, selected_calendar_name, selected_calendar_timezone,
      credential_ciphertext, credential_iv, credential_key_version,
      status, sync_cursor, cursor_updated_at,
      sync_due_at, full_sync_due_at, pull_full_sync, pull_generation
    ) values (
      p_company_id, p_user_id, p_provider, p_provider_account_id,
      p_provider_account_label, p_selected_calendar_id, p_selected_calendar_name,
      p_selected_calendar_timezone, p_credential_ciphertext, p_credential_iv,
      p_credential_key_version, 'active', p_sync_cursor,
      case when p_sync_cursor is null then null else now() end,
      now(), now(), false, 1
    ) returning id into v_connection_id;
  end if;

  insert into public.webhook_subscriptions (
    company_id, connection_id, provider_subscription_id,
    provider_resource_id, provider_calendar_id, client_state_hash,
    status, expires_at, last_renewed_at
  ) values (
    p_company_id, v_connection_id, p_provider_subscription_id,
    p_provider_resource_id, p_selected_calendar_id,
    lower(p_client_state_hash), 'active', p_webhook_expires_at, now()
  ) returning id into v_webhook_id;

  -- Seed the OUTBOUND half only: dated live tasks already assigned to this
  -- member become provider-create intents.  Inbound provider events with no
  -- mapping remain ignored; a calendar event is not authority to manufacture
  -- a Loonext task.
  insert into public.calendar_outbox (
    company_id, connection_id, task_id, link_id, action,
    requested_snapshot, provider_precondition
  )
  select
    t.company_id,
    v_connection_id,
    t.id,
    l_unlinked.id,
    'create',
    public.calendar_task_snapshot(
      t.due_at, t.title, t.description, null, p_selected_calendar_timezone
    ),
    null
  from public.tasks t
  left join public.task_calendar_links l_unlinked
    on l_unlinked.connection_id = v_connection_id
   and l_unlinked.task_id = t.id
   and l_unlinked.link_state = 'unlinked'
  where t.company_id = p_company_id
    and t.assigned_user_id = p_user_id
    and t.due_at is not null
    and t.due_at >= now() - interval '90 days'
    and t.due_at <= now() + interval '365 days'
    and t.deleted_at is null
    and public.calendar_task_access_allowed(
      p_user_id, p_company_id, t.conversation_id
    )
    and not exists (
      select 1
        from public.task_calendar_links l
       where l.connection_id = v_connection_id
         and l.task_id = t.id
         and l.link_state <> 'unlinked'
    )
    and not exists (
      select 1
        from public.calendar_outbox o
       where o.connection_id = v_connection_id
         and o.task_id = t.id
         and o.state in ('queued', 'leased')
    )
  on conflict (connection_id, task_id)
    where state in ('queued', 'leased')
  do nothing;
  get diagnostics v_creates = row_count;

  -- Rule 8: the read-only feed would show the same jobs a second time, and a
  -- user can drag that subscribed copy without any write reaching us.
  update public.calendar_feed_tokens
     set revoked_at = now()
   where company_id = p_company_id
     and user_id = p_user_id
     and revoked_at is null;
  get diagnostics v_ics_revoked = row_count;

  return jsonb_build_object(
    'outcome', 'connected',
    'connection_id', v_connection_id,
    'webhook_subscription_id', v_webhook_id,
    'reauthorized', v_reauthorizing,
    'ics_revoked', v_ics_revoked,
    'creates_queued', v_creates
  );
end $$;

create or replace function public.calendar_finalize_disconnected_connection(
  p_connection_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.calendar_connections%rowtype;
begin
  select * into v_connection
    from public.calendar_connections
   where id = p_connection_id
   for update;
  if not found or v_connection.status <> 'disconnected'
     or v_connection.revoked_at is not null then
    return false;
  end if;
  if exists (
    select 1 from public.webhook_subscriptions s
     where s.connection_id = p_connection_id and s.revoked_at is null
  ) or exists (
    select 1 from public.calendar_outbox o
     where o.connection_id = p_connection_id
       and o.state in ('queued', 'leased')
  ) then
    return false;
  end if;

  update public.calendar_connections
     set status = 'revoked', revoked_at = now(),
         credential_ciphertext = null,
         credential_iv = null,
         credential_key_version = null,
         credential_generation = credential_generation + 1,
         credential_refresh_lease_owner = null,
         credential_refresh_lease_expires_at = null,
         disconnect_cleanup_action = null,
         sync_cursor = null, cursor_updated_at = null,
         sync_due_at = null, pull_full_sync = false,
         pull_followup_requested = false,
         pull_lease_owner = null, pull_lease_expires_at = null
   where id = p_connection_id;
  return true;
end $$;

create or replace function public.calendar_begin_connection_disconnect(
  p_connection_id uuid,
  p_cleanup_action text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.calendar_connections%rowtype;
begin
  if p_cleanup_action not in ('unlink', 'scrub') then
    raise exception 'calendar disconnect cleanup must be unlink or scrub';
  end if;
  select * into v_connection
    from public.calendar_connections
   where id = p_connection_id and revoked_at is null
   for update;
  if not found then return true; end if;

  update public.calendar_connections
     set status = 'disconnected',
         disconnect_cleanup_action = case
           when disconnect_cleanup_action = 'scrub' or p_cleanup_action = 'scrub'
           then 'scrub' else 'unlink' end,
         -- A provider refresh-token exchange may already have rotated the
         -- token while this trigger-driven access/closure transition waits on
         -- the row lock.  Preserve that current lease/generation: its CAS
         -- commit keeps status=disconnected and durably installs the only
         -- token capable of performing scrub + stopWatch.  Explicit user
         -- disconnect refuses a live refresh before reaching this helper.
         sync_due_at = null,
         pull_full_sync = false,
         pull_followup_requested = false,
         pull_generation = pull_generation + 1,
         pull_lease_owner = null,
         pull_lease_expires_at = null
   where id = p_connection_id;

  -- stopWatch/delete-subscription is a provider side effect too.  Keep the
  -- sealed credential until the revocation worker commits this durable row.
  update public.webhook_subscriptions
     set status = 'revoking',
         renewal_generation = renewal_generation + 1,
         renewal_available_at = now(),
         renewal_lease_owner = null,
         renewal_lease_expires_at = null
   where connection_id = p_connection_id and revoked_at is null;

  -- A create that never crossed the effect boundary is safe to forget.  An
  -- ambiguous create is retained and recoverable while disconnected; after it
  -- maps the remote event, commit-create queues the cleanup action below.
  update public.calendar_outbox
     set state = 'cancelled', cancelled_at = now(),
         lease_owner = null, lease_expires_at = null,
         generation = generation + 1
   where connection_id = p_connection_id
     and action = 'create' and state in ('queued', 'leased')
     and not provider_effect_ambiguous;

  insert into public.calendar_outbox (
    company_id, connection_id, task_id, link_id, action,
    requested_snapshot, provider_precondition
  )
  select l.company_id, l.connection_id, l.task_id, l.id,
         case when v_connection.disconnect_cleanup_action = 'scrub'
                   or p_cleanup_action = 'scrub' then 'scrub' else 'unlink' end,
         null, l.provider_version
    from public.task_calendar_links l
   where l.connection_id = p_connection_id and l.link_state <> 'unlinked'
  on conflict (connection_id, task_id)
    where state in ('queued', 'leased')
  do update set
    link_id = case when public.calendar_outbox.provider_effect_ambiguous
      then public.calendar_outbox.link_id else excluded.link_id end,
    action = case when public.calendar_outbox.provider_effect_ambiguous
      then public.calendar_outbox.action else excluded.action end,
    requested_snapshot = case when public.calendar_outbox.provider_effect_ambiguous
      then public.calendar_outbox.requested_snapshot else null end,
    provider_precondition = case when public.calendar_outbox.provider_effect_ambiguous
      then public.calendar_outbox.provider_precondition else excluded.provider_precondition end,
    generation = public.calendar_outbox.generation + 1,
    attempts = case when public.calendar_outbox.provider_effect_ambiguous
      then public.calendar_outbox.attempts else 0 end,
    available_at = least(public.calendar_outbox.available_at, now()),
    last_error_code = null,
    last_error_detail = null;

  return public.calendar_finalize_disconnected_connection(p_connection_id);
end $$;

revoke execute on function public.calendar_finalize_disconnected_connection(uuid)
  from public, anon, authenticated;
revoke execute on function public.calendar_begin_connection_disconnect(uuid, text)
  from public, anon, authenticated;

create or replace function public.api_revoke_calendar_connection(
  p_company_id uuid,
  p_user_id    uuid,
  p_connection_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.calendar_connections%rowtype;
  v_finalized  boolean;
begin
  -- The connection row is the serialization gate shared with outbox and watch
  -- renewal claims.  A provider call that may already have produced a remote
  -- side effect is never forgotten merely because its lease/backoff expired.
  select * into v_connection
    from public.calendar_connections
   where company_id = p_company_id
     and user_id = p_user_id
     and revoked_at is null
   for update;
  if not found then
    return jsonb_build_object('outcome', 'revoked', 'count', 0);
  end if;
  if v_connection.id is distinct from p_connection_id then
    return jsonb_build_object(
      'outcome', 'superseded', 'connection_id', v_connection.id
    );
  end if;

  -- A refresh-token exchange may already have rotated the provider token.
  -- Let its generation-CAS commit before disconnect invalidates the lease;
  -- otherwise cleanup could be left holding the provider's obsolete token.
  if v_connection.credential_refresh_lease_owner is not null
     and v_connection.credential_refresh_lease_expires_at > now() then
    return jsonb_build_object(
      'outcome', 'busy', 'reason', 'credential_refresh_in_flight'
    );
  end if;

  perform 1
    from public.calendar_outbox o
   where o.connection_id = v_connection.id
     and (
       (o.state = 'leased'
        and (o.lease_expires_at > now() or o.provider_effect_ambiguous))
       or (o.state = 'queued' and o.provider_effect_ambiguous)
     )
   for update;
  if found then
    return jsonb_build_object(
      'outcome', 'busy', 'reason', 'ambiguous_provider_write'
    );
  end if;

  perform 1
    from public.webhook_subscriptions s
   where s.connection_id = v_connection.id
     and s.revoked_at is null
     and s.renewal_lease_owner is not null
   for update;
  if found then
    return jsonb_build_object(
      'outcome', 'busy', 'reason', 'webhook_renewal_in_flight'
    );
  end if;

  v_finalized := public.calendar_begin_connection_disconnect(
    v_connection.id, 'unlink'
  );
  return jsonb_build_object(
    'outcome', case when v_finalized then 'revoked' else 'disconnecting' end,
    'count', 1,
    'connection_id', v_connection.id
  );
end $$;

-- Credential refresh is its own compare-and-swap domain.  Provider workers do
-- not write the sealed credential columns directly: a short lease serialises
-- refresh-token use, while credential_generation makes OAuth completion and
-- disconnect irrevocably supersede stale workers.
create or replace function public.api_claim_calendar_credential_refresh(
  p_company_id          uuid,
  p_connection_id       uuid,
  p_user_id             uuid,
  p_worker_id           text,
  p_expected_generation bigint default null,
  p_lease_seconds       integer default 120
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.calendar_connections%rowtype;
  v_expires_at timestamptz;
begin
  if nullif(btrim(p_worker_id), '') is null or length(p_worker_id) > 200 then
    raise exception 'calendar credential refresh worker id is required (max 200 chars)';
  end if;
  if p_expected_generation is not null and p_expected_generation < 1 then
    raise exception 'calendar credential generation must be positive';
  end if;
  if p_lease_seconds < 1 or p_lease_seconds > 900 then
    raise exception 'calendar credential refresh lease must be 1..900 seconds';
  end if;

  select * into v_connection
    from public.calendar_connections
   where id = p_connection_id
     and company_id = p_company_id
     and user_id = p_user_id
     and revoked_at is null
     and (
       (
         status = 'active'
         and exists (
           select 1 from public.company_members m
            where m.company_id = p_company_id and m.user_id = p_user_id
              and m.deactivated_at is null
         )
       )
       or (status = 'disconnected' and disconnect_cleanup_action is not null)
     )
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if p_expected_generation is not null
     and v_connection.credential_generation is distinct from p_expected_generation then
    return jsonb_build_object(
      'outcome', 'superseded',
      'credential_generation', v_connection.credential_generation
    );
  end if;
  if v_connection.credential_refresh_lease_owner is not null
     and v_connection.credential_refresh_lease_expires_at > now()
     and v_connection.credential_refresh_lease_owner is distinct from p_worker_id then
    return jsonb_build_object(
      'outcome', 'busy',
      'credential_generation', v_connection.credential_generation,
      'lease_expires_at', v_connection.credential_refresh_lease_expires_at
    );
  end if;

  v_expires_at := now() + make_interval(secs => p_lease_seconds);
  update public.calendar_connections
     set credential_refresh_lease_owner = p_worker_id,
         credential_refresh_lease_expires_at = v_expires_at
   where id = p_connection_id;

  return jsonb_build_object(
    'outcome', 'claimed',
    'connection_id', v_connection.id,
    'credential_generation', v_connection.credential_generation,
    'credential_ciphertext', v_connection.credential_ciphertext,
    'credential_iv', v_connection.credential_iv,
    'credential_key_version', v_connection.credential_key_version,
    'lease_expires_at', v_expires_at
  );
end $$;

create or replace function public.api_commit_calendar_credential_refresh(
  p_connection_id          uuid,
  p_worker_id              text,
  p_expected_generation    bigint,
  p_credential_ciphertext  text,
  p_credential_iv          text,
  p_credential_key_version text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.calendar_connections%rowtype;
  v_generation bigint;
begin
  if nullif(btrim(p_worker_id), '') is null then
    raise exception 'calendar credential refresh worker id is required';
  end if;
  select * into v_connection
    from public.calendar_connections
   where id = p_connection_id
   for update;
  if not found or v_connection.revoked_at is not null then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;
  -- A successful credential rotation can commit while the worker loses the
  -- database response.  Retrying the exact same sealed envelope is safe and
  -- must be distinguishable from a stale writer: authenticated encryption
  -- uses a fresh random IV for every rotation/reconnect, so equality of all
  -- three envelope fields at exactly expected+1 is evidence of this commit.
  if v_connection.credential_generation = p_expected_generation + 1
     and v_connection.credential_ciphertext is not distinct from
           p_credential_ciphertext
     and v_connection.credential_iv is not distinct from p_credential_iv
     and v_connection.credential_key_version is not distinct from
           p_credential_key_version then
    return jsonb_build_object(
      'outcome', 'committed',
      'credential_generation', v_connection.credential_generation,
      'idempotent', true
    );
  end if;
  if v_connection.credential_generation is distinct from p_expected_generation then
    return jsonb_build_object(
      'outcome', 'superseded',
      'credential_generation', v_connection.credential_generation
    );
  end if;
  if v_connection.credential_refresh_lease_owner is distinct from p_worker_id
     or v_connection.credential_refresh_lease_expires_at is null
     or v_connection.credential_refresh_lease_expires_at <= now() then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;

  update public.calendar_connections
     set credential_ciphertext = p_credential_ciphertext,
         credential_iv = p_credential_iv,
         credential_key_version = p_credential_key_version,
         credential_generation = credential_generation + 1,
         credential_refresh_lease_owner = null,
         credential_refresh_lease_expires_at = null,
         status = case when status = 'disconnected'
                       then 'disconnected' else 'active' end,
         last_error_code = null,
         last_error_detail = null,
         last_error_at = null
   where id = p_connection_id
  returning credential_generation into v_generation;

  return jsonb_build_object(
    'outcome', 'committed', 'credential_generation', v_generation
  );
end $$;

create or replace function public.api_retry_calendar_credential_refresh(
  p_connection_id       uuid,
  p_worker_id           text,
  p_expected_generation bigint,
  p_requires_reauth     boolean,
  p_error_code          text,
  p_error_detail        text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.calendar_connections%rowtype;
begin
  if nullif(btrim(p_worker_id), '') is null then
    raise exception 'calendar credential refresh worker id is required';
  end if;
  select * into v_connection
    from public.calendar_connections
   where id = p_connection_id
   for update;
  if not found or v_connection.revoked_at is not null then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;
  if v_connection.credential_generation is distinct from p_expected_generation then
    return jsonb_build_object(
      'outcome', 'superseded',
      'credential_generation', v_connection.credential_generation
    );
  end if;
  if v_connection.credential_refresh_lease_owner is distinct from p_worker_id
     or v_connection.credential_refresh_lease_expires_at is null
     or v_connection.credential_refresh_lease_expires_at <= now() then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;

  if v_connection.status = 'disconnected' and p_requires_reauth then
    -- invalid_grant during cleanup is irrecoverable: an offboarded member
    -- cannot reauthorize, and retaining a sealed dead token forever does not
    -- improve remote cleanup.  Finalize locally but say explicitly that the
    -- provider scrub/stopWatch could not be guaranteed.
    update public.webhook_subscriptions
       set status = 'revoked', revoked_at = now(),
           renewal_lease_owner = null, renewal_lease_expires_at = null,
           last_error_code = left(p_error_code, 100),
           last_error_detail = left(p_error_detail, 1000)
     where connection_id = p_connection_id and revoked_at is null;
    update public.calendar_outbox
       set state = 'cancelled', cancelled_at = now(),
           lease_owner = null, lease_expires_at = null,
           last_error_code = 'cleanup_abandoned_invalid_grant',
           last_error_detail = left(p_error_detail, 1000)
     where connection_id = p_connection_id
       and state in ('queued', 'leased');
    -- The task schedule did not change.  Keep pending and held reminder rows
    -- exactly as they are: once the dead calendar mapping is tombstoned, the
    -- scheduled-send guard can reconsider an already-due held row before its
    -- expiry.  Replanning here would delete pending rows and cannot recreate a
    -- reminder whose planned instant has already passed.
    update public.task_calendar_links
       set link_state = 'unlinked', unlinked_at = now(),
           last_sent_snapshot = null,
           last_sent_provider_version = null,
           last_sent_at = null,
           conflict_ours_snapshot = null,
           conflict_theirs_snapshot = null,
           conflict_detected_at = null,
           event_removed_at = null,
           refusal_code = null,
           refusal_detail = null,
           refused_at = null
     where connection_id = p_connection_id
       and link_state <> 'unlinked';
    update public.calendar_connections
       set status = 'revoked', revoked_at = now(),
           remote_cleanup_unconfirmed = true,
           credential_ciphertext = null,
           credential_iv = null,
           credential_key_version = null,
           credential_generation = credential_generation + 1,
           credential_refresh_lease_owner = null,
           credential_refresh_lease_expires_at = null,
           disconnect_cleanup_action = null,
           sync_cursor = null, cursor_updated_at = null,
           sync_due_at = null, pull_full_sync = false,
           pull_followup_requested = false,
           pull_lease_owner = null, pull_lease_expires_at = null,
           last_error_code = 'cleanup_abandoned_invalid_grant',
           last_error_detail = left(p_error_detail, 1000),
           last_error_at = now()
     where id = p_connection_id;
    update public.companies
       set calendar_cleanup_unconfirmed_at = coalesce(
             calendar_cleanup_unconfirmed_at, now()
           ),
           calendar_cleanup_unconfirmed_count =
             calendar_cleanup_unconfirmed_count + 1
     where id = v_connection.company_id and deleted_at is not null;
    return jsonb_build_object(
      'outcome', 'cleanup_abandoned',
      'remote_cleanup_failed', true
    );
  end if;

  update public.calendar_connections
     set credential_refresh_lease_owner = null,
         credential_refresh_lease_expires_at = null,
         status = case
           when status = 'disconnected' then 'disconnected'
           when p_requires_reauth then 'reauth_required'
           else status
         end,
         last_error_code = left(p_error_code, 100),
         last_error_detail = left(p_error_detail, 1000),
         last_error_at = now()
   where id = p_connection_id;

  return jsonb_build_object(
    'outcome', case when p_requires_reauth then 'reauth_required' else 'released' end,
    'credential_generation', v_connection.credential_generation
  );
end $$;

create or replace function public.api_request_calendar_owner_disclosure(
  p_connection_id uuid,
  p_reason        text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.calendar_connections%rowtype;
  v_generation bigint;
begin
  if p_reason not in ('reauth_required', 'sync_stale') then
    raise exception 'calendar owner disclosure reason is invalid';
  end if;
  select * into v_connection
    from public.calendar_connections c
   where c.id = p_connection_id
     and c.revoked_at is null
     and c.status in ('active', 'reauth_required')
     and exists (
       select 1 from public.company_members m
        where m.company_id = c.company_id and m.user_id = c.user_id
          and m.deactivated_at is null
     )
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  -- Reauthentication is the more actionable condition and must not be hidden
  -- by a generic stale-sync observation.
  if v_connection.owner_disclosure_reason = p_reason
     or (v_connection.owner_disclosure_reason = 'reauth_required'
         and p_reason = 'sync_stale') then
    return jsonb_build_object(
      'outcome', 'coalesced',
      'generation', v_connection.owner_disclosure_generation,
      'delivered', v_connection.owner_disclosure_sent_generation
                   = v_connection.owner_disclosure_generation
    );
  end if;
  update public.calendar_connections
     set owner_disclosure_reason = p_reason,
         owner_disclosure_generation = owner_disclosure_generation + 1,
         owner_disclosure_available_at = now(),
         owner_disclosure_started_at = now(),
         owner_disclosure_attempts = 0,
         owner_disclosure_sent_at = null,
         owner_disclosure_lease_owner = null,
         owner_disclosure_lease_expires_at = null,
         owner_disclosure_last_error_code = null,
         owner_disclosure_last_error_detail = null
   where id = p_connection_id
  returning owner_disclosure_generation into v_generation;
  return jsonb_build_object(
    'outcome', 'queued', 'generation', v_generation
  );
end $$;

create or replace function public.api_claim_calendar_owner_disclosures(
  p_worker_id     text,
  p_limit         integer default 25,
  p_lease_seconds integer default 120
) returns table (
  connection_id   uuid,
  company_id      uuid,
  user_id         uuid,
  reason          text,
  generation      bigint,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(p_worker_id), '') is null or length(p_worker_id) > 200 then
    raise exception 'calendar owner disclosure worker id is required';
  end if;
  if p_limit < 1 or p_limit > 100 then
    raise exception 'calendar owner disclosure claim limit must be 1..100';
  end if;
  if p_lease_seconds < 1 or p_lease_seconds > 900 then
    raise exception 'calendar owner disclosure lease must be 1..900 seconds';
  end if;
  return query
  with candidates as (
    select c.id
      from public.calendar_connections c
     where (
         (
           c.revoked_at is null
           and c.status in ('active', 'reauth_required')
           and exists (
             select 1 from public.company_members m
              where m.company_id = c.company_id and m.user_id = c.user_id
                and m.deactivated_at is null
           )
         )
         or (
           c.status = 'revoked'
           and c.owner_disclosure_reason = 'cleanup_failed'
         )
       )
       and c.owner_disclosure_reason is not null
       and c.owner_disclosure_sent_generation
             < c.owner_disclosure_generation
       and c.owner_disclosure_available_at <= now()
       and (c.owner_disclosure_lease_expires_at is null
            or c.owner_disclosure_lease_expires_at <= now())
     order by c.owner_disclosure_available_at, c.id
     for update of c skip locked
     limit p_limit
  )
  update public.calendar_connections c
     set owner_disclosure_lease_owner = p_worker_id,
         owner_disclosure_lease_expires_at =
           now() + make_interval(secs => p_lease_seconds),
         owner_disclosure_attempts = c.owner_disclosure_attempts + 1
    from candidates q
   where c.id = q.id
  returning c.id, c.company_id,
            case when c.owner_disclosure_reason = 'cleanup_failed'
              then (select co.owner_user_id from public.companies co
                     where co.id = c.company_id)
              else c.user_id end,
            c.owner_disclosure_reason,
            c.owner_disclosure_generation,
            c.owner_disclosure_lease_expires_at;
end $$;

create or replace function public.api_queue_stale_calendar_owner_disclosures(
  p_stale_before timestamptz,
  p_limit        integer default 25
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_stale_before is null or p_stale_before > now() then
    raise exception 'calendar stale disclosure cutoff must not be in the future';
  end if;
  if p_limit < 1 or p_limit > 100 then
    raise exception 'calendar stale disclosure queue limit must be 1..100';
  end if;
  with candidates as (
    select c.id
      from public.calendar_connections c
     where c.status = 'active' and c.revoked_at is null
       and coalesce(c.last_verified_at, c.created_at) < p_stale_before
       and c.owner_disclosure_reason is distinct from 'sync_stale'
       and exists (
         select 1 from public.company_members m
          where m.company_id = c.company_id and m.user_id = c.user_id
            and m.deactivated_at is null
       )
     order by coalesce(c.last_verified_at, c.created_at), c.id
     for update of c skip locked
     limit p_limit
  )
  update public.calendar_connections c
     set owner_disclosure_reason = 'sync_stale',
         owner_disclosure_generation = c.owner_disclosure_generation + 1,
         owner_disclosure_available_at = now(),
         owner_disclosure_started_at = now(),
         owner_disclosure_attempts = 0,
         owner_disclosure_sent_at = null,
         owner_disclosure_lease_owner = null,
         owner_disclosure_lease_expires_at = null,
         owner_disclosure_last_error_code = null,
         owner_disclosure_last_error_detail = null
    from candidates q
   where c.id = q.id;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.api_commit_calendar_owner_disclosure(
  p_connection_id uuid,
  p_worker_id     text,
  p_generation    bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.calendar_connections%rowtype;
begin
  select * into v_connection from public.calendar_connections
   where id = p_connection_id for update;
  if not found
     or v_connection.owner_disclosure_lease_owner is distinct from p_worker_id
     or v_connection.owner_disclosure_lease_expires_at is null
     or v_connection.owner_disclosure_lease_expires_at <= now() then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;
  if v_connection.owner_disclosure_generation is distinct from p_generation then
    update public.calendar_connections
       set owner_disclosure_lease_owner = null,
           owner_disclosure_lease_expires_at = null
     where id = p_connection_id;
    return jsonb_build_object('outcome', 'superseded');
  end if;
  update public.calendar_connections
     set owner_disclosure_sent_generation = p_generation,
         owner_disclosure_sent_at = now(),
         owner_disclosure_lease_owner = null,
         owner_disclosure_lease_expires_at = null,
         owner_disclosure_last_error_code = null,
         owner_disclosure_last_error_detail = null
   where id = p_connection_id;
  return jsonb_build_object('outcome', 'delivered');
end $$;

create or replace function public.api_retry_calendar_owner_disclosure(
  p_connection_id uuid,
  p_worker_id      text,
  p_generation     bigint,
  p_delay_seconds  integer,
  p_error_code     text,
  p_error_detail   text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.calendar_connections%rowtype;
begin
  if p_delay_seconds < 1 or p_delay_seconds > 86400 then
    raise exception 'calendar owner disclosure retry delay must be 1..86400 seconds';
  end if;
  select * into v_connection from public.calendar_connections
   where id = p_connection_id for update;
  if not found
     or v_connection.owner_disclosure_lease_owner is distinct from p_worker_id
     or v_connection.owner_disclosure_lease_expires_at is null
     or v_connection.owner_disclosure_lease_expires_at <= now() then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;
  if v_connection.owner_disclosure_generation is distinct from p_generation then
    update public.calendar_connections
       set owner_disclosure_lease_owner = null,
           owner_disclosure_lease_expires_at = null
     where id = p_connection_id;
    return jsonb_build_object('outcome', 'superseded');
  end if;
  update public.calendar_connections
     set owner_disclosure_available_at = now() + make_interval(secs => p_delay_seconds),
         owner_disclosure_lease_owner = null,
         owner_disclosure_lease_expires_at = null,
         owner_disclosure_last_error_code = left(p_error_code, 100),
         owner_disclosure_last_error_detail = left(p_error_detail, 1000)
   where id = p_connection_id;
  return jsonb_build_object('outcome', 'queued');
end $$;

create or replace function public.api_list_calendar_owner_disclosures(
  p_company_id uuid,
  p_user_id    uuid
) returns table (
  connection_id uuid,
  provider      text,
  reason        text,
  occurred_at   timestamptz,
  push_delivered_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.provider, c.owner_disclosure_reason,
         c.owner_disclosure_started_at, c.owner_disclosure_sent_at
    from public.calendar_connections c
    join public.companies co on co.id = c.company_id
   where c.company_id = p_company_id
     and c.owner_disclosure_reason is not null
     and exists (
       select 1 from public.company_members requester
        where requester.company_id = p_company_id
          and requester.user_id = p_user_id
          and requester.deactivated_at is null
     )
     and (
       (c.owner_disclosure_reason <> 'cleanup_failed' and c.user_id = p_user_id)
       or (c.owner_disclosure_reason = 'cleanup_failed'
           and co.owner_user_id = p_user_id)
     )
   order by c.owner_disclosure_started_at desc nulls last, c.id;
$$;

create or replace function public.api_install_calendar_webhook_subscription(
  p_company_id               uuid,
  p_connection_id            uuid,
  p_provider_subscription_id text,
  p_provider_resource_id     text,
  p_provider_calendar_id     text,
  p_client_state_hash        text,
  p_expires_at               timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_expires_at <= now() then
    raise exception 'calendar webhook subscription must expire in the future';
  end if;
  perform 1
    from public.calendar_connections c
    join public.companies co on co.id = c.company_id
   where c.id = p_connection_id
     and c.company_id = p_company_id
     and c.status = 'active'
     and c.revoked_at is null
     and co.deleted_at is null
   for update of c;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if exists (
    select 1 from public.webhook_subscriptions
     where provider_subscription_id = p_provider_subscription_id
       and revoked_at is null
       and connection_id <> p_connection_id
  ) then
    return jsonb_build_object('outcome', 'conflict');
  end if;

  update public.webhook_subscriptions
     set status = 'revoked', revoked_at = now(),
         renewal_generation = renewal_generation + 1,
         renewal_lease_owner = null, renewal_lease_expires_at = null
   where connection_id = p_connection_id
     and revoked_at is null
     and provider_subscription_id <> p_provider_subscription_id;

  insert into public.webhook_subscriptions as existing (
    company_id, connection_id, provider_subscription_id,
    provider_resource_id, provider_calendar_id, client_state_hash,
    status, expires_at, last_renewed_at, revoked_at
  ) values (
    p_company_id, p_connection_id, p_provider_subscription_id,
    p_provider_resource_id, p_provider_calendar_id,
    case when p_client_state_hash is null then null else lower(p_client_state_hash) end,
    'active', p_expires_at, now(), null
  )
  on conflict (provider_subscription_id) where revoked_at is null do update set
    company_id = excluded.company_id,
    connection_id = excluded.connection_id,
    provider_resource_id = excluded.provider_resource_id,
    provider_calendar_id = excluded.provider_calendar_id,
    client_state_hash = excluded.client_state_hash,
    status = 'active',
    expires_at = excluded.expires_at,
    last_renewed_at = now(),
    last_error_code = null,
    last_error_detail = null,
    renewal_generation = existing.renewal_generation + 1,
    renewal_attempts = 0,
    renewal_available_at = now(),
    renewal_lease_owner = null,
    renewal_lease_expires_at = null,
    revoked_at = null
  returning id into v_id;

  return jsonb_build_object(
    'outcome', 'installed', 'subscription_id', v_id
  );
end $$;

revoke execute on function public.api_create_calendar_oauth_state(
  uuid, uuid, text, text, text, text, text, text, text, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.api_consume_calendar_oauth_state(text)
  from public, anon, authenticated;
revoke execute on function public.api_purge_calendar_oauth_states(integer)
  from public, anon, authenticated;
revoke execute on function public.api_complete_calendar_connection(
  uuid, uuid, text, text, text, text, text, text, text, text, text,
  text, text, text, timestamptz, text)
  from public, anon, authenticated;
revoke execute on function public.api_revoke_calendar_connection(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.api_claim_calendar_credential_refresh(
  uuid, uuid, uuid, text, bigint, integer)
  from public, anon, authenticated;
revoke execute on function public.api_commit_calendar_credential_refresh(
  uuid, text, bigint, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.api_retry_calendar_credential_refresh(
  uuid, text, bigint, boolean, text, text)
  from public, anon, authenticated;
revoke execute on function public.api_request_calendar_owner_disclosure(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.api_claim_calendar_owner_disclosures(
  text, integer, integer) from public, anon, authenticated;
revoke execute on function public.api_queue_stale_calendar_owner_disclosures(
  timestamptz, integer) from public, anon, authenticated;
revoke execute on function public.api_commit_calendar_owner_disclosure(
  uuid, text, bigint) from public, anon, authenticated;
revoke execute on function public.api_retry_calendar_owner_disclosure(
  uuid, text, bigint, integer, text, text)
  from public, anon, authenticated;
revoke execute on function public.api_list_calendar_owner_disclosures(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.api_install_calendar_webhook_subscription(
  uuid, uuid, text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_create_calendar_oauth_state(
  uuid, uuid, text, text, text, text, text, text, text, timestamptz)
  to service_role;
grant execute on function public.api_consume_calendar_oauth_state(text)
  to service_role;
grant execute on function public.api_purge_calendar_oauth_states(integer)
  to service_role;
grant execute on function public.api_complete_calendar_connection(
  uuid, uuid, text, text, text, text, text, text, text, text, text,
  text, text, text, timestamptz, text)
  to service_role;
grant execute on function public.api_revoke_calendar_connection(uuid, uuid, uuid)
  to service_role;
grant execute on function public.api_claim_calendar_credential_refresh(
  uuid, uuid, uuid, text, bigint, integer)
  to service_role;
grant execute on function public.api_commit_calendar_credential_refresh(
  uuid, text, bigint, text, text, text)
  to service_role;
grant execute on function public.api_retry_calendar_credential_refresh(
  uuid, text, bigint, boolean, text, text)
  to service_role;
grant execute on function public.api_request_calendar_owner_disclosure(uuid, text)
  to service_role;
grant execute on function public.api_claim_calendar_owner_disclosures(
  text, integer, integer) to service_role;
grant execute on function public.api_queue_stale_calendar_owner_disclosures(
  timestamptz, integer) to service_role;
grant execute on function public.api_commit_calendar_owner_disclosure(
  uuid, text, bigint) to service_role;
grant execute on function public.api_retry_calendar_owner_disclosure(
  uuid, text, bigint, integer, text, text) to service_role;
grant execute on function public.api_list_calendar_owner_disclosures(uuid, uuid)
  to service_role;
grant execute on function public.api_install_calendar_webhook_subscription(
  uuid, uuid, text, text, text, text, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- Webhook renewal is a separate leased queue from inbound pulls.  A provider
-- watch can be renewed without suppressing notifications from the watch that
-- remains active while the replacement request is in flight.
-- ---------------------------------------------------------------------------
create or replace function public.api_claim_calendar_webhook_renewals(
  p_worker_id      text,
  p_limit          integer default 25,
  p_lease_seconds  integer default 120,
  p_within_seconds integer default 86400
) returns setof public.webhook_subscriptions
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(p_worker_id), '') is null or length(p_worker_id) > 200 then
    raise exception 'calendar webhook renewal worker id is required (max 200 chars)';
  end if;
  if p_limit < 1 or p_limit > 100 then
    raise exception 'calendar webhook renewal claim limit must be 1..100';
  end if;
  if p_lease_seconds < 1 or p_lease_seconds > 900 then
    raise exception 'calendar webhook renewal lease must be 1..900 seconds';
  end if;
  if p_within_seconds < 60 or p_within_seconds > 604800 then
    raise exception 'calendar webhook renewal window must be 60..604800 seconds';
  end if;

  -- A watch must never be renewed after its credential-bearing connection has
  -- stopped being active.  Tombstoning also invalidates any crashed claimant.
  update public.webhook_subscriptions s
     set status = 'revoked',
         revoked_at = coalesce(s.revoked_at, now()),
         renewal_generation = s.renewal_generation + 1,
         renewal_lease_owner = null,
         renewal_lease_expires_at = null
    from public.calendar_connections c
   where c.id = s.connection_id
     and s.revoked_at is null
     and (c.status not in ('active', 'disconnected') or c.revoked_at is not null);

  return query
  with candidates as (
    select s.id
      from public.webhook_subscriptions s
      join public.calendar_connections c on c.id = s.connection_id
      join public.companies co on co.id = c.company_id
     where c.status = 'active'
       and c.revoked_at is null
       and co.deleted_at is null
       and exists (
         select 1 from public.company_members m
          where m.company_id = c.company_id and m.user_id = c.user_id
            and m.deactivated_at is null
       )
       and s.status = 'active'
       and s.revoked_at is null
       and s.expires_at <= now() + make_interval(secs => p_within_seconds)
       and s.renewal_available_at <= now()
       and (s.renewal_lease_expires_at is null
            or s.renewal_lease_expires_at <= now())
     order by s.expires_at, s.id
     for update of c, s skip locked
     limit p_limit
  )
  update public.webhook_subscriptions s
     set renewal_lease_owner = p_worker_id,
         renewal_lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         renewal_attempts = s.renewal_attempts + 1
    from candidates q
   where s.id = q.id
  returning s.*;
end $$;

create or replace function public.api_commit_calendar_webhook_renewal(
  p_subscription_row_id      uuid,
  p_worker_id                 text,
  p_generation                bigint,
  p_provider_subscription_id  text,
  p_provider_resource_id      text,
  p_client_state_hash         text,
  p_expires_at                timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subscription public.webhook_subscriptions%rowtype;
  v_connection   public.calendar_connections%rowtype;
begin
  if nullif(btrim(p_provider_subscription_id), '') is null
     or length(p_provider_subscription_id) > 1000 then
    raise exception 'calendar provider subscription id is required (max 1000 chars)';
  end if;
  if p_provider_resource_id is not null
     and length(p_provider_resource_id) > 2000 then
    raise exception 'calendar provider resource id exceeds 2000 chars';
  end if;
  if p_client_state_hash is not null
     and lower(p_client_state_hash) !~ '^[0-9a-f]{64}$' then
    raise exception 'calendar client state hash must be 64 lowercase hex chars';
  end if;
  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'renewed calendar webhook must expire in the future';
  end if;

  select * into v_subscription
    from public.webhook_subscriptions
   where id = p_subscription_row_id
   for update;
  if not found
     or v_subscription.renewal_lease_owner is distinct from p_worker_id
     or v_subscription.renewal_lease_expires_at is null
     or v_subscription.renewal_lease_expires_at <= now() then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;
  if v_subscription.renewal_generation is distinct from p_generation then
    update public.webhook_subscriptions
       set renewal_available_at = now(), renewal_attempts = 0,
           renewal_lease_owner = null, renewal_lease_expires_at = null
     where id = p_subscription_row_id;
    return jsonb_build_object('outcome', 'superseded');
  end if;

  select * into v_connection
    from public.calendar_connections
   where id = v_subscription.connection_id
   for update;
  if not found or v_connection.status <> 'active'
     or v_connection.revoked_at is not null then
    update public.webhook_subscriptions
       set status = 'revoked', revoked_at = coalesce(revoked_at, now()),
           renewal_generation = renewal_generation + 1,
           renewal_lease_owner = null, renewal_lease_expires_at = null
     where id = p_subscription_row_id;
    return jsonb_build_object('outcome', 'connection_inactive');
  end if;

  perform 1
    from public.webhook_subscriptions
   where provider_subscription_id = p_provider_subscription_id
     and revoked_at is null
     and id <> p_subscription_row_id
   for update;
  if found then
    update public.webhook_subscriptions
       set renewal_available_at = now() + interval '5 minutes',
           renewal_lease_owner = null, renewal_lease_expires_at = null,
           last_error_code = 'provider_subscription_conflict',
           last_error_detail = 'The renewed provider subscription id is already live.'
     where id = p_subscription_row_id;
    return jsonb_build_object('outcome', 'conflict');
  end if;

  update public.webhook_subscriptions
     set provider_subscription_id = p_provider_subscription_id,
         provider_resource_id = p_provider_resource_id,
         client_state_hash = case when p_client_state_hash is null
                                  then null else lower(p_client_state_hash) end,
         status = 'active',
         expires_at = p_expires_at,
         last_renewed_at = now(),
         last_error_code = null,
         last_error_detail = null,
         renewal_generation = renewal_generation + 1,
         renewal_attempts = 0,
         renewal_available_at = now(),
         renewal_lease_owner = null,
         renewal_lease_expires_at = null,
         revoked_at = null
   where id = p_subscription_row_id
  returning * into v_subscription;

  return jsonb_build_object(
    'outcome', 'committed',
    'subscription_id', v_subscription.id,
    'generation', v_subscription.renewal_generation
  );
end $$;

create or replace function public.api_retry_calendar_webhook_renewal(
  p_subscription_row_id uuid,
  p_worker_id            text,
  p_generation           bigint,
  p_delay_seconds        integer,
  p_error_code           text,
  p_error_detail         text,
  p_requires_reauth      boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subscription public.webhook_subscriptions%rowtype;
  v_connection   public.calendar_connections%rowtype;
begin
  if p_delay_seconds < 1 or p_delay_seconds > 86400 then
    raise exception 'calendar webhook renewal retry delay must be 1..86400 seconds';
  end if;

  select * into v_subscription
    from public.webhook_subscriptions
   where id = p_subscription_row_id
   for update;
  if not found
     or v_subscription.renewal_lease_owner is distinct from p_worker_id
     or v_subscription.renewal_lease_expires_at is null
     or v_subscription.renewal_lease_expires_at <= now() then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;
  if v_subscription.renewal_generation is distinct from p_generation then
    update public.webhook_subscriptions
       set renewal_available_at = now(), renewal_attempts = 0,
           renewal_lease_owner = null, renewal_lease_expires_at = null
     where id = p_subscription_row_id;
    return jsonb_build_object('outcome', 'superseded');
  end if;

  select * into v_connection
    from public.calendar_connections
   where id = v_subscription.connection_id
   for update;
  if not found or v_connection.status <> 'active'
     or v_connection.revoked_at is not null then
    update public.webhook_subscriptions
       set status = 'revoked', revoked_at = coalesce(revoked_at, now()),
           renewal_generation = renewal_generation + 1,
           renewal_lease_owner = null, renewal_lease_expires_at = null,
           last_error_code = left(p_error_code, 100),
           last_error_detail = left(p_error_detail, 1000)
     where id = p_subscription_row_id;
    return jsonb_build_object('outcome', 'connection_inactive');
  end if;

  if p_requires_reauth then
    update public.calendar_connections
       set status = 'reauth_required',
           sync_due_at = null,
           pull_full_sync = false,
           pull_followup_requested = false,
           pull_lease_owner = null,
           pull_lease_expires_at = null,
           last_error_code = left(p_error_code, 100),
           last_error_detail = left(p_error_detail, 1000),
           last_error_at = now()
     where id = v_subscription.connection_id;
    update public.webhook_subscriptions
       set status = 'revoked', revoked_at = now(),
           renewal_generation = renewal_generation + 1,
           renewal_lease_owner = null, renewal_lease_expires_at = null,
           last_error_code = left(p_error_code, 100),
           last_error_detail = left(p_error_detail, 1000)
     where id = p_subscription_row_id;
    return jsonb_build_object('outcome', 'reauth_required');
  end if;

  if v_subscription.renewal_attempts >= 12 then
    update public.webhook_subscriptions
       set status = 'error',
           renewal_available_at = now() + make_interval(secs => p_delay_seconds),
           renewal_lease_owner = null, renewal_lease_expires_at = null,
           last_error_code = left(p_error_code, 100),
           last_error_detail = left(p_error_detail, 1000)
     where id = p_subscription_row_id;
    return jsonb_build_object('outcome', 'exhausted');
  end if;

  update public.webhook_subscriptions
     set status = 'active',
         renewal_available_at = now() + make_interval(secs => p_delay_seconds),
         renewal_lease_owner = null, renewal_lease_expires_at = null,
         last_error_code = left(p_error_code, 100),
         last_error_detail = left(p_error_detail, 1000)
   where id = p_subscription_row_id;
  return jsonb_build_object('outcome', 'queued');
end $$;

create or replace function public.api_claim_calendar_webhook_revocations(
  p_worker_id     text,
  p_limit         integer default 25,
  p_lease_seconds integer default 120
) returns setof public.webhook_subscriptions
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(p_worker_id), '') is null or length(p_worker_id) > 200 then
    raise exception 'calendar webhook revocation worker id is required (max 200 chars)';
  end if;
  if p_limit < 1 or p_limit > 100 then
    raise exception 'calendar webhook revocation claim limit must be 1..100';
  end if;
  if p_lease_seconds < 1 or p_lease_seconds > 900 then
    raise exception 'calendar webhook revocation lease must be 1..900 seconds';
  end if;
  return query
  with candidates as (
    select s.id
      from public.webhook_subscriptions s
      join public.calendar_connections c on c.id = s.connection_id
     where c.revoked_at is null
       and (
         c.status = 'disconnected'
         or (
           c.status = 'active'
           and exists (
             select 1 from public.company_members m
              where m.company_id = c.company_id and m.user_id = c.user_id
                and m.deactivated_at is null
           )
         )
       )
       and s.status = 'revoking' and s.revoked_at is null
       and s.renewal_available_at <= now()
       and (s.renewal_lease_expires_at is null
            or s.renewal_lease_expires_at <= now())
     order by s.renewal_available_at, s.id
     for update of c, s skip locked
     limit p_limit
  )
  update public.webhook_subscriptions s
     set renewal_lease_owner = p_worker_id,
         renewal_lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         renewal_attempts = s.renewal_attempts + 1
    from candidates q
   where s.id = q.id
  returning s.*;
end $$;

create or replace function public.api_commit_calendar_webhook_revocation(
  p_subscription_row_id uuid,
  p_worker_id            text,
  p_generation           bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subscription public.webhook_subscriptions%rowtype;
  v_finalized boolean;
begin
  select * into v_subscription
    from public.webhook_subscriptions
   where id = p_subscription_row_id
   for update;
  if not found or v_subscription.status <> 'revoking'
     or v_subscription.renewal_lease_owner is distinct from p_worker_id
     or v_subscription.renewal_lease_expires_at is null
     or v_subscription.renewal_lease_expires_at <= now() then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;
  if v_subscription.renewal_generation is distinct from p_generation then
    update public.webhook_subscriptions
       set renewal_lease_owner = null, renewal_lease_expires_at = null,
           renewal_available_at = now()
     where id = p_subscription_row_id;
    return jsonb_build_object('outcome', 'superseded');
  end if;
  update public.webhook_subscriptions
     set status = 'revoked', revoked_at = now(),
         renewal_lease_owner = null, renewal_lease_expires_at = null,
         last_error_code = null, last_error_detail = null
   where id = p_subscription_row_id;
  v_finalized := public.calendar_finalize_disconnected_connection(
    v_subscription.connection_id
  );
  return jsonb_build_object(
    'outcome', 'revoked', 'connection_finalized', v_finalized
  );
end $$;

create or replace function public.api_retry_calendar_webhook_revocation(
  p_subscription_row_id uuid,
  p_worker_id            text,
  p_generation           bigint,
  p_delay_seconds        integer,
  p_error_code           text,
  p_error_detail         text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subscription public.webhook_subscriptions%rowtype;
begin
  if p_delay_seconds < 1 or p_delay_seconds > 86400 then
    raise exception 'calendar webhook revocation retry delay must be 1..86400 seconds';
  end if;
  select * into v_subscription
    from public.webhook_subscriptions
   where id = p_subscription_row_id
   for update;
  if not found or v_subscription.status <> 'revoking'
     or v_subscription.renewal_lease_owner is distinct from p_worker_id
     or v_subscription.renewal_lease_expires_at is null
     or v_subscription.renewal_lease_expires_at <= now() then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;
  if v_subscription.renewal_generation is distinct from p_generation then
    update public.webhook_subscriptions
       set renewal_lease_owner = null, renewal_lease_expires_at = null,
           renewal_available_at = now()
     where id = p_subscription_row_id;
    return jsonb_build_object('outcome', 'superseded');
  end if;
  update public.webhook_subscriptions
     set renewal_available_at = now() + make_interval(secs => p_delay_seconds),
         renewal_lease_owner = null, renewal_lease_expires_at = null,
         last_error_code = left(p_error_code, 100),
         last_error_detail = left(p_error_detail, 1000)
   where id = p_subscription_row_id;
  return jsonb_build_object('outcome', 'queued');
end $$;

create or replace function public.api_abandon_calendar_webhook_revocation(
  p_subscription_row_id uuid,
  p_worker_id            text,
  p_generation           bigint,
  p_error_code           text,
  p_error_detail         text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection_id uuid;
  v_subscription public.webhook_subscriptions%rowtype;
  v_connection public.calendar_connections%rowtype;
  v_finalized boolean;
begin
  select s.connection_id into v_connection_id
    from public.webhook_subscriptions s where s.id = p_subscription_row_id;
  if not found then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;
  select * into v_connection
    from public.calendar_connections c
   where c.id = v_connection_id
   for update;
  if not found then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;
  select * into v_subscription
    from public.webhook_subscriptions s
   where s.id = p_subscription_row_id
     and s.connection_id = v_connection.id
   for update;
  if not found or v_subscription.status <> 'revoking'
     or v_subscription.renewal_lease_owner is distinct from p_worker_id
     or v_subscription.renewal_lease_expires_at is null
     or v_subscription.renewal_lease_expires_at <= now()
     or v_subscription.renewal_generation is distinct from p_generation then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;

  update public.webhook_subscriptions
     set status = 'revoked', revoked_at = now(),
         renewal_lease_owner = null, renewal_lease_expires_at = null,
         last_error_code = left(p_error_code, 100),
         last_error_detail = left(p_error_detail, 1000)
   where id = p_subscription_row_id;
  update public.calendar_connections
     set remote_cleanup_unconfirmed = true,
         last_error_code = left(p_error_code, 100),
         last_error_detail = left(p_error_detail, 1000),
         last_error_at = now()
   where id = v_connection.id;
  update public.companies
     set calendar_cleanup_unconfirmed_at = coalesce(
           calendar_cleanup_unconfirmed_at, now()
         ),
         calendar_cleanup_unconfirmed_count =
           calendar_cleanup_unconfirmed_count + 1
   where id = v_connection.company_id and deleted_at is not null;
  v_finalized := public.calendar_finalize_disconnected_connection(
    v_connection.id
  );
  return jsonb_build_object(
    'outcome', 'cleanup_abandoned',
    'remote_cleanup_failed', true,
    'connection_finalized', v_finalized
  );
end $$;

revoke execute on function public.api_claim_calendar_webhook_renewals(
  text, integer, integer, integer) from public, anon, authenticated;
revoke execute on function public.api_commit_calendar_webhook_renewal(
  uuid, text, bigint, text, text, text, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.api_retry_calendar_webhook_renewal(
  uuid, text, bigint, integer, text, text, boolean)
  from public, anon, authenticated;
revoke execute on function public.api_claim_calendar_webhook_revocations(
  text, integer, integer) from public, anon, authenticated;
revoke execute on function public.api_commit_calendar_webhook_revocation(
  uuid, text, bigint) from public, anon, authenticated;
revoke execute on function public.api_retry_calendar_webhook_revocation(
  uuid, text, bigint, integer, text, text)
  from public, anon, authenticated;
revoke execute on function public.api_abandon_calendar_webhook_revocation(
  uuid, text, bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.api_claim_calendar_webhook_renewals(
  text, integer, integer, integer) to service_role;
grant execute on function public.api_commit_calendar_webhook_renewal(
  uuid, text, bigint, text, text, text, timestamptz) to service_role;
grant execute on function public.api_retry_calendar_webhook_renewal(
  uuid, text, bigint, integer, text, text, boolean) to service_role;
grant execute on function public.api_claim_calendar_webhook_revocations(
  text, integer, integer) to service_role;
grant execute on function public.api_commit_calendar_webhook_revocation(
  uuid, text, bigint) to service_role;
grant execute on function public.api_retry_calendar_webhook_revocation(
  uuid, text, bigint, integer, text, text) to service_role;
grant execute on function public.api_abandon_calendar_webhook_revocation(
  uuid, text, bigint, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Durable/coalesced inbound pulls.  Webhook requests only prove that the
-- provider says "something changed"; the claimed worker performs the round
-- trip which alone may advance last_verified_at and the provider cursor.
-- ---------------------------------------------------------------------------
create or replace function public.api_request_calendar_pull(
  p_provider            text,
  p_subscription_id     text,
  p_resource_id         text,
  p_client_state_hash   text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subscription public.webhook_subscriptions%rowtype;
  v_connection   public.calendar_connections%rowtype;
begin
  select s.* into v_subscription
    from public.webhook_subscriptions s
    join public.calendar_connections c on c.id = s.connection_id
    join public.companies co on co.id = c.company_id
   where c.provider = p_provider
     and c.status = 'active'
     and c.revoked_at is null
     and co.deleted_at is null
     and exists (
       select 1 from public.company_members m
        where m.company_id = c.company_id and m.user_id = c.user_id
          and m.deactivated_at is null
     )
     and s.provider_subscription_id = p_subscription_id
     and s.status = 'active'
     and s.revoked_at is null
     and s.expires_at > now()
   for update of s;

  if not found
     or (p_provider = 'google'
         and v_subscription.provider_resource_id is not null
         and v_subscription.provider_resource_id is distinct from p_resource_id)
     or (v_subscription.client_state_hash is not null
         and v_subscription.client_state_hash is distinct from lower(p_client_state_hash)) then
    -- Do not reveal whether a guessed subscription id exists.
    return jsonb_build_object('outcome', 'ignored');
  end if;

  update public.webhook_subscriptions
     set last_notification_at = now()
   where id = v_subscription.id;

  update public.calendar_connections
     set sync_due_at = now(),
         -- A webhook arriving mid-page is a coalesced follow-up, not a reason
         -- to revoke the current worker's authority.  It may commit the cursor
         -- it actually read, after which exactly one immediate pull remains.
         pull_followup_requested = pull_followup_requested or (
           pull_lease_owner is not null
           and pull_lease_expires_at > now()
         ),
         pull_generation = pull_generation + case
           when pull_lease_owner is not null
             and pull_lease_expires_at > now() then 0 else 1 end
   where id = v_subscription.connection_id
     and status = 'active'
     and revoked_at is null
  returning * into v_connection;

  if not found then
    return jsonb_build_object('outcome', 'ignored');
  end if;
  return jsonb_build_object(
    'outcome', 'queued',
    'connection_id', v_connection.id,
    'generation', v_connection.pull_generation
  );
end $$;

create or replace function public.api_claim_due_calendar_pulls(
  p_worker_id     text,
  p_limit         integer default 25,
  p_lease_seconds integer default 120
) returns setof public.calendar_connections
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(p_worker_id), '') is null then
    raise exception 'calendar pull worker id is required';
  end if;
  if p_limit < 1 or p_limit > 100 then
    raise exception 'calendar pull claim limit must be 1..100';
  end if;
  if p_lease_seconds < 1 or p_lease_seconds > 900 then
    raise exception 'calendar pull lease must be 1..900 seconds';
  end if;

  return query
  with candidates as (
    select c.id
      from public.calendar_connections c
      join public.companies co on co.id = c.company_id
     where c.status = 'active'
       and c.revoked_at is null
       and co.deleted_at is null
       and exists (
         select 1 from public.company_members m
          where m.company_id = c.company_id and m.user_id = c.user_id
            and m.deactivated_at is null
       )
       and c.sync_due_at is not null
       and c.sync_due_at <= now()
       and (c.pull_lease_expires_at is null or c.pull_lease_expires_at <= now())
     order by c.sync_due_at, c.id
     for update skip locked
     limit p_limit
  )
  update public.calendar_connections c
     set pull_lease_owner = p_worker_id,
         pull_lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         pull_full_sync = (
           c.last_full_sync_at is null or c.full_sync_due_at <= now()
         ),
         last_sync_started_at = now()
    from candidates q
   where c.id = q.id
  returning c.*;
end $$;

create or replace function public.api_renew_calendar_pull_lease(
  p_connection_id uuid,
  p_worker_id      text,
  p_generation     bigint,
  p_lease_seconds  integer default 120
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.calendar_connections%rowtype;
  v_expires_at timestamptz;
begin
  if p_lease_seconds < 1 or p_lease_seconds > 900 then
    raise exception 'calendar pull lease must be 1..900 seconds';
  end if;
  select * into v_connection
    from public.calendar_connections
   where id = p_connection_id
   for update;
  if not found
     or v_connection.status <> 'active'
     or v_connection.revoked_at is not null
     or v_connection.pull_lease_owner is distinct from p_worker_id
     or v_connection.pull_lease_expires_at is null
     or v_connection.pull_lease_expires_at <= now() then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;
  if v_connection.pull_generation is distinct from p_generation then
    update public.calendar_connections
       set sync_due_at = least(coalesce(sync_due_at, now()), now()),
           pull_full_sync = false,
           pull_followup_requested = false,
           pull_lease_owner = null, pull_lease_expires_at = null
     where id = p_connection_id;
    return jsonb_build_object('outcome', 'superseded');
  end if;

  v_expires_at := now() + make_interval(secs => p_lease_seconds);
  update public.calendar_connections
     set pull_lease_expires_at = v_expires_at
   where id = p_connection_id;
  return jsonb_build_object(
    'outcome', 'renewed', 'lease_expires_at', v_expires_at
  );
end $$;

create or replace function public.api_commit_calendar_pull(
  p_connection_id uuid,
  p_worker_id      text,
  p_generation     bigint,
  p_sync_cursor    text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.calendar_connections%rowtype;
begin
  select * into v_connection
    from public.calendar_connections
   where id = p_connection_id
   for update;

  if not found
     or v_connection.pull_lease_owner is distinct from p_worker_id
     or v_connection.pull_lease_expires_at is null
     or v_connection.pull_lease_expires_at <= now() then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;

  if v_connection.pull_generation is distinct from p_generation then
    update public.calendar_connections
       set sync_due_at = least(coalesce(sync_due_at, now()), now()),
           pull_full_sync = false,
           pull_followup_requested = false,
           pull_lease_owner = null,
           pull_lease_expires_at = null,
           last_sync_completed_at = now()
     where id = p_connection_id;
    return jsonb_build_object('outcome', 'superseded');
  end if;

  update public.calendar_connections
     set sync_cursor = p_sync_cursor,
         cursor_updated_at = case when p_sync_cursor is null then null else now() end,
         -- Webhooks accelerate this poll to now; they are not the only source
         -- of truth.  A five-minute verification loop covers subscription
         -- expiry/renewal gaps and is what makes silence observable.
         sync_due_at = case when pull_followup_requested then now()
                            else now() + interval '5 minutes' end,
         last_full_sync_at = case when pull_full_sync then now()
                                  else last_full_sync_at end,
         full_sync_due_at = case when pull_full_sync
                                  then now() + interval '7 days'
                                  else full_sync_due_at end,
         pull_full_sync = false,
         pull_followup_requested = false,
         pull_lease_owner = null,
         pull_lease_expires_at = null,
         last_verified_at = now(),
         last_sync_completed_at = now(),
         last_error_code = null,
         last_error_detail = null,
         last_error_at = null,
         owner_disclosure_reason = case
           when owner_disclosure_reason = 'sync_stale' then null
           else owner_disclosure_reason end,
         owner_disclosure_available_at = case
           when owner_disclosure_reason = 'sync_stale' then null
           else owner_disclosure_available_at end,
         owner_disclosure_lease_owner = case
           when owner_disclosure_reason = 'sync_stale' then null
           else owner_disclosure_lease_owner end,
         owner_disclosure_lease_expires_at = case
           when owner_disclosure_reason = 'sync_stale' then null
           else owner_disclosure_lease_expires_at end,
         status = 'active'
   where id = p_connection_id;

  return jsonb_build_object('outcome', 'committed');
end $$;

create or replace function public.api_retry_calendar_pull(
  p_connection_id   uuid,
  p_worker_id        text,
  p_generation       bigint,
  p_delay_seconds    integer,
  p_error_code       text,
  p_error_detail     text,
  p_requires_reauth  boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.calendar_connections%rowtype;
begin
  if p_delay_seconds < 1 or p_delay_seconds > 86400 then
    raise exception 'calendar pull retry delay must be 1..86400 seconds';
  end if;

  select * into v_connection
    from public.calendar_connections
   where id = p_connection_id
   for update;
  if not found
     or v_connection.pull_lease_owner is distinct from p_worker_id
     or v_connection.pull_lease_expires_at is null
     or v_connection.pull_lease_expires_at <= now() then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;

  update public.calendar_connections
     set sync_due_at = case
           when pull_generation is distinct from p_generation
             or pull_followup_requested then now()
           else now() + make_interval(secs => p_delay_seconds)
         end,
         pull_lease_owner = null,
         pull_lease_expires_at = null,
         pull_full_sync = false,
         pull_followup_requested = false,
         last_sync_completed_at = now(),
         last_error_code = left(p_error_code, 100),
         last_error_detail = left(p_error_detail, 1000),
         last_error_at = now(),
         status = case when p_requires_reauth then 'reauth_required' else status end
   where id = p_connection_id;

  return jsonb_build_object('outcome', 'queued');
end $$;

-- ---------------------------------------------------------------------------
-- Provider write outbox claims and commits.
-- ---------------------------------------------------------------------------
create or replace function public.calendar_sync_mutation_lease_outcome(
  p_company_id        uuid,
  p_connection_id     uuid,
  p_task_id           uuid,
  p_worker_id         text,
  p_pull_generation   bigint,
  p_outbox_id         uuid,
  p_outbox_generation bigint
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_connection public.calendar_connections%rowtype;
  v_outbox     public.calendar_outbox%rowtype;
begin
  -- Every mutation takes the connection serialization row first.  Outbox
  -- proof then follows connection -> link -> task -> outbox, matching attention
  -- resolution and avoiding a revoke/worker lock inversion.
  select * into v_connection
    from public.calendar_connections
   where id = p_connection_id and company_id = p_company_id
   for update;
  if not found or v_connection.status <> 'active'
     or v_connection.revoked_at is not null then
    return 'disconnected';
  end if;

  if p_pull_generation is null then
    if p_outbox_id is null or p_outbox_generation is null then
      return 'invalid_lease_proof';
    end if;
    perform 1
      from public.task_calendar_links
     where company_id = p_company_id
       and connection_id = p_connection_id
       and task_id = p_task_id
     for update;
    perform 1
      from public.tasks
     where company_id = p_company_id and id = p_task_id
     for update;
    select * into v_outbox
      from public.calendar_outbox
     where id = p_outbox_id
       and company_id = p_company_id
       and connection_id = p_connection_id
       and task_id = p_task_id
     for update;
    if not found
       or v_outbox.state <> 'leased'
       or v_outbox.lease_owner is distinct from p_worker_id
       or v_outbox.lease_expires_at is null
       or v_outbox.lease_expires_at <= now() then
      return 'lease_lost';
    end if;
    if v_outbox.generation is distinct from p_outbox_generation then
      return 'superseded';
    end if;
    return 'current';
  end if;
  if p_outbox_id is not null or p_outbox_generation is not null then
    return 'invalid_lease_proof';
  end if;
  if v_connection.pull_lease_owner is distinct from p_worker_id
     or v_connection.pull_lease_expires_at is null
     or v_connection.pull_lease_expires_at <= now() then
    return 'lease_lost';
  end if;
  if v_connection.pull_generation is distinct from p_pull_generation then
    return 'superseded';
  end if;
  return 'current';
end $$;

revoke execute on function public.calendar_sync_mutation_lease_outcome(
  uuid, uuid, uuid, text, bigint, uuid, bigint)
  from public, anon, authenticated;

create or replace function public.api_claim_calendar_outbox(
  p_worker_id     text,
  p_limit         integer default 25,
  p_lease_seconds integer default 120
) returns setof public.calendar_outbox
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(p_worker_id), '') is null then
    raise exception 'calendar outbox worker id is required';
  end if;
  if p_limit < 1 or p_limit > 100 then
    raise exception 'calendar outbox claim limit must be 1..100';
  end if;
  if p_lease_seconds < 1 or p_lease_seconds > 900 then
    raise exception 'calendar outbox lease must be 1..900 seconds';
  end if;

  return query
  with candidates as (
    select o.id
      from public.calendar_outbox o
      join public.calendar_connections c on c.id = o.connection_id
      join public.companies co on co.id = c.company_id
     where c.revoked_at is null
       and (
         (
           c.status = 'active'
           and co.deleted_at is null
           and exists (
             select 1 from public.company_members m
              where m.company_id = c.company_id and m.user_id = c.user_id
                and m.deactivated_at is null
           )
         )
         or (
           c.status = 'disconnected'
           and (
             o.action = c.disconnect_cleanup_action
             or o.provider_effect_ambiguous
           )
         )
       )
       and o.available_at <= now()
       and (
         o.state = 'queued'
         or (o.state = 'leased' and o.lease_expires_at <= now())
       )
     order by o.available_at, o.created_at, o.id
     for update of c, o skip locked
     limit p_limit
  )
  update public.calendar_outbox o
     set state = 'leased',
         lease_owner = p_worker_id,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         attempts = o.attempts + 1,
         lease_generation = o.lease_generation + 1
    from candidates q
   where o.id = q.id
  returning o.*;
end $$;

create or replace function public.api_mark_calendar_outbox_effect_started(
  p_outbox_id  uuid,
  p_worker_id  text,
  p_generation bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox public.calendar_outbox%rowtype;
begin
  -- Read identity without a row lock, then take the shared serialization gate
  -- before the outbox row.  The worker calls this immediately before the first
  -- external write; after it commits, any timeout is durably ambiguous.
  select * into v_outbox
    from public.calendar_outbox where id = p_outbox_id;
  if not found then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;
  perform 1
    from public.calendar_connections
   where id = v_outbox.connection_id
   for update;
  if not found then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;
  select * into v_outbox
    from public.calendar_outbox
   where id = p_outbox_id
   for update;
  if not found
     or v_outbox.state <> 'leased'
     or v_outbox.lease_owner is distinct from p_worker_id
     or v_outbox.lease_expires_at is null
     or v_outbox.lease_expires_at <= now() then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;
  if v_outbox.generation is distinct from p_generation then
    return jsonb_build_object('outcome', 'superseded');
  end if;
  update public.calendar_outbox
     set provider_effect_ambiguous = true,
         provider_effect_lease_generation = coalesce(
           provider_effect_lease_generation, lease_generation
         ),
         updated_at = now()
   where id = p_outbox_id;
  return jsonb_build_object('outcome', 'marked');
end $$;

create or replace function public.api_commit_calendar_outbox_created(
  p_outbox_id             uuid,
  p_worker_id             text,
  p_generation            bigint,
  p_provider_event_id     text,
  p_provider_instance_id  text,
  p_provider_series_id    text,
  p_provider_version      text,
  p_start_at              timestamptz,
  p_end_at                timestamptz,
  p_time_zone             text,
  p_title                 text,
  p_description           text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox       public.calendar_outbox%rowtype;
  v_task         public.tasks%rowtype;
  v_connection   public.calendar_connections%rowtype;
  v_sent         jsonb;
  v_requested    jsonb;
  v_current      jsonb;
  v_link_id      uuid;
  v_followup     text;
  v_finalized    boolean;
  v_observed_mismatch boolean;
  v_conflict     boolean;
begin
  select * into v_outbox
    from public.calendar_outbox
   where id = p_outbox_id
   for update;
  if not found
     or v_outbox.action <> 'create'
     or v_outbox.state <> 'leased'
     or v_outbox.lease_owner is distinct from p_worker_id
     or v_outbox.lease_expires_at is null
     or v_outbox.lease_expires_at <= now() then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;
  if nullif(p_provider_event_id, '') is null
     or nullif(p_provider_instance_id, '') is null
     or p_provider_series_id is not distinct from p_provider_instance_id then
    raise exception 'calendar create commit requires an instance id, never a series id';
  end if;

  select * into v_task from public.tasks where id = v_outbox.task_id for update;
  select * into v_connection
    from public.calendar_connections where id = v_outbox.connection_id for update;
  v_sent := public.calendar_snapshot_from_fields(
    p_start_at, p_end_at, p_time_zone, p_title, p_description
  );
  v_requested := public.calendar_normalize_snapshot(
    v_outbox.requested_snapshot
  );
  v_observed_mismatch := v_sent is distinct from v_requested;
  v_current := public.calendar_task_snapshot(
    v_task.due_at, v_task.title, v_task.description,
    v_requested, v_connection.selected_calendar_timezone
  );
  v_conflict := v_observed_mismatch
    and v_connection.status = 'active'
    and v_connection.revoked_at is null
    and v_task.deleted_at is null
    and v_task.due_at is not null
    and public.calendar_task_in_sync_window(v_task.due_at)
    and v_task.assigned_user_id = v_connection.user_id
    and public.calendar_task_access_allowed(
      v_connection.user_id, v_task.company_id, v_task.conversation_id
    );

  if v_outbox.link_id is null then
    insert into public.task_calendar_links (
      company_id, connection_id, task_id,
      provider_event_id, provider_instance_id, provider_series_id,
      provider_version, link_state, base_snapshot, last_sent_snapshot,
      last_sent_provider_version, last_sent_at,
      conflict_ours_snapshot, conflict_theirs_snapshot,
      conflict_detected_at, last_provider_seen_at
    ) values (
      v_outbox.company_id, v_outbox.connection_id, v_outbox.task_id,
      p_provider_event_id, p_provider_instance_id, p_provider_series_id,
      p_provider_version, case when v_conflict then 'conflict' else 'active' end,
      case when v_observed_mismatch then v_requested else v_sent end,
      case when v_observed_mismatch then null else v_sent end,
      case when v_observed_mismatch then null else p_provider_version end,
      case when v_observed_mismatch then null else now() end,
      case when v_conflict then v_current else null end,
      case when v_conflict then v_sent else null end,
      case when v_conflict then now() else null end,
      now()
    ) returning id into v_link_id;
  else
    -- "Moved" after a provider removal creates a new occurrence but keeps the
    -- same task/link identity used by the attention card.
    update public.task_calendar_links
       set provider_event_id = p_provider_event_id,
           provider_instance_id = p_provider_instance_id,
           provider_series_id = p_provider_series_id,
           provider_version = p_provider_version,
           link_state = case when v_conflict then 'conflict' else 'active' end,
           base_snapshot = case when v_observed_mismatch
             then v_requested else v_sent end,
           last_sent_snapshot = case when v_observed_mismatch
             then null else v_sent end,
           last_sent_provider_version = case when v_observed_mismatch
             then null else p_provider_version end,
           last_sent_at = case when v_observed_mismatch then null else now() end,
           last_provider_seen_at = now(),
           conflict_ours_snapshot = case when v_conflict then v_current else null end,
           conflict_theirs_snapshot = case when v_conflict then v_sent else null end,
           conflict_detected_at = case when v_conflict then now() else null end,
           event_removed_at = null,
           refusal_code = null, refusal_detail = null, refused_at = null,
           unlinked_at = null
     where id = v_outbox.link_id
       and company_id = v_outbox.company_id
       and connection_id = v_outbox.connection_id
       and task_id = v_outbox.task_id
    returning id into v_link_id;
    if not found then
      raise exception 'calendar recreate link disappeared after provider create';
    end if;
  end if;

  update public.calendar_outbox
     set state = 'completed', completed_at = now(), link_id = v_link_id,
         lease_owner = null, lease_expires_at = null,
         provider_effect_ambiguous = false,
         provider_effect_lease_generation = null
   where id = p_outbox_id;

  if v_conflict then
    perform public.calendar_record_connection_conflict(v_connection.id);
    return jsonb_build_object(
      'outcome', 'conflict',
      'reason', 'create_observed_mismatch',
      'link_id', v_link_id,
      'connection_finalized', false
    );
  end if;

  -- A task may move while the provider request is in flight.  The remote event
  -- now exists, so record it first, then queue the CURRENT truth; never retry
  -- create and duplicate the event.
  v_followup := case
    when v_connection.status = 'disconnected'
    then coalesce(v_connection.disconnect_cleanup_action, 'unlink')
    when not public.calendar_task_access_allowed(
      v_connection.user_id, v_task.company_id, v_task.conversation_id
    ) then 'scrub'
    when v_task.deleted_at is not null
      or v_task.due_at is null
      or not public.calendar_task_in_sync_window(v_task.due_at)
      or v_task.assigned_user_id is distinct from v_connection.user_id
    then 'unlink'
    -- A mismatched observation is never an agreed base.  If cleanup does not
    -- win above, the eligible case returned conflict before this expression.
    when not v_observed_mismatch and v_current is distinct from v_sent then 'upsert'
    else null
  end;
  if v_followup is not null then
    insert into public.calendar_outbox (
      company_id, connection_id, task_id, link_id, action,
      requested_snapshot, provider_precondition
    ) values (
      v_outbox.company_id, v_outbox.connection_id, v_outbox.task_id, v_link_id,
      v_followup,
      case when v_followup = 'upsert' then v_current else null end,
      p_provider_version
    );
  end if;

  v_finalized := public.calendar_finalize_disconnected_connection(
    v_connection.id
  );

  return jsonb_build_object(
    'outcome', case
      when v_outbox.generation is distinct from p_generation or v_followup is not null
      then 'followup_queued' else 'committed' end,
    'link_id', v_link_id,
    'connection_finalized', v_finalized
  );
end $$;

create or replace function public.api_commit_calendar_outbox_sent(
  p_outbox_id        uuid,
  p_worker_id        text,
  p_generation       bigint,
  p_provider_version text,
  p_start_at         timestamptz,
  p_end_at           timestamptz,
  p_time_zone        text,
  p_title            text,
  p_description      text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox     public.calendar_outbox%rowtype;
  v_task       public.tasks%rowtype;
  v_connection public.calendar_connections%rowtype;
  v_link       public.task_calendar_links%rowtype;
  v_sent       jsonb;
  v_current    jsonb;
  v_followup   text;
  v_finalized  boolean;
begin
  select * into v_outbox
    from public.calendar_outbox where id = p_outbox_id for update;
  if not found
     or v_outbox.action = 'create'
     or v_outbox.state <> 'leased'
     or v_outbox.lease_owner is distinct from p_worker_id
     or v_outbox.lease_expires_at is null
     or v_outbox.lease_expires_at <= now() then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;

  select * into v_link
    from public.task_calendar_links where id = v_outbox.link_id for update;
  select * into v_task from public.tasks where id = v_outbox.task_id for update;
  select * into v_connection
    from public.calendar_connections where id = v_outbox.connection_id for update;

  if p_start_at is null then
    -- Phase one annotates/unlinks rather than deleting provider events.
    update public.task_calendar_links
       set link_state = 'unlinked', unlinked_at = now(),
           provider_version = p_provider_version,
           last_sent_snapshot = null,
           last_sent_provider_version = null,
           last_sent_at = null
     where id = v_link.id;
  else
    v_sent := public.calendar_snapshot_from_fields(
      p_start_at, p_end_at, p_time_zone, p_title, p_description
    );
    update public.task_calendar_links
       set link_state = 'active',
           base_snapshot = v_sent,
           last_sent_snapshot = v_sent,
           last_sent_provider_version = p_provider_version,
           provider_version = p_provider_version,
           last_sent_at = now(),
           conflict_ours_snapshot = null,
           conflict_theirs_snapshot = null,
           conflict_detected_at = null,
           event_removed_at = null,
           refusal_code = null,
           refusal_detail = null,
           refused_at = null,
           unlinked_at = null
     where id = v_link.id;
  end if;

  update public.calendar_outbox
     set state = 'completed', completed_at = now(),
         lease_owner = null, lease_expires_at = null,
         provider_effect_ambiguous = false,
         provider_effect_lease_generation = null
   where id = p_outbox_id;

  if v_connection.status = 'disconnected'
     and (
       v_connection.disconnect_cleanup_action = 'scrub'
       or not public.calendar_task_access_allowed(
         v_connection.user_id, v_task.company_id, v_task.conversation_id
       )
     )
     and v_outbox.action <> 'scrub' then
    v_followup := 'scrub';
  elsif v_connection.status = 'disconnected' then
    -- A successful phase-one unlink is terminal for ordinary disconnect.  It
    -- must never fall through to the active-task branch and resurrect an
    -- upsert merely because the task itself remains eligible in Loonext.
    if p_start_at is not null then
      v_followup := coalesce(v_connection.disconnect_cleanup_action, 'unlink');
    end if;
  elsif not public.calendar_task_access_allowed(
      v_connection.user_id, v_task.company_id, v_task.conversation_id
    ) and v_outbox.action <> 'scrub' then
    v_followup := 'scrub';
  elsif v_task.deleted_at is null
     and v_task.due_at is not null
     and public.calendar_task_in_sync_window(v_task.due_at)
     and v_task.assigned_user_id = v_connection.user_id
     and public.calendar_task_access_allowed(
       v_connection.user_id, v_task.company_id, v_task.conversation_id
     ) then
    v_current := public.calendar_task_snapshot(
      v_task.due_at, v_task.title, v_task.description,
      case when p_start_at is null then v_link.base_snapshot else v_sent end,
      v_connection.selected_calendar_timezone
    );
    if p_start_at is null or v_current is distinct from v_sent then
      v_followup := 'upsert';
    end if;
  elsif p_start_at is not null then
    v_followup := 'unlink';
  end if;

  if v_followup is not null then
    insert into public.calendar_outbox (
      company_id, connection_id, task_id, link_id, action,
      requested_snapshot, provider_precondition
    ) values (
      v_outbox.company_id, v_outbox.connection_id, v_outbox.task_id,
      v_link.id, v_followup,
      case when v_followup = 'upsert' then v_current else null end,
      p_provider_version
    );
  end if;

  v_finalized := public.calendar_finalize_disconnected_connection(
    v_connection.id
  );

  return jsonb_build_object(
    'outcome', case
      when v_followup is not null then 'followup_queued'
      when v_outbox.generation is distinct from p_generation then 'followup_checked'
      else 'committed' end,
    'connection_finalized', v_finalized
  );
end $$;

create or replace function public.api_commit_calendar_outbox_scrubbed(
  p_outbox_id        uuid,
  p_worker_id        text,
  p_generation       bigint,
  p_provider_version text,
  p_provider_deleted boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox public.calendar_outbox%rowtype;
  v_link public.task_calendar_links%rowtype;
  v_task public.tasks%rowtype;
  v_connection public.calendar_connections%rowtype;
  v_current jsonb;
  v_followup_id uuid;
  v_finalized boolean;
begin
  select * into v_outbox from public.calendar_outbox
   where id = p_outbox_id for update;
  if not found or v_outbox.action <> 'scrub'
     or v_outbox.state <> 'leased'
     or v_outbox.lease_owner is distinct from p_worker_id
     or v_outbox.lease_expires_at is null
     or v_outbox.lease_expires_at <= now() then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;
  select * into v_link from public.task_calendar_links
   where id = v_outbox.link_id for update;
  select * into v_task from public.tasks
   where id = v_outbox.task_id for update;
  select * into v_connection from public.calendar_connections
   where id = v_outbox.connection_id for update;

  update public.task_calendar_links
     set link_state = 'unlinked', unlinked_at = now(),
         provider_version = case when p_provider_deleted then null
                                 else p_provider_version end,
         last_sent_snapshot = null,
         last_sent_provider_version = null,
         last_sent_at = null,
         conflict_ours_snapshot = null,
         conflict_theirs_snapshot = null,
         conflict_detected_at = null,
         event_removed_at = null,
         refusal_code = null,
         refusal_detail = null,
         refused_at = null
   where id = v_link.id;
  update public.calendar_outbox
     set state = 'completed', completed_at = now(),
         lease_owner = null, lease_expires_at = null,
         provider_effect_ambiguous = false,
         provider_effect_lease_generation = null
   where id = v_outbox.id;

  -- Access may be restored while the conditional delete/neutralising PATCH is
  -- in flight.  The scrubbed occurrence is never re-adopted; create a fresh
  -- occurrence from current truth so a deleted resource cannot be PATCHed.
  if v_connection.status = 'active'
     and v_connection.revoked_at is null
     and v_task.deleted_at is null
     and v_task.due_at is not null
     and public.calendar_task_in_sync_window(v_task.due_at)
     and v_task.assigned_user_id = v_connection.user_id
     and public.calendar_task_access_allowed(
       v_connection.user_id, v_task.company_id, v_task.conversation_id
     ) then
    v_current := public.calendar_task_snapshot(
      v_task.due_at, v_task.title, v_task.description, null,
      v_connection.selected_calendar_timezone
    );
    insert into public.calendar_outbox (
      company_id, connection_id, task_id, link_id, action,
      requested_snapshot, provider_precondition
    ) values (
      v_outbox.company_id, v_outbox.connection_id, v_outbox.task_id,
      v_link.id, 'create', v_current, null
    ) returning id into v_followup_id;
  end if;

  v_finalized := public.calendar_finalize_disconnected_connection(
    v_connection.id
  );
  return jsonb_build_object(
    'outcome', case when v_followup_id is null then 'committed'
                    else 'followup_queued' end,
    'provider_deleted', p_provider_deleted,
    'followup_outbox_id', v_followup_id,
    'connection_finalized', v_finalized
  );
end $$;

-- A mandatory confidentiality scrub can be unsafe at the provider boundary
-- (for example a Graph attendee/Teams event whose body cannot be neutralised
-- without notifying guests or corrupting meeting metadata).  A leased worker
-- may terminalize that exact scrub without claiming success.  The local link
-- is released so reminders are not held forever, while a durable owner/purge
-- disclosure records that provider cleanup remains unconfirmed.
create or replace function public.api_abandon_calendar_cleanup(
  p_outbox_id    uuid,
  p_worker_id    text,
  p_generation   bigint,
  p_error_code   text,
  p_error_detail text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection_id uuid;
  v_outbox public.calendar_outbox%rowtype;
  v_connection public.calendar_connections%rowtype;
  v_finalized boolean := false;
begin
  select o.connection_id into v_connection_id
    from public.calendar_outbox o where o.id = p_outbox_id;
  if not found then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;
  select * into v_connection
    from public.calendar_connections c
   where c.id = v_connection_id
   for update;
  if not found then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;
  select * into v_outbox
    from public.calendar_outbox o
   where o.id = p_outbox_id and o.connection_id = v_connection.id
   for update;
  if not found or v_outbox.action <> 'scrub'
     or v_outbox.state <> 'leased'
     or v_outbox.lease_owner is distinct from p_worker_id
     or v_outbox.lease_expires_at is null
     or v_outbox.lease_expires_at <= now()
     or v_outbox.generation is distinct from p_generation then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;

  if v_connection.status = 'disconnected' then
    update public.webhook_subscriptions
       set status = 'revoked', revoked_at = now(),
           renewal_generation = renewal_generation + 1,
           renewal_lease_owner = null, renewal_lease_expires_at = null,
           last_error_code = left(p_error_code, 100),
           last_error_detail = left(p_error_detail, 1000)
     where connection_id = v_connection.id and revoked_at is null;
    update public.calendar_outbox
       set state = 'cancelled', cancelled_at = now(),
           lease_owner = null, lease_expires_at = null,
           last_error_code = left(p_error_code, 100),
           last_error_detail = left(p_error_detail, 1000)
     where connection_id = v_connection.id and state in ('queued', 'leased');
    update public.task_calendar_links
       set link_state = 'unlinked', unlinked_at = now(),
           last_sent_snapshot = null,
           last_sent_provider_version = null,
           last_sent_at = null,
           conflict_ours_snapshot = null,
           conflict_theirs_snapshot = null,
           conflict_detected_at = null,
           event_removed_at = null,
           refusal_code = null,
           refusal_detail = null,
           refused_at = null
     where connection_id = v_connection.id and link_state <> 'unlinked';
    update public.calendar_connections
       set status = 'revoked', revoked_at = now(),
           remote_cleanup_unconfirmed = true,
           credential_ciphertext = null,
           credential_iv = null,
           credential_key_version = null,
           credential_generation = credential_generation + 1,
           credential_refresh_lease_owner = null,
           credential_refresh_lease_expires_at = null,
           disconnect_cleanup_action = null,
           sync_cursor = null, cursor_updated_at = null,
           sync_due_at = null, pull_full_sync = false,
           pull_followup_requested = false,
           pull_lease_owner = null, pull_lease_expires_at = null,
           last_error_code = left(p_error_code, 100),
           last_error_detail = left(p_error_detail, 1000),
           last_error_at = now()
     where id = v_connection.id;
    v_finalized := true;
  elsif v_connection.status in ('active', 'reauth_required')
        and v_connection.revoked_at is null then
    update public.calendar_outbox
       set state = 'cancelled', cancelled_at = now(),
           lease_owner = null, lease_expires_at = null,
           last_error_code = left(p_error_code, 100),
           last_error_detail = left(p_error_detail, 1000)
     where id = v_outbox.id;
    update public.task_calendar_links
       set link_state = 'unlinked', unlinked_at = now(),
           last_sent_snapshot = null,
           last_sent_provider_version = null,
           last_sent_at = null,
           conflict_ours_snapshot = null,
           conflict_theirs_snapshot = null,
           conflict_detected_at = null,
           event_removed_at = null,
           refusal_code = null,
           refusal_detail = null,
           refused_at = null
     where id = v_outbox.link_id;
    update public.calendar_connections
       set remote_cleanup_unconfirmed = true,
           last_error_code = left(p_error_code, 100),
           last_error_detail = left(p_error_detail, 1000),
           last_error_at = now()
     where id = v_connection.id;
  else
    return jsonb_build_object('outcome', 'lease_lost');
  end if;

  update public.companies
     set calendar_cleanup_unconfirmed_at = coalesce(
           calendar_cleanup_unconfirmed_at, now()
         ),
         calendar_cleanup_unconfirmed_count =
           calendar_cleanup_unconfirmed_count + 1
   where id = v_connection.company_id and deleted_at is not null;

  return jsonb_build_object(
    'outcome', 'cleanup_abandoned',
    'remote_cleanup_failed', true,
    'connection_finalized', v_finalized
  );
end $$;

create or replace function public.api_enqueue_calendar_push(
  p_company_id       uuid,
  p_connection_id    uuid,
  p_worker_id        text,
  p_pull_generation  bigint,
  p_task_id          uuid,
  p_link_id          uuid,
  p_provider_version text,
  p_snapshot         jsonb,
  p_outbox_id        uuid default null,
  p_outbox_generation bigint default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id         uuid;
  v_generation bigint;
  v_lease      text;
begin
  v_lease := public.calendar_sync_mutation_lease_outcome(
    p_company_id, p_connection_id, p_task_id, p_worker_id,
    p_pull_generation, p_outbox_id, p_outbox_generation
  );
  if v_lease <> 'current' then
    return jsonb_build_object('outcome', v_lease);
  end if;
  if not exists (
    select 1
      from public.task_calendar_links l
      join public.calendar_connections c on c.id = l.connection_id
      join public.tasks t on t.id = l.task_id and t.company_id = l.company_id
     where l.id = p_link_id
       and l.company_id = p_company_id
       and l.connection_id = p_connection_id
       and l.task_id = p_task_id
       and l.link_state = 'active'
       and c.status = 'active'
       and c.revoked_at is null
       and public.calendar_task_access_allowed(
         c.user_id, t.company_id, t.conversation_id
       )
  ) then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  insert into public.calendar_outbox (
    company_id, connection_id, task_id, link_id, action,
    requested_snapshot, provider_precondition
  ) values (
    p_company_id, p_connection_id, p_task_id, p_link_id, 'upsert',
    public.calendar_normalize_snapshot(p_snapshot), p_provider_version
  )
  on conflict (connection_id, task_id)
    where state in ('queued', 'leased')
  do update set
    link_id = case when public.calendar_outbox.provider_effect_ambiguous
      then public.calendar_outbox.link_id else excluded.link_id end,
    action = case when public.calendar_outbox.provider_effect_ambiguous
      then public.calendar_outbox.action else 'upsert' end,
    requested_snapshot = case when public.calendar_outbox.provider_effect_ambiguous
      then public.calendar_outbox.requested_snapshot else excluded.requested_snapshot end,
    provider_precondition = case when public.calendar_outbox.provider_effect_ambiguous
      then public.calendar_outbox.provider_precondition else excluded.provider_precondition end,
    generation = public.calendar_outbox.generation + 1,
    attempts = case when public.calendar_outbox.provider_effect_ambiguous
      then public.calendar_outbox.attempts else 0 end,
    available_at = least(public.calendar_outbox.available_at, now()),
    last_error_code = null,
    last_error_detail = null,
    updated_at = now()
  returning id, generation into v_id, v_generation;

  return jsonb_build_object(
    'outcome', 'queued', 'outbox_id', v_id, 'generation', v_generation
  );
end $$;

create or replace function public.api_retry_calendar_outbox(
  p_outbox_id       uuid,
  p_worker_id       text,
  p_generation      bigint,
  p_delay_seconds   integer,
  p_error_code      text,
  p_error_detail    text,
  p_requires_reauth boolean default false,
  p_effect_definitely_absent boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox public.calendar_outbox%rowtype;
begin
  if p_delay_seconds < 1 or p_delay_seconds > 86400 then
    raise exception 'calendar outbox retry delay must be 1..86400 seconds';
  end if;
  select * into v_outbox
    from public.calendar_outbox where id = p_outbox_id for update;
  if not found
     or v_outbox.state <> 'leased'
     or v_outbox.lease_owner is distinct from p_worker_id
     or v_outbox.lease_expires_at is null
     or v_outbox.lease_expires_at <= now() then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;

  if v_outbox.generation is distinct from p_generation then
    update public.calendar_outbox
       set state = 'queued', available_at = now(), attempts = 0,
           lease_owner = null, lease_expires_at = null,
           provider_effect_ambiguous = case
             when p_effect_definitely_absent
              and provider_effect_lease_generation = lease_generation then false
             else provider_effect_ambiguous
           end,
           provider_effect_lease_generation = case
             when p_effect_definitely_absent
              and provider_effect_lease_generation = lease_generation then null
             else provider_effect_lease_generation
           end,
           last_error_code = null, last_error_detail = null
     where id = p_outbox_id;
    return jsonb_build_object('outcome', 'superseded');
  end if;

  -- A timeout/error after a provider write can be ambiguous: the remote side
  -- effect may have succeeded even when no response arrived.  Never discard
  -- that reconciliation obligation solely because an attempt count was hit.
  update public.calendar_outbox
     set state = 'queued',
         available_at = now() + make_interval(secs => p_delay_seconds),
         lease_owner = null, lease_expires_at = null,
         provider_effect_ambiguous = case
           when p_effect_definitely_absent
            and provider_effect_lease_generation = lease_generation then false
           else provider_effect_ambiguous
         end,
         provider_effect_lease_generation = case
           when p_effect_definitely_absent
            and provider_effect_lease_generation = lease_generation then null
           else provider_effect_lease_generation
         end,
         last_error_code = left(p_error_code, 100),
         last_error_detail = left(p_error_detail, 1000)
   where id = p_outbox_id;
  update public.calendar_connections
     set status = case when p_requires_reauth then 'reauth_required' else status end,
         last_error_code = left(p_error_code, 100),
         last_error_detail = left(p_error_detail, 1000),
         last_error_at = now()
   where id = v_outbox.connection_id and revoked_at is null;

  return jsonb_build_object('outcome', 'queued');
end $$;

create or replace function public.api_cancel_calendar_outbox(
  p_outbox_id  uuid,
  p_worker_id  text,
  p_generation bigint,
  p_reason     text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox     public.calendar_outbox%rowtype;
  v_task       public.tasks%rowtype;
  v_connection public.calendar_connections%rowtype;
  v_ineligible boolean := false;
begin
  select * into v_outbox
    from public.calendar_outbox where id = p_outbox_id for update;
  if not found
     or v_outbox.state <> 'leased'
     or v_outbox.lease_owner is distinct from p_worker_id
     or v_outbox.lease_expires_at is null
     or v_outbox.lease_expires_at <= now() then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;

  if v_outbox.provider_effect_ambiguous then
    update public.calendar_outbox
       set state = 'queued', available_at = now(),
           lease_owner = null, lease_expires_at = null
     where id = p_outbox_id;
    return jsonb_build_object('outcome', 'ambiguous_effect');
  end if;

  if v_outbox.action = 'create' then
    select * into v_task from public.tasks where id = v_outbox.task_id;
    select * into v_connection
      from public.calendar_connections where id = v_outbox.connection_id;
    v_ineligible := v_task.deleted_at is not null
      or v_task.due_at is null
      or not public.calendar_task_in_sync_window(v_task.due_at)
      or v_task.assigned_user_id is distinct from v_connection.user_id
      or not public.calendar_task_access_allowed(
        v_connection.user_id, v_task.company_id, v_task.conversation_id
      );
  end if;

  -- A newer desired write must survive a stale worker's cancellation.  The one
  -- exception is an ineligible pre-provider create: no remote event exists and
  -- the newer generation is precisely the cancellation signal.
  if v_outbox.generation is distinct from p_generation and not v_ineligible then
    update public.calendar_outbox
       set state = 'queued', available_at = now(),
           lease_owner = null, lease_expires_at = null
     where id = p_outbox_id;
    return jsonb_build_object('outcome', 'superseded');
  end if;

  update public.calendar_outbox
     set state = 'cancelled', cancelled_at = now(),
         lease_owner = null, lease_expires_at = null,
         last_error_code = 'cancelled',
         last_error_detail = left(p_reason, 1000)
   where id = p_outbox_id;
  return jsonb_build_object('outcome', 'cancelled');
end $$;

create or replace function public.api_claim_calendar_reminder_replans(
  p_worker_id     text,
  p_limit         integer default 25,
  p_lease_seconds integer default 120
) returns setof public.calendar_reminder_replans
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(p_worker_id), '') is null then
    raise exception 'calendar reminder-replan worker id is required';
  end if;
  if p_limit < 1 or p_limit > 100 then
    raise exception 'calendar reminder-replan claim limit must be 1..100';
  end if;
  if p_lease_seconds < 1 or p_lease_seconds > 900 then
    raise exception 'calendar reminder-replan lease must be 1..900 seconds';
  end if;
  return query
  with candidates as (
    select r.id
      from public.calendar_reminder_replans r
      join public.companies co on co.id = r.company_id
     where co.deleted_at is null
       and r.available_at <= now()
       and (
         r.state = 'queued'
         or (r.state = 'leased' and r.lease_expires_at <= now())
       )
     order by r.available_at, r.created_at, r.id
     for update skip locked
     limit p_limit
  )
  update public.calendar_reminder_replans r
     set state = 'leased',
         lease_owner = p_worker_id,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         attempts = r.attempts + 1
    from candidates q
   where r.id = q.id
  returning r.*;
end $$;

create or replace function public.api_complete_calendar_reminder_replan(
  p_replan_id  uuid,
  p_worker_id  text,
  p_generation bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_replan public.calendar_reminder_replans%rowtype;
begin
  select * into v_replan
    from public.calendar_reminder_replans
   where id = p_replan_id
   for update;
  if not found
     or v_replan.state <> 'leased'
     or v_replan.lease_owner is distinct from p_worker_id
     or v_replan.lease_expires_at is null
     or v_replan.lease_expires_at <= now() then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;
  if v_replan.generation is distinct from p_generation then
    update public.calendar_reminder_replans
       set state = 'queued', attempts = 0, available_at = now(),
           lease_owner = null, lease_expires_at = null,
           last_error_code = null, last_error_detail = null
     where id = p_replan_id;
    return jsonb_build_object('outcome', 'superseded');
  end if;
  update public.calendar_reminder_replans
     set state = 'completed', completed_at = now(),
         lease_owner = null, lease_expires_at = null
   where id = p_replan_id;
  return jsonb_build_object('outcome', 'completed');
end $$;

create or replace function public.api_retry_calendar_reminder_replan(
  p_replan_id    uuid,
  p_worker_id    text,
  p_generation   bigint,
  p_delay_seconds integer,
  p_error_code   text,
  p_error_detail text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_replan public.calendar_reminder_replans%rowtype;
begin
  if p_delay_seconds < 1 or p_delay_seconds > 86400 then
    raise exception 'calendar reminder-replan retry delay must be 1..86400 seconds';
  end if;
  select * into v_replan
    from public.calendar_reminder_replans
   where id = p_replan_id
   for update;
  if not found
     or v_replan.state <> 'leased'
     or v_replan.lease_owner is distinct from p_worker_id
     or v_replan.lease_expires_at is null
     or v_replan.lease_expires_at <= now() then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;
  if v_replan.generation is distinct from p_generation then
    update public.calendar_reminder_replans
       set state = 'queued', attempts = 0, available_at = now(),
           lease_owner = null, lease_expires_at = null,
           last_error_code = null, last_error_detail = null
     where id = p_replan_id;
    return jsonb_build_object('outcome', 'superseded');
  end if;
  update public.calendar_reminder_replans
     set state = 'queued',
         available_at = now() + make_interval(secs => p_delay_seconds),
         lease_owner = null, lease_expires_at = null,
         last_error_code = left(p_error_code, 100),
         last_error_detail = left(p_error_detail, 1000)
   where id = p_replan_id;
  return jsonb_build_object('outcome', 'queued');
end $$;

-- ---------------------------------------------------------------------------
-- Atomic inbound application and attention states.
-- ---------------------------------------------------------------------------
create or replace function public.api_apply_calendar_provider_snapshot(
  p_company_id             uuid,
  p_connection_id          uuid,
  p_worker_id               text,
  p_pull_generation        bigint,
  p_task_id                uuid,
  p_provider_event_id      text,
  p_provider_instance_id   text,
  p_provider_series_id     text,
  p_provider_version       text,
  p_start_at               timestamptz,
  p_end_at                 timestamptz,
  p_time_zone              text,
  p_title                  text,
  p_description            text,
  p_outbox_id              uuid default null,
  p_outbox_generation      bigint default null,
  p_preserve_description   boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link         public.task_calendar_links%rowtype;
  v_task         public.tasks%rowtype;
  v_connection   public.calendar_connections%rowtype;
  v_reconcile_outbox public.calendar_outbox%rowtype;
  v_base         jsonb;
  v_last_sent    jsonb;
  v_ours         jsonb;
  v_theirs       jsonb;
  v_due_changed  boolean;
  v_lease        text;
  v_outbox_id    uuid;
  v_generation   bigint;
  v_cleanup_action text;
  v_prior_flag   text := coalesce(current_setting('loonext.calendar_provider_apply', true), '');
begin
  v_lease := public.calendar_sync_mutation_lease_outcome(
    p_company_id, p_connection_id, p_task_id, p_worker_id,
    p_pull_generation, p_outbox_id, p_outbox_generation
  );
  if v_lease <> 'current' then
    return jsonb_build_object('outcome', v_lease);
  end if;
  select * into v_link
    from public.task_calendar_links
   where company_id = p_company_id
     and connection_id = p_connection_id
     and task_id = p_task_id
     and provider_event_id = p_provider_event_id
     and provider_instance_id = p_provider_instance_id
     and provider_series_id is not distinct from p_provider_series_id
     and link_state in ('active', 'conflict', 'event_removed', 'refused')
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  select * into v_task from public.tasks where id = p_task_id for update;
  select * into v_connection
    from public.calendar_connections
   where id = p_connection_id and status = 'active' and revoked_at is null
   for update;
  if not found then
    return jsonb_build_object('outcome', 'disconnected');
  end if;

  -- Provider observations never make a deleted, locally unscheduled or
  -- reassigned task eligible again.  Preserve (or create) the unlink intent;
  -- in particular, do not let equality with the old base cancel a leased
  -- unlink during precondition reconciliation.
  if v_task.deleted_at is not null
     or v_task.assigned_user_id is distinct from v_connection.user_id
     or not public.calendar_task_access_allowed(
       v_connection.user_id, v_task.company_id, v_task.conversation_id
     )
     or (v_task.due_at is not null
         and not public.calendar_task_in_sync_window(v_task.due_at))
     or (v_task.due_at is null
         and v_link.link_state not in ('event_removed', 'refused')) then
    v_cleanup_action := case
      when not public.calendar_task_access_allowed(
        v_connection.user_id, v_task.company_id, v_task.conversation_id
      ) then 'scrub' else 'unlink' end;
    insert into public.calendar_outbox (
      company_id, connection_id, task_id, link_id, action,
      requested_snapshot, provider_precondition
    ) values (
      p_company_id, p_connection_id, p_task_id, v_link.id,
      v_cleanup_action, null, p_provider_version
    )
    on conflict (connection_id, task_id)
      where state in ('queued', 'leased')
    do update set
      link_id = case when public.calendar_outbox.provider_effect_ambiguous
        then public.calendar_outbox.link_id else excluded.link_id end,
      action = case when public.calendar_outbox.provider_effect_ambiguous
        then public.calendar_outbox.action else excluded.action end,
      requested_snapshot = case when public.calendar_outbox.provider_effect_ambiguous
        then public.calendar_outbox.requested_snapshot else null end,
      provider_precondition = case when public.calendar_outbox.provider_effect_ambiguous
        then public.calendar_outbox.provider_precondition else excluded.provider_precondition end,
      generation = public.calendar_outbox.generation + case
        when public.calendar_outbox.action = excluded.action
         and public.calendar_outbox.link_id = excluded.link_id
         and public.calendar_outbox.provider_precondition
             is not distinct from excluded.provider_precondition
        then 0 else 1 end,
      attempts = case
        when public.calendar_outbox.action = excluded.action
         and public.calendar_outbox.link_id = excluded.link_id
         and public.calendar_outbox.provider_precondition
             is not distinct from excluded.provider_precondition
        then public.calendar_outbox.attempts else 0 end,
      available_at = least(public.calendar_outbox.available_at, now()),
      last_error_code = null,
      last_error_detail = null,
      updated_at = now()
    returning id, generation into v_outbox_id, v_generation;
    return jsonb_build_object(
      'outcome', v_cleanup_action || '_queued',
      'outbox_id', v_outbox_id,
      'generation', v_generation
    );
  end if;

  v_base := public.calendar_normalize_snapshot(v_link.base_snapshot);

  -- The rolling provider window is a two-way contract, not merely an outbound
  -- seed filter.  A mapped occurrence dragged beyond -90/+365 cannot be
  -- applied to the task because no subsequent delta cursor can observe it.
  -- Likewise, provider text that cannot be stored losslessly is durable
  -- attention, never truncation and never a transaction-poisoning task write.
  if not public.calendar_task_in_sync_window(p_start_at) then
    return public.api_mark_calendar_refusal(
      p_company_id, p_connection_id, p_worker_id, p_pull_generation,
      p_task_id, p_provider_instance_id, p_provider_version,
      'outside_sync_window',
      'Provider occurrence is outside the supported sync window.',
      false, p_outbox_id, p_outbox_generation
    );
  end if;
  if not p_preserve_description
     and char_length(public.calendar_normalize_text(coalesce(p_description, '')))
       > 5000 then
    return public.api_mark_calendar_refusal(
      p_company_id, p_connection_id, p_worker_id, p_pull_generation,
      p_task_id, p_provider_instance_id, p_provider_version,
      'description_too_long',
      'Provider description exceeds 5000 characters.',
      false, p_outbox_id, p_outbox_generation
    );
  end if;
  if nullif(public.calendar_normalize_text(p_title), '') is null
     or char_length(public.calendar_normalize_text(p_title)) > 500 then
    return public.api_mark_calendar_refusal(
      p_company_id, p_connection_id, p_worker_id, p_pull_generation,
      p_task_id, p_provider_instance_id, p_provider_version,
      'invalid_title', 'Provider title is empty or exceeds 500 characters.',
      false, p_outbox_id, p_outbox_generation
    );
  end if;

  v_last_sent := case when v_link.last_sent_snapshot is null then null
                      else public.calendar_normalize_snapshot(v_link.last_sent_snapshot) end;
  v_ours := public.calendar_task_snapshot(
    v_task.due_at, v_task.title, v_task.description,
    v_base, v_connection.selected_calendar_timezone
  );
  v_theirs := public.calendar_snapshot_from_fields(
    p_start_at, p_end_at, p_time_zone, p_title,
    case when p_preserve_description then '' else p_description end
  );
  if p_preserve_description then
    -- Graph online-meeting bodies contain an opaque Teams blob.  Importing or
    -- hashing it would copy provider internals and a later PATCH could destroy
    -- join metadata.  Treat description as unchanged from the agreed base.
    v_theirs := jsonb_set(
      v_theirs, '{descriptionHash}',
      to_jsonb(coalesce(
        v_base->>'descriptionHash',
        public.calendar_snapshot_from_fields(
          p_start_at, p_end_at, p_time_zone, p_title, v_task.description
        )->>'descriptionHash'
      ))
    );
  end if;

  -- A PATCH may have been accepted even though its response was lost.  The
  -- retry then owns the same durable outbox intent, reads the provider state,
  -- and supplies that outbox lease as proof.  Equality with the exact
  -- requested snapshot is stronger evidence than the three-way base: retire
  -- the ambiguity as an observed echo, advance the base, and serialize any
  -- newer local truth as a fresh write.  Without this branch, O -> A (accepted
  -- remotely) -> local B would be misclassified as a human A-vs-B conflict.
  if p_outbox_id is not null then
    select * into v_reconcile_outbox
      from public.calendar_outbox
     where id = p_outbox_id
       and company_id = p_company_id
       and connection_id = p_connection_id
       and task_id = p_task_id
     for update;
  else
    -- A webhook pull can observe the accepted remote write before the outbox
    -- retry reclaims it.  The connection lock held by the pull proof
    -- serializes this lookup with claims/revoke, so matching the one live
    -- ambiguity is safe even without owning that outbox lease.
    select * into v_reconcile_outbox
      from public.calendar_outbox
     where company_id = p_company_id
       and connection_id = p_connection_id
       and task_id = p_task_id
       and state in ('queued', 'leased')
       and action = 'upsert'
       and provider_effect_ambiguous
       and requested_snapshot is not null
       and public.calendar_normalize_snapshot(requested_snapshot) = v_theirs
     for update;
  end if;
  if found then
    if found
       and v_reconcile_outbox.state = 'leased'
       and p_outbox_id is not null
       and (
         v_reconcile_outbox.lease_owner is distinct from p_worker_id
         or v_reconcile_outbox.lease_expires_at <= now()
         or v_reconcile_outbox.generation is distinct from p_outbox_generation
       ) then
      -- The helper normally returns before here; keep the row-level predicate
      -- explicit so future proof changes cannot turn a guessed id into echo
      -- authority.
      null;
    elsif v_reconcile_outbox.state in ('queued', 'leased')
       and v_reconcile_outbox.action = 'upsert'
       and v_reconcile_outbox.link_id = v_link.id
       and v_reconcile_outbox.provider_effect_ambiguous
       and public.calendar_normalize_snapshot(
             v_reconcile_outbox.requested_snapshot
           ) = v_theirs then
      update public.task_calendar_links
         set link_state = 'active',
             base_snapshot = v_theirs,
             provider_version = p_provider_version,
             last_sent_snapshot = null,
             last_sent_provider_version = null,
             last_sent_at = null,
             conflict_ours_snapshot = null,
             conflict_theirs_snapshot = null,
             conflict_detected_at = null,
             event_removed_at = null,
             refusal_code = null,
             refusal_detail = null,
             refused_at = null,
             unlinked_at = null,
             last_provider_seen_at = now()
       where id = v_link.id;
      update public.calendar_outbox
         set state = 'completed', completed_at = now(),
             lease_owner = null, lease_expires_at = null,
             provider_effect_ambiguous = false,
             provider_effect_lease_generation = null,
             last_error_code = null, last_error_detail = null
       where id = v_reconcile_outbox.id;

      if v_ours is distinct from v_theirs then
        insert into public.calendar_outbox (
          company_id, connection_id, task_id, link_id, action,
          requested_snapshot, provider_precondition
        ) values (
          p_company_id, p_connection_id, p_task_id, v_link.id, 'upsert',
          v_ours, p_provider_version
        ) returning id, generation into v_outbox_id, v_generation;
        return jsonb_build_object(
          'outcome', 'push_queued',
          'reason', 'ambiguous_effect_recovered',
          'outbox_id', v_outbox_id,
          'generation', v_generation
        );
      end if;
      return jsonb_build_object(
        'outcome', 'echo', 'reason', 'ambiguous_effect_recovered'
      );
    end if;
  end if;

  if v_ours is null then
    -- A removed/refused occurrence may later reappear as an ordinary timed
    -- provider event.  That new valid observation resolves the attention state
    -- unless the local task was independently deleted or reassigned.
    if v_link.link_state in ('event_removed', 'refused')
       and v_task.deleted_at is null
       and v_task.assigned_user_id = v_connection.user_id
       and public.calendar_task_access_allowed(
         v_connection.user_id, v_task.company_id, v_task.conversation_id
       ) then
      v_due_changed := v_task.due_at is distinct from p_start_at;
      perform set_config('loonext.calendar_provider_apply', 'on', true);
      update public.tasks
         set due_at = p_start_at,
             title = p_title,
             description = case when p_preserve_description
               then v_task.description else coalesce(p_description, '') end
       where id = p_task_id;
      perform set_config('loonext.calendar_provider_apply', v_prior_flag, true);
      if v_due_changed then
        delete from public.scheduled_messages
         where company_id = p_company_id
           and task_id = p_task_id
           and origin = 'reminder'
           and status = 'pending';
      end if;
      update public.task_calendar_links
         set link_state = 'active',
             base_snapshot = v_theirs,
             provider_version = p_provider_version,
             last_sent_snapshot = null,
             last_sent_provider_version = null,
             last_sent_at = null,
             conflict_ours_snapshot = null,
             conflict_theirs_snapshot = null,
             conflict_detected_at = null,
             event_removed_at = null,
             refusal_code = null,
             refusal_detail = null,
             refused_at = null,
             unlinked_at = null,
             last_provider_seen_at = now()
       where id = v_link.id;
      update public.calendar_outbox
         set state = 'cancelled', cancelled_at = now(),
             lease_owner = null, lease_expires_at = null
       where connection_id = p_connection_id and task_id = p_task_id
         and state in ('queued', 'leased');
      return jsonb_build_object(
        'outcome', 'provider_applied', 'recovered_from', v_link.link_state
      );
    end if;
    return jsonb_build_object('outcome', 'local_unscheduled');
  end if;

  -- Exact field equality, not version equality, proves an echo.  Echo evidence
  -- is one-shot: once that exact provider state is observed it is retired so a
  -- later human change back to the same values remains a real provider edit.
  if v_last_sent is not null and v_theirs = v_last_sent then
    update public.task_calendar_links
       set link_state = 'active',
           base_snapshot = v_last_sent,
           provider_version = p_provider_version,
           last_sent_snapshot = null,
           last_sent_provider_version = null,
           last_sent_at = null,
           conflict_ours_snapshot = null,
           conflict_theirs_snapshot = null,
           conflict_detected_at = null,
           event_removed_at = null,
           refusal_code = null,
           refusal_detail = null,
           refused_at = null,
           unlinked_at = null,
           last_provider_seen_at = now()
     where id = v_link.id;
    if v_ours = v_last_sent then
      update public.calendar_outbox
         set state = 'cancelled', cancelled_at = now(),
             lease_owner = null, lease_expires_at = null
       where connection_id = p_connection_id and task_id = p_task_id
         and state in ('queued', 'leased');
      return jsonb_build_object('outcome', 'echo');
    end if;
    perform public.api_enqueue_calendar_push(
      p_company_id, p_connection_id, p_worker_id, p_pull_generation,
      p_task_id, v_link.id,
      p_provider_version, v_ours, p_outbox_id, p_outbox_generation
    );
    return jsonb_build_object('outcome', 'push_queued', 'reason', 'echo_superseded');
  end if;

  if v_ours = v_base and v_theirs <> v_base then
    v_due_changed := v_task.due_at is distinct from p_start_at;
    perform set_config('loonext.calendar_provider_apply', 'on', true);
    update public.tasks
       set due_at = p_start_at,
           title = p_title,
           description = case when p_preserve_description
             then v_task.description else coalesce(p_description, '') end
     where id = p_task_id;
    perform set_config('loonext.calendar_provider_apply', v_prior_flag, true);

    if v_due_changed then
      delete from public.scheduled_messages
       where company_id = p_company_id
         and task_id = p_task_id
         and origin = 'reminder'
         and status = 'pending';
    end if;
    update public.task_calendar_links
       set link_state = 'active',
           base_snapshot = v_theirs,
           provider_version = p_provider_version,
           last_sent_snapshot = null,
           last_sent_provider_version = null,
           last_sent_at = null,
           conflict_ours_snapshot = null,
           conflict_theirs_snapshot = null,
           conflict_detected_at = null,
           event_removed_at = null,
           refusal_code = null,
           refusal_detail = null,
           refused_at = null,
           unlinked_at = null,
           last_provider_seen_at = now()
     where id = v_link.id;
    update public.calendar_outbox
       set state = 'cancelled', cancelled_at = now(),
           lease_owner = null, lease_expires_at = null
     where connection_id = p_connection_id and task_id = p_task_id
       and state in ('queued', 'leased');
    return jsonb_build_object('outcome', 'provider_applied');
  end if;

  if v_theirs = v_base and v_ours <> v_base then
    update public.task_calendar_links
       set link_state = 'active',
           provider_version = p_provider_version,
           last_sent_snapshot = null,
           last_sent_provider_version = null,
           last_sent_at = null,
           conflict_ours_snapshot = null,
           conflict_theirs_snapshot = null,
           conflict_detected_at = null,
           event_removed_at = null,
           refusal_code = null,
           refusal_detail = null,
           refused_at = null,
           unlinked_at = null,
           last_provider_seen_at = now()
     where id = v_link.id;
    perform public.api_enqueue_calendar_push(
      p_company_id, p_connection_id, p_worker_id, p_pull_generation,
      p_task_id, v_link.id,
      p_provider_version, v_ours, p_outbox_id, p_outbox_generation
    );
    return jsonb_build_object('outcome', 'push_queued', 'reason', 'only_local_changed');
  end if;

  if v_ours = v_theirs then
    update public.task_calendar_links
       set link_state = 'active',
           base_snapshot = v_theirs,
           provider_version = p_provider_version,
           last_sent_snapshot = null,
           last_sent_provider_version = null,
           last_sent_at = null,
           conflict_ours_snapshot = null,
           conflict_theirs_snapshot = null,
           conflict_detected_at = null,
           event_removed_at = null,
           refusal_code = null,
           refusal_detail = null,
           refused_at = null,
           unlinked_at = null,
           last_provider_seen_at = now()
     where id = v_link.id;
    update public.calendar_outbox
       set state = 'cancelled', cancelled_at = now(),
           lease_owner = null, lease_expires_at = null
     where connection_id = p_connection_id and task_id = p_task_id
       and state in ('queued', 'leased');
    return jsonb_build_object('outcome', 'converged');
  end if;

  update public.task_calendar_links
     set link_state = 'conflict',
         provider_version = p_provider_version,
         last_sent_snapshot = null,
         last_sent_provider_version = null,
         last_sent_at = null,
         conflict_ours_snapshot = v_ours,
         conflict_theirs_snapshot = v_theirs,
         conflict_detected_at = now(),
         last_provider_seen_at = now()
   where id = v_link.id;
  if v_link.link_state <> 'conflict' then
    perform public.calendar_record_connection_conflict(p_connection_id);
  end if;
  update public.calendar_outbox
     set state = 'cancelled', cancelled_at = now(),
         lease_owner = null, lease_expires_at = null
   where connection_id = p_connection_id and task_id = p_task_id
     and state in ('queued', 'leased');
  return jsonb_build_object('outcome', 'conflict');
end $$;

create or replace function public.api_mark_calendar_conflict(
  p_company_id       uuid,
  p_connection_id    uuid,
  p_worker_id        text,
  p_pull_generation  bigint,
  p_task_id          uuid,
  p_provider_version text,
  p_ours_snapshot    jsonb,
  p_theirs_snapshot  jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease text;
begin
  v_lease := public.calendar_sync_mutation_lease_outcome(
    p_company_id, p_connection_id, p_task_id, p_worker_id,
    p_pull_generation, null, null
  );
  if v_lease <> 'current' then
    return jsonb_build_object('outcome', v_lease);
  end if;
  update public.task_calendar_links
     set provider_version = p_provider_version,
         conflict_ours_snapshot = public.calendar_normalize_snapshot(p_ours_snapshot),
         conflict_theirs_snapshot = public.calendar_normalize_snapshot(p_theirs_snapshot),
         last_provider_seen_at = now()
   where company_id = p_company_id
     and connection_id = p_connection_id
     and task_id = p_task_id
     and link_state = 'conflict';
  if found then
    return jsonb_build_object('outcome', 'conflict');
  end if;
  update public.task_calendar_links
     set link_state = 'conflict',
         provider_version = p_provider_version,
         last_sent_snapshot = null,
         last_sent_provider_version = null,
         last_sent_at = null,
         conflict_ours_snapshot = public.calendar_normalize_snapshot(p_ours_snapshot),
         conflict_theirs_snapshot = public.calendar_normalize_snapshot(p_theirs_snapshot),
         conflict_detected_at = now(),
         last_provider_seen_at = now()
   where company_id = p_company_id
     and connection_id = p_connection_id
     and task_id = p_task_id
     and link_state = 'active';
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;

  perform public.calendar_record_connection_conflict(p_connection_id);

  update public.calendar_outbox
     set state = 'cancelled', cancelled_at = now(),
         lease_owner = null, lease_expires_at = null
   where connection_id = p_connection_id and task_id = p_task_id
     and state in ('queued', 'leased');
  return jsonb_build_object('outcome', 'conflict');
end $$;

create or replace function public.api_mark_calendar_event_removed(
  p_company_id            uuid,
  p_connection_id         uuid,
  p_worker_id             text,
  p_pull_generation      bigint,
  p_task_id               uuid,
  p_provider_instance_id  text,
  p_provider_version      text,
  p_outbox_id             uuid default null,
  p_outbox_generation     bigint default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease text;
  v_cleanup_outbox public.calendar_outbox%rowtype;
  v_link public.task_calendar_links%rowtype;
  v_task public.tasks%rowtype;
  v_connection public.calendar_connections%rowtype;
  v_current jsonb;
  v_followup_id uuid;
  v_prior_flag text := coalesce(current_setting('loonext.calendar_provider_apply', true), '');
begin
  v_lease := public.calendar_sync_mutation_lease_outcome(
    p_company_id, p_connection_id, p_task_id, p_worker_id,
    p_pull_generation, p_outbox_id, p_outbox_generation
  );
  if v_lease <> 'current' then
    return jsonb_build_object('outcome', v_lease);
  end if;
  -- A security scrub may have conditionally deleted our provider occurrence
  -- before its response was lost.  A webhook tombstone is then success
  -- evidence for that durable intent, not a human cancellation of the task.
  -- Pull proof holds the connection serialization row; lock and retire the
  -- exact one-live ambiguous scrub without clearing the app due/reminders.
  select * into v_cleanup_outbox
    from public.calendar_outbox o
   where o.company_id = p_company_id
     and o.connection_id = p_connection_id
     and o.task_id = p_task_id
     and o.action = 'scrub'
     and o.state in ('queued', 'leased')
     and o.provider_effect_ambiguous
   for update;
  if found then
    select * into v_link
      from public.task_calendar_links l
     where l.id = v_cleanup_outbox.link_id
       and l.company_id = p_company_id
       and l.connection_id = p_connection_id
       and l.task_id = p_task_id
       and l.provider_instance_id = p_provider_instance_id
     for update;
    if found then
      select * into v_task from public.tasks
       where id = p_task_id and company_id = p_company_id for update;
      select * into v_connection from public.calendar_connections
       where id = p_connection_id and company_id = p_company_id for update;
      update public.task_calendar_links
         set link_state = 'unlinked', unlinked_at = now(),
             provider_version = null,
             last_sent_snapshot = null,
             last_sent_provider_version = null,
             last_sent_at = null,
             conflict_ours_snapshot = null,
             conflict_theirs_snapshot = null,
             conflict_detected_at = null,
             event_removed_at = null,
             refusal_code = null,
             refusal_detail = null,
             refused_at = null,
             last_provider_seen_at = now()
       where id = v_link.id;
      update public.calendar_outbox
         set state = 'completed', completed_at = now(),
             lease_owner = null, lease_expires_at = null,
             provider_effect_ambiguous = false,
             provider_effect_lease_generation = null,
             last_error_code = null, last_error_detail = null
       where id = v_cleanup_outbox.id;

      -- Access may have been restored while the delete was in flight.  The
      -- deleted occurrence is never patched; current truth gets a fresh create.
      if v_connection.status = 'active'
         and v_connection.revoked_at is null
         and v_task.deleted_at is null
         and v_task.due_at is not null
         and public.calendar_task_in_sync_window(v_task.due_at)
         and v_task.assigned_user_id = v_connection.user_id
         and public.calendar_task_access_allowed(
           v_connection.user_id, v_task.company_id, v_task.conversation_id
         ) then
        v_current := public.calendar_task_snapshot(
          v_task.due_at, v_task.title, v_task.description, null,
          v_connection.selected_calendar_timezone
        );
        insert into public.calendar_outbox (
          company_id, connection_id, task_id, link_id, action,
          requested_snapshot, provider_precondition
        ) values (
          p_company_id, p_connection_id, p_task_id, v_link.id,
          'create', v_current, null
        ) returning id into v_followup_id;
      end if;
      perform public.calendar_finalize_disconnected_connection(p_connection_id);
      return jsonb_build_object(
        'outcome', 'event_removed',
        'reason', 'scrub_effect_recovered',
        'followup_outbox_id', v_followup_id
      );
    end if;
  end if;
  update public.task_calendar_links
     set provider_version = p_provider_version,
         last_provider_seen_at = now()
   where company_id = p_company_id
     and connection_id = p_connection_id
     and task_id = p_task_id
     and provider_instance_id = p_provider_instance_id
     and link_state = 'event_removed';
  if found then
    return jsonb_build_object('outcome', 'event_removed');
  end if;
  -- A provider removal observed after a true three-way conflict is additional
  -- provider evidence, not permission to erase the still-unresolved app edit.
  -- Keep the conflict snapshots/task due intact so the human can still choose
  -- the app value; event_removed_at records the newer provider condition and
  -- makes replay idempotent while the pull cursor is allowed to advance.
  update public.task_calendar_links
     set provider_version = p_provider_version,
         event_removed_at = coalesce(event_removed_at, now()),
         refusal_code = null,
         refusal_detail = null,
         refused_at = null,
         last_provider_seen_at = now()
   where company_id = p_company_id
     and connection_id = p_connection_id
     and task_id = p_task_id
     and provider_instance_id = p_provider_instance_id
     and link_state = 'conflict';
  if found then
    return jsonb_build_object(
      'outcome', 'event_removed', 'attention_state', 'conflict'
    );
  end if;
  update public.task_calendar_links
     set link_state = 'event_removed', event_removed_at = now(),
         provider_version = p_provider_version,
         last_sent_snapshot = null,
         last_sent_provider_version = null,
         last_sent_at = null,
         conflict_ours_snapshot = null,
         conflict_theirs_snapshot = null,
         conflict_detected_at = null,
         refusal_code = null,
         refusal_detail = null,
         refused_at = null,
         last_provider_seen_at = now()
   where company_id = p_company_id
     and connection_id = p_connection_id
     and task_id = p_task_id
     and provider_instance_id = p_provider_instance_id
     and link_state in ('active', 'refused');
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;

  perform set_config('loonext.calendar_provider_apply', 'on', true);
  update public.tasks set due_at = null where id = p_task_id and company_id = p_company_id;
  perform set_config('loonext.calendar_provider_apply', v_prior_flag, true);
  delete from public.scheduled_messages
   where company_id = p_company_id and task_id = p_task_id
     and origin = 'reminder' and status = 'pending';
  update public.calendar_outbox
     set state = 'cancelled', cancelled_at = now(),
         lease_owner = null, lease_expires_at = null
   where connection_id = p_connection_id and task_id = p_task_id
     and state in ('queued', 'leased');
  return jsonb_build_object('outcome', 'event_removed');
end $$;

-- A conflict-resolution route performs a fresh provider GET after rendering
-- an attention card.  A 404 or a newly non-scheduled occurrence is durable
-- provider evidence, but is not permission to erase the unresolved app edit.
-- This own-member CAS records that auxiliary condition without requiring a
-- pull/outbox lease.  Both the rendered app snapshot and provider version are
-- compared so a concurrent local edit or pull cannot be silently overwritten.
create or replace function public.api_observe_calendar_conflict_condition(
  p_company_id                  uuid,
  p_user_id                     uuid,
  p_link_id                     uuid,
  p_expected_provider_instance_id text,
  p_expected_app_snapshot       jsonb,
  p_expected_provider_version   text,
  p_provider_condition          text,
  p_observed_provider_version   text default null,
  p_refusal_code                text default null,
  p_refusal_detail              text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.calendar_connections%rowtype;
  v_link public.task_calendar_links%rowtype;
  v_task public.tasks%rowtype;
  v_current_app_snapshot jsonb;
begin
  if p_provider_condition not in ('event_removed', 'refused') then
    raise exception 'calendar conflict condition must be event_removed or refused';
  end if;
  if p_provider_condition = 'refused'
     and (nullif(p_observed_provider_version, '') is null
          or nullif(btrim(p_refusal_code), '') is null) then
    return jsonb_build_object('outcome', 'provider_observation_invalid');
  end if;
  if p_refusal_code is not null and length(p_refusal_code) > 100 then
    return jsonb_build_object('outcome', 'provider_observation_invalid');
  end if;
  if p_refusal_detail is not null and length(p_refusal_detail) > 1000 then
    return jsonb_build_object('outcome', 'provider_observation_invalid');
  end if;

  if not exists (
    select 1
      from public.company_members m
      join public.companies co on co.id = m.company_id
     where m.company_id = p_company_id
       and m.user_id = p_user_id
       and m.deactivated_at is null
       and co.deleted_at is null
  ) then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  select c.* into v_connection
    from public.task_calendar_links l
    join public.calendar_connections c on c.id = l.connection_id
   where l.id = p_link_id
     and l.company_id = p_company_id
     and c.company_id = p_company_id
     and c.user_id = p_user_id
     and c.status = 'active'
     and c.revoked_at is null
   for update of c;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  select * into v_link
    from public.task_calendar_links l
   where l.id = p_link_id
     and l.company_id = p_company_id
     and l.connection_id = v_connection.id
     and l.link_state = 'conflict'
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_link.provider_instance_id is distinct from
       p_expected_provider_instance_id then
    return jsonb_build_object('outcome', 'provider_instance_mismatch');
  end if;
  if v_link.provider_version is distinct from p_expected_provider_version then
    return jsonb_build_object(
      'outcome', 'attention_stale',
      'provider_version', v_link.provider_version
    );
  end if;

  select * into v_task
    from public.tasks t
   where t.id = v_link.task_id and t.company_id = p_company_id
   for update;
  if not found
     or not public.calendar_task_access_allowed(
       p_user_id, v_task.company_id, v_task.conversation_id
     ) then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  v_current_app_snapshot := public.calendar_task_snapshot(
    v_task.due_at, v_task.title, v_task.description,
    v_link.base_snapshot, v_connection.selected_calendar_timezone
  );
  if p_expected_app_snapshot is null
     or v_current_app_snapshot is null
     or v_current_app_snapshot is distinct from
        public.calendar_normalize_snapshot(p_expected_app_snapshot) then
    return jsonb_build_object(
      'outcome', 'attention_stale',
      'current_app_snapshot', v_current_app_snapshot
    );
  end if;

  if p_provider_condition = 'event_removed' then
    update public.task_calendar_links
       set event_removed_at = coalesce(event_removed_at, now()),
           refusal_code = null,
           refusal_detail = null,
           refused_at = null,
           last_provider_seen_at = now()
     where id = v_link.id;
  else
    update public.task_calendar_links
       set provider_version = p_observed_provider_version,
           refusal_code = p_refusal_code,
           refusal_detail = p_refusal_detail,
           refused_at = coalesce(refused_at, now()),
           event_removed_at = null,
           last_provider_seen_at = now()
     where id = v_link.id;
  end if;

  return jsonb_build_object(
    'outcome', 'observed',
    'provider_condition', p_provider_condition
  );
end $$;

create or replace function public.api_mark_calendar_refusal(
  p_company_id            uuid,
  p_connection_id         uuid,
  p_worker_id             text,
  p_pull_generation       bigint,
  p_task_id               uuid,
  p_provider_instance_id  text,
  p_provider_version      text,
  p_refusal_code          text,
  p_refusal_detail        text,
  p_clear_due             boolean default false,
  p_outbox_id             uuid default null,
  p_outbox_generation     bigint default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease text;
  v_prior_flag text := coalesce(current_setting('loonext.calendar_provider_apply', true), '');
begin
  v_lease := public.calendar_sync_mutation_lease_outcome(
    p_company_id, p_connection_id, p_task_id, p_worker_id,
    p_pull_generation, p_outbox_id, p_outbox_generation
  );
  if v_lease <> 'current' then
    return jsonb_build_object('outcome', v_lease);
  end if;
  update public.task_calendar_links
     set provider_version = p_provider_version,
         refusal_code = left(p_refusal_code, 100),
         refusal_detail = left(p_refusal_detail, 1000),
         last_provider_seen_at = now()
   where company_id = p_company_id
     and connection_id = p_connection_id
     and task_id = p_task_id
     and provider_instance_id = p_provider_instance_id
     and link_state = 'refused';
  if found then
    if p_clear_due then
      perform set_config('loonext.calendar_provider_apply', 'on', true);
      update public.tasks set due_at = null
       where id = p_task_id and company_id = p_company_id;
      perform set_config('loonext.calendar_provider_apply', v_prior_flag, true);
    end if;
    delete from public.scheduled_messages
     where company_id = p_company_id and task_id = p_task_id
       and origin = 'reminder' and status = 'pending';
    update public.calendar_outbox
       set state = 'cancelled', cancelled_at = now(),
           lease_owner = null, lease_expires_at = null
     where connection_id = p_connection_id and task_id = p_task_id
       and state in ('queued', 'leased');
    return jsonb_build_object('outcome', 'refused');
  end if;
  -- As with a deletion, an invalid/all-day provider observation cannot answer
  -- an existing conflict.  Retain the app-side snapshot and due instant even
  -- when p_clear_due is true; the refusal fields describe the newer provider
  -- condition without silently applying it.
  update public.task_calendar_links
     set provider_version = p_provider_version,
         refusal_code = left(p_refusal_code, 100),
         refusal_detail = left(p_refusal_detail, 1000),
         refused_at = coalesce(refused_at, now()),
         event_removed_at = null,
         last_provider_seen_at = now()
   where company_id = p_company_id
     and connection_id = p_connection_id
     and task_id = p_task_id
     and provider_instance_id = p_provider_instance_id
     and link_state = 'conflict';
  if found then
    return jsonb_build_object(
      'outcome', 'refused', 'attention_state', 'conflict'
    );
  end if;
  update public.task_calendar_links
     set link_state = 'refused', refused_at = now(),
         provider_version = p_provider_version,
         last_sent_snapshot = null,
         last_sent_provider_version = null,
         last_sent_at = null,
         refusal_code = left(p_refusal_code, 100),
         refusal_detail = left(p_refusal_detail, 1000),
         conflict_ours_snapshot = null,
         conflict_theirs_snapshot = null,
         conflict_detected_at = null,
         event_removed_at = null,
         last_provider_seen_at = now()
   where company_id = p_company_id
     and connection_id = p_connection_id
     and task_id = p_task_id
     and provider_instance_id = p_provider_instance_id
     and link_state in ('active', 'event_removed');
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;

  if p_clear_due then
    perform set_config('loonext.calendar_provider_apply', 'on', true);
    update public.tasks set due_at = null where id = p_task_id and company_id = p_company_id;
    perform set_config('loonext.calendar_provider_apply', v_prior_flag, true);
  end if;
  -- Unknown-zone/all-day work is never eligible for a confident reminder.
  delete from public.scheduled_messages
   where company_id = p_company_id and task_id = p_task_id
     and origin = 'reminder' and status = 'pending';
  update public.calendar_outbox
     set state = 'cancelled', cancelled_at = now(),
         lease_owner = null, lease_expires_at = null
   where connection_id = p_connection_id and task_id = p_task_id
     and state in ('queued', 'leased');
  return jsonb_build_object('outcome', 'refused');
end $$;

-- ---------------------------------------------------------------------------
-- Own-member attention surfaces and explicit human resolutions.  Provider
-- timestamps are display-only observations; no resolution compares clocks.
-- ---------------------------------------------------------------------------
create or replace function public.api_list_calendar_attention(
  p_company_id uuid,
  p_user_id    uuid,
  p_limit      integer default 50
) returns table (
  link_id                    uuid,
  task_id                    uuid,
  connection_id              uuid,
  provider                   text,
  provider_calendar_id       text,
  provider_calendar_name     text,
  provider_calendar_timezone text,
  provider_instance_id       text,
  provider_version           text,
  link_state                 text,
  provider_condition         text,
  task_title                 text,
  task_due_at                timestamptz,
  ours_snapshot              jsonb,
  theirs_snapshot            jsonb,
  ours_changed_at            timestamptz,
  ours_changed_by            uuid,
  ours_changed_by_name       text,
  provider_observed_at       timestamptz,
  attention_at               timestamptz,
  refusal_code               text,
  refusal_detail             text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit < 1 or p_limit > 100 then
    raise exception 'calendar attention limit must be 1..100';
  end if;
  if not exists (
    select 1 from public.company_members m
     where m.company_id = p_company_id and m.user_id = p_user_id
       and m.deactivated_at is null
  ) then
    return;
  end if;

  return query
  select
    l.id, l.task_id, l.connection_id, c.provider,
    c.selected_calendar_id, c.selected_calendar_name,
    c.selected_calendar_timezone,
    l.provider_instance_id, l.provider_version, l.link_state,
    case
      when l.link_state = 'conflict' and l.event_removed_at is not null
        then 'event_removed'
      when l.link_state = 'conflict' and l.refusal_code is not null
        then 'refused'
      else l.link_state
    end,
    t.title, t.due_at,
    case when l.link_state = 'conflict'
         then public.calendar_task_snapshot(
           t.due_at, t.title, t.description, l.base_snapshot,
           c.selected_calendar_timezone
         ) else l.base_snapshot end,
    l.conflict_theirs_snapshot,
    t.schedule_changed_at, t.schedule_changed_by,
    nullif(p.display_name, ''),
    l.last_provider_seen_at,
    coalesce(l.conflict_detected_at, l.event_removed_at, l.refused_at),
    l.refusal_code, l.refusal_detail
  from public.task_calendar_links l
  join public.calendar_connections c on c.id = l.connection_id
  join public.tasks t on t.id = l.task_id and t.company_id = l.company_id
  left join public.profiles p on p.user_id = t.schedule_changed_by
  where l.company_id = p_company_id
    and c.user_id = p_user_id
    and c.status = 'active'
    and c.revoked_at is null
    and public.calendar_task_access_allowed(
      p_user_id, t.company_id, t.conversation_id
    )
    and l.link_state in ('conflict', 'event_removed', 'refused')
  order by coalesce(
    l.conflict_detected_at, l.event_removed_at, l.refused_at, l.updated_at
  ) desc, l.id
  limit p_limit;
end $$;

create or replace function public.api_get_calendar_attention(
  p_company_id uuid,
  p_user_id    uuid,
  p_link_id    uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attention jsonb;
begin
  if not exists (
    select 1 from public.company_members m
     where m.company_id = p_company_id and m.user_id = p_user_id
       and m.deactivated_at is null
  ) then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  select jsonb_build_object(
    'link_id', l.id,
    'task_id', l.task_id,
    'connection_id', l.connection_id,
    'provider', c.provider,
    'provider_calendar_id', c.selected_calendar_id,
    'provider_calendar_name', c.selected_calendar_name,
    'provider_calendar_timezone', c.selected_calendar_timezone,
    'provider_instance_id', l.provider_instance_id,
    'provider_version', l.provider_version,
    'link_state', l.link_state,
    'provider_condition', case
      when l.link_state = 'conflict' and l.event_removed_at is not null
        then 'event_removed'
      when l.link_state = 'conflict' and l.refusal_code is not null
        then 'refused'
      else l.link_state
    end,
    'task_title', t.title,
    'task_due_at', t.due_at,
    -- conflict_ours_snapshot remains immutable evidence of the original
    -- three-way decision. The card token is the CURRENT canonical app state so
    -- a reload after a local edit can actually resolve instead of looping on
    -- attention_stale forever.
    'ours_snapshot', case when l.link_state = 'conflict'
      then public.calendar_task_snapshot(
        t.due_at, t.title, t.description, l.base_snapshot,
        c.selected_calendar_timezone
      ) else l.base_snapshot end,
    'theirs_snapshot', l.conflict_theirs_snapshot,
    'ours_changed_at', t.schedule_changed_at,
    'ours_changed_by', t.schedule_changed_by,
    'ours_changed_by_name', nullif(p.display_name, ''),
    'provider_observed_at', l.last_provider_seen_at,
    'attention_at', coalesce(
      l.conflict_detected_at, l.event_removed_at, l.refused_at
    ),
    'refusal_code', l.refusal_code,
    'refusal_detail', l.refusal_detail
  ) into v_attention
  from public.task_calendar_links l
  join public.calendar_connections c on c.id = l.connection_id
  join public.tasks t on t.id = l.task_id and t.company_id = l.company_id
  left join public.profiles p on p.user_id = t.schedule_changed_by
  where l.id = p_link_id
    and l.company_id = p_company_id
    and c.user_id = p_user_id
    and c.status = 'active'
    and c.revoked_at is null
    and public.calendar_task_access_allowed(
      p_user_id, t.company_id, t.conversation_id
    )
    and l.link_state in ('conflict', 'event_removed', 'refused');
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  return jsonb_build_object('outcome', 'found', 'attention', v_attention);
end $$;

create or replace function public.api_resolve_calendar_conflict(
  p_company_id           uuid,
  p_user_id              uuid,
  p_link_id              uuid,
  p_resolution           text,
  p_provider_instance_id text default null,
  p_provider_version     text default null,
  p_start_at             timestamptz default null,
  p_end_at               timestamptz default null,
  p_time_zone            text default null,
  p_title                text default null,
  p_description          text default null,
  p_expected_app_snapshot jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link       public.task_calendar_links%rowtype;
  v_connection public.calendar_connections%rowtype;
  v_connection_id uuid;
  v_task       public.tasks%rowtype;
  v_snapshot   jsonb;
  v_current_app_snapshot jsonb;
  v_outbox_id  uuid;
  v_generation bigint;
  v_prior_flag text := coalesce(current_setting('loonext.calendar_provider_apply', true), '');
begin
  if p_resolution not in ('use_app', 'use_calendar', 'not_sure') then
    raise exception 'calendar conflict resolution must be use_app, use_calendar or not_sure';
  end if;
  if not exists (
    select 1 from public.company_members m
     where m.company_id = p_company_id and m.user_id = p_user_id
       and m.deactivated_at is null
  ) then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  select c.id into v_connection_id
    from public.task_calendar_links l
    join public.calendar_connections c on c.id = l.connection_id
    join public.tasks t on t.id = l.task_id and t.company_id = l.company_id
   where l.id = p_link_id and l.company_id = p_company_id
     and c.user_id = p_user_id and l.link_state = 'conflict'
     and public.calendar_task_access_allowed(
       p_user_id, t.company_id, t.conversation_id
     );
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  select * into v_connection
    from public.calendar_connections
   where id = v_connection_id and company_id = p_company_id
     and user_id = p_user_id
   for update;
  select * into v_link
    from public.task_calendar_links
   where id = p_link_id and company_id = p_company_id
     and connection_id = v_connection_id and link_state = 'conflict'
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if p_resolution = 'not_sure' then
    return jsonb_build_object('outcome', 'still_flagged');
  end if;
  if v_connection.status <> 'active' or v_connection.revoked_at is not null then
    return jsonb_build_object('outcome', 'disconnected');
  end if;
  select * into v_task
    from public.tasks
   where id = v_link.task_id and company_id = p_company_id
   for update;

  if p_expected_app_snapshot is null then
    return jsonb_build_object('outcome', 'app_snapshot_required');
  end if;
  v_current_app_snapshot := public.calendar_task_snapshot(
    v_task.due_at, v_task.title, v_task.description,
    v_link.base_snapshot, v_connection.selected_calendar_timezone
  );
  if v_current_app_snapshot is null
     or v_current_app_snapshot is distinct from
        public.calendar_normalize_snapshot(p_expected_app_snapshot) then
    return jsonb_build_object(
      'outcome', 'attention_stale',
      'current_app_snapshot', v_current_app_snapshot
    );
  end if;

  -- A removal/refusal observed after the card's original conflict makes the
  -- old provider choice inapplicable.  Do not ask the caller to manufacture a
  -- canonical instant from a 404/all-day/invalid occurrence; expose the
  -- durable condition so the card can refresh while preserving app evidence.
  if p_resolution = 'use_calendar' and v_link.event_removed_at is not null then
    return jsonb_build_object(
      'outcome', 'provider_condition_changed',
      'provider_condition', 'event_removed'
    );
  end if;
  if p_resolution = 'use_calendar' and v_link.refusal_code is not null then
    return jsonb_build_object(
      'outcome', 'provider_condition_changed',
      'provider_condition', 'refused',
      'refusal_code', v_link.refusal_code
    );
  end if;

  if p_resolution = 'use_app' then
    if not found or v_task.deleted_at is not null or v_task.due_at is null
       or v_task.assigned_user_id is distinct from p_user_id
       or not public.calendar_task_in_sync_window(v_task.due_at)
       or not public.calendar_task_access_allowed(
         p_user_id, v_task.company_id, v_task.conversation_id
       ) then
      return jsonb_build_object(
        'outcome', case
          when v_task.due_at is not null
           and not public.calendar_task_in_sync_window(v_task.due_at)
          then 'outside_sync_window' else 'task_ineligible' end
      );
    end if;
    if v_link.refusal_code is not null
       and nullif(v_link.provider_version, '') is null then
      return jsonb_build_object('outcome', 'provider_version_required');
    end if;
    v_snapshot := public.calendar_task_snapshot(
      v_task.due_at, v_task.title, v_task.description,
      v_link.base_snapshot, v_connection.selected_calendar_timezone
    );
    update public.task_calendar_links
       set link_state = 'active',
           last_sent_snapshot = null,
           last_sent_provider_version = null,
           last_sent_at = null,
           conflict_ours_snapshot = null, conflict_theirs_snapshot = null,
           conflict_detected_at = null,
           event_removed_at = null,
           refusal_code = null, refusal_detail = null, refused_at = null
     where id = v_link.id;
    insert into public.calendar_outbox (
      company_id, connection_id, task_id, link_id, action,
      requested_snapshot, provider_precondition
    ) values (
      p_company_id, v_connection.id, v_task.id, v_link.id,
      case when v_link.event_removed_at is not null then 'create' else 'upsert' end,
      v_snapshot,
      case when v_link.event_removed_at is not null
           then null else v_link.provider_version end
    )
    on conflict (connection_id, task_id)
      where state in ('queued', 'leased')
    do update set
      link_id = excluded.link_id, action = excluded.action,
      requested_snapshot = excluded.requested_snapshot,
      provider_precondition = excluded.provider_precondition,
      generation = public.calendar_outbox.generation + 1,
      state = 'queued', attempts = 0, available_at = now(),
      lease_owner = null, lease_expires_at = null,
      last_error_code = null, last_error_detail = null,
      cancelled_at = null
    returning id, generation into v_outbox_id, v_generation;
    return jsonb_build_object(
      'outcome', 'queued', 'outbox_id', v_outbox_id,
      'generation', v_generation
    );
  end if;

  -- `use_calendar` must be based on a fresh GET of this exact occurrence.  The
  -- plaintext provider description crosses this transaction but is not stored
  -- as a second attention copy; only its canonical hash enters the snapshot.
  if p_provider_instance_id is distinct from v_link.provider_instance_id then
    return jsonb_build_object('outcome', 'provider_instance_mismatch');
  end if;
  if nullif(p_provider_version, '') is null then
    return jsonb_build_object('outcome', 'provider_version_required');
  end if;
  if p_start_at is null
     or not public.calendar_task_in_sync_window(p_start_at) then
    update public.task_calendar_links
       set provider_version = p_provider_version,
           refusal_code = case when p_start_at is null
             then 'invalid_time' else 'outside_sync_window' end,
           refusal_detail = case when p_start_at is null
             then 'Fresh provider occurrence has no usable start instant.'
             else 'Fresh provider occurrence is outside the supported sync window.' end,
           refused_at = coalesce(refused_at, now()),
           event_removed_at = null,
           last_provider_seen_at = now()
     where id = v_link.id;
    return jsonb_build_object(
      'outcome', 'provider_condition_changed',
      'provider_condition', 'refused',
      'refusal_code', case when p_start_at is null
        then 'invalid_time' else 'outside_sync_window' end
    );
  end if;
  v_snapshot := public.calendar_snapshot_from_fields(
    p_start_at, p_end_at, p_time_zone, p_title, p_description
  );
  perform set_config('loonext.calendar_provider_apply', 'on', true);
  update public.tasks
     set due_at = p_start_at,
         title = public.calendar_normalize_text(p_title),
         description = public.calendar_normalize_text(p_description)
   where id = v_task.id;
  perform set_config('loonext.calendar_provider_apply', v_prior_flag, true);
  delete from public.scheduled_messages
   where company_id = p_company_id and task_id = v_task.id
     and origin = 'reminder' and status = 'pending';
  perform public.calendar_enqueue_reminder_replan(
    p_company_id, v_task.id, p_user_id
  );
  update public.task_calendar_links
     set link_state = 'active', base_snapshot = v_snapshot,
         provider_version = p_provider_version,
         last_sent_snapshot = null,
         last_sent_provider_version = null,
         last_sent_at = null,
         conflict_ours_snapshot = null, conflict_theirs_snapshot = null,
         conflict_detected_at = null,
         event_removed_at = null,
         refusal_code = null, refusal_detail = null, refused_at = null,
         last_provider_seen_at = now()
   where id = v_link.id;
  update public.calendar_outbox
     set state = 'cancelled', cancelled_at = now(),
         lease_owner = null, lease_expires_at = null
   where connection_id = v_connection.id and task_id = v_task.id
     and state in ('queued', 'leased');
  return jsonb_build_object('outcome', 'resolved', 'source', 'calendar');
end $$;

create or replace function public.api_resolve_calendar_event_removed(
  p_company_id uuid,
  p_user_id    uuid,
  p_link_id    uuid,
  p_answer     text,
  p_new_due_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link       public.task_calendar_links%rowtype;
  v_connection public.calendar_connections%rowtype;
  v_connection_id uuid;
  v_task       public.tasks%rowtype;
  v_snapshot   jsonb;
  v_outbox_id  uuid;
  v_generation bigint;
  v_prior_actor text := coalesce(current_setting('loonext.schedule_actor', true), '');
begin
  if p_answer not in ('cancelled', 'moved', 'not_sure') then
    raise exception 'calendar removed-event answer must be cancelled, moved or not_sure';
  end if;
  if not exists (
    select 1 from public.company_members m
     where m.company_id = p_company_id and m.user_id = p_user_id
       and m.deactivated_at is null
  ) then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  select c.id into v_connection_id
    from public.task_calendar_links l
    join public.calendar_connections c on c.id = l.connection_id
    join public.tasks t on t.id = l.task_id and t.company_id = l.company_id
   where l.id = p_link_id and l.company_id = p_company_id
     and c.user_id = p_user_id and l.link_state = 'event_removed'
     and public.calendar_task_access_allowed(
       p_user_id, t.company_id, t.conversation_id
     );
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  select * into v_connection
    from public.calendar_connections
   where id = v_connection_id and company_id = p_company_id
     and user_id = p_user_id
   for update;
  select * into v_link
    from public.task_calendar_links
   where id = p_link_id and company_id = p_company_id
     and connection_id = v_connection_id and link_state = 'event_removed'
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if p_answer = 'not_sure' then
    return jsonb_build_object('outcome', 'still_flagged');
  end if;
  select * into v_task
    from public.tasks
   where id = v_link.task_id and company_id = p_company_id
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if p_answer = 'cancelled' then
    perform public.set_message_done(
      p_company_id, v_task.message_id, true, p_user_id
    );
    delete from public.scheduled_messages
     where company_id = p_company_id and task_id = v_task.id
       and origin = 'reminder' and status = 'pending';
    update public.calendar_reminder_replans
       set state = 'cancelled', cancelled_at = now(),
           generation = generation + 1,
           lease_owner = null, lease_expires_at = null
     where company_id = p_company_id and task_id = v_task.id
       and state in ('queued', 'leased');
    update public.task_calendar_links
       set link_state = 'unlinked', unlinked_at = now()
     where id = v_link.id;
    update public.calendar_outbox
       set state = 'cancelled', cancelled_at = now(),
           lease_owner = null, lease_expires_at = null
     where connection_id = v_connection.id and task_id = v_task.id
       and state in ('queued', 'leased');
    return jsonb_build_object('outcome', 'cancelled');
  end if;

  if p_new_due_at is null then
    return jsonb_build_object('outcome', 'date_required');
  end if;
  if not public.calendar_task_in_sync_window(p_new_due_at) then
    return jsonb_build_object('outcome', 'outside_sync_window');
  end if;
  if v_connection.status <> 'active' or v_connection.revoked_at is not null then
    return jsonb_build_object('outcome', 'disconnected');
  end if;
  if v_task.deleted_at is not null
     or v_task.assigned_user_id is distinct from p_user_id
     or not public.calendar_task_access_allowed(
       p_user_id, v_task.company_id, v_task.conversation_id
     ) then
    return jsonb_build_object('outcome', 'task_ineligible');
  end if;
  perform set_config('loonext.schedule_actor', p_user_id::text, true);
  update public.tasks set due_at = p_new_due_at where id = v_task.id
  returning * into v_task;
  perform set_config('loonext.schedule_actor', v_prior_actor, true);
  perform public.calendar_enqueue_reminder_replan(
    p_company_id, v_task.id, p_user_id
  );
  v_snapshot := public.calendar_task_snapshot(
    v_task.due_at, v_task.title, v_task.description,
    v_link.base_snapshot, v_connection.selected_calendar_timezone
  );
  insert into public.calendar_outbox (
    company_id, connection_id, task_id, link_id, action,
    requested_snapshot, provider_precondition
  ) values (
    p_company_id, v_connection.id, v_task.id, v_link.id, 'create',
    v_snapshot, null
  )
  on conflict (connection_id, task_id)
    where state in ('queued', 'leased')
  do update set
    link_id = excluded.link_id, action = 'create',
    requested_snapshot = excluded.requested_snapshot,
    provider_precondition = null,
    generation = public.calendar_outbox.generation + 1,
    state = 'queued', attempts = 0, available_at = now(),
    lease_owner = null, lease_expires_at = null,
    last_error_code = null, last_error_detail = null,
    cancelled_at = null
  returning id, generation into v_outbox_id, v_generation;
  return jsonb_build_object(
    'outcome', 'moved', 'outbox_id', v_outbox_id,
    'generation', v_generation
  );
end $$;

revoke execute on function public.api_request_calendar_pull(text, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.api_claim_due_calendar_pulls(text, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.api_renew_calendar_pull_lease(
  uuid, text, bigint, integer) from public, anon, authenticated;
revoke execute on function public.api_commit_calendar_pull(uuid, text, bigint, text)
  from public, anon, authenticated;
revoke execute on function public.api_retry_calendar_pull(
  uuid, text, bigint, integer, text, text, boolean)
  from public, anon, authenticated;
revoke execute on function public.api_claim_calendar_outbox(text, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.api_mark_calendar_outbox_effect_started(
  uuid, text, bigint) from public, anon, authenticated;
revoke execute on function public.api_commit_calendar_outbox_created(
  uuid, text, bigint, text, text, text, text,
  timestamptz, timestamptz, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.api_commit_calendar_outbox_sent(
  uuid, text, bigint, text, timestamptz, timestamptz, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.api_commit_calendar_outbox_scrubbed(
  uuid, text, bigint, text, boolean)
  from public, anon, authenticated;
revoke execute on function public.api_abandon_calendar_cleanup(
  uuid, text, bigint, text, text)
  from public, anon, authenticated;
revoke execute on function public.api_enqueue_calendar_push(
  uuid, uuid, text, bigint, uuid, uuid, text, jsonb, uuid, bigint)
  from public, anon, authenticated;
revoke execute on function public.api_retry_calendar_outbox(
  uuid, text, bigint, integer, text, text, boolean, boolean)
  from public, anon, authenticated;
revoke execute on function public.api_cancel_calendar_outbox(uuid, text, bigint, text)
  from public, anon, authenticated;
revoke execute on function public.api_claim_calendar_reminder_replans(
  text, integer, integer) from public, anon, authenticated;
revoke execute on function public.api_complete_calendar_reminder_replan(
  uuid, text, bigint) from public, anon, authenticated;
revoke execute on function public.api_retry_calendar_reminder_replan(
  uuid, text, bigint, integer, text, text)
  from public, anon, authenticated;
revoke execute on function public.api_apply_calendar_provider_snapshot(
  uuid, uuid, text, bigint, uuid, text, text, text, text,
  timestamptz, timestamptz, text, text, text, uuid, bigint, boolean)
  from public, anon, authenticated;
revoke execute on function public.api_mark_calendar_conflict(
  uuid, uuid, text, bigint, uuid, text, jsonb, jsonb)
  from public, anon, authenticated;
revoke execute on function public.api_mark_calendar_event_removed(
  uuid, uuid, text, bigint, uuid, text, text, uuid, bigint)
  from public, anon, authenticated;
revoke execute on function public.api_observe_calendar_conflict_condition(
  uuid, uuid, uuid, text, jsonb, text, text, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.api_mark_calendar_refusal(
  uuid, uuid, text, bigint, uuid, text, text, text, text, boolean, uuid, bigint)
  from public, anon, authenticated;
revoke execute on function public.api_list_calendar_attention(
  uuid, uuid, integer) from public, anon, authenticated;
revoke execute on function public.api_get_calendar_attention(
  uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.api_resolve_calendar_conflict(
  uuid, uuid, uuid, text, text, text,
  timestamptz, timestamptz, text, text, text, jsonb)
  from public, anon, authenticated;
revoke execute on function public.api_resolve_calendar_event_removed(
  uuid, uuid, uuid, text, timestamptz)
  from public, anon, authenticated;

grant execute on function public.api_request_calendar_pull(text, text, text, text)
  to service_role;
grant execute on function public.api_claim_due_calendar_pulls(text, integer, integer)
  to service_role;
grant execute on function public.api_renew_calendar_pull_lease(
  uuid, text, bigint, integer) to service_role;
grant execute on function public.api_commit_calendar_pull(uuid, text, bigint, text)
  to service_role;
grant execute on function public.api_retry_calendar_pull(
  uuid, text, bigint, integer, text, text, boolean)
  to service_role;
grant execute on function public.api_claim_calendar_outbox(text, integer, integer)
  to service_role;
grant execute on function public.api_mark_calendar_outbox_effect_started(
  uuid, text, bigint) to service_role;
grant execute on function public.api_commit_calendar_outbox_created(
  uuid, text, bigint, text, text, text, text,
  timestamptz, timestamptz, text, text, text)
  to service_role;
grant execute on function public.api_commit_calendar_outbox_sent(
  uuid, text, bigint, text, timestamptz, timestamptz, text, text, text)
  to service_role;
grant execute on function public.api_commit_calendar_outbox_scrubbed(
  uuid, text, bigint, text, boolean)
  to service_role;
grant execute on function public.api_abandon_calendar_cleanup(
  uuid, text, bigint, text, text)
  to service_role;
grant execute on function public.api_enqueue_calendar_push(
  uuid, uuid, text, bigint, uuid, uuid, text, jsonb, uuid, bigint)
  to service_role;
grant execute on function public.api_retry_calendar_outbox(
  uuid, text, bigint, integer, text, text, boolean, boolean)
  to service_role;
grant execute on function public.api_cancel_calendar_outbox(uuid, text, bigint, text)
  to service_role;
grant execute on function public.api_claim_calendar_reminder_replans(
  text, integer, integer) to service_role;
grant execute on function public.api_complete_calendar_reminder_replan(
  uuid, text, bigint) to service_role;
grant execute on function public.api_retry_calendar_reminder_replan(
  uuid, text, bigint, integer, text, text) to service_role;
grant execute on function public.api_apply_calendar_provider_snapshot(
  uuid, uuid, text, bigint, uuid, text, text, text, text,
  timestamptz, timestamptz, text, text, text, uuid, bigint, boolean)
  to service_role;
grant execute on function public.api_mark_calendar_conflict(
  uuid, uuid, text, bigint, uuid, text, jsonb, jsonb)
  to service_role;
grant execute on function public.api_mark_calendar_event_removed(
  uuid, uuid, text, bigint, uuid, text, text, uuid, bigint)
  to service_role;
grant execute on function public.api_observe_calendar_conflict_condition(
  uuid, uuid, uuid, text, jsonb, text, text, text, text, text)
  to service_role;
grant execute on function public.api_mark_calendar_refusal(
  uuid, uuid, text, bigint, uuid, text, text, text, text, boolean, uuid, bigint)
  to service_role;
grant execute on function public.api_list_calendar_attention(
  uuid, uuid, integer) to service_role;
grant execute on function public.api_get_calendar_attention(
  uuid, uuid, uuid) to service_role;
grant execute on function public.api_resolve_calendar_conflict(
  uuid, uuid, uuid, text, text, text,
  timestamptz, timestamptz, text, text, text, jsonb)
  to service_role;
grant execute on function public.api_resolve_calendar_event_removed(
  uuid, uuid, uuid, text, timestamptz)
  to service_role;

-- The read-side scheduled-send checks improve UX, but they cannot authorize a
-- send: a webhook/outbox/task change may commit after those reads.  Replacing
-- the existing fire RPC makes the calendar proof and message creation one
-- locked transaction.  It preserves the established `fired`/`gone` shapes and
-- adds `{outcome:'held', reason_key:'calendar_unverified', scheduled_message}`.
create or replace function public.api_fire_scheduled_message(
  p_id                uuid,
  p_segments_estimate integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_probe           public.scheduled_messages%rowtype;
  v_scheduled       public.scheduled_messages%rowtype;
  v_message         public.messages%rowtype;
  v_task            public.tasks%rowtype;
  v_source_done_at  timestamptz;
  v_calendar_backed boolean := false;
  v_calendar_safe   boolean := true;
  v_now             timestamptz := now();
begin
  -- Identity probe only.  The authoritative row is locked after the calendar
  -- serialization rows so provider apply keeps connection->link->outbox->send
  -- ordering and cannot deadlock this transaction.
  select * into v_probe
    from public.scheduled_messages s
   where s.id = p_id and s.status in ('pending', 'held');
  if not found then
    return jsonb_build_object('outcome', 'gone');
  end if;

  if v_probe.origin = 'reminder' and v_probe.task_id is not null then
    -- Serializes OAuth completion/workspace closure with the no-link case.
    perform 1 from public.companies co
     where co.id = v_probe.company_id
     for update;

    -- Include the assigned member's connection even before its first link,
    -- plus every connection named by a mapping or live outbox intent.
    perform 1
      from public.calendar_connections c
     where c.company_id = v_probe.company_id
       and (
         c.user_id = (
           select t.assigned_user_id from public.tasks t
            where t.id = v_probe.task_id and t.company_id = v_probe.company_id
         )
         or exists (
           select 1 from public.task_calendar_links l
            where l.company_id = v_probe.company_id
              and l.task_id = v_probe.task_id
              and l.connection_id = c.id
              and l.link_state <> 'unlinked'
         )
         or exists (
           select 1 from public.calendar_outbox o
            where o.company_id = v_probe.company_id
              and o.task_id = v_probe.task_id
              and o.connection_id = c.id
              and o.state in ('queued', 'leased')
         )
       )
     order by c.id
     for update;
    perform 1
      from public.task_calendar_links l
     where l.company_id = v_probe.company_id
       and l.task_id = v_probe.task_id
       and l.link_state <> 'unlinked'
     order by l.id
     for update;
    select * into v_task
      from public.tasks t
     where t.id = v_probe.task_id and t.company_id = v_probe.company_id
     for update;
    if found then
      select m.done_at into v_source_done_at
        from public.messages m
       where m.id = v_task.message_id and m.company_id = v_probe.company_id
       for update;
    end if;
    perform 1
      from public.calendar_outbox o
     where o.company_id = v_probe.company_id
       and o.task_id = v_probe.task_id
       and o.state in ('queued', 'leased')
     order by o.id
     for update;
  end if;

  select * into v_scheduled
    from public.scheduled_messages s
   where s.id = p_id
     and s.status in ('pending', 'held')
   for update;
  if not found then
    return jsonb_build_object('outcome', 'gone');
  end if;

  if v_scheduled.origin = 'reminder' and v_scheduled.task_id is not null then
    if v_task.id is null
       or v_task.deleted_at is not null
       or v_task.reminders_off
       or v_task.due_at is null
       or v_source_done_at is not null then
      update public.scheduled_messages s
         set status = 'failed',
             held_reason = 'The job is no longer scheduled.',
             held_reason_key = 'job_no_longer_scheduled',
             claimed_at = null,
             updated_at = v_now
       where s.id = p_id
      returning * into v_scheduled;
      return jsonb_build_object(
        'outcome', 'failed',
        'reason_key', 'job_no_longer_scheduled',
        'scheduled_message', to_jsonb(v_scheduled)
      );
    end if;

    v_calendar_backed := exists (
      select 1 from public.calendar_outbox o
       where o.company_id = v_scheduled.company_id
         and o.task_id = v_scheduled.task_id
         and o.state in ('queued', 'leased')
    ) or exists (
      select 1 from public.task_calendar_links l
       where l.company_id = v_scheduled.company_id
         and l.task_id = v_scheduled.task_id
         and l.link_state <> 'unlinked'
    );

    if v_calendar_backed then
      v_calendar_safe := exists (
        select 1 from public.companies co
         where co.id = v_scheduled.company_id and co.deleted_at is null
      )
      and not exists (
        select 1 from public.calendar_outbox o
         where o.company_id = v_scheduled.company_id
           and o.task_id = v_scheduled.task_id
           and o.state in ('queued', 'leased')
      )
      and not exists (
        select 1
          from public.task_calendar_links l
          left join public.calendar_connections c
            on c.id = l.connection_id and c.company_id = l.company_id
         where l.company_id = v_scheduled.company_id
           and l.task_id = v_scheduled.task_id
           and l.link_state <> 'unlinked'
           and (
             l.link_state <> 'active'
             or c.id is null
             or c.status <> 'active'
             or c.revoked_at is not null
             or c.last_verified_at is null
             or c.last_verified_at < v_now - interval '15 minutes'
             or (c.sync_due_at is not null and c.sync_due_at <= v_now)
             or c.pull_lease_owner is not null
           )
      );
    end if;

    if v_calendar_backed and not v_calendar_safe then
      update public.scheduled_messages s
         set status = 'held',
             held_reason = 'Calendar verification is pending.',
             held_reason_key = 'calendar_unverified',
             held_at = coalesce(s.held_at, v_now),
             claimed_at = null,
             updated_at = v_now
       where s.id = p_id
      returning * into v_scheduled;
      return jsonb_build_object(
        'outcome', 'held',
        'reason_key', 'calendar_unverified',
        'scheduled_message', to_jsonb(v_scheduled)
      );
    end if;
  end if;

  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments,
     sent_by_user_id)
  values
    (v_scheduled.company_id, v_scheduled.conversation_id, 'outbound',
     v_scheduled.body, 'queued', p_segments_estimate, v_scheduled.created_by)
  returning * into v_message;

  update public.scheduled_messages s
     set status = 'sent',
         sent_message_id = v_message.id,
         held_reason = null,
         held_reason_key = null,
         updated_at = v_now
   where s.id = p_id;

  return jsonb_build_object(
    'outcome', 'fired', 'message', to_jsonb(v_message)
  );
end $$;

revoke execute on function public.api_fire_scheduled_message(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.api_fire_scheduled_message(uuid, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- Focus-queue attention hold.  This restates the latest api_for_you contract
-- verbatim except for the one anti-join in my_tasks_all below.
-- ---------------------------------------------------------------------------
create or replace function public.api_for_you(
  p_company_id uuid,
  p_user_id uuid,
  p_now timestamptz,
  p_limit integer default 20,
  p_hidden_number_ids uuid[] default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$

  with
  conv as (
    select c.*,
           -- CASE, not AND: for an UNASSIGNED row "assigned_user_id = p_user_id" is
           -- NULL rather than false, and "NULL and x" must still evaluate x to
           -- learn whether the answer is NULL or false. An AND here reads as a
           -- short circuit and measured as none. CASE short-circuits by
           -- definition; the ELSE covers somebody else's row and an unassigned one.
           case when c.assigned_user_id = p_user_id then exists (
             select 1
               from public.messages m
              where m.conversation_id = c.id
                and (m.sent_by_user_id is null or m.sent_by_user_id <> p_user_id)
                and m.created_at > coalesce(
                  (select r.last_read_at
                     from public.conversation_reads r
                    where r.conversation_id = c.id and r.user_id = p_user_id),
                  '-infinity'::timestamptz)) else false end as unread_mine
    from public.conversations c
    where c.company_id = p_company_id
      and c.is_spam = false
      and c.closed_at is null
      -- #106: conversation sections still hide conversations on hidden numbers.
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
      -- #293: a thread I deferred is not work waiting on me TODAY. The focus
      -- queue is the surface that tells a crew what needs them, and a queue
      -- where half the items are not actionable today trains people to stop
      -- trusting the count — alert fatigue (#244) arriving through a different
      -- door. One anti-join in the CTE every section reads from, so
      -- waiting_on_you, unread and triage cannot disagree about it.
      --
      -- Scoped to p_user_id, so a colleague's deferral neither hides the thread
      -- from me nor lands on my queue. Computed from `until`, so a thread whose
      -- moment has passed is back with nothing needing to run first.
      and not exists (
        select 1
          from public.conversation_snoozes s
         where s.conversation_id = c.id
           and s.user_id = p_user_id
           and s.until > now())
      -- #306: every consumer below wants mine, or unassigned. Anything else was
      -- computed and thrown away.
      -- #416: "or unassigned" used to be "or, if you are a lead, unassigned" —
      -- the deepest of the four gates, and the one that made a member's triage
      -- section come back empty rather than absent.
      and (c.assigned_user_id = p_user_id
           or c.assigned_user_id is null)
  ),
  -- #293: follow-up reminders that have COME DUE. `until <= now()` is the
  -- whole mechanism — the same computed expiry the deferral uses, read from
  -- the other side. Nothing runs to fire one, so nothing can run late.
  --
  -- "If they haven't replied" needs no clause here at all: the inbound trigger
  -- deletes the row the moment a customer texts, so a reminder that survives to
  -- its due time is BY CONSTRUCTION one they never answered.
  due_follow_ups as (
    select s.conversation_id, s.until, s.note
    from public.conversation_snoozes s
    where s.company_id = p_company_id
      and s.user_id = p_user_id
      and s.kind = 'follow_up'
      and s.until <= now()
  ),
  follow_ups as (
    -- Unread is read for the rows that survive. It is shown here and never
    -- filtered or sorted on, so it belongs after the limit.
    select p.*, exists (
             select 1
               from public.messages m
              where m.conversation_id = p.conversation_id
                and (m.sent_by_user_id is null or m.sent_by_user_id <> p_user_id)
                and m.created_at > coalesce(
                  (select r.last_read_at
                     from public.conversation_reads r
                    where r.conversation_id = p.conversation_id and r.user_id = p_user_id),
                  '-infinity'::timestamptz)) as unread
    from (
      select f.conversation_id, f.until, f.note,
             c.status, c.contact_id, c.last_message_at
      from due_follow_ups f
      join conv c on c.id = f.conversation_id
      order by f.until asc, f.conversation_id asc
      limit greatest(p_limit, 0)
    ) p
  ),
  conv_overdue_task as (
    select distinct t.conversation_id
    from public.tasks t
    join public.messages m on m.id = t.message_id
    where t.company_id = p_company_id
      and t.deleted_at is null
      and m.done_at is null
      and t.due_at is not null
      and t.due_at < p_now
  ),
  -- #306: the three conversation totals plus the deduplicated one, in a single
  -- pass. Each filter is its section's predicate copied VERBATIM — including
  -- the redundant status list on triage — so a total can never quietly mean
  -- something different from the rows beside it.
  conv_totals as (
    select
      count(*) filter (
        where c.assigned_user_id = p_user_id
          and c.status in ('open','waiting'))                as waiting_on_you,
      count(*) filter (
        where c.unread_mine)                                 as unread,
      count(*) filter (
        where c.assigned_user_id is null
          and c.status in ('new','open','waiting'))          as triage_conversations,
      -- One conversation, counted once, however many lenses it shows up in.
      count(*) filter (
        where (c.assigned_user_id = p_user_id
               and (c.status in ('open','waiting') or c.unread_mine))
           or (c.assigned_user_id is null
               and c.status in ('new','open','waiting')))     as distinct_conversations
    from conv c
  ),
  waiting_on_you as (
    select c.id, c.status, c.contact_id, c.assigned_user_id,
           c.last_message_at, c.unread_mine as unread,
           (ot.conversation_id is not null) as has_overdue_task,
           case
             when ot.conversation_id is not null then 0
             when c.status = 'waiting'            then 1
             when c.unread_mine                   then 2
             else 3
           end as urgency
    from conv c
    left join conv_overdue_task ot on ot.conversation_id = c.id
    where c.assigned_user_id = p_user_id
      and c.status in ('open','waiting')
    order by urgency asc, c.last_message_at desc, c.id desc
    limit greatest(p_limit, 0)
  ),
  -- #107: my_tasks is GLOBAL — no hidden-number filter (title + ids only).
  -- #306: split into an unlimited base and a limited presentation slice, so
  -- the total and the rows are the same query answered twice rather than two
  -- predicates that can drift.
  my_tasks_all as (
    -- #417: the task stays (it is this member's own work, and #107 keeps tasks
    -- global), but the TITLE is redacted when its conversation sits on a number
    -- this member is denied — the default title is the customer's message.
    select t.id,
           case
             when p_hidden_number_ids is not null
              and exists (
                    select 1 from public.conversations hc
                     where hc.id = t.conversation_id
                       and hc.phone_number_id = any(p_hidden_number_ids))
             then 'Task on a number you don''t have access to'
             else t.title
           end as title,
           t.conversation_id, t.message_id,
           t.assigned_user_id, t.due_at, t.created_at,
           (t.due_at is not null and t.due_at < p_now) as overdue
    from public.tasks t
    join public.messages m on m.id = t.message_id
    where t.company_id = p_company_id
      and t.deleted_at is null
      and t.assigned_user_id = p_user_id
      and m.done_at is null
      -- #245/D137: a removed/refused provider occurrence is unresolved
      -- attention, not an ordinary unscheduled job in the member queue.
      -- Conflicts remain visible because they retain a usable local date.
      and not exists (
        select 1
          from public.task_calendar_links cal_hold
         where cal_hold.company_id = t.company_id
           and cal_hold.task_id = t.id
           and cal_hold.link_state in ('event_removed', 'refused'))
  ),
  my_tasks as (
    select * from my_tasks_all
    order by overdue desc, due_at asc nulls last, created_at asc, id asc
    limit greatest(p_limit, 0)
  ),
  unread as (
    select c.id, c.status, c.contact_id, c.assigned_user_id, c.last_message_at
    from conv c
    where c.unread_mine
    order by c.last_message_at desc, c.id desc
    limit greatest(p_limit, 0)
  ),
  triage_convs as (
    -- THE ONE THAT MATTERED: unclaimed work is the whole workspace, and its
    -- unread flag is shown rather than filtered on, so it waits for the limit.
    select p.*, exists (
             select 1
               from public.messages m
              where m.conversation_id = p.id
                and (m.sent_by_user_id is null or m.sent_by_user_id <> p_user_id)
                and m.created_at > coalesce(
                  (select r.last_read_at
                     from public.conversation_reads r
                    where r.conversation_id = p.id and r.user_id = p_user_id),
                  '-infinity'::timestamptz)) as unread
    from (
    select c.id, c.status, c.contact_id, c.last_message_at
    from conv c
    -- #416: no longer owner/admin-only. Reads from `conv`, which already
    -- carries the #106 hidden-number filter, so a restricted member sees
    -- unclaimed work only on numbers they can access.
    where c.assigned_user_id is null
      and c.status in ('new','open','waiting')
    order by c.last_message_at desc, c.id desc
    limit greatest(p_limit, 0)
    ) p
  ),
  -- #416: the old comment here said "triage is owner/admin-only, and leads are
  -- always unrestricted, so triage_tasks needs no number filter". The first
  -- clause is what made the second true, and it is no longer the first clause.
  -- A member CAN be restricted, so the filter below is now load-bearing — the
  -- same premise-shaped hole as #417, caught before shipping rather than after.
  triage_tasks_all as (
    select t.id, t.title, t.conversation_id, t.message_id,
           t.due_at, t.created_at,
           (t.due_at is not null and t.due_at < p_now) as overdue
    from public.tasks t
    join public.messages m on m.id = t.message_id
    where t.company_id = p_company_id
      and t.deleted_at is null
      and t.assigned_user_id is null
      and m.done_at is null
      -- #106: unclaimed work on a number this member is denied is not theirs
      -- to claim, so it is hidden outright. (Their OWN assigned task keeps its
      -- row with a redacted title — #417 — because hiding somebody's own job
      -- from them helps nobody. Unclaimed work they cannot act on is noise.)
      and (p_hidden_number_ids is null or not exists (
             select 1 from public.conversations hc
              where hc.id = t.conversation_id
                and hc.phone_number_id = any(p_hidden_number_ids)))
  ),
  triage_tasks as (
    select * from triage_tasks_all
    order by overdue desc, due_at asc nulls last, created_at asc, id asc
    limit greatest(p_limit, 0)
  ),
  contact_map as (
    select ct.id,
           jsonb_build_object('id', ct.id, 'name', ct.name,
                              'phone_e164', ct.phone_e164) as j
    from public.contacts ct
    where ct.company_id = p_company_id
      and ct.id in (
        select contact_id from follow_ups
        union
        select contact_id from waiting_on_you
        union select contact_id from unread
        union select contact_id from triage_convs)
  )
  select jsonb_build_object(
    'waiting_on_you', coalesce((
      select jsonb_agg(jsonb_build_object(
               'conversation_id', w.id, 'status', w.status,
               'contact', cm.j, 'assigned_user_id', w.assigned_user_id,
               'last_message_at', w.last_message_at, 'unread', w.unread,
               'has_overdue_task', w.has_overdue_task, 'urgency', w.urgency)
               order by w.urgency asc, w.last_message_at desc, w.id desc)
      from waiting_on_you w left join contact_map cm on cm.id = w.contact_id),
      '[]'::jsonb),
    'my_tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'task_id', t.id, 'title', t.title,
               'conversation_id', t.conversation_id, 'message_id', t.message_id,
               'assigned_user_id', t.assigned_user_id, 'due_at', t.due_at,
               'overdue', t.overdue)
               order by t.overdue desc, t.due_at asc nulls last, t.created_at asc, t.id asc)
      from my_tasks t), '[]'::jsonb),
    'unread', coalesce((
      select jsonb_agg(jsonb_build_object(
               'conversation_id', u.id, 'status', u.status, 'contact', cm.j,
               'assigned_user_id', u.assigned_user_id,
               'last_message_at', u.last_message_at)
               order by u.last_message_at desc, u.id desc)
      from unread u left join contact_map cm on cm.id = u.contact_id),
      '[]'::jsonb),
    -- #416: present for EVERY member now, not only leads.
    -- #293: "a quote with no answer is the most valuable thing in the business
    -- to be reminded about". Its own section rather than folded into
    -- waiting_on_you, because the reason differs and the reason is the point —
    -- this is not "you have not answered them", it is "they have not answered
    -- you, and you asked to be told".
    'follow_ups', coalesce((
      select jsonb_agg(jsonb_build_object(
               'conversation_id', f.conversation_id, 'status', f.status,
               'contact', cm.j, 'last_message_at', f.last_message_at,
               'unread', f.unread, 'due_at', f.until, 'note', f.note)
               order by f.until asc, f.conversation_id asc)
      from follow_ups f left join contact_map cm on cm.id = f.contact_id),
      '[]'::jsonb),
    'triage', jsonb_build_object(
      'conversations', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'conversation_id', tc.id, 'status', tc.status, 'contact', cm.j,
                 'last_message_at', tc.last_message_at, 'unread', tc.unread)
                 order by tc.last_message_at desc, tc.id desc)
        from triage_convs tc left join contact_map cm on cm.id = tc.contact_id),
        '[]'::jsonb),
      'tasks', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'task_id', t.id, 'title', t.title,
                 'conversation_id', t.conversation_id, 'message_id', t.message_id,
                 'due_at', t.due_at, 'overdue', t.overdue)
                 order by t.overdue desc, t.due_at asc nulls last, t.created_at asc, t.id asc)
        from triage_tasks t), '[]'::jsonb)
    ),
    -- #306: what each section ACTUALLY holds, independent of the 20 returned.
    -- `distinct_work` is the headline number and is the only one a client
    -- should render as "N things need you" — the per-section totals overlap.
    'totals', (
      select jsonb_build_object(
        'waiting_on_you', ct.waiting_on_you,
        'my_tasks', (select count(*) from my_tasks_all),
        'unread', ct.unread,
        'triage_conversations', ct.triage_conversations,
        'triage_tasks', (select count(*) from triage_tasks_all),
        'follow_ups', (select count(*) from due_follow_ups),
        'distinct_work',
          ct.distinct_conversations
          + (select count(*) from my_tasks_all)
          + (select count(*) from triage_tasks_all)
          -- Only the ones no other lens already counted: a due follow-up on a
          -- thread that is also unread and assigned to me is ONE thing needing
          -- me, and `distinct_work` is the number a client renders as "N things
          -- need you".
          + (select count(*) from due_follow_ups f
              where not exists (
                select 1 from conv c
                 where c.id = f.conversation_id
                   and ((c.assigned_user_id = p_user_id
                         and (c.status in ('open','waiting') or c.unread_mine))
                     or (c.assigned_user_id is null
                         and c.status in ('new','open','waiting'))))))
      from conv_totals ct)
  )
$fn$;

-- ---------------------------------------------------------------------------
-- Workspace erasure roster.  Child-first keeps each bounded purge step valid
-- even though every FK also carries ON DELETE CASCADE as a second belt.
-- ---------------------------------------------------------------------------
create or replace function public.purge_workspace_step(
  p_company_id uuid,
  p_limit      int default 500
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tables text[] := array[
    -- #245: provider payload copies/credentials and pending external work.
    'calendar_reminder_replans',
    'calendar_outbox', 'task_calendar_links', 'webhook_subscriptions',
    'oauth_states', 'calendar_connections',
    'usage_events', 'tasks', 'message_mentions', 'message_attachments',
    'attachments',
    'conversation_summaries',
    -- #224: before `messages` and `conversations`, both of which it references.
    -- #287: references conversations and contacts, so it goes before both.
    'quotes',
    'payment_requests',
    'messages', 'conversation_events', 'conversations',
    'call_records', 'calls', 'port_requests', 'text_enablement_orders',
    'contacts', 'phone_numbers',
    'template_uses',
    'tags',
    'templates', 'invites', 'messaging_registrations', 'grace_notices',
    'inbound_notification_days', 'usage_alerts', 'egress_events', 'audit_log',
    'company_members',
    'call_member_legs', 'company_ai_settings', 'company_ai_usage',
    'company_modules', 'email_ledger', 'member_telephony_credentials',
    'notification_prefs', 'notification_read_items', 'notification_reads',
    'number_access', 'outbound_call_authorizations', 'outbound_dial_leases',
    'activation_stall_state', 'appointment_reminder_rules', 'billing_disputes',
    'blocked_senders', 'call_silence_state', 'cancellation_reasons',
    'contact_field_defs', 'data_exports', 'feature_flag_overrides',
    'high_priority_push_budget', 'high_priority_push_days', 'lead_sources',
    'number_port_outs', 'ownership_confirmations', 'ownership_transfers',
    'prepayments', 'public_links', 'referrals', 'retention_notices',
    'saved_views',
    'stripe_connect_accounts',
    'voicemail_greetings',
    'provider_costs',
    'widget_verifications',
    'webhook_deliveries', 'webhook_endpoints',
    'api_keys',
    'calendar_feed_tokens'
  ];
  v_table text;
  v_deleted int;
  v_cleanup_count int;
  v_cleanup_unconfirmed boolean;
  v_cleanup_unconfirmed_count int;
begin
  if p_limit is null or p_limit <= 0 then
    raise exception 'purge_workspace_step: p_limit must be > 0';
  end if;
  if not exists (
    select 1 from public.companies
     where id = p_company_id
       and deleted_at is not null
       and purge_after is not null
       and purge_after <= now()
  ) then
    raise exception 'purge_workspace_step: % is not past its purge window', p_company_id;
  end if;

  select c.calendar_cleanup_unconfirmed_at is not null,
         c.calendar_cleanup_unconfirmed_count
    into v_cleanup_unconfirmed, v_cleanup_unconfirmed_count
    from public.companies c where c.id = p_company_id;

  -- Provider cleanup is an external side effect and therefore cannot be
  -- replaced by cascading the local rows at the end of the retention window.
  -- A closed workspace remains purge-ineligible until every stopWatch and
  -- scrub intent is either committed or explicitly terminalized as the
  -- disclosed cleanup_abandoned state.
  if exists (
       select 1 from public.calendar_connections c
        where c.company_id = p_company_id and c.revoked_at is null
     ) or exists (
       select 1 from public.webhook_subscriptions s
        where s.company_id = p_company_id and s.revoked_at is null
     ) or exists (
       select 1 from public.calendar_outbox o
        where o.company_id = p_company_id and o.state in ('queued', 'leased')
     ) then
    -- The statutory retention deadline is also a privacy boundary: provider
    -- ambiguity cannot retain copied customer content forever.  Serialize and
    -- terminalize local recovery state, wipe credentials, and record an
    -- explicit UNCONFIRMED outcome for the already-captured purge receipt
    -- address.  Nothing here reports remote deletion as successful.
    select count(*) into v_cleanup_count
      from public.calendar_connections c
     where c.company_id = p_company_id and c.revoked_at is null;
    perform 1 from public.calendar_connections c
     where c.company_id = p_company_id order by c.id for update;
    update public.webhook_subscriptions
       set status = 'revoked', revoked_at = now(),
           renewal_generation = renewal_generation + 1,
           renewal_lease_owner = null, renewal_lease_expires_at = null,
           last_error_code = 'cleanup_abandoned_retention_deadline',
           last_error_detail = 'Remote stopWatch was not confirmed before local erasure.'
     where company_id = p_company_id and revoked_at is null;
    update public.calendar_outbox
       set state = 'cancelled', cancelled_at = now(),
           lease_owner = null, lease_expires_at = null,
           last_error_code = 'cleanup_abandoned_retention_deadline',
           last_error_detail = 'Remote calendar cleanup was not confirmed before local erasure.'
     where company_id = p_company_id and state in ('queued', 'leased');
    update public.task_calendar_links
       set link_state = 'unlinked', unlinked_at = now(),
           last_sent_snapshot = null,
           last_sent_provider_version = null,
           last_sent_at = null,
           conflict_ours_snapshot = null,
           conflict_theirs_snapshot = null,
           conflict_detected_at = null,
           event_removed_at = null,
           refusal_code = null,
           refusal_detail = null,
           refused_at = null
     where company_id = p_company_id and link_state <> 'unlinked';
    update public.calendar_connections
       set status = 'revoked', revoked_at = now(),
           remote_cleanup_unconfirmed = true,
           credential_ciphertext = null,
           credential_iv = null,
           credential_key_version = null,
           credential_generation = credential_generation + 1,
           credential_refresh_lease_owner = null,
           credential_refresh_lease_expires_at = null,
           disconnect_cleanup_action = null,
           sync_cursor = null, cursor_updated_at = null,
           sync_due_at = null, pull_full_sync = false,
           pull_followup_requested = false,
           pull_lease_owner = null, pull_lease_expires_at = null,
           last_error_code = 'cleanup_abandoned_retention_deadline',
           last_error_detail = 'Remote calendar cleanup was not confirmed before local erasure.',
           last_error_at = now()
     where company_id = p_company_id and revoked_at is null;
    update public.companies
       set calendar_cleanup_unconfirmed_at = coalesce(
             calendar_cleanup_unconfirmed_at, now()
           ),
           calendar_cleanup_unconfirmed_count =
             calendar_cleanup_unconfirmed_count + greatest(v_cleanup_count, 1)
     where id = p_company_id
    returning calendar_cleanup_unconfirmed_count
         into v_cleanup_unconfirmed_count;
    return jsonb_build_object(
      'step', 'calendar_cleanup_abandoned',
      'deleted', 0,
      'done', false,
      'remote_calendar_cleanup_unconfirmed', true,
      'remote_calendar_cleanup_unconfirmed_count',
        v_cleanup_unconfirmed_count
    );
  end if;

  foreach v_table in array v_tables loop
    execute format(
      'delete from public.%I where ctid in (
         select ctid from public.%I where company_id = $1 limit $2
       )', v_table, v_table)
      using p_company_id, p_limit;
    get diagnostics v_deleted = row_count;
    if v_deleted > 0 then
      return jsonb_build_object(
        'step', v_table, 'deleted', v_deleted, 'done', false,
        'remote_calendar_cleanup_unconfirmed', v_cleanup_unconfirmed,
        'remote_calendar_cleanup_unconfirmed_count',
          v_cleanup_unconfirmed_count
      );
    end if;
  end loop;

  return jsonb_build_object(
    'step', null, 'deleted', 0, 'done', true,
    'remote_calendar_cleanup_unconfirmed', v_cleanup_unconfirmed,
    'remote_calendar_cleanup_unconfirmed_count',
      v_cleanup_unconfirmed_count
  );
end $$;

revoke execute on function public.purge_workspace_step(uuid, int)
  from public, anon, authenticated;
grant execute on function public.purge_workspace_step(uuid, int) to service_role;
