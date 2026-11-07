-- D146 / D147: posthog_reader reads the ops_metrics views and nothing else,
-- and those views carry nothing personal. It is the login PostHog's Postgres
-- source reads with (docs/MONITORING.md), so this is what a password entered
-- into PostHog can reach.
--
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/posthog_reader.test.sql
-- Runs in one transaction and ROLLS BACK.

\set ON_ERROR_STOP on

begin;

-- Nothing here acts AS posthog_reader: every check asks the catalog, for the
-- reason agent_diag.test.sql gives (a supautils bug crashes the backend on
-- some permission-denied errors in the image CI runs).

-- ===========================================================================
-- Fixtures: a workspace with calls in each state the views tell apart, texts,
-- and personal data planted where a careless view would pick it up.
-- ===========================================================================
insert into auth.users (id, email, raw_user_meta_data)
values ('0b5e0000-0000-4000-8000-0000000000a1', 'owner@posthog-reader.test',
        '{"display_name":"Planted Owner Name"}'::jsonb);

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values ('0b5e0000-0000-4000-8000-000000000001', 'Planted Company Name',
        '0b5e0000-0000-4000-8000-0000000000a1', 'CA', '613', now());

insert into public.phone_numbers
  (id, company_id, status, provisioning_key, country, number_e164)
values ('0b5e0000-0000-4000-8000-000000000002', '0b5e0000-0000-4000-8000-000000000001',
        'active', 'posthog_reader_test_1', 'CA', '+16135550177');

insert into public.contacts (id, company_id, phone_e164)
values ('0b5e0000-0000-4000-8000-000000000003', '0b5e0000-0000-4000-8000-000000000001',
        '+16135550188');

insert into public.conversations (id, company_id, contact_id, phone_number_id)
values ('0b5e0000-0000-4000-8000-000000000004', '0b5e0000-0000-4000-8000-000000000001',
        '0b5e0000-0000-4000-8000-000000000003', '0b5e0000-0000-4000-8000-000000000002');

-- ringing   open for five minutes: in progress, not stuck
-- runaway   answered three hours ago and still open: in progress and stuck
-- lost      the engine ended it twenty minutes ago, the outcome never landed
-- finished  over, with its outcome: in neither view
insert into public.calls
  (id, company_id, phone_number_id, call_session_id, caller_e164, caller_name,
   direction, outcome, state, started_at, answered_at, ended_at, created_at)
values
  ('0b5e0000-0000-4000-8000-0000000000c1', '0b5e0000-0000-4000-8000-000000000001',
   '0b5e0000-0000-4000-8000-000000000002', '0b5e0000-0000-4000-8000-0000000000e1',
   '+16135550188', 'Planted Caller Name', 'inbound', null, 'ringing',
   now() - interval '5 minutes', null, null, now() - interval '5 minutes'),
  ('0b5e0000-0000-4000-8000-0000000000c2', '0b5e0000-0000-4000-8000-000000000001',
   '0b5e0000-0000-4000-8000-000000000002', '0b5e0000-0000-4000-8000-0000000000e2',
   '+16135550188', 'Planted Caller Name', 'outbound', null, 'answered',
   now() - interval '3 hours', now() - interval '3 hours', null, now() - interval '3 hours'),
  ('0b5e0000-0000-4000-8000-0000000000c3', '0b5e0000-0000-4000-8000-000000000001',
   '0b5e0000-0000-4000-8000-000000000002', '0b5e0000-0000-4000-8000-0000000000e3',
   '+16135550188', 'Planted Caller Name', 'inbound', null, 'ended_answered',
   now() - interval '20 minutes', now() - interval '19 minutes', null, now() - interval '20 minutes'),
  ('0b5e0000-0000-4000-8000-0000000000c4', '0b5e0000-0000-4000-8000-000000000001',
   '0b5e0000-0000-4000-8000-000000000002', '0b5e0000-0000-4000-8000-0000000000e4',
   '+16135550188', 'Planted Caller Name', 'inbound', 'missed', 'ended_missed',
   now() - interval '1 hour', null, now() - interval '59 minutes', now() - interval '1 hour');

