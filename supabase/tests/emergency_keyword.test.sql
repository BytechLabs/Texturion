-- #414 — the emergency keyword the away message told a homeowner to send.
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run: psql -v ON_ERROR_STOP=1 -f supabase/tests/emergency_keyword.test.sql
-- The whole suite runs in one transaction and ROLLS BACK — it never pollutes
-- the local database. Self-contained fixtures with their own id prefix so it
-- can run standalone or after any other suite.
--   owner   = e4140000-0000-4000-8000-000000000001
--   company = e4140000-0000-4000-8000-000000000002
--   number  = e4140000-0000-4000-8000-000000000003
--   contact = e4140000-0000-4000-8000-000000000004
--   conv    = e4140000-0000-4000-8000-000000000005

\set ON_ERROR_STOP on

begin;

-- ===========================================================================
-- EK-1. companies.emergency_keyword_enabled exists, boolean NOT NULL,
--       DEFAULT TRUE. The default is the whole point: the away copy that asks
--       a homeowner to reply URGENT ships on, so the mechanism that answers it
--       has to ship on too. Defaulting false would leave the promise exactly
--       as unkept for every owner who never finds the switch.
-- ===========================================================================
do $$
declare
  col_type text; col_null boolean; col_default text;
begin
  select data_type, is_nullable = 'YES', column_default
    into col_type, col_null, col_default
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'companies'
    and column_name = 'emergency_keyword_enabled';

  if col_type is null then
    raise exception 'EK-1 FAILED: companies.emergency_keyword_enabled missing';
  end if;
  if col_type is distinct from 'boolean' then
    raise exception 'EK-1 FAILED: emergency_keyword_enabled is % (want boolean)', col_type;
  end if;
  if col_null then
    raise exception 'EK-1 FAILED: emergency_keyword_enabled must be NOT NULL';
  end if;
  if col_default is null or col_default not like '%true%' then
    raise exception 'EK-1 FAILED: default is % (want true)', col_default;
  end if;
end $$;

-- ===========================================================================
-- EK-2. conversations gains emergency_at (the inbox flag, #414 ask 2) and
--       last_emergency_ack_at (the acknowledgment throttle). The second must
--       be a SEPARATE column from last_auto_reply_at: sharing that stamp means
--       an away reply sent ten minutes ago silently swallows the emergency
--       acknowledgment.
-- ===========================================================================
do $$
declare
  n int;
begin
  select count(*) into n
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'conversations'
    and column_name in ('emergency_at', 'last_emergency_ack_at');
  if n is distinct from 2 then
    raise exception 'EK-2 FAILED: expected both emergency columns, found %', n;
  end if;
end $$;

-- ===========================================================================
-- EK-3. conversation_event_type carries 'emergency_flagged'. Without a word
--       for it, the most consequential message a workspace can receive leaves
--       the same trace as any other, and "why did my phone go off at 3am" has
--       no answer anyone can look up.
-- ===========================================================================
do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'conversation_event_type'
      and e.enumlabel = 'emergency_flagged'
  ) then
    raise exception 'EK-3 FAILED: conversation_event_type lacks emergency_flagged';
  end if;
end $$;

-- ===========================================================================
-- Fixtures.
-- ===========================================================================
insert into auth.users (id, email, raw_user_meta_data)
values ('e4140000-0000-4000-8000-000000000001', 'owner@emergency.test',
        '{"display_name":"Emergency Owner"}'::jsonb);

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, plan)
values ('e4140000-0000-4000-8000-000000000002', 'Frostline Heating',
        'e4140000-0000-4000-8000-000000000001', 'CA', '416', now(),
        'active', 'starter');

insert into public.company_members (company_id, user_id, role)
values ('e4140000-0000-4000-8000-000000000002',
        'e4140000-0000-4000-8000-000000000001', 'owner');

insert into public.phone_numbers
  (id, company_id, status, provisioning_key, country, number_e164)
values ('e4140000-0000-4000-8000-000000000003',
        'e4140000-0000-4000-8000-000000000002',
        'active', 'cs_test_emergency_1', 'CA', '+14165550200');

