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
-- C-7. The call_completed event payload carries direction. (D43 DROPPED
--      company_members.call_cell_e164 — the browser is the agent leg now, so
--      there is no cell column to validate.)
-- ===========================================================================
do $$
declare v jsonb; d text;
begin
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
  raise notice 'C-7 PASSED: outbound event direction';
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

-- ===========================================================================
-- C-8 (#133). api_sweep_stale_calls: an in-flight session older than the
--     window flips to 'missed'; fresh in-flight and already-resolved rows
--     are untouched. (now() is transaction-fixed, so the sweep is driven by
--     p_stale_before.)
-- ===========================================================================
do $$
declare n int; v_out text;
begin
  insert into public.calls
    (company_id, phone_number_id, call_session_id, direction, outcome, started_at)
  values
    ('77777777-7777-4777-8777-777000000000', '77777777-7777-4777-8777-777000000001',
     'sess-c8-stale', 'outbound', null, now() - interval '5 hours'),
    ('77777777-7777-4777-8777-777000000000', '77777777-7777-4777-8777-777000000001',
     'sess-c8-fresh', 'outbound', null, now() - interval '5 minutes'),
    ('77777777-7777-4777-8777-777000000000', '77777777-7777-4777-8777-777000000001',
     'sess-c8-done', 'inbound', 'answered', now() - interval '6 hours');

  n := public.api_sweep_stale_calls();
  if n <> 1 then
    raise exception 'C-8 FAILED: swept % rows (want exactly the stale one)', n;
  end if;
  select outcome into v_out from public.calls where call_session_id = 'sess-c8-stale';
  if v_out <> 'missed' then
    raise exception 'C-8 FAILED: stale session outcome % (want missed)', v_out;
  end if;
  select outcome into v_out from public.calls where call_session_id = 'sess-c8-fresh';
  if v_out is not null then
    raise exception 'C-8 FAILED: fresh in-flight session was swept';
  end if;
  select outcome into v_out from public.calls where call_session_id = 'sess-c8-done';
  if v_out <> 'answered' then
    raise exception 'C-8 FAILED: resolved session was rewritten';
  end if;
  raise notice 'C-8 PASSED: stale-calls sweep flips only wedged sessions';
end $$;

-- ===========================================================================
-- C-9 (#133). The sweep RPC is service-role only, like every calls RPC.
-- ===========================================================================
do $$
begin
  if exists (
    select 1 from information_schema.routine_privileges
     where routine_name = 'api_sweep_stale_calls'
       and grantee in ('anon', 'authenticated', 'PUBLIC')
       and privilege_type = 'EXECUTE'
  ) then
    raise exception 'C-9 FAILED: api_sweep_stale_calls executable by non-service roles';
  end if;
  raise notice 'C-9 PASSED: sweep RPC is service-role only';
end $$;

-- ===========================================================================
-- C-10 (#133 review). api_claim_outbound_dial: the atomic double-dial lease —
--     one winner per conversation, an expired lease is reclaimable, a live
--     one is not, and the RPC is service-role only. (Fixture conversation
--     comes from C-2's threading.)
-- ===========================================================================
do $$
declare v_conv uuid; a boolean; b boolean;
begin
  select id into v_conv from public.conversations
   where company_id = '77777777-7777-4777-8777-777000000000'
   limit 1;
  if v_conv is null then
    raise exception 'C-10 FAILED: no fixture conversation';
  end if;

  a := public.api_claim_outbound_dial('77777777-7777-4777-8777-777000000000', v_conv);
  b := public.api_claim_outbound_dial('77777777-7777-4777-8777-777000000000', v_conv);
  if a is distinct from true or b is distinct from false then
    raise exception 'C-10 FAILED: claim pair was (%, %) — want (true, false)', a, b;
  end if;

  -- An EXPIRED lease is stolen by the next claimer.
  update public.outbound_dial_leases
     set claimed_at = now() - interval '3 minutes'
   where conversation_id = v_conv;
  b := public.api_claim_outbound_dial('77777777-7777-4777-8777-777000000000', v_conv);
  if b is distinct from true then
    raise exception 'C-10 FAILED: expired lease not reclaimable';
  end if;

  -- Release re-opens immediately.
  delete from public.outbound_dial_leases where conversation_id = v_conv;
  b := public.api_claim_outbound_dial('77777777-7777-4777-8777-777000000000', v_conv);
  if b is distinct from true then
    raise exception 'C-10 FAILED: released lease not claimable';
  end if;

  if exists (
    select 1 from information_schema.routine_privileges
     where routine_name = 'api_claim_outbound_dial'
       and grantee in ('anon', 'authenticated', 'PUBLIC')
       and privilege_type = 'EXECUTE'
  ) then
    raise exception 'C-10 FAILED: claim RPC executable by non-service roles';
  end if;
  raise notice 'C-10 PASSED: atomic dial lease (one winner, TTL steal, release, service-role only)';
end $$;

-- ===========================================================================
-- C-11 (#209). The honest two-tier sweep + the gated outbound claims. A row
--     whose DO state mirror is already terminal ('ended_%') but whose
--     outcome never landed (the incident shape: the terminal merge died
--     mid-flight) (1) finalizes on the SHORT window to the outcome the
--     mirror proves - an answered call is NEVER relabeled missed, the state
--     stays untouched - and (2) stops holding the line against outbound
--     claims. NULL-state rows keep the conservative 4h missed flip (C-8),
--     and a genuinely live row still refuses the claim.
-- ===========================================================================
do $$
declare n int; v_out text; v_state text; claimed boolean; v jsonb;
begin
  insert into public.calls
    (company_id, phone_number_id, call_session_id, direction, outcome, state, started_at)
  values
    -- Tonight's row: terminal mirror landed, outcome write lost, aged past
    -- the short (5 min) window.
    ('77777777-7777-4777-8777-777000000000', '77777777-7777-4777-8777-777000000001',
     'sess-c11-ans', 'inbound', null, 'ended_answered', now() - interval '10 minutes'),
    ('77777777-7777-4777-8777-777000000000', '77777777-7777-4777-8777-777000000001',
     'sess-c11-vm', 'inbound', null, 'ended_voicemail', now() - interval '10 minutes'),
    ('77777777-7777-4777-8777-777000000000', '77777777-7777-4777-8777-777000000001',
     'sess-c11-rej', 'inbound', null, 'ended_rejected', now() - interval '10 minutes'),
    -- Inside the short window: the terminal merge may still be in flight.
    ('77777777-7777-4777-8777-777000000000', '77777777-7777-4777-8777-777000000001',
     'sess-c11-inflight', 'inbound', null, 'ended_answered', now() - interval '1 minute');

  n := public.api_sweep_stale_calls();
  if n <> 3 then
    raise exception 'C-11 FAILED: swept % rows (want the 3 aged mirror-terminal ones)', n;
  end if;

  select outcome, state into v_out, v_state
    from public.calls where call_session_id = 'sess-c11-ans';
  if v_out <> 'answered' or v_state <> 'ended_answered' then
    raise exception 'C-11 FAILED: answered mirror finalized as (%, %) - the sweep must derive the outcome FROM the mirror and never relabel it missed', v_out, v_state;
  end if;
  select outcome into v_out from public.calls where call_session_id = 'sess-c11-vm';
  if v_out <> 'voicemail' then
    raise exception 'C-11 FAILED: voicemail mirror finalized as %', v_out;
  end if;
  select outcome, state into v_out, v_state
    from public.calls where call_session_id = 'sess-c11-rej';
  if v_out <> 'missed' or v_state <> 'ended_rejected' then
    raise exception 'C-11 FAILED: rejected mirror finalized as (%, %)', v_out, v_state;
  end if;
  select outcome into v_out from public.calls where call_session_id = 'sess-c11-inflight';
  if v_out is not null then
    raise exception 'C-11 FAILED: in-flight terminal merge preempted (outcome %)', v_out;
  end if;

  -- The test hook: p_terminal_stale_before pulls the short window forward.
  n := public.api_sweep_stale_calls(null, now());
  if n <> 1 then
    raise exception 'C-11 FAILED: explicit terminal window swept % rows', n;
  end if;
  select outcome into v_out from public.calls where call_session_id = 'sess-c11-inflight';
  if v_out <> 'answered' then
    raise exception 'C-11 FAILED: explicit-window finalize wrote %', v_out;
  end if;

  -- The claims: a stranded mirror-terminal row no longer wedges the line...
  insert into public.calls
    (company_id, phone_number_id, call_session_id, direction, outcome, state, started_at)
  values
    ('77777777-7777-4777-8777-777000000000', '77777777-7777-4777-8777-777000000002',
     'sess-c11-stranded', 'inbound', null, 'ended_answered', now() - interval '2 hours');
  claimed := public.api_claim_outbound_line(
    '77777777-7777-4777-8777-777000000000', '77777777-7777-4777-8777-777000000002',
    'nonce-c11-a', '+14165550300', '+14165550999', now() - interval '4 hours');
  if claimed is distinct from true then
    raise exception 'C-11 FAILED: stranded terminal-mirror row still wedges the outbound claim';
  end if;
  -- Free the reservation the successful claim minted (30s busy window).
  delete from public.outbound_call_authorizations where nonce = 'nonce-c11-a';

  -- ...while a genuinely live row (non-terminal mirror, and the NULL-state
  -- legacy shape) still refuses it.
  insert into public.calls
    (company_id, phone_number_id, call_session_id, direction, outcome, state, started_at)
  values
    ('77777777-7777-4777-8777-777000000000', '77777777-7777-4777-8777-777000000002',
     'sess-c11-live', 'inbound', null, 'answered', now() - interval '1 minute');
  claimed := public.api_claim_outbound_line(
    '77777777-7777-4777-8777-777000000000', '77777777-7777-4777-8777-777000000002',
    'nonce-c11-b', '+14165550300', '+14165550999', now() - interval '4 hours');
  if claimed is distinct from false then
    raise exception 'C-11 FAILED: live (answered) line was claimable';
  end if;
  update public.calls set state = null where call_session_id = 'sess-c11-live';
  claimed := public.api_claim_outbound_line(
    '77777777-7777-4777-8777-777000000000', '77777777-7777-4777-8777-777000000002',
    'nonce-c11-c', '+14165550300', '+14165550999', now() - interval '4 hours');
  if claimed is distinct from false then
    raise exception 'C-11 FAILED: NULL-state (legacy/outbound) live line was claimable';
  end if;
  update public.calls set outcome = 'answered', state = 'ended_answered'
   where call_session_id = 'sess-c11-live';

  -- The call.initiated re-check gets the same gate: with ONLY the stranded
  -- row on the number, the consumed nonce must authorize, not line_busy.
  insert into public.outbound_call_authorizations
    (nonce, company_id, phone_number_id, from_e164, customer_e164)
  values
    ('nonce-c11-d', '77777777-7777-4777-8777-777000000000',
     '77777777-7777-4777-8777-777000000002', '+14165550300', '+14165550999');
  v := public.api_authorize_outbound_call(
    'nonce-c11-d', '+14165550300', '+14165550999', 'sess-c11-out', 120);
  if (v->>'authorized')::boolean is distinct from true then
    raise exception 'C-11 FAILED: initiate re-check still line_busy on a stranded row (%)', v;
  end if;

  raise notice 'C-11 PASSED: two-tier sweep honors the terminal mirror; stranded rows free the line, live ones hold it';
end $$;

-- ===========================================================================
-- C-12. #211 call-hijack fix: the api_authorize_outbound_call REPLAY branch is
--       AUTHORIZATION-SCOPED (migration 20260723005000). When the nonce is
--       gone (a genuine re-delivery OR a forged leg with a random nonce), the
--       lookup must match ONLY an OUTBOUND row (one THIS RPC minted) whose
--       business number equals the PRESENTED `from`. Before the fix it did an
--       UNSCOPED `where call_session_id = p_call_session_id`, letting a member
--       craft a tag part-4 = a VICTIM's (non-secret) live session id and get
--       the victim's company/number back (the call-hijack primitive).
-- ===========================================================================
do $$
declare v jsonb;
begin
  -- A live OUTBOUND victim row under a non-secret session id, on number ...002
  -- (+14165550300). No matching outbound_call_authorizations nonce exists.
  insert into public.calls
    (company_id, phone_number_id, call_session_id, caller_e164, direction, state, started_at)
  values
    ('77777777-7777-4777-8777-777000000000', '77777777-7777-4777-8777-777000000002',
     'sess-victim-out', '+14165551111', 'outbound', 'answered', now() - interval '1 minute');

  -- ATTACK 1: a forged leg presents a `from` it can produce (+14165559999) but
  -- the victim's session id. The scoped lookup requires the row's OWN business
  -- number, so it misses -> authorized=false (pre-fix: returned victim tenant).
  v := public.api_authorize_outbound_call(
    'nonce-does-not-exist', '+14165559999', '+14165552222', 'sess-victim-out', 120);
  if (v->>'authorized')::boolean is distinct from false then
    raise exception 'C-12 FAILED: replay bound a victim row under a non-matching from (%)', v;
  end if;

  -- ATTACK 2: an INBOUND victim row is unreachable via the replay branch even
  -- when the presented `from` matches the number - the RPC only ever mints
  -- OUTBOUND rows, so the direction scope excludes it.
  insert into public.calls
    (company_id, phone_number_id, call_session_id, caller_e164, direction, state, started_at)
  values
    ('77777777-7777-4777-8777-777000000000', '77777777-7777-4777-8777-777000000002',
     'sess-victim-in', '+14165553333', 'inbound', 'answered', now() - interval '1 minute');
  v := public.api_authorize_outbound_call(
    'nonce-does-not-exist', '+14165550300', '+14165552222', 'sess-victim-in', 120);
  if (v->>'authorized')::boolean is distinct from false then
    raise exception 'C-12 FAILED: replay bound an INBOUND victim row (%)', v;
  end if;

  -- GENUINE REPLAY: the leg re-delivering its OWN outbound initiated (its own
  -- outbound row + its own business number as `from`) authorizes as a replay,
  -- returning the row's own tenant, so a live re-delivery is a safe no-op.
  v := public.api_authorize_outbound_call(
    'nonce-does-not-exist', '+14165550300', '+14165552222', 'sess-victim-out', 120);
  if (v->>'authorized')::boolean is distinct from true
     or (v->>'replay')::boolean is distinct from true
     or v->>'company_id' <> '77777777-7777-4777-8777-777000000000'
     or v->>'phone_number_id' <> '77777777-7777-4777-8777-777000000002'
     or v->>'session_id' <> 'sess-victim-out' then
    raise exception 'C-12 FAILED: genuine outbound replay not authorized correctly (%)', v;
  end if;

  raise notice 'C-12 PASSED: replay branch is authorization-scoped (outbound + matching from only)';
end $$;

rollback;
