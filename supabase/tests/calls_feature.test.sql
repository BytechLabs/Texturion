-- #129 Calls feature — the session-grain read model + its RPCs
-- (migrations 20260710160000 + 20260710160100). Self-contained fixtures,
-- rolled back.

begin;

insert into auth.users (id, email, raw_user_meta_data)
values ('77777777-7777-4777-8777-777777777777', 'owner@calls.test',
        '{"display_name":"Calls Owner"}'::jsonb);

insert into public.companies (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values ('77777777-7777-4777-8777-777000000000', 'Calls HVAC',
        '77777777-7777-4777-8777-777777777777', 'CA', '416', now());

insert into public.company_members (company_id, user_id, role)
values ('77777777-7777-4777-8777-777000000000',
        '77777777-7777-4777-8777-777777777777', 'owner');

insert into public.phone_numbers (id, company_id, status, provisioning_key, country, number_e164)
values
  ('77777777-7777-4777-8777-777000000001', '77777777-7777-4777-8777-777000000000',
   'active', 'cs_test_calls_1', 'CA', '+14165550200'),
  ('77777777-7777-4777-8777-777000000002', '77777777-7777-4777-8777-777000000000',
   'active', 'cs_test_calls_2', 'CA', '+14165550300');

-- ===========================================================================
-- C-1. api_upsert_call merges convergently: 'voicemail' beats the hangup's
--      'answered' fallback WHATEVER order the webhooks land; seconds take the
--      max; the caller back-fills but never flips.
-- ===========================================================================
do $$
declare v jsonb;
begin
  -- Hangup lands FIRST (out of order): answered, 240 s.
  v := public.api_upsert_call(
    '77777777-7777-4777-8777-777000000000',
    '77777777-7777-4777-8777-777000000001',
    'sess-c1', '+14165550111', 'answered', 240,
    now() - interval '5 minutes', now());
  if v->>'outcome' <> 'answered' then
    raise exception 'C-1 FAILED: first write outcome %', v->>'outcome';
  end if;
  -- Late AMD verdict: voicemail must WIN; a null caller must not erase.
  v := public.api_upsert_call(
    '77777777-7777-4777-8777-777000000000',
    '77777777-7777-4777-8777-777000000001',
    'sess-c1', null, 'voicemail', 0,
    now() - interval '5 minutes', null);
  if v->>'outcome' <> 'voicemail' then
    raise exception 'C-1 FAILED: voicemail did not win, got %', v->>'outcome';
  end if;
  if (v->>'forward_seconds')::int <> 240 then
    raise exception 'C-1 FAILED: seconds regressed to %', v->>'forward_seconds';
  end if;
  if v->>'caller_e164' <> '+14165550111' then
    raise exception 'C-1 FAILED: caller erased';
  end if;
  raise notice 'C-1 PASSED: api_upsert_call merge (voicemail wins, seconds max, caller sticks)';
end $$;

-- ===========================================================================
-- C-2. api_thread_call with create: a MISSED call creates the contact + the
--      conversation, inserts ONE call_completed event, and is idempotent.
-- ===========================================================================
do $$
declare v jsonb; v2 jsonb; n int;
begin
  v := public.api_thread_call(
    '77777777-7777-4777-8777-777000000000',
    '77777777-7777-4777-8777-777000000001',
    '+14165550111', 'sess-c1', 'missed', 0, true);
  if v->>'conversation_id' is null then
    raise exception 'C-2 FAILED: missed call did not thread';
  end if;
  -- Replay: same ids back, no second event.
  v2 := public.api_thread_call(
    '77777777-7777-4777-8777-777000000000',
    '77777777-7777-4777-8777-777000000001',
    '+14165550111', 'sess-c1', 'missed', 0, true);
  if v2->>'conversation_id' <> v->>'conversation_id' then
    raise exception 'C-2 FAILED: replay threaded a different conversation';
  end if;
  select count(*) into n from public.conversation_events
   where type = 'call_completed'
     and payload->>'call_session_id' = 'sess-c1';
  if n <> 1 then
    raise exception 'C-2 FAILED: expected 1 call_completed event, got %', n;
  end if;
  raise notice 'C-2 PASSED: api_thread_call creates + audits once (idempotent)';
end $$;

-- ===========================================================================
-- C-3. api_thread_call WITHOUT create: an answered call from a stranger (no
--      contact / no open conversation) stays unthreaded — never a new
--      conversation for a call that is not a work item.
-- ===========================================================================
do $$
declare v jsonb; n int;
begin
  v := public.api_thread_call(
    '77777777-7777-4777-8777-777000000000',
    '77777777-7777-4777-8777-777000000001',
    '+14165550999', 'sess-c3', 'answered', 120, false);
  if v <> '{}'::jsonb then
    raise exception 'C-3 FAILED: stranger answered call threaded: %', v;
  end if;
  select count(*) into n from public.contacts
   where company_id = '77777777-7777-4777-8777-777000000000'
     and phone_e164 = '+14165550999';
  if n <> 0 then
    raise exception 'C-3 FAILED: join-only threading created a contact';
  end if;
  raise notice 'C-3 PASSED: join-only threading never creates';
end $$;

-- ===========================================================================
-- C-4. api_list_calls applies the #106 deny list INSIDE the SQL: rows on a
--      hidden number disappear; rows with a NULL number stay visible.
-- ===========================================================================
do $$
declare n int;
begin
  perform public.api_upsert_call(
    '77777777-7777-4777-8777-777000000000',
    '77777777-7777-4777-8777-777000000002',
    'sess-c4-hidden', '+14165550222', 'missed', 0, now(), now());
  insert into public.calls (company_id, phone_number_id, call_session_id, caller_e164, outcome)
  values ('77777777-7777-4777-8777-777000000000', null, 'sess-c4-null', '+14165550333', 'answered');

  -- Unrestricted (null deny list): all three sessions visible.
  select count(*) into n from public.api_list_calls(
    '77777777-7777-4777-8777-777000000000', 50, null, null, null, null);
  if n <> 3 then
    raise exception 'C-4 FAILED: unrestricted expected 3 rows, got %', n;
  end if;

  -- Number 2 hidden: its row disappears; the NULL-number row stays.
  select count(*) into n from public.api_list_calls(
    '77777777-7777-4777-8777-777000000000', 50, null, null, null,
    array['77777777-7777-4777-8777-777000000002']::uuid[]);
  if n <> 2 then
    raise exception 'C-4 FAILED: deny-filtered expected 2 rows, got %', n;
  end if;

  -- Outcome filter narrows.
  select count(*) into n from public.api_list_calls(
    '77777777-7777-4777-8777-777000000000', 50, 'voicemail', null, null, null);
  if n <> 1 then
    raise exception 'C-4 FAILED: outcome filter expected 1 row, got %', n;
  end if;
  raise notice 'C-4 PASSED: api_list_calls deny list + NULL-number visibility + outcome filter';
end $$;

-- ===========================================================================
-- C-5. All three RPCs are service-role only.
-- ===========================================================================
do $$
declare fn text; acl boolean;
begin
  foreach fn in array array['api_upsert_call', 'api_thread_call', 'api_list_calls'] loop
    select has_function_privilege('authenticated', p.oid, 'EXECUTE') into acl
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn limit 1;
    if acl then
      raise exception 'C-5 FAILED: % executable by authenticated', fn;
    end if;
  end loop;
  raise notice 'C-5 PASSED: calls RPCs are service-role only';
end $$;

rollback;
