-- JobText API route-function assertion suite (SPEC §7 — migration
-- 20260701010000_api_route_functions.sql).
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_JobText psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/api_functions.test.sql
-- The whole suite runs in one transaction and ROLLS BACK: it never pollutes
-- the local database.

\set ON_ERROR_STOP on

begin;

-- Seed: two users (owner + member) — the auth trigger syncs profiles.
insert into auth.users (id, email, raw_user_meta_data)
values
  ('11111111-1111-4111-8111-111111111111', 'owner@apifn.test',
   '{"display_name":"Owner"}'::jsonb),
  ('22222222-2222-4222-8222-222222222222', 'member@apifn.test',
   '{"display_name":"Member"}'::jsonb);

-- ===========================================================================
-- F1. api_create_company: company + owner membership + 4 pre-seeded pipeline
--     tags + notification_prefs, atomically; aup_accepted_at stamped;
--     returns the company as jsonb.
-- ===========================================================================
do $$
declare
  result jsonb;
  cid uuid;
  n int;
begin
  result := public.api_create_company(
    '11111111-1111-4111-8111-111111111111', 'Acme Plumbing', 'US', '212', true);
  cid := (result->>'id')::uuid;

  if result->>'name' <> 'Acme Plumbing'
     or result->>'subscription_status' <> 'incomplete'
     or result->>'requested_area_code' <> '212'
     or (result->>'aup_accepted_at') is null then
    raise exception 'F1 FAILED: returned company jsonb wrong: %', result;
  end if;

  select count(*) into n from public.company_members
  where company_id = cid
    and user_id = '11111111-1111-4111-8111-111111111111'
    and role = 'owner' and deactivated_at is null;
  if n <> 1 then
    raise exception 'F1 FAILED: owner membership missing';
  end if;

  select count(*) into n from public.tags where company_id = cid
    and name in ('Quote sent','Scheduled','Won','Lost');
  if n <> 4 then
    raise exception 'F1 FAILED: expected 4 pre-seeded pipeline tags, got %', n;
  end if;

  select count(*) into n from public.notification_prefs
  where company_id = cid
    and user_id = '11111111-1111-4111-8111-111111111111'
    and email_enabled and push_enabled;
  if n <> 1 then
    raise exception 'F1 FAILED: notification_prefs row missing';
  end if;

  raise notice 'F1 PASSED: api_create_company creates company + membership + tags + prefs';
end $$;

-- Shared fixtures for F2–F4: a company with a number, contacts,
-- conversations, messages, reads, tags.
do $$
declare
  cid uuid;
  num uuid;
  ct_jo uuid;   -- "Jo Smith"
  ct_al uuid;   -- "Alex Doe"
  cv1 uuid;     -- newest, tagged, unread for member
  cv2 uuid;     -- older, read by member
  cv3 uuid;     -- spam
  tag uuid;
begin
  cid := (public.api_create_company(
    '11111111-1111-4111-8111-111111111111', 'Fixture Co', 'US', '212', true)
    ->>'id')::uuid;

  insert into public.phone_numbers (company_id, status, provisioning_key, country, number_e164)
  values (cid, 'active', 'fixture-key', 'US', '+12125550000')
  returning id into num;

  insert into public.contacts (company_id, phone_e164, name)
  values (cid, '+14165550101', 'Jo Smith') returning id into ct_jo;
  insert into public.contacts (company_id, phone_e164, name)
  values (cid, '+12125550102', 'Alex Doe') returning id into ct_al;
  -- soft-deleted contact: must not appear in search
  insert into public.contacts (company_id, phone_e164, name, deleted_at)
  values (cid, '+12125550103', 'Jo Deleted', now());

  insert into public.conversations
    (company_id, contact_id, phone_number_id, status, assigned_user_id, last_message_at)
  values (cid, ct_jo, num, 'open', '22222222-2222-4222-8222-222222222222',
          '2026-07-01T12:00:00Z')
  returning id into cv1;
  insert into public.conversations
    (company_id, contact_id, phone_number_id, status, last_message_at, closed_at)
  values (cid, ct_al, num, 'closed', '2026-07-01T11:00:00Z', now())
  returning id into cv2;
  insert into public.conversations
    (company_id, contact_id, phone_number_id, status, is_spam, last_message_at, closed_at)
  values (cid, ct_al, num, 'closed', true, '2026-07-01T10:00:00Z', now())
  returning id into cv3;

  insert into public.tags (company_id, name) values (cid, 'Hot lead')
  returning id into tag;
  insert into public.conversation_tags (conversation_id, tag_id) values (cv1, tag);

  -- member read cv2 after its last message; never read cv1
  insert into public.conversation_reads (conversation_id, user_id, last_read_at)
  values (cv2, '22222222-2222-4222-8222-222222222222', '2026-07-01T11:30:00Z');

  insert into public.messages
    (company_id, conversation_id, direction, body, status, sent_by_user_id, created_at)
  values
    (cid, cv1, 'inbound',  'Can you send the quote for the fence repair?', 'received', null, '2026-07-01T11:55:00Z'),
    (cid, cv1, 'outbound', 'Quote attached, let me know!', 'delivered',
     '11111111-1111-4111-8111-111111111111',                                                 '2026-07-01T12:00:00Z'),
    (cid, cv2, 'inbound',  'What time tomorrow works for the estimate?', 'received', null,   '2026-07-01T11:00:00Z');

  -- usage events: 2 in period, 1 before period start
  insert into public.usage_events (company_id, type, quantity, created_at)
  values
    (cid, 'sms_outbound', 3, '2026-07-01T12:00:00Z'),
    (cid, 'mms_outbound', 3, '2026-07-02T12:00:00Z'),
    (cid, 'sms_outbound', 7, '2026-06-01T12:00:00Z');

  create temporary table fixture as
  select cid, num, ct_jo, ct_al, cv1, cv2, cv3, tag;
