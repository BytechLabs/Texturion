-- D14 (message done state) + D15 (company timezone) schema assertion suite.
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/tests/done_and_timezone.test.sql
-- The whole suite runs in one transaction and ROLLS BACK — it never pollutes
-- the local database. Self-contained fixtures (own auth.users/company/etc.), so
-- the file can run standalone or after the other suites without id collisions.
--
-- NOTE: psql :vars are NOT interpolated inside dollar-quoted DO blocks (the
-- server receives the body verbatim), so the fixture ids are written as literal
-- UUIDs throughout. Distinct e/f prefixes avoid the a–d fixtures the other
-- suites reuse when the whole DB is exercised in one session.
--   owner   = eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee
--   company = ffffffff-ffff-4fff-8fff-ffffffffffff
--   number  = ffffffff-ffff-4fff-8fff-fff000000001
--   contact = ffffffff-ffff-4fff-8fff-fff000000002
--   conv    = ffffffff-ffff-4fff-8fff-fff000000003
--   message = ffffffff-ffff-4fff-8fff-fff000000004

\set ON_ERROR_STOP on

begin;

-- ===========================================================================
-- D14-1. messages.done_at / done_by_user_id columns: types + nullability.
-- ===========================================================================
do $$
declare
  done_at_type text;
  done_at_null boolean;
  done_by_type text;
  done_by_null boolean;
begin
  select data_type, is_nullable = 'YES'
    into done_at_type, done_at_null
  from information_schema.columns
  where table_schema = 'public' and table_name = 'messages'
    and column_name = 'done_at';
  if done_at_type is null then
    raise exception 'D14-1 FAILED: messages.done_at column missing';
  end if;
  if done_at_type <> 'timestamp with time zone' then
    raise exception 'D14-1 FAILED: messages.done_at is % (want timestamptz)', done_at_type;
  end if;
  if not done_at_null then
    raise exception 'D14-1 FAILED: messages.done_at must be NULLable';
  end if;

  select data_type, is_nullable = 'YES'
    into done_by_type, done_by_null
  from information_schema.columns
  where table_schema = 'public' and table_name = 'messages'
    and column_name = 'done_by_user_id';
  if done_by_type is null then
    raise exception 'D14-1 FAILED: messages.done_by_user_id column missing';
  end if;
  if done_by_type <> 'uuid' then
    raise exception 'D14-1 FAILED: messages.done_by_user_id is % (want uuid)', done_by_type;
  end if;
  if not done_by_null then
    raise exception 'D14-1 FAILED: messages.done_by_user_id must be NULLable';
  end if;
  raise notice 'D14-1 PASSED: done_at timestamptz NULL + done_by_user_id uuid NULL';
end $$;

-- ===========================================================================
-- D14-2. done_by_user_id FK → profiles(user_id) with ON DELETE RESTRICT.
-- ===========================================================================
do $$
declare
  ref_table  text;
  del_action text;
begin
  select ccu.table_name, rc.delete_rule
    into ref_table, del_action
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on kcu.constraint_name = tc.constraint_name
   and kcu.constraint_schema = tc.constraint_schema
  join information_schema.referential_constraints rc
    on rc.constraint_name = tc.constraint_name
   and rc.constraint_schema = tc.constraint_schema
  join information_schema.constraint_column_usage ccu
    on ccu.constraint_name = tc.constraint_name
   and ccu.constraint_schema = tc.constraint_schema
  where tc.table_schema = 'public' and tc.table_name = 'messages'
    and tc.constraint_type = 'FOREIGN KEY'
    and kcu.column_name = 'done_by_user_id';

  if ref_table is null then
    raise exception 'D14-2 FAILED: no FK on messages.done_by_user_id';
  end if;
  if ref_table <> 'profiles' then
    raise exception 'D14-2 FAILED: done_by_user_id references % (want profiles)', ref_table;
  end if;
  -- information_schema spells ON DELETE RESTRICT as 'RESTRICT'.
  if del_action <> 'RESTRICT' then
    raise exception 'D14-2 FAILED: done_by_user_id delete rule is % (want RESTRICT)', del_action;
  end if;
  raise notice 'D14-2 PASSED: done_by_user_id FK → profiles ON DELETE RESTRICT';
end $$;