-- ===========================================================================
-- PR-1. A plain login: no attribute that outranks a grant, in no other role,
-- and a small connection limit.
-- ===========================================================================
do $$
declare
  r       record;
  v_roles text;
begin
  select * into r from pg_roles where rolname = 'posthog_reader';
  if r.rolname is null then
    raise exception 'PR-1 FAILED: role posthog_reader does not exist';
  end if;
  if r.rolcanlogin is distinct from true then
    raise exception 'PR-1 FAILED: posthog_reader cannot log in, so PostHog''s source cannot use it';
  end if;
  if r.rolsuper or r.rolcreaterole or r.rolcreatedb or r.rolreplication or r.rolbypassrls then
    raise exception 'PR-1 FAILED: posthog_reader holds a role attribute that bypasses grants';
  end if;
  if r.rolconnlimit < 1 or r.rolconnlimit > 5 then
    raise exception 'PR-1 FAILED: posthog_reader''s connection limit is %, want 1 to 5', r.rolconnlimit;
  end if;
  select string_agg(g.rolname, ', ') into v_roles
    from pg_auth_members m
    join pg_roles g on g.oid = m.roleid
   where m.member = r.oid;
  if v_roles is not null then
    raise exception 'PR-1 FAILED: posthog_reader is a member of %', v_roles;
  end if;
  raise notice 'PR-1 PASSED: posthog_reader is a plain login in no other role, limit %', r.rolconnlimit;
end $$;

-- ===========================================================================
-- PR-2. From the catalog: posthog_reader can reach no table or view in any
-- schema but ops_metrics, with agent_diag.test.sql's AD-2 exemptions (the
-- PUBLIC pg_stat_statements views and the local image's pg_net tables).
-- ===========================================================================
do $$
declare
  v_reachable text;
  v_checked   int;
  v_schemas   int;
begin
  select count(*),
         count(distinct n.nspname),
         string_agg(n.nspname || '.' || c.relname, ', ' order by n.nspname, c.relname)
           filter (where has_schema_privilege('posthog_reader', n.oid, 'USAGE')
                     and has_table_privilege('posthog_reader', c.oid,
                           'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                     and not ((n.nspname || '.' || c.relname) = any (array[
                           'extensions.pg_stat_statements',
                           'extensions.pg_stat_statements_info']))
                     and not exists (
                           select 1 from pg_depend d
                             join pg_extension e on e.oid = d.refobjid
                            where d.classid = 'pg_class'::regclass and d.objid = c.oid
                              and d.deptype = 'e' and e.extname = 'pg_net'))
    into v_checked, v_schemas, v_reachable
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname not in ('pg_catalog', 'information_schema', 'ops_metrics')
     and n.nspname not like 'pg\_toast%'
     and n.nspname not like 'pg\_temp\_%'
     and c.relkind in ('r', 'p', 'v', 'm', 'f');
  if v_checked < 100 then
    raise exception 'PR-2 FAILED: only % relations found to check; the catalog query has '
      'stopped matching the schema, so a pass would mean nothing', v_checked;
  end if;
  if v_reachable is not null then
    raise exception 'PR-2 FAILED: posthog_reader can reach %', v_reachable;
  end if;
  raise notice 'PR-2 PASSED: posthog_reader can reach none of % relations in % schemas outside ops_metrics',
    v_checked, v_schemas;
end $$;

-- ===========================================================================
-- PR-3. The personal and secret tables by name: not one column readable,
-- whether or not posthog_reader could reach the schema. All but one must
-- exist, so a rename cannot quietly empty the list.
-- ===========================================================================
do $$
declare
  v_table   text;
  v_tables  text[] := array[
    'public.messages', 'public.contacts', 'public.contact_phones',
    'public.phone_numbers', 'public.webhook_events', 'public.webhook_deliveries',
    'public.calls', 'public.conversations', 'public.audit_log', 'public.opt_outs',
    'storage.objects', 'auth.users', 'auth.identities', 'auth.sessions',
    'vault.secrets', 'vault.decrypted_secrets'];
  v_present int := 0;
  v_read    text[] := array[]::text[];
