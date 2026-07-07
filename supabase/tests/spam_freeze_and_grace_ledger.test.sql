-- #49 + #54 assertion suite (migration 20260707180000).
--   * #49: spam-absorbed inbound (threading rule 3) must NOT bump
--     conversations.last_message_at — the surfacing/sort key stays FROZEN for
--     spam conversations so the closed/spam lists never resurface them (and
--     keyset pages never shift under a paginating client). Normal appends
--     still bump it.
--   * #54: grace_notices accepts the synthetic threshold_day 30 (the day-30
--     "number released" email ledger row) and still rejects everything
--     outside {1,15,27,30}.
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/tests/spam_freeze_and_grace_ledger.test.sql
-- The whole suite runs in one transaction and ROLLS BACK — it never pollutes
-- the local database. (now() is transaction-fixed, which these tests rely on.)
-- Distinct 18/28/38 fixture prefixes avoid collisions with the other suites
-- when the whole DB is exercised in one session.

\set ON_ERROR_STOP on

begin;

-- ===========================================================================
-- Fixtures (rolled back at the end).
-- ===========================================================================
insert into auth.users (id, email, raw_user_meta_data)
values ('18000000-0000-4000-8000-000000000001', 'owner@spamfreeze.test',
        '{"display_name":"Freeze Owner"}'::jsonb);

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, plan, current_period_start, current_period_end)
values
  ('28000000-0000-4000-8000-000000000001', 'Freeze Co',
   '18000000-0000-4000-8000-000000000001', 'US', '613', now(),
   'active', 'starter', now() - interval '1 day', now() + interval '29 days');

insert into public.phone_numbers (id, company_id, status, provisioning_key, country, number_e164)
values
  ('38000000-0000-4000-8000-000000000001', '28000000-0000-4000-8000-000000000001',
   'active', 'cs_spamfreeze_test_1', 'US', '+16135550401');

-- ===========================================================================
-- S1. Spam absorb (rule 3) never bumps last_message_at: the thread stays
--     closed, stays spam, keeps its frozen surfacing timestamp — and the
--     message row itself is still stored (inbound is never dropped, D6).
-- ===========================================================================
do $$
declare
  res       jsonb;
  v_conv_id uuid;
  v_frozen  timestamptz := now() - interval '2 days';
  v_conv    public.conversations%rowtype;
begin
  -- Seed the spam thread: first inbound creates it, then it is marked spam.
  res := public.thread_inbound_message(
    '28000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000001',
    '+16135554000', 'WIN A FREE CRUISE', 'tx-s1-1');
  v_conv_id := (res->>'conversation_id')::uuid;

  update public.conversations
     set status = 'closed', closed_at = v_frozen, is_spam = true,
         last_message_at = v_frozen, last_notified_at = null
   where id = v_conv_id;

  -- The spammer sends again: rule 3 absorbs silently.
  res := public.thread_inbound_message(
    '28000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000001',
    '+16135554000', 'CLICK THIS LINK NOW', 'tx-s1-2');

  if (res->>'conversation_id')::uuid <> v_conv_id then
    raise exception 'S1 FAILED: spam inbound did not absorb into the spam thread';
  end if;
  if not (res->>'created')::boolean then
    raise exception 'S1 FAILED: absorbed message was not stored';
  end if;
  if (res->>'notify')::boolean then
    raise exception 'S1 FAILED: spam absorb claimed a notification';
  end if;

  select c.* into v_conv from public.conversations c where c.id = v_conv_id;
  if v_conv.last_message_at is distinct from v_frozen then
    raise exception 'S1 FAILED: spam absorb bumped last_message_at (% -> %)',
      v_frozen, v_conv.last_message_at;
  end if;
  if v_conv.status <> 'closed' or not v_conv.is_spam then
    raise exception 'S1 FAILED: spam thread did not stay closed+spam (% / %)',
      v_conv.status, v_conv.is_spam;
  end if;
  if not exists (
    select 1 from public.messages m
     where m.conversation_id = v_conv_id and m.telnyx_message_id = 'tx-s1-2') then
    raise exception 'S1 FAILED: absorbed message row missing';
  end if;
  raise notice 'S1 PASSED: spam absorb stores the message but never bumps last_message_at';
end $$;

-- ===========================================================================
-- S2. Control: an append to a normal OPEN conversation still bumps
--     last_message_at (the #49 guard must not freeze legitimate threads).
-- ===========================================================================
do $$
declare
  res       jsonb;
  v_conv_id uuid;
  v_stamp   timestamptz;
begin
  res := public.thread_inbound_message(
    '28000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000001',
    '+16135555000', 'Hi, do you do gutters?', 'tx-s2-1');
  v_conv_id := (res->>'conversation_id')::uuid;

  update public.conversations
     set last_message_at = now() - interval '1 day' where id = v_conv_id;

  res := public.thread_inbound_message(
    '28000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000001',
    '+16135555000', 'Also: how much?', 'tx-s2-2');

  select last_message_at into v_stamp
    from public.conversations where id = v_conv_id;
  if v_stamp is distinct from now() then
    raise exception 'S2 FAILED: open append did not bump last_message_at (%)', v_stamp;
  end if;
  raise notice 'S2 PASSED: non-spam appends still bump last_message_at';
end $$;

-- ===========================================================================
-- S3. The freeze is by is_spam, not by closed-ness: an OPEN conversation
--     flagged spam is frozen too (decision: last_message_at stays frozen
--     entirely while a conversation is spam).
-- ===========================================================================
do $$
declare
  res       jsonb;
  v_conv_id uuid;
  v_frozen  timestamptz := now() - interval '1 day';
  v_stamp   timestamptz;
begin
  select c.id into v_conv_id from public.conversations c
   join public.contacts ct on ct.id = c.contact_id
   where c.company_id = '28000000-0000-4000-8000-000000000001'
     and ct.phone_e164 = '+16135555000' and c.closed_at is null;
  update public.conversations
     set is_spam = true, last_message_at = v_frozen where id = v_conv_id;

  res := public.thread_inbound_message(
    '28000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000001',
    '+16135555000', 'one weird trick', 'tx-s3-1');

  if (res->>'conversation_id')::uuid <> v_conv_id then
    raise exception 'S3 FAILED: open-spam inbound did not append to the open thread';
  end if;
  if (res->>'notify')::boolean then
    raise exception 'S3 FAILED: open-spam append claimed a notification';
  end if;
  select last_message_at into v_stamp
    from public.conversations where id = v_conv_id;
  if v_stamp is distinct from v_frozen then
    raise exception 'S3 FAILED: open-spam append bumped last_message_at (%)', v_stamp;
  end if;
  raise notice 'S3 PASSED: the freeze follows is_spam even on an open conversation';
end $$;

-- ===========================================================================
-- G1. grace_notices accepts the synthetic day-30 released-notice row (#54).
-- ===========================================================================
do $$
begin
  insert into public.grace_notices (company_id, canceled_at, threshold_day)
  values ('28000000-0000-4000-8000-000000000001', now(), 30);
  raise notice 'G1 PASSED: threshold_day 30 is accepted';
end $$;

-- ===========================================================================
-- G2. The CHECK still rejects values outside {1, 15, 27, 30}.
-- ===========================================================================
do $$
begin
  begin
    insert into public.grace_notices (company_id, canceled_at, threshold_day)
    values ('28000000-0000-4000-8000-000000000001', now(), 2);
    raise exception 'G2 FAILED: threshold_day 2 was accepted';
  exception
    when check_violation then
      null; -- expected
  end;
  raise notice 'G2 PASSED: threshold_day outside {1,15,27,30} is rejected';
end $$;

rollback;