insert into public.contacts (id, company_id, phone_e164, name)
values ('e4140000-0000-4000-8000-000000000004',
        'e4140000-0000-4000-8000-000000000002',
        '+14165550211', 'Dana Whitfield');

insert into public.conversations
  (id, company_id, contact_id, phone_number_id, status)
values ('e4140000-0000-4000-8000-000000000005',
        'e4140000-0000-4000-8000-000000000002',
        'e4140000-0000-4000-8000-000000000004',
        'e4140000-0000-4000-8000-000000000003', 'open');

-- ===========================================================================
-- EK-4. claim_emergency_ack happy path: queues the outbound acknowledgment,
--       stamps BOTH emergency_at (the inbox flag) and last_emergency_ack_at
--       (the throttle), and writes the emergency_flagged timeline event.
-- ===========================================================================
do $$
declare
  res     jsonb;
  msg_id  uuid;
  em_at   timestamptz;
  ack_at  timestamptz;
  flagged int;
begin
  res := public.claim_emergency_ack(
    'e4140000-0000-4000-8000-000000000002',
    'e4140000-0000-4000-8000-000000000005',
    'Flagged as urgent - call 911 if anyone is in danger.', 1, 3600, 50);
  if res ? 'skipped' then
    raise exception 'EK-4 FAILED: unexpected skip %', res->>'skipped';
  end if;

  msg_id := (res->'message'->>'id')::uuid;
  if msg_id is null then
    raise exception 'EK-4 FAILED: no message returned';
  end if;
  if (select direction::text from public.messages where id = msg_id) is distinct from 'outbound' then
    raise exception 'EK-4 FAILED: acknowledgment is not outbound';
  end if;
  if (select status::text from public.messages where id = msg_id) is distinct from 'queued' then
    raise exception 'EK-4 FAILED: acknowledgment must be inserted queued (before Telnyx)';
  end if;

  select emergency_at, last_emergency_ack_at into em_at, ack_at
    from public.conversations where id = 'e4140000-0000-4000-8000-000000000005';
  if em_at is null then
    raise exception 'EK-4 FAILED: emergency_at not stamped (the inbox flag)';
  end if;
  if ack_at is null then
    raise exception 'EK-4 FAILED: last_emergency_ack_at not stamped (the throttle)';
  end if;

  select count(*) into flagged from public.conversation_events
   where conversation_id = 'e4140000-0000-4000-8000-000000000005'
     and type = 'emergency_flagged';
  if flagged is distinct from 1 then
    raise exception 'EK-4 FAILED: expected 1 emergency_flagged event, got %', flagged;
  end if;
end $$;

-- ===========================================================================
-- EK-5. The throttle holds: a second emergency inside the window is skipped.
--       The FLAG is still stamped, though — a throttled acknowledgment still
--       means an emergency arrived, and that is exactly when the crew most
--       needs to see it on the thread.
-- ===========================================================================
do $$
declare
  res     jsonb;
  em_at   timestamptz;
  flagged int;
  queued  int;
begin
  res := public.claim_emergency_ack(
    'e4140000-0000-4000-8000-000000000002',
    'e4140000-0000-4000-8000-000000000005',
    'Flagged as urgent - call 911 if anyone is in danger.', 1, 3600, 50);
  if res->>'skipped' is distinct from 'throttled' then
    raise exception 'EK-5 FAILED: expected throttled, got %', coalesce(res->>'skipped', 'a send');
  end if;

  -- The event COUNT is what proves the flag path ran ahead of the throttle,
  -- not the timestamp: now() is transaction-scoped, and this whole suite is
  -- one transaction, so both calls stamp the identical instant. In production
  -- each webhook is its own transaction and the stamp does move.
  select count(*) into flagged from public.conversation_events
   where conversation_id = 'e4140000-0000-4000-8000-000000000005'
     and type = 'emergency_flagged';
  if flagged is distinct from 2 then
    raise exception 'EK-5 FAILED: the flag must be written even when the SMS is throttled (events=%)', flagged;
  end if;

  select emergency_at into em_at
    from public.conversations where id = 'e4140000-0000-4000-8000-000000000005';
  if em_at is null then
    raise exception 'EK-5 FAILED: emergency_at cleared by a throttled call';
  end if;

  -- And no second message was queued — the throttle is what it claims to be.
  select count(*) into queued from public.messages
   where conversation_id = 'e4140000-0000-4000-8000-000000000005'
     and direction = 'outbound';
  if queued is distinct from 1 then
    raise exception 'EK-5 FAILED: expected 1 outbound acknowledgment, got %', queued;
  end if;