-- ===========================================================================
-- Fixtures for the behavioural D14/D15 tests (rolled back at the end).
-- ===========================================================================
insert into auth.users (id, email, raw_user_meta_data)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'owner@done.test',
        '{"display_name":"Done Owner"}'::jsonb);

-- D15-1 is asserted against this INSERT: timezone omitted → DB default applies.
insert into public.companies (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'Done Test Plumbing',
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'CA', '416', now());

insert into public.company_members (company_id, user_id, role)
values ('ffffffff-ffff-4fff-8fff-ffffffffffff',
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'owner');

insert into public.phone_numbers (id, company_id, status, provisioning_key, country, number_e164)
values ('ffffffff-ffff-4fff-8fff-fff000000001', 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        'active', 'cs_test_done_1', 'CA', '+14165550100');

insert into public.contacts (id, company_id, phone_e164, name)
values ('ffffffff-ffff-4fff-8fff-fff000000002', 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        '+14165550111', 'Done Contact');

insert into public.conversations (id, company_id, contact_id, phone_number_id, status)
values ('ffffffff-ffff-4fff-8fff-fff000000003', 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        'ffffffff-ffff-4fff-8fff-fff000000002', 'ffffffff-ffff-4fff-8fff-fff000000001', 'open');

insert into public.messages (id, company_id, conversation_id, direction, body, status)
values ('ffffffff-ffff-4fff-8fff-fff000000004', 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        'ffffffff-ffff-4fff-8fff-fff000000003', 'inbound', 'Fix the leaky tap', 'received');

-- ===========================================================================
-- D14-3. messages_done_consistency CHECK: (done_at IS NULL) = (done_by IS NULL).
--        You cannot stamp one without the other.
-- ===========================================================================
do $$
begin
  -- done_at set but done_by NULL → rejected
  begin
    update public.messages set done_at = now(), done_by_user_id = null
    where id = 'ffffffff-ffff-4fff-8fff-fff000000004';
    raise exception 'D14-3 FAILED: done_at set with NULL done_by_user_id accepted';
  exception when check_violation then
    null;
  end;

  -- done_by set but done_at NULL → rejected
  begin
    update public.messages
      set done_at = null, done_by_user_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    where id = 'ffffffff-ffff-4fff-8fff-fff000000004';
    raise exception 'D14-3 FAILED: done_by_user_id set with NULL done_at accepted';
  exception when check_violation then
    null;
  end;

  -- both set together → accepted
  update public.messages
    set done_at = now(), done_by_user_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  where id = 'ffffffff-ffff-4fff-8fff-fff000000004';
  -- both cleared together → accepted
  update public.messages set done_at = null, done_by_user_id = null
  where id = 'ffffffff-ffff-4fff-8fff-fff000000004';
  raise notice 'D14-3 PASSED: messages_done_consistency CHECK enforces both-or-neither';
end $$;

-- ===========================================================================
-- D14-4. FK is enforced: an unknown done_by_user_id is rejected.
-- ===========================================================================
do $$
begin
  begin
    update public.messages
      set done_at = now(),
          done_by_user_id = '00000000-0000-4000-8000-000000000000'
    where id = 'ffffffff-ffff-4fff-8fff-fff000000004';
    raise exception 'D14-4 FAILED: unknown done_by_user_id accepted';
  exception when foreign_key_violation then
    null;
  end;
  -- reset to not-done for the broadcast test below
  update public.messages set done_at = null, done_by_user_id = null
  where id = 'ffffffff-ffff-4fff-8fff-fff000000004';
  raise notice 'D14-4 PASSED: done_by_user_id FK rejects unknown profiles';
end $$;

-- ===========================================================================
-- D14-5. The message-update broadcast fires message.status on a DONE TOGGLE
--        even when status is UNCHANGED — the whole point of the D14 trigger
--        replacement (the original fired only on status changes). The payload
--        carries the current done fields so clients patch caches without a
--        refetch (SPEC §8).
-- ===========================================================================
-- The exactly-one-new-row technique: snapshot the broadcast row ids before an
-- update, then read the single row whose id is new. realtime.messages has no
-- monotonic sequence and inserted_at ties within a statement, so "order by …
-- limit 1" cannot deterministically pick the newest of same-txn rows — the new
-- id is the only reliable key.
do $$
declare
  before_ids   uuid[];
  new_count    int;
  new_payload  jsonb;
