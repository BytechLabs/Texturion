-- #3 Pinning — conversation pin-state schema suite. Mirrors the schema half of
-- message_pinning.test.sql (there is no RPC — pinning a conversation is a
-- direct UPDATE via the PATCH route, like status/spam/assign). Self-contained
-- fixtures under a distinct UUID namespace, wrapped in a rolled-back txn.

begin;

-- ===========================================================================
-- C-1. conversations.pinned_at / pinned_by_user_id columns: types + nullability.
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
  where table_schema = 'public' and table_name = 'conversations'
    and column_name = 'pinned_at';
  if pinned_at_type is null then
    raise exception 'C-1 FAILED: conversations.pinned_at column missing';
  end if;
  if pinned_at_type <> 'timestamp with time zone' then
    raise exception 'C-1 FAILED: conversations.pinned_at is % (want timestamptz)', pinned_at_type;
  end if;
  if pinned_at_nullable <> 'YES' then
    raise exception 'C-1 FAILED: conversations.pinned_at must be NULLable';
  end if;

  select data_type, is_nullable into pinned_by_type, pinned_by_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'conversations'
    and column_name = 'pinned_by_user_id';
  if pinned_by_type is null then
    raise exception 'C-1 FAILED: conversations.pinned_by_user_id column missing';
  end if;
  if pinned_by_type <> 'uuid' then
    raise exception 'C-1 FAILED: conversations.pinned_by_user_id is % (want uuid)', pinned_by_type;
  end if;
  if pinned_by_nullable <> 'YES' then
    raise exception 'C-1 FAILED: conversations.pinned_by_user_id must be NULLable';
  end if;
  raise notice 'C-1 PASSED: pinned_at timestamptz NULL + pinned_by_user_id uuid NULL';
end $$;

-- ===========================================================================
-- C-2. pinned_by_user_id FK → profiles ON DELETE RESTRICT.
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
  where tc.table_schema = 'public' and tc.table_name = 'conversations'
    and tc.constraint_type = 'FOREIGN KEY'
    and tc.constraint_name like '%pinned_by%';
  if ref_table is null then
    raise exception 'C-2 FAILED: no FK on conversations.pinned_by_user_id';
  end if;
  if ref_table <> 'profiles' then
    raise exception 'C-2 FAILED: pinned_by_user_id references % (want profiles)', ref_table;
  end if;
  if del_action <> 'RESTRICT' then
    raise exception 'C-2 FAILED: pinned_by_user_id delete rule is % (want RESTRICT)', del_action;
  end if;
  raise notice 'C-2 PASSED: pinned_by_user_id FK → profiles ON DELETE RESTRICT';
end $$;

-- ===========================================================================
-- Fixtures for the CHECK test (rolled back).
-- ===========================================================================
insert into auth.users (id, email, raw_user_meta_data)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'owner@convpin.test',
        '{"display_name":"Conv Pin Owner"}'::jsonb);

insert into public.companies (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc', 'Conv Pin Plumbing',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'CA', '416', now());

insert into public.company_members (company_id, user_id, role)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'owner');

insert into public.phone_numbers (id, company_id, status, provisioning_key, country, number_e164)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbb000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc',
        'active', 'cs_test_convpin_1', 'CA', '+14165550100');

insert into public.contacts (id, company_id, phone_e164, name)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbb000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc',
        '+14165550111', 'Conv Pin Contact');

insert into public.conversations (id, company_id, contact_id, phone_number_id, status)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbb000000003', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbb000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbb000000001', 'open');

-- ===========================================================================
-- C-3. conversations_pinned_consistency CHECK: (pinned_at NULL) = (pinned_by NULL).
-- ===========================================================================
do $$
begin
  begin
    update public.conversations set pinned_at = now(), pinned_by_user_id = null
    where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbb000000003';
    raise exception 'C-3 FAILED: pinned_at set with NULL pinned_by_user_id accepted';
  exception when check_violation then null;
  end;

  begin
    update public.conversations
      set pinned_at = null, pinned_by_user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbb000000003';
    raise exception 'C-3 FAILED: pinned_by_user_id set with NULL pinned_at accepted';
  exception when check_violation then null;
  end;

  -- Both together accepted (pin), then both cleared (unpin).
  update public.conversations
    set pinned_at = now(), pinned_by_user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbb000000003';
  update public.conversations set pinned_at = null, pinned_by_user_id = null
  where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbb000000003';
  raise notice 'C-3 PASSED: conversations_pinned_consistency CHECK enforces both-or-neither';
end $$;

rollback;