end $$;

-- ===========================================================================
-- EK-6. The owner's switch is honoured in the DATABASE, not only in the API.
--       Two places decide this (the inbound handler reads the column too), and
--       a workspace with the mechanism off must write no event and send no
--       acknowledgment whatever any caller believes.
-- ===========================================================================
do $$
declare
  res jsonb;
begin
  update public.companies set emergency_keyword_enabled = false
   where id = 'e4140000-0000-4000-8000-000000000002';
  update public.conversations set last_emergency_ack_at = null
   where id = 'e4140000-0000-4000-8000-000000000005';

  res := public.claim_emergency_ack(
    'e4140000-0000-4000-8000-000000000002',
    'e4140000-0000-4000-8000-000000000005',
    'Flagged as urgent - call 911 if anyone is in danger.', 1, 3600, 50);
  if res->>'skipped' is distinct from 'emergency_disabled' then
    raise exception 'EK-6 FAILED: expected emergency_disabled, got %',
      coalesce(res->>'skipped', 'a send');
  end if;

  update public.companies set emergency_keyword_enabled = true
   where id = 'e4140000-0000-4000-8000-000000000002';
end $$;

-- ===========================================================================
-- EK-7. Carrier truth outranks the emergency. A contact who sent STOP hears
--       nothing from us, and no emergency licenses a message to them — the
--       opt-out is the customer's own instruction and only they can lift it.
-- ===========================================================================
do $$
declare
  res jsonb;
begin
  insert into public.opt_outs (company_id, phone_e164, source)
  values ('e4140000-0000-4000-8000-000000000002', '+14165550211', 'stop_keyword');

  update public.conversations set last_emergency_ack_at = null
   where id = 'e4140000-0000-4000-8000-000000000005';

  res := public.claim_emergency_ack(
    'e4140000-0000-4000-8000-000000000002',
    'e4140000-0000-4000-8000-000000000005',
    'Flagged as urgent - call 911 if anyone is in danger.', 1, 3600, 50);
  if res->>'skipped' is distinct from 'recipient_opted_out' then
    raise exception 'EK-7 FAILED: expected recipient_opted_out, got %',
      coalesce(res->>'skipped', 'a send');
  end if;

  delete from public.opt_outs
   where company_id = 'e4140000-0000-4000-8000-000000000002';
end $$;

-- ===========================================================================
-- EK-8. The daily cap is real. This path is exempt from the outbound overage
--       cap (when a workspace is over cap the crew cannot reply either, so the
--       911 line is the only thing that can still reach the person) — and an
--       exempt send path with no ceiling of its own is an uncapped cost
--       centre. A cap of 0 must therefore stop it dead.
-- ===========================================================================
do $$
declare
  res jsonb;
begin
  update public.conversations set last_emergency_ack_at = null
   where id = 'e4140000-0000-4000-8000-000000000005';

  res := public.claim_emergency_ack(
    'e4140000-0000-4000-8000-000000000002',
    'e4140000-0000-4000-8000-000000000005',
    'Flagged as urgent - call 911 if anyone is in danger.', 1, 3600, 0);
  if res->>'skipped' is distinct from 'daily_cap' then
    raise exception 'EK-8 FAILED: expected daily_cap, got %',
      coalesce(res->>'skipped', 'a send');
  end if;
end $$;

-- ===========================================================================
-- EK-9. Grant posture: service_role only, never anon/authenticated. The
--       function is security definer and writes messages — a browser token
--       reaching it would be a send path with no gates in front of it.
-- ===========================================================================
do $$
declare
  bad text;
