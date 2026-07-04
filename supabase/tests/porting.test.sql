-- JobText number-porting (port-in) schema assertion suite (D16 / PORTING.md §2).
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_JobText psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/porting.test.sql
-- (root script: pnpm run db:test:porting, wired into db:test:all)
--
-- The whole suite runs in one transaction and ROLLS BACK: it never pollutes the
-- local database. Self-contained fixtures (own auth.users / company / numbers),
-- with a distinct 'a5' / 'b5' id prefix so the file runs standalone OR after the
-- other suites in one psql session without id collisions.
--   owner      = a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5
--   company    = b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5
--   ported #   = b5b5b5b5-b5b5-4b5b-8b5b-b5b000000001  (source='ported')
--   bridge #   = b5b5b5b5-b5b5-4b5b-8b5b-b5b000000002  (source='provisioned')
--
-- NOTE: psql :vars are NOT interpolated inside dollar-quoted DO blocks (the
-- server receives the body verbatim), so fixture ids are written as literal
-- UUIDs throughout.

\set ON_ERROR_STOP on

begin;

-- ===========================================================================
-- PT1. Enums exist with the EXACT Telnyx-verified value sets and ordering
--      (PORTING.md §2.1). port_status mirrors status.value + local 'cancelled';
--      port_messaging_status mirrors messaging_port_status; number_source is
--      provisioned|ported.
-- ===========================================================================
do $$
declare
  ps text[];
  pms text[];
  ns text[];
begin
  select array_agg(enumlabel order by enumsortorder) into ps
  from pg_enum e join pg_type t on t.oid = e.enumtypid
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' and t.typname = 'port_status';
  if ps is distinct from array['draft','in-process','submitted','exception',
       'foc-date-confirmed','activation-in-progress','ported','cancel-pending','cancelled'] then
    raise exception 'PT1 FAILED: port_status enum wrong or mis-ordered: %', ps;
  end if;

  select array_agg(enumlabel order by enumsortorder) into pms
  from pg_enum e join pg_type t on t.oid = e.enumtypid
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' and t.typname = 'port_messaging_status';
  if pms is distinct from array['not_applicable','pending','activating','ported','exception'] then
    raise exception 'PT1 FAILED: port_messaging_status enum wrong or mis-ordered: %', pms;
  end if;

  select array_agg(enumlabel order by enumsortorder) into ns
  from pg_enum e join pg_type t on t.oid = e.enumtypid
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' and t.typname = 'number_source';
  -- 'hosted' is appended by the FEATURE-GAPS voice-wave migration
  -- (20260703060000) for the keep-your-number text-enablement path — a new
  -- ADD VALUE, never a re-order of the shipped set.
  if ns is distinct from array['provisioned','ported','hosted'] then
    raise exception 'PT1 FAILED: number_source enum wrong or mis-ordered: %', ns;
  end if;
  raise notice 'PT1 PASSED: port_status/port_messaging_status/number_source enums match the verified Telnyx sets';
end $$;

-- ===========================================================================
-- PT2. port_requests exists, RLS ENABLED, and has NO RLS policies (deny-by-
--      default — the Worker uses the service_role sb_secret_ key, SPEC §6/D8).
-- ===========================================================================
do $$
declare
  has_rls  boolean;
  n_policies int;
begin
  select relrowsecurity into has_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'port_requests';
  if has_rls is null then
    raise exception 'PT2 FAILED: public.port_requests table missing';
  end if;
  if not has_rls then
    raise exception 'PT2 FAILED: RLS not enabled on port_requests';
  end if;

  select count(*) into n_policies
  from pg_policies where schemaname = 'public' and tablename = 'port_requests';
  if n_policies <> 0 then
    raise exception 'PT2 FAILED: port_requests has % RLS policies (want 0, deny-by-default)', n_policies;
  end if;
  raise notice 'PT2 PASSED: port_requests exists, RLS enabled, deny-by-default (0 policies)';
end $$;

