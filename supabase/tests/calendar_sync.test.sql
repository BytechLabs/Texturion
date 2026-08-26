-- [#245 / D137] Provider-neutral two-way calendar persistence.
--
-- Proves the failure boundaries that cannot be covered by provider doubles:
-- task/outbox atomicity, echo suppression, one-live uniqueness, non-overlapping
-- leases, one-use OAuth state, ICS handoff, exact instance identity, pull and
-- webhook-renewal recovery, reminder/confirmation invalidation, grants/purge.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('ca000000-0000-4000-8000-00000000000a', 'calendar-owner@test.local'),
  ('ca000000-0000-4000-8000-00000000000b', 'calendar-member@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at, timezone)
values
  ('ca000000-0000-4000-8000-0000000000c1', 'Calendar Heating',
   'ca000000-0000-4000-8000-00000000000a', 'CA', '780', now(),
   'America/Edmonton');

insert into public.company_members (company_id, user_id, role) values
  ('ca000000-0000-4000-8000-0000000000c1',
   'ca000000-0000-4000-8000-00000000000a', 'owner'),
  ('ca000000-0000-4000-8000-0000000000c1',
   'ca000000-0000-4000-8000-00000000000b', 'member');

insert into public.phone_numbers
  (id, company_id, provisioning_key, country, number_e164, status)
values
  ('ca000000-0000-4000-8000-0000000000f1',
   'ca000000-0000-4000-8000-0000000000c1',
   'calendar-sync-fixture', 'CA', '+17805557001', 'active');

insert into public.contacts (id, company_id, phone_e164, name) values
  ('ca000000-0000-4000-8000-0000000000d1',
   'ca000000-0000-4000-8000-0000000000c1',
   '+17805558001', 'Calendar Customer');

insert into public.conversations
  (id, company_id, contact_id, phone_number_id, status, last_message_at)
values
  ('ca000000-0000-4000-8000-0000000000e1',
   'ca000000-0000-4000-8000-0000000000c1',
   'ca000000-0000-4000-8000-0000000000d1',
   'ca000000-0000-4000-8000-0000000000f1', 'open', now());

insert into public.messages
  (id, company_id, conversation_id, direction, body, status, segments)
values
  ('ca000000-0000-4000-8000-00000000a001',
   'ca000000-0000-4000-8000-0000000000c1',
   'ca000000-0000-4000-8000-0000000000e1',
   'inbound', 'Please book the furnace visit.', 'received', 1),
  ('ca000000-0000-4000-8000-00000000a002',
   'ca000000-0000-4000-8000-0000000000c1',
   'ca000000-0000-4000-8000-0000000000e1',
   'inbound', 'A second task for identity constraints.', 'received', 1);

insert into public.tasks
  (id, company_id, message_id, conversation_id, title, description,
   assigned_user_id, due_at, created_by_user_id)
values
  ('ca000000-0000-4000-8000-00000000b001',
   'ca000000-0000-4000-8000-0000000000c1',
   'ca000000-0000-4000-8000-00000000a001',
   'ca000000-0000-4000-8000-0000000000e1',
   U&'Furnace caf\00e9 visit', E'Bring filter\r\nGate code 42',
   'ca000000-0000-4000-8000-00000000000b',
   now() + interval '3 days',
   'ca000000-0000-4000-8000-00000000000b'),
  ('ca000000-0000-4000-8000-00000000b002',
   'ca000000-0000-4000-8000-0000000000c1',
   'ca000000-0000-4000-8000-00000000a002',
   'ca000000-0000-4000-8000-0000000000e1',
   'Unmapped task', '', null, now() + interval '4 days',
   'ca000000-0000-4000-8000-00000000000b');

create or replace function pg_temp.company_id() returns uuid language sql immutable
as $$ select 'ca000000-0000-4000-8000-0000000000c1'::uuid $$;
create or replace function pg_temp.user_id() returns uuid language sql immutable
as $$ select 'ca000000-0000-4000-8000-00000000000b'::uuid $$;
create or replace function pg_temp.task_id() returns uuid language sql immutable
as $$ select 'ca000000-0000-4000-8000-00000000b001'::uuid $$;
create or replace function pg_temp.connection_id() returns uuid language sql stable
as $$
  select id from public.calendar_connections
   where company_id = pg_temp.company_id() and user_id = pg_temp.user_id()
     and revoked_at is null
$$;
create or replace function pg_temp.link_id() returns uuid language sql stable
as $$
  select id from public.task_calendar_links
   where connection_id = pg_temp.connection_id() and task_id = pg_temp.task_id()
$$;

-- CS-1. SQL and provider boundaries normalize Unicode/newlines identically.
do $$
declare
  v_a jsonb;
  v_b jsonb;
begin
  if public.calendar_normalize_text(U&'Cafe\0301' || E'\r\nline\rtwo')
     is distinct from U&'Caf\00e9' || E'\nline\ntwo' then
    raise exception 'CS-1 FAILED: SQL text normalization differs from NFC/LF';
  end if;
  v_a := public.calendar_snapshot_from_fields(
    now(), now() + interval '1 hour', 'America/Edmonton',
    U&'Cafe\0301', U&'note\0301' || E'\r\nline'
  );
  v_b := public.calendar_snapshot_from_fields(
    (v_a->>'start')::timestamptz, (v_a->>'end')::timestamptz,
    'America/Edmonton', U&'Caf\00e9', U&'not\00e9' || E'\nline'
  );
  if v_a is distinct from v_b then
    raise exception 'CS-1 FAILED: canonically equivalent provider/task snapshots differ';
  end if;
  raise notice 'CS-1 PASSED: Unicode NFC and CRLF/CR normalization match provider boundary';
end $$;

-- CS-2. OAuth state is hash-only, encrypted-verifier, and one-use.
do $$
declare
  v_id uuid;
  v jsonb;
  v_count integer;
begin
  v_id := public.api_create_calendar_oauth_state(
    pg_temp.company_id(), pg_temp.user_id(), 'google', repeat('a', 64),
    'AAECAwQFBgcICQoLDA0ODxAREhM', 'AAECAwQFBgcICQoL', 'v1',
    'https://api.test/calendar/google/callback', '/settings',
    now() + interval '10 minutes'
  );
  if v_id is null then raise exception 'CS-2 FAILED: no OAuth state id'; end if;
  v := public.api_consume_calendar_oauth_state(repeat('a', 64));
  if v->>'outcome' is distinct from 'consumed' then
    raise exception 'CS-2 FAILED: first consume returned %', v;
  end if;
  v := public.api_consume_calendar_oauth_state(repeat('a', 64));
  if v->>'outcome' is distinct from 'invalid' then
    raise exception 'CS-2 FAILED: replay returned %', v;
  end if;
  v_id := public.api_create_calendar_oauth_state(
    pg_temp.company_id(), pg_temp.user_id(), 'google', repeat('d', 64),
    'AAECAwQFBgcICQoLDA0ODxAREhM', 'AAECAwQFBgcICQoL', 'v1',
    'https://api.test/calendar/google/callback', '/settings',
    now() + interval '10 minutes'
  );
  update public.oauth_states
     set created_at = now() - interval '2 minutes',
         expires_at = now() - interval '1 minute'
   where id = v_id;
  v_count := public.api_purge_calendar_oauth_states(1);
  if v_count is distinct from 1
     or (select count(*) from public.oauth_states
          where consumed_at is not null or expires_at <= now()) is distinct from 1 then
    raise exception 'CS-2 FAILED: bounded OAuth purge count %', v_count;
  end if;
  v_count := public.api_purge_calendar_oauth_states(1000);
  if v_count is distinct from 1
     or exists (
       select 1 from public.oauth_states
        where consumed_at is not null or expires_at <= now()
     ) then
    raise exception 'CS-2 FAILED: OAuth purge did not drain expired rows';
  end if;
  raise notice 'CS-2 PASSED: OAuth state is one-use and boundedly purged';
end $$;

-- CS-3. Completing two-way revokes ICS and seeds outbound creates.  A different
-- provider/account/calendar cannot silently replace the existing identity.
do $$
declare
  v jsonb;
  v_first uuid;
  v_allowed boolean := false;
  v_failed boolean := false;
begin
  insert into public.messages
    (id, company_id, conversation_id, direction, body, status, segments)
  values
    ('ca000000-0000-4000-8000-00000000a010', pg_temp.company_id(),
     'ca000000-0000-4000-8000-0000000000e1', 'inbound',
     'Historical task outside initial calendar window.', 'received', 1),
    ('ca000000-0000-4000-8000-00000000a011', pg_temp.company_id(),
     'ca000000-0000-4000-8000-0000000000e1', 'inbound',
     'Future task outside initial calendar window.', 'received', 1);
  insert into public.tasks
    (id, company_id, message_id, conversation_id, title, description,
     assigned_user_id, due_at, created_by_user_id)
  values
    ('ca000000-0000-4000-8000-00000000b010', pg_temp.company_id(),
     'ca000000-0000-4000-8000-00000000a010',
     'ca000000-0000-4000-8000-0000000000e1', 'Old bounded task', '',
     pg_temp.user_id(), now() - interval '91 days', pg_temp.user_id()),
    ('ca000000-0000-4000-8000-00000000b011', pg_temp.company_id(),
     'ca000000-0000-4000-8000-00000000a011',
     'ca000000-0000-4000-8000-0000000000e1', 'Future bounded task', '',
     pg_temp.user_id(), now() + interval '366 days', pg_temp.user_id());
  perform public.api_mint_calendar_feed_token(
    pg_temp.company_id(), pg_temp.user_id(), repeat('b', 64)
  );
  begin
    perform public.api_complete_calendar_connection(
      pg_temp.company_id(), pg_temp.user_id(), 'microsoft', 'acct-ms',
      'owner@test.local', 'calendar-1', 'Jobs', 'America/Edmonton',
      'AQIDBAUGBwgJCgsMDQ4PEBESExQ', 'AQIDBAUGBwgJCgsM', 'v1',
      'invalid-provisional-watch', '/me/calendars/calendar-1/events',
      repeat('f', 63), now() + interval '2 hours', null
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed
     or exists (
       select 1 from public.calendar_connections
        where company_id = pg_temp.company_id() and user_id = pg_temp.user_id()
     )
     or not exists (
       select 1 from public.calendar_feed_tokens
        where company_id = pg_temp.company_id() and user_id = pg_temp.user_id()
          and revoked_at is null
     )
     or exists (
       select 1 from public.calendar_outbox
        where company_id = pg_temp.company_id()
     ) then
    raise exception 'CS-3 FAILED: invalid provisional watch changed prior setup';
  end if;
  v := public.api_complete_calendar_connection(
    pg_temp.company_id(), pg_temp.user_id(), 'microsoft', 'acct-ms',
    'owner@test.local', 'calendar-1', 'Jobs', 'America/Edmonton',
    'AQIDBAUGBwgJCgsMDQ4PEBESExQ', 'AQIDBAUGBwgJCgsM', 'v1',
    'graph-sub-1', '/me/calendars/calendar-1/events', repeat('b', 64),
    now() + interval '2 hours', null
  );
  v_first := (v->>'connection_id')::uuid;
  if v->>'outcome' is distinct from 'connected'
     or (v->>'ics_revoked')::int is distinct from 1
     or (v->>'creates_queued')::int is distinct from 1 then
    raise exception 'CS-3 FAILED: first completion %', v;
  end if;
  if exists (
    select 1 from public.calendar_feed_tokens
     where company_id = pg_temp.company_id() and user_id = pg_temp.user_id()
       and revoked_at is null
  ) then raise exception 'CS-3 FAILED: ICS remained live'; end if;
  if exists (
    select 1 from public.calendar_outbox
     where connection_id = v_first
       and task_id in (
         'ca000000-0000-4000-8000-00000000b010',
         'ca000000-0000-4000-8000-00000000b011'
       )
  ) then
    raise exception 'CS-3 FAILED: initial create seed escaped the -90/+365 window';
  end if;

  -- The provider delta window is also the permanent outbound boundary: edits
  -- outside it cannot create events that inbound sync can never observe.
  update public.tasks set title = 'Old bounded task edited'
   where id = 'ca000000-0000-4000-8000-00000000b010';
  if exists (
    select 1 from public.calendar_outbox
     where connection_id = v_first
       and task_id = 'ca000000-0000-4000-8000-00000000b010'
       and action = 'create' and state = 'queued'
  ) then
    raise exception 'CS-3 FAILED: outside-window edit enqueued an unreadable event';
  end if;

  -- Crossing the rolling +365 boundary is eligible immediately.
  update public.tasks set due_at = now() + interval '364 days'
   where id = 'ca000000-0000-4000-8000-00000000b011';
  if not exists (
    select 1 from public.calendar_outbox
     where connection_id = v_first
       and task_id = 'ca000000-0000-4000-8000-00000000b011'
       and action = 'create' and state = 'queued'
  ) then
    raise exception 'CS-3 FAILED: task entering rolling horizon did not enqueue';
  end if;
  update public.calendar_outbox
     set state = 'cancelled', cancelled_at = now()
   where connection_id = v_first
     and task_id = 'ca000000-0000-4000-8000-00000000b011'
     and state = 'queued';
  update public.tasks set due_at = now() + interval '366 days'
   where id = 'ca000000-0000-4000-8000-00000000b011';

  v_failed := false;
  begin
    perform public.api_complete_calendar_connection(
      pg_temp.company_id(), pg_temp.user_id(), 'microsoft', 'acct-ms',
      'owner@test.local', 'calendar-1', 'Jobs', 'America/Edmonton',
      'AQIDBAUGBwgJCgsMDQ4PEBESExQ', 'AQIDBAUGBwgJCgsM', 'v2',
      'invalid-replacement-watch', '/me/calendars/calendar-1/events',
      repeat('f', 63), now() + interval '2 hours', null
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed
     or not exists (
       select 1 from public.calendar_connections
        where id = v_first and status = 'active' and revoked_at is null
     )
     or not exists (
       select 1 from public.webhook_subscriptions
        where connection_id = v_first and provider_subscription_id = 'graph-sub-1'
          and revoked_at is null
     )
     or (select count(*) from public.calendar_outbox
          where connection_id = v_first and state = 'queued') is distinct from 1 then
    raise exception 'CS-3 FAILED: failed replacement damaged prior connection';
  end if;

  v := public.api_complete_calendar_connection(
    pg_temp.company_id(), pg_temp.user_id(), 'google', 'acct-google',
    'owner@test.local', 'primary', 'Primary', 'America/Edmonton',
    'AAECAwQFBgcICQoLDA0ODxAREhM', 'AAECAwQFBgcICQoL', 'v2',
    'google-replacement-watch', 'google-replacement-resource', repeat('c', 64),
    now() + interval '6 days', null
  );
  if v->>'outcome' is distinct from 'replacement_requires_disconnect'
     or (v->>'connection_id')::uuid is distinct from v_first then
    raise exception 'CS-3 FAILED: identity replacement was not refused %', v;
  end if;
  if (select count(*) from public.calendar_connections
       where company_id = pg_temp.company_id() and user_id = pg_temp.user_id()
         and revoked_at is null) is distinct from 1 then
    raise exception 'CS-3 FAILED: replacement left != 1 live connection';
  end if;
  if not exists (
    select 1 from public.calendar_connections where id = v_first
      and provider = 'microsoft' and provider_account_id = 'acct-ms'
      and selected_calendar_id = 'calendar-1'
      and credential_key_version = 'v1'
      and status = 'active' and revoked_at is null
  ) then raise exception 'CS-3 FAILED: refused replacement mutated identity/credential'; end if;
  if (select count(*) from public.calendar_outbox
       where connection_id = pg_temp.connection_id() and action = 'create'
         and state = 'queued') is distinct from 1 then
    raise exception 'CS-3 FAILED: refused replacement changed initial create';
  end if;
  if not exists (
    select 1 from public.webhook_subscriptions s
     where s.connection_id = pg_temp.connection_id()
       and s.provider_subscription_id = 'graph-sub-1'
       and s.client_state_hash = repeat('b', 64)
       and s.revoked_at is null
  ) then
    raise exception 'CS-3 FAILED: refused replacement changed initial watch';
  end if;

  begin
    insert into public.calendar_connections (
      company_id, user_id, provider, provider_account_id,
      selected_calendar_id, selected_calendar_timezone,
      credential_ciphertext, credential_iv, credential_key_version
    ) values (
      pg_temp.company_id(), pg_temp.user_id(), 'google', 'another',
      'primary', 'America/Edmonton',
      'AAECAwQFBgcICQoLDA0ODxAREhM', 'AAECAwQFBgcICQoL', 'v1'
    );
    v_allowed := true;
  exception when unique_violation then null;
  end;
  if v_allowed is distinct from false then
    raise exception 'CS-3 FAILED: second live connection inserted';
  end if;
  raise notice 'CS-3 PASSED: ICS handoff, create seeding, identity refusal and one-live invariant';
end $$;

-- CS-4. Notifications authenticate, coalesce to one connection pull, claims do
-- not overlap, and an expired/crashed lease is recoverable.
do $$
declare
  v jsonb;
  v_before bigint;
  v_claim public.calendar_connections%rowtype;
  v_second public.calendar_connections%rowtype;
begin
  select pull_generation into v_before from public.calendar_connections
   where id = pg_temp.connection_id();
  v := public.api_request_calendar_pull(
    'microsoft', 'graph-sub-1', '/changed/event/path', repeat('d', 64)
  );
  if v->>'outcome' is distinct from 'ignored'
     or (select pull_generation from public.calendar_connections
          where id = pg_temp.connection_id()) is distinct from v_before then
    raise exception 'CS-4 FAILED: invalid clientState scheduled a pull: %', v;
  end if;
  perform public.api_request_calendar_pull(
    'microsoft', 'graph-sub-1', '/changed/event/one', repeat('b', 64)
  );
  perform public.api_request_calendar_pull(
    'microsoft', 'graph-sub-1', '/changed/event/two', repeat('b', 64)
  );
  if (select count(*) from public.calendar_connections
       where id = pg_temp.connection_id() and sync_due_at is not null)
     is distinct from 1 then
    raise exception 'CS-4 FAILED: notifications did not coalesce by connection';
  end if;

  select * into v_claim from public.api_claim_due_calendar_pulls('pull-a', 1, 120);
  if v_claim.id is null or not v_claim.pull_full_sync then
    raise exception 'CS-4 FAILED: initial full-window pull not claimed';
  end if;
  v := public.api_renew_calendar_pull_lease(
    v_claim.id, 'pull-a', v_claim.pull_generation, 180
  );
  if v->>'outcome' is distinct from 'renewed' then
    raise exception 'CS-4 FAILED: pull lease renewal %', v;
  end if;
  select * into v_second from public.api_claim_due_calendar_pulls('pull-b', 1, 120);
  if v_second.id is not null then raise exception 'CS-4 FAILED: overlapping pull claim'; end if;

  -- A webhook during a multi-page pull is remembered as one follow-up.  It
  -- must not supersede this worker or discard the cursor it already read.
  v_before := v_claim.pull_generation;
  v := public.api_request_calendar_pull(
    'microsoft', 'graph-sub-1', '/changed/event/mid-page', repeat('b', 64)
  );
  if v->>'outcome' is distinct from 'queued'
     or (v->>'generation')::bigint is distinct from v_before
     or not exists (
       select 1 from public.calendar_connections
        where id = v_claim.id and pull_followup_requested
          and pull_generation = v_before
     ) then
    raise exception 'CS-4 FAILED: mid-page notification superseded pull %', v;
  end if;
  v := public.api_renew_calendar_pull_lease(
    v_claim.id, 'pull-a', v_claim.pull_generation, 180
  );
  if v->>'outcome' is distinct from 'renewed' then
    raise exception 'CS-4 FAILED: notification starved lease renewal %', v;
  end if;
  v := public.api_commit_calendar_pull(
    v_claim.id, 'pull-a', v_claim.pull_generation, 'cursor-mid-page'
  );
  if v->>'outcome' is distinct from 'committed'
     or not exists (
       select 1 from public.calendar_connections
        where id = v_claim.id and sync_cursor = 'cursor-mid-page'
          and sync_due_at <= now() and not pull_followup_requested
          and pull_lease_owner is null
     ) then
    raise exception 'CS-4 FAILED: current cursor/follow-up handoff %', v;
  end if;
  select * into v_claim
    from public.api_claim_due_calendar_pulls('pull-followup', 1, 120);
  if v_claim.id is null then
    raise exception 'CS-4 FAILED: coalesced follow-up was not claimable';
  end if;
  select * into v_second
    from public.api_claim_due_calendar_pulls('pull-overlap', 1, 120);
  if v_second.id is not null then
    raise exception 'CS-4 FAILED: follow-up pull claims overlapped';
  end if;

  update public.calendar_connections
     set pull_lease_expires_at = now() - interval '1 second'
   where id = v_claim.id;
  select * into v_second from public.api_claim_due_calendar_pulls('pull-b', 1, 120);
  if v_second.id is distinct from v_claim.id then
    raise exception 'CS-4 FAILED: expired pull lease not recovered';
  end if;
  v := public.api_commit_calendar_pull(
    v_second.id, 'pull-b', v_second.pull_generation, 'cursor-1'
  );
  if v->>'outcome' is distinct from 'committed'
     or not exists (
       select 1 from public.calendar_connections where id = v_second.id
         and sync_cursor = 'cursor-1' and last_verified_at is not null
         and sync_due_at > now() and pull_lease_owner is null
         and last_full_sync_at is not null
         and full_sync_due_at > now() + interval '6 days'
     ) then raise exception 'CS-4 FAILED: pull commit %', v; end if;

  -- A delta cursor is periodically discarded so its original time window
  -- slides forward; a crash never clears that reseed obligation.
  update public.calendar_connections
     set sync_due_at = now(), full_sync_due_at = now() - interval '1 second'
   where id = v_second.id;
  select * into v_claim from public.api_claim_due_calendar_pulls('pull-c', 1, 120);
  if v_claim.id is distinct from v_second.id or not v_claim.pull_full_sync then
    raise exception 'CS-4 FAILED: periodic full-window reseed not signalled';
  end if;
  v := public.api_commit_calendar_pull(
    v_claim.id, 'pull-c', v_claim.pull_generation, 'cursor-2'
  );
  if v->>'outcome' is distinct from 'committed' then
    raise exception 'CS-4 FAILED: reseed commit %', v;
  end if;
  raise notice 'CS-4 PASSED: authenticated coalescing, renewable/recoverable lease, periodic poll and sliding reseed';
end $$;

-- CS-5. The initial create claim is exclusive and commit records an INSTANCE,
-- never a recurring series master.
do $$
declare
  v_create public.calendar_outbox%rowtype;
  v_none public.calendar_outbox%rowtype;
  v jsonb;
  v_task public.tasks%rowtype;
  v_connection_id uuid;
  v_link_id uuid;
  v_credential_generation bigint;
  v_ambiguous public.calendar_outbox%rowtype;
  v_requested jsonb;
  v_observed_start timestamptz;
  v_conflict_link uuid;
begin
  v_connection_id := pg_temp.connection_id();
  select * into v_create from public.api_claim_calendar_outbox('write-a', 1, 120);
  if v_create.action is distinct from 'create' then
    raise exception 'CS-5 FAILED: first action was %', v_create.action;
  end if;
  select * into v_none from public.api_claim_calendar_outbox('write-b', 1, 120);
  if v_none.id is not null then raise exception 'CS-5 FAILED: overlapping outbox claim'; end if;
  select * into v_task from public.tasks where id = pg_temp.task_id();
  v := public.api_commit_calendar_outbox_created(
    v_create.id, 'write-a', v_create.generation,
    'event-occurrence-1', 'instance-2026-1', 'series-master-1', 'version-1',
    (v_create.requested_snapshot->>'start')::timestamptz,
    (v_create.requested_snapshot->>'end')::timestamptz,
    v_create.requested_snapshot->>'timeZone',
    v_task.title, v_task.description
  );
  if v->>'outcome' is distinct from 'committed' then
    raise exception 'CS-5 FAILED: create commit %', v;
  end if;
  if not exists (
    select 1 from public.task_calendar_links
     where id = pg_temp.link_id()
       and provider_event_id = 'event-occurrence-1'
       and provider_instance_id = 'instance-2026-1'
       and provider_series_id = 'series-master-1'
       and base_snapshot = last_sent_snapshot
  ) then raise exception 'CS-5 FAILED: instance/base was not committed'; end if;
  v_link_id := pg_temp.link_id();

  -- Microsoft create recovery: POST(A) may be accepted with its response lost,
  -- then a human changes the remote occurrence to B before idempotent recovery.
  -- B is not our sent base. Map the instance and flag A-vs-B; never queue a
  -- blind PATCH that overwrites the human change.
  insert into public.messages
    (id, company_id, conversation_id, direction, body, status, segments)
  values (
    'ca000000-0000-4000-8000-00000000a012', pg_temp.company_id(),
    'ca000000-0000-4000-8000-0000000000e1', 'inbound',
    'Ambiguous Microsoft create fixture.', 'received', 1
  );
  insert into public.tasks
    (id, company_id, message_id, conversation_id, title, description,
     assigned_user_id, due_at, created_by_user_id)
  values (
    'ca000000-0000-4000-8000-00000000b012', pg_temp.company_id(),
    'ca000000-0000-4000-8000-00000000a012',
    'ca000000-0000-4000-8000-0000000000e1',
    'Ambiguous Microsoft create', '', pg_temp.user_id(),
    now() + interval '6 days', pg_temp.user_id()
  );
  select * into v_ambiguous
    from public.api_claim_calendar_outbox('create-ms-first', 1, 120);
  v_requested := v_ambiguous.requested_snapshot;
  v := public.api_mark_calendar_outbox_effect_started(
    v_ambiguous.id, 'create-ms-first', v_ambiguous.generation
  );
  v := public.api_retry_calendar_outbox(
    v_ambiguous.id, 'create-ms-first', v_ambiguous.generation,
    1, 'timeout', 'Create response was lost', false, false
  );
  update public.calendar_outbox set available_at = now()
   where id = v_ambiguous.id;
  select * into v_ambiguous
    from public.api_claim_calendar_outbox('create-ms-recovery', 1, 120);
  v_observed_start := (v_requested->>'start')::timestamptz + interval '2 hours';
  v := public.api_commit_calendar_outbox_created(
    v_ambiguous.id, 'create-ms-recovery', v_ambiguous.generation,
    'ms-ambiguous-event', 'ms-ambiguous-instance', null, 'ms-human-v2',
    v_observed_start,
    (v_requested->>'end')::timestamptz + interval '2 hours',
    v_requested->>'timeZone', 'Ambiguous Microsoft create', ''
  );
  select id into v_conflict_link from public.task_calendar_links
   where connection_id = v_connection_id
     and task_id = 'ca000000-0000-4000-8000-00000000b012';
  if v->>'outcome' is distinct from 'conflict'
     or v->>'reason' is distinct from 'create_observed_mismatch'
     or not exists (
       select 1 from public.task_calendar_links
        where id = v_conflict_link and link_state = 'conflict'
          and base_snapshot = v_requested
          and last_sent_snapshot is null
          and (conflict_theirs_snapshot->>'start')::timestamptz = v_observed_start
     )
     or exists (
       select 1 from public.calendar_outbox
        where connection_id = v_connection_id
          and task_id = 'ca000000-0000-4000-8000-00000000b012'
          and state in ('queued', 'leased')
     ) then
    raise exception 'CS-5 FAILED: ambiguous Microsoft create overwrote human B %', v;
  end if;
  -- Keep later sections focused on their own first-conflict counter.
  update public.task_calendar_links
     set link_state = 'active', base_snapshot = conflict_theirs_snapshot,
         conflict_ours_snapshot = null, conflict_theirs_snapshot = null,
         conflict_detected_at = null
   where id = v_conflict_link;
  update public.calendar_connections
     set conflict_occurrences_at = '{}'::timestamptz[],
         conflict_window_started_at = null,
         conflict_window_count = 0,
         last_conflict_at = null
   where id = v_connection_id;

  -- Refresh-token rotation is a generation-CAS behind its own short lease.
  -- An overlapping worker cannot refresh the same token, and a stale commit
  -- cannot overwrite a newer sealed envelope.
  v := public.api_claim_calendar_credential_refresh(
    pg_temp.company_id(), v_connection_id, pg_temp.user_id(),
    'credential-a', null, 120
  );
  if v->>'outcome' is distinct from 'claimed' then
    raise exception 'CS-5 FAILED: credential lease was not claimed %', v;
  end if;
  v_credential_generation := (v->>'credential_generation')::bigint;
  v := public.api_claim_calendar_credential_refresh(
    pg_temp.company_id(), v_connection_id, pg_temp.user_id(),
    'credential-b', v_credential_generation, 120
  );
  if v->>'outcome' is distinct from 'busy' then
    raise exception 'CS-5 FAILED: overlapping credential refresh was not busy %', v;
  end if;
  v := public.api_commit_calendar_credential_refresh(
    v_connection_id, 'credential-a', v_credential_generation,
    'AwQFBgcICQoLDA0ODxAREhMUFRY', 'AwQFBgcICQoLDA0O', 'v1-refresh'
  );
  if v->>'outcome' is distinct from 'committed'
     or (v->>'credential_generation')::bigint <= v_credential_generation then
    raise exception 'CS-5 FAILED: credential refresh commit %', v;
  end if;
  -- If the first DB response was lost, replaying the identical sealed
  -- envelope at expected+1 recognizes the already-committed rotation.  It
  -- does not require a now-cleared lease and does not rotate generation twice.
  v := public.api_commit_calendar_credential_refresh(
    v_connection_id, 'credential-a', v_credential_generation,
    'AwQFBgcICQoLDA0ODxAREhMUFRY', 'AwQFBgcICQoLDA0O', 'v1-refresh'
  );
  if v->>'outcome' is distinct from 'committed'
     or (v->>'idempotent')::boolean is distinct from true
     or (v->>'credential_generation')::bigint
          is distinct from v_credential_generation + 1
     or (select credential_generation from public.calendar_connections
          where id = v_connection_id) is distinct from
          v_credential_generation + 1 then
    raise exception 'CS-5 FAILED: identical credential commit was not idempotent %', v;
  end if;
  v := public.api_commit_calendar_credential_refresh(
    v_connection_id, 'credential-a', v_credential_generation,
    'BAUGBwgJCgsMDQ4PEBESExQVFhc', 'BAUGBwgJCgsMDQ4P', 'stale'
  );
  if v->>'outcome' is distinct from 'superseded' then
    raise exception 'CS-5 FAILED: stale credential CAS was not rejected %', v;
  end if;
  v_credential_generation := (v->>'credential_generation')::bigint;
  v := public.api_claim_calendar_credential_refresh(
    pg_temp.company_id(), v_connection_id, pg_temp.user_id(),
    'credential-stale-auth', v_credential_generation, 120
  );
  if v->>'outcome' is distinct from 'claimed' then
    raise exception 'CS-5 FAILED: stale-auth credential fixture %', v;
  end if;

  -- Same provider/account/calendar is credential rotation, not replacement.
  -- The connection, mapping and terminal create stay put; only the watch and
  -- encrypted credential envelope change.
  v := public.api_complete_calendar_connection(
    pg_temp.company_id(), pg_temp.user_id(), 'microsoft', 'acct-ms',
    'owner+reauth@test.local', 'calendar-1', 'Jobs', 'America/Edmonton',
    'AgMEBQYHCAkKCwwNDg8QERITFBU', 'AgMEBQYHCAkKCwwN', 'v2',
    'graph-sub-reauth', '/me/calendars/calendar-1/events', repeat('c', 64),
    now() + interval '2 hours', null
  );
  if v->>'outcome' is distinct from 'connected'
     or (v->>'reauthorized')::boolean is distinct from true
     or (v->>'connection_id')::uuid is distinct from v_connection_id
     or (v->>'creates_queued')::integer is distinct from 0
     or pg_temp.link_id() is distinct from v_link_id
     or not exists (
       select 1 from public.task_calendar_links
        where id = v_link_id and connection_id = v_connection_id
          and provider_instance_id = 'instance-2026-1'
     )
     or not exists (
       select 1 from public.calendar_connections
        where id = v_connection_id and credential_key_version = 'v2'
          and provider_account_label = 'owner+reauth@test.local'
          and status = 'active' and revoked_at is null
     )
     or not exists (
       select 1 from public.webhook_subscriptions
        where connection_id = v_connection_id
          and provider_subscription_id = 'graph-sub-reauth'
          and revoked_at is null
     )
     or (select count(*) from public.task_calendar_links
          where connection_id = v_connection_id and task_id = pg_temp.task_id())
        is distinct from 1 then
    raise exception 'CS-5 FAILED: in-place reauthorization damaged identity/mapping %', v;
  end if;
  v := public.api_retry_calendar_credential_refresh(
    v_connection_id, 'credential-stale-auth', v_credential_generation,
    true, 'invalid_grant', 'Stale worker must not downgrade new OAuth credentials'
  );
  if v->>'outcome' is distinct from 'superseded'
     or not exists (
       select 1 from public.calendar_connections
        where id = v_connection_id and credential_key_version = 'v2'
          and credential_generation > v_credential_generation
          and credential_refresh_lease_owner is null
          and status = 'active'
     ) then
    raise exception 'CS-5 FAILED: stale auth failure downgraded OAuth reauth %', v;
  end if;
  raise notice 'CS-5 PASSED: instance, credential CAS and same-identity reauth preserve mapping';
end $$;

-- CS-6. A human task move clears confirmation and atomically creates/refreshes
-- exactly one live outbox row with actor/display evidence.
do $$
declare
  v_due timestamptz := now() + interval '5 days';
  v_generation bigint;
begin
  perform public.api_confirm_task(pg_temp.company_id(), pg_temp.task_id(), 'crew');
  perform public.update_task(
    pg_temp.company_id(), pg_temp.task_id(), null, null, v_due, false,
    pg_temp.user_id()
  );
  if not exists (
    select 1 from public.tasks where id = pg_temp.task_id()
      and confirmed_at is null and confirmed_by is null
      and schedule_changed_at is not null
      and schedule_changed_by = pg_temp.user_id()
  ) then raise exception 'CS-6 FAILED: move retained confirmation/actor missing'; end if;
  if (select count(*) from public.calendar_outbox
       where connection_id = pg_temp.connection_id() and task_id = pg_temp.task_id()
         and state in ('queued', 'leased')) is distinct from 1 then
    raise exception 'CS-6 FAILED: task move did not atomically queue one action';
  end if;
  select generation into v_generation from public.calendar_outbox
   where connection_id = pg_temp.connection_id() and task_id = pg_temp.task_id()
     and state = 'queued';
  perform public.update_task(
    pg_temp.company_id(), pg_temp.task_id(), null, null,
    v_due + interval '1 day', false, pg_temp.user_id()
  );
  if (select count(*) from public.calendar_outbox
       where connection_id = pg_temp.connection_id() and task_id = pg_temp.task_id()
         and state in ('queued', 'leased')) is distinct from 1
     or (select generation from public.calendar_outbox
          where connection_id = pg_temp.connection_id() and task_id = pg_temp.task_id()
            and state = 'queued') <= v_generation then
    raise exception 'CS-6 FAILED: second move duplicated instead of generation-bumping';
  end if;
  raise notice 'CS-6 PASSED: confirmation clear and atomic one-live outbox';
end $$;

-- CS-7. A provider-only move applies under echo suppression: no new outbox,
-- no human timestamp rewrite, and no stale pending reminder survives.
do $$
declare
  v_write public.calendar_outbox%rowtype;
  v_task public.tasks%rowtype;
  v jsonb;
  v_human_at timestamptz;
  v_human_by uuid;
  v_new_due timestamptz;
  v_old_sent_due timestamptz;
  v_old_sent_end timestamptz;
  v_pull public.calendar_connections%rowtype;
  v_reconcile public.calendar_outbox%rowtype;
  v_followup public.calendar_outbox%rowtype;
  v_link public.task_calendar_links%rowtype;
  v_accepted_snapshot jsonb;
  v_current_snapshot jsonb;
  v_held_reminder uuid;
begin
  select * into v_write from public.api_claim_calendar_outbox('write-a', 1, 120);
  select * into v_task from public.tasks where id = pg_temp.task_id();
  v_old_sent_due := (v_write.requested_snapshot->>'start')::timestamptz;
  v_old_sent_end := (v_write.requested_snapshot->>'end')::timestamptz;
  v := public.api_commit_calendar_outbox_sent(
    v_write.id, 'write-a', v_write.generation, 'version-2',
    (v_write.requested_snapshot->>'start')::timestamptz,
    (v_write.requested_snapshot->>'end')::timestamptz,
    v_write.requested_snapshot->>'timeZone', v_task.title, v_task.description
  );
  if v->>'outcome' not in ('committed', 'followup_checked') then
    raise exception 'CS-7 FAILED: local push commit %', v;
  end if;

  perform public.api_confirm_task(pg_temp.company_id(), pg_temp.task_id(), 'customer');
  perform public.api_sync_task_reminders(
    pg_temp.company_id(), pg_temp.task_id(), pg_temp.user_id(),
    jsonb_build_array(jsonb_build_object(
      'offset_minutes', 60, 'body', 'We are coming soon.',
      'send_at', (now() + interval '2 days')::text
    )),
    'America/Edmonton', 'contact', now() + interval '10 days'
  );
  update public.scheduled_messages
     set status = 'held',
         held_reason = 'Calendar verification is temporarily unavailable.',
         held_reason_key = 'calendar_unverified', held_at = now(),
         claimed_at = null
   where task_id = pg_temp.task_id() and origin = 'reminder'
     and reminder_offset_minutes = 60 and status = 'pending'
  returning id into v_held_reminder;
  if v_held_reminder is null then
    raise exception 'CS-7 FAILED: calendar-held reminder fixture missing';
  end if;
  select schedule_changed_at, schedule_changed_by, due_at + interval '2 hours'
    into v_human_at, v_human_by, v_new_due
    from public.tasks where id = pg_temp.task_id();

  update public.calendar_connections set sync_due_at = now()
   where id = pg_temp.connection_id();
  select * into v_pull
    from public.api_claim_due_calendar_pulls('provider-a', 1, 120);
  if v_pull.id is null then
    raise exception 'CS-7 FAILED: provider pull lease not claimed';
  end if;
  select * into v_task from public.tasks where id = pg_temp.task_id();
  v := public.api_apply_calendar_provider_snapshot(
    pg_temp.company_id(), pg_temp.connection_id(), 'provider-a',
    v_pull.pull_generation - 1, pg_temp.task_id(),
    'event-occurrence-1', 'instance-2026-1', 'series-master-1', 'stale-version',
    v_new_due, v_new_due + interval '1 hour', 'America/Edmonton',
    v_task.title, v_task.description
  );
  if v->>'outcome' is distinct from 'superseded'
     or (select due_at from public.tasks where id = pg_temp.task_id()) = v_new_due then
    raise exception 'CS-7 FAILED: stale pull mutated task: %', v;
  end if;
  v := public.api_renew_calendar_pull_lease(
    v_pull.id, 'provider-a', v_pull.pull_generation, 120
  );
  if v->>'outcome' is distinct from 'renewed' then
    raise exception 'CS-7 FAILED: current pull lease did not renew: %', v;
  end if;
  v := public.api_apply_calendar_provider_snapshot(
    pg_temp.company_id(), pg_temp.connection_id(), 'provider-a',
    v_pull.pull_generation, pg_temp.task_id(),
    'event-occurrence-1', 'instance-2026-1', 'series-master-1', 'version-3',
    v_new_due, v_new_due + interval '1 hour', 'America/Edmonton',
    v_task.title, v_task.description
  );
  if v->>'outcome' is distinct from 'provider_applied' then
    raise exception 'CS-7 FAILED: provider apply %', v;
  end if;
  if not exists (
    select 1 from public.tasks where id = pg_temp.task_id()
      and due_at = v_new_due and confirmed_at is null and confirmed_by is null
      and schedule_changed_at = v_human_at
      and schedule_changed_by is not distinct from v_human_by
  ) then raise exception 'CS-7 FAILED: provider apply rewrote human evidence/confirmation'; end if;
  if exists (
    select 1 from public.scheduled_messages where task_id = pg_temp.task_id()
      and origin = 'reminder' and status = 'pending'
  ) then raise exception 'CS-7 FAILED: stale reminder survived provider move'; end if;
  if not exists (
    select 1 from public.scheduled_messages
     where id = v_held_reminder and status = 'canceled'
       and held_reason_key = 'calendar_unverified'
       and held_reason is not null and canceled_at is not null
  ) then
    raise exception 'CS-7 FAILED: stale calendar hold blocked corrected reminder';
  end if;
  perform public.api_sync_task_reminders(
    pg_temp.company_id(), pg_temp.task_id(), pg_temp.user_id(),
    jsonb_build_array(jsonb_build_object(
      'offset_minutes', 60, 'body', 'Corrected appointment reminder.',
      'send_at', (v_new_due - interval '1 hour')::text
    )),
    'America/Edmonton', 'contact', v_new_due + interval '1 day'
  );
  if not exists (
    select 1 from public.scheduled_messages
     where task_id = pg_temp.task_id() and origin = 'reminder'
       and reminder_offset_minutes = 60 and status = 'pending'
       and id <> v_held_reminder
  ) then
    raise exception 'CS-7 FAILED: corrected reminder did not replace stale hold';
  end if;
  if exists (
    select 1 from public.calendar_outbox
     where connection_id = pg_temp.connection_id() and task_id = pg_temp.task_id()
       and state in ('queued', 'leased')
  ) then raise exception 'CS-7 FAILED: provider apply echoed into outbox'; end if;

  if (select last_sent_snapshot from public.task_calendar_links
       where id = pg_temp.link_id()) is not null then
    raise exception 'CS-7 FAILED: provider-agreed base retained stale echo evidence';
  end if;

  -- The provider now changes back to the exact snapshot we previously sent.
  -- Because an intervening provider value became the agreed base, this is a
  -- new provider edit, not a delayed echo, and must win without a push-back.
  v := public.api_apply_calendar_provider_snapshot(
    pg_temp.company_id(), pg_temp.connection_id(), 'provider-a',
    v_pull.pull_generation, pg_temp.task_id(),
    'event-occurrence-1', 'instance-2026-1', 'series-master-1', 'version-4',
    v_old_sent_due, v_old_sent_end, v_write.requested_snapshot->>'timeZone',
    v_task.title, v_task.description
  );
  if v->>'outcome' is distinct from 'provider_applied'
     or (select due_at from public.tasks where id = pg_temp.task_id())
        is distinct from v_old_sent_due
     or (select last_sent_snapshot from public.task_calendar_links
          where id = pg_temp.link_id()) is not null
     or exists (
       select 1 from public.calendar_outbox
        where connection_id = pg_temp.connection_id()
          and task_id = pg_temp.task_id() and state in ('queued', 'leased')
     ) then
    raise exception 'CS-7 FAILED: stale echo evidence overrode later provider revert %', v;
  end if;
  v := public.api_commit_calendar_pull(
    v_pull.id, 'provider-a', v_pull.pull_generation, 'cursor-3'
  );
  if v->>'outcome' is distinct from 'committed' then
    raise exception 'CS-7 FAILED: provider pull commit %', v;
  end if;

  -- O -> local A -> provider accepts A but response is lost -> local B.  The
  -- retry's conditional write rereads remote A.  Its leased, ambiguity-marked
  -- requested_snapshot proves A was our write, so B is serialized instead of
  -- being exposed as a false human conflict.
  perform public.update_task(
    pg_temp.company_id(), pg_temp.task_id(), null, null,
    v_old_sent_due + interval '3 hours', false, pg_temp.user_id()
  );
  select * into v_reconcile
    from public.api_claim_calendar_outbox('ambiguous-a', 1, 120);
  if v_reconcile.id is null or v_reconcile.action is distinct from 'upsert' then
    raise exception 'CS-7 FAILED: ambiguous PATCH fixture was not claimed';
  end if;
  v_accepted_snapshot := v_reconcile.requested_snapshot;
  v := public.api_mark_calendar_outbox_effect_started(
    v_reconcile.id, 'ambiguous-a', v_reconcile.generation
  );
  if v->>'outcome' is distinct from 'marked' then
    raise exception 'CS-7 FAILED: ambiguous PATCH boundary %', v;
  end if;
  v := public.api_retry_calendar_outbox(
    v_reconcile.id, 'ambiguous-a', v_reconcile.generation,
    1, 'provider_timeout', 'PATCH response was lost', false
  );
  if v->>'outcome' is distinct from 'queued' then
    raise exception 'CS-7 FAILED: ambiguous PATCH was not retained %', v;
  end if;
  perform public.update_task(
    pg_temp.company_id(), pg_temp.task_id(), null, null,
    v_old_sent_due + interval '5 hours', false, pg_temp.user_id()
  );
  update public.calendar_outbox set available_at = now()
   where id = v_reconcile.id;
  select * into v_reconcile
    from public.calendar_outbox where id = v_reconcile.id;
  update public.calendar_connections set sync_due_at = now()
   where id = pg_temp.connection_id();
  select * into v_pull
    from public.api_claim_due_calendar_pulls('ambiguous-pull', 1, 120);
  if v_pull.id is distinct from pg_temp.connection_id() then
    raise exception 'CS-7 FAILED: ambiguous-write webhook pull not claimed';
  end if;
  select * into v_task from public.tasks where id = pg_temp.task_id();
  select * into v_link from public.task_calendar_links where id = pg_temp.link_id();
  v_current_snapshot := public.calendar_task_snapshot(
    v_task.due_at, v_task.title, v_task.description,
    v_link.base_snapshot, 'America/Edmonton'
  );
  if v_reconcile.requested_snapshot is distinct from v_accepted_snapshot
     or not v_reconcile.provider_effect_ambiguous
     or v_current_snapshot = v_accepted_snapshot then
    raise exception 'CS-7 FAILED: local B overwrote durable ambiguous A intent';
  end if;
  v := public.api_apply_calendar_provider_snapshot(
    pg_temp.company_id(), pg_temp.connection_id(), 'ambiguous-pull',
    v_pull.pull_generation, pg_temp.task_id(),
    'event-occurrence-1', 'instance-2026-1', 'series-master-1',
    'ambiguous-a-version',
    (v_accepted_snapshot->>'start')::timestamptz,
    (v_accepted_snapshot->>'end')::timestamptz,
    v_accepted_snapshot->>'timeZone', v_task.title, v_task.description
  );
  if v->>'outcome' is distinct from 'push_queued'
     or v->>'reason' is distinct from 'ambiguous_effect_recovered'
     or not exists (
       select 1 from public.task_calendar_links
        where id = pg_temp.link_id() and link_state = 'active'
          and base_snapshot = v_accepted_snapshot
          and conflict_detected_at is null
     )
     or not exists (
       select 1 from public.calendar_outbox
        where id = v_reconcile.id and state = 'completed'
          and not provider_effect_ambiguous
     )
     or not exists (
       select 1 from public.calendar_outbox
        where connection_id = pg_temp.connection_id()
          and task_id = pg_temp.task_id() and state = 'queued'
          and action = 'upsert' and requested_snapshot = v_current_snapshot
          and not provider_effect_ambiguous
     ) then
    raise exception 'CS-7 FAILED: accepted ambiguous A became a false conflict %', v;
  end if;
  v := public.api_commit_calendar_pull(
    v_pull.id, 'ambiguous-pull', v_pull.pull_generation, 'cursor-ambiguous-a'
  );
  if v->>'outcome' is distinct from 'committed' then
    raise exception 'CS-7 FAILED: ambiguous-write pull commit %', v;
  end if;
  select * into v_followup
    from public.api_claim_calendar_outbox('ambiguous-b', 1, 120);
  v := public.api_commit_calendar_outbox_sent(
    v_followup.id, 'ambiguous-b', v_followup.generation,
    'ambiguous-b-version',
    (v_followup.requested_snapshot->>'start')::timestamptz,
    (v_followup.requested_snapshot->>'end')::timestamptz,
    v_followup.requested_snapshot->>'timeZone', v_task.title, v_task.description
  );
  if v->>'outcome' not in ('committed', 'followup_checked') then
    raise exception 'CS-7 FAILED: recovered-B followup commit %', v;
  end if;
  raise notice 'CS-7 PASSED: provider apply retires one-shot and ambiguous-write echo evidence';
end $$;

-- CS-8. Missing/series instance identities are rejected structurally.
do $$
declare
  v_allowed boolean := false;
  v_base jsonb;
begin
  v_base := public.calendar_snapshot_from_fields(
    now() + interval '4 days', now() + interval '4 days 1 hour',
    'America/Edmonton', 'Unmapped task', ''
  );
  begin
    insert into public.task_calendar_links (
      company_id, connection_id, task_id, provider_event_id,
      provider_instance_id, base_snapshot
    ) values (
      pg_temp.company_id(), pg_temp.connection_id(),
      'ca000000-0000-4000-8000-00000000b002', 'event-2', null, v_base
    );
    v_allowed := true;
  exception when not_null_violation then null;
  end;
  if v_allowed is distinct from false then
    raise exception 'CS-8 FAILED: null instance id accepted';
  end if;
  v_allowed := false;
  begin
    insert into public.task_calendar_links (
      company_id, connection_id, task_id, provider_event_id,
      provider_instance_id, provider_series_id, base_snapshot
    ) values (
      pg_temp.company_id(), pg_temp.connection_id(),
      'ca000000-0000-4000-8000-00000000b002', 'event-2',
      'series-master-2', 'series-master-2', v_base
    );
    v_allowed := true;
  exception when check_violation then null;
  end;
  if v_allowed is distinct from false then
    raise exception 'CS-8 FAILED: series id accepted as instance id';
  end if;
  raise notice 'CS-8 PASSED: occurrence instance identity is mandatory and distinct from series';
end $$;

-- CS-9. Every table is RLS/service-only and teardown names it child-first.
do $$
declare
  v_table text;
  v_source text;
  v_signature text;
begin
  foreach v_table in array array[
    'calendar_connections', 'oauth_states', 'webhook_subscriptions',
    'task_calendar_links', 'calendar_outbox', 'calendar_reminder_replans'
  ] loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = v_table and c.relrowsecurity
    ) then raise exception 'CS-9 FAILED: RLS off on %', v_table; end if;
    if has_table_privilege('anon', format('public.%I', v_table), 'SELECT')
       or has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT')
       or not has_table_privilege('service_role', format('public.%I', v_table),
                                  'SELECT,INSERT,UPDATE,DELETE') then
      raise exception 'CS-9 FAILED: grants wrong on %', v_table;
    end if;
  end loop;
  foreach v_signature in array array[
    'public.api_mark_calendar_outbox_effect_started(uuid,text,bigint)',
    'public.api_retry_calendar_outbox(uuid,text,bigint,integer,text,text,boolean,boolean)',
    'public.api_commit_calendar_outbox_scrubbed(uuid,text,bigint,text,boolean)',
    'public.api_claim_calendar_webhook_revocations(text,integer,integer)',
    'public.api_commit_calendar_webhook_revocation(uuid,text,bigint)',
    'public.api_retry_calendar_webhook_revocation(uuid,text,bigint,integer,text,text)',
    'public.api_claim_calendar_credential_refresh(uuid,uuid,uuid,text,bigint,integer)',
    'public.api_commit_calendar_credential_refresh(uuid,text,bigint,text,text,text)',
    'public.api_retry_calendar_credential_refresh(uuid,text,bigint,boolean,text,text)',
    'public.api_revoke_calendar_connection(uuid,uuid,uuid)',
    'public.api_request_calendar_owner_disclosure(uuid,text)',
    'public.api_claim_calendar_owner_disclosures(text,integer,integer)',
    'public.api_queue_stale_calendar_owner_disclosures(timestamp with time zone,integer)',
    'public.api_commit_calendar_owner_disclosure(uuid,text,bigint)',
    'public.api_retry_calendar_owner_disclosure(uuid,text,bigint,integer,text,text)',
    'public.api_list_calendar_owner_disclosures(uuid,uuid)',
    'public.api_purge_calendar_oauth_states(integer)',
    'public.api_claim_calendar_reminder_replans(text,integer,integer)',
    'public.api_complete_calendar_reminder_replan(uuid,text,bigint)',
    'public.api_retry_calendar_reminder_replan(uuid,text,bigint,integer,text,text)'
  ] loop
    if has_function_privilege('anon', v_signature, 'EXECUTE')
       or has_function_privilege('authenticated', v_signature, 'EXECUTE')
       or not has_function_privilege('service_role', v_signature, 'EXECUTE') then
      raise exception 'CS-9 FAILED: calendar worker RPC grant %', v_signature;
    end if;
  end loop;
  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and p.proname like '%calendar%'
       and (
         has_function_privilege('anon', p.oid, 'EXECUTE')
         or has_function_privilege('authenticated', p.oid, 'EXECUTE')
       )
  ) then
    raise exception 'CS-9 FAILED: SECURITY DEFINER calendar helper retained end-user EXECUTE';
  end if;
  select p.prosrc into v_source from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'purge_workspace_step';
  foreach v_table in array array[
    'calendar_reminder_replans', 'calendar_outbox',
    'task_calendar_links', 'webhook_subscriptions',
    'oauth_states', 'calendar_connections'
  ] loop
    if v_source not like '%''' || v_table || '''%' then
      raise exception 'CS-9 FAILED: purge omits %', v_table;
    end if;
  end loop;
  raise notice 'CS-9 PASSED: RLS/grants and bounded purge roster cover calendar data';
end $$;

-- CS-10. Expiring provider watches are renewed under an exclusive/recoverable
-- lease, replacement identity is atomic, retry is durable, and only the
-- service role can operate the renewal queue.
do $$
declare
  v_claim public.webhook_subscriptions%rowtype;
  v_second public.webhook_subscriptions%rowtype;
  v_retry_claim public.webhook_subscriptions%rowtype;
  v jsonb;
begin
  select * into v_claim
    from public.api_claim_calendar_webhook_renewals('renew-a', 1, 120, 86400);
  if v_claim.provider_subscription_id is distinct from 'graph-sub-reauth' then
    raise exception 'CS-10 FAILED: expiring watch not claimed';
  end if;
  select * into v_second
    from public.api_claim_calendar_webhook_renewals('renew-b', 1, 120, 86400);
  if v_second.id is not null then
    raise exception 'CS-10 FAILED: overlapping renewal claim';
  end if;

  update public.webhook_subscriptions
     set renewal_lease_expires_at = now() - interval '1 second'
   where id = v_claim.id;
  select * into v_second
    from public.api_claim_calendar_webhook_renewals('renew-b', 1, 120, 86400);
  if v_second.id is distinct from v_claim.id then
    raise exception 'CS-10 FAILED: crashed renewal lease not recovered';
  end if;

  v := public.api_commit_calendar_webhook_renewal(
    v_second.id, 'renew-b', v_second.renewal_generation,
    'graph-sub-2', '/me/calendars/calendar-1/events', repeat('e', 64),
    now() + interval '3 days'
  );
  if v->>'outcome' is distinct from 'committed'
     or not exists (
       select 1 from public.webhook_subscriptions
        where id = v_second.id
          and provider_subscription_id = 'graph-sub-2'
          and client_state_hash = repeat('e', 64)
          and expires_at > now() + interval '2 days'
          and renewal_attempts = 0
          and renewal_lease_owner is null
     ) then
    raise exception 'CS-10 FAILED: renewal commit %', v;
  end if;

  update public.webhook_subscriptions
     set expires_at = now() + interval '1 hour', renewal_available_at = now()
   where id = v_second.id;
  select * into v_retry_claim
    from public.api_claim_calendar_webhook_renewals('renew-c', 1, 120, 86400);
  v := public.api_retry_calendar_webhook_renewal(
    v_retry_claim.id, 'renew-c', v_retry_claim.renewal_generation,
    60, 'provider_busy', 'Retry later', false
  );
  if v->>'outcome' is distinct from 'queued'
     or not exists (
       select 1 from public.webhook_subscriptions
        where id = v_retry_claim.id and status = 'active'
          and renewal_available_at > now()
          and renewal_lease_owner is null
          and last_error_code = 'provider_busy'
     ) then
    raise exception 'CS-10 FAILED: renewal retry %', v;
  end if;

  if has_function_privilege(
       'anon',
       'public.api_claim_calendar_webhook_renewals(text,integer,integer,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.api_commit_calendar_webhook_renewal(uuid,text,bigint,text,text,text,timestamp with time zone)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.api_retry_calendar_webhook_renewal(uuid,text,bigint,integer,text,text,boolean)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.api_claim_calendar_webhook_renewals(text,integer,integer,integer)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.api_commit_calendar_webhook_renewal(uuid,text,bigint,text,text,text,timestamp with time zone)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.api_retry_calendar_webhook_renewal(uuid,text,bigint,integer,text,text,boolean)',
       'EXECUTE'
     ) then
    raise exception 'CS-10 FAILED: webhook renewal RPC grants';
  end if;
  raise notice 'CS-10 PASSED: renewal lease, crash recovery, commit, retry and grants';
end $$;

-- CS-11. Attention is own-member scoped, human choices are atomic, and the
-- security-definer surface never inherits PostgreSQL's default PUBLIC grant.
do $$
declare
  v_pull public.calendar_connections%rowtype;
  v_task public.tasks%rowtype;
  v_link public.task_calendar_links%rowtype;
  v_replan public.calendar_reminder_replans%rowtype;
  v_replan_second public.calendar_reminder_replans%rowtype;
  v_ours jsonb;
  v_theirs jsonb;
  v_conflict_ours jsonb;
  v_due_before_transition timestamptz;
  v jsonb;
  v_signature text;
  v_moved_due timestamptz := now() + interval '8 days';
begin
  update public.calendar_connections set sync_due_at = now()
   where id = pg_temp.connection_id();
  select * into v_pull
    from public.api_claim_due_calendar_pulls('attention-worker', 1, 120);
  select * into v_task from public.tasks where id = pg_temp.task_id();
  select * into v_link from public.task_calendar_links where id = pg_temp.link_id();
  v_ours := public.calendar_task_snapshot(
    v_task.due_at, v_task.title, v_task.description,
    v_link.base_snapshot, 'America/Edmonton'
  );
  v_theirs := public.calendar_snapshot_from_fields(
    v_task.due_at + interval '1 day',
    v_task.due_at + interval '1 day 1 hour',
    'America/Edmonton', v_task.title, v_task.description
  );
  v := public.api_mark_calendar_conflict(
    pg_temp.company_id(), pg_temp.connection_id(), 'attention-worker',
    v_pull.pull_generation, pg_temp.task_id(), 'attention-version',
    v_ours, v_theirs
  );
  if v->>'outcome' is distinct from 'conflict' then
    raise exception 'CS-11 FAILED: conflict mark %', v;
  end if;
  v := public.api_mark_calendar_conflict(
    pg_temp.company_id(), pg_temp.connection_id(), 'attention-worker',
    v_pull.pull_generation, pg_temp.task_id(), 'attention-version-replay',
    v_ours, v_theirs
  );
  if v->>'outcome' is distinct from 'conflict' then
    raise exception 'CS-11 FAILED: conflict replay was not idempotent %', v;
  end if;
  if not exists (
    select 1 from public.calendar_connections
     where id = pg_temp.connection_id()
       and conflict_window_count = 1
       and cardinality(conflict_occurrences_at) = 1
       and conflict_window_started_at = last_conflict_at
  ) then
    raise exception 'CS-11 FAILED: conflict replay incremented operational counter';
  end if;
  v := public.api_for_you(
    pg_temp.company_id(), pg_temp.user_id(), now(), 20, null
  );
  if not exists (
    select 1 from jsonb_array_elements(v->'my_tasks') item
     where item->>'task_id' = pg_temp.task_id()::text
  ) then
    raise exception 'CS-11 FAILED: dated conflict disappeared from focus queue %', v;
  end if;
  v := public.api_get_calendar_attention(
    pg_temp.company_id(), pg_temp.user_id(), pg_temp.link_id()
  );
  if v->>'outcome' is distinct from 'found'
     or v->'attention'->>'provider_instance_id' is distinct from 'instance-2026-1'
     or v->'attention'->>'link_state' is distinct from 'conflict' then
    raise exception 'CS-11 FAILED: own attention detail %', v;
  end if;
  v := public.api_resolve_calendar_conflict(
    pg_temp.company_id(), pg_temp.user_id(), pg_temp.link_id(), 'not_sure'
  );
  if v->>'outcome' is distinct from 'still_flagged' then
    raise exception 'CS-11 FAILED: conflict not-sure %', v;
  end if;

  -- A later provider observation that exactly converges with ours resolves an
  -- old conflict without waiting for a human to dismiss stale attention.
  v := public.api_apply_calendar_provider_snapshot(
    pg_temp.company_id(), pg_temp.connection_id(), 'attention-worker',
    v_pull.pull_generation, pg_temp.task_id(),
    'event-occurrence-1', 'instance-2026-1', 'series-master-1',
    'attention-converged-version',
    (v_ours->>'start')::timestamptz, (v_ours->>'end')::timestamptz,
    v_ours->>'timeZone', v_task.title, v_task.description
  );
  if v->>'outcome' is distinct from 'converged'
     or not exists (
       select 1 from public.task_calendar_links
        where id = pg_temp.link_id() and link_state = 'active'
          and conflict_detected_at is null
     ) then
    raise exception 'CS-11 FAILED: converged provider state did not recover conflict %', v;
  end if;

  -- A refusal may clear the local date because the old provider shape was not
  -- actionable.  A later valid timed occurrence restores the mapping/task.
  v := public.api_mark_calendar_refusal(
    pg_temp.company_id(), pg_temp.connection_id(), 'attention-worker',
    v_pull.pull_generation, pg_temp.task_id(), 'instance-2026-1',
    'refusal-invalid-title-v1',
    'invalid_title', 'Provider title was temporarily not actionable', false
  );
  if v->>'outcome' is distinct from 'refused'
     or (select due_at from public.tasks where id = pg_temp.task_id()) is null then
    raise exception 'CS-11 FAILED: invalid-title refusal cleared a valid due %', v;
  end if;
  v := public.api_mark_calendar_refusal(
    pg_temp.company_id(), pg_temp.connection_id(), 'attention-worker',
    v_pull.pull_generation, pg_temp.task_id(), 'instance-2026-1',
    'refusal-invalid-title-v1-replay',
    'invalid_title', 'Provider title was temporarily not actionable', false
  );
  if v->>'outcome' is distinct from 'refused' then
    raise exception 'CS-11 FAILED: refusal replay was not idempotent %', v;
  end if;
  v := public.api_mark_calendar_refusal(
    pg_temp.company_id(), pg_temp.connection_id(), 'attention-worker',
    v_pull.pull_generation, pg_temp.task_id(), 'instance-2026-1',
    'refusal-all-day-v1',
    'all_day', 'Provider occurrence became all-day', true
  );
  if v->>'outcome' is distinct from 'refused'
     or (select due_at from public.tasks where id = pg_temp.task_id()) is not null then
    raise exception 'CS-11 FAILED: refusal subtype transition retained unsafe due %', v;
  end if;
  v := public.api_for_you(
    pg_temp.company_id(), pg_temp.user_id(), now(), 20, null
  );
  if exists (
    select 1 from jsonb_array_elements(v->'my_tasks') item
     where item->>'task_id' = pg_temp.task_id()::text
  ) then
    raise exception 'CS-11 FAILED: refused task leaked into focus queue %', v;
  end if;
  v := public.api_apply_calendar_provider_snapshot(
    pg_temp.company_id(), pg_temp.connection_id(), 'attention-worker',
    v_pull.pull_generation, pg_temp.task_id(),
    'event-occurrence-1', 'instance-2026-1', 'series-master-1',
    'refusal-recovered-version',
    (v_ours->>'start')::timestamptz, (v_ours->>'end')::timestamptz,
    v_ours->>'timeZone', v_task.title, v_task.description
  );
  if v->>'outcome' is distinct from 'provider_applied'
     or v->>'recovered_from' is distinct from 'refused'
     or not exists (
       select 1 from public.task_calendar_links l
       join public.tasks t on t.id = l.task_id
        where l.id = pg_temp.link_id() and l.link_state = 'active'
          and l.refused_at is null
          and t.due_at = (v_ours->>'start')::timestamptz
     ) then
    raise exception 'CS-11 FAILED: valid provider state did not recover refusal %', v;
  end if;

  -- Invalid title preserves a trustworthy instant.  The other phase-one
  -- refusal shapes cannot identify an honest instant and therefore clear it;
  -- each corrected timed observation can subsequently recover the link.
  v := public.api_mark_calendar_refusal(
    pg_temp.company_id(), pg_temp.connection_id(), 'attention-worker',
    v_pull.pull_generation, pg_temp.task_id(), 'instance-2026-1',
    'refusal-unknown-zone-v1',
    'unknown_time_zone', 'Provider zone could not be interpreted', true
  );
  if v->>'outcome' is distinct from 'refused'
     or (select due_at from public.tasks where id = pg_temp.task_id()) is not null then
    raise exception 'CS-11 FAILED: unknown-zone refusal retained unsafe due %', v;
  end if;
  v := public.api_apply_calendar_provider_snapshot(
    pg_temp.company_id(), pg_temp.connection_id(), 'attention-worker',
    v_pull.pull_generation, pg_temp.task_id(),
    'event-occurrence-1', 'instance-2026-1', 'series-master-1',
    'unknown-zone-recovered-version',
    (v_ours->>'start')::timestamptz, (v_ours->>'end')::timestamptz,
    v_ours->>'timeZone', v_task.title, v_task.description
  );
  if v->>'outcome' is distinct from 'provider_applied' then
    raise exception 'CS-11 FAILED: corrected unknown-zone event did not recover %', v;
  end if;
  v := public.api_mark_calendar_refusal(
    pg_temp.company_id(), pg_temp.connection_id(), 'attention-worker',
    v_pull.pull_generation, pg_temp.task_id(), 'instance-2026-1',
    'refusal-invalid-time-v1',
    'invalid_time', 'Provider time could not be interpreted', true
  );
  if v->>'outcome' is distinct from 'refused'
     or (select due_at from public.tasks where id = pg_temp.task_id()) is not null then
    raise exception 'CS-11 FAILED: invalid-time refusal retained unsafe due %', v;
  end if;
  v := public.api_apply_calendar_provider_snapshot(
    pg_temp.company_id(), pg_temp.connection_id(), 'attention-worker',
    v_pull.pull_generation, pg_temp.task_id(),
    'event-occurrence-1', 'instance-2026-1', 'series-master-1',
    'invalid-time-recovered-version',
    (v_ours->>'start')::timestamptz, (v_ours->>'end')::timestamptz,
    v_ours->>'timeZone', v_task.title, v_task.description
  );
  if v->>'outcome' is distinct from 'provider_applied' then
    raise exception 'CS-11 FAILED: corrected invalid-time event did not recover %', v;
  end if;

  select * into v_task from public.tasks where id = pg_temp.task_id();
  select * into v_link from public.task_calendar_links where id = pg_temp.link_id();
  v_ours := public.calendar_task_snapshot(
    v_task.due_at, v_task.title, v_task.description,
    v_link.base_snapshot, 'America/Edmonton'
  );
  v_theirs := public.calendar_snapshot_from_fields(
    v_task.due_at + interval '1 day',
    v_task.due_at + interval '1 day 1 hour',
    'America/Edmonton', v_task.title, v_task.description
  );
  v := public.api_mark_calendar_conflict(
    pg_temp.company_id(), pg_temp.connection_id(), 'attention-worker',
    v_pull.pull_generation, pg_temp.task_id(), 'attention-version-2',
    v_ours, v_theirs
  );
  if v->>'outcome' is distinct from 'conflict' then
    raise exception 'CS-11 FAILED: second conflict mark %', v;
  end if;
  if (select conflict_window_count from public.calendar_connections
       where id = pg_temp.connection_id()) is distinct from 2 then
    raise exception 'CS-11 FAILED: second true transition did not increment counter';
  end if;

  -- The calendar choice is based on the app snapshot rendered in the card.
  -- A local human move after render must make that choice stale, not lose it.
  update public.tasks set due_at = due_at + interval '2 hours'
   where id = pg_temp.task_id();
  v := public.api_resolve_calendar_conflict(
    pg_temp.company_id(), pg_temp.user_id(), pg_temp.link_id(), 'use_calendar',
    'instance-2026-1', 'attention-use-calendar-stale',
    (v_theirs->>'start')::timestamptz, (v_theirs->>'end')::timestamptz,
    v_theirs->>'timeZone', v_task.title, v_task.description, v_ours
  );
  if v->>'outcome' is distinct from 'attention_stale'
     or not exists (
       select 1 from public.task_calendar_links l
       join public.tasks t on t.id = l.task_id
        where l.id = pg_temp.link_id() and l.link_state = 'conflict'
          and t.due_at = (v_ours->>'start')::timestamptz + interval '2 hours'
     ) then
    raise exception 'CS-11 FAILED: stale calendar choice overwrote local move %', v;
  end if;
  select * into v_task from public.tasks where id = pg_temp.task_id();
  v := public.api_get_calendar_attention(
    pg_temp.company_id(), pg_temp.user_id(), pg_temp.link_id()
  );
  v_ours := v->'attention'->'ours_snapshot';
  if v->>'outcome' is distinct from 'found'
     or (v_ours->>'start')::timestamptz is distinct from v_task.due_at then
    raise exception 'CS-11 FAILED: attention reload kept frozen app snapshot %', v;
  end if;
  select conflict_ours_snapshot into v_conflict_ours
    from public.task_calendar_links where id = pg_temp.link_id();
  v_due_before_transition := v_task.due_at;
  v := public.api_mark_calendar_event_removed(
    pg_temp.company_id(), pg_temp.connection_id(), 'attention-worker',
    v_pull.pull_generation, pg_temp.task_id(), 'instance-2026-1',
    'removed-from-conflict'
  );
  if v->>'outcome' is distinct from 'event_removed'
     or v->>'attention_state' is distinct from 'conflict'
     or not exists (
       select 1 from public.task_calendar_links l
       join public.tasks t on t.id = l.task_id
        where l.id = pg_temp.link_id() and l.link_state = 'conflict'
          and l.event_removed_at is not null
          and l.conflict_ours_snapshot = v_conflict_ours
          and t.due_at = v_due_before_transition
     ) then
    raise exception 'CS-11 FAILED: conflict-to-removed erased app evidence %', v;
  end if;
  v := public.api_mark_calendar_refusal(
    pg_temp.company_id(), pg_temp.connection_id(), 'attention-worker',
    v_pull.pull_generation, pg_temp.task_id(), 'instance-2026-1',
    'conflict-refusal-observed-v1',
    'unknown_time_zone', 'Conflicted event later lost its provider zone', true
  );
  if v->>'outcome' is distinct from 'refused'
     or v->>'attention_state' is distinct from 'conflict'
     or not exists (
       select 1 from public.task_calendar_links l
       join public.tasks t on t.id = l.task_id
        where l.id = pg_temp.link_id() and l.link_state = 'conflict'
          and l.refusal_code = 'unknown_time_zone'
          and l.event_removed_at is null
          and l.conflict_ours_snapshot = v_conflict_ours
          and t.due_at = v_due_before_transition
     ) then
    raise exception 'CS-11 FAILED: conflict-to-refusal erased app evidence %', v;
  end if;
  v := public.api_apply_calendar_provider_snapshot(
    pg_temp.company_id(), pg_temp.connection_id(), 'attention-worker',
    v_pull.pull_generation, pg_temp.task_id(),
    'event-occurrence-1', 'instance-2026-1', 'series-master-1',
    'transition-recovered',
    (v_ours->>'start')::timestamptz, (v_ours->>'end')::timestamptz,
    v_ours->>'timeZone', v_task.title, v_task.description
  );
  if v->>'outcome' is distinct from 'converged'
     or not exists (
       select 1 from public.task_calendar_links
        where id = pg_temp.link_id() and link_state = 'active'
          and event_removed_at is null and refusal_code is null
     ) then
    raise exception 'CS-11 FAILED: transition recovery %', v;
  end if;
  select * into v_task from public.tasks where id = pg_temp.task_id();
  select * into v_link from public.task_calendar_links where id = pg_temp.link_id();
  v_ours := public.calendar_task_snapshot(
    v_task.due_at, v_task.title, v_task.description,
    v_link.base_snapshot, 'America/Edmonton'
  );
  v_theirs := public.calendar_snapshot_from_fields(
    v_task.due_at + interval '1 day',
    v_task.due_at + interval '1 day 1 hour',
    'America/Edmonton', v_task.title, v_task.description
  );
  v := public.api_mark_calendar_conflict(
    pg_temp.company_id(), pg_temp.connection_id(), 'attention-worker',
    v_pull.pull_generation, pg_temp.task_id(), 'after-transition-conflict',
    v_ours, v_theirs
  );
  if v->>'outcome' is distinct from 'conflict' then
    raise exception 'CS-11 FAILED: recovered transition could not conflict %', v;
  end if;
  v := public.api_resolve_calendar_conflict(
    pg_temp.company_id(), pg_temp.user_id(), pg_temp.link_id(), 'use_calendar',
    'instance-2026-1', 'attention-use-calendar',
    (v_theirs->>'start')::timestamptz, (v_theirs->>'end')::timestamptz,
    v_theirs->>'timeZone', v_task.title, v_task.description, v_ours
  );
  if v->>'outcome' is distinct from 'resolved'
     or not exists (
       select 1 from public.calendar_reminder_replans
        where company_id = pg_temp.company_id() and task_id = pg_temp.task_id()
          and state = 'queued'
     ) then
    raise exception 'CS-11 FAILED: use-calendar did not durably enqueue reminder replan %', v;
  end if;
  select * into v_replan
    from public.api_claim_calendar_reminder_replans('replan-a', 1, 120);
  select * into v_replan_second
    from public.api_claim_calendar_reminder_replans('replan-b', 1, 120);
  if v_replan.id is null or v_replan_second.id is not null then
    raise exception 'CS-11 FAILED: reminder replan claims overlapped';
  end if;
  v := public.api_retry_calendar_reminder_replan(
    v_replan.id, 'replan-a', v_replan.generation,
    1, 'temporary', 'Retry reminder planning'
  );
  if v->>'outcome' is distinct from 'queued' then
    raise exception 'CS-11 FAILED: reminder replan retry %', v;
  end if;
  update public.calendar_reminder_replans set available_at = now()
   where id = v_replan.id;
  select * into v_replan_second
    from public.api_claim_calendar_reminder_replans('replan-b', 1, 120);
  v := public.api_complete_calendar_reminder_replan(
    v_replan_second.id, 'replan-b', v_replan_second.generation
  );
  if v->>'outcome' is distinct from 'completed' then
    raise exception 'CS-11 FAILED: reminder replan completion %', v;
  end if;

  select * into v_task from public.tasks where id = pg_temp.task_id();
  select * into v_link from public.task_calendar_links where id = pg_temp.link_id();
  v_ours := public.calendar_task_snapshot(
    v_task.due_at, v_task.title, v_task.description,
    v_link.base_snapshot, 'America/Edmonton'
  );
  v_theirs := public.calendar_snapshot_from_fields(
    v_task.due_at + interval '1 day',
    v_task.due_at + interval '1 day 1 hour',
    'America/Edmonton', v_task.title, v_task.description
  );
  -- Exact rolling evidence must not reset merely because the oldest retained
  -- event crossed an arbitrary seven-day boundary: the recent event remains.
  update public.calendar_connections
     set conflict_occurrences_at = array[
           now() - interval '7 days 1 second', now() - interval '1 day'
         ]::timestamptz[],
         conflict_window_started_at = now() - interval '7 days 1 second',
         conflict_window_count = 2,
         last_conflict_at = now() - interval '1 day'
   where id = pg_temp.connection_id();
  v := public.api_mark_calendar_conflict(
    pg_temp.company_id(), pg_temp.connection_id(), 'attention-worker',
    v_pull.pull_generation, pg_temp.task_id(), 'attention-version-3',
    v_ours, v_theirs
  );
  if v->>'outcome' is distinct from 'conflict' then
    raise exception 'CS-11 FAILED: third conflict mark %', v;
  end if;
  if not exists (
    select 1 from public.calendar_connections
     where id = pg_temp.connection_id()
       and conflict_window_count = 2
       and cardinality(conflict_occurrences_at) = 2
       and conflict_window_started_at > now() - interval '7 days'
       and last_conflict_at > now() - interval '1 minute'
  ) then
    raise exception 'CS-11 FAILED: rolling conflict window reset at old boundary';
  end if;

  update public.tasks set due_at = now() + interval '366 days'
   where id = pg_temp.task_id();
  select * into v_task from public.tasks where id = pg_temp.task_id();
  v_ours := public.calendar_task_snapshot(
    v_task.due_at, v_task.title, v_task.description,
    v_link.base_snapshot, 'America/Edmonton'
  );
  v := public.api_resolve_calendar_conflict(
    pg_temp.company_id(), pg_temp.user_id(), pg_temp.link_id(), 'use_app',
    null, null, null, null, null, null, null, v_ours
  );
  if v->>'outcome' is distinct from 'outside_sync_window'
     or not exists (
       select 1 from public.task_calendar_links
        where id = pg_temp.link_id() and link_state = 'conflict'
     ) then
    raise exception 'CS-11 FAILED: use-app escaped rolling sync window %', v;
  end if;
  update public.tasks set due_at = now() + interval '6 days'
   where id = pg_temp.task_id();
  select * into v_task from public.tasks where id = pg_temp.task_id();
  v := public.api_get_calendar_attention(
    pg_temp.company_id(), pg_temp.user_id(), pg_temp.link_id()
  );
  v_ours := v->'attention'->'ours_snapshot';
  if v->>'outcome' is distinct from 'found'
     or (v_ours->>'start')::timestamptz is distinct from v_task.due_at then
    raise exception 'CS-11 FAILED: refreshed use-app token was stale %', v;
  end if;
  v := public.api_resolve_calendar_conflict(
    pg_temp.company_id(), pg_temp.user_id(), pg_temp.link_id(), 'use_app',
    null, null, null, null, null, null, null, v_ours
  );
  if v->>'outcome' is distinct from 'queued'
     or not exists (
       select 1 from public.calendar_outbox
        where connection_id = pg_temp.connection_id()
          and task_id = pg_temp.task_id() and action = 'upsert'
          and state = 'queued'
     ) then
    raise exception 'CS-11 FAILED: use-app resolution %', v;
  end if;

  select * into v_task from public.tasks where id = pg_temp.task_id();
  select * into v_link from public.task_calendar_links where id = pg_temp.link_id();
  v := public.api_mark_calendar_event_removed(
    pg_temp.company_id(), pg_temp.connection_id(), 'attention-worker',
    v_pull.pull_generation, pg_temp.task_id(), 'instance-2026-1',
    'removed-version'
  );
  if v->>'outcome' is distinct from 'event_removed' then
    raise exception 'CS-11 FAILED: removed mark %', v;
  end if;
  v := public.api_mark_calendar_event_removed(
    pg_temp.company_id(), pg_temp.connection_id(), 'attention-worker',
    v_pull.pull_generation, pg_temp.task_id(), 'instance-2026-1',
    'removed-version-replay'
  );
  if v->>'outcome' is distinct from 'event_removed' then
    raise exception 'CS-11 FAILED: removed replay was not idempotent %', v;
  end if;
  v := public.api_for_you(
    pg_temp.company_id(), pg_temp.user_id(), now(), 20, null
  );
  if exists (
    select 1 from jsonb_array_elements(v->'my_tasks') item
     where item->>'task_id' = pg_temp.task_id()::text
  ) then
    raise exception 'CS-11 FAILED: removed event leaked into focus queue %', v;
  end if;
  v := public.api_apply_calendar_provider_snapshot(
    pg_temp.company_id(), pg_temp.connection_id(), 'attention-worker',
    v_pull.pull_generation, pg_temp.task_id(),
    'event-occurrence-1', 'instance-2026-1', 'series-master-1',
    'removed-recovered-version',
    (v_link.base_snapshot->>'start')::timestamptz,
    (v_link.base_snapshot->>'end')::timestamptz,
    v_link.base_snapshot->>'timeZone', v_task.title, v_task.description
  );
  if v->>'outcome' is distinct from 'provider_applied'
     or v->>'recovered_from' is distinct from 'event_removed'
     or not exists (
       select 1 from public.task_calendar_links l
       join public.tasks t on t.id = l.task_id
        where l.id = pg_temp.link_id() and l.link_state = 'active'
          and l.event_removed_at is null
          and t.due_at = (v_link.base_snapshot->>'start')::timestamptz
     ) then
    raise exception 'CS-11 FAILED: reappeared provider event did not recover removal %', v;
  end if;
  v := public.api_mark_calendar_event_removed(
    pg_temp.company_id(), pg_temp.connection_id(), 'attention-worker',
    v_pull.pull_generation, pg_temp.task_id(), 'instance-2026-1',
    'removed-version-2'
  );
  if v->>'outcome' is distinct from 'event_removed' then
    raise exception 'CS-11 FAILED: second removed mark %', v;
  end if;
  v := public.api_resolve_calendar_event_removed(
    pg_temp.company_id(), pg_temp.user_id(), pg_temp.link_id(), 'not_sure'
  );
  if v->>'outcome' is distinct from 'still_flagged' then
    raise exception 'CS-11 FAILED: removed not-sure %', v;
  end if;
  v := public.api_mark_calendar_refusal(
    pg_temp.company_id(), pg_temp.connection_id(), 'attention-worker',
    v_pull.pull_generation, pg_temp.task_id(), 'instance-2026-1',
    'removed-refusal-observed-v1',
    'invalid_title', 'Removed occurrence replayed as invalid', false
  );
  if v->>'outcome' is distinct from 'refused'
     or not exists (
       select 1 from public.task_calendar_links
        where id = pg_temp.link_id() and link_state = 'refused'
          and event_removed_at is null and refused_at is not null
     ) then
    raise exception 'CS-11 FAILED: removed-to-refused transition poisoned pull %', v;
  end if;
  v := public.api_mark_calendar_event_removed(
    pg_temp.company_id(), pg_temp.connection_id(), 'attention-worker',
    v_pull.pull_generation, pg_temp.task_id(), 'instance-2026-1',
    'removed-after-refusal'
  );
  if v->>'outcome' is distinct from 'event_removed'
     or not exists (
       select 1 from public.task_calendar_links
        where id = pg_temp.link_id() and link_state = 'event_removed'
          and refused_at is null and event_removed_at is not null
     ) then
    raise exception 'CS-11 FAILED: refused-to-removed transition poisoned pull %', v;
  end if;
  v := public.api_resolve_calendar_event_removed(
    pg_temp.company_id(), pg_temp.user_id(), pg_temp.link_id(),
    'moved', now() + interval '366 days'
  );
  if v->>'outcome' is distinct from 'outside_sync_window'
     or not exists (
       select 1 from public.task_calendar_links
        where id = pg_temp.link_id() and link_state = 'event_removed'
     ) then
    raise exception 'CS-11 FAILED: removed-event move escaped sync window %', v;
  end if;
  v := public.api_resolve_calendar_event_removed(
    pg_temp.company_id(), pg_temp.user_id(), pg_temp.link_id(),
    'moved', v_moved_due
  );
  if v->>'outcome' is distinct from 'moved'
     or not exists (
       select 1 from public.calendar_outbox
        where connection_id = pg_temp.connection_id()
          and task_id = pg_temp.task_id() and link_id = pg_temp.link_id()
          and action = 'create' and state = 'queued'
     ) then
    raise exception 'CS-11 FAILED: removed moved resolution %', v;
  end if;
  if not exists (
    select 1 from public.calendar_reminder_replans
     where company_id = pg_temp.company_id() and task_id = pg_temp.task_id()
       and state = 'queued'
  ) then
    raise exception 'CS-11 FAILED: moved decision did not enqueue reminder replan';
  end if;
  perform public.api_sync_task_reminders(
    pg_temp.company_id(), pg_temp.task_id(), pg_temp.user_id(),
    jsonb_build_array(jsonb_build_object(
      'offset_minutes', 30, 'body', 'Reminder staged before cancellation.',
      'send_at', (now() + interval '7 days')::text
    )),
    'America/Edmonton', 'contact', now() + interval '20 days'
  );
  v := public.api_resolve_calendar_event_removed(
    pg_temp.company_id(), pg_temp.user_id(), pg_temp.link_id(), 'cancelled'
  );
  if v->>'outcome' is distinct from 'cancelled'
     or not exists (
       select 1 from public.messages m
        join public.tasks t on t.message_id = m.id
        where t.id = pg_temp.task_id() and m.done_at is not null
     )
     or not exists (
       select 1 from public.task_calendar_links
        where id = pg_temp.link_id() and link_state = 'unlinked'
     )
     or exists (
       select 1 from public.scheduled_messages
        where company_id = pg_temp.company_id() and task_id = pg_temp.task_id()
          and origin = 'reminder' and status = 'pending'
     )
     or exists (
       select 1 from public.calendar_reminder_replans
        where company_id = pg_temp.company_id() and task_id = pg_temp.task_id()
          and state in ('queued', 'leased')
     ) then
    raise exception 'CS-11 FAILED: cancelled decision did not suppress reminder re-add %', v;
  end if;

  foreach v_signature in array array[
    'public.api_list_calendar_attention(uuid,uuid,integer)',
    'public.api_get_calendar_attention(uuid,uuid,uuid)',
    'public.api_resolve_calendar_conflict(uuid,uuid,uuid,text,text,text,timestamp with time zone,timestamp with time zone,text,text,text,jsonb)',
    'public.api_resolve_calendar_event_removed(uuid,uuid,uuid,text,timestamp with time zone)'
  ] loop
    if has_function_privilege('anon', v_signature, 'EXECUTE')
       or has_function_privilege('authenticated', v_signature, 'EXECUTE')
       or not has_function_privilege('service_role', v_signature, 'EXECUTE') then
      raise exception 'CS-11 FAILED: attention RPC grant %', v_signature;
    end if;
  end loop;
  v := public.api_commit_calendar_pull(
    v_pull.id, 'attention-worker', v_pull.pull_generation, 'cursor-attention'
  );
  if v->>'outcome' is distinct from 'committed' then
    raise exception 'CS-11 FAILED: attention pull commit %', v;
  end if;
  raise notice 'CS-11 PASSED: attention recovers on valid provider state and remains own-scoped';
end $$;

-- CS-12. Tasks becoming eligible after connection enqueue their first create;
-- stale unlink commits and inbound reconciliation cannot erase newer intent.
do $$
declare
  v_create public.calendar_outbox%rowtype;
  v_unlink public.calendar_outbox%rowtype;
  v_followup public.calendar_outbox%rowtype;
  v_task public.tasks%rowtype;
  v_link public.task_calendar_links%rowtype;
  v_pull public.calendar_connections%rowtype;
  v jsonb;
  v_original_create_snapshot jsonb;
  v_redated timestamptz := now() + interval '9 days';
  v_generation bigint;
begin
  -- Recreate the occurrence intentionally cancelled in CS-11 so the stale
  -- unlink and inbound-eligibility races exercise a real mapped instance.
  perform public.set_message_done(
    pg_temp.company_id(), 'ca000000-0000-4000-8000-00000000a001',
    false, pg_temp.user_id()
  );
  update public.tasks
     set deleted_at = null, assigned_user_id = pg_temp.user_id(),
         due_at = v_redated
   where id = pg_temp.task_id();
  select * into v_create
    from public.api_claim_calendar_outbox('recreate-worker', 1, 120);
  if v_create.action is distinct from 'create'
     or v_create.link_id is distinct from pg_temp.link_id() then
    raise exception 'CS-12 FAILED: unlinked mapping was not reused for recreate';
  end if;
  select * into v_task from public.tasks where id = pg_temp.task_id();
  v := public.api_commit_calendar_outbox_created(
    v_create.id, 'recreate-worker', v_create.generation,
    'event-occurrence-2', 'instance-2026-2', 'series-master-2', 'version-5',
    (v_create.requested_snapshot->>'start')::timestamptz,
    (v_create.requested_snapshot->>'end')::timestamptz,
    v_create.requested_snapshot->>'timeZone', v_task.title, v_task.description
  );
  if v->>'outcome' is distinct from 'committed' then
    raise exception 'CS-12 FAILED: recreate commit %', v;
  end if;

  -- The worker claims an unlink, but the task is re-dated before its provider
  -- response returns.  The stale result is recorded, then current truth is
  -- queued as a fresh upsert instead of leaving the link stranded unlinked.
  update public.tasks set due_at = null where id = pg_temp.task_id();
  select * into v_unlink
    from public.api_claim_calendar_outbox('stale-unlink-worker', 1, 120);
  if v_unlink.action is distinct from 'unlink' then
    raise exception 'CS-12 FAILED: unlink was not claimed';
  end if;
  update public.tasks
     set due_at = v_redated + interval '1 hour'
   where id = pg_temp.task_id();
  v := public.api_commit_calendar_outbox_sent(
    v_unlink.id, 'stale-unlink-worker', v_unlink.generation,
    'version-unlinked', null, null, null, null, null
  );
  if v->>'outcome' is distinct from 'followup_queued'
     or not exists (
       select 1 from public.calendar_outbox
        where connection_id = pg_temp.connection_id()
          and task_id = pg_temp.task_id() and action = 'upsert'
          and state = 'queued' and attempts = 0
     )
     or not exists (
       select 1 from public.task_calendar_links
        where id = pg_temp.link_id() and link_state = 'unlinked'
     ) then
    raise exception 'CS-12 FAILED: stale unlink consumed newer eligible intent %', v;
  end if;
  select * into v_followup
    from public.api_claim_calendar_outbox('reactivate-worker', 1, 120);
  select * into v_task from public.tasks where id = pg_temp.task_id();
  v := public.api_commit_calendar_outbox_sent(
    v_followup.id, 'reactivate-worker', v_followup.generation,
    'version-6',
    (v_followup.requested_snapshot->>'start')::timestamptz,
    (v_followup.requested_snapshot->>'end')::timestamptz,
    v_followup.requested_snapshot->>'timeZone', v_task.title, v_task.description
  );
  if v->>'outcome' is distinct from 'committed'
     or not exists (
       select 1 from public.task_calendar_links
        where id = pg_temp.link_id() and link_state = 'active'
     ) then
    raise exception 'CS-12 FAILED: follow-up upsert did not reactivate link %', v;
  end if;

  update public.calendar_connections set sync_due_at = now()
   where id = pg_temp.connection_id();
  select * into v_pull
    from public.api_claim_due_calendar_pulls('eligibility-worker', 1, 120);
  select * into v_task from public.tasks where id = pg_temp.task_id();
  select * into v_link from public.task_calendar_links where id = pg_temp.link_id();

  update public.tasks set deleted_at = now() where id = pg_temp.task_id();
  v := public.api_apply_calendar_provider_snapshot(
    pg_temp.company_id(), pg_temp.connection_id(), 'eligibility-worker',
    v_pull.pull_generation, pg_temp.task_id(),
    'event-occurrence-2', 'instance-2026-2', 'series-master-2',
    'provider-after-delete',
    (v_link.base_snapshot->>'start')::timestamptz,
    (v_link.base_snapshot->>'end')::timestamptz,
    v_link.base_snapshot->>'timeZone', v_task.title, v_task.description
  );
  if v->>'outcome' is distinct from 'unlink_queued'
     or not exists (
       select 1 from public.calendar_outbox
        where connection_id = pg_temp.connection_id()
          and task_id = pg_temp.task_id() and action = 'unlink'
          and state in ('queued', 'leased')
     ) then
    raise exception 'CS-12 FAILED: inbound snapshot cancelled delete unlink %', v;
  end if;

  update public.tasks set deleted_at = null where id = pg_temp.task_id();
  update public.tasks set assigned_user_id = null where id = pg_temp.task_id();
  v := public.api_apply_calendar_provider_snapshot(
    pg_temp.company_id(), pg_temp.connection_id(), 'eligibility-worker',
    v_pull.pull_generation, pg_temp.task_id(),
    'event-occurrence-2', 'instance-2026-2', 'series-master-2',
    'provider-after-reassign',
    (v_link.base_snapshot->>'start')::timestamptz,
    (v_link.base_snapshot->>'end')::timestamptz,
    v_link.base_snapshot->>'timeZone', v_task.title, v_task.description
  );
  if v->>'outcome' is distinct from 'unlink_queued'
     or not exists (
       select 1 from public.calendar_outbox
        where connection_id = pg_temp.connection_id()
          and task_id = pg_temp.task_id() and action = 'unlink'
          and state in ('queued', 'leased')
     ) then
    raise exception 'CS-12 FAILED: inbound snapshot cancelled reassignment unlink %', v;
  end if;
  update public.tasks set assigned_user_id = pg_temp.user_id()
   where id = pg_temp.task_id();
  if not exists (
    select 1 from public.calendar_outbox
     where connection_id = pg_temp.connection_id()
       and task_id = pg_temp.task_id() and action = 'upsert'
       and state in ('queued', 'leased') and attempts = 0
  ) then
    raise exception 'CS-12 FAILED: reassignment back did not restore mapped upsert';
  end if;
  v := public.api_commit_calendar_pull(
    v_pull.id, 'eligibility-worker', v_pull.pull_generation,
    'cursor-eligibility'
  );
  if v->>'outcome' is distinct from 'committed' then
    raise exception 'CS-12 FAILED: eligibility pull commit %', v;
  end if;

  insert into public.messages
    (id, company_id, conversation_id, direction, body, status, segments)
  values
    ('ca000000-0000-4000-8000-00000000a003', pg_temp.company_id(),
     'ca000000-0000-4000-8000-0000000000e1', 'inbound',
     'New assigned task after calendar connection.', 'received', 1),
    ('ca000000-0000-4000-8000-00000000a004', pg_temp.company_id(),
     'ca000000-0000-4000-8000-0000000000e1', 'inbound',
     'Task reassigned after calendar connection.', 'received', 1);
  insert into public.tasks
    (id, company_id, message_id, conversation_id, title, description,
     assigned_user_id, due_at, created_by_user_id)
  values
    ('ca000000-0000-4000-8000-00000000b003', pg_temp.company_id(),
     'ca000000-0000-4000-8000-00000000a003',
     'ca000000-0000-4000-8000-0000000000e1', 'Inserted eligible task', '',
     pg_temp.user_id(), now() + interval '10 days', pg_temp.user_id()),
    ('ca000000-0000-4000-8000-00000000b004', pg_temp.company_id(),
     'ca000000-0000-4000-8000-00000000a004',
     'ca000000-0000-4000-8000-0000000000e1', 'Reassigned eligible task', '',
     null, now() + interval '11 days', pg_temp.user_id());
  if (select count(*) from public.calendar_outbox
       where connection_id = pg_temp.connection_id()
         and task_id = 'ca000000-0000-4000-8000-00000000b003'
         and action = 'create' and state = 'queued') is distinct from 1
     or exists (
       select 1 from public.calendar_outbox
        where connection_id = pg_temp.connection_id()
          and task_id = 'ca000000-0000-4000-8000-00000000b004'
          and state in ('queued', 'leased')
     ) then
    raise exception 'CS-12 FAILED: INSERT eligibility did not seed exactly one create';
  end if;
  update public.tasks set assigned_user_id = pg_temp.user_id()
   where id = 'ca000000-0000-4000-8000-00000000b004';
  if (select count(*) from public.calendar_outbox
       where connection_id = pg_temp.connection_id()
         and task_id = 'ca000000-0000-4000-8000-00000000b004'
         and action = 'create' and state = 'queued') is distinct from 1 then
    raise exception 'CS-12 FAILED: reassignment to connected member did not seed create';
  end if;
  select generation into v_generation from public.calendar_outbox
   where connection_id = pg_temp.connection_id()
     and task_id = 'ca000000-0000-4000-8000-00000000b003'
     and state = 'queued';
  update public.tasks set title = 'Inserted eligible task updated'
   where id = 'ca000000-0000-4000-8000-00000000b003';
  if (select count(*) from public.calendar_outbox
       where connection_id = pg_temp.connection_id()
         and task_id = 'ca000000-0000-4000-8000-00000000b003'
         and state in ('queued', 'leased')) is distinct from 1
     or (select generation from public.calendar_outbox
          where connection_id = pg_temp.connection_id()
            and task_id = 'ca000000-0000-4000-8000-00000000b003'
            and state = 'queued') <= v_generation then
    raise exception 'CS-12 FAILED: inserted task edit duplicated instead of refreshing create';
  end if;

  -- Once a create crosses the provider-write boundary, its original body is
  -- also its idempotent recovery key.  A later task change must neither
  -- cancel that queued ambiguity nor rewrite the body the worker must recover.
  update public.calendar_outbox
     set available_at = case
       when task_id = 'ca000000-0000-4000-8000-00000000b003' then now()
       else now() + interval '1 day'
     end
   where connection_id = pg_temp.connection_id() and state = 'queued';
  select * into v_create
    from public.api_claim_calendar_outbox('ambiguous-create-worker', 1, 120);
  if v_create.task_id is distinct from 'ca000000-0000-4000-8000-00000000b003'
     or v_create.action is distinct from 'create' then
    raise exception 'CS-12 FAILED: ambiguous create fixture was not claimed';
  end if;
  v_original_create_snapshot := v_create.requested_snapshot;
  v := public.api_mark_calendar_outbox_effect_started(
    v_create.id, 'ambiguous-create-worker', v_create.generation
  );
  if v->>'outcome' is distinct from 'marked' then
    raise exception 'CS-12 FAILED: ambiguous create boundary %', v;
  end if;
  v := public.api_retry_calendar_outbox(
    v_create.id, 'ambiguous-create-worker', v_create.generation,
    1, 'provider_timeout', 'Create result is ambiguous', false, false
  );
  if v->>'outcome' is distinct from 'queued' then
    raise exception 'CS-12 FAILED: ambiguous create was not queued %', v;
  end if;
  update public.tasks
     set title = 'Changed after ambiguous create', assigned_user_id = null
   where id = 'ca000000-0000-4000-8000-00000000b003';
  if not exists (
    select 1 from public.calendar_outbox
     where id = v_create.id and state = 'queued'
       and provider_effect_ambiguous
       and requested_snapshot = v_original_create_snapshot
  ) then
    raise exception 'CS-12 FAILED: task edit cancelled or rewrote ambiguous create';
  end if;

  update public.calendar_outbox set available_at = now() where id = v_create.id;
  select * into v_create
    from public.api_claim_calendar_outbox('ambiguous-create-recovery', 1, 120);
  v := public.api_commit_calendar_outbox_created(
    v_create.id, 'ambiguous-create-recovery', v_create.generation,
    'ambiguous-event', 'ambiguous-instance', null, 'ambiguous-version',
    (v_original_create_snapshot->>'start')::timestamptz,
    (v_original_create_snapshot->>'end')::timestamptz,
    v_original_create_snapshot->>'timeZone',
    'Inserted eligible task updated', ''
  );
  if v->>'outcome' is distinct from 'followup_queued'
     or not exists (
       select 1 from public.calendar_outbox
        where connection_id = pg_temp.connection_id()
          and task_id = 'ca000000-0000-4000-8000-00000000b003'
          and action = 'unlink' and state = 'queued'
     ) then
    raise exception 'CS-12 FAILED: recovered ambiguous create did not queue current unlink %', v;
  end if;
  raise notice 'CS-12 PASSED: insert/reassignment creates and stale/inbound unlink races preserve intent';
end $$;

-- CS-13. Disconnect serializes with remote work, preserves every ambiguous
-- write indefinitely, and only wipes credentials after all ambiguity clears.
do $$
declare
  v_write public.calendar_outbox%rowtype;
  v_retry public.calendar_outbox%rowtype;
  v_expired public.calendar_outbox%rowtype;
  v_renew public.webhook_subscriptions%rowtype;
  v_notice record;
  v_notice_second record;
  v_notice_count integer;
  v_credential_generation bigint;
  v jsonb;
begin
  -- Disconnect cannot invalidate a refresh lease after the provider may have
  -- rotated its token but before the worker commits the new sealed envelope.
  v := public.api_claim_calendar_credential_refresh(
    pg_temp.company_id(), pg_temp.connection_id(), pg_temp.user_id(),
    'disconnect-credential-refresh', null, 120
  );
  if v->>'outcome' is distinct from 'claimed' then
    raise exception 'CS-13 FAILED: disconnect-race refresh claim %', v;
  end if;
  v_credential_generation := (v->>'credential_generation')::bigint;
  v := public.api_revoke_calendar_connection(
    pg_temp.company_id(), pg_temp.user_id(), pg_temp.connection_id()
  );
  if v->>'outcome' is distinct from 'busy'
     or v->>'reason' is distinct from 'credential_refresh_in_flight' then
    raise exception 'CS-13 FAILED: disconnect invalidated in-flight token rotation %', v;
  end if;
  v := public.api_commit_calendar_credential_refresh(
    pg_temp.connection_id(), 'disconnect-credential-refresh',
    v_credential_generation,
    'BQYHCAkKCwwNDg8QERITFBUWFxg', 'BQYHCAkKCwwNDg8Q', 'v3-cleanup'
  );
  if v->>'outcome' is distinct from 'committed' then
    raise exception 'CS-13 FAILED: rotated cleanup credential did not commit %', v;
  end if;

  update public.calendar_connections set last_verified_at = now() - interval '1 hour'
   where id = pg_temp.connection_id();
  v_notice_count := public.api_queue_stale_calendar_owner_disclosures(
    now() - interval '15 minutes', 1
  );
  if v_notice_count is distinct from 1
     or public.api_queue_stale_calendar_owner_disclosures(
          now() - interval '15 minutes', 1
        ) is distinct from 0 then
    raise exception 'CS-13 FAILED: stale disclosure scan was not bounded/idempotent';
  end if;
  v := public.api_revoke_calendar_connection(
    pg_temp.company_id(), pg_temp.user_id(),
    'ca000000-0000-4000-8000-00000000ffff'
  );
  if v->>'outcome' is distinct from 'superseded'
     or (v->>'connection_id')::uuid is distinct from pg_temp.connection_id()
     or not exists (
       select 1 from public.calendar_connections
        where id = pg_temp.connection_id() and status = 'active'
          and revoked_at is null
     ) then
    raise exception 'CS-13 FAILED: stale disconnect identity mutated current connection %', v;
  end if;
  select * into v_write
    from public.api_claim_calendar_outbox('disconnect-write', 1, 120);
  if v_write.id is null then raise exception 'CS-13 FAILED: no write to lease'; end if;
  v := public.api_revoke_calendar_connection(
    pg_temp.company_id(), pg_temp.user_id(), pg_temp.connection_id()
  );
  if v->>'outcome' is distinct from 'busy'
     or v->>'reason' is distinct from 'ambiguous_provider_write'
     or not exists (
       select 1 from public.calendar_connections
        where id = pg_temp.connection_id() and credential_ciphertext is not null
          and status = 'active' and revoked_at is null
     ) then
    raise exception 'CS-13 FAILED: leased write did not block disconnect %', v;
  end if;

  v := public.api_mark_calendar_outbox_effect_started(
    v_write.id, 'disconnect-write', v_write.generation
  );
  if v->>'outcome' is distinct from 'marked'
     or not exists (
       select 1 from public.calendar_outbox
        where id = v_write.id and provider_effect_ambiguous
     ) then
    raise exception 'CS-13 FAILED: provider-effect boundary was not persisted %', v;
  end if;
  v := public.api_retry_calendar_outbox(
    v_write.id, 'disconnect-write', v_write.generation,
    1, 'provider_timeout', 'Remote result is ambiguous', false
  );
  if v->>'outcome' is distinct from 'queued' then
    raise exception 'CS-13 FAILED: ambiguous retry was not retained %', v;
  end if;
  v := public.api_revoke_calendar_connection(
    pg_temp.company_id(), pg_temp.user_id(), pg_temp.connection_id()
  );
  if v->>'outcome' is distinct from 'busy'
     or v->>'reason' is distinct from 'ambiguous_provider_write' then
    raise exception 'CS-13 FAILED: attempted queued write did not block disconnect %', v;
  end if;

  update public.calendar_outbox
     set available_at = case when id = v_write.id then now()
                             else now() + interval '1 day' end,
         attempts = case when id = v_write.id then 12 else attempts end
   where state = 'queued';
  select * into v_retry
    from public.api_claim_calendar_outbox('disconnect-retry', 1, 120);
  if v_retry.id is distinct from v_write.id or v_retry.attempts < 13 then
    raise exception 'CS-13 FAILED: high-attempt ambiguous write not reclaimed';
  end if;
  v := public.api_mark_calendar_outbox_effect_started(
    v_retry.id, 'disconnect-retry', v_retry.generation
  );
  if v->>'outcome' is distinct from 'marked' then
    raise exception 'CS-13 FAILED: inherited ambiguity re-mark %', v;
  end if;
  v := public.api_retry_calendar_outbox(
    v_retry.id, 'disconnect-retry', v_retry.generation,
    1, 'provider_401', 'Current retry was rejected, prior result is unknown',
    false, true
  );
  if v->>'outcome' is distinct from 'queued'
     or not exists (
       select 1 from public.calendar_outbox
        where id = v_retry.id and state = 'queued' and attempts >= 13
          and cancelled_at is null and provider_effect_ambiguous
     ) then
    raise exception 'CS-13 FAILED: current rejection cleared inherited ambiguity %', v;
  end if;
  v := public.api_revoke_calendar_connection(
    pg_temp.company_id(), pg_temp.user_id(), pg_temp.connection_id()
  );
  if v->>'outcome' is distinct from 'busy' then
    raise exception 'CS-13 FAILED: retained ambiguity no longer blocked disconnect %', v;
  end if;

  -- Clear only the staged ambiguity explicitly so the independent watch
  -- renewal boundary can be exercised.  High-attempt pre-write rows remain
  -- queued and must be safely cancellable because their effect flag is false.
  update public.calendar_outbox
     set state = 'cancelled', cancelled_at = now(),
         lease_owner = null, lease_expires_at = null
   where state in ('queued', 'leased') and provider_effect_ambiguous;
  update public.calendar_outbox
     set attempts = 99
   where state = 'queued' and not provider_effect_ambiguous;
  update public.webhook_subscriptions
     set expires_at = now() + interval '1 hour', renewal_available_at = now()
   where connection_id = pg_temp.connection_id() and revoked_at is null;
  select * into v_renew
    from public.api_claim_calendar_webhook_renewals(
      'disconnect-renewal', 1, 120, 86400
    );
  if v_renew.id is null then raise exception 'CS-13 FAILED: no renewal to lease'; end if;
  v := public.api_revoke_calendar_connection(
    pg_temp.company_id(), pg_temp.user_id(), pg_temp.connection_id()
  );
  if v->>'outcome' is distinct from 'busy'
     or v->>'reason' is distinct from 'webhook_renewal_in_flight'
     or not exists (
       select 1 from public.calendar_connections
        where id = pg_temp.connection_id() and credential_ciphertext is not null
     ) then
    raise exception 'CS-13 FAILED: leased renewal did not block disconnect %', v;
  end if;
  v := public.api_retry_calendar_webhook_renewal(
    v_renew.id, 'disconnect-renewal', v_renew.renewal_generation,
    60, 'provider_busy', 'Renew later', false
  );
  if v->>'outcome' is distinct from 'queued' then
    raise exception 'CS-13 FAILED: renewal lease did not release %', v;
  end if;

  -- An abandoned lease that never crossed the provider boundary is safe to
  -- cancel even after its lease expires.
  update public.calendar_outbox set available_at = now()
   where state = 'queued' and not provider_effect_ambiguous;
  select * into v_expired
    from public.api_claim_calendar_outbox('expired-read-worker', 1, 120);
  if v_expired.id is null or v_expired.provider_effect_ambiguous then
    raise exception 'CS-13 FAILED: no nonambiguous lease to expire';
  end if;
  update public.calendar_outbox
     set lease_expires_at = now() - interval '1 second',
         available_at = now() + interval '1 day'
   where id = v_expired.id;

  -- A concrete provider rejection can explicitly retire the ambiguity marker,
  -- including on a reauth response.  Generic timeouts above remain marked.
  update public.calendar_outbox set available_at = now()
   where state = 'queued' and not provider_effect_ambiguous;
  select * into v_retry
    from public.api_claim_calendar_outbox('definitely-absent-worker', 1, 120);
  if v_retry.id is null or v_retry.provider_effect_ambiguous then
    raise exception 'CS-13 FAILED: no definite-rejection fixture';
  end if;
  v := public.api_mark_calendar_outbox_effect_started(
    v_retry.id, 'definitely-absent-worker', v_retry.generation
  );
  if v->>'outcome' is distinct from 'marked' then
    raise exception 'CS-13 FAILED: definite-rejection boundary %', v;
  end if;
  v := public.api_retry_calendar_outbox(
    v_retry.id, 'definitely-absent-worker', v_retry.generation,
    1, 'provider_401', 'Provider rejected before applying write', true, true
  );
  if v->>'outcome' is distinct from 'queued'
     or not exists (
       select 1 from public.calendar_outbox
        where id = v_retry.id and state = 'queued'
          and not provider_effect_ambiguous
     )
     or not exists (
       select 1 from public.calendar_connections
        where id = pg_temp.connection_id() and status = 'reauth_required'
     ) then
    raise exception 'CS-13 FAILED: definite rejection did not retire ambiguity %', v;
  end if;

  -- Entering reauth queues one content-free owner disclosure. Claims are
  -- exclusive/retryable, and replaying the same unhealthy episode never
  -- sends a second disclosure after delivery.
  select * into v_notice
    from public.api_claim_calendar_owner_disclosures('notice-a', 1, 120);
  select * into v_notice_second
    from public.api_claim_calendar_owner_disclosures('notice-b', 1, 120);
  if v_notice.connection_id is distinct from pg_temp.connection_id()
     or v_notice.reason is distinct from 'reauth_required'
     or v_notice_second.connection_id is not null then
    raise exception 'CS-13 FAILED: owner disclosure claims overlapped';
  end if;
  v := public.api_retry_calendar_owner_disclosure(
    v_notice.connection_id, 'notice-a', v_notice.generation,
    1, 'push_busy', 'Retry owner-only disclosure'
  );
  if v->>'outcome' is distinct from 'queued' then
    raise exception 'CS-13 FAILED: owner disclosure retry %', v;
  end if;
  update public.calendar_connections set owner_disclosure_available_at = now()
   where id = pg_temp.connection_id();
  select * into v_notice
    from public.api_claim_calendar_owner_disclosures('notice-b', 1, 120);
  v := public.api_commit_calendar_owner_disclosure(
    v_notice.connection_id, 'notice-b', v_notice.generation
  );
  if v->>'outcome' is distinct from 'delivered' then
    raise exception 'CS-13 FAILED: owner disclosure commit %', v;
  end if;
  v := public.api_request_calendar_owner_disclosure(
    pg_temp.connection_id(), 'reauth_required'
  );
  if v->>'outcome' is distinct from 'coalesced'
     or not (v->>'delivered')::boolean then
    raise exception 'CS-13 FAILED: delivered disclosure repeated same episode %', v;
  end if;

  v := public.api_revoke_calendar_connection(
    pg_temp.company_id(), pg_temp.user_id(), pg_temp.connection_id()
  );
  if v->>'outcome' is distinct from 'disconnecting'
     or (v->>'count')::integer is distinct from 1
     or not exists (
       select 1 from public.calendar_connections
        where company_id = pg_temp.company_id() and user_id = pg_temp.user_id()
          and status = 'disconnected' and revoked_at is null
          and credential_ciphertext is not null
          and disconnect_cleanup_action = 'unlink'
     )
     or not exists (
       select 1 from public.webhook_subscriptions
        where company_id = pg_temp.company_id() and revoked_at is null
          and status = 'revoking'
     )
     or not exists (
       select 1 from public.calendar_outbox
        where company_id = pg_temp.company_id() and state = 'queued'
          and action = 'unlink'
  ) then
    raise exception 'CS-13 FAILED: disconnect did not retain credentials for remote cleanup %', v;
  end if;

  v := public.api_complete_calendar_connection(
    pg_temp.company_id(), pg_temp.user_id(), 'microsoft', 'acct-ms',
    'owner@test.local', 'calendar-1', 'Jobs', 'America/Edmonton',
    'AQIDBAUGBwgJCgsMDQ4PEBESExQ', 'AQIDBAUGBwgJCgsM', 'v3',
    'disconnect-race-provisional', '/me/calendars/calendar-1/events',
    repeat('7', 64), now() + interval '2 hours', null
  );
  if v->>'outcome' is distinct from 'disconnect_in_progress'
     or exists (
       select 1 from public.webhook_subscriptions
        where provider_subscription_id = 'disconnect-race-provisional'
     )
     or not exists (
       select 1 from public.calendar_connections
        where id = pg_temp.connection_id() and status = 'disconnected'
          and disconnect_cleanup_action = 'unlink'
     ) then
    raise exception 'CS-13 FAILED: reconnect resurrected in-flight disconnect %', v;
  end if;

  -- stopWatch is a durable provider operation. A retry keeps the connection
  -- sealed; only a lease-proof success can retire the old watch.
  select * into v_renew
    from public.api_claim_calendar_webhook_revocations(
      'disconnect-stop-retry', 1, 120
    );
  if v_renew.id is null then
    raise exception 'CS-13 FAILED: disconnect watch revocation was not claimable';
  end if;
  v := public.api_retry_calendar_webhook_revocation(
    v_renew.id, 'disconnect-stop-retry', v_renew.renewal_generation,
    1, 'provider_busy', 'stopWatch will retry'
  );
  if v->>'outcome' is distinct from 'queued' then
    raise exception 'CS-13 FAILED: stopWatch retry %', v;
  end if;
  update public.webhook_subscriptions set renewal_available_at = now()
   where id = v_renew.id;
  select * into v_renew
    from public.api_claim_calendar_webhook_revocations(
      'disconnect-stop-commit', 1, 120
    );
  v := public.api_commit_calendar_webhook_revocation(
    v_renew.id, 'disconnect-stop-commit', v_renew.renewal_generation
  );
  if v->>'outcome' is distinct from 'revoked'
     or (v->>'connection_finalized')::boolean then
    raise exception 'CS-13 FAILED: stopWatch commit finalized ahead of event cleanup %', v;
  end if;
  loop
    select * into v_renew
      from public.api_claim_calendar_webhook_revocations(
        'disconnect-stop-commit', 1, 120
      );
    exit when v_renew.id is null;
    v := public.api_commit_calendar_webhook_revocation(
      v_renew.id, 'disconnect-stop-commit', v_renew.renewal_generation
    );
    if v->>'outcome' is distinct from 'revoked' then
      raise exception 'CS-13 FAILED: additional stopWatch commit %', v;
    end if;
  end loop;

  loop
    select * into v_retry
      from public.api_claim_calendar_outbox('disconnect-cleanup', 1, 120);
    exit when v_retry.id is null;
    if v_retry.action = 'scrub' then
      v := public.api_commit_calendar_outbox_scrubbed(
        v_retry.id, 'disconnect-cleanup', v_retry.generation,
        coalesce(v_retry.provider_precondition, 'scrubbed'), false
      );
    else
      v := public.api_commit_calendar_outbox_sent(
        v_retry.id, 'disconnect-cleanup', v_retry.generation,
        coalesce(v_retry.provider_precondition, 'unlinked'),
        null, null, null, null, null
      );
    end if;
    if v->>'outcome' not in ('committed', 'followup_checked', 'followup_queued') then
      raise exception 'CS-13 FAILED: remote cleanup commit %', v;
    end if;
  end loop;

  if not exists (
       select 1 from public.calendar_connections
        where company_id = pg_temp.company_id() and user_id = pg_temp.user_id()
          and status = 'revoked' and revoked_at is not null
          and credential_ciphertext is null and credential_iv is null
          and credential_key_version is null
     )
     or exists (
       select 1 from public.webhook_subscriptions
        where company_id = pg_temp.company_id() and revoked_at is null
     )
     or exists (
       select 1 from public.calendar_outbox
        where company_id = pg_temp.company_id() and state in ('queued', 'leased')
  ) then
    raise exception 'CS-13 FAILED: completed remote cleanup did not finalize local revocation status=% watches=% outbox=% actions=%',
      (select status from public.calendar_connections where id = pg_temp.connection_id()),
      (select count(*) from public.webhook_subscriptions where company_id = pg_temp.company_id() and revoked_at is null),
      (select count(*) from public.calendar_outbox where company_id = pg_temp.company_id() and state in ('queued', 'leased')),
      (select string_agg(action || ':' || state, ',') from public.calendar_outbox where company_id = pg_temp.company_id() and state in ('queued', 'leased'));
  end if;
  raise notice 'CS-13 PASSED: disconnect refuses leases/ambiguity and finalizes only after remote cleanup';
end $$;

-- CS-14. An irrecoverable refresh token during disconnected cleanup becomes
-- an explicit local tombstone: links are released, existing reminder holds
-- remain retryable, and the
-- active workspace owner receives one durable failure disclosure.
do $$
declare
  v_connection_id uuid;
  v_generation bigint;
  v_claim record;
  v jsonb;
  v_base jsonb;
  v_held_id uuid;
  v_due_messages jsonb;
begin
  v_base := public.calendar_snapshot_from_fields(
    now() + interval '4 days', now() + interval '4 days 1 hour',
    'America/Edmonton', 'Abandoned cleanup fixture', ''
  );
  insert into public.calendar_connections (
    company_id, user_id, provider, provider_account_id,
    selected_calendar_id, selected_calendar_timezone,
    credential_ciphertext, credential_iv, credential_key_version
  ) values (
    pg_temp.company_id(), 'ca000000-0000-4000-8000-00000000000a',
    'google', 'cleanup-owner-account', 'primary', 'America/Edmonton',
    'AAECAwQFBgcICQoLDA0ODxAREhM', 'AAECAwQFBgcICQoL', 'v1'
  ) returning id into v_connection_id;
  insert into public.webhook_subscriptions (
    company_id, connection_id, provider_subscription_id,
    provider_resource_id, provider_calendar_id, client_state_hash, expires_at
  ) values (
    pg_temp.company_id(), v_connection_id, 'cleanup-owner-watch',
    'cleanup-owner-resource', 'primary', repeat('9', 64),
    now() + interval '6 days'
  );
  insert into public.task_calendar_links (
    company_id, connection_id, task_id,
    provider_event_id, provider_instance_id, provider_version, base_snapshot
  ) values (
    pg_temp.company_id(), v_connection_id,
    'ca000000-0000-4000-8000-00000000b002',
    'cleanup-owner-event', 'cleanup-owner-instance', 'cleanup-v1', v_base
  );
  insert into public.scheduled_messages (
    company_id, conversation_id, task_id, origin, reminder_offset_minutes,
    body, send_at, clock_timezone, clock_source, status,
    held_reason, held_reason_key, held_at, expires_at, created_by
  ) values (
    pg_temp.company_id(), 'ca000000-0000-4000-8000-0000000000e1',
    'ca000000-0000-4000-8000-00000000b002', 'reminder', 45,
    'Cleanup-held appointment reminder', now() - interval '5 minutes',
    'America/Edmonton', 'contact', 'held',
    'Calendar verification is temporarily unavailable.',
    'calendar_unverified', now() - interval '5 minutes',
    now() + interval '1 hour',
    'ca000000-0000-4000-8000-00000000000a'
  ) returning id into v_held_id;
  insert into public.scheduled_messages (
    company_id, conversation_id, task_id, origin, reminder_offset_minutes,
    body, send_at, clock_timezone, clock_source, status,
    expires_at, created_by
  ) values (
    pg_temp.company_id(), 'ca000000-0000-4000-8000-0000000000e1',
    'ca000000-0000-4000-8000-00000000b002', 'reminder', 30,
    'Cleanup-pending appointment reminder', now() + interval '30 minutes',
    'America/Edmonton', 'contact', 'pending',
    now() + interval '2 hours',
    'ca000000-0000-4000-8000-00000000000a'
  );

  v := public.api_revoke_calendar_connection(
    pg_temp.company_id(), 'ca000000-0000-4000-8000-00000000000a',
    v_connection_id
  );
  if v->>'outcome' is distinct from 'disconnecting' then
    raise exception 'CS-14 FAILED: cleanup fixture did not disconnect %', v;
  end if;
  v := public.api_claim_calendar_credential_refresh(
    pg_temp.company_id(), v_connection_id,
    'ca000000-0000-4000-8000-00000000000a',
    'cleanup-invalid-grant', null, 120
  );
  if v->>'outcome' is distinct from 'claimed' then
    raise exception 'CS-14 FAILED: disconnected cleanup could not refresh %', v;
  end if;
  v_generation := (v->>'credential_generation')::bigint;
  v := public.api_retry_calendar_credential_refresh(
    v_connection_id, 'cleanup-invalid-grant', v_generation,
    true, 'invalid_grant', 'Provider refresh credential is irrecoverable'
  );
  if v->>'outcome' is distinct from 'cleanup_abandoned'
     or not (v->>'remote_cleanup_failed')::boolean
     or not exists (
       select 1 from public.calendar_connections
        where id = v_connection_id and status = 'revoked'
          and credential_ciphertext is null
          and owner_disclosure_reason = 'cleanup_failed'
     )
     or not exists (
       select 1 from public.task_calendar_links
        where connection_id = v_connection_id and link_state = 'unlinked'
     )
     or (select count(*) from public.scheduled_messages
          where company_id = pg_temp.company_id()
            and task_id = 'ca000000-0000-4000-8000-00000000b002'
            and origin = 'reminder' and status in ('pending', 'held'))
        is distinct from 2
     or exists (
       select 1 from public.calendar_reminder_replans
        where company_id = pg_temp.company_id()
          and task_id = 'ca000000-0000-4000-8000-00000000b002'
          and state in ('queued', 'leased')
     )
     or exists (
       select 1 from public.calendar_outbox
        where connection_id = v_connection_id and state in ('queued', 'leased')
     ) then
    raise exception 'CS-14 FAILED: abandoned cleanup left a hidden hold %', v;
  end if;
  v_due_messages := public.api_claim_due_scheduled_messages(now(), 100, 300);
  if not exists (
    select 1 from jsonb_array_elements(v_due_messages) item
     where (item->>'id')::uuid = v_held_id
       and item->>'status' = 'held'
       and (item->>'expires_at')::timestamptz > now()
  ) then
    raise exception 'CS-14 FAILED: already-due held reminder was not recoverable';
  end if;
  select * into v_claim
    from public.api_claim_calendar_owner_disclosures(
      'cleanup-owner-disclosure', 1, 120
    );
  if v_claim.connection_id is distinct from v_connection_id
     or v_claim.user_id is distinct from
        'ca000000-0000-4000-8000-00000000000a'::uuid
     or v_claim.reason is distinct from 'cleanup_failed' then
    raise exception 'CS-14 FAILED: cleanup disclosure did not target active owner';
  end if;
  v := public.api_commit_calendar_owner_disclosure(
    v_connection_id, 'cleanup-owner-disclosure', v_claim.generation
  );
  if v->>'outcome' is distinct from 'delivered' then
    raise exception 'CS-14 FAILED: cleanup disclosure commit %', v;
  end if;
  if not exists (
    select 1 from public.api_list_calendar_owner_disclosures(
      pg_temp.company_id(), 'ca000000-0000-4000-8000-00000000000a'
    ) d
     where d.connection_id = v_connection_id
       and d.reason = 'cleanup_failed'
       and d.push_delivered_at is not null
  ) then
    raise exception 'CS-14 FAILED: cleanup failure was not durable in-product';
  end if;
  raise notice 'CS-14 PASSED: invalid-grant cleanup preserves retryable reminders and durably tells owner';
end $$;

-- CS-15. Per-number and membership access are calendar eligibility, not only
-- inbox filters. Revocation queues a security scrub; restoration before the
-- provider boundary withdraws it without answering attention; deactivation
-- retains credentials solely for scrub + stopWatch.
do $$
declare
  v_user_id uuid := 'ca000000-0000-4000-8000-00000000000c';
  v_connection_id uuid;
  v_link_id uuid;
  v_base jsonb;
  v_scrub public.calendar_outbox%rowtype;
  v_create public.calendar_outbox%rowtype;
  v_write public.calendar_outbox%rowtype;
  v_pull public.calendar_connections%rowtype;
  v_task public.tasks%rowtype;
  v_due_before timestamptz;
  v_attention jsonb;
  v_reminder_id uuid;
  v_failed_reminder_id uuid;
  v_before_messages integer;
  v jsonb;
begin
  insert into auth.users (id, email)
  values (v_user_id, 'calendar-access-member@test.local');
  insert into public.company_members (company_id, user_id, role)
  values (pg_temp.company_id(), v_user_id, 'member');
  update public.tasks
     set assigned_user_id = v_user_id, due_at = now() + interval '5 days'
   where id = 'ca000000-0000-4000-8000-00000000b002';
  insert into public.calendar_connections (
    company_id, user_id, provider, provider_account_id,
    selected_calendar_id, selected_calendar_timezone,
    credential_ciphertext, credential_iv, credential_key_version
  ) values (
    pg_temp.company_id(), v_user_id, 'google', 'access-member-account',
    'calendar-access', 'America/Edmonton',
    'AQIDBAUGBwgJCgsMDQ4PEBESExQ', 'AQIDBAUGBwgJCgsM', 'v1'
  ) returning id into v_connection_id;
  insert into public.webhook_subscriptions (
    company_id, connection_id, provider_subscription_id,
    provider_resource_id, provider_calendar_id, client_state_hash, expires_at
  ) values (
    pg_temp.company_id(), v_connection_id, 'access-member-watch',
    '/access-member/events', 'calendar-access', repeat('8', 64),
    now() + interval '2 days'
  );
  v_base := public.calendar_snapshot_from_fields(
    now() + interval '5 days', now() + interval '5 days 1 hour',
    'America/Edmonton', 'Access-controlled job', ''
  );
  insert into public.task_calendar_links (
    company_id, connection_id, task_id,
    provider_event_id, provider_instance_id, provider_version,
    link_state, base_snapshot, conflict_ours_snapshot,
    conflict_theirs_snapshot, conflict_detected_at
  ) values (
    pg_temp.company_id(), v_connection_id,
    'ca000000-0000-4000-8000-00000000b002',
    'access-event', 'access-instance', 'access-v1',
    'conflict', v_base, v_base, v_base, now()
  ) returning id into v_link_id;

  insert into public.number_access (
    company_id, phone_number_id, principal_kind, principal, level
  ) values (
    pg_temp.company_id(), 'ca000000-0000-4000-8000-0000000000f1',
    'user', 'ca000000-0000-4000-8000-00000000000a', 'text'
  );
  if not exists (
       select 1 from public.calendar_outbox
        where connection_id = v_connection_id and task_id =
          'ca000000-0000-4000-8000-00000000b002'
          and action = 'scrub' and state = 'queued'
     )
     or exists (
       select 1 from public.api_list_calendar_attention(
         pg_temp.company_id(), v_user_id, 10
       ) where link_id = v_link_id
     ) then
    raise exception 'CS-15 FAILED: number access loss leaked content/attention';
  end if;
  delete from public.number_access
   where company_id = pg_temp.company_id()
     and phone_number_id = 'ca000000-0000-4000-8000-0000000000f1';
  if exists (
       select 1 from public.calendar_outbox
        where connection_id = v_connection_id and state in ('queued', 'leased')
     )
     or not exists (
       select 1 from public.api_list_calendar_attention(
         pg_temp.company_id(), v_user_id, 10
       ) where link_id = v_link_id
     ) then
    raise exception 'CS-15 FAILED: access restore answered attention or retained unstarted scrub';
  end if;

  insert into public.number_access (
    company_id, phone_number_id, principal_kind, principal, level
  ) values (
    pg_temp.company_id(), 'ca000000-0000-4000-8000-0000000000f1',
    'role', 'member', 'text'
  );
  update public.company_members set role = 'bookkeeper'
   where company_id = pg_temp.company_id() and user_id = v_user_id;
  if not exists (
    select 1 from public.calendar_outbox
     where connection_id = v_connection_id and action = 'scrub'
       and state = 'queued'
  ) then
    raise exception 'CS-15 FAILED: role access loss did not queue scrub';
  end if;

  -- The scrub DELETE was accepted but its response was lost.  A webhook
  -- tombstone is recovery evidence for our exact ambiguous intent: preserve
  -- the app job, complete the scrub, and recreate only if access is restored.
  select due_at into v_due_before from public.tasks
   where id = 'ca000000-0000-4000-8000-00000000b002';
  select * into v_scrub
    from public.api_claim_calendar_outbox('access-scrub-write', 1, 120);
  if v_scrub.action is distinct from 'scrub' then
    raise exception 'CS-15 FAILED: security scrub was not claimable';
  end if;
  v := public.api_mark_calendar_outbox_effect_started(
    v_scrub.id, 'access-scrub-write', v_scrub.generation
  );
  if v->>'outcome' is distinct from 'marked' then
    raise exception 'CS-15 FAILED: scrub effect boundary %', v;
  end if;
  update public.calendar_connections set sync_due_at = now()
   where id = v_connection_id;
  select * into v_pull
    from public.api_claim_due_calendar_pulls('access-scrub-pull', 1, 120);
  v := public.api_mark_calendar_event_removed(
    pg_temp.company_id(), v_connection_id, 'access-scrub-pull',
    v_pull.pull_generation,
    'ca000000-0000-4000-8000-00000000b002',
    'access-instance', 'access-tombstone'
  );
  if v->>'reason' is distinct from 'scrub_effect_recovered'
     or (select due_at from public.tasks
          where id = 'ca000000-0000-4000-8000-00000000b002')
          is distinct from v_due_before
     or not exists (
       select 1 from public.task_calendar_links
        where id = v_link_id and link_state = 'unlinked'
     )
     or not exists (
       select 1 from public.calendar_outbox
        where id = v_scrub.id and state = 'completed'
          and not provider_effect_ambiguous
     ) then
    raise exception 'CS-15 FAILED: scrub tombstone recovery damaged app truth %', v;
  end if;
  v := public.api_commit_calendar_pull(
    v_connection_id, 'access-scrub-pull', v_pull.pull_generation,
    'access-scrub-cursor'
  );
  if v->>'outcome' is distinct from 'committed' then
    raise exception 'CS-15 FAILED: scrub recovery pull commit %', v;
  end if;

  update public.company_members set role = 'member'
   where company_id = pg_temp.company_id() and user_id = v_user_id;
  select * into v_create
    from public.api_claim_calendar_outbox('access-restore-create', 1, 120);
  if v_create.action is distinct from 'create' then
    raise exception 'CS-15 FAILED: role restore did not queue fresh create';
  end if;
  select * into v_task from public.tasks
   where id = 'ca000000-0000-4000-8000-00000000b002';
  v := public.api_commit_calendar_outbox_created(
    v_create.id, 'access-restore-create', v_create.generation,
    'access-event-restored', 'access-instance-restored', null, 'access-v2',
    (v_create.requested_snapshot->>'start')::timestamptz,
    (v_create.requested_snapshot->>'end')::timestamptz,
    v_create.requested_snapshot->>'timeZone', v_task.title, v_task.description
  );
  if v->>'outcome' is distinct from 'committed'
     or not exists (
       select 1 from public.task_calendar_links
        where id = v_link_id and link_state = 'active'
          and provider_instance_id = 'access-instance-restored'
     ) then
    raise exception 'CS-15 FAILED: restored access create %', v;
  end if;

  -- Provider safety refusals are durable under the exact outbox/pull lease,
  -- preserve an honest due when the schedule itself remains usable, and never
  -- truncate provider text into the task.
  update public.tasks set title = 'Access job after local safety edit'
   where id = 'ca000000-0000-4000-8000-00000000b002';
  select * into v_write
    from public.api_claim_calendar_outbox('unsafe-meeting-write', 1, 120);
  v := public.api_mark_calendar_refusal(
    pg_temp.company_id(), v_connection_id, 'unsafe-meeting-write', null,
    'ca000000-0000-4000-8000-00000000b002',
    'access-instance-restored', 'access-v3',
    'unsafe_meeting', 'Provider occurrence has guests or meeting metadata.',
    false, v_write.id, v_write.generation
  );
  if v->>'outcome' is distinct from 'refused'
     or (select due_at from public.tasks
          where id = 'ca000000-0000-4000-8000-00000000b002')
          is distinct from v_due_before
     or not exists (
       select 1 from public.task_calendar_links
        where id = v_link_id and link_state = 'refused'
          and refusal_code = 'unsafe_meeting'
          and provider_version = 'access-v3'
     ) then
    raise exception 'CS-15 FAILED: unsafe-meeting refusal %', v;
  end if;

  update public.calendar_connections set sync_due_at = now()
   where id = v_connection_id;
  select * into v_pull
    from public.api_claim_due_calendar_pulls('safety-pull', 1, 120);
  select * into v_task from public.tasks
   where id = 'ca000000-0000-4000-8000-00000000b002';
  v := public.api_apply_calendar_provider_snapshot(
    pg_temp.company_id(), v_connection_id, 'safety-pull',
    v_pull.pull_generation, v_task.id,
    'access-event-restored', 'access-instance-restored', null, 'access-v4',
    v_task.due_at, v_task.due_at + interval '1 hour',
    'America/Edmonton', v_task.title, v_task.description
  );
  if v->>'outcome' is distinct from 'converged' then
    raise exception 'CS-15 FAILED: safe timed occurrence did not recover %', v;
  end if;

  -- Exactly 5000 characters is lossless and applies; 5001 is refused without
  -- mutating/truncating the task or clearing its still-honest due.
  v := public.api_apply_calendar_provider_snapshot(
    pg_temp.company_id(), v_connection_id, 'safety-pull',
    v_pull.pull_generation, v_task.id,
    'access-event-restored', 'access-instance-restored', null, 'access-v5',
    v_task.due_at, v_task.due_at + interval '1 hour',
    'America/Edmonton', v_task.title, repeat('x', 5000)
  );
  if v->>'outcome' is distinct from 'provider_applied'
     or (select char_length(description) from public.tasks where id = v_task.id)
          is distinct from 5000 then
    raise exception 'CS-15 FAILED: 5000-char provider description %', v;
  end if;
  v := public.api_apply_calendar_provider_snapshot(
    pg_temp.company_id(), v_connection_id, 'safety-pull',
    v_pull.pull_generation, v_task.id,
    'access-event-restored', 'access-instance-restored', null, 'access-v6',
    v_task.due_at, v_task.due_at + interval '1 hour',
    'America/Edmonton', v_task.title, repeat('y', 5001)
  );
  if v->>'outcome' is distinct from 'refused'
     or (select char_length(description) from public.tasks where id = v_task.id)
          is distinct from 5000
     or (select due_at from public.tasks where id = v_task.id)
          is distinct from v_due_before
     or not exists (
       select 1 from public.task_calendar_links
        where id = v_link_id and refusal_code = 'description_too_long'
          and provider_version = 'access-v6'
     ) then
    raise exception 'CS-15 FAILED: oversized description was not losslessly refused %', v;
  end if;
  v := public.api_apply_calendar_provider_snapshot(
    pg_temp.company_id(), v_connection_id, 'safety-pull',
    v_pull.pull_generation, v_task.id,
    'access-event-restored', 'access-instance-restored', null, 'access-v7',
    v_due_before, v_due_before + interval '1 hour',
    'America/Edmonton', v_task.title, repeat('x', 5000)
  );
  if v->>'outcome' not in ('converged', 'provider_applied') then
    raise exception 'CS-15 FAILED: corrected description did not recover %', v;
  end if;

  v := public.api_apply_calendar_provider_snapshot(
    pg_temp.company_id(), v_connection_id, 'safety-pull',
    v_pull.pull_generation, v_task.id,
    'access-event-restored', 'access-instance-restored', null, 'access-v8',
    now() + interval '366 days', now() + interval '366 days 1 hour',
    'America/Edmonton', v_task.title, repeat('x', 5000)
  );
  if v->>'outcome' is distinct from 'refused'
     or (select due_at from public.tasks where id = v_task.id)
          is distinct from v_due_before
     or not exists (
       select 1 from public.task_calendar_links
        where id = v_link_id and refusal_code = 'outside_sync_window'
     ) then
    raise exception 'CS-15 FAILED: incoming event escaped rolling window %', v;
  end if;
  v := public.api_apply_calendar_provider_snapshot(
    pg_temp.company_id(), v_connection_id, 'safety-pull',
    v_pull.pull_generation, v_task.id,
    'access-event-restored', 'access-instance-restored', null, 'access-v9',
    v_due_before, v_due_before + interval '1 hour',
    'America/Edmonton', v_task.title, repeat('x', 5000)
  );
  if v->>'outcome' not in ('converged', 'provider_applied') then
    raise exception 'CS-15 FAILED: in-window event did not recover %', v;
  end if;

  v := public.api_mark_calendar_refusal(
    pg_temp.company_id(), v_connection_id, 'safety-pull',
    v_pull.pull_generation, v_task.id, 'access-instance-restored',
    'access-v10', 'recurrence',
    'Mapped single occurrence became a recurring series.', true
  );
  if v->>'outcome' is distinct from 'refused'
     or (select due_at from public.tasks where id = v_task.id) is not null then
    raise exception 'CS-15 FAILED: recurrence refusal retained unsafe due %', v;
  end if;
  v := public.api_apply_calendar_provider_snapshot(
    pg_temp.company_id(), v_connection_id, 'safety-pull',
    v_pull.pull_generation, v_task.id,
    'access-event-restored', 'access-instance-restored', null, 'access-v11',
    v_due_before, v_due_before + interval '1 hour',
    'America/Edmonton', v_task.title, repeat('x', 5000)
  );
  if v->>'outcome' is distinct from 'provider_applied' then
    raise exception 'CS-15 FAILED: restored single event did not recover recurrence %', v;
  end if;

  -- A fresh-GET 404 before an outbound PATCH uses the same exact outbox proof
  -- as refusal; it cannot be forged with a guessed task/connection.
  update public.tasks set title = 'Access job before outbound GET'
   where id = v_task.id;
  select * into v_write
    from public.api_claim_calendar_outbox('removed-outbound', 1, 120);
  v := public.api_mark_calendar_event_removed(
    pg_temp.company_id(), v_connection_id, 'removed-outbound', null,
    v_task.id, 'access-instance-restored', 'access-v12',
    v_write.id, v_write.generation
  );
  if v->>'outcome' is distinct from 'event_removed'
     or (select due_at from public.tasks where id = v_task.id) is not null then
    raise exception 'CS-15 FAILED: outbound 404 proof %', v;
  end if;
  select * into v_task from public.tasks where id = v_task.id;
  v := public.api_apply_calendar_provider_snapshot(
    pg_temp.company_id(), v_connection_id, 'safety-pull',
    v_pull.pull_generation, v_task.id,
    'access-event-restored', 'access-instance-restored', null, 'access-v12b',
    v_due_before, v_due_before + interval '1 hour',
    'America/Edmonton', v_task.title, v_task.description
  );
  if v->>'outcome' is distinct from 'provider_applied' then
    raise exception 'CS-15 FAILED: outbound 404 recovery %', v;
  end if;

  -- Route fresh-GET observations use both rendered app and provider CAS
  -- tokens.  A local edit makes the old card stale; a fresh card can record a
  -- refusal and then a 404 while preserving conflict evidence/due.  use_app
  -- subsequently recreates instead of looping on the missing occurrence.
  update public.tasks set title = 'CAS local B'
   where id = v_task.id;
  v := public.api_apply_calendar_provider_snapshot(
    pg_temp.company_id(), v_connection_id, 'safety-pull',
    v_pull.pull_generation, v_task.id,
    'access-event-restored', 'access-instance-restored', null, 'access-v13',
    v_due_before + interval '2 hours', v_due_before + interval '3 hours',
    'America/Edmonton', 'CAS provider C', v_task.description
  );
  if v->>'outcome' is distinct from 'conflict' then
    raise exception 'CS-15 FAILED: route CAS conflict fixture %', v;
  end if;
  v_attention := public.api_get_calendar_attention(
    pg_temp.company_id(), v_user_id, v_link_id
  )->'attention';
  update public.tasks set title = 'CAS local B after reload'
   where id = v_task.id;
  v := public.api_observe_calendar_conflict_condition(
    pg_temp.company_id(), v_user_id, v_link_id,
    v_attention->>'provider_instance_id', v_attention->'ours_snapshot',
    v_attention->>'provider_version', 'event_removed'
  );
  if v->>'outcome' is distinct from 'attention_stale' then
    raise exception 'CS-15 FAILED: stale route observation overwrote local edit %', v;
  end if;
  v_attention := public.api_get_calendar_attention(
    pg_temp.company_id(), v_user_id, v_link_id
  )->'attention';
  v := public.api_observe_calendar_conflict_condition(
    pg_temp.company_id(), v_user_id, v_link_id,
    v_attention->>'provider_instance_id', v_attention->'ours_snapshot',
    v_attention->>'provider_version', 'refused', 'access-v14',
    'unsafe_meeting', 'Fresh provider GET found guest/meeting metadata.'
  );
  if v->>'outcome' is distinct from 'observed' then
    raise exception 'CS-15 FAILED: route refusal observation %', v;
  end if;
  v_attention := public.api_get_calendar_attention(
    pg_temp.company_id(), v_user_id, v_link_id
  )->'attention';
  if v_attention->>'provider_condition' is distinct from 'refused'
     or v_attention->>'provider_version' is distinct from 'access-v14'
     or (select due_at from public.tasks where id = v_task.id)
          is distinct from v_due_before then
    raise exception 'CS-15 FAILED: route refusal lost conflict evidence %', v_attention;
  end if;
  v := public.api_observe_calendar_conflict_condition(
    pg_temp.company_id(), v_user_id, v_link_id,
    v_attention->>'provider_instance_id', v_attention->'ours_snapshot',
    v_attention->>'provider_version', 'event_removed'
  );
  if v->>'outcome' is distinct from 'observed'
     or public.api_get_calendar_attention(
       pg_temp.company_id(), v_user_id, v_link_id
     )->'attention'->>'provider_condition' is distinct from 'event_removed' then
    raise exception 'CS-15 FAILED: route 404 was not durable %', v;
  end if;
  v := public.api_observe_calendar_conflict_condition(
    pg_temp.company_id(), pg_temp.user_id(), v_link_id,
    v_attention->>'provider_instance_id', v_attention->'ours_snapshot',
    v_attention->>'provider_version', 'event_removed'
  );
  if v->>'outcome' is distinct from 'not_found' then
    raise exception 'CS-15 FAILED: another member recorded route condition %', v;
  end if;
  v_attention := public.api_get_calendar_attention(
    pg_temp.company_id(), v_user_id, v_link_id
  )->'attention';
  v := public.api_resolve_calendar_conflict(
    pg_temp.company_id(), v_user_id, v_link_id, 'use_app',
    null, null, null, null, null, null, null,
    v_attention->'ours_snapshot'
  );
  if v->>'outcome' is distinct from 'queued'
     or not exists (
       select 1 from public.calendar_outbox
        where id = (v->>'outbox_id')::uuid and action = 'create'
          and state = 'queued'
     ) then
    raise exception 'CS-15 FAILED: conflict 404 use-app did not recreate %', v;
  end if;
  select * into v_create
    from public.api_claim_calendar_outbox('cas-recreate', 1, 120);
  select * into v_task from public.tasks where id = v_task.id;
  v := public.api_commit_calendar_outbox_created(
    v_create.id, 'cas-recreate', v_create.generation,
    'access-event-cas', 'access-instance-cas', null, 'access-v15',
    (v_create.requested_snapshot->>'start')::timestamptz,
    (v_create.requested_snapshot->>'end')::timestamptz,
    v_create.requested_snapshot->>'timeZone', v_task.title, v_task.description
  );
  if v->>'outcome' is distinct from 'committed' then
    raise exception 'CS-15 FAILED: conflict recreation commit %', v;
  end if;
  v := public.api_commit_calendar_pull(
    v_connection_id, 'safety-pull', v_pull.pull_generation, 'safety-cursor'
  );
  if v->>'outcome' is distinct from 'committed' then
    raise exception 'CS-15 FAILED: safety pull commit %', v;
  end if;

  -- The final send decision is one DB transaction.  A webhook-due pull holds
  -- the reminder without creating a message; after a fresh pull it fires.  A
  -- booking predicate changing before fire terminalizes instead.
  insert into public.scheduled_messages (
    company_id, conversation_id, task_id, origin, reminder_offset_minutes,
    body, send_at, clock_timezone, clock_source, status,
    expires_at, created_by
  ) values (
    pg_temp.company_id(), 'ca000000-0000-4000-8000-0000000000e1', v_task.id,
    'reminder', 15, 'Atomic calendar fire reminder', now() - interval '1 minute',
    'America/Edmonton', 'contact', 'pending', now() + interval '1 hour', v_user_id
  ) returning id into v_reminder_id;
  select count(*) into v_before_messages from public.messages
   where company_id = pg_temp.company_id() and direction = 'outbound';
  update public.calendar_connections set sync_due_at = now()
   where id = v_connection_id;
  v := public.api_fire_scheduled_message(v_reminder_id, 1);
  if v->>'outcome' is distinct from 'held'
     or v->>'reason_key' is distinct from 'calendar_unverified'
     or (select count(*) from public.messages
          where company_id = pg_temp.company_id() and direction = 'outbound')
          is distinct from v_before_messages then
    raise exception 'CS-15 FAILED: atomic calendar hold %', v;
  end if;
  select * into v_pull
    from public.api_claim_due_calendar_pulls('fire-fresh-pull', 1, 120);
  v := public.api_commit_calendar_pull(
    v_connection_id, 'fire-fresh-pull', v_pull.pull_generation, 'fire-cursor'
  );
  if v->>'outcome' is distinct from 'committed' then
    raise exception 'CS-15 FAILED: fire verification pull %', v;
  end if;
  v := public.api_fire_scheduled_message(v_reminder_id, 1);
  if v->>'outcome' is distinct from 'fired'
     or (select count(*) from public.messages
          where company_id = pg_temp.company_id() and direction = 'outbound')
          is distinct from v_before_messages + 1 then
    raise exception 'CS-15 FAILED: verified atomic fire %', v;
  end if;

  insert into public.scheduled_messages (
    company_id, conversation_id, task_id, origin, reminder_offset_minutes,
    body, send_at, clock_timezone, clock_source, status,
    expires_at, created_by
  ) values (
    pg_temp.company_id(), 'ca000000-0000-4000-8000-0000000000e1', v_task.id,
    'reminder', 14, 'Atomic task predicate reminder', now() - interval '1 minute',
    'America/Edmonton', 'contact', 'pending', now() + interval '1 hour', v_user_id
  ) returning id into v_failed_reminder_id;
  update public.tasks set reminders_off = true where id = v_task.id;
  v := public.api_fire_scheduled_message(v_failed_reminder_id, 1);
  if v->>'outcome' is distinct from 'failed'
     or v->>'reason_key' is distinct from 'job_no_longer_scheduled'
     or (select status from public.scheduled_messages
          where id = v_failed_reminder_id) is distinct from 'failed' then
    raise exception 'CS-15 FAILED: atomic task predicate %', v;
  end if;
  update public.tasks set reminders_off = false where id = v_task.id;

  -- The same ambiguous-create rule is provider-neutral.  Pin it on a Google
  -- connection too so adapter-specific recovery cannot silently redefine B as
  -- our base and overwrite it.
  insert into public.messages
    (id, company_id, conversation_id, direction, body, status, segments)
  values (
    'ca000000-0000-4000-8000-00000000a013', pg_temp.company_id(),
    'ca000000-0000-4000-8000-0000000000e1', 'inbound',
    'Ambiguous Google create fixture.', 'received', 1
  );
  insert into public.tasks
    (id, company_id, message_id, conversation_id, title, description,
     assigned_user_id, due_at, created_by_user_id)
  values (
    'ca000000-0000-4000-8000-00000000b013', pg_temp.company_id(),
    'ca000000-0000-4000-8000-00000000a013',
    'ca000000-0000-4000-8000-0000000000e1',
    'Ambiguous Google create', '', v_user_id,
    now() + interval '7 days', v_user_id
  );
  select * into v_create
    from public.api_claim_calendar_outbox('create-google-first', 1, 120);
  v_attention := v_create.requested_snapshot;
  perform public.api_mark_calendar_outbox_effect_started(
    v_create.id, 'create-google-first', v_create.generation
  );
  perform public.api_retry_calendar_outbox(
    v_create.id, 'create-google-first', v_create.generation,
    1, 'timeout', 'Google create response was lost', false, false
  );
  update public.calendar_outbox set available_at = now() where id = v_create.id;
  select * into v_create
    from public.api_claim_calendar_outbox('create-google-recovery', 1, 120);
  v := public.api_commit_calendar_outbox_created(
    v_create.id, 'create-google-recovery', v_create.generation,
    'google-ambiguous-event', 'google-ambiguous-instance', null,
    'google-human-v2',
    (v_attention->>'start')::timestamptz + interval '3 hours',
    (v_attention->>'end')::timestamptz + interval '3 hours',
    v_attention->>'timeZone', 'Ambiguous Google create', ''
  );
  if v->>'outcome' is distinct from 'conflict'
     or not exists (
       select 1 from public.task_calendar_links l
       join public.calendar_connections c on c.id = l.connection_id
        where l.task_id = 'ca000000-0000-4000-8000-00000000b013'
          and l.link_state = 'conflict' and l.last_sent_snapshot is null
          and c.provider = 'google'
     )
     or exists (
       select 1 from public.calendar_outbox
        where task_id = 'ca000000-0000-4000-8000-00000000b013'
          and state in ('queued', 'leased')
     ) then
    raise exception 'CS-15 FAILED: ambiguous Google create overwrote human B %', v;
  end if;

  -- If provider metadata makes a mandatory access scrub unsafe, the exact
  -- leased intent can be abandoned without pretending the remote copy was
  -- erased.  The active connection remains usable, the owner gets durable
  -- cleanup_failed disclosure, and restoring access never resurrects the old
  -- occurrence identity.
  delete from public.number_access
   where company_id = pg_temp.company_id()
     and phone_number_id = 'ca000000-0000-4000-8000-0000000000f1'
     and principal_kind = 'role' and principal = 'member';
  insert into public.number_access (
    company_id, phone_number_id, principal_kind, principal, level
  ) values (
    pg_temp.company_id(), 'ca000000-0000-4000-8000-0000000000f1',
    -- number_access stores positive grants.  Restricting this number to a
    -- different principal makes v_user_id's effective level `none`.
    'user', 'ca000000-0000-4000-8000-00000000000a', 'text'
  );
  select * into v_scrub
    from public.api_claim_calendar_outbox('unsafe-access-scrub', 1, 120);
  if v_scrub.action is distinct from 'scrub' then
    raise exception 'CS-15 FAILED: unsafe access scrub fixture missing';
  end if;
  v := public.api_abandon_calendar_cleanup(
    v_scrub.id, 'unsafe-access-scrub', v_scrub.generation,
    'unsafe_meeting', 'Provider meeting cannot be scrubbed without guest impact.'
  );
  if v->>'outcome' is distinct from 'cleanup_abandoned'
     or not (v->>'remote_cleanup_failed')::boolean
     or (v->>'connection_finalized')::boolean
     or not exists (
       select 1 from public.calendar_connections
        where id = v_connection_id and status = 'active'
          and remote_cleanup_unconfirmed
          and owner_disclosure_reason = 'cleanup_failed'
     )
     or not exists (
       select 1 from public.task_calendar_links
        where id = v_scrub.link_id and link_state = 'unlinked'
     ) then
    raise exception 'CS-15 FAILED: unsafe scrub was reported as clean %', v;
  end if;
  delete from public.number_access
   where company_id = pg_temp.company_id()
     and phone_number_id = 'ca000000-0000-4000-8000-0000000000f1'
     and principal_kind = 'user'
     and principal = 'ca000000-0000-4000-8000-00000000000a';
  update public.calendar_outbox
     set state = 'cancelled', cancelled_at = now()
   where connection_id = v_connection_id and action = 'create'
     and state = 'queued';

  update public.company_members set deactivated_at = now()
   where company_id = pg_temp.company_id() and user_id = v_user_id;
  if not exists (
       select 1 from public.calendar_connections
        where id = v_connection_id and status = 'disconnected'
          and disconnect_cleanup_action = 'scrub'
          and credential_ciphertext is not null
     )
     or not exists (
       select 1 from public.calendar_outbox
        where connection_id = v_connection_id and action = 'scrub'
          and state = 'queued'
     )
     or not exists (
       select 1 from public.webhook_subscriptions
        where connection_id = v_connection_id and status = 'revoking'
          and revoked_at is null
     ) then
    raise exception 'CS-15 FAILED: member deactivation did not preserve remote cleanup';
  end if;
  raise notice 'CS-15 PASSED: number/role/deactivation access changes drive durable security scrub';
end $$;

\echo 'calendar_sync.test.sql: CS-1..CS-15 PASSED'

rollback;
