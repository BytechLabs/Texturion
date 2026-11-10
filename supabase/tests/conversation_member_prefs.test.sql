-- [#694] Mute and follow: assertion suite for
-- supabase/migrations/20261110110000_a_member_can_mute_or_follow_one_conversation.sql.
--
-- Pins what would fail silently: one row per (conversation, member), a
-- deadline that only exists on a muted row, the workspace purge reaching the
-- table through the conversation, and the table staying closed to browsers.
--
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/conversation_member_prefs.test.sql
--
-- One transaction, rolled back. Fixtures use an 'af' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('af000000-0000-4000-8000-00000000000a'::uuid, 'mute-a@test.local'),
  ('af000000-0000-4000-8000-00000000000b'::uuid, 'mute-b@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('af000000-0000-4000-8000-0000000000c1'::uuid, 'Mute Plumbing',
   'af000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());

insert into public.company_members (company_id, user_id, role) values
  ('af000000-0000-4000-8000-0000000000c1'::uuid,
   'af000000-0000-4000-8000-00000000000a'::uuid, 'owner'),
  ('af000000-0000-4000-8000-0000000000c1'::uuid,
   'af000000-0000-4000-8000-00000000000b'::uuid, 'member');

insert into public.contacts (id, company_id, phone_e164) values
  ('af000000-0000-4000-8000-0000000000d1'::uuid,
   'af000000-0000-4000-8000-0000000000c1'::uuid, '+15555550694');

insert into public.phone_numbers (id, company_id, status, provisioning_key, country)
values
  ('af000000-0000-4000-8000-0000000000b1'::uuid,
   'af000000-0000-4000-8000-0000000000c1'::uuid, 'active', 'af-mute', 'US');

insert into public.conversations (id, company_id, contact_id, phone_number_id) values
  ('af000000-0000-4000-8000-0000000000e1'::uuid,
   'af000000-0000-4000-8000-0000000000c1'::uuid,
   'af000000-0000-4000-8000-0000000000d1'::uuid,
   'af000000-0000-4000-8000-0000000000b1'::uuid);

-- ===========================================================================
-- MF-1. Mute is PER MEMBER: member B does not inherit member A's row.
-- ===========================================================================
do $$
declare
  v_a boolean;
  v_b boolean;
begin
  insert into public.conversation_member_prefs
    (company_id, conversation_id, user_id, muted, muted_until)
  values
    ('af000000-0000-4000-8000-0000000000c1'::uuid,
     'af000000-0000-4000-8000-0000000000e1'::uuid,
     'af000000-0000-4000-8000-00000000000a'::uuid, true, null);

  select muted into v_a from public.conversation_member_prefs
   where user_id = 'af000000-0000-4000-8000-00000000000a'::uuid;
  select muted into v_b from public.conversation_member_prefs
   where user_id = 'af000000-0000-4000-8000-00000000000b'::uuid;
  if v_a is distinct from true then
    raise exception 'MF-1 FAILED: the muting member has no muted row';
  end if;
  if v_b is not null then
    raise exception 'MF-1 FAILED: member B inherited member A mute';
  end if;
  raise notice 'MF-1 PASSED: mute is per member';
end $$;

-- ===========================================================================
-- MF-2. One row per (conversation, member): a second insert conflicts.
-- ===========================================================================
do $$
begin
  begin
    insert into public.conversation_member_prefs
      (company_id, conversation_id, user_id, followed)
    values
      ('af000000-0000-4000-8000-0000000000c1'::uuid,
       'af000000-0000-4000-8000-0000000000e1'::uuid,
       'af000000-0000-4000-8000-00000000000a'::uuid, true);
    raise exception 'MF-2 FAILED: a duplicate (conversation, member) row was accepted';
  exception when unique_violation then
    null;
  end;
  raise notice 'MF-2 PASSED: one row per conversation and member';
end $$;

-- ===========================================================================
-- MF-3. A deadline without a mute is refused.
-- ===========================================================================
do $$
begin
  begin
    insert into public.conversation_member_prefs
      (company_id, conversation_id, user_id, muted, muted_until)
    values
      ('af000000-0000-4000-8000-0000000000c1'::uuid,
       'af000000-0000-4000-8000-0000000000e1'::uuid,
       'af000000-0000-4000-8000-00000000000b'::uuid, false, now() + interval '1 hour');
    raise exception 'MF-3 FAILED: muted_until accepted on an unmuted row';
  exception when check_violation then
    null;
  end;
  raise notice 'MF-3 PASSED: a deadline needs a mute';
end $$;

-- ===========================================================================
-- MF-4. Deleting the conversation takes the rows with it, which is how the
--       workspace purge reaches this table.
-- ===========================================================================
do $$
declare
  v_left integer;
begin
  delete from public.conversations
   where id = 'af000000-0000-4000-8000-0000000000e1'::uuid;
  select count(*) into v_left from public.conversation_member_prefs
   where conversation_id = 'af000000-0000-4000-8000-0000000000e1'::uuid;
  if v_left <> 0 then
    raise exception 'MF-4 FAILED: % pref row(s) outlived their conversation', v_left;
  end if;
  raise notice 'MF-4 PASSED: rows cascade with the conversation';
end $$;

-- ===========================================================================
-- MF-5. Closed to browsers: RLS on, no grants to anon or authenticated.
-- ===========================================================================
do $$
begin
  if not (select relrowsecurity from pg_class
           where oid = 'public.conversation_member_prefs'::regclass) then
    raise exception 'MF-5 FAILED: RLS is off';
  end if;
  if has_table_privilege('anon', 'public.conversation_member_prefs', 'SELECT')
     or has_table_privilege('authenticated', 'public.conversation_member_prefs', 'SELECT') then
    raise exception 'MF-5 FAILED: a browser role can read the table';
  end if;
  if not has_table_privilege('service_role', 'public.conversation_member_prefs', 'DELETE') then
    raise exception 'MF-5 FAILED: the Worker cannot write the table';
  end if;
  raise notice 'MF-5 PASSED: deny-by-default, service_role only';
end $$;

rollback;