-- ===========================================================================
-- PT3. Deny-by-default grants: anon/authenticated hold NO privilege on
--      port_requests; service_role holds full DML (its sb_secret_ path).
-- ===========================================================================
do $$
begin
  if has_table_privilege('anon', 'public.port_requests',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     or has_table_privilege('authenticated', 'public.port_requests',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
    raise exception 'PT3 FAILED: anon/authenticated have privileges on port_requests';
  end if;
  if not (has_table_privilege('service_role', 'public.port_requests', 'SELECT')
      and has_table_privilege('service_role', 'public.port_requests', 'INSERT')
      and has_table_privilege('service_role', 'public.port_requests', 'UPDATE')
      and has_table_privilege('service_role', 'public.port_requests', 'DELETE')) then
    raise exception 'PT3 FAILED: service_role missing DML on port_requests';
  end if;
  raise notice 'PT3 PASSED: anon/authenticated denied; service_role has full DML on port_requests';
end $$;

-- ===========================================================================
-- PT4. Status columns: types + NOT NULL + the pre-submit defaults
--      (status='draft', messaging_port_status='not_applicable').
-- ===========================================================================
do $$
declare
  s_type text; s_null boolean; s_def text;
  m_type text; m_null boolean; m_def text;
  src_type text; src_null boolean; src_def text;
  por_type text; por_null boolean;
begin
  select data_type, is_nullable='YES', column_default into s_type, s_null, s_def
  from information_schema.columns
  where table_schema='public' and table_name='port_requests' and column_name='status';
  if s_type <> 'USER-DEFINED' or s_null or s_def not like '%draft%' then
    raise exception 'PT4 FAILED: port_requests.status (type=%, null=%, default=%)', s_type, s_null, s_def;
  end if;

  select data_type, is_nullable='YES', column_default into m_type, m_null, m_def
  from information_schema.columns
  where table_schema='public' and table_name='port_requests' and column_name='messaging_port_status';
  if m_type <> 'USER-DEFINED' or m_null or m_def not like '%not_applicable%' then
    raise exception 'PT4 FAILED: port_requests.messaging_port_status (type=%, null=%, default=%)', m_type, m_null, m_def;
  end if;

  -- phone_numbers.source: NOT NULL default 'provisioned'; porting_status nullable.
  select data_type, is_nullable='YES', column_default into src_type, src_null, src_def
  from information_schema.columns
  where table_schema='public' and table_name='phone_numbers' and column_name='source';
  if src_type <> 'USER-DEFINED' or src_null or src_def not like '%provisioned%' then
    raise exception 'PT4 FAILED: phone_numbers.source (type=%, null=%, default=%)', src_type, src_null, src_def;
  end if;

  select data_type, is_nullable='YES' into por_type, por_null
  from information_schema.columns
  where table_schema='public' and table_name='phone_numbers' and column_name='porting_status';
  if por_type <> 'USER-DEFINED' or not por_null then
    raise exception 'PT4 FAILED: phone_numbers.porting_status (type=%, null=%) — want USER-DEFINED, nullable', por_type, por_null;
  end if;
  raise notice 'PT4 PASSED: status/messaging defaults + phone_numbers.source (NOT NULL default provisioned) / porting_status (nullable)';
end $$;

-- ===========================================================================
-- PT5. Indexes: the two partial uniques + the two work-set indexes exist with
--      the right partial predicates (idempotency + reconcile-cron work-set).
-- ===========================================================================
do $$
declare
  active_def text;
  telnyx_def text;
  open_def   text;
  company_def text;
begin
  select indexdef into active_def from pg_indexes
    where schemaname='public' and indexname='port_requests_active_uq';
  select indexdef into telnyx_def from pg_indexes
    where schemaname='public' and indexname='port_requests_telnyx_uq';
  select indexdef into open_def from pg_indexes
    where schemaname='public' and indexname='port_requests_open_idx';
  select indexdef into company_def from pg_indexes
    where schemaname='public' and indexname='port_requests_company_idx';

  if active_def is null or active_def !~ 'UNIQUE'
     or active_def !~ 'company_id' or active_def !~ 'phone_e164'
     or active_def !~ 'cancelled' then
    raise exception 'PT5 FAILED: port_requests_active_uq missing/wrong: %', active_def;
  end if;
  if telnyx_def is null or telnyx_def !~ 'UNIQUE'
     or telnyx_def !~ 'telnyx_porting_order_id' or telnyx_def !~ 'IS NOT NULL' then
    raise exception 'PT5 FAILED: port_requests_telnyx_uq missing/wrong: %', telnyx_def;
  end if;
  if open_def is null or open_def !~ 'ported' or open_def !~ 'cancelled' then
    raise exception 'PT5 FAILED: port_requests_open_idx missing/wrong: %', open_def;
  end if;
  if company_def is null then
    raise exception 'PT5 FAILED: port_requests_company_idx missing';
  end if;
  raise notice 'PT5 PASSED: active_uq / telnyx_uq partial uniques + open/company work-set indexes present';
end $$;

-- ===========================================================================
-- PT6. FK ON DELETE behaviour: company_id + phone_number_id RESTRICT (a live
--      port protects its number/company), bridge_number_id SET NULL (releasing
--      the bridge number is never blocked by this back-reference).
-- ===========================================================================
do $$
declare
  co_del  char;
  pn_del  char;
  br_del  char;
begin
  select confdeltype into co_del from pg_constraint
    where conname='port_requests_company_id_fkey' and conrelid='public.port_requests'::regclass;
  select confdeltype into pn_del from pg_constraint
    where conname='port_requests_phone_number_id_fkey' and conrelid='public.port_requests'::regclass;
  select confdeltype into br_del from pg_constraint
    where conname='port_requests_bridge_number_id_fkey' and conrelid='public.port_requests'::regclass;

  if co_del is distinct from 'r' then
    raise exception 'PT6 FAILED: company_id delete action is % (want r/RESTRICT)', co_del;
  end if;
  if pn_del is distinct from 'r' then
    raise exception 'PT6 FAILED: phone_number_id delete action is % (want r/RESTRICT)', pn_del;
  end if;
  if br_del is distinct from 'n' then
    raise exception 'PT6 FAILED: bridge_number_id delete action is % (want n/SET NULL)', br_del;
  end if;
  raise notice 'PT6 PASSED: company/phone_number FKs RESTRICT, bridge_number FK SET NULL';
end $$;

-- ===========================================================================
-- Fixtures for the behavioural tests (rolled back at the end).
-- ===========================================================================
insert into auth.users (id, email, raw_user_meta_data)
values ('a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5', 'owner@porting.test',
        '{"display_name":"Port Owner"}'::jsonb);

insert into public.companies (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values ('b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5', 'Port Test Plumbing',
        'a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5', 'US', '303', now());

insert into public.company_members (company_id, user_id, role)
values ('b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5',
        'a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5', 'owner');

-- The ported number row the port fulfils: source='ported', status='provisioning'
-- (stays invisible to send/inbox until P6), porting_status='draft' mirror.
insert into public.phone_numbers
  (id, company_id, status, provisioning_key, country, source, porting_status)
values ('b5b5b5b5-b5b5-4b5b-8b5b-b5b000000001', 'b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5',
        'provisioning', 'cs_test_port_1', 'US', 'ported', 'draft');

-- The opt-in bridge number: an ordinary source='provisioned' row.
insert into public.phone_numbers
  (id, company_id, status, provisioning_key, country, number_e164, source)
values ('b5b5b5b5-b5b5-4b5b-8b5b-b5b000000002', 'b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5',
        'active', 'cs_test_bridge_1', 'US', '+13035550100', 'provisioned');

-- ===========================================================================
-- PT7. phone_numbers source/porting_status CHECK: (source='ported') = has
--      porting_status. A ported row WITHOUT a status, or a provisioned row WITH
--      one, is rejected; the coherent pairs are accepted.
-- ===========================================================================
do $$
begin
  -- ported row with NULL porting_status → rejected
  begin
    insert into public.phone_numbers
      (id, company_id, status, provisioning_key, country, source, porting_status)
    values ('b5b5b5b5-b5b5-4b5b-8b5b-b5b0000000ff', 'b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5',
            'provisioning', 'cs_test_bad_ported', 'US', 'ported', null);
    raise exception 'PT7 FAILED: source=ported with NULL porting_status accepted';
  exception when check_violation then null;
  end;

  -- provisioned row WITH a porting_status → rejected
  begin
    insert into public.phone_numbers
      (id, company_id, status, provisioning_key, country, source, porting_status)
    values ('b5b5b5b5-b5b5-4b5b-8b5b-b5b0000000fe', 'b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5',
            'active', 'cs_test_bad_prov', 'US', 'provisioned', 'draft');
    raise exception 'PT7 FAILED: source=provisioned with porting_status accepted';
  exception when check_violation then null;
  end;
  raise notice 'PT7 PASSED: phone_numbers source/porting_status consistency CHECK enforced';
end $$;

-- ===========================================================================
-- PT8. Insert a valid port_requests row and assert the defaults. This also
--      seeds the row the later idempotency/FK/broadcast tests reuse.
-- ===========================================================================
do $$
declare
  r public.port_requests;
begin
  insert into public.port_requests
    (id, company_id, phone_number_id, phone_e164, country,
     entity_name, auth_person_name, account_number,
     service_street, service_locality, service_admin_area, service_postal_code,
     wants_bridge_number, bridge_number_id)
  values ('b5b5b5b5-b5b5-4b5b-8b5b-b5b0000000a1',
          'b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5',
          'b5b5b5b5-b5b5-4b5b-8b5b-b5b000000001',
          '+13035559999', 'US',
          'Port Test Plumbing LLC', 'Pat Owner', 'ACCT-123456',
          '100 Main St', 'Denver', 'CO', '80202',
          true, 'b5b5b5b5-b5b5-4b5b-8b5b-b5b000000002')
  returning * into r;

  if r.status <> 'draft' then
    raise exception 'PT8 FAILED: default status is % (want draft)', r.status;
  end if;
  if r.messaging_port_status <> 'not_applicable' then
    raise exception 'PT8 FAILED: default messaging_port_status is % (want not_applicable)', r.messaging_port_status;
  end if;
  if r.submission_count <> 0 then
    raise exception 'PT8 FAILED: default submission_count is % (want 0)', r.submission_count;
  end if;
  if r.is_wireless <> false then
    raise exception 'PT8 FAILED: default is_wireless is % (want false)', r.is_wireless;
  end if;
  if r.created_at is null or r.updated_at is null then
    raise exception 'PT8 FAILED: created_at/updated_at not defaulted';
  end if;
  raise notice 'PT8 PASSED: port_requests row inserts with status=draft, messaging=not_applicable, count=0';
end $$;

-- ===========================================================================
-- PT9. port_requests_active_uq: one LIVE port per (company, phone_e164). A
--      second non-cancelled row for the same number is rejected; cancelling the
--      first frees the number for a fresh retry row.
-- ===========================================================================
do $$
begin
  -- second live port for the same number → unique violation
  begin
    insert into public.port_requests
      (company_id, phone_number_id, phone_e164, country,
       entity_name, auth_person_name, account_number,
       service_street, service_locality, service_admin_area, service_postal_code)
    values ('b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5',
            'b5b5b5b5-b5b5-4b5b-8b5b-b5b000000001',
            '+13035559999', 'US',
            'Dup Co', 'Dup Person', 'ACCT-DUP',
            '1 Dup', 'Denver', 'CO', '80202');
    raise exception 'PT9 FAILED: a 2nd live port for the same number was accepted';
  exception when unique_violation then null;
  end;

  -- cancel the first, then a fresh row for the same number is allowed
  update public.port_requests set status = 'cancelled', cancelled_at = now()
  where id = 'b5b5b5b5-b5b5-4b5b-8b5b-b5b0000000a1';

  insert into public.port_requests
    (id, company_id, phone_number_id, phone_e164, country,
     entity_name, auth_person_name, account_number,
     service_street, service_locality, service_admin_area, service_postal_code)
  values ('b5b5b5b5-b5b5-4b5b-8b5b-b5b0000000a2',
          'b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5',
          'b5b5b5b5-b5b5-4b5b-8b5b-b5b000000001',
          '+13035559999', 'US',
          'Retry Co', 'Retry Person', 'ACCT-RETRY',
          '1 Retry', 'Denver', 'CO', '80202');
  raise notice 'PT9 PASSED: active_uq blocks a 2nd live port; a cancelled port frees a retry';
end $$;

-- ===========================================================================
-- PT10. port_requests_telnyx_uq: a Telnyx porting-order id is unique (webhook
--       lookup + idempotency), but MANY rows may have NULL (partial index —
--       drafts before submit don't collide).
-- ===========================================================================
do $$
begin
  update public.port_requests set telnyx_porting_order_id = 'po_abc123'
  where id = 'b5b5b5b5-b5b5-4b5b-8b5b-b5b0000000a2';

  -- a second row cannot claim the same Telnyx order id
  begin
    update public.port_requests set telnyx_porting_order_id = 'po_abc123'
    where id = 'b5b5b5b5-b5b5-4b5b-8b5b-b5b0000000a1';
    raise exception 'PT10 FAILED: two rows shared one telnyx_porting_order_id';
  exception when unique_violation then null;
  end;

  -- but NULLs never collide: the cancelled row (a1) keeping NULL is fine, and a
  -- brand-new NULL-order draft coexists.
  insert into public.port_requests
    (company_id, phone_number_id, phone_e164, country,
     entity_name, auth_person_name, account_number,
     service_street, service_locality, service_admin_area, service_postal_code)
  values ('b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5',
          'b5b5b5b5-b5b5-4b5b-8b5b-b5b000000001',
          '+13035550001', 'US',   -- different number so active_uq is happy
          'Null Order Co', 'Null Person', 'ACCT-NULL',
          '1 Null', 'Denver', 'CO', '80202');
  raise notice 'PT10 PASSED: telnyx_porting_order_id unique when set, NULLs never collide';
end $$;

-- ===========================================================================
-- PT11. SSN/SIN policy (§2.2 / SPEC §10): only the LAST-4 is storable — the
--       CHECK makes a full 9-digit SSN/SIN impossible; exactly 4 digits is OK;
--       NULL is OK (the common non-wireless case).
-- ===========================================================================
do $$
begin
  -- 9-digit full SSN → rejected by the last-4 CHECK
  begin
    update public.port_requests set is_wireless = true, ssn_sin_last4 = '123456789'
    where id = 'b5b5b5b5-b5b5-4b5b-8b5b-b5b0000000a2';
    raise exception 'PT11 FAILED: a full 9-digit SSN/SIN was stored';
  exception when check_violation then null;
  end;

  -- non-numeric → rejected
  begin
    update public.port_requests set ssn_sin_last4 = 'abcd'
    where id = 'b5b5b5b5-b5b5-4b5b-8b5b-b5b0000000a2';
    raise exception 'PT11 FAILED: non-numeric ssn_sin_last4 accepted';
  exception when check_violation then null;
  end;

  -- exactly 4 digits → accepted
  update public.port_requests set is_wireless = true, ssn_sin_last4 = '6789'
  where id = 'b5b5b5b5-b5b5-4b5b-8b5b-b5b0000000a2';
  raise notice 'PT11 PASSED: ssn_sin_last4 stores only 4 digits (full SSN/SIN impossible)';
end $$;

-- ===========================================================================
-- PT12. country CHECK: only US/CA (matches D2/D16 geo scope).
-- ===========================================================================
do $$
begin
  begin
    insert into public.port_requests
      (company_id, phone_number_id, phone_e164, country,
       entity_name, auth_person_name, account_number,
       service_street, service_locality, service_admin_area, service_postal_code)
    values ('b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5',
            'b5b5b5b5-b5b5-4b5b-8b5b-b5b000000001',
            '+447700900000', 'GB',
            'Intl Co', 'Intl Person', 'ACCT-INTL',
            '1 Intl', 'London', 'LDN', 'EC1A');
    raise exception 'PT12 FAILED: a non-US/CA country was accepted';
  exception when check_violation then null;
  end;
  raise notice 'PT12 PASSED: country CHECK rejects non-US/CA ports';
end $$;

-- ===========================================================================
-- PT13. FK enforcement: company_id + phone_number_id must reference real rows;
--       a live port RESTRICTs deletion of its number and company.
-- ===========================================================================
do $$
begin
  -- unknown phone_number_id → FK violation
  begin
    insert into public.port_requests
      (company_id, phone_number_id, phone_e164, country,
       entity_name, auth_person_name, account_number,
       service_street, service_locality, service_admin_area, service_postal_code)
    values ('b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5',
            '00000000-0000-4000-8000-000000000000',
            '+13035558888', 'US',
            'Ghost Co', 'Ghost Person', 'ACCT-GHOST',
            '1 Ghost', 'Denver', 'CO', '80202');
    raise exception 'PT13 FAILED: unknown phone_number_id accepted';
  exception when foreign_key_violation then null;
  end;

  -- deleting a number that a live port references → RESTRICT
  begin
    delete from public.phone_numbers where id = 'b5b5b5b5-b5b5-4b5b-8b5b-b5b000000001';
    raise exception 'PT13 FAILED: deleting a ported number under a live port was allowed';
  exception when foreign_key_violation then null;
  end;
  raise notice 'PT13 PASSED: phone_number_id FK enforced; RESTRICT protects a referenced number';
end $$;

-- ===========================================================================
-- PT14. bridge_number_id ON DELETE SET NULL: releasing the bridge number nulls
--       the back-reference instead of blocking the delete (the a2 row still
--       points at the bridge from PT8-era setup — re-point it, then delete).
-- ===========================================================================
do $$
declare
  br uuid;
begin
  -- point the live retry row at the bridge number, then hard-delete the bridge.
  update public.port_requests set bridge_number_id = 'b5b5b5b5-b5b5-4b5b-8b5b-b5b000000002'
  where id = 'b5b5b5b5-b5b5-4b5b-8b5b-b5b0000000a2';

  delete from public.phone_numbers where id = 'b5b5b5b5-b5b5-4b5b-8b5b-b5b000000002';

  select bridge_number_id into br from public.port_requests
  where id = 'b5b5b5b5-b5b5-4b5b-8b5b-b5b0000000a2';
  if br is not null then
    raise exception 'PT14 FAILED: bridge_number_id not nulled on bridge delete (got %)', br;
  end if;
  raise notice 'PT14 PASSED: deleting the bridge number SET NULL the back-reference (delete not blocked)';
end $$;

-- ===========================================================================
-- PT15. moddatetime: the set_updated_at trigger rewrites updated_at on every
--       UPDATE (SPEC §6). The whole suite runs in one transaction, so now()
--       (transaction time) is constant — a wall-clock advance can't be observed.
--       Instead, plant a deliberately STALE updated_at and prove the trigger
--       overwrites it back to the transaction timestamp on the next UPDATE
--       (i.e. the app can never persist a stale updated_at).
-- ===========================================================================
do $$
declare
  after_ts timestamptz;
  n int;
begin
  -- The trigger must exist with the shared name/signature the other 13 tables use.
  select count(*) into n
  from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
  join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public' and c.relname = 'port_requests'
    and tg.tgname = 'set_updated_at' and not tg.tgisinternal;
  if n <> 1 then
    raise exception 'PT15 FAILED: set_updated_at trigger missing on port_requests (found %)', n;
  end if;

  -- Force a stale value, then a normal UPDATE: moddatetime resets updated_at to
  -- now() regardless of what the row (or the client) tried to write.
  update public.port_requests set updated_at = '1999-01-01T00:00:00Z'
  where id = 'b5b5b5b5-b5b5-4b5b-8b5b-b5b0000000a2';
  update public.port_requests set rejection_reason = 'ACCOUNT_NUMBER_MISMATCH'
  where id = 'b5b5b5b5-b5b5-4b5b-8b5b-b5b0000000a2';
  select updated_at into after_ts from public.port_requests
  where id = 'b5b5b5b5-b5b5-4b5b-8b5b-b5b0000000a2';
  if after_ts = '1999-01-01T00:00:00Z'::timestamptz then
    raise exception 'PT15 FAILED: updated_at kept the stale value — moddatetime did not fire';
  end if;
  if after_ts <> now() then
    raise exception 'PT15 FAILED: updated_at is % (want transaction now())', after_ts;
  end if;
  raise notice 'PT15 PASSED: set_updated_at trigger present; moddatetime overwrites stale updated_at';
end $$;

-- ===========================================================================
-- PT16. port.updated Broadcast-from-Database (PORTING.md §8.2): an UPDATE to a
--       port_requests row emits exactly one new 'port.updated' broadcast into
--       the private topic company:{company_id}, IDs only, carrying status +
--       messaging_port_status (the tracker patches live without a refetch).
-- ===========================================================================
do $$
declare
  before_ids  uuid[];
  new_count   int;
  new_payload jsonb;
begin
  select coalesce(array_agg(id), '{}') into before_ids
  from realtime.messages
  where topic = 'company:b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5'
    and event = 'port.updated' and extension = 'broadcast'
    and payload->>'port_request_id' = 'b5b5b5b5-b5b5-4b5b-8b5b-b5b0000000a2';

  -- Drive a status transition (draft → in-process), simulating P5 submit.
  update public.port_requests set status = 'in-process', submitted_at = now(),
         submission_count = submission_count + 1
  where id = 'b5b5b5b5-b5b5-4b5b-8b5b-b5b0000000a2';

  select count(*) into new_count
  from realtime.messages
  where topic = 'company:b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5'
    and event = 'port.updated' and extension = 'broadcast'
    and payload->>'port_request_id' = 'b5b5b5b5-b5b5-4b5b-8b5b-b5b0000000a2'
    and id <> all (before_ids);
  if new_count <> 1 then
    raise exception 'PT16 FAILED: port UPDATE emitted % new port.updated broadcasts (want 1)', new_count;
  end if;

  select payload into new_payload
  from realtime.messages
  where topic = 'company:b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5'
    and event = 'port.updated' and extension = 'broadcast'
    and payload->>'port_request_id' = 'b5b5b5b5-b5b5-4b5b-8b5b-b5b0000000a2'
    and id <> all (before_ids);
  if new_payload->>'status' <> 'in-process' then
    raise exception 'PT16 FAILED: broadcast payload status is % (want in-process)', new_payload->>'status';
  end if;
  if new_payload->>'messaging_port_status' <> 'not_applicable' then
    raise exception 'PT16 FAILED: broadcast payload messaging_port_status is % (want not_applicable)', new_payload->>'messaging_port_status';
  end if;
  -- IDs only: the sensitive credential columns must NOT be in the payload.
  if new_payload ? 'account_number' or new_payload ? 'pin_passcode' then
    raise exception 'PT16 FAILED: broadcast payload leaked credential columns (%)' , new_payload;
  end if;
  raise notice 'PT16 PASSED: port.updated broadcast fires once, IDs-only, carries status + messaging_port_status';
end $$;

-- ===========================================================================
-- PT17. Full voice→messaging status walk exercises EVERY enum value the port
--       state machine visits (§1), proving the columns accept the whole Telnyx
--       lifecycle. Uses the NULL-order draft row from PT10 (number +13035550001)
--       so it never collides with the a2 row's active_uq.
-- ===========================================================================
do $$
declare
  walk_id uuid;
  s port_status;
  voice port_status;
  msg port_messaging_status;
begin
  select id into walk_id from public.port_requests
  where phone_e164 = '+13035550001' limit 1;

  -- Voice track: draft → in-process → submitted → foc-date-confirmed →
  -- activation-in-progress → ported. (exception + cancel-pending covered below.)
  foreach voice in array array['draft','in-process','submitted','foc-date-confirmed',
                               'activation-in-progress','ported']::port_status[]
  loop
    update public.port_requests set status = voice where id = walk_id;
  end loop;
  select status into s from public.port_requests where id = walk_id;
  if s <> 'ported' then
    raise exception 'PT17 FAILED: voice walk did not end at ported (got %)', s;
  end if;

  -- Messaging track: not_applicable → pending → activating → ported (and the
  -- exception branch is a legal value too).
  foreach msg in array array['pending','activating','exception','ported']::port_messaging_status[]
  loop
    update public.port_requests set messaging_port_status = msg where id = walk_id;
  end loop;
  update public.port_requests set messaging_port_status = 'ported', ported_at = now()
  where id = walk_id;

  -- The exception + cancel-pending voice states must also be assignable.
  update public.port_requests set status = 'exception',
         rejection_reason = 'PASSCODE_PIN_INVALID' where id = walk_id;
  update public.port_requests set status = 'cancel-pending' where id = walk_id;
  update public.port_requests set status = 'cancelled', cancelled_at = now() where id = walk_id;

  raise notice 'PT17 PASSED: every port_status + port_messaging_status value is assignable through the lifecycle';
end $$;

-- ===========================================================================
-- claim_port_slot fixtures (PORTING.md §6): dedicated companies so the mutated
-- phone_numbers rows above don't perturb the count. Starter (1-number) and Pro
-- (2-number) plans + a sole-prop brand, mirroring provisioning.test.sql P1–P8.
-- ===========================================================================
insert into public.companies (id, name, owner_user_id, country, requested_area_code,
                              plan, subscription_status, aup_accepted_at)
values
  ('b5b5b5b5-b5b5-4b5b-8b5b-b5b0c0000001', 'Port Slot Starter',
   'a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5', 'US', '303', 'starter', 'active', now()),
  ('b5b5b5b5-b5b5-4b5b-8b5b-b5b0c0000002', 'Port Slot Pro',
   'a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5', 'US', '303', 'pro', 'active', now()),
  ('b5b5b5b5-b5b5-4b5b-8b5b-b5b0c0000003', 'Port Slot SoleProp',
   'a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5', 'US', '303', 'pro', 'active', now());

insert into public.messaging_registrations (company_id, kind, status, sole_proprietor, data)
values ('b5b5b5b5-b5b5-4b5b-8b5b-b5b0c0000003', 'brand', 'submitted', true, '{}'::jsonb);

-- ===========================================================================
-- PT18. claim_port_slot first claim → 'created', with the PORT shape:
--       source='ported', status='provisioning', porting_status='draft', no
--       requested_area_code (a port buys no inventory).
-- ===========================================================================
do $$
declare
  result jsonb;
begin
  result := public.claim_port_slot(
    'b5b5b5b5-b5b5-4b5b-8b5b-b5b0c0000001', 'port-key-starter-1', 'US', 1);
  if result->>'outcome' <> 'created' then
    raise exception 'PT18 FAILED: expected created, got %', result->>'outcome';
  end if;
  if (result->'number'->>'source') <> 'ported' then
    raise exception 'PT18 FAILED: source is % (want ported)', result->'number'->>'source';
  end if;
  if (result->'number'->>'status') <> 'provisioning' then
    raise exception 'PT18 FAILED: status is % (want provisioning)', result->'number'->>'status';
  end if;
  if (result->'number'->>'porting_status') <> 'draft' then
    raise exception 'PT18 FAILED: porting_status is % (want draft)', result->'number'->>'porting_status';
  end if;
  if (result->'number'->>'requested_area_code') is not null then
    raise exception 'PT18 FAILED: a port row must not carry requested_area_code';
  end if;
  raise notice 'PT18 PASSED: claim_port_slot creates a source=ported/provisioning/draft row';
end $$;

-- ===========================================================================
-- PT19. Idempotent replay: same provisioning key → 'exists', SAME row, no
--       second insert.
-- ===========================================================================
do $$
declare
  first_id uuid;
  result   jsonb;
begin
  select id into first_id from public.phone_numbers where provisioning_key = 'port-key-starter-1';
  result := public.claim_port_slot(
    'b5b5b5b5-b5b5-4b5b-8b5b-b5b0c0000001', 'port-key-starter-1', 'US', 1);
  if result->>'outcome' <> 'exists' then
    raise exception 'PT19 FAILED: expected exists, got %', result->>'outcome';
  end if;
  if (result->'number'->>'id')::uuid <> first_id then
    raise exception 'PT19 FAILED: replay returned a different row';
  end if;
  if (select count(*) from public.phone_numbers
      where company_id = 'b5b5b5b5-b5b5-4b5b-8b5b-b5b0c0000001') <> 1 then
    raise exception 'PT19 FAILED: duplicate key created a second row';
  end if;
  raise notice 'PT19 PASSED: idempotency-key replay returns the same port row';
end $$;

-- ===========================================================================
-- PT20. THE SPEC-AUDIT CASE: a capped company whose sole existing live number is
--       source='provisioned' (the normal path) is blocked from a port. This is
--       both plan_limit (Starter=1) here and sole_prop_cap in PT21 — the port
--       must NOT slip a 2nd number past the cap just because the existing one is
--       provisioned rather than ported.
-- ===========================================================================
do $$
declare
  result jsonb;
begin
  -- The company already holds one active PROVISIONED number (PT18 created a
  -- ported one; make it look like the normal provisioned case for clarity).
  update public.phone_numbers
     set source = 'provisioned', porting_status = null, status = 'active',
         number_e164 = '+13035550303'
   where provisioning_key = 'port-key-starter-1';

  result := public.claim_port_slot(
    'b5b5b5b5-b5b5-4b5b-8b5b-b5b0c0000001', 'port-key-starter-2', 'US', 1);
  if result->>'outcome' <> 'plan_limit' then
    raise exception 'PT20 FAILED: expected plan_limit for a full 1-number company, got %', result->>'outcome';
  end if;
  if (select count(*) from public.phone_numbers
      where company_id = 'b5b5b5b5-b5b5-4b5b-8b5b-b5b0c0000001') <> 1 then
    raise exception 'PT20 FAILED: plan_limit still inserted a row';
  end if;
  raise notice 'PT20 PASSED: a capped company with an active PROVISIONED number cannot start a 2nd-number port';
end $$;

-- ===========================================================================
-- PT21. §4.2 sole-prop cap: a sole-prop company gets exactly 1 number, port or
--       not — the first port is created, a second claim is sole_prop_cap even
--       though the plan allowance (2) is not yet reached.
-- ===========================================================================
do $$
declare
  result jsonb;
begin
  result := public.claim_port_slot(
    'b5b5b5b5-b5b5-4b5b-8b5b-b5b0c0000003', 'port-key-sole-1', 'US', 2);
  if result->>'outcome' <> 'created' then
    raise exception 'PT21 FAILED: sole-prop 1st (port) number, got %', result->>'outcome';
  end if;
  result := public.claim_port_slot(
    'b5b5b5b5-b5b5-4b5b-8b5b-b5b0c0000003', 'port-key-sole-2', 'US', 2);
  if result->>'outcome' <> 'sole_prop_cap' then
    raise exception 'PT21 FAILED: expected sole_prop_cap, got %', result->>'outcome';
  end if;
  raise notice 'PT21 PASSED: sole-prop brands are capped at 1 number on the port path (a port counts as the one)';
end $$;

-- ===========================================================================
-- PT22. Pro allowance (2): a provisioned 1st number + a ported 2nd number is
--       allowed (D16: Pro's 2nd number may be a port); the 3rd is plan_limit.
-- ===========================================================================
do $$
declare
  result jsonb;
begin
  -- Seed an active provisioned first number for the Pro company.
  insert into public.phone_numbers
    (company_id, status, provisioning_key, country, number_e164, source)
  values ('b5b5b5b5-b5b5-4b5b-8b5b-b5b0c0000002', 'active', 'pro-prov-1', 'US',
          '+13035550402', 'provisioned');

  result := public.claim_port_slot(
    'b5b5b5b5-b5b5-4b5b-8b5b-b5b0c0000002', 'port-key-pro-2', 'US', 2);
  if result->>'outcome' <> 'created' then
    raise exception 'PT22 FAILED: Pro 2nd number as a port should be created, got %', result->>'outcome';
  end if;
  result := public.claim_port_slot(
    'b5b5b5b5-b5b5-4b5b-8b5b-b5b0c0000002', 'port-key-pro-3', 'US', 2);
  if result->>'outcome' <> 'plan_limit' then
    raise exception 'PT22 FAILED: Pro 3rd number should hit plan_limit, got %', result->>'outcome';
  end if;
  raise notice 'PT22 PASSED: Pro admits a provisioned+ported pair, blocks the 3rd';
end $$;

-- ===========================================================================
-- PT23. claim_port_slot EXECUTE is service-role-only (SPEC §6 RLS posture),
--       like every RPC in this schema.
-- ===========================================================================
do $$
begin
  if has_function_privilege('anon',
       'public.claim_port_slot(uuid,text,text,int)', 'execute') then
    raise exception 'PT23 FAILED: anon can execute claim_port_slot';
  end if;
  if has_function_privilege('authenticated',
       'public.claim_port_slot(uuid,text,text,int)', 'execute') then
    raise exception 'PT23 FAILED: authenticated can execute claim_port_slot';
  end if;
  if not has_function_privilege('service_role',
       'public.claim_port_slot(uuid,text,text,int)', 'execute') then
    raise exception 'PT23 FAILED: service_role cannot execute claim_port_slot';
  end if;
  raise notice 'PT23 PASSED: claim_port_slot execute is service-role-only';
end $$;

rollback;