begin
  select coalesce(array_agg(id), '{}') into before_ids
  from realtime.messages
  where topic = 'company:ffffffff-ffff-4fff-8fff-ffffffffffff'
    and event = 'message.status' and extension = 'broadcast'
    and payload->>'message_id' = 'ffffffff-ffff-4fff-8fff-fff000000004';

  -- Toggle DONE without touching status (status stays 'received').
  update public.messages
    set done_at = now(), done_by_user_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  where id = 'ffffffff-ffff-4fff-8fff-fff000000004';

  select count(*) into new_count
  from realtime.messages
  where topic = 'company:ffffffff-ffff-4fff-8fff-ffffffffffff'
    and event = 'message.status' and extension = 'broadcast'
    and payload->>'message_id' = 'ffffffff-ffff-4fff-8fff-fff000000004'
    and id <> all (before_ids);

  if new_count <> 1 then
    raise exception 'D14-5 FAILED: done toggle emitted % new message.status broadcasts (want 1)', new_count;
  end if;

  select payload into new_payload
  from realtime.messages
  where topic = 'company:ffffffff-ffff-4fff-8fff-ffffffffffff'
    and event = 'message.status' and extension = 'broadcast'
    and payload->>'message_id' = 'ffffffff-ffff-4fff-8fff-fff000000004'
    and id <> all (before_ids);

  if new_payload->>'done_at' is null then
    raise exception 'D14-5 FAILED: broadcast payload missing done_at (payload=%)', new_payload;
  end if;
  if new_payload->>'done_by_user_id'
       is distinct from 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' then
    raise exception 'D14-5 FAILED: broadcast payload done_by_user_id wrong (payload=%)', new_payload;
  end if;
  -- status is still present and unchanged.
  if new_payload->>'status' <> 'received' then
    raise exception 'D14-5 FAILED: broadcast payload status changed (payload=%)', new_payload;
  end if;
  raise notice 'D14-5 PASSED: done toggle broadcasts message.status with done fields (status unchanged)';
end $$;

-- ===========================================================================
-- D14-6. Clearing done also broadcasts, with the done fields back to null.
-- ===========================================================================
do $$
declare
  before_ids  uuid[];
  new_count   int;
  new_payload jsonb;
begin
  select coalesce(array_agg(id), '{}') into before_ids
  from realtime.messages
  where topic = 'company:ffffffff-ffff-4fff-8fff-ffffffffffff'
    and event = 'message.status' and extension = 'broadcast'
    and payload->>'message_id' = 'ffffffff-ffff-4fff-8fff-fff000000004';

  update public.messages set done_at = null, done_by_user_id = null
  where id = 'ffffffff-ffff-4fff-8fff-fff000000004';

  select count(*) into new_count
  from realtime.messages
  where topic = 'company:ffffffff-ffff-4fff-8fff-ffffffffffff'
    and event = 'message.status' and extension = 'broadcast'
    and payload->>'message_id' = 'ffffffff-ffff-4fff-8fff-fff000000004'
    and id <> all (before_ids);

  if new_count <> 1 then
    raise exception 'D14-6 FAILED: clearing done emitted % new message.status broadcasts (want 1)', new_count;
  end if;

  select payload into new_payload
  from realtime.messages
  where topic = 'company:ffffffff-ffff-4fff-8fff-ffffffffffff'
    and event = 'message.status' and extension = 'broadcast'
    and payload->>'message_id' = 'ffffffff-ffff-4fff-8fff-fff000000004'
    and id <> all (before_ids);

  if new_payload->'done_at' is distinct from 'null'::jsonb then
    raise exception 'D14-6 FAILED: cleared-done payload done_at not null (payload=%)', new_payload;
  end if;
  if new_payload->'done_by_user_id' is distinct from 'null'::jsonb then
    raise exception 'D14-6 FAILED: cleared-done payload done_by_user_id not null (payload=%)', new_payload;
  end if;
  raise notice 'D14-6 PASSED: clearing done broadcasts with done fields null';
end $$;

-- ===========================================================================
-- D14-7. A pure UPDATE that changes NEITHER status NOR done fields does NOT
--        add a message.status broadcast (no spurious realtime traffic).
-- ===========================================================================
do $$
declare
  before_n int;
  after_n  int;
