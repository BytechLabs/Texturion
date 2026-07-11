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
  -- #132: the first pass reports the event INSERT (the crew-alert claim)…
  if v->>'event_inserted' <> 'true' then
    raise exception 'C-2 FAILED: fresh thread did not report event_inserted';
  end if;
  -- Replay: same ids back, no second event.
  v2 := public.api_thread_call(
    '77777777-7777-4777-8777-777000000000',
    '77777777-7777-4777-8777-777000000001',
    '+14165550111', 'sess-c1', 'missed', 0, true);
  if v2->>'conversation_id' <> v->>'conversation_id' then
    raise exception 'C-2 FAILED: replay threaded a different conversation';
  end if;
  -- …and the replay does NOT (a Telnyx redelivery never re-alerts).
  if v2->>'event_inserted' <> 'false' then
    raise exception 'C-2 FAILED: replay claimed event_inserted';
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
-- C-6. D38 outbound: direction persists (and never flips on merge); the
--      billed measure counts out_customer legs into the same D36 pool; the
--      per-dial counter counts both outbound legs.
-- ===========================================================================
do $$
declare v jsonb; secs bigint; dials bigint;
begin
  v := public.api_upsert_call(
    '77777777-7777-4777-8777-777000000000',
    '77777777-7777-4777-8777-777000000001',
    'sess-c6-out', '+14165550444', null, 0, now(), null, 'outbound');
  if v->>'direction' <> 'outbound' then
    raise exception 'C-6 FAILED: direction not persisted: %', v->>'direction';
  end if;
  -- Customer-leg hangup merges outcome/seconds; direction stays outbound.
  v := public.api_upsert_call(
    '77777777-7777-4777-8777-777000000000',
    '77777777-7777-4777-8777-777000000001',
    'sess-c6-out', '+14165550444', 'answered', 192, now(), now(), 'inbound');
  if v->>'direction' <> 'outbound' or v->>'outcome' <> 'answered' then
    raise exception 'C-6 FAILED: merge broke direction/outcome: % %',
      v->>'direction', v->>'outcome';
  end if;

  insert into public.call_records
    (company_id, phone_number_id, call_session_id, call_leg_id, leg, billable_seconds, stripe_reported_at)
  values
    ('77777777-7777-4777-8777-777000000000', '77777777-7777-4777-8777-777000000001',
     'sess-c6-out', 'leg-c6-agent', 'out_agent', 200, now()),
    ('77777777-7777-4777-8777-777000000000', '77777777-7777-4777-8777-777000000001',
     'sess-c6-out', 'leg-c6-cust', 'out_customer', 192, now());

  -- The pool: M-6-style fixtures contributed forward 25s; out_customer adds
  -- 192; out_agent adds NOTHING (cost analysis only).
  secs := public.api_period_forward_seconds(
    '77777777-7777-4777-8777-777000000000', now() - interval '1 hour');
  if secs <> 192 then
    raise exception 'C-6 FAILED: billed pool expected 192 seconds, got %', secs;
  end if;

  dials := public.api_period_forwarded_calls(
    '77777777-7777-4777-8777-777000000000', now() - interval '1 hour');
  if dials <> 2 then
    raise exception 'C-6 FAILED: per-dial counter expected 2, got %', dials;
  end if;
  raise notice 'C-6 PASSED: outbound direction + billed pool + dial counter';
end $$;

-- ===========================================================================
-- C-7. D38: company_members.call_cell_e164 accepts NANP cells and rejects
--      garbage; the call_completed event payload carries direction.
-- ===========================================================================
do $$
declare v jsonb; d text;
begin
  update public.company_members
     set call_cell_e164 = '+14165559999'
   where company_id = '77777777-7777-4777-8777-777000000000';
  begin
    update public.company_members
       set call_cell_e164 = 'not-a-number'
     where company_id = '77777777-7777-4777-8777-777000000000';
    raise exception 'C-7 FAILED: garbage cell accepted';
  exception
    when check_violation then null; -- expected
  end;

  -- Outbound threading writes direction into the event payload. The C-2
  -- fixture conversation is open for this contact+number, so join-only finds it.
  v := public.api_thread_call(
    '77777777-7777-4777-8777-777000000000',
    '77777777-7777-4777-8777-777000000001',
    '+14165550111', 'sess-c7-out', 'answered', 88, false, 'outbound');
  if v->>'conversation_id' is null then
    raise exception 'C-7 FAILED: outbound join-only did not thread';
  end if;
  select e.payload->>'direction' into d
    from public.conversation_events e
   where e.type = 'call_completed'
     and e.payload->>'call_session_id' = 'sess-c7-out';
  if d <> 'outbound' then
    raise exception 'C-7 FAILED: event direction %', d;
  end if;
  raise notice 'C-7 PASSED: call_cell CHECK + outbound event direction';
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
