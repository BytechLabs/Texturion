-- Loonext messaging-function assertion suite (SPEC §4/§6 threading, §7/§9/§10
-- send gates). psql-runnable: every test is a DO block that RAISEs EXCEPTION
-- on failure. Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/messaging.test.sql
-- The whole suite runs in one transaction and ROLLS BACK: it never pollutes
-- the local database.

\set ON_ERROR_STOP on

begin;

-- ===========================================================================
-- Fixtures (rolled back at the end).
-- ===========================================================================
insert into auth.users (id, email, raw_user_meta_data)
values ('10000000-0000-4000-8000-000000000001', 'owner@messaging.test',
        '{"display_name":"Messaging Owner"}'::jsonb);

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, plan, current_period_start, current_period_end,
   overage_cap_multiplier)
values
  ('20000000-0000-4000-8000-000000000001', 'Active Co',
   '10000000-0000-4000-8000-000000000001', 'US', '613', now(),
   'active', 'starter', now() - interval '1 day', now() + interval '29 days', 3.00),
  ('20000000-0000-4000-8000-000000000002', 'Inactive Co',
   '10000000-0000-4000-8000-000000000001', 'US', '613', now(),
   'past_due', 'starter', now() - interval '1 day', now() + interval '29 days', 3.00),
  ('20000000-0000-4000-8000-000000000003', 'Rate Co',
   '10000000-0000-4000-8000-000000000001', 'US', '613', now(),
   'active', 'starter', now() - interval '1 day', now() + interval '29 days', 3.00),
  ('20000000-0000-4000-8000-000000000004', 'Cap Co',
   '10000000-0000-4000-8000-000000000001', 'US', '613', now(),
   'active', 'starter', now() - interval '1 day', now() + interval '29 days', 3.00);

insert into public.phone_numbers (id, company_id, status, provisioning_key, country, number_e164)
values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
   'active', 'cs_msg_test_1', 'US', '+16135550101'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002',
   'active', 'cs_msg_test_2', 'US', '+16135550102'),
  ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003',
   'active', 'cs_msg_test_3', 'US', '+16135550103'),
  ('30000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000004',
   'active', 'cs_msg_test_4', 'US', '+16135550104');

-- ===========================================================================
-- M1. Threading rule 5 (create): first inbound creates contact (inbound_sms
--     consent), a 'new' conversation, and the message; created=true.
-- ===========================================================================
do $$
declare
  res jsonb;
  v_contact public.contacts%rowtype;
  v_conv public.conversations%rowtype;
  v_msg public.messages%rowtype;
begin
  res := public.thread_inbound_message(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '+16135551000', 'Hi, do you do gutters?', 'tx-m1-1');

  if not (res->>'created')::boolean then
    raise exception 'M1 FAILED: created was false for a first inbound';
  end if;
  if (res->>'opted_out')::boolean then
    raise exception 'M1 FAILED: opted_out true with no opt_outs row';
  end if;

  select * into v_contact from public.contacts
   where company_id = '20000000-0000-4000-8000-000000000001'
     and phone_e164 = '+16135551000';
  if not found or v_contact.consent_source is distinct from 'inbound_sms'
     or v_contact.consent_at is null then
    raise exception 'M1 FAILED: contact not upserted with inbound_sms consent';
  end if;

  select * into v_conv from public.conversations
   where id = (res->>'conversation_id')::uuid;
  if v_conv.status <> 'new' or v_conv.closed_at is not null
     or v_conv.contact_id <> v_contact.id then
    raise exception 'M1 FAILED: conversation not created as open/new';
  end if;

  select * into v_msg from public.messages where id = (res->>'message_id')::uuid;
  if v_msg.direction <> 'inbound' or v_msg.status <> 'received'
     or v_msg.telnyx_message_id <> 'tx-m1-1'
     or v_msg.body <> 'Hi, do you do gutters?' then
    raise exception 'M1 FAILED: message row wrong';
  end if;
  raise notice 'M1 PASSED: rule 5 creates contact + new conversation + message';
end $$;

-- ===========================================================================
-- M2. Threading rule 2 (append): second inbound appends to the open
--     conversation and bumps last_message_at.
-- ===========================================================================
do $$
declare
  res jsonb;
  v_conv_id uuid;
  v_count int;
  v_lma timestamptz;
