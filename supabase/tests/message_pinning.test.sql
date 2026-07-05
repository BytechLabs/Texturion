-- #3 Pinning — message pin-state schema + set_message_pinned behaviour suite.
--
-- Mirrors done_and_timezone.test.sql. Self-contained fixtures (own auth.users /
-- company / … under a distinct UUID namespace), wrapped in a single
-- transaction that ROLLS BACK, so it never touches committed data and can run
-- against the local database repeatedly.
--
-- Fixtures (all rolled back):
--   owner        = cccccccc-cccc-4ccc-8ccc-cccccccccccc
--   company      = dddddddd-dddd-4ddd-8ddd-dddddddddddd
--   message      = dddddddd-dddd-4ddd-8ddd-ddd000000004
--
-- The suite runs as the postgres superuser, which bypasses the service-role
-- grant on set_message_pinned, so the behavioural outcomes can be asserted
-- directly here (the JS route tests stub the RPC).

begin;

-- ===========================================================================
-- P-1. messages.pinned_at / pinned_by_user_id columns: types + nullability.
-- ===========================================================================
do $$
declare
  pinned_at_type text;
  pinned_at_nullable text;
  pinned_by_type text;
  pinned_by_nullable text;
begin
  select data_type, is_nullable into pinned_at_type, pinned_at_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'messages'
    and column_name = 'pinned_at';
  if pinned_at_type is null then
    raise exception 'P-1 FAILED: messages.pinned_at column missing';
  end if;
  if pinned_at_type <> 'timestamp with time zone' then
    raise exception 'P-1 FAILED: messages.pinned_at is % (want timestamptz)', pinned_at_type;
  end if;
  if pinned_at_nullable <> 'YES' then
    raise exception 'P-1 FAILED: messages.pinned_at must be NULLable';
  end if;

  select data_type, is_nullable into pinned_by_type, pinned_by_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'messages'
    and column_name = 'pinned_by_user_id';
  if pinned_by_type is null then
    raise exception 'P-1 FAILED: messages.pinned_by_user_id column missing';
  end if;
  if pinned_by_type <> 'uuid' then
    raise exception 'P-1 FAILED: messages.pinned_by_user_id is % (want uuid)', pinned_by_type;
  end if;
  if pinned_by_nullable <> 'YES' then
    raise exception 'P-1 FAILED: messages.pinned_by_user_id must be NULLable';
  end if;
  raise notice 'P-1 PASSED: pinned_at timestamptz NULL + pinned_by_user_id uuid NULL';
end $$;

-- ===========================================================================
-- P-2. pinned_by_user_id FK → profiles ON DELETE RESTRICT.
-- ===========================================================================
do $$
declare
  ref_table text;
  del_action text;
begin
  select ccu.table_name, rc.delete_rule into ref_table, del_action
  from information_schema.table_constraints tc
  join information_schema.constraint_column_usage ccu
    on ccu.constraint_name = tc.constraint_name
  join information_schema.referential_constraints rc
    on rc.constraint_name = tc.constraint_name
  where tc.table_schema = 'public' and tc.table_name = 'messages'
    and tc.constraint_type = 'FOREIGN KEY'
    and tc.constraint_name like '%pinned_by%';
  if ref_table is null then
    raise exception 'P-2 FAILED: no FK on messages.pinned_by_user_id';
  end if;
  if ref_table <> 'profiles' then
    raise exception 'P-2 FAILED: pinned_by_user_id references % (want profiles)', ref_table;
  end if;
  if del_action <> 'RESTRICT' then
    raise exception 'P-2 FAILED: pinned_by_user_id delete rule is % (want RESTRICT)', del_action;
  end if;
  raise notice 'P-2 PASSED: pinned_by_user_id FK → profiles ON DELETE RESTRICT';
end $$;

-- ===========================================================================
-- Fixtures for the behavioural tests (rolled back at the end).
-- ===========================================================================
insert into auth.users (id, email, raw_user_meta_data)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'owner@pin.test',
        '{"display_name":"Pin Owner"}'::jsonb);

insert into public.companies (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Pin Test Plumbing',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'CA', '416', now());

insert into public.company_members (company_id, user_id, role)
values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'owner');

insert into public.phone_numbers (id, company_id, status, provisioning_key, country, number_e164)
values ('dddddddd-dddd-4ddd-8ddd-ddd000000001', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        'active', 'cs_test_pin_1', 'CA', '+14165550100');

insert into public.contacts (id, company_id, phone_e164, name)
values ('dddddddd-dddd-4ddd-8ddd-ddd000000002', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        '+14165550111', 'Pin Contact');

insert into public.conversations (id, company_id, contact_id, phone_number_id, status)
values ('dddddddd-dddd-4ddd-8ddd-ddd000000003', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        'dddddddd-dddd-4ddd-8ddd-ddd000000002', 'dddddddd-dddd-4ddd-8ddd-ddd000000001', 'open');

insert into public.messages (id, company_id, conversation_id, direction, body, status)
values ('dddddddd-dddd-4ddd-8ddd-ddd000000004', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        'dddddddd-dddd-4ddd-8ddd-ddd000000003', 'inbound', 'The gate code is 4821', 'received');