begin
  select count(*) into before_n
  from realtime.messages
  where topic = 'company:ffffffff-ffff-4fff-8fff-ffffffffffff'
    and event = 'message.status'
    and payload->>'message_id' = 'ffffffff-ffff-4fff-8fff-fff000000004';

  -- Touch only the body; status + done fields untouched.
  update public.messages set body = 'Fix the leaky tap today'
  where id = 'ffffffff-ffff-4fff-8fff-fff000000004';

  select count(*) into after_n
  from realtime.messages
  where topic = 'company:ffffffff-ffff-4fff-8fff-ffffffffffff'
    and event = 'message.status'
    and payload->>'message_id' = 'ffffffff-ffff-4fff-8fff-fff000000004';

  if after_n <> before_n then
    raise exception 'D14-7 FAILED: body-only update spuriously broadcast message.status';
  end if;
  raise notice 'D14-7 PASSED: no message.status broadcast when status/done unchanged';
end $$;

-- ===========================================================================
-- D15-1. companies.timezone: text, NOT NULL, DEFAULT 'America/Toronto' — and
--        the fixture company (inserted WITHOUT timezone) got the default.
-- ===========================================================================
do $$
declare
  tz_type    text;
  tz_null    boolean;
  tz_default text;
  fixture_tz text;
begin
  select data_type, is_nullable = 'YES', column_default
    into tz_type, tz_null, tz_default
  from information_schema.columns
  where table_schema = 'public' and table_name = 'companies'
    and column_name = 'timezone';

  if tz_type is null then
    raise exception 'D15-1 FAILED: companies.timezone column missing';
  end if;
  if tz_type <> 'text' then
    raise exception 'D15-1 FAILED: companies.timezone is % (want text)', tz_type;
  end if;
  if tz_null then
    raise exception 'D15-1 FAILED: companies.timezone must be NOT NULL';
  end if;
  if tz_default is null or tz_default not like '%America/Toronto%' then
    raise exception 'D15-1 FAILED: companies.timezone default is % (want America/Toronto)', tz_default;
  end if;

  select timezone into fixture_tz from public.companies
  where id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  if fixture_tz <> 'America/Toronto' then
    raise exception 'D15-1 FAILED: fixture company timezone is % (want default America/Toronto)', fixture_tz;
  end if;
  raise notice 'D15-1 PASSED: companies.timezone text NOT NULL default America/Toronto (applied on insert)';
end $$;

-- ===========================================================================
-- D15-2. api_create_company grows p_timezone (6-arg signature): the value is
--        persisted; omitting it falls back to the default. The old 5-arg
--        overload is gone (would make PostgREST RPC dispatch ambiguous).
-- ===========================================================================
do $$
declare
  fn_count  int;
  arg_count int;
  created   jsonb;
  persisted text;
begin
  -- Exactly one api_create_company function, and it takes 6 args.
  select count(*) into fn_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'api_create_company';
  if fn_count <> 1 then
    raise exception 'D15-2 FAILED: expected 1 api_create_company overload, found %', fn_count;
  end if;

  select p.pronargs into arg_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'api_create_company';
  if arg_count <> 6 then
    raise exception 'D15-2 FAILED: api_create_company takes % args (want 6 incl. p_timezone)', arg_count;
  end if;

  -- Explicit timezone is persisted.
  created := public.api_create_company(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'TZ Explicit Co', 'CA', '604', true,
    'America/Vancouver');
  select timezone into persisted
  from public.companies where id = (created->>'id')::uuid;
  if persisted <> 'America/Vancouver' then
    raise exception 'D15-2 FAILED: explicit p_timezone not persisted (got %)', persisted;
  end if;

  -- Omitted timezone → default (call the 5-value form; p_timezone defaults).
  created := public.api_create_company(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'TZ Default Co', 'CA', '604', true);
  select timezone into persisted
  from public.companies where id = (created->>'id')::uuid;
  if persisted <> 'America/Toronto' then
    raise exception 'D15-2 FAILED: omitted p_timezone did not default (got %)', persisted;
  end if;
  raise notice 'D15-2 PASSED: api_create_company(6-arg) persists p_timezone; omitted → default';
end $$;

rollback;
