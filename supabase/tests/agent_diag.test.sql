-- D142: agent_diag reads the ops_diag views and nothing else, and those views
-- carry nothing personal. It cannot run another owner's routine, make
-- temporary objects, or keep a transaction open past 60 seconds, and
-- set-agent-diag-password.mjs refuses a database where any of that slips.
--
-- This is what makes a prompt-free production login for agents safe
-- (docs/RIG.md): it cannot read messages, contacts, phone numbers or webhook
-- payloads.
--
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/agent_diag.test.sql
-- Runs in one transaction and ROLLS BACK.

\set ON_ERROR_STOP on

begin;

-- Nothing here acts AS agent_diag. Every check asks the catalog, because the
-- Supabase image CI runs (postgres 17.6.1.111) has a supautils bug that crashes
-- the backend on some permission-denied errors instead of raising 42501, so a
-- refused read cannot be the test.

-- ===========================================================================
-- Fixtures: a workspace with a call and a ring leg, and personal data planted
-- where a careless view would pick it up.
-- ===========================================================================
insert into auth.users (id, email, raw_user_meta_data)
values ('d1a90000-0000-4000-8000-0000000000a1', 'owner@agent-diag.test',
        '{"display_name":"Planted Owner Name"}'::jsonb);

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values ('d1a90000-0000-4000-8000-000000000001', 'Planted Company Name',
        'd1a90000-0000-4000-8000-0000000000a1', 'CA', '613', now());

insert into public.company_members (company_id, user_id, role)
values ('d1a90000-0000-4000-8000-000000000001', 'd1a90000-0000-4000-8000-0000000000a1', 'owner');

insert into public.phone_numbers
  (id, company_id, status, provisioning_key, country, number_e164)
values ('d1a90000-0000-4000-8000-000000000002', 'd1a90000-0000-4000-8000-000000000001',
        'active', 'agent_diag_test_1', 'CA', '+16135550177');

insert into public.member_telephony_credentials
  (company_id, user_id, telnyx_credential_id, sip_username)
values ('d1a90000-0000-4000-8000-000000000001', 'd1a90000-0000-4000-8000-0000000000a1',
        'cred-agent-diag', 'plantedsipusername');

insert into public.calls
  (company_id, phone_number_id, call_session_id, caller_e164, caller_name,
   direction, outcome, state, started_at, ended_at, forward_seconds)
values ('d1a90000-0000-4000-8000-000000000001', 'd1a90000-0000-4000-8000-000000000002',
        'v3:agent-diag-session', '+16135550188', 'Planted Caller Name',
        'inbound', 'answered', 'ended_answered', now() - interval '2 hours',
        now() - interval '2 hours' + interval '40 seconds', 35);

insert into public.call_member_legs
  (call_session_id, call_control_id, company_id, user_id, state)
values ('v3:agent-diag-session', 'v3:agent-diag-leg-1',
        'd1a90000-0000-4000-8000-000000000001', 'd1a90000-0000-4000-8000-0000000000a1',
        'answered');

-- ===========================================================================
-- AD-1. A plain login: no attribute that outranks a grant, and a member of no
-- role it could borrow privileges from.
-- ===========================================================================
do $$
declare
  r       record;
  v_roles text;
begin
  select * into r from pg_roles where rolname = 'agent_diag';
  if r.rolname is null then
    raise exception 'AD-1 FAILED: role agent_diag does not exist';
  end if;
  if r.rolcanlogin is distinct from true then
    raise exception 'AD-1 FAILED: agent_diag cannot log in, so the guard''s measurements cannot use it';
  end if;
  if r.rolsuper or r.rolcreaterole or r.rolcreatedb or r.rolreplication or r.rolbypassrls then
    raise exception 'AD-1 FAILED: agent_diag holds a role attribute that bypasses grants';
  end if;
  select string_agg(g.rolname, ', ') into v_roles
    from pg_auth_members m
    join pg_roles g on g.oid = m.roleid
   where m.member = r.oid;
  if v_roles is not null then
    raise exception 'AD-1 FAILED: agent_diag is a member of %', v_roles;
  end if;
  raise notice 'AD-1 PASSED: agent_diag is a plain login in no other role';
end $$;

