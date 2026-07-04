-- FEATURE-GAPS BUILD-NOW voice wave — schema + function assertion suite for the
-- missed-call text-back (Step 1) and keep-your-number text-enablement.
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run: psql -v ON_ERROR_STOP=1 -f supabase/tests/voice_wave.test.sql
-- The whole suite runs in one transaction and ROLLS BACK — it never pollutes
-- the local database. Self-contained fixtures with a distinct 'v' id space.
--   owner   = facade00-0000-4000-8000-000000000001
--   company = facade00-0000-4000-8000-000000000002
--   number  = facade00-0000-4000-8000-000000000003

\set ON_ERROR_STOP on

begin;

-- ===========================================================================
-- VW-1. phone_numbers gains voice_connection_id (text NULL) + voice_enabled
--       (bool NOT NULL default false).
-- ===========================================================================
do $$
declare vc_null boolean; ve_type text; ve_null boolean; ve_default text;
begin
  select is_nullable='YES' into vc_null from information_schema.columns
  where table_schema='public' and table_name='phone_numbers' and column_name='voice_connection_id';
  if vc_null is null then raise exception 'VW-1 FAILED: phone_numbers.voice_connection_id missing'; end if;
  if not vc_null then raise exception 'VW-1 FAILED: voice_connection_id must be NULLable'; end if;

  select data_type, is_nullable='YES', column_default into ve_type, ve_null, ve_default
  from information_schema.columns
  where table_schema='public' and table_name='phone_numbers' and column_name='voice_enabled';
  if ve_type is null then raise exception 'VW-1 FAILED: phone_numbers.voice_enabled missing'; end if;
  if ve_type <> 'boolean' then raise exception 'VW-1 FAILED: voice_enabled is % (want boolean)', ve_type; end if;
  if ve_null then raise exception 'VW-1 FAILED: voice_enabled must be NOT NULL'; end if;
  if ve_default not like '%false%' then raise exception 'VW-1 FAILED: voice_enabled default is % (want false)', ve_default; end if;

  raise notice 'VW-1 PASSED: phone_numbers voice columns present';
end $$;

-- ===========================================================================
-- VW-2. companies gains mctb_enabled (bool NOT NULL default false),
--       mctb_message (text NULL), forward_to_cell (text NULL) with an E.164
--       CHECK.
-- ===========================================================================
do $$
declare me_type text; me_null boolean; me_default text; mm_null boolean; fc_null boolean;
begin
  select data_type, is_nullable='YES', column_default into me_type, me_null, me_default
  from information_schema.columns
  where table_schema='public' and table_name='companies' and column_name='mctb_enabled';
  if me_type is null then raise exception 'VW-2 FAILED: companies.mctb_enabled missing'; end if;
  if me_type <> 'boolean' then raise exception 'VW-2 FAILED: mctb_enabled is % (want boolean)', me_type; end if;
  if me_null then raise exception 'VW-2 FAILED: mctb_enabled must be NOT NULL'; end if;
  if me_default not like '%false%' then raise exception 'VW-2 FAILED: mctb_enabled default is % (want false)', me_default; end if;

  select is_nullable='YES' into mm_null from information_schema.columns
  where table_schema='public' and table_name='companies' and column_name='mctb_message';
  if mm_null is null then raise exception 'VW-2 FAILED: companies.mctb_message missing'; end if;
  if not mm_null then raise exception 'VW-2 FAILED: mctb_message must be NULLable'; end if;

  select is_nullable='YES' into fc_null from information_schema.columns
  where table_schema='public' and table_name='companies' and column_name='forward_to_cell';
  if fc_null is null then raise exception 'VW-2 FAILED: companies.forward_to_cell missing'; end if;
  if not fc_null then raise exception 'VW-2 FAILED: forward_to_cell must be NULLable'; end if;

  raise notice 'VW-2 PASSED: companies mctb columns present';
end $$;

