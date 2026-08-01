-- ===========================================================================
-- #347 — the schema half of the tenant-scope mechanism.
--
-- `apps/api/src/db-scope.test.ts` scans every query site and requires a
-- company scope, a named rule, or an entry in an allow-list. It works off two
-- hardcoded lists: which tables are tenant-scoped, and which of those allow a
-- NULL `company_id`.
--
-- A hardcoded list has exactly one failure mode, and it is silent: the
-- database grows a tenant table the list does not know, so every query against
-- it is exempt from the whole check and nobody is told. This file is what
-- makes that impossible — the lists are asserted against the live schema, so
-- a new tenant table fails CI until the scanner knows about it.
--
-- The second assertion matters more than it looks. The scanner exempts
-- INSERT/UPSERT on the grounds that Postgres itself rejects a row with no
-- `company_id`. That is only true while the column stays NOT NULL. If one is
-- ever made nullable, the exemption silently becomes a hole, and this is the
-- only place that would notice.
-- ===========================================================================

\set ON_ERROR_STOP on

begin;

-- ===========================================================================
-- TS-1. The scanner's tenant-table list matches the schema, both ways.
-- ===========================================================================
do $$
declare
  known text[] := array[
    'attachments', 'audit_log', 'billing_disputes', 'call_member_legs',
    'call_records', 'calls', 'company_ai_settings', 'company_ai_usage',
    'company_members', 'company_modules', 'contact_consent_events',
    'contacts', 'conversation_events', 'conversation_snoozes',
    'conversations', 'data_exports', 'egress_events', 'email_ledger',
    'grace_notices', 'high_priority_push_budget', 'high_priority_push_days',
    'inbound_notification_days', 'invites', 'member_telephony_credentials',
    'message_attachments', 'message_mentions', 'messages',
    'messaging_registrations', 'notification_prefs', 'notification_read_items',
    'notification_reads', 'number_access', 'number_port_outs', 'opt_outs',
    'outbound_call_authorizations', 'outbound_dial_leases',
    'activation_stall_state',
    'call_silence_state', 'feature_flag_overrides', 'number_health',
    'retention_notices', 'prepayments', 'referrals', 'saved_views',
    'ownership_transfers', 'phone_numbers',
    'public_links',
    'port_requests', 'provider_costs', 'tags', 'task_map_rows', 'tasks',
    'templates', 'text_enablement_orders', 'usage_alerts', 'usage_events'
  ];
  actual text[];
  missing text;
  extra text;
begin
  select coalesce(array_agg(distinct c.table_name order by c.table_name), '{}')
    into actual
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
   where c.table_schema = 'public'
     and c.column_name = 'company_id'
     -- Views count: they are query targets too, and a read through one leaks
     -- exactly as much as a read through the table under it.
     and t.table_type in ('BASE TABLE', 'VIEW');

  select string_agg(name, ', ') into missing
    from unnest(actual) name where name <> all(known);
  if missing is not null then
    raise exception
      'TS-1 FAILED: tenant table(s) the query scanner does not know about: %. '
      'Every query against them is currently EXEMPT from the #347 scope check, '
      'silently. Add them to TENANT_TABLES in apps/api/src/db-scope.test.ts '
      'and to the list here.', missing;
  end if;

  select string_agg(name, ', ') into extra
    from unnest(known) name where name <> all(actual);
  if extra is not null then
    raise exception
      'TS-1 FAILED: the scanner lists table(s) that no longer carry company_id: %. '
      'Either the column was dropped (and those queries need a different '
      'scope), or the list is stale.', extra;
  end if;
end $$;

-- ===========================================================================
-- TS-2. company_id is NOT NULL everywhere the scanner assumes it is.
--
--       This is the load-bearing assertion behind the INSERT exemption: the
--       scanner does not check inserts for a scope because the database
--       refuses one without it. Make a column nullable and that reasoning
--       evaporates without a single test failing anywhere else.
-- ===========================================================================
do $$
declare
  -- BASE TABLES only. `task_map_rows` is a VIEW: it carries no constraints at
  -- all, so it cannot participate in the NOT NULL argument. The scanner lists
  -- it in NULLABLE_SCOPE anyway, which is the conservative direction — writes
  -- through it get checked rather than exempted.
  known_nullable text[] := array[
    'billing_disputes', 'number_port_outs'
  ];
  actual_nullable text[];
  newly_nullable text;
  now_not_null text;
begin
  select coalesce(array_agg(distinct c.table_name order by c.table_name), '{}')
    into actual_nullable
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
   where c.table_schema = 'public'
     and c.column_name = 'company_id'
     and c.is_nullable = 'YES'
     and t.table_type = 'BASE TABLE';

  select string_agg(name, ', ') into newly_nullable
    from unnest(actual_nullable) name where name <> all(known_nullable);
  if newly_nullable is not null then
    raise exception
      'TS-2 FAILED: company_id became NULLABLE on %. The #347 scanner exempts '
      'INSERT/UPSERT on the grounds that Postgres rejects an unscoped row — '
      'which is no longer true for these. Either restore NOT NULL, or add them '
      'to NULLABLE_SCOPE in apps/api/src/db-scope.test.ts so their inserts are '
      'checked.', newly_nullable;
  end if;

  select string_agg(name, ', ') into now_not_null
    from unnest(known_nullable) name where name <> all(actual_nullable);
  if now_not_null is not null then
    raise exception
      'TS-2 FAILED: % now has company_id NOT NULL, so it should be removed '
      'from NULLABLE_SCOPE — leaving it there needlessly narrows the check.',
      now_not_null;
  end if;
end $$;

-- ===========================================================================
-- TS-3. The RLS posture SPEC describes is real, whatever it is worth.
--
--       #347's point is that RLS is NOT defence-in-depth against a handler
--       bug, because the Worker's key is BYPASSRLS. That argument is only
--       coherent while the OTHER half — deny-by-default with no end-user
--       grants — actually holds. If a policy ever granted `authenticated`
--       access to a tenant table, the posture would be neither layer.
-- ===========================================================================
do $$
declare
  granted text;
  policied text;
begin
  select string_agg(distinct table_name || ':' || grantee, ', ') into granted
    from information_schema.role_table_grants
   where table_schema = 'public'
     and grantee in ('anon', 'authenticated')
     and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');
  if granted is not null then
    raise exception
      'TS-3 FAILED: end-user role(s) hold table privileges: %. The deny-by-'
      'default posture is the one thing RLS genuinely buys here.', granted;
  end if;

  -- A policy naming an end-user role would only matter if a grant existed,
  -- but its presence means somebody believed end-user access was intended.
  select string_agg(distinct tablename || ':' || policyname, ', ') into policied
    from pg_policies
   where schemaname = 'public'
     and (roles::text[] && array['anon', 'authenticated'])
     -- The one deliberate exception: realtime broadcast topic authorization.
     and tablename not in ('messages');
  if policied is not null then
    raise notice
      'TS-3 NOTE: policies naming end-user roles exist (harmless without a '
      'grant, but worth a look): %', policied;
  end if;
end $$;

\echo 'tenant_scope.test.sql: TS-1..TS-3 PASSED'

rollback;
