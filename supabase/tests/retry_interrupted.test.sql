-- [#411] Auto-retry claim — assertion suite for
-- supabase/migrations/20260730001900_retry_interrupted_sends.sql.
--
-- The whole feature rests on one claim: a STUCK row provably never reached the
-- carrier, so re-sending cannot duplicate a message. Every assertion below
-- guards that boundary, because if it leaks the failure is a customer getting
-- the same text twice — worse than the late send this fixes.
--
-- One transaction, rolled back. Fixtures use a 'ba' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('ba000000-0000-4000-8000-00000000000a'::uuid, 'retry@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('ba000000-0000-4000-8000-0000000000c1'::uuid, 'Retry Co',
   'ba000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());

insert into public.phone_numbers
  (id, company_id, status, provisioning_key, country, number_e164)
values
  ('ba000000-0000-4000-8000-0000000000b1'::uuid,
   'ba000000-0000-4000-8000-0000000000c1'::uuid, 'active', 'ba-key-1', 'US',
   '+14155550401');

insert into public.contacts (id, company_id, phone_e164)
values ('ba000000-0000-4000-8000-0000000000e1'::uuid,
        'ba000000-0000-4000-8000-0000000000c1'::uuid, '+16135554001');

insert into public.conversations (id, company_id, contact_id, phone_number_id, status)
values ('ba000000-0000-4000-8000-0000000000d1'::uuid,
        'ba000000-0000-4000-8000-0000000000c1'::uuid,
        'ba000000-0000-4000-8000-0000000000e1'::uuid,
        'ba000000-0000-4000-8000-0000000000b1'::uuid, 'open');

do $$
declare
  v_stuck    uuid;
  v_fresh    uuid;
  v_sent     uuid;
  v_failed   uuid;
  v_count    int;
  v_exhausted uuid;
  v_attempts smallint;
begin
  -- A send that crashed before the Telnyx call: queued, no carrier id, old.
  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments,
     sent_by_user_id, created_at, updated_at)
  values ('ba000000-0000-4000-8000-0000000000c1'::uuid,
          'ba000000-0000-4000-8000-0000000000d1'::uuid,
          'outbound', 'On our way.', 'queued', 1,
          'ba000000-0000-4000-8000-00000000000a'::uuid,
          now() - interval '1 hour', now() - interval '1 hour')
  returning id into v_stuck;

  -- ==========================================================================
  -- THE BOUNDARY. Each of these is a row that might have reached the carrier,
  -- or is not ours to resend. None may be claimed.
  -- ==========================================================================

  -- Queued but RECENT: a dispatch may be in flight right now.
  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments,
     sent_by_user_id)
  values ('ba000000-0000-4000-8000-0000000000c1'::uuid,
          'ba000000-0000-4000-8000-0000000000d1'::uuid,
          'outbound', 'Just queued.', 'queued', 1,
          'ba000000-0000-4000-8000-00000000000a'::uuid)
  returning id into v_fresh;

  -- HAS a carrier id: Telnyx accepted it. Retrying is the duplicate this
  -- whole design refuses to risk.
  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments,
     sent_by_user_id, telnyx_message_id, created_at, updated_at)
  values ('ba000000-0000-4000-8000-0000000000c1'::uuid,
          'ba000000-0000-4000-8000-0000000000d1'::uuid,
          'outbound', 'Already gone.', 'queued', 1,
          'ba000000-0000-4000-8000-00000000000a'::uuid, 'tx-ba-1',
          now() - interval '1 hour', now() - interval '1 hour')
  returning id into v_sent;

  -- FAILED, not queued: a carrier refusal. Its retry is the human's call, and
  -- send-failures.ts already decides which are retryable at all.
  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments,
     sent_by_user_id, created_at, updated_at)
  values ('ba000000-0000-4000-8000-0000000000c1'::uuid,
          'ba000000-0000-4000-8000-0000000000d1'::uuid,
          'outbound', 'Refused.', 'failed', 1,
          'ba000000-0000-4000-8000-00000000000a'::uuid,
          now() - interval '1 hour', now() - interval '1 hour')
  returning id into v_failed;

  -- Inbound is not ours to send at all.
  insert into public.messages
    (company_id, conversation_id, direction, body, status, created_at, updated_at)
  values ('ba000000-0000-4000-8000-0000000000c1'::uuid,
          'ba000000-0000-4000-8000-0000000000d1'::uuid,
          'inbound', 'Hello?', 'received',
          now() - interval '1 hour', now() - interval '1 hour');

  select count(*) into v_count
    from public.claim_stuck_sends_for_retry(900, 1, 50);
  if v_count <> 1 then
    raise exception
      'exactly the stuck row must be claimed, got % rows', v_count;
  end if;

  -- ==========================================================================
  -- BUMPING THE COUNTER IS THE CLAIM.
  --
  -- Two overlapping sweeps cannot both take the same message, because the
  -- second one's auto_retry_count predicate no longer holds by the time it
  -- reads.
  -- ==========================================================================
  select auto_retry_count into v_attempts
    from public.messages where id = v_stuck;
  if v_attempts <> 1 then
    raise exception 'the claim must record the attempt, got %', v_attempts;
  end if;

  -- A second run finds nothing: the ceiling is reached, and the row is now the
  -- fail-out sweeper's, which is the unchanged fall-through.
  select count(*) into v_count
    from public.claim_stuck_sends_for_retry(900, 1, 50);
  if v_count <> 0 then
    raise exception 'a claimed row must not be claimed twice, got %', v_count;
  end if;

  -- The untouched rows really were untouched.
  select count(*) into v_count
    from public.messages
   where id in (v_fresh, v_sent, v_failed) and auto_retry_count <> 0;
  if v_count <> 0 then
    raise exception 'the boundary rows must not have been claimed';
  end if;

  -- ==========================================================================
  -- THE FALL-THROUGH STILL WORKS.
  --
  -- A row at the ceiling is failed out by the unchanged sweeper, so a message
  -- can never sit queued forever — the state this machinery exists to prevent.
  -- ==========================================================================
  -- Inserted already-at-the-ceiling and already old, because `set_updated_at`
  -- is a BEFORE UPDATE trigger: an UPDATE cannot backdate a row, only an
  -- INSERT can. That trigger is also why a freshly-claimed row stops being
  -- stuck for another full window, which is the behaviour the migration
  -- documents and this fixture reproduces.
  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments,
     sent_by_user_id, auto_retry_count, created_at, updated_at)
  values ('ba000000-0000-4000-8000-0000000000c1'::uuid,
          'ba000000-0000-4000-8000-0000000000d1'::uuid,
          'outbound', 'Tried once already.', 'queued', 1,
          'ba000000-0000-4000-8000-00000000000a'::uuid, 1,
          now() - interval '2 hours', now() - interval '2 hours')
  returning id into v_exhausted;

  -- The claim skips it: the ceiling is reached.
  select count(*) into v_count
    from public.claim_stuck_sends_for_retry(900, 1, 50);
  if v_count <> 0 then
    raise exception 'a row at the ceiling must not be claimed again, got %', v_count;
  end if;

  -- …and the UNCHANGED sweeper takes it, so nothing sits queued forever.
  perform public.fail_stuck_outbound_sends(900);
  select count(*) into v_count
    from public.messages
   where id = v_exhausted
     and status = 'failed' and error_code = 'send_interrupted';
  if v_count <> 1 then
    raise exception 'a retried-and-still-stuck row must be failed out';
  end if;

  raise notice 'retry interrupted sends (#411): all assertions passed';
end $$;

-- Service-role only: this re-sends customer messages.
do $$
begin
  if has_function_privilege('authenticated',
       'public.claim_stuck_sends_for_retry(integer, integer, integer)', 'execute')
     or has_function_privilege('anon',
       'public.claim_stuck_sends_for_retry(integer, integer, integer)', 'execute') then
    raise exception 'claim_stuck_sends_for_retry must be service_role only';
  end if;
end $$;

rollback;