-- ===========================================================================
-- VW-3. forward_to_cell CHECK rejects a non-E.164 value and accepts a US/CA one.
-- ===========================================================================
do $$
declare ok boolean := false;
begin
  begin
    update public.companies set forward_to_cell = 'not-a-number'
     where id = '00000000-0000-0000-0000-000000000000';
    -- No row matches, so the UPDATE affects 0 rows; force the CHECK via a
    -- direct temp company insert instead.
  exception when others then null;
  end;
  -- Insert a throwaway company with a bad forward_to_cell → must raise.
  begin
    insert into auth.users (id, email) values ('deadbeef-0000-4000-8000-000000000009', 'x@vw.test');
    insert into public.companies
      (id, name, owner_user_id, country, requested_area_code, aup_accepted_at, forward_to_cell)
    values ('deadbeef-0000-4000-8000-00000000000a', 'Bad', 'deadbeef-0000-4000-8000-000000000009',
            'CA', '416', now(), '4165550100'); -- missing +1
    raise exception 'VW-3 FAILED: bad forward_to_cell was accepted';
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'VW-3 FAILED: expected a check_violation'; end if;
  raise notice 'VW-3 PASSED: forward_to_cell E.164 CHECK enforced';
end $$;

-- ===========================================================================
-- VW-4. enum additions: number_source 'hosted' + conversation_event_type
--       'missed_call'.
-- ===========================================================================
do $$
declare ns text[]; ce text[];
begin
  select array_agg(e.enumlabel::text) into ns
  from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='number_source';
  if not ('hosted' = any(ns)) then raise exception 'VW-4 FAILED: number_source missing hosted'; end if;

  select array_agg(e.enumlabel::text) into ce
  from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='conversation_event_type';
  if not ('missed_call' = any(ce)) then raise exception 'VW-4 FAILED: conversation_event_type missing missed_call'; end if;
  raise notice 'VW-4 PASSED: hosted + missed_call enum values present';
end $$;

-- ===========================================================================
-- VW-5. text_enablement_orders table + status enum + service-role grant.
-- ===========================================================================
do $$
declare n int; has_rls boolean;
begin
  select count(*) into n from information_schema.tables
   where table_schema='public' and table_name='text_enablement_orders';
  if n <> 1 then raise exception 'VW-5 FAILED: text_enablement_orders table missing'; end if;

  select relrowsecurity into has_rls from pg_class
   where oid = 'public.text_enablement_orders'::regclass;
  if not has_rls then raise exception 'VW-5 FAILED: RLS not enabled on text_enablement_orders'; end if;

  perform 1 from pg_type where typname='text_enablement_status';
  if not found then raise exception 'VW-5 FAILED: text_enablement_status enum missing'; end if;

  raise notice 'VW-5 PASSED: text_enablement_orders present + RLS on';
end $$;

-- ===========================================================================
-- VW-6. claim_missed_call_text + claim_text_enablement_slot are
--       service-role-only (EXECUTE revoked from public/anon/authenticated).
-- ===========================================================================
do $$
declare fn text; leaked text;
begin
  foreach fn in array array['claim_missed_call_text','claim_text_enablement_slot'] loop
    select string_agg(distinct r.rolname, ',') into leaked
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    cross join lateral aclexplode(p.proacl) a
    join pg_roles r on r.oid=a.grantee
    where n.nspname='public' and p.proname=fn and a.privilege_type='EXECUTE'
      and r.rolname in ('public','anon','authenticated');
    if leaked is not null then raise exception 'VW-6 FAILED: % leaked EXECUTE to %', fn, leaked; end if;
  end loop;
  raise notice 'VW-6 PASSED: voice-wave claim_* are service-role-only';
end $$;

-- ===========================================================================
-- Fixtures for the behavioural function tests.
-- ===========================================================================
insert into auth.users (id, email, raw_user_meta_data)
values ('facade00-0000-4000-8000-000000000001', 'owner@vw.test',
        '{"display_name":"VW Owner"}'::jsonb);

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, plan)
values ('facade00-0000-4000-8000-000000000002', 'VW Plumbing',
        'facade00-0000-4000-8000-000000000001', 'CA', '416', now(),
        'active', 'starter');

insert into public.company_members (company_id, user_id, role)
values ('facade00-0000-4000-8000-000000000002',
        'facade00-0000-4000-8000-000000000001', 'owner');

insert into public.phone_numbers (id, company_id, status, provisioning_key, country, number_e164)
values ('facade00-0000-4000-8000-000000000003', 'facade00-0000-4000-8000-000000000002',
        'active', 'cs_vw_1', 'CA', '+14165550100');