-- ===========================================================================
-- AD-2. From the catalog: agent_diag can reach no table or view in any schema
-- but its own. Every schema is enumerated, so one an extension or a later
-- migration adds is covered; only the system catalogs, which every role reads
-- by design, are left out. has_*_privilege counts a grant to PUBLIC as well as
-- one by name. Coverage is reported, because a check that matched nothing
-- would also pass.
--
-- Two exemptions. pg_stat_statements grants itself to PUBLIC, but to a role
-- outside pg_read_all_stats, as AD-1 proves agent_diag is, every other role's
-- statement text reads as "<insufficient privilege>", leaving counts and
-- timings. And the tables the pg_net extension owns, which the local Supabase
-- image installs and grants to PUBLIC: production has no pg_net (checked
-- 2026-10-30) and no migration uses it, and enabling it there means revoking
-- PUBLIC on them before agent_diag can log in.
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
           filter (where has_schema_privilege('agent_diag', n.oid, 'USAGE')
                     and has_table_privilege('agent_diag', c.oid,
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
   where n.nspname not in ('pg_catalog', 'information_schema', 'ops_diag')
     and n.nspname not like 'pg\_toast%'
     and n.nspname not like 'pg\_temp\_%'
     and c.relkind in ('r', 'p', 'v', 'm', 'f');
  if v_checked < 100 or not exists (
       select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'messages') then
    raise exception 'AD-2 FAILED: only % relations found to check; the catalog query has '
      'stopped matching the schema, so a pass would mean nothing', v_checked;
  end if;
  if v_reachable is not null then
    raise exception 'AD-2 FAILED: agent_diag can reach %', v_reachable;
  end if;
  raise notice 'AD-2 PASSED: agent_diag can reach none of % relations in % schemas outside ops_diag',
    v_checked, v_schemas;
end $$;

-- ===========================================================================
-- AD-3. The personal tables by name, stricter than AD-2: not one column of
-- them is readable by agent_diag, whether or not it could reach the schema.
-- ===========================================================================
do $$
declare
  v_table   text;
  v_tables  text[] := array[
    'public.messages', 'public.contacts', 'public.contact_phones',
    'public.phone_numbers', 'public.webhook_events', 'public.webhook_deliveries',
    'public.calls', 'public.conversations', 'auth.users'];
  v_read    text[] := array[]::text[];
begin
  foreach v_table in array v_tables loop
    if has_any_column_privilege('agent_diag', v_table::regclass, 'SELECT') then
      v_read := v_read || v_table;
    end if;
  end loop;
  if cardinality(v_read) is distinct from 0 then
    raise exception 'AD-3 FAILED: agent_diag can read %', array_to_string(v_read, ', ');
  end if;
  raise notice 'AD-3 PASSED: agent_diag can read none of the % personal tables', cardinality(v_tables);
end $$;

-- ===========================================================================
-- AD-4. Its own grants are exactly the ops_diag slice: usage on the schema,
-- select on its views, execute on its functions. Nothing granted by name
-- anywhere else.
-- ===========================================================================
do $$
declare
  v_extra text;
begin
  select string_agg(table_schema || '.' || table_name || ':' || privilege_type, ', ')
    into v_extra
    from information_schema.role_table_grants
   where grantee = 'agent_diag'
     and (table_schema is distinct from 'ops_diag' or privilege_type is distinct from 'SELECT');
  if v_extra is not null then
    raise exception 'AD-4 FAILED: agent_diag holds table grants outside ops_diag SELECT: %', v_extra;
  end if;
  select string_agg(routine_schema || '.' || routine_name, ', ')
    into v_extra
    from information_schema.role_routine_grants
   where grantee = 'agent_diag'
     and routine_schema is distinct from 'ops_diag';
  if v_extra is not null then
    raise exception 'AD-4 FAILED: agent_diag can execute functions outside ops_diag: %', v_extra;
  end if;
  select string_agg(n.nspname, ', ')
    into v_extra
    from pg_namespace n
   where n.nspname is distinct from 'ops_diag'
     and n.nspname not like 'pg\_%'
     and n.nspname is distinct from 'information_schema'
     and has_schema_privilege('agent_diag', n.oid, 'CREATE');
  if v_extra is not null then
    raise exception 'AD-4 FAILED: agent_diag can create objects in %', v_extra;
  end if;
  -- And the slice is agent_diag's alone: a browser's roles cannot enter it.
  if has_schema_privilege('anon', 'ops_diag', 'USAGE')
     or has_schema_privilege('authenticated', 'ops_diag', 'USAGE') then
    raise exception 'AD-4 FAILED: a client role can use the ops_diag schema';
  end if;
  raise notice 'AD-4 PASSED: agent_diag''s grants are the ops_diag views and functions only, and no client role reaches them';
end $$;

-- ===========================================================================
-- AD-5. Every ops_diag relation is a barrier view with no raw id and no column
-- named for a person. By rule, so a view added later is held to it.
-- ===========================================================================
do $$
declare
  v_views    int;
  v_bad      text;
begin
  select count(*) into v_views
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'ops_diag' and c.relkind = 'v';
  if v_views < 4 then
    raise exception 'AD-5 FAILED: only % ops_diag views found', v_views;
  end if;

  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'ops_diag'
     and c.relkind in ('r', 'p', 'm', 'f');
  if v_bad is not null then
    raise exception 'AD-5 FAILED: ops_diag holds a non-view relation: %', v_bad;
  end if;

  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'ops_diag' and c.relkind = 'v'
     and coalesce('security_barrier=true' = any(c.reloptions), false) is distinct from true;
  if v_bad is not null then
    raise exception 'AD-5 FAILED: view(s) without security_barrier: %', v_bad;
  end if;

  select string_agg(table_name || '.' || column_name, ', ') into v_bad
    from information_schema.columns
   where table_schema = 'ops_diag'
     and (data_type = 'uuid'
          or string_to_array(column_name, '_') && array[
               'e164', 'phone', 'caller', 'body', 'name', 'email', 'payload',
               'transcript', 'path', 'token', 'endpoint', 'ip', 'agent',
               'address', 'url', 'intake', 'text', 'tsv', 'user', 'contact',
               'sip', 'username', 'credential', 'cnam', 'recording']);
  if v_bad is not null then
    raise exception 'AD-5 FAILED: ops_diag exposes a raw id or a personal-looking column: %', v_bad;
  end if;
  raise notice 'AD-5 PASSED: % ops_diag views, all barrier views with hashed ids only', v_views;
end $$;

-- ===========================================================================
-- AD-6. The workspace hash is the documented one: sha256 over the uuid's
-- text, first 16 hex characters, so a hash typed into an issue finds the same
-- workspace wherever it is computed.
-- ===========================================================================
do $$
begin
  if ops_diag.ref('d1a90000-0000-4000-8000-000000000001'::uuid) is distinct from '36e0f2739806ec8a' then
    raise exception 'AD-6 FAILED: ops_diag.ref gave %, want 36e0f2739806ec8a',
      ops_diag.ref('d1a90000-0000-4000-8000-000000000001'::uuid);
  end if;
  raise notice 'AD-6 PASSED: ops_diag.ref matches the published vector';
end $$;

-- ===========================================================================
-- AD-7. agent_diag can read every view and run every function the views
-- call, the fixture's evidence comes back under its hash, and none of the
-- personal data planted under the views comes back with it. The views run with
-- their owner's rights, so their rows are the same whoever reads them.
-- ===========================================================================
do $$
declare
  v_view    text;
  v_dump    text := '';
  v_part    text;
  v_rows    int;
  v_planted text;
  v_plants  text[] := array[
    '5550177', '5550188', 'Planted Caller Name', 'Planted Company Name',
    'Planted Owner Name', 'plantedsipusername', 'agent-diag.test',
    'd1a90000-0000-4000-8000-000000000001', 'd1a90000-0000-4000-8000-0000000000a1'];
  v_leaked  text[] := array[]::text[];
  v_missing text;
begin
  for v_view in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'ops_diag' and c.relkind = 'v' order by c.relname
  loop
    execute format('select coalesce(string_agg(to_jsonb(v)::text, '' ''), '''') from ops_diag.%I v', v_view)
      into v_part;
    v_dump := v_dump || ' ' || v_part;
  end loop;

  select count(*) into v_rows from ops_diag.call_legs
   where company_ref = '36e0f2739806ec8a' and call_session_id = 'v3:agent-diag-session';
  if v_rows is distinct from 1 then
    raise exception 'AD-7 FAILED: the fixture leg read back % time(s) under its hash', v_rows;
  end if;
  select count(*) into v_rows from ops_diag.call_sessions
   where company_ref = '36e0f2739806ec8a' and outcome = 'answered';
  if v_rows is distinct from 1 then
    raise exception 'AD-7 FAILED: the fixture call read back % time(s)', v_rows;
  end if;
  select ring_legs_ceiling into v_rows from ops_diag.ring_audience_sizes
   where company_ref = '36e0f2739806ec8a';
  if v_rows is distinct from 1 then
    raise exception 'AD-7 FAILED: the fixture number''s ring ceiling read %, want 1', v_rows;
  end if;

  foreach v_planted in array v_plants loop
    if position(v_planted in v_dump) > 0 then
      v_leaked := v_leaked || v_planted;
    end if;
  end loop;
  if cardinality(v_leaked) is distinct from 0 then
    raise exception 'AD-7 FAILED: ops_diag returned planted personal data or raw ids: %',
      array_to_string(v_leaked, ', ');
  end if;
  select string_agg(c.relname, ', ') into v_missing
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'ops_diag' and c.relkind = 'v'
     and not has_table_privilege('agent_diag', c.oid, 'SELECT');
  if v_missing is not null then
    raise exception 'AD-7 FAILED: agent_diag cannot read view(s) %', v_missing;
  end if;
  select string_agg(p.proname, ', ') into v_missing
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'ops_diag'
     and not has_function_privilege('agent_diag', p.oid, 'EXECUTE');
  if v_missing is not null then
    raise exception 'AD-7 FAILED: agent_diag cannot run ops_diag function(s) %, which its views call', v_missing;
  end if;
  if not has_schema_privilege('agent_diag', 'ops_diag', 'USAGE') then
    raise exception 'AD-7 FAILED: agent_diag cannot use the ops_diag schema';
  end if;

  if length(v_dump) < 200 then
    raise exception 'AD-7 FAILED: the views returned almost nothing (% chars), so the leak check proved nothing',
      length(v_dump);
  end if;
  raise notice 'AD-7 PASSED: agent_diag reads its evidence and none of the % planted values',
    cardinality(v_plants);
end $$;

-- ===========================================================================
-- AD-8. The only SECURITY DEFINER routine agent_diag can execute is the one
-- its views call: each other one runs with its owner's rights, a way around
-- AD-2. Asked of EXECUTE alone, so a schema opened later is already covered.
-- Trigger functions are left out because no query can call one directly.
-- ===========================================================================
do $$
declare
  v_allowed  regprocedure[] := array['ops_diag.ring_audience_sizes_now()'::regprocedure];
  v_checked  int;
  v_extra    text;
begin
  select count(*),
         string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
           filter (where has_function_privilege('agent_diag', p.oid, 'EXECUTE')
                     and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
                     and not (p.oid::regprocedure = any (v_allowed)))
    into v_checked, v_extra
    from pg_proc p
   where p.prosecdef;
  if v_checked < 100 then
    raise exception 'AD-8 FAILED: only % SECURITY DEFINER routines found to check; the catalog '
      'query has stopped matching, so a pass would mean nothing', v_checked;
  end if;
  if v_extra is not null then
    raise exception 'AD-8 FAILED: agent_diag can execute SECURITY DEFINER routine(s) outside its allowlist: %',
      v_extra;
  end if;
  if not has_function_privilege('agent_diag', v_allowed[1], 'EXECUTE') then
    raise exception 'AD-8 FAILED: the allowlist names % and agent_diag cannot execute it; '
      'the list has gone stale', v_allowed[1];
  end if;
  raise notice 'AD-8 PASSED: of % SECURITY DEFINER routines, agent_diag can execute only %',
    v_checked, array_to_string(v_allowed, ', ');
end $$;

-- ===========================================================================
-- AD-9. No temporary objects. TEMP came off PUBLIC (20261031100000), so
-- agent_diag holds neither TEMP nor CREATE on the database, and a role
-- created now starts without TEMP. The roles that held TEMP through PUBLIC
-- when the migration ran are named here, and each one present still holds it
-- by name. A role a later migration adds is not listed, and gets TEMP only
-- from a grant of its own.
-- ===========================================================================
do $$
declare
  v_db       text := current_database();
  v_had      text[] := array[
    'postgres', 'anon', 'authenticated', 'service_role', 'authenticator',
    'dashboard_user', 'pgbouncer', 'supabase_auth_admin', 'supabase_storage_admin',
    'supabase_functions_admin', 'supabase_realtime_admin', 'supabase_replication_admin',
    'supabase_read_only_user', 'supabase_etl_admin', 'supabase_privileged_role'];
  v_app      text[] := array['postgres', 'anon', 'authenticated', 'service_role', 'authenticator'];
  v_present  text[];
  v_without  text;
begin
  if has_database_privilege('agent_diag', v_db, 'TEMP') then
    raise exception 'AD-9 FAILED: agent_diag can create temporary objects in %', v_db;
  end if;
  if has_database_privilege('agent_diag', v_db, 'CREATE') then
    raise exception 'AD-9 FAILED: agent_diag can create schemas in %', v_db;
  end if;
  if has_database_privilege('public', v_db, 'TEMP') then
    raise exception 'AD-9 FAILED: PUBLIC holds TEMP on %, so every role inherits it', v_db;
  end if;

  create role ad9_probe_created_later nologin;
  if has_database_privilege('ad9_probe_created_later', v_db, 'TEMP') then
    raise exception 'AD-9 FAILED: a role created after 20261031100000 holds TEMP on %', v_db;
  end if;
  drop role ad9_probe_created_later;

  select array_agg(r.rolname order by r.rolname) into v_present
    from pg_roles r where r.rolname = any (v_had);
  if not (v_present @> v_app) then
    raise exception 'AD-9 FAILED: only % of the app''s roles % exist; the list has gone stale',
      v_present, v_app;
  end if;
  select string_agg(r, ', ' order by r) into v_without
    from unnest(v_present) r
   where not has_database_privilege(r::name, v_db, 'TEMP');
  if v_without is not null then
    raise exception 'AD-9 FAILED: revoking TEMP from PUBLIC also took it from %', v_without;
  end if;
  raise notice 'AD-9 PASSED: agent_diag and a new role have no TEMP on %, and the % roles that had it keep it by name',
    v_db, cardinality(v_present);
end $$;

-- ===========================================================================
-- AD-10. The role's own settings bound every statement, every idle
-- transaction and every transaction to 60 seconds at most, and keep it
-- read-only, and no per-database setting for agent_diag overrides them: one
-- set with ALTER ROLE ... IN DATABASE takes precedence at login. A session
-- can still change them; this proves an honest client such as the guard's
-- measurement job gets them, and that job checks its own session too.
-- ===========================================================================
do $$
declare
  v_config   text[];
  v_override text;
  v_name     text;
  v_value    text;
  v_ms       numeric;
  v_limits   text[] := array['statement_timeout', 'idle_in_transaction_session_timeout',
                             'transaction_timeout'];
  v_parts    text[];
begin
  select string_agg(coalesce(d.datname, s.setdatabase::text) || ' ' || s.setconfig::text, '; ')
    into v_override
    from pg_db_role_setting s
    left join pg_database d on d.oid = s.setdatabase
   where s.setrole = 'agent_diag'::regrole and s.setdatabase <> 0;
  if v_override is not null then
    raise exception 'AD-10 FAILED: agent_diag has per-database settings, which override its role settings: %',
      v_override;
  end if;
  select s.setconfig into v_config
    from pg_db_role_setting s
   where s.setrole = 'agent_diag'::regrole and s.setdatabase = 0;
  if v_config is null then
    raise exception 'AD-10 FAILED: agent_diag has no role-level settings at all';
  end if;
  if not ('default_transaction_read_only=on' = any (v_config)) then
    raise exception 'AD-10 FAILED: agent_diag does not default to read-only transactions (%)', v_config;
  end if;
  foreach v_name in array v_limits loop
    select split_part(c, '=', 2) into v_value
      from unnest(v_config) c where split_part(c, '=', 1) = v_name;
    if v_value is null then
      raise exception 'AD-10 FAILED: agent_diag has no % (%)', v_name, v_config;
    end if;
    v_parts := regexp_match(v_value, '^([0-9]+)(ms|s|min|h)?$');
    if v_parts is null then
      raise exception 'AD-10 FAILED: cannot read %=% as a duration', v_name, v_value;
    end if;
    v_ms := v_parts[1]::numeric * case coalesce(v_parts[2], 'ms')
      when 'ms' then 1 when 's' then 1000 when 'min' then 60000 when 'h' then 3600000 end;
    if v_ms <= 0 or v_ms > 60000 then
      raise exception 'AD-10 FAILED: agent_diag''s % is %, which is off or over 60 s', v_name, v_value;
    end if;
  end loop;
  raise notice 'AD-10 PASSED: agent_diag defaults to read-only, with % each at 60 s or less',
    array_to_string(v_limits, ', ');
end $$;

-- ===========================================================================
-- AD-11. AD-3, widened to more personal or secret tables, and asked whether
-- or not agent_diag can use their schema, which AD-2 requires. All but one
-- must exist, so a rename cannot quietly empty the list.
-- ===========================================================================
do $$
declare
  v_table    text;
  v_tables   text[] := array[
    'public.audit_log', 'public.opt_outs', 'storage.objects', 'auth.identities',
    'auth.sessions', 'vault.secrets', 'vault.decrypted_secrets'];
  v_present  int := 0;
  v_read     text[] := array[]::text[];
begin
  foreach v_table in array v_tables loop
    if to_regclass(v_table) is null then
      continue;
    end if;
    v_present := v_present + 1;
    if has_any_column_privilege('agent_diag', v_table::regclass, 'SELECT') then
      v_read := v_read || v_table;
    end if;
  end loop;
  if v_present < cardinality(v_tables) - 1 then
    raise exception 'AD-11 FAILED: only % of the % tables exist; the list has gone stale',
      v_present, cardinality(v_tables);
  end if;
  if cardinality(v_read) is distinct from 0 then
    raise exception 'AD-11 FAILED: agent_diag can read %', array_to_string(v_read, ', ');
  end if;
  raise notice 'AD-11 PASSED: agent_diag can read none of % more personal or secret tables', v_present;
end $$;

-- ===========================================================================
-- AD-12. set-agent-diag-password.mjs's refusals hold against a real catalog.
-- v_check's dollar-quoted text is that script's
-- preconditionSql({ production: true }), byte for byte;
-- packages/shared/src/agent-diag-password.test.ts fails if the two differ.
-- Each case plants one hazard in a subtransaction, runs the check, keeps its
-- error and rolls the hazard back. The database as migrated has pg_net here,
-- as the local image does, so production's text refuses it for that alone.
-- ===========================================================================
do $test$
declare
  v_check  text := $check$do $$
declare
  v_db       text := pg_catalog.current_database();
  v_config   text[];
  v_override text;
  v_name     text;
  v_value    text;
  v_parts    text[];
  v_ms       numeric;
  v_net      boolean := false;
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'agent_diag') then
    raise exception 'REFUSED: there is no agent_diag role here; apply the migrations first';
  end if;
  if not (select rolcanlogin from pg_catalog.pg_roles where rolname = 'agent_diag') then
    raise exception 'REFUSED: agent_diag cannot log in here, so a password would do nothing';
  end if;
  if pg_catalog.has_database_privilege('agent_diag', v_db, 'TEMP') then
    raise exception 'REFUSED: agent_diag can still create temporary objects; migration 20261031100000 is not live here';
  end if;
  select pg_catalog.string_agg(coalesce(d.datname, s.setdatabase::text) || ' {' ||
           pg_catalog.array_to_string(s.setconfig, ', ') || '}', '; ')
    into v_override
    from pg_catalog.pg_db_role_setting s
    left join pg_catalog.pg_database d on d.oid = s.setdatabase
   where s.setrole = 'agent_diag'::regrole and s.setdatabase <> 0;
  if v_override is not null then
    raise exception 'REFUSED: agent_diag has per-database settings, which override its role settings: %', v_override;
  end if;
  select s.setconfig into v_config from pg_catalog.pg_db_role_setting s
   where s.setrole = 'agent_diag'::regrole and s.setdatabase = 0;
  if not ('default_transaction_read_only=on' = any (coalesce(v_config, '{}'))) then
    raise exception 'REFUSED: agent_diag does not default to read-only transactions';
  end if;
  foreach v_name in array array['statement_timeout', 'idle_in_transaction_session_timeout',
                                'transaction_timeout'] loop
    select pg_catalog.split_part(c, '=', 2) into v_value
      from pg_catalog.unnest(coalesce(v_config, '{}')) c where pg_catalog.split_part(c, '=', 1) = v_name;
    if v_value is null then
      raise exception 'REFUSED: agent_diag has no % setting; migration 20261031100000 is not live here', v_name;
    end if;
    v_parts := pg_catalog.regexp_match(v_value, '^([0-9]+)(ms|s|min|h)?$');
    v_ms := v_parts[1]::numeric * case coalesce(v_parts[2], 'ms')
      when 'ms' then 1 when 's' then 1000 when 'min' then 60000 when 'h' then 3600000 end;
    if v_parts is null or v_ms <= 0 or v_ms > 60000 then
      raise exception 'REFUSED: agent_diag''s % is %, which is off or over 60 s', v_name, v_value;
    end if;
  end loop;
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_net') then
    select pg_catalog.has_schema_privilege('agent_diag', 'net', 'USAGE')
       and (exists (select 1 from pg_catalog.pg_proc p
                     where p.pronamespace = 'net'::regnamespace
                       and pg_catalog.has_function_privilege('agent_diag', p.oid, 'EXECUTE'))
            or exists (select 1 from pg_catalog.pg_class c
                        where c.relnamespace = 'net'::regnamespace and c.relkind = 'r'
                          and pg_catalog.has_table_privilege('agent_diag', c.oid, 'INSERT')))
      into v_net;
  end if;
  if v_net is distinct from false then
    raise exception 'REFUSED: agent_diag can reach pg_net here, which would let it send HTTP requests from the database; this database must not give it a login';
  end if;
  raise notice 'preconditions hold';
end $$;
$check$;
  v_db     text := current_database();
  v_net    boolean := exists (select 1 from pg_extension where extname = 'pg_net');
  v_plants text[];
  v_wants  text[];
  v_msg    text;
begin
  v_plants := array[
    '',
    format('grant temporary on database %I to agent_diag', v_db),
    'alter role agent_diag reset transaction_timeout',
    'alter role agent_diag set statement_timeout = 0',
    'alter role agent_diag set idle_in_transaction_session_timeout = ''5min''',
    'alter role agent_diag set default_transaction_read_only = off',
    format('alter role agent_diag in database %I set statement_timeout = 0', v_db),
    'alter role agent_diag nologin'];
  v_wants := array[
    case when v_net then 'REFUSED: agent_diag can reach pg_net here' else 'NO REFUSAL' end,
    'REFUSED: agent_diag can still create temporary objects',
    'REFUSED: agent_diag has no transaction_timeout setting',
    'REFUSED: agent_diag''s statement_timeout is 0, which is off or over 60 s',
    'REFUSED: agent_diag''s idle_in_transaction_session_timeout is 5min, which is off or over 60 s',
    'REFUSED: agent_diag does not default to read-only transactions',
    'REFUSED: agent_diag has per-database settings, which override its role settings',
    'REFUSED: agent_diag cannot log in here'];
  for i in 1 .. cardinality(v_plants) loop
    begin
      if v_plants[i] is distinct from '' then
        execute v_plants[i];
      end if;
      execute v_check;
      raise exception 'NO REFUSAL';
    exception when others then
      v_msg := sqlerrm;
    end;
    if position(v_wants[i] in v_msg) is distinct from 1 then
      raise exception 'AD-12 FAILED: with %, the check said "%", want "%"',
        coalesce(nullif(v_plants[i], ''), 'the database as migrated'), v_msg, v_wants[i];
    end if;
  end loop;
  raise notice 'AD-12 PASSED: set-agent-diag-password refuses each of % planted hazards for its own reason',
    cardinality(v_plants) - 1;
end $test$;

rollback;