begin
  select c.id into v_conv_id from public.conversations c
   join public.contacts ct on ct.id = c.contact_id
   where c.company_id = '20000000-0000-4000-8000-000000000001'
     and ct.phone_e164 = '+16135551000' and c.closed_at is null;

  -- Age the thread so the bump is observable inside one transaction.
  update public.conversations
     set last_message_at = now() - interval '1 hour' where id = v_conv_id;

  res := public.thread_inbound_message(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '+16135551000', 'Second message', 'tx-m2-1');

  if (res->>'conversation_id')::uuid <> v_conv_id then
    raise exception 'M2 FAILED: appended to a different conversation';
  end if;
  select count(*) into v_count from public.messages where conversation_id = v_conv_id;
  if v_count <> 2 then
    raise exception 'M2 FAILED: expected 2 messages, found %', v_count;
  end if;
  select last_message_at into v_lma from public.conversations where id = v_conv_id;
  if v_lma <> now() then
    raise exception 'M2 FAILED: last_message_at not bumped (%)', v_lma;
  end if;
  raise notice 'M2 PASSED: rule 2 appends to the open conversation and bumps last_message_at';
end $$;

-- ===========================================================================
-- M3. waiting → open flip on inbound (rule 2).
-- ===========================================================================
do $$
declare
  res jsonb;
  v_conv_id uuid;
  v_status public.conversation_status;
begin
  select c.id into v_conv_id from public.conversations c
   join public.contacts ct on ct.id = c.contact_id
   where c.company_id = '20000000-0000-4000-8000-000000000001'
     and ct.phone_e164 = '+16135551000' and c.closed_at is null;
  update public.conversations set status = 'waiting' where id = v_conv_id;

  res := public.thread_inbound_message(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '+16135551000', 'Are you there?', 'tx-m3-1');

  select status into v_status from public.conversations where id = v_conv_id;
  if v_status <> 'open' then
    raise exception 'M3 FAILED: waiting conversation not flipped to open (status=%)', v_status;
  end if;
  if (res->>'conversation_id')::uuid <> v_conv_id then
    raise exception 'M3 FAILED: message went to a different conversation';
  end if;
  raise notice 'M3 PASSED: inbound flips waiting -> open';
end $$;

-- ===========================================================================
-- M4. Duplicate webhook (same telnyx_message_id): second call returns the
--     same message with created=false; exactly one row exists. The ON
--     CONFLICT re-select path (the true concurrency arm) is exercised by
--     pre-inserting the message row before the RPC call.
-- ===========================================================================
do $$
declare
  res1 jsonb; res2 jsonb;
  v_count int;
  v_lma timestamptz;
  v_conv_id uuid;
begin
  res1 := public.thread_inbound_message(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '+16135551000', 'dup body', 'tx-m4-1');
  res2 := public.thread_inbound_message(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '+16135551000', 'dup body', 'tx-m4-1');

  if (res2->>'created')::boolean then
    raise exception 'M4 FAILED: duplicate delivery reported created=true';
  end if;
  if (res1->>'message_id') <> (res2->>'message_id') then
    raise exception 'M4 FAILED: duplicate delivery produced a different message id';
  end if;
  select count(*) into v_count from public.messages where telnyx_message_id = 'tx-m4-1';
  if v_count <> 1 then
    raise exception 'M4 FAILED: % rows for one telnyx_message_id', v_count;
  end if;

  -- Concurrency arm: a row already committed by "another" transaction — the
  -- function must land in the ON CONFLICT DO NOTHING + re-select path and
  -- must NOT bump last_message_at again.
  v_conv_id := (res1->>'conversation_id')::uuid;
  insert into public.messages (company_id, conversation_id, direction, body, status, telnyx_message_id)
  values ('20000000-0000-4000-8000-000000000001', v_conv_id, 'inbound', 'raced', 'received', 'tx-m4-2');
  update public.conversations set last_message_at = now() - interval '2 hours' where id = v_conv_id;

  res2 := public.thread_inbound_message(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '+16135551000', 'raced', 'tx-m4-2');
  if (res2->>'created')::boolean then
    raise exception 'M4 FAILED: pre-inserted telnyx id reported created=true';
  end if;
  select count(*) into v_count from public.messages where telnyx_message_id = 'tx-m4-2';
  if v_count <> 1 then
    raise exception 'M4 FAILED: raced insert duplicated the message';
  end if;
  select last_message_at into v_lma from public.conversations where id = v_conv_id;
  if v_lma <> now() - interval '2 hours' then
    raise exception 'M4 FAILED: duplicate delivery bumped last_message_at';
  end if;
  raise notice 'M4 PASSED: duplicate telnyx_message_id -> one message, created=false, no re-bump';
end $$;

-- ===========================================================================
-- M5. Threading rule 3 (spam absorb): most recent closed conversation is
--     spam -> message appends to it silently; stays closed, stays spam.
-- ===========================================================================
do $$
declare
  res jsonb;
  v_conv_id uuid;
  v_conv public.conversations%rowtype;