begin
  foreach v_table in array v_tables loop
    if to_regclass(v_table) is null then
      continue;
    end if;
    v_present := v_present + 1;
    if has_any_column_privilege('posthog_reader', v_table::regclass, 'SELECT') then
      v_read := v_read || v_table;
    end if;
  end loop;
  if v_present < cardinality(v_tables) - 1 then
    raise exception 'PR-3 FAILED: only % of the % tables exist; the list has gone stale',
      v_present, cardinality(v_tables);
  end if;
  if cardinality(v_read) is distinct from 0 then
    raise exception 'PR-3 FAILED: posthog_reader can read %', array_to_string(v_read, ', ');
  end if;
  raise notice 'PR-3 PASSED: posthog_reader can read none of % personal or secret tables', v_present;
end $$;

-- ===========================================================================
-- PR-4. Its grants are exactly SELECT on the ops_metrics views: no other
-- table grant, no routine, CREATE nowhere, and no client role in the schema.
-- ===========================================================================
do $$
declare
  v_extra text;
begin
  select string_agg(table_schema || '.' || table_name || ':' || privilege_type, ', ')
    into v_extra
    from information_schema.role_table_grants
   where grantee = 'posthog_reader'
     and (table_schema is distinct from 'ops_metrics' or privilege_type is distinct from 'SELECT');
  if v_extra is not null then
    raise exception 'PR-4 FAILED: posthog_reader holds table grants outside ops_metrics SELECT: %', v_extra;
  end if;
  select string_agg(routine_schema || '.' || routine_name, ', ')
    into v_extra
    from information_schema.role_routine_grants
   where grantee = 'posthog_reader';
  if v_extra is not null then
    raise exception 'PR-4 FAILED: posthog_reader is granted routines by name: %', v_extra;
  end if;
  select string_agg(n.nspname, ', ')
    into v_extra
    from pg_namespace n
   where n.nspname not like 'pg\_%'
     and n.nspname is distinct from 'information_schema'
     and has_schema_privilege('posthog_reader', n.oid, 'CREATE');
  if v_extra is not null then
    raise exception 'PR-4 FAILED: posthog_reader can create objects in %', v_extra;
  end if;
  if has_schema_privilege('anon', 'ops_metrics', 'USAGE')
     or has_schema_privilege('authenticated', 'ops_metrics', 'USAGE')
     or has_schema_privilege('agent_diag', 'ops_metrics', 'USAGE') then
    raise exception 'PR-4 FAILED: a client role or agent_diag can use the ops_metrics schema';
  end if;
  raise notice 'PR-4 PASSED: posthog_reader''s grants are SELECT on ops_metrics only, and no other login reaches it';
end $$;

-- ===========================================================================
-- PR-5. Every ops_metrics relation is a barrier view, its only uuids are the
-- workspace and call ids PostHog's events already carry, and no column is
-- named for a person. By rule, so a view added later is held to it.
-- ===========================================================================
do $$
declare
  v_views int;
  v_bad   text;