end $$;

-- ===========================================================================
-- F2. api_list_conversations: ordering, filters (status / assigned / tag /
--     unread / q), spam exclusion by default, keyset cursor.
-- ===========================================================================
do $$
declare
  f record;
  rows jsonb[];
  r jsonb;
begin
  select * into f from fixture;

  -- default: spam excluded, newest first, unread flag per caller
  rows := array(select public.api_list_conversations(
    f.cid, '22222222-2222-4222-8222-222222222222', 10));
  if array_length(rows, 1) <> 2 then
    raise exception 'F2 FAILED: expected 2 non-spam conversations, got %', array_length(rows, 1);
  end if;
  if (rows[1]->>'id')::uuid <> f.cv1 or (rows[2]->>'id')::uuid <> f.cv2 then
    raise exception 'F2 FAILED: wrong order: % %', rows[1]->>'id', rows[2]->>'id';
  end if;
  if (rows[1]->>'unread')::boolean is distinct from true
     or (rows[2]->>'unread')::boolean is distinct from false then
    raise exception 'F2 FAILED: unread flags wrong: % %', rows[1]->>'unread', rows[2]->>'unread';
  end if;
  if rows[1]->'contact'->>'name' <> 'Jo Smith' then
    raise exception 'F2 FAILED: embedded contact wrong: %', rows[1]->'contact';
  end if;
  if rows[1]->'tags'->0->>'name' <> 'Hot lead' then
    raise exception 'F2 FAILED: embedded tags wrong: %', rows[1]->'tags';
  end if;
  if rows[1] ? 'last_notified_at' then
    raise exception 'F2 FAILED: internal last_notified_at leaked';
  end if;

  -- is_spam=true: only the spam thread
  rows := array(select public.api_list_conversations(
    f.cid, '22222222-2222-4222-8222-222222222222', 10, p_is_spam => true));
  if array_length(rows, 1) <> 1 or (rows[1]->>'id')::uuid <> f.cv3 then
    raise exception 'F2 FAILED: is_spam filter wrong';
  end if;

  -- status filter
  rows := array(select public.api_list_conversations(
    f.cid, '22222222-2222-4222-8222-222222222222', 10, p_status => 'open'));
  if array_length(rows, 1) <> 1 or (rows[1]->>'id')::uuid <> f.cv1 then
    raise exception 'F2 FAILED: status filter wrong';
  end if;

  -- assigned filter
  rows := array(select public.api_list_conversations(
    f.cid, '22222222-2222-4222-8222-222222222222', 10,
    p_assigned_user_id => '22222222-2222-4222-8222-222222222222'));
  if array_length(rows, 1) <> 1 or (rows[1]->>'id')::uuid <> f.cv1 then
    raise exception 'F2 FAILED: assigned filter wrong';
  end if;

  -- tag filter
  rows := array(select public.api_list_conversations(
    f.cid, '22222222-2222-4222-8222-222222222222', 10, p_tag_id => f.tag));
  if array_length(rows, 1) <> 1 or (rows[1]->>'id')::uuid <> f.cv1 then
    raise exception 'F2 FAILED: tag filter wrong';
  end if;

  -- unread filter: cv2 was read after its last message → only cv1
  rows := array(select public.api_list_conversations(
    f.cid, '22222222-2222-4222-8222-222222222222', 10, p_unread => true));
  if array_length(rows, 1) <> 1 or (rows[1]->>'id')::uuid <> f.cv1 then
    raise exception 'F2 FAILED: unread filter wrong';
  end if;

  -- q: partial contact name and partial phone
  rows := array(select public.api_list_conversations(
    f.cid, '22222222-2222-4222-8222-222222222222', 10, p_q => 'smi'));
  if array_length(rows, 1) <> 1 or (rows[1]->>'id')::uuid <> f.cv1 then
    raise exception 'F2 FAILED: q name filter wrong';
  end if;
  rows := array(select public.api_list_conversations(
    f.cid, '22222222-2222-4222-8222-222222222222', 10, p_q => '555010'));
  if array_length(rows, 1) <> 2 then
    raise exception 'F2 FAILED: q phone filter wrong (got %)', array_length(rows, 1);
  end if;

  -- keyset cursor: page 1 (limit 1) then page 2 from its sort key
  rows := array(select public.api_list_conversations(
    f.cid, '22222222-2222-4222-8222-222222222222', 1));
  if array_length(rows, 1) <> 1 or (rows[1]->>'id')::uuid <> f.cv1 then
    raise exception 'F2 FAILED: cursor page 1 wrong';
  end if;
  rows := array(select public.api_list_conversations(
    f.cid, '22222222-2222-4222-8222-222222222222', 10,
    p_cursor_ts => (rows[1]->>'last_message_at')::timestamptz,
    p_cursor_id => (rows[1]->>'id')::uuid));
  if array_length(rows, 1) <> 1 or (rows[1]->>'id')::uuid <> f.cv2 then
    raise exception 'F2 FAILED: cursor page 2 wrong';
  end if;

  -- tenant isolation: another company id sees nothing
  rows := array(select public.api_list_conversations(
    gen_random_uuid(), '22222222-2222-4222-8222-222222222222', 10));
  if coalesce(array_length(rows, 1), 0) <> 0 then
    raise exception 'F2 FAILED: cross-tenant leak';
  end if;

  raise notice 'F2 PASSED: api_list_conversations filters, ordering, cursor, unread';