-- ===========================================================================
-- VW-7. claim_missed_call_text — happy path for a BRAND-NEW caller (no prior
--       contact/conversation): threads the caller, inserts a queued outbound,
--       stamps last_auto_reply_at, logs a missed_call event with the call_id.
-- ===========================================================================
do $$
declare
  res jsonb; conv_id uuid; msg_id uuid; la timestamptz; ev int; contact_n int;
begin
  res := public.claim_missed_call_text(
    'facade00-0000-4000-8000-000000000002',
    'facade00-0000-4000-8000-000000000003',
    '+14165559000', 'call-sess-1',
    'Sorry we missed your call — reply to book.', 1, 10800);
  if res ? 'skipped' then raise exception 'VW-7 FAILED: unexpected skip %', res->>'skipped'; end if;

  conv_id := (res->>'conversation_id')::uuid;
  msg_id  := (res->'message'->>'id')::uuid;
  if conv_id is null or msg_id is null then raise exception 'VW-7 FAILED: no conv/message'; end if;
  if (res->>'created_conversation')::boolean is not true then
    raise exception 'VW-7 FAILED: expected created_conversation=true for a new caller';
  end if;

  -- The caller was upserted as a contact.
  select count(*) into contact_n from public.contacts
   where company_id='facade00-0000-4000-8000-000000000002' and phone_e164='+14165559000';
  if contact_n <> 1 then raise exception 'VW-7 FAILED: caller contact not created'; end if;

  -- Queued outbound row, attributed to the owner (outbound actor CHECK).
  perform 1 from public.messages
   where id=msg_id and direction='outbound' and status='queued'
     and sent_by_user_id='facade00-0000-4000-8000-000000000001'
     and body like 'Sorry we missed%';
  if not found then raise exception 'VW-7 FAILED: queued outbound not written correctly'; end if;

  select last_auto_reply_at into la from public.conversations where id=conv_id;
  if la is null then raise exception 'VW-7 FAILED: last_auto_reply_at not stamped'; end if;

  select count(*) into ev from public.conversation_events
   where conversation_id=conv_id and type='missed_call' and actor_user_id is null
     and payload->>'call_id'='call-sess-1';
  if ev <> 1 then raise exception 'VW-7 FAILED: expected 1 missed_call event, got %', ev; end if;

  raise notice 'VW-7 PASSED: claim_missed_call_text threads a new caller + texts back';
end $$;

-- ===========================================================================
-- VW-8. claim_missed_call_text — IDEMPOTENCY + REPLAY-HEAL: a retried webhook
--       for the SAME call_id never double-texts. While the claimed text is
--       still undispatched (queued, no telnyx id) the retry hands the SAME row
--       back (replayed=true) so the sweeper can re-dispatch a claim-then-crash;
--       once Telnyx accepted it, the retry is a bare 'duplicate'. Replays have
--       ZERO threading side effects (checked before any write).
-- ===========================================================================
do $$
declare
  res jsonb; msg_n int; ev_n int; conv_id uuid; first_msg uuid; closed timestamptz;