begin
  select count(*) into v_views
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'ops_metrics' and c.relkind = 'v';
  if v_views < 5 then
    raise exception 'PR-5 FAILED: only % ops_metrics views found', v_views;
  end if;

  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'ops_metrics' and c.relkind in ('r', 'p', 'm', 'f');
  if v_bad is not null then
    raise exception 'PR-5 FAILED: ops_metrics holds a non-view relation: %', v_bad;
  end if;

  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'ops_metrics' and c.relkind = 'v'
     and coalesce('security_barrier=true' = any(c.reloptions), false) is distinct from true;
  if v_bad is not null then
    raise exception 'PR-5 FAILED: view(s) without security_barrier: %', v_bad;
  end if;

  select string_agg(table_name || '.' || column_name, ', ') into v_bad
    from information_schema.columns
   where table_schema = 'ops_metrics'
     and ((data_type = 'uuid' and column_name not in ('call_id', 'workspace_id'))
          or string_to_array(column_name, '_') && array[
               'e164', 'phone', 'caller', 'body', 'name', 'email', 'payload',
               'transcript', 'path', 'token', 'endpoint', 'ip', 'agent',
               'address', 'url', 'intake', 'text', 'tsv', 'user', 'contact',
               'sip', 'username', 'credential', 'cnam', 'recording', 'metadata']);
  if v_bad is not null then
    raise exception 'PR-5 FAILED: ops_metrics exposes another id or a personal-looking column: %', v_bad;
  end if;
  raise notice 'PR-5 PASSED: % ops_metrics views, all barrier views with no personal column', v_views;
end $$;

-- ===========================================================================
-- PR-6. The calls views tell the four fixture calls apart.
-- ===========================================================================
do $$
declare
  v_open    text;
  v_stuck   text;
  v_seconds int;
begin
  select string_agg(call_id::text, ',' order by call_id) into v_open
    from ops_metrics.calls_in_progress
   where workspace_id = '0b5e0000-0000-4000-8000-000000000001';
  if v_open is distinct from
     '0b5e0000-0000-4000-8000-0000000000c1,0b5e0000-0000-4000-8000-0000000000c2' then
    raise exception 'PR-6 FAILED: calls_in_progress holds %, want the ringing and the runaway call', v_open;
  end if;

  select string_agg(call_id::text || ':' || reason, ',' order by call_id) into v_stuck
    from ops_metrics.stuck_calls
   where workspace_id = '0b5e0000-0000-4000-8000-000000000001';
  if v_stuck is distinct from
     '0b5e0000-0000-4000-8000-0000000000c2:open_past_ceiling,'
     '0b5e0000-0000-4000-8000-0000000000c3:ended_without_outcome' then
    raise exception 'PR-6 FAILED: stuck_calls holds %, want the runaway and the lost call', v_stuck;
  end if;

  select seconds_running into v_seconds
    from ops_metrics.calls_in_progress
   where call_id = '0b5e0000-0000-4000-8000-0000000000c1';
  if v_seconds not between 299 and 301 then
    raise exception 'PR-6 FAILED: the five-minute call reads % seconds running', v_seconds;
  end if;
  raise notice 'PR-6 PASSED: in progress, stuck and finished calls each land in the right view';
end $$;

-- ===========================================================================
-- PR-7. Storage and message totals move by exactly what the fixture adds.
-- ===========================================================================
do $$
declare
  v_bytes_before    bigint;
  v_bytes_after     bigint;
  v_day_before      bigint;
  v_day_after       bigint;
  v_inbound_before  int;
  v_inbound_after   int;
  v_segments_before int;
  v_segments_after  int;