end $$;

-- ===========================================================================
-- F3. api_search: message FTS grouped by conversation with snippet; contacts
--     via partial name / partial phone / misspelling similarity; soft-deleted
--     contacts excluded; cursor pagination of conversation hits.
-- ===========================================================================
do $$
declare
  f record;
  result jsonb;
begin
  select * into f from fixture;

  -- FTS: "quote" matches two messages in cv1 → ONE grouped hit, newest
  -- matching message wins, snippet highlights the term.
  result := public.api_search(f.cid, 'quote', 10, 10);
  if jsonb_array_length(result->'conversations') <> 1 then
    raise exception 'F3 FAILED: expected 1 grouped conversation hit, got %',
      result->'conversations';
  end if;
  if (result->'conversations'->0->>'id')::uuid <> f.cv1 then
    raise exception 'F3 FAILED: wrong conversation matched';
  end if;
  if result->'conversations'->0->>'snippet' not like '%<b>%' then
    raise exception 'F3 FAILED: snippet not highlighted: %',
      result->'conversations'->0->>'snippet';
  end if;

  -- websearch syntax: multi-term
  result := public.api_search(f.cid, 'fence repair', 10, 10);
  if jsonb_array_length(result->'conversations') <> 1 then
    raise exception 'F3 FAILED: websearch multi-term missed';
  end if;

  -- contacts: partial name, partial phone, misspelled name (trgm %)
  result := public.api_search(f.cid, 'Smit', 10, 10);
  if jsonb_array_length(result->'contacts') < 1
     or result->'contacts'->0->>'name' <> 'Jo Smith' then
    raise exception 'F3 FAILED: partial-name contact match: %', result->'contacts';
  end if;
  result := public.api_search(f.cid, '555010', 10, 10);
  if jsonb_array_length(result->'contacts') <> 2 then
    raise exception 'F3 FAILED: partial-phone contact match: %', result->'contacts';
  end if;
  result := public.api_search(f.cid, 'Jo Smth', 10, 10);
  if jsonb_array_length(result->'contacts') < 1
     or result->'contacts'->0->>'name' <> 'Jo Smith' then
    raise exception 'F3 FAILED: misspelled-name similarity match: %', result->'contacts';
  end if;

  -- soft-deleted contacts never surface
  result := public.api_search(f.cid, 'Deleted', 10, 10);
  if jsonb_array_length(result->'contacts') <> 0 then
    raise exception 'F3 FAILED: soft-deleted contact surfaced';
  end if;

  -- p_contact_limit = 0 (cursor pages) suppresses the contacts arm
  result := public.api_search(f.cid, 'Smit', 10, 0);
  if jsonb_array_length(result->'contacts') <> 0 then
    raise exception 'F3 FAILED: contact limit 0 not honored';
  end if;

  -- conversation cursor: matches in cv1 and cv2 for "estimate OR quote"?
  -- Use a term hitting both threads: 'the' is a stopword, so use two calls —
  -- page through hits of 'quote or estimate' via websearch OR.
  result := public.api_search(f.cid, 'quote or estimate', 1, 0);
  if jsonb_array_length(result->'conversations') <> 1 then
    raise exception 'F3 FAILED: OR search page 1: %', result->'conversations';
  end if;
  result := public.api_search(f.cid, 'quote or estimate', 10, 0,
    (result->'conversations'->0->>'matched_at')::timestamptz,
    (result->'conversations'->0->>'id')::uuid);
  if jsonb_array_length(result->'conversations') <> 1
     or (result->'conversations'->0->>'id')::uuid <> f.cv2 then
    raise exception 'F3 FAILED: OR search page 2: %', result->'conversations';
  end if;

  -- tenant isolation
  result := public.api_search(gen_random_uuid(), 'quote', 10, 10);
  if jsonb_array_length(result->'conversations') <> 0
     or jsonb_array_length(result->'contacts') <> 0 then
    raise exception 'F3 FAILED: cross-tenant leak';
  end if;

  raise notice 'F3 PASSED: api_search FTS grouping, snippets, trgm contacts, cursor';