begin
  -- (a) Retry while the VW-7 claim's text is still 'queued' (no telnyx id):
  -- the replay-heal returns the SAME message row, replayed=true — never a new
  -- message, never a new event.
  res := public.claim_missed_call_text(
    'facade00-0000-4000-8000-000000000002',
    'facade00-0000-4000-8000-000000000003',
    '+14165559000', 'call-sess-1', 'dup', 1, 10800);
  if res ? 'skipped' then
    raise exception 'VW-8 FAILED: undispatched retry should replay, got %', res;
  end if;
  if (res->>'replayed')::boolean is not true then
    raise exception 'VW-8 FAILED: expected replayed=true, got %', res;
  end if;
  first_msg := (res->'message'->>'id')::uuid;
  conv_id   := (res->>'conversation_id')::uuid;

  select count(*) into msg_n from public.messages m
   join public.conversations c on c.id=m.conversation_id
   join public.contacts ct on ct.id=c.contact_id
   where ct.phone_e164='+14165559000' and m.direction='outbound';
  if msg_n <> 1 then raise exception 'VW-8 FAILED: expected exactly 1 text, got %', msg_n; end if;
  perform 1 from public.messages where id=first_msg and status='queued';
  if not found then raise exception 'VW-8 FAILED: replay must hand back the original queued row'; end if;

  -- (b) Once Telnyx accepted the text, the retry is a bare 'duplicate' — and
  -- it must NOT touch threading state (a conversation the crew closed since
  -- stays closed; checked-before-any-write is the contract).
  update public.messages set telnyx_message_id='tx-vw-1', status='sent' where id=first_msg;
  update public.conversations set status='closed', closed_at=now() where id=conv_id;

  res := public.claim_missed_call_text(
    'facade00-0000-4000-8000-000000000002',
    'facade00-0000-4000-8000-000000000003',
    '+14165559000', 'call-sess-1', 'dup', 1, 10800);
  if res->>'skipped' <> 'duplicate' then
    raise exception 'VW-8 FAILED: dispatched retry expected duplicate, got %', res;
  end if;

  select closed_at into closed from public.conversations where id=conv_id;
  if closed is null then
    raise exception 'VW-8 FAILED: a duplicate replay resurrected a closed conversation';
  end if;
  -- Restore the open conversation so VW-9's throttle check still applies.
  update public.conversations set status='open', closed_at=null where id=conv_id;

  select count(*) into ev_n from public.conversation_events
   where type='missed_call' and payload->>'call_id'='call-sess-1';
  if ev_n <> 1 then raise exception 'VW-8 FAILED: expected exactly 1 missed_call event, got %', ev_n; end if;

  raise notice 'VW-8 PASSED: a retried call never double-texts (replay-heal + duplicate)';
end $$;

-- ===========================================================================
-- VW-9. claim_missed_call_text — throttle: a DIFFERENT call within the window
--       to the same caller/conversation is throttled (one auto-text per window).
-- ===========================================================================
do $$
declare res jsonb;
begin
  res := public.claim_missed_call_text(
    'facade00-0000-4000-8000-000000000002',
    'facade00-0000-4000-8000-000000000003',
    '+14165559000', 'call-sess-2', 'again', 1, 10800);
  if res->>'skipped' <> 'throttled' then
    raise exception 'VW-9 FAILED: expected throttled, got %', res;
  end if;
  raise notice 'VW-9 PASSED: a second missed call within the window is throttled';
end $$;

-- ===========================================================================
-- VW-10. claim_missed_call_text — opt-out: never texts an opted-out caller.
-- ===========================================================================
do $$
declare res jsonb;
begin
  insert into public.opt_outs (company_id, phone_e164, source)
  values ('facade00-0000-4000-8000-000000000002', '+14165559111', 'manual');
  res := public.claim_missed_call_text(
    'facade00-0000-4000-8000-000000000002',
    'facade00-0000-4000-8000-000000000003',
    '+14165559111', 'call-sess-3', 'blocked', 1, 10800);
  if res->>'skipped' <> 'recipient_opted_out' then
    raise exception 'VW-10 FAILED: expected recipient_opted_out, got %', res;
  end if;
  raise notice 'VW-10 PASSED: opted-out caller is never texted';
end $$;

-- ===========================================================================
-- VW-11. claim_text_enablement_slot — creates a source='hosted' phone_numbers
--        row + a text_enablement_orders row; idempotent on the provisioning_key.
-- ===========================================================================
do $$
declare res jsonb; num_id uuid; ord_id uuid; res2 jsonb; n int;
begin
  -- Pro allowance (2): the fixture has 1 active number, so a hosted number is
  -- the 2nd slot and is created.
  res := public.claim_text_enablement_slot(
    'facade00-0000-4000-8000-000000000002', 'te-key-1',
    '+14165558000', 'CA', 2);
  if res->>'outcome' <> 'created' then
    raise exception 'VW-11 FAILED: expected created, got %', res->>'outcome';
  end if;
  num_id := (res->'number'->>'id')::uuid;
  ord_id := (res->'order'->>'id')::uuid;

  perform 1 from public.phone_numbers
   where id=num_id and source='hosted' and status='provisioning' and number_e164='+14165558000';
  if not found then raise exception 'VW-11 FAILED: hosted phone_numbers row wrong'; end if;

  perform 1 from public.text_enablement_orders
   where id=ord_id and status='pending' and phone_e164='+14165558000';
  if not found then raise exception 'VW-11 FAILED: text_enablement_orders row wrong'; end if;

  -- Idempotent replay on the same key → exists, no new rows.
  res2 := public.claim_text_enablement_slot(
    'facade00-0000-4000-8000-000000000002', 'te-key-1',
    '+14165558000', 'CA', 2);
  if res2->>'outcome' <> 'exists' then
    raise exception 'VW-11 FAILED: replay expected exists, got %', res2->>'outcome';
  end if;
  select count(*) into n from public.text_enablement_orders where provisioning_key='te-key-1';
  if n <> 1 then raise exception 'VW-11 FAILED: replay created a duplicate order'; end if;

  raise notice 'VW-11 PASSED: claim_text_enablement_slot creates hosted rows + idempotent';
