-- D142: agent_diag reads the ops_diag views and nothing else, and those views
-- carry nothing personal.
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
-- Fixtures: a workspace with a call, a ring leg, a push attempt and a beacon,
-- and personal data planted where a careless view would pick it up.
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

insert into public.push_attempts
  (company_id, user_id, call_session_id, purpose, channel, platform, priority,
   response_class, http_status, latency_ms, target_id)
values ('d1a90000-0000-4000-8000-000000000001', 'd1a90000-0000-4000-8000-0000000000a1',
        'v3:agent-diag-session', 'ring', 'fcm', 'android', 'high', 'accepted', 200, 120,
        'd1a90000-0000-4000-8000-0000000000c1');

insert into public.ring_beacons
  (company_id, user_id, auth_session_id, call_session_id, platform, stage,
   app_version, os, permissions, standby_bucket)
values ('d1a90000-0000-4000-8000-000000000001', 'd1a90000-0000-4000-8000-0000000000a1',
        'd1a90000-0000-4000-8000-0000000000b1', 'v3:agent-diag-session', 'android',
        'ringing_shown', '1.42.0', 'android-15', '{"notifications":"granted"}', 'active');

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
    raise exception 'AD-1 FAILED: agent_diag cannot log in, so call-trace cannot use it';
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
-- One exemption, by name: pg_stat_statements grants itself to PUBLIC, but to
-- a role outside pg_read_all_stats, as AD-1 proves agent_diag is, every other
-- role's statement text reads as "<insufficient privilege>", leaving counts
-- and timings.
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
                           'extensions.pg_stat_statements_info'])))
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
    'public.calls', 'public.conversations', 'public.push_attempts',
    'public.ring_beacons', 'auth.users'];
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
  if v_views < 6 then
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
-- text, first 16 hex characters. call-trace.mjs's test pins the same vector,
-- so a hash typed into an issue finds the same workspace on both sides.
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
    'd1a90000-0000-4000-8000-000000000001', 'd1a90000-0000-4000-8000-0000000000a1',
    'd1a90000-0000-4000-8000-0000000000b1', 'd1a90000-0000-4000-8000-0000000000c1'];
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

  select count(*) into v_rows from ops_diag.push_attempts
   where company_ref = '36e0f2739806ec8a' and call_session_id = 'v3:agent-diag-session';
  if v_rows is distinct from 1 then
    raise exception 'AD-7 FAILED: the fixture push attempt read back % time(s) under its hash', v_rows;
  end if;
  select count(*) into v_rows from ops_diag.ring_beacons
   where company_ref = '36e0f2739806ec8a' and stage = 'ringing_shown';
  if v_rows is distinct from 1 then
    raise exception 'AD-7 FAILED: the fixture beacon read back % time(s)', v_rows;
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

rollback;