begin
  select coalesce(sum(bytes), 0) into v_bytes_before
    from ops_metrics.storage_in_use where bucket_id = 'mms-media';
  select coalesce(sum(bytes), 0) into v_day_before
    from ops_metrics.storage_added_by_day
   where bucket_id = 'mms-media' and day = (now() at time zone 'UTC')::date;
  select coalesce(sum(messages), 0), coalesce(sum(segments), 0)
    into v_inbound_before, v_segments_before
    from ops_metrics.message_counts_by_hour
   where hour = date_trunc('hour', now()) and direction = 'inbound';

  insert into storage.objects (bucket_id, name, metadata, created_at) values
    ('mms-media', '0b5e0000-0000-4000-8000-000000000001/planted-object-name-1', '{"size": 1500}', now()),
    ('mms-media', '0b5e0000-0000-4000-8000-000000000001/planted-object-name-2', '{"size": 2500}', now()),
    ('mms-media', '0b5e0000-0000-4000-8000-000000000001/planted-object-old', '{"size": 7}',
     now() - interval '120 days');
  insert into public.messages
    (id, company_id, conversation_id, direction, body, status, segments, created_at)
  values
    ('0b5e0000-0000-4000-8000-0000000000d1', '0b5e0000-0000-4000-8000-000000000001',
     '0b5e0000-0000-4000-8000-000000000004', 'inbound', 'Planted message body', 'received', 2, now()),
    ('0b5e0000-0000-4000-8000-0000000000d2', '0b5e0000-0000-4000-8000-000000000001',
     '0b5e0000-0000-4000-8000-000000000004', 'note', 'Planted note body', null, null, now());

  select coalesce(sum(bytes), 0) into v_bytes_after
    from ops_metrics.storage_in_use where bucket_id = 'mms-media';
  select coalesce(sum(bytes), 0) into v_day_after
    from ops_metrics.storage_added_by_day
   where bucket_id = 'mms-media' and day = (now() at time zone 'UTC')::date;
  select coalesce(sum(messages), 0), coalesce(sum(segments), 0)
    into v_inbound_after, v_segments_after
    from ops_metrics.message_counts_by_hour
   where hour = date_trunc('hour', now()) and direction = 'inbound';

  if v_bytes_after - v_bytes_before is distinct from 4007 then
    raise exception 'PR-7 FAILED: storage_in_use grew by %, want 4007', v_bytes_after - v_bytes_before;
  end if;
  if v_day_after - v_day_before is distinct from 4000 then
    raise exception 'PR-7 FAILED: today''s storage_added_by_day grew by %, want 4000 (the old object is outside 90 days)',
      v_day_after - v_day_before;
  end if;
  if v_inbound_after - v_inbound_before is distinct from 1
     or v_segments_after - v_segments_before is distinct from 2 then
    raise exception 'PR-7 FAILED: inbound texts this hour grew by % with % segments, want 1 and 2',
      v_inbound_after - v_inbound_before, v_segments_after - v_segments_before;
  end if;
  if exists (select 1 from ops_metrics.message_counts_by_hour where direction = 'note') then
    raise exception 'PR-7 FAILED: message_counts_by_hour counts notes';
  end if;
  raise notice 'PR-7 PASSED: storage and message totals move by exactly the fixture';
end $$;

-- ===========================================================================
-- PR-8. Nothing planted under the views comes back through them: every view
-- is dumped whole and searched for each planted value.
-- ===========================================================================
do $$
declare
  v_view    text;
  v_dump    text := '';
  v_part    text;
  v_planted text;
  v_plants  text[] := array[
    '5550177', '5550188', 'Planted Caller Name', 'Planted Company Name',
    'Planted Owner Name', 'posthog-reader.test', 'Planted message body',
    'Planted note body', 'planted-object-name'];
  v_leaked  text[] := array[]::text[];
  v_missing text;