-- ===========================================================================
-- P-3. messages_pinned_consistency CHECK: (pinned_at IS NULL) = (pinned_by NULL).
-- ===========================================================================
do $$
begin
  begin
    update public.messages set pinned_at = now(), pinned_by_user_id = null
    where id = 'dddddddd-dddd-4ddd-8ddd-ddd000000004';
    raise exception 'P-3 FAILED: pinned_at set with NULL pinned_by_user_id accepted';
  exception when check_violation then null;
  end;

  begin
    update public.messages
      set pinned_at = null, pinned_by_user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    where id = 'dddddddd-dddd-4ddd-8ddd-ddd000000004';
    raise exception 'P-3 FAILED: pinned_by_user_id set with NULL pinned_at accepted';
  exception when check_violation then null;
  end;

  -- Both together is accepted, then both cleared.
  update public.messages
    set pinned_at = now(), pinned_by_user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  where id = 'dddddddd-dddd-4ddd-8ddd-ddd000000004';
  update public.messages set pinned_at = null, pinned_by_user_id = null
  where id = 'dddddddd-dddd-4ddd-8ddd-ddd000000004';
  raise notice 'P-3 PASSED: messages_pinned_consistency CHECK enforces both-or-neither';
end $$;

-- ===========================================================================
-- P-4. set_message_pinned outcomes: updated / unchanged (idempotent) /
--      not_found, and the pin fields land / clear on the row.
-- ===========================================================================
do $$
declare
  res jsonb;
  v_pinned_at timestamptz;
  v_pinned_by uuid;
begin
  -- Pin → 'updated', fields set.
  res := public.set_message_pinned(
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'dddddddd-dddd-4ddd-8ddd-ddd000000004', true,
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  if res->>'outcome' <> 'updated' then
    raise exception 'P-4 FAILED: pin outcome is % (want updated)', res->>'outcome';
  end if;
  select pinned_at, pinned_by_user_id into v_pinned_at, v_pinned_by
  from public.messages where id = 'dddddddd-dddd-4ddd-8ddd-ddd000000004';
  if v_pinned_at is null or v_pinned_by <> 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' then
    raise exception 'P-4 FAILED: pin did not stamp pinned_at + pinned_by_user_id';
  end if;

  -- Re-pin → idempotent 'unchanged', no write.
  res := public.set_message_pinned(
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'dddddddd-dddd-4ddd-8ddd-ddd000000004', true,
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  if res->>'outcome' <> 'unchanged' then
    raise exception 'P-4 FAILED: re-pin outcome is % (want unchanged)', res->>'outcome';
  end if;

  -- Unpin → 'updated', fields cleared.
  res := public.set_message_pinned(
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'dddddddd-dddd-4ddd-8ddd-ddd000000004', false,
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  if res->>'outcome' <> 'updated' then
    raise exception 'P-4 FAILED: unpin outcome is % (want updated)', res->>'outcome';
  end if;
  select pinned_at, pinned_by_user_id into v_pinned_at, v_pinned_by
  from public.messages where id = 'dddddddd-dddd-4ddd-8ddd-ddd000000004';
  if v_pinned_at is not null or v_pinned_by is not null then
    raise exception 'P-4 FAILED: unpin did not clear the pin fields';
  end if;

  -- Unknown message id (right company) → 'not_found', no exception.
  res := public.set_message_pinned(
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'dddddddd-dddd-4ddd-8ddd-ddd0000000ff', true,
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  if res->>'outcome' <> 'not_found' then
    raise exception 'P-4 FAILED: unknown id outcome is % (want not_found)', res->>'outcome';
  end if;

  -- Wrong company (right message id) → 'not_found' (company-scoped).
  res := public.set_message_pinned(
    'dddddddd-dddd-4ddd-8ddd-ddddddddddde',
    'dddddddd-dddd-4ddd-8ddd-ddd000000004', true,
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  if res->>'outcome' <> 'not_found' then
    raise exception 'P-4 FAILED: cross-company pin outcome is % (want not_found)', res->>'outcome';
  end if;

  raise notice 'P-4 PASSED: set_message_pinned updated/unchanged/not_found + company scope';
end $$;

-- ===========================================================================
-- P-5. The change broadcast fires message.status on a PIN TOGGLE and its
--      payload carries the current pinned fields (SPEC §8 pure cache patch).
-- ===========================================================================
do $$
declare
  before_count int;
  after_count int;
  latest jsonb;
begin
  select count(*) into before_count
  from realtime.messages
  where topic = 'company:dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    and event = 'message.status' and extension = 'broadcast'
    and payload->>'message_id' = 'dddddddd-dddd-4ddd-8ddd-ddd000000004';

  perform public.set_message_pinned(
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'dddddddd-dddd-4ddd-8ddd-ddd000000004', true,
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc');

  select count(*) into after_count
  from realtime.messages
  where topic = 'company:dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    and event = 'message.status' and extension = 'broadcast'
    and payload->>'message_id' = 'dddddddd-dddd-4ddd-8ddd-ddd000000004';

  if after_count <= before_count then
    raise exception 'P-5 FAILED: pin toggle did not emit a message.status broadcast';
  end if;

  select payload into latest
  from realtime.messages
  where topic = 'company:dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    and event = 'message.status' and extension = 'broadcast'
    and payload->>'message_id' = 'dddddddd-dddd-4ddd-8ddd-ddd000000004'
  order by inserted_at desc limit 1;

  if latest->>'pinned_at' is null then
    raise exception 'P-5 FAILED: broadcast payload missing pinned_at after pin';
  end if;
  if latest->>'pinned_by_user_id' <> 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' then
    raise exception 'P-5 FAILED: broadcast payload missing/incorrect pinned_by_user_id';
  end if;
  raise notice 'P-5 PASSED: pin toggle emits message.status carrying the pin fields';
end $$;

rollback;
