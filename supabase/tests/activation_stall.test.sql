-- [#281] Activation stall — assertion suite for
-- supabase/migrations/20260730003900_activation_stall.sql.
--
-- What this mostly pins is the case that would make the alert useless: a US
-- workspace inside the carrier wait is QUEUED, not stalled. If that fired, the
-- alarm would go off for every US signup in its first week and the mailbox would
-- stop being read — the failure #244 describes and the reason #397's detector
-- announces transitions only.
--
-- The other thing pinned is PRECEDENCE. A workspace that sent and got no reply
-- must be judged on that, not on an approval it cleared a fortnight ago;
-- reporting the earliest unmet step would describe a problem they already fixed.
--
-- One transaction, rolled back. Fixtures use a 'bb' id prefix.

\set ON_ERROR_STOP on

begin;

delete from public.activation_stall_state;

insert into auth.users (id, email) values
  ('bb000000-0000-4000-8000-00000000000a'::uuid, 'stall-owner@test.local');

-- Every company is paying; the differences are all downstream of that.
insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, us_texting_enabled, first_inbound_reply_at)
values
  -- CA-only, number live 10 days, never sent. The recoverable stall.
  ('bb000000-0000-4000-8000-0000000000c1'::uuid, 'Never Sent CA',
   'bb000000-0000-4000-8000-00000000000a'::uuid, 'CA', '416', now(),
   'active', false, null),
  -- Sent 9 days ago, nobody replied. A D12 activation failure.
  ('bb000000-0000-4000-8000-0000000000c2'::uuid, 'Texting Into Silence',
   'bb000000-0000-4000-8000-00000000000a'::uuid, 'CA', '416', now(),
   'active', false, null),
  -- US, submitted 12 days ago, still not approved. The carrier is late.
  ('bb000000-0000-4000-8000-0000000000c3'::uuid, 'Waiting On Carrier',
   'bb000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(),
   'active', true, null),
  -- US, submitted 2 days ago. INSIDE the promise: must stay quiet.
  ('bb000000-0000-4000-8000-0000000000c4'::uuid, 'Freshly Submitted',
   'bb000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(),
   'active', true, null),
  -- Sent and got a reply. Activated; nothing to say.
  ('bb000000-0000-4000-8000-0000000000c5'::uuid, 'Activated Co',
   'bb000000-0000-4000-8000-00000000000a'::uuid, 'CA', '416', now(),
   'active', false, now() - interval '5 days'),
  -- CA-only, number live only 1 day, never sent. Too early to judge.
  ('bb000000-0000-4000-8000-0000000000c6'::uuid, 'Signed Up Yesterday',
   'bb000000-0000-4000-8000-00000000000a'::uuid, 'CA', '416', now(),
   'active', false, null),
  -- Sent 9 days ago with no reply, AND cleared approval a fortnight ago. The
  -- precedence case: must read no_reply, not awaiting_carrier.
  ('bb000000-0000-4000-8000-0000000000c7'::uuid, 'Approved Then Silent',
   'bb000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(),
   'active', true, null);

create or replace function pg_temp.seed_number(
  p_company uuid, p_age_days int, p_e164 text
) returns void language plpgsql as $$
begin
  insert into public.phone_numbers
    (company_id, provisioning_key, country, number_e164, status, created_at)
  values (p_company, 'stall-' || p_e164, 'US', p_e164, 'active',
          now() - make_interval(days => p_age_days));
end $$;

create or replace function pg_temp.seed_send(
  p_company uuid, p_age_days int
) returns void language plpgsql as $$
declare
  v_contact uuid;
  v_conv uuid;
  v_num uuid;
begin
  select id into v_num from public.phone_numbers
   where company_id = p_company limit 1;
  insert into public.contacts (company_id, phone_e164)
  values (p_company, '+1416555' || lpad((random() * 8999 + 1000)::int::text, 4, '0'))
  returning id into v_contact;
  insert into public.conversations
    (company_id, contact_id, phone_number_id, status, last_message_at)
  values (p_company, v_contact, v_num, 'open', now())
  returning id into v_conv;
  -- messages_outbound_actor: an outbound row must name a sender, automated
  -- sends included. The owner stands in here.
  insert into public.messages
    (company_id, conversation_id, direction, body, status, telnyx_message_id,
     sent_by_user_id, created_at)
  values (p_company, v_conv, 'outbound', 'first text', 'delivered',
          'stall-msg-' || gen_random_uuid()::text,
          'bb000000-0000-4000-8000-00000000000a'::uuid,
          now() - make_interval(days => p_age_days));