begin
  for v_view in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'ops_metrics' and c.relkind = 'v' order by c.relname
  loop
    execute format('select coalesce(string_agg(to_jsonb(v)::text, '' ''), '''') from ops_metrics.%I v', v_view)
      into v_part;
    v_dump := v_dump || ' ' || v_part;
  end loop;
  if length(v_dump) < 200 then
    raise exception 'PR-8 FAILED: the views returned almost nothing (% chars), so the leak check proved nothing',
      length(v_dump);
  end if;
  foreach v_planted in array v_plants loop
    if position(v_planted in v_dump) > 0 then
      v_leaked := v_leaked || v_planted;
    end if;
  end loop;
  if cardinality(v_leaked) is distinct from 0 then
    raise exception 'PR-8 FAILED: ops_metrics returned planted personal data: %',
      array_to_string(v_leaked, ', ');
  end if;
  select string_agg(c.relname, ', ') into v_missing
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'ops_metrics' and c.relkind = 'v'
     and not has_table_privilege('posthog_reader', c.oid, 'SELECT');
  if v_missing is not null or not has_schema_privilege('posthog_reader', 'ops_metrics', 'USAGE') then
    raise exception 'PR-8 FAILED: posthog_reader cannot read view(s) %', coalesce(v_missing, 'the schema');
  end if;
  raise notice 'PR-8 PASSED: posthog_reader reads every view and none of % planted values', cardinality(v_plants);
end $$;

-- ===========================================================================
-- PR-9. No SECURITY DEFINER routine is executable by posthog_reader, and it
-- can make no temporary object or schema in the database.
-- ===========================================================================
do $$
declare
  v_db      text := current_database();
  v_checked int;
  v_extra   text;
begin
  select count(*),
         string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
           filter (where has_function_privilege('posthog_reader', p.oid, 'EXECUTE')
                     and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype))
    into v_checked, v_extra
    from pg_proc p
   where p.prosecdef;
  if v_checked < 100 then
    raise exception 'PR-9 FAILED: only % SECURITY DEFINER routines found to check', v_checked;
  end if;
  if v_extra is not null then
    raise exception 'PR-9 FAILED: posthog_reader can execute SECURITY DEFINER routine(s): %', v_extra;
  end if;
  if has_database_privilege('posthog_reader', v_db, 'TEMP')
     or has_database_privilege('posthog_reader', v_db, 'CREATE') then
    raise exception 'PR-9 FAILED: posthog_reader can create temporary objects or schemas in %', v_db;
  end if;
  raise notice 'PR-9 PASSED: none of % SECURITY DEFINER routines, and no TEMP or CREATE on %', v_checked, v_db;
end $$;

-- ===========================================================================
-- PR-10. The role's own settings keep it read-only and bound every statement
-- and transaction to 60 seconds at most, with no per-database override.
-- ===========================================================================
do $$
declare
  v_config   text[];
  v_override text;
  v_name     text;
  v_value    text;
  v_parts    text[];
  v_ms       numeric;
begin
  select string_agg(coalesce(d.datname, s.setdatabase::text) || ' ' || s.setconfig::text, '; ')
    into v_override
    from pg_db_role_setting s
    left join pg_database d on d.oid = s.setdatabase
   where s.setrole = 'posthog_reader'::regrole and s.setdatabase <> 0;
  if v_override is not null then
    raise exception 'PR-10 FAILED: posthog_reader has per-database settings: %', v_override;
  end if;
  select s.setconfig into v_config
    from pg_db_role_setting s
   where s.setrole = 'posthog_reader'::regrole and s.setdatabase = 0;
  if not ('default_transaction_read_only=on' = any (coalesce(v_config, '{}'))) then
    raise exception 'PR-10 FAILED: posthog_reader does not default to read-only transactions (%)', v_config;
  end if;
  foreach v_name in array array['statement_timeout', 'idle_in_transaction_session_timeout',
                                'transaction_timeout'] loop
    select split_part(c, '=', 2) into v_value
      from unnest(v_config) c where split_part(c, '=', 1) = v_name;
    v_parts := regexp_match(coalesce(v_value, ''), '^([0-9]+)(ms|s|min|h)?$');
    if v_parts is null then
      raise exception 'PR-10 FAILED: posthog_reader has no readable % (%)', v_name, v_config;
    end if;
    v_ms := v_parts[1]::numeric * case coalesce(v_parts[2], 'ms')
      when 'ms' then 1 when 's' then 1000 when 'min' then 60000 when 'h' then 3600000 end;
    if v_ms <= 0 or v_ms > 60000 then
      raise exception 'PR-10 FAILED: posthog_reader''s % is %, which is off or over 60 s', v_name, v_value;
    end if;
  end loop;
  raise notice 'PR-10 PASSED: posthog_reader defaults to read-only with each timeout at 60 s or less';
end $$;

rollback;