end $$;

-- ===========================================================================
-- VW-12. claim_text_enablement_slot — plan_limit: a company already at its
--        number allowance cannot text-enable another.
-- ===========================================================================
do $$
declare res jsonb;
begin
  -- The starter fixture already holds 1 active number + 1 hosted (VW-11) = 2
  -- non-released; p_max_numbers=1 → plan_limit.
  res := public.claim_text_enablement_slot(
    'facade00-0000-4000-8000-000000000002', 'te-key-2',
    '+14165557000', 'CA', 1);
  if res->>'outcome' <> 'plan_limit' then
    raise exception 'VW-12 FAILED: expected plan_limit, got %', res->>'outcome';
  end if;
  raise notice 'VW-12 PASSED: text-enablement respects the plan number cap';
end $$;

-- ===========================================================================
-- VW-13. claim_text_enablement_slot — number_taken: a number already live on
--        JobText (any tenant — here the company's own active number) is a
--        first-class 'number_taken' outcome, never a raw unique_violation.
-- ===========================================================================
do $$
declare res jsonb; n int;
begin
  res := public.claim_text_enablement_slot(
    'facade00-0000-4000-8000-000000000002', 'te-key-3',
    '+14165550100', 'CA', 5); -- the fixture's own ACTIVE number
  if res->>'outcome' <> 'number_taken' then
    raise exception 'VW-13 FAILED: expected number_taken, got %', res;
  end if;
  -- Nothing was inserted for the rejected claim.
  select count(*) into n from public.text_enablement_orders where provisioning_key='te-key-3';
  if n <> 0 then raise exception 'VW-13 FAILED: rejected claim left an order row'; end if;
  raise notice 'VW-13 PASSED: a live number cannot be double-claimed (number_taken)';
end $$;

-- ===========================================================================
-- VW-14. claim_review_request v2 — a review ask whose text NEVER reached
--        Telnyx (failed, no telnyx id — e.g. the rate limiter denied the
--        dispatch) does NOT burn the one-per-job claim; a Telnyx-accepted ask
--        still suppresses for the window.
-- ===========================================================================
do $$
declare
  res jsonb; conv_id uuid; contact_id uuid; msg1 uuid; msg2 uuid;
begin
  insert into public.contacts (company_id, phone_e164, consent_source, consent_at)
  values ('facade00-0000-4000-8000-000000000002', '+14165559222', 'inbound_sms', now())
  returning id into contact_id;
  insert into public.conversations (company_id, contact_id, phone_number_id, status)
  values ('facade00-0000-4000-8000-000000000002', contact_id,
          'facade00-0000-4000-8000-000000000003', 'open')
  returning id into conv_id;

  -- First ask claims fine.
  res := public.claim_review_request(
    'facade00-0000-4000-8000-000000000002', conv_id,
    'facade00-0000-4000-8000-000000000001',
    'Thanks! A quick review means a lot: https://g.page/r/x', 1, 2592000);
  if res ? 'skipped' then raise exception 'VW-14 FAILED: first ask skipped %', res; end if;
  msg1 := (res->'message'->>'id')::uuid;

  -- The dispatch was DENIED (rate limiter): failed, no telnyx id → the claim
  -- must be re-askable, not suppressed for 30 days.
  update public.messages set status='failed', telnyx_message_id=null where id=msg1;
  res := public.claim_review_request(
    'facade00-0000-4000-8000-000000000002', conv_id,
    'facade00-0000-4000-8000-000000000001',
    'Thanks! A quick review means a lot: https://g.page/r/x', 1, 2592000);
  if res ? 'skipped' then
    raise exception 'VW-14 FAILED: never-dispatched ask still suppressed (%)!', res;
  end if;
  msg2 := (res->'message'->>'id')::uuid;

  -- The second ask DID go out → suppression applies again.
  update public.messages set status='sent', telnyx_message_id='tx-vw-2' where id=msg2;
  res := public.claim_review_request(
    'facade00-0000-4000-8000-000000000002', conv_id,
    'facade00-0000-4000-8000-000000000001',
    'Thanks again: https://g.page/r/x', 1, 2592000);
  if res->>'skipped' <> 'already_requested' then
    raise exception 'VW-14 FAILED: dispatched ask should suppress, got %', res;
  end if;

  raise notice 'VW-14 PASSED: rate-limited review ask does not burn the one-per-job claim';
end $$;

-- ===========================================================================
-- VW-15. claim_text_enablement_slot — TENANT ISOLATION on the Idempotency-Key
--        replay path (§10): a provisioning key already claimed by company A
--        must RAISE for company B, never return (or adopt) A's rows.
-- ===========================================================================
do $$
declare res jsonb; ok boolean := false;
begin
  insert into auth.users (id, email) values
    ('facade00-0000-4000-8000-000000000021', 'other@vw.test');
  insert into public.companies
    (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
     subscription_status, plan)
  values ('facade00-0000-4000-8000-000000000022', 'VW Rival',
          'facade00-0000-4000-8000-000000000021', 'CA', '416', now(),
          'active', 'pro');

  begin
    -- 'te-key-1' belongs to the VW-11 company; the rival replays it.
    res := public.claim_text_enablement_slot(
      'facade00-0000-4000-8000-000000000022', 'te-key-1',
      '+14165558000', 'CA', 5);
    raise exception 'VW-15 FAILED: cross-company key replay returned % instead of raising', res;
  exception when others then
    if sqlerrm not like '%belongs to another company%' then raise; end if;
    ok := true;
  end;
  if not ok then raise exception 'VW-15 FAILED: expected the cross-company guard to raise'; end if;
  raise notice 'VW-15 PASSED: a cross-company provisioning-key replay raises, never leaks';
end $$;

-- ===========================================================================
-- VW-16. claim_missed_call_text — company scoping backstop: a phone_number_id
--        that does NOT belong to the company is refused (skipped=not_found),
--        so a mismatched (company, number) pair from a webhook handler bug can
--        never thread or text under the wrong tenant.
-- ===========================================================================
do $$
declare res jsonb;
begin
  insert into public.phone_numbers (id, company_id, status, provisioning_key, country, number_e164)
  values ('facade00-0000-4000-8000-000000000023', 'facade00-0000-4000-8000-000000000022',
          'active', 'cs_vw_rival', 'CA', '+14165550199');

  res := public.claim_missed_call_text(
    'facade00-0000-4000-8000-000000000002',        -- VW company…
    'facade00-0000-4000-8000-000000000023',        -- …the RIVAL's number
    '+14165559333', 'call-sess-xt', 'wrong pair', 1, 10800);
  if res->>'skipped' <> 'not_found' then
    raise exception 'VW-16 FAILED: mismatched (company, number) expected not_found, got %', res;
  end if;
  raise notice 'VW-16 PASSED: a mismatched company/number pair is refused';
end $$;

-- ===========================================================================
-- VW-17. Lifetime-cap columns (SECURITY follow-up, 20260704010000):
--        text_enablement_orders gains verification_requests + resubmit_count
--        (int NOT NULL default 0), and bump_text_enablement_counter is
--        service-role-only like the other claim_* RPCs.
-- ===========================================================================
do $$
declare col text; c_type text; c_null boolean; c_default text; leaked text;
begin
  foreach col in array array['verification_requests','resubmit_count'] loop
    select data_type, is_nullable='YES', column_default into c_type, c_null, c_default
    from information_schema.columns
    where table_schema='public' and table_name='text_enablement_orders' and column_name=col;
    if c_type is null then raise exception 'VW-17 FAILED: text_enablement_orders.% missing', col; end if;
    if c_type <> 'integer' then raise exception 'VW-17 FAILED: % is % (want integer)', col, c_type; end if;
    if c_null then raise exception 'VW-17 FAILED: % must be NOT NULL', col; end if;
    if c_default <> '0' then raise exception 'VW-17 FAILED: % default is % (want 0)', col, c_default; end if;
  end loop;

  select string_agg(distinct r.rolname, ',') into leaked
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  cross join lateral aclexplode(p.proacl) a
  join pg_roles r on r.oid=a.grantee
  where n.nspname='public' and p.proname='bump_text_enablement_counter'
    and a.privilege_type='EXECUTE'
    and r.rolname in ('public','anon','authenticated');
  if leaked is not null then
    raise exception 'VW-17 FAILED: bump_text_enablement_counter leaked EXECUTE to %', leaked;
  end if;
  perform 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='bump_text_enablement_counter';
  if not found then raise exception 'VW-17 FAILED: bump_text_enablement_counter missing'; end if;

  raise notice 'VW-17 PASSED: lifetime-cap columns + service-role-only bump RPC present';
end $$;

-- ===========================================================================
-- VW-18. bump_text_enablement_counter — the atomic guarded increment: counts
--        up to the cap, returns allowed=false at the cap WITHOUT incrementing,
--        never touches a mismatched (order, company) pair, and each counter is
--        independent. Uses the VW-11 order (provisioning_key 'te-key-1').
-- ===========================================================================
do $$
declare ord_id uuid; res jsonb; vr int; rc int; ok boolean := false;
begin
  select id into ord_id from public.text_enablement_orders where provisioning_key='te-key-1';
  if ord_id is null then raise exception 'VW-18 FAILED: fixture order missing'; end if;

  -- Two units of a cap-2 budget count 1, 2 …
  res := public.bump_text_enablement_counter(ord_id, 'facade00-0000-4000-8000-000000000002', 'verification_requests', 2);
  if (res->>'allowed')::boolean is not true or (res->>'count')::int <> 1 then
    raise exception 'VW-18 FAILED: first bump expected allowed/count=1, got %', res;
  end if;
  res := public.bump_text_enablement_counter(ord_id, 'facade00-0000-4000-8000-000000000002', 'verification_requests', 2);
  if (res->>'allowed')::boolean is not true or (res->>'count')::int <> 2 then
    raise exception 'VW-18 FAILED: second bump expected allowed/count=2, got %', res;
  end if;
  -- … and the third is refused, leaving the counter AT the cap.
  res := public.bump_text_enablement_counter(ord_id, 'facade00-0000-4000-8000-000000000002', 'verification_requests', 2);
  if (res->>'allowed')::boolean is not false then
    raise exception 'VW-18 FAILED: capped bump expected allowed=false, got %', res;
  end if;
  select verification_requests, resubmit_count into vr, rc
    from public.text_enablement_orders where id=ord_id;
  if vr <> 2 then raise exception 'VW-18 FAILED: capped bump incremented past the cap (%)', vr; end if;
  if rc <> 0 then raise exception 'VW-18 FAILED: verification bumps leaked into resubmit_count (%)', rc; end if;

  -- resubmit_count is its own budget.
  res := public.bump_text_enablement_counter(ord_id, 'facade00-0000-4000-8000-000000000002', 'resubmit_count', 5);
  if (res->>'allowed')::boolean is not true or (res->>'count')::int <> 1 then
    raise exception 'VW-18 FAILED: resubmit bump expected allowed/count=1, got %', res;
  end if;

  -- A mismatched company (the VW-15 rival) never increments — backstop for a
  -- caller that skipped the company-scoped load.
  res := public.bump_text_enablement_counter(ord_id, 'facade00-0000-4000-8000-000000000022', 'verification_requests', 100);
  if (res->>'allowed')::boolean is not false then
    raise exception 'VW-18 FAILED: cross-company bump expected allowed=false, got %', res;
  end if;
  select verification_requests into vr from public.text_enablement_orders where id=ord_id;
  if vr <> 2 then raise exception 'VW-18 FAILED: cross-company bump incremented (%)', vr; end if;

  -- An unknown counter name raises (never a silent no-op).
  begin
    res := public.bump_text_enablement_counter(ord_id, 'facade00-0000-4000-8000-000000000002', 'attempts', 10);
    raise exception 'VW-18 FAILED: unknown counter was accepted';
  exception when others then
    if sqlerrm not like '%unknown counter%' then raise; end if;
    ok := true;
  end;
  if not ok then raise exception 'VW-18 FAILED: expected unknown-counter to raise'; end if;

  raise notice 'VW-18 PASSED: bump_text_enablement_counter increments atomically and stops at the cap';
end $$;

rollback;