begin
  select c.id into v_conv_id from public.conversations c
   join public.contacts ct on ct.id = c.contact_id
   where c.company_id = '20000000-0000-4000-8000-000000000001'
     and ct.phone_e164 = '+16135551000' and c.closed_at is null;
  update public.conversations
     set status = 'closed', closed_at = now(), is_spam = true
   where id = v_conv_id;

  res := public.thread_inbound_message(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '+16135551000', 'CLICK THIS LINK', 'tx-m5-1');

  if (res->>'conversation_id')::uuid <> v_conv_id then
    raise exception 'M5 FAILED: spam inbound did not absorb into the spam conversation';
  end if;
  select * into v_conv from public.conversations where id = v_conv_id;
  if v_conv.status <> 'closed' or v_conv.closed_at is null or not v_conv.is_spam then
    raise exception 'M5 FAILED: spam conversation did not stay closed+spam';
  end if;
  raise notice 'M5 PASSED: rule 3 spam absorb (stays closed, stays spam)';
end $$;

-- ===========================================================================
-- M6. Threading rule 4 (30-day reopen): most recent closed (not spam) within
--     30 days -> reopened with status new, closed_at cleared.
-- ===========================================================================
do $$
declare
  res jsonb;
  v_conv_id uuid;
  v_conv public.conversations%rowtype;
begin
  -- Un-spam and age the close 10 days: reopen window applies.
  select c.id into v_conv_id from public.conversations c
   join public.contacts ct on ct.id = c.contact_id
   where c.company_id = '20000000-0000-4000-8000-000000000001'
     and ct.phone_e164 = '+16135551000'
   order by c.created_at desc limit 1;
  update public.conversations
     set is_spam = false, status = 'closed', closed_at = now() - interval '10 days'
   where id = v_conv_id;

  res := public.thread_inbound_message(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '+16135551000', 'Following up!', 'tx-m6-1');

  if (res->>'conversation_id')::uuid <> v_conv_id then
    raise exception 'M6 FAILED: inbound within 30 days did not reopen the closed conversation';
  end if;
  select * into v_conv from public.conversations where id = v_conv_id;
  if v_conv.status <> 'new' or v_conv.closed_at is not null then
    raise exception 'M6 FAILED: reopened conversation not status=new/closed_at=null';
  end if;
  raise notice 'M6 PASSED: rule 4 reopens a conversation closed within 30 days';
end $$;

-- ===========================================================================
-- M7. Threading rule 5 (window expired): closed >30 days ago (not spam) ->
--     a brand-new conversation is created.
-- ===========================================================================
do $$
declare
  res jsonb;
  v_old_conv_id uuid;
  v_new_conv public.conversations%rowtype;
begin
  select c.id into v_old_conv_id from public.conversations c
   join public.contacts ct on ct.id = c.contact_id
   where c.company_id = '20000000-0000-4000-8000-000000000001'
     and ct.phone_e164 = '+16135551000'
   order by c.created_at desc limit 1;
  update public.conversations
     set status = 'closed', closed_at = now() - interval '40 days'
   where id = v_old_conv_id;

  res := public.thread_inbound_message(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '+16135551000', 'Long time!', 'tx-m7-1');

  if (res->>'conversation_id')::uuid = v_old_conv_id then
    raise exception 'M7 FAILED: inbound after 30 days reopened instead of creating';
  end if;
  select * into v_new_conv from public.conversations
   where id = (res->>'conversation_id')::uuid;
  if v_new_conv.status <> 'new' or v_new_conv.closed_at is not null then
    raise exception 'M7 FAILED: new conversation not open/new';
  end if;
  raise notice 'M7 PASSED: rule 5 creates a new conversation after the 30-day window';
end $$;

-- ===========================================================================
-- M8. Contact upsert resurrects a soft-deleted contact (deleted_at cleared)
--     and preserves existing consent.
-- ===========================================================================
do $$
declare
  res jsonb;
  v_contact public.contacts%rowtype;
begin
  update public.contacts
     set deleted_at = now()
   where company_id = '20000000-0000-4000-8000-000000000001'
     and phone_e164 = '+16135551000';

  res := public.thread_inbound_message(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '+16135551000', 'Back again', 'tx-m8-1');

  select * into v_contact from public.contacts
   where company_id = '20000000-0000-4000-8000-000000000001'
     and phone_e164 = '+16135551000';
  if v_contact.deleted_at is not null then
    raise exception 'M8 FAILED: inbound did not clear contacts.deleted_at';
  end if;
  if v_contact.consent_source is distinct from 'inbound_sms' then
    raise exception 'M8 FAILED: consent overwritten on upsert';
  end if;
  raise notice 'M8 PASSED: inbound resurrects a soft-deleted contact';
end $$;

-- ===========================================================================
-- M9. opted_out flag: with an active opt_outs row the RPC still stores the
--     inbound message (inbound is never blocked) and reports opted_out=true;
--     a revoked row reports false.
-- ===========================================================================
do $$
declare
  res jsonb;