end $$;

create or replace function pg_temp.seed_campaign(
  p_company uuid, p_status text, p_submitted_days int, p_approved_days int
) returns void language plpgsql as $$
begin
  insert into public.messaging_registrations
    (company_id, kind, status, submitted_at, approved_at)
  values (
    p_company, 'campaign', p_status::public.registration_status,
    now() - make_interval(days => p_submitted_days),
    case when p_approved_days is null then null
         else now() - make_interval(days => p_approved_days) end
  );
end $$;

select pg_temp.seed_number('bb000000-0000-4000-8000-0000000000c1'::uuid, 10, '+14165550001');
select pg_temp.seed_number('bb000000-0000-4000-8000-0000000000c2'::uuid, 20, '+14165550002');
select pg_temp.seed_send('bb000000-0000-4000-8000-0000000000c2'::uuid, 9);
select pg_temp.seed_number('bb000000-0000-4000-8000-0000000000c3'::uuid, 14, '+14155550003');
select pg_temp.seed_campaign('bb000000-0000-4000-8000-0000000000c3'::uuid, 'submitted', 12, null);
select pg_temp.seed_number('bb000000-0000-4000-8000-0000000000c4'::uuid, 3, '+14155550004');
select pg_temp.seed_campaign('bb000000-0000-4000-8000-0000000000c4'::uuid, 'submitted', 2, null);
select pg_temp.seed_number('bb000000-0000-4000-8000-0000000000c5'::uuid, 20, '+14165550005');
select pg_temp.seed_send('bb000000-0000-4000-8000-0000000000c5'::uuid, 10);
select pg_temp.seed_number('bb000000-0000-4000-8000-0000000000c6'::uuid, 1, '+14165550006');
select pg_temp.seed_number('bb000000-0000-4000-8000-0000000000c7'::uuid, 20, '+14155550007');
select pg_temp.seed_campaign('bb000000-0000-4000-8000-0000000000c7'::uuid, 'approved', 20, 14);
select pg_temp.seed_send('bb000000-0000-4000-8000-0000000000c7'::uuid, 9);

-- ===========================================================================
-- AS-1. Each workspace lands in the state its situation describes.
-- ===========================================================================
do $$
declare
  v_rows int;
  v_state text;
begin
  select count(*) into v_rows from public.api_assess_activation_stall();
  -- Every one of the seven is a transition from the implicit 'ok', except the
  -- three that ARE ok and therefore do not change.
  if v_rows is distinct from 4 then
    raise exception 'AS-1 FAILED: expected 4 transitions, got %', v_rows;
  end if;

  select state into v_state from public.activation_stall_state
   where company_id = 'bb000000-0000-4000-8000-0000000000c1'::uuid;
  if v_state is distinct from 'not_sent' then
    raise exception 'AS-1 FAILED: a workspace that can send and has not reads % ', v_state;
  end if;

  select state into v_state from public.activation_stall_state
   where company_id = 'bb000000-0000-4000-8000-0000000000c2'::uuid;
  if v_state is distinct from 'no_reply' then
    raise exception 'AS-1 FAILED: texting into silence reads %', v_state;
  end if;

  select state into v_state from public.activation_stall_state
   where company_id = 'bb000000-0000-4000-8000-0000000000c3'::uuid;
  if v_state is distinct from 'awaiting_carrier' then
    raise exception 'AS-1 FAILED: a late carrier reads %', v_state;
  end if;

  raise notice 'AS-1 PASSED: each situation lands in its own state';
end $$;

-- ===========================================================================
-- AS-2. The false alarms, which are what make the alert worth reading.
-- ===========================================================================
do $$
declare
  v_state text;