end $$;

-- ===========================================================================
-- F4. api_period_segments: sums only rows at/after the period start,
--     company-scoped.
-- ===========================================================================
do $$
declare
  f record;
  total bigint;
begin
  select * into f from fixture;

  total := public.api_period_segments(f.cid, '2026-06-15T00:00:00Z');
  if total <> 6 then
    raise exception 'F4 FAILED: expected 6 in-period segments, got %', total;
  end if;

  total := public.api_period_segments(f.cid, '2026-05-01T00:00:00Z');
  if total <> 13 then
    raise exception 'F4 FAILED: expected 13 all-time segments, got %', total;
  end if;

  total := public.api_period_segments(gen_random_uuid(), '2026-01-01T00:00:00Z');
  if total <> 0 then
    raise exception 'F4 FAILED: cross-tenant or empty sum wrong: %', total;
  end if;

  raise notice 'F4 PASSED: api_period_segments period-scoped sum';
end $$;

-- ===========================================================================
-- F5. Privileges: end-user roles cannot execute the api_* functions;
--     service_role can (deny-by-default posture, SPEC §6).
-- ===========================================================================
do $$
declare
  fn text;
  foid oid;
  n int := 0;
  bad text := '';
begin
  for fn, foid in
    select p.proname, p.oid
    from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
    where n2.nspname = 'public' and p.proname like 'api\_%'
  loop
    n := n + 1;
    if has_function_privilege('anon', foid, 'execute') then
      bad := bad || format(' anon:%s', fn);
    end if;
    if has_function_privilege('authenticated', foid, 'execute') then
      bad := bad || format(' authenticated:%s', fn);
    end if;
    if not has_function_privilege('service_role', foid, 'execute') then
      bad := bad || format(' service_role-missing:%s', fn);
    end if;
  end loop;
  if n < 4 then
    raise exception 'F5 FAILED: expected at least the 4 api_* functions, found %', n;
  end if;
  if bad <> '' then
    raise exception 'F5 FAILED: function privilege posture wrong:%', bad;
  end if;
  raise notice 'F5 PASSED: api_* functions executable by service_role only';
end $$;

rollback;

select 'ALL API FUNCTION TESTS PASSED' as result;