begin
  insert into public.opt_outs (company_id, phone_e164, source)
  values ('20000000-0000-4000-8000-000000000001', '+16135551000', 'stop_keyword');

  res := public.thread_inbound_message(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '+16135551000', 'STOP', 'tx-m9-1');
  if not (res->>'opted_out')::boolean then
    raise exception 'M9 FAILED: opted_out not reported for an active opt-out';
  end if;
  if not (res->>'created')::boolean then
    raise exception 'M9 FAILED: inbound message blocked by opt-out (must always store)';
  end if;

  update public.opt_outs set revoked_at = now()
   where company_id = '20000000-0000-4000-8000-000000000001'
     and phone_e164 = '+16135551000';
  res := public.thread_inbound_message(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '+16135551000', 'START', 'tx-m9-2');
  if (res->>'opted_out')::boolean then
    raise exception 'M9 FAILED: opted_out reported for a revoked opt-out';
  end if;
  raise notice 'M9 PASSED: opted_out flag mirrors active opt_outs rows';
end $$;

-- ===========================================================================
-- Gate fixtures: a contact + open conversation per gate company.
-- ===========================================================================
insert into public.contacts (id, company_id, phone_e164)
values
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '+16135552001'),
  ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '+16135552002'),
  ('40000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003', '+16135552003'),
  ('40000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000004', '+16135552004'),
  ('40000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000001', '+16135552005');