begin
  -- Inside the 3-to-7-business-day promise. Alerting here would fire on every
  -- US signup in its first week.
  select state into v_state from public.activation_stall_state
   where company_id = 'bb000000-0000-4000-8000-0000000000c4'::uuid;
  if v_state is distinct from 'ok' then
    raise exception
      'AS-2 FAILED: a workspace INSIDE the carrier promise reads % — that '
      'fires on every US signup and trains the reader to ignore it', v_state;
  end if;

  -- Activated. The reply arrived, so there is nothing to chase.
  select state into v_state from public.activation_stall_state
   where company_id = 'bb000000-0000-4000-8000-0000000000c5'::uuid;
  if v_state is distinct from 'ok' then
    raise exception 'AS-2 FAILED: an activated workspace reads %', v_state;
  end if;

  -- One day old. A signup on Friday that gets going on Monday is not a stall.
  select state into v_state from public.activation_stall_state
   where company_id = 'bb000000-0000-4000-8000-0000000000c6'::uuid;
  if v_state is distinct from 'ok' then
    raise exception 'AS-2 FAILED: a one-day-old workspace reads %', v_state;
  end if;

  raise notice 'AS-2 PASSED: the innocent cases stay quiet';
end $$;

-- ===========================================================================
-- AS-3. Precedence runs backwards through the funnel.
-- ===========================================================================
do $$
declare
  v_state text;
  v_days int;
begin
  select state, days_in_state into v_state, v_days
    from public.activation_stall_state
   where company_id = 'bb000000-0000-4000-8000-0000000000c7'::uuid;
  if v_state is distinct from 'no_reply' then
    raise exception
      'AS-3 FAILED: a workspace that sent and got no reply reads % — judging '
      'it on the approval it cleared a fortnight ago would report a problem '
      'it already solved', v_state;
  end if;
  -- Measured from the SEND, not from the approval.
  if v_days is distinct from 9 then
    raise exception 'AS-3 FAILED: expected 9 days since the send, got %', v_days;
  end if;
  raise notice 'AS-3 PASSED: the last unmet step is the one reported';
end $$;

-- ===========================================================================
-- AS-4. Transitions only, and recovery is announced once.
-- ===========================================================================
do $$
declare
  v_rows int;
  v_was text;
  v_state text;
begin
  -- Nothing changed since AS-1, so a second run says nothing at all.
  select count(*) into v_rows from public.api_assess_activation_stall();
  if v_rows is distinct from 0 then
    raise exception
      'AS-4 FAILED: re-running announced % workspace(s) whose state did not '
      'change — a daily repeat is how the mailbox stops being read', v_rows;
  end if;

  -- The never-sent workspace sends. It should be reported as recovered, once.
  perform pg_temp.seed_send('bb000000-0000-4000-8000-0000000000c1'::uuid, 0);
  update public.companies
     set first_inbound_reply_at = now()
   where id = 'bb000000-0000-4000-8000-0000000000c1'::uuid;

  select was, state into v_was, v_state
    from public.api_assess_activation_stall()
   where company_id = 'bb000000-0000-4000-8000-0000000000c1'::uuid;
  if v_state is distinct from 'ok' or v_was is distinct from 'not_sent' then
    raise exception 'AS-4 FAILED: recovery reported as % -> %', v_was, v_state;
  end if;

  select count(*) into v_rows from public.api_assess_activation_stall();
  if v_rows is distinct from 0 then
    raise exception 'AS-4 FAILED: recovery announced twice';
  end if;

  raise notice 'AS-4 PASSED: transitions only, in both directions';
end $$;

-- ===========================================================================
-- AS-5. Service-role only. The state table names who is struggling.
-- ===========================================================================
do $$
begin
  if has_function_privilege('authenticated',
       'public.api_assess_activation_stall()', 'execute') then
    raise exception 'AS-5 FAILED: authenticated can run the assessment';
  end if;
  if has_table_privilege('authenticated', 'public.activation_stall_state', 'select') then
    raise exception 'AS-5 FAILED: authenticated can read the stall table';
  end if;
  if not (select relrowsecurity from pg_class
           where oid = 'public.activation_stall_state'::regclass) then
    raise exception 'AS-5 FAILED: RLS is off on activation_stall_state';
  end if;
  raise notice 'AS-5 PASSED: assessment and state are service-role only, RLS on';
end $$;

select 'activation_stall.test.sql: AS-1..AS-5 PASSED' as result;

rollback;