begin
  select string_agg(grantee, ', ') into bad
  from information_schema.role_routine_grants
  where specific_schema = 'public'
    and routine_name = 'claim_emergency_ack'
    and grantee in ('anon', 'authenticated', 'PUBLIC');
  if bad is not null then
    raise exception 'EK-9 FAILED: claim_emergency_ack is executable by %', bad;
  end if;

  if not exists (
    select 1 from information_schema.role_routine_grants
    where specific_schema = 'public'
      and routine_name = 'claim_emergency_ack'
      and grantee = 'service_role'
  ) then
    raise exception 'EK-9 FAILED: service_role cannot execute claim_emergency_ack';
  end if;
end $$;

-- ===========================================================================
-- EK-10. #553: the reply is its own choice, and turning it off still TELLS the
--        crew. Being told an emergency arrived and messaging the customer back
--        were one boolean, so the only way to stop us sending on somebody's
--        behalf was to stop the product noticing emergencies at all.
-- ===========================================================================
do $$
declare
  res     jsonb;
  em_at   timestamptz;
  flagged int;
  before_msgs int;
begin
  -- A clean thread, so the throttle and the earlier cases cannot muddy this.
  update public.conversations
     set emergency_at = null, last_emergency_ack_at = null
   where id = 'e4140000-0000-4000-8000-000000000005';

  select count(*) into before_msgs
    from public.messages
   where conversation_id = 'e4140000-0000-4000-8000-000000000005'
     and direction = 'outbound';

  update public.companies
     set emergency_reply_enabled = false
   where id = 'e4140000-0000-4000-8000-000000000002';

  res := public.claim_emergency_ack(
    'e4140000-0000-4000-8000-000000000002',
    'e4140000-0000-4000-8000-000000000005',
    'Flagged as urgent - call 911 if anyone is in danger.', 1, 3600, 50);

  if res->>'skipped' is distinct from 'reply_disabled' then
    raise exception
      'EK-10 FAILED: expected skipped=reply_disabled, got %', res;
  end if;

  -- THE POINT OF THE SPLIT. The crew still learns about it.
  select emergency_at into em_at
    from public.conversations
   where id = 'e4140000-0000-4000-8000-000000000005';
  if em_at is null then
    raise exception
      'EK-10 FAILED: the inbox flag was not stamped, so turning off the reply '
      'also stopped the crew being told — which is the bug, not the fix';
  end if;

  select count(*) into flagged
    from public.conversation_events
   where conversation_id = 'e4140000-0000-4000-8000-000000000005'
     and type = 'emergency_flagged';
  if flagged < 1 then
    raise exception 'EK-10 FAILED: no emergency_flagged event was written';
  end if;

  -- And no message went to the customer, which is the one thing withheld.
  if (
    select count(*) from public.messages
     where conversation_id = 'e4140000-0000-4000-8000-000000000005'
       and direction = 'outbound'
  ) is distinct from before_msgs then
    raise exception
      'EK-10 FAILED: a reply was sent with emergency_reply_enabled = false';
  end if;

  raise notice
    'EK-10 PASSED: the reply is off, the crew is still told, the customer is not';
end $$;

-- ===========================================================================
-- EK-11. And the two switches are genuinely different: turning RECOGNITION off
--        writes no flag at all. Without this, EK-10 could pass against a
--        function that ignored the new column and skipped for another reason.
-- ===========================================================================
do $$
declare res jsonb; em_at timestamptz;
begin
  update public.conversations
     set emergency_at = null, last_emergency_ack_at = null
   where id = 'e4140000-0000-4000-8000-000000000005';
  update public.companies
     set emergency_keyword_enabled = false, emergency_reply_enabled = true
   where id = 'e4140000-0000-4000-8000-000000000002';

  res := public.claim_emergency_ack(
    'e4140000-0000-4000-8000-000000000002',
    'e4140000-0000-4000-8000-000000000005',
    'Flagged as urgent - call 911 if anyone is in danger.', 1, 3600, 50);

  if res->>'skipped' is distinct from 'emergency_disabled' then
    raise exception
      'EK-11 FAILED: recognition off should skip as emergency_disabled, got %', res;
  end if;

  select emergency_at into em_at
    from public.conversations
   where id = 'e4140000-0000-4000-8000-000000000005';
  if em_at is not null then
    raise exception
      'EK-11 FAILED: recognition is off, so nothing should have been flagged';
  end if;

  raise notice 'EK-11 PASSED: the two switches mean different things';
end $$;

rollback;