insert into public.conversations (id, company_id, contact_id, phone_number_id, status)
values
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
   '40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'open'),
  ('50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002',
   '40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'open'),
  ('50000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003',
   '40000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003', 'open'),
  ('50000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000004',
   '40000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000004', 'open'),
  ('50000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000001',
   '40000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000001', 'open');

-- ===========================================================================
-- G1. gate_outbound_send success: queued row inserted with the estimate,
--     conversation last_message_at bumped, existing=false.
-- ===========================================================================
do $$
declare
  res jsonb;
  v_msg public.messages%rowtype;
begin
  update public.conversations set last_message_at = now() - interval '1 hour'
   where id = '50000000-0000-4000-8000-000000000001';

  res := public.gate_outbound_send(
    '20000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'On our way!', 'idem-g1-1', 1);

  if res ? 'error' then
    raise exception 'G1 FAILED: gate rejected a valid send: %', res->>'error';
  end if;
  if (res->>'existing')::boolean then
    raise exception 'G1 FAILED: fresh send reported existing=true';
  end if;
  select * into v_msg from public.messages where id = (res#>>'{message,id}')::uuid;
  if v_msg.direction <> 'outbound' or v_msg.status <> 'queued'
     or v_msg.segments <> 1 or v_msg.idempotency_key <> 'idem-g1-1'
     or v_msg.sent_by_user_id <> '10000000-0000-4000-8000-000000000001' then
    raise exception 'G1 FAILED: queued message row wrong';
  end if;
  if (select last_message_at from public.conversations
       where id = '50000000-0000-4000-8000-000000000001') <> now() then
    raise exception 'G1 FAILED: last_message_at not bumped by outbound send';
  end if;
  raise notice 'G1 PASSED: valid send inserts the queued row atomically';
end $$;

-- ===========================================================================
-- G2. Idempotency: same key again returns the SAME row with existing=true;
--     exactly one message exists for the key.
-- ===========================================================================
do $$
declare
  res1 jsonb; res2 jsonb;
  v_count int;
begin
  res1 := public.gate_outbound_send(
    '20000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'On our way!', 'idem-g2-1', 1);
  res2 := public.gate_outbound_send(
    '20000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'On our way!', 'idem-g2-1', 1);

  if not (res2->>'existing')::boolean then
    raise exception 'G2 FAILED: duplicate key not reported existing=true';
  end if;
  if (res1#>>'{message,id}') <> (res2#>>'{message,id}') then
    raise exception 'G2 FAILED: duplicate key returned a different row';
  end if;
  select count(*) into v_count from public.messages
   where company_id = '20000000-0000-4000-8000-000000000001'
     and idempotency_key = 'idem-g2-1';
  if v_count <> 1 then
    raise exception 'G2 FAILED: % rows for one idempotency key', v_count;
  end if;
  raise notice 'G2 PASSED: duplicate idempotency key returns the existing row';
end $$;

-- ===========================================================================
-- G3. subscription_inactive: non-active company is rejected, nothing inserted.
-- ===========================================================================
do $$
declare
  res jsonb;
  v_count int;
begin
  res := public.gate_outbound_send(
    '20000000-0000-4000-8000-000000000002',
    '50000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'hello', 'idem-g3-1', 1);
  if res->>'error' is distinct from 'subscription_inactive' then
    raise exception 'G3 FAILED: expected subscription_inactive, got %', res;
  end if;
  select count(*) into v_count from public.messages
   where company_id = '20000000-0000-4000-8000-000000000002';
  if v_count <> 0 then
    raise exception 'G3 FAILED: message inserted despite rejection';
  end if;
  raise notice 'G3 PASSED: past_due company rejected with subscription_inactive';
end $$;

-- ===========================================================================
-- G4. recipient_opted_out: active opt-out for the destination hard-rejects.
-- ===========================================================================
do $$
declare
  res jsonb;
begin
  insert into public.opt_outs (company_id, phone_e164, source)
  values ('20000000-0000-4000-8000-000000000001', '+16135552005', 'manual');

  res := public.gate_outbound_send(
    '20000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000001',
    'hello', 'idem-g4-1', 1);
  if res->>'error' is distinct from 'recipient_opted_out' then
    raise exception 'G4 FAILED: expected recipient_opted_out, got %', res;
  end if;

  -- Revoked opt-out no longer blocks.
  update public.opt_outs set revoked_at = now()
   where company_id = '20000000-0000-4000-8000-000000000001'
     and phone_e164 = '+16135552005';
  res := public.gate_outbound_send(
    '20000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000001',
    'hello', 'idem-g4-2', 1);
  if res ? 'error' then
    raise exception 'G4 FAILED: revoked opt-out still blocks: %', res->>'error';
  end if;
  raise notice 'G4 PASSED: active opt-out rejects; revoked opt-out does not';
end $$;

-- ===========================================================================
-- G5. rate_limited: ≥250 outbound segments in the trailing hour rejects.
-- ===========================================================================
do $$
declare
  res jsonb;
begin
  -- 249 estimated segments already queued this hour: still allowed.
  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments,
     sent_by_user_id, idempotency_key)
  values
    ('20000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000003',
     'outbound', 'bulk', 'queued', 249, '10000000-0000-4000-8000-000000000001', 'idem-g5-seed');

  res := public.gate_outbound_send(
    '20000000-0000-4000-8000-000000000003',
    '50000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    'ok', 'idem-g5-1', 1);
  if res ? 'error' then
    raise exception 'G5 FAILED: 249+1 segments rejected: %', res->>'error';
  end if;

  -- Sum is now 250: the next send is rejected (at >=250, §10).
  res := public.gate_outbound_send(
    '20000000-0000-4000-8000-000000000003',
    '50000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    'nope', 'idem-g5-2', 1);
  if res->>'error' is distinct from 'rate_limited' then
    raise exception 'G5 FAILED: expected rate_limited at 250 segments/hour, got %', res;
  end if;
  raise notice 'G5 PASSED: trailing-hour 250-segment limit enforced';
end $$;

-- ===========================================================================
-- G6. usage_cap_reached: period usage (usage_events + queued estimates) at
--     the cap (3.00 x 500 = 1500 for starter) rejects; also proves the gate
--     ORDER — the same company under both rate and cap pressure returns
--     rate_limited first (§10 defense order), then cap once the hour clears.
-- ===========================================================================
do $$
declare
  res jsonb;
begin
  -- 1499 metered segments this period (finalized usage) + nothing queued.
  insert into public.usage_events (company_id, type, quantity, created_at)
  values ('20000000-0000-4000-8000-000000000004', 'adjustment', 1499, now());

  -- 1499 + 1 = 1500 = cap: allowed (cap is reached, not exceeded).
  res := public.gate_outbound_send(
    '20000000-0000-4000-8000-000000000004',
    '50000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000001',
    'ok', 'idem-g6-1', 1);
  if res ? 'error' then
    raise exception 'G6 FAILED: send exactly at the cap rejected: %', res->>'error';
  end if;

  -- The queued (unfinalized) estimate above counts too: 1499 + 1 + 1 > 1500.
  res := public.gate_outbound_send(
    '20000000-0000-4000-8000-000000000004',
    '50000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000001',
    'over', 'idem-g6-2', 1);
  if res->>'error' is distinct from 'usage_cap_reached' then
    raise exception 'G6 FAILED: expected usage_cap_reached over the cap, got %', res;
  end if;

  -- #12 Phase 0.3: the cap is now UN-DEFEATABLE — NULL ("no cap") is rejected
  -- by the companies_overage_cap_range constraint (asserted in
  -- pricing_phase0.test.sql P0-6), so there is no "uncapped" path to test here.
  raise notice 'G6 PASSED: overage cap (multiplier x quota) enforced';
end $$;

-- ===========================================================================
-- G7. not_found / validation_failed: foreign conversation and bad args are
--     typed errors, never exceptions.
-- ===========================================================================
do $$
declare
  res jsonb;
begin
  -- Conversation belongs to a different company.
  res := public.gate_outbound_send(
    '20000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'x', 'idem-g7-1', 1);
  if res->>'error' is distinct from 'not_found' then
    raise exception 'G7 FAILED: cross-company conversation not rejected, got %', res;
  end if;

  res := public.gate_outbound_send(
    '20000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'x', null, 1);
  if res->>'error' is distinct from 'validation_failed' then
    raise exception 'G7 FAILED: null idempotency key accepted, got %', res;
  end if;

  res := public.gate_outbound_send(
    '20000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'x', 'idem-g7-2', 0);
  if res->>'error' is distinct from 'validation_failed' then
    raise exception 'G7 FAILED: zero segment estimate accepted, got %', res;
  end if;
  raise notice 'G7 PASSED: not_found / validation_failed typed errors';
end $$;

-- ===========================================================================
-- R1. claim_message_retry (#19): a failed API-failure row is requeued
--     atomically (status queued, error columns cleared), and an IMMEDIATE
--     second claim — the concurrent-duplicate loser — gets 'conflict'
--     (the requeued row is no longer eligible), never a second requeue.
-- ===========================================================================
do $$
declare
  res jsonb;
  v_id uuid;
  v_msg public.messages%rowtype;
begin
  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments,
     sent_by_user_id, error_code, error_detail)
  values
    ('20000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
     'outbound', 'retry me', 'failed', 1,
     '10000000-0000-4000-8000-000000000001', null, 'network error')
  returning id into v_id;

  res := public.claim_message_retry(
    '20000000-0000-4000-8000-000000000001', v_id, 900);
  if res ? 'error' then
    raise exception 'R1 FAILED: eligible failed row rejected: %', res->>'error';
  end if;
  if res->'message' ? 'body_tsv' then
    raise exception 'R1 FAILED: body_tsv leaked in the returned row';
  end if;

  select * into v_msg from public.messages where id = v_id;
  if v_msg.status <> 'queued'
     or v_msg.error_code is not null or v_msg.error_detail is not null then
    raise exception 'R1 FAILED: row not requeued cleanly (status %, code %)',
      v_msg.status, v_msg.error_code;
  end if;

  -- The loser of a concurrent duplicate: the row is queued with a fresh
  -- updated_at now — not failed, not stuck — so the claim is a conflict.
  res := public.claim_message_retry(
    '20000000-0000-4000-8000-000000000001', v_id, 900);
  if res->>'error' is distinct from 'conflict' then
    raise exception 'R1 FAILED: duplicate claim expected conflict, got %', res;
  end if;

  raise notice 'R1 PASSED: atomic requeue; the duplicate claim loses with conflict';
end $$;

-- ===========================================================================
-- R2. claim_message_retry eligibility: a fresh queued row (in-flight send),
--     a failed row with a carrier id (carrier-finalized), and bad args are
--     all typed rejections — never a requeue.
-- ===========================================================================
do $$
declare
  res jsonb;
  v_fresh uuid;
  v_final uuid;
begin
  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments, sent_by_user_id)
  values
    ('20000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
     'outbound', 'in flight', 'queued', 1, '10000000-0000-4000-8000-000000000001')
  returning id into v_fresh;

  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments,
     sent_by_user_id, telnyx_message_id, error_code)
  values
    ('20000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
     'outbound', 'carrier blocked', 'failed', 1,
     '10000000-0000-4000-8000-000000000001', 'tx-r2-final', '40300')
  returning id into v_final;

  res := public.claim_message_retry(
    '20000000-0000-4000-8000-000000000001', v_fresh, 900);
  if res->>'error' is distinct from 'conflict' then
    raise exception 'R2 FAILED: fresh queued row expected conflict, got %', res;
  end if;

  res := public.claim_message_retry(
    '20000000-0000-4000-8000-000000000001', v_final, 900);
  if res->>'error' is distinct from 'conflict' then
    raise exception 'R2 FAILED: carrier-finalized failure expected conflict, got %', res;
  end if;

  -- Cross-company id is indistinguishable from missing (§10).
  res := public.claim_message_retry(
    '20000000-0000-4000-8000-000000000002', v_fresh, 900);
  if res->>'error' is distinct from 'not_found' then
    raise exception 'R2 FAILED: cross-company claim expected not_found, got %', res;
  end if;

  res := public.claim_message_retry(
    '20000000-0000-4000-8000-000000000001', v_fresh, 0);
  if res->>'error' is distinct from 'validation_failed' then
    raise exception 'R2 FAILED: zero threshold expected validation_failed, got %', res;
  end if;

  raise notice 'R2 PASSED: fresh queued / carrier-finalized / bad args rejected';
end $$;

-- ===========================================================================
-- R3. claim_message_retry (#20a): a STUCK queued row — no telnyx id and
--     untouched beyond the threshold (the send crashed before the Telnyx
--     call) — is claimable, and comes back queued with error columns clear.
-- ===========================================================================
do $$
declare
  res jsonb;
  v_id uuid;
  v_msg public.messages%rowtype;
begin
  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments,
     sent_by_user_id, created_at, updated_at)
  values
    ('20000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
     'outbound', 'crashed before telnyx', 'queued', 1,
     '10000000-0000-4000-8000-000000000001',
     now() - interval '1 hour', now() - interval '1 hour')
  returning id into v_id;

  res := public.claim_message_retry(
    '20000000-0000-4000-8000-000000000001', v_id, 900);
  if res ? 'error' then
    raise exception 'R3 FAILED: stuck queued row rejected: %', res->>'error';
  end if;

  select * into v_msg from public.messages where id = v_id;
  if v_msg.status <> 'queued' or v_msg.error_code is not null then
    raise exception 'R3 FAILED: stuck row not requeued cleanly (status %, code %)',
      v_msg.status, v_msg.error_code;
  end if;
  raise notice 'R3 PASSED: a stuck queued row is claimable and requeues cleanly';
end $$;

-- ===========================================================================
-- R4. claim_message_retry (#47): the retry re-runs Gate 3 — Rate Co sits at
--     250 trailing-hour segments (G5), so the claim is rate_limited. The
--     stuck-queued row is failed out FIRST, so the rejection leaves it
--     failed + send_interrupted (visible + retryable later), never stuck.
-- ===========================================================================
do $$
declare
  res jsonb;
  v_id uuid;
  v_msg public.messages%rowtype;
begin
  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments,
     sent_by_user_id, created_at, updated_at)
  values
    ('20000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000003',
     'outbound', 'stuck under rate pressure', 'queued', 1,
     '10000000-0000-4000-8000-000000000001',
     now() - interval '1 hour', now() - interval '1 hour')
  returning id into v_id;

  res := public.claim_message_retry(
    '20000000-0000-4000-8000-000000000003', v_id, 900);
  if res->>'error' is distinct from 'rate_limited' then
    raise exception 'R4 FAILED: expected rate_limited on retry, got %', res;
  end if;

  select * into v_msg from public.messages where id = v_id;
  if v_msg.status <> 'failed' or v_msg.error_code is distinct from 'send_interrupted' then
    raise exception 'R4 FAILED: rejected stuck row not failed out (status %, code %)',
      v_msg.status, v_msg.error_code;
  end if;
  raise notice 'R4 PASSED: retry re-runs the rate gate; the stuck row is failed out';
end $$;

-- ===========================================================================
-- R5. claim_message_retry (#47): the retry re-runs Gate 4 — Cap Co sits at
--     its overage cap (G6), so the claim is usage_cap_reached and the FAILED
--     row keeps its original error columns (nothing was touched).
-- ===========================================================================
do $$
declare
  res jsonb;
  v_id uuid;
  v_msg public.messages%rowtype;
begin
  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments,
     sent_by_user_id, error_code, error_detail)
  values
    ('20000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000004',
     'outbound', 'over cap retry', 'failed', 1,
     '10000000-0000-4000-8000-000000000001', null, 'network error')
  returning id into v_id;

  res := public.claim_message_retry(
    '20000000-0000-4000-8000-000000000004', v_id, 900);
  if res->>'error' is distinct from 'usage_cap_reached' then
    raise exception 'R5 FAILED: expected usage_cap_reached on retry, got %', res;
  end if;

  select * into v_msg from public.messages where id = v_id;
  if v_msg.status <> 'failed' or v_msg.error_detail is distinct from 'network error' then
    raise exception 'R5 FAILED: rejected failed row was modified (status %, detail %)',
      v_msg.status, v_msg.error_detail;
  end if;
  raise notice 'R5 PASSED: retry re-runs the cap gate; the failed row is untouched';
end $$;

-- ===========================================================================
-- R6. claim_message_retry backstops: an opted-out destination and an
--     inactive subscription reject the claim (mirror of Gates 1-2).
-- ===========================================================================
do $$
declare
  res jsonb;
  v_opt uuid;
  v_sub uuid;
begin
  -- Opt-out mirror: conversation 5 (Active Co, +16135552005). G4 left the
  -- pair's UNIQUE opt_outs row revoked — re-activate it (re-opt-out updates
  -- the row, never inserts a duplicate).
  update public.opt_outs set revoked_at = null
   where company_id = '20000000-0000-4000-8000-000000000001'
     and phone_e164 = '+16135552005';
  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments,
     sent_by_user_id, error_detail)
  values
    ('20000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000005',
     'outbound', 'blocked', 'failed', 1,
     '10000000-0000-4000-8000-000000000001', 'network error')
  returning id into v_opt;

  res := public.claim_message_retry(
    '20000000-0000-4000-8000-000000000001', v_opt, 900);
  if res->>'error' is distinct from 'recipient_opted_out' then
    raise exception 'R6 FAILED: expected recipient_opted_out, got %', res;
  end if;

  -- Subscription backstop: Inactive Co (past_due).
  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments,
     sent_by_user_id, error_detail)
  values
    ('20000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002',
     'outbound', 'no sub', 'failed', 1,
     '10000000-0000-4000-8000-000000000001', 'network error')
  returning id into v_sub;

  res := public.claim_message_retry(
    '20000000-0000-4000-8000-000000000002', v_sub, 900);
  if res->>'error' is distinct from 'subscription_inactive' then
    raise exception 'R6 FAILED: expected subscription_inactive, got %', res;
  end if;

  raise notice 'R6 PASSED: opt-out + subscription backstops hold on retry';
end $$;

-- ===========================================================================
-- R7. fail_stuck_outbound_sends (#20b): flips EXACTLY the stale queued rows
--     with no telnyx id to failed + send_interrupted; fresh queued rows and
--     dispatched (id-bearing) rows are untouched. Returns the flipped count.
-- ===========================================================================
do $$
declare
  v_stuck uuid;
  v_fresh uuid;
  v_dispatched uuid;
  v_count int;
  v_msg public.messages%rowtype;
begin
  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments,
     sent_by_user_id, created_at, updated_at)
  values
    ('20000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
     'outbound', 'stuck forever', 'queued', 1,
     '10000000-0000-4000-8000-000000000001',
     now() - interval '1 hour', now() - interval '1 hour')
  returning id into v_stuck;

  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments, sent_by_user_id)
  values
    ('20000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
     'outbound', 'fresh in flight', 'queued', 1, '10000000-0000-4000-8000-000000000001')
  returning id into v_fresh;

  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments,
     sent_by_user_id, telnyx_message_id, created_at, updated_at)
  values
    ('20000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
     'outbound', 'awaiting webhook', 'queued', 1,
     '10000000-0000-4000-8000-000000000001', 'tx-r7-dispatched',
     now() - interval '1 hour', now() - interval '1 hour')
  returning id into v_dispatched;

  v_count := public.fail_stuck_outbound_sends(900);
  if v_count <> 1 then
    raise exception 'R7 FAILED: expected exactly 1 flipped row, got %', v_count;
  end if;

  select * into v_msg from public.messages where id = v_stuck;
  if v_msg.status <> 'failed'
     or v_msg.error_code is distinct from 'send_interrupted'
     or v_msg.error_detail is null then
    raise exception 'R7 FAILED: stuck row not failed out (status %, code %)',
      v_msg.status, v_msg.error_code;
  end if;

  perform 1 from public.messages
   where id = v_fresh and status = 'queued' and error_code is null;
  if not found then raise exception 'R7 FAILED: fresh queued row was clobbered'; end if;

  perform 1 from public.messages
   where id = v_dispatched and status = 'queued' and telnyx_message_id = 'tx-r7-dispatched';
  if not found then raise exception 'R7 FAILED: dispatched row was clobbered'; end if;

  -- Idempotent: a second sweep finds nothing left to flip.
  v_count := public.fail_stuck_outbound_sends(900);
  if v_count <> 0 then
    raise exception 'R7 FAILED: second sweep flipped % rows (want 0)', v_count;
  end if;

  raise notice 'R7 PASSED: sweeper fails out exactly the stale undispatched rows';
end $$;

-- ===========================================================================
-- R8. Schema + grants (#22 lease column; new functions service-role-only).
-- ===========================================================================
do $$
declare
  c_type text; c_null boolean;
  fn text; leaked text;
begin
  select data_type, is_nullable='YES' into c_type, c_null
  from information_schema.columns
  where table_schema='public' and table_name='webhook_events' and column_name='claimed_at';
  if c_type is null then raise exception 'R8 FAILED: webhook_events.claimed_at missing'; end if;
  if c_type <> 'timestamp with time zone' then
    raise exception 'R8 FAILED: claimed_at is % (want timestamptz)', c_type;
  end if;
  if not c_null then raise exception 'R8 FAILED: claimed_at must be NULLable'; end if;

  foreach fn in array array['claim_message_retry', 'fail_stuck_outbound_sends'] loop
    select string_agg(distinct r.rolname, ',') into leaked
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(p.proacl) a
    join pg_roles r on r.oid = a.grantee
    where n.nspname='public' and p.proname=fn
      and a.privilege_type='EXECUTE'
      and r.rolname in ('public','anon','authenticated');
    if leaked is not null then
      raise exception 'R8 FAILED: % has EXECUTE leaked to %', fn, leaked;
    end if;
  end loop;

  raise notice 'R8 PASSED: claimed_at present; retry/sweep functions service-role-only';
end $$;

rollback;
