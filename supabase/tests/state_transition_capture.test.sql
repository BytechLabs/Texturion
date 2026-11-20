-- #722 phase 4: every state transition is captured in the database.
-- State-transition triggers, service-only outbox and the absence of database HTTP.
--
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/state_transition_capture.test.sql
-- One transaction, rolled back. Fixtures use a '5c' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email)
values ('5c000000-0000-4000-8000-00000000000a', 'st-owner@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status)
values ('5c000000-0000-4000-8000-0000000000c1', 'Capture Co',
        '5c000000-0000-4000-8000-00000000000a', 'US', '415', now(), 'active');

insert into public.phone_numbers
  (id, company_id, provisioning_key, country, number_e164, status)
values ('5c000000-0000-4000-8000-000000000a01', '5c000000-0000-4000-8000-0000000000c1',
        'st-1', 'US', '+12125550301', 'active');

insert into public.contacts (id, company_id, phone_e164)
values ('5c000000-0000-4000-8000-000000000b01', '5c000000-0000-4000-8000-0000000000c1',
        '+12125550311');

insert into public.conversations
  (id, company_id, contact_id, phone_number_id, status)
values ('5c000000-0000-4000-8000-000000000c01', '5c000000-0000-4000-8000-0000000000c1',
        '5c000000-0000-4000-8000-000000000b01', '5c000000-0000-4000-8000-000000000a01',
        'open');

insert into public.tasks (id, company_id, title, created_by_user_id, conversation_id)
values ('5c000000-0000-4000-8000-000000000d01', '5c000000-0000-4000-8000-0000000000c1',
        'Capture task', '5c000000-0000-4000-8000-00000000000a',
        '5c000000-0000-4000-8000-000000000c01');

-- ST-1/2/3: initial state, unchanged state and ordinary transitions.
do $$
begin
  if not exists (select 1 from public.state_transition_outbox
    where company_id = '5c000000-0000-4000-8000-0000000000c1'
      and machine = 'workspace' and from_state is null and to_state = 'active' and expected
  ) then
    raise exception 'ST-1 FAILED: workspace initial state was not queued';
  end if;
end $$;

truncate public.state_transition_outbox;
set local loonext.cause = 'state-transition-test';

update public.conversations set status = 'open', last_message_at = now()
 where id = '5c000000-0000-4000-8000-000000000c01';
update public.conversations set status = 'waiting'
 where id = '5c000000-0000-4000-8000-000000000c01';

do $$
begin
  if (select count(*) from public.state_transition_outbox) is distinct from 1
     or not exists (select 1 from public.state_transition_outbox
       where company_id = '5c000000-0000-4000-8000-0000000000c1'
         and machine = 'conversation' and from_state = 'open' and to_state = 'waiting' and expected
         and record_id = '5c000000-0000-4000-8000-000000000c01'
         and cause = 'state-transition-test'
     ) then
    raise exception 'ST-2/3 FAILED: only the actual conversation transition should be queued';
  end if;
end $$;

-- ST-4/5: provider-owned and derived transitions use the same outbox.
update public.companies set subscription_status = 'past_due'
 where id = '5c000000-0000-4000-8000-0000000000c1';
update public.tasks set done_at = now(), done_by_user_id = '5c000000-0000-4000-8000-00000000000a'
 where id = '5c000000-0000-4000-8000-000000000d01';

do $$
begin
  if not exists (select 1 from public.state_transition_outbox
    where machine = 'subscription' and from_state = 'active' and to_state = 'past_due'
  ) then
    raise exception 'ST-4 FAILED: subscription move was not queued';
  end if;
  if not exists (select 1 from public.state_transition_outbox
    where machine = 'task' and from_state = 'open' and to_state = 'done' and expected
      and record_id = '5c000000-0000-4000-8000-000000000d01'
  ) then
    raise exception 'ST-5 FAILED: task move was not queued';
  end if;
end $$;

-- ST-6: rolling back a write also rolls back its event.
savepoint state_change;
update public.conversations set status = 'open'
 where id = '5c000000-0000-4000-8000-000000000c01';
rollback to savepoint state_change;

do $$
begin
  if exists (select 1 from public.state_transition_outbox where machine = 'conversation' and to_state = 'open') then
    raise exception 'ST-6 FAILED: a rolled back transition was queued';
  end if;
end $$;

-- ST-7: the edge list.
do $$
begin
  if not public.state_transition_expected('call', 'ringing', 'answered')
     or public.state_transition_expected('call', 'ended_missed', 'ringing')
     or not public.state_transition_expected('call', null, 'dialing')
     or public.state_transition_expected('no_such_machine', 'a', 'b') then
    raise exception 'ST-7 FAILED: state_transition_expected answered wrongly';
  end if;
  raise notice 'ST-7 PASSED: expected is true for an edge and false for a non-edge';
end $$;

-- ST-8: it never raises, even on input that cannot be sent.
do $$
begin
  perform public.capture_state_transition(null, null, null, null, null);
  raise notice 'ST-8 PASSED: a bad call does not raise';
end $$;

-- ST-9: activity.
update public.tasks set deleted_at = now() where id = '5c000000-0000-4000-8000-000000000d01';
update public.tasks set deleted_at = null where id = '5c000000-0000-4000-8000-000000000d01';
update public.phone_numbers set status = 'suspended'
 where id = '5c000000-0000-4000-8000-000000000a01';
do $$
begin
  if (select count(*) from public.record_activity
       where record_type = 'task' and record_id = '5c000000-0000-4000-8000-000000000d01'
         and kind = 'restored') is distinct from 1 then
    raise exception 'ST-9 FAILED: a restored task did not write one activity row';
  end if;
  if (select count(*) from public.audit_log
       where company_id = '5c000000-0000-4000-8000-0000000000c1'
         and action = 'number.status_changed' and actor_user_id is null
         and before ->> 'status' = 'active' and after ->> 'status' = 'suspended') is distinct from 1 then
    raise exception 'ST-9 FAILED: a phone number status change did not write one audit row';
  end if;
  raise notice 'ST-9 PASSED: restored task and number status change leave activity rows';
end $$;

-- ST-10: grants.
do $$
declare
  bad text;
begin
  select string_agg(p.proname, ', ') into bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and (p.proname like 'state\_transition\_%' or p.proname = 'capture_state_transition'
          or p.proname = 'record_activity_on_task_restore')
     and (has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute'));
  if bad is not null then
    raise exception 'ST-10 FAILED: browser roles can execute %', bad;
  end if;
  raise notice 'ST-10 PASSED: the capture functions are closed to browser roles';
end $$;

-- ST-11: only the service can drain the outbox. A claim has a lease, and
-- an acknowledgement removes only the events that reached PostHog.
set local role service_role;
do $$
declare
  claimed uuid[];
begin
  select array_agg(id) into claimed from public.api_claim_state_transitions();
  if coalesce(cardinality(claimed), 0) < 3 then
    raise exception 'ST-11 FAILED: queued transitions were not claimed';
  end if;
  if exists (select 1 from public.api_claim_state_transitions()) then
    raise exception 'ST-11 FAILED: a leased transition was claimed again';
  end if;
  perform public.api_ack_state_transitions(claimed[1:1]);
  if exists (select 1 from public.state_transition_outbox where id = claimed[1])
     or not exists (select 1 from public.state_transition_outbox where id = claimed[2]) then
    raise exception 'ST-11 FAILED: acknowledgements must remove only the named transitions';
  end if;
  update public.state_transition_outbox
     set available_at = now(), occurred_at = now() - interval '2 days'
   where id = claimed[2];
  if exists (select 1 from public.api_claim_state_transitions()) then
    raise exception 'ST-11 FAILED: an expired transition was claimed';
  end if;
  if exists (select 1 from public.state_transition_outbox where id = claimed[2]) then
    raise exception 'ST-11 FAILED: an expired transition was not deleted';
  end if;

  if exists (select 1 from pg_roles r
    where not r.rolsuper and r.rolname in ('anon', 'authenticated', 'agent_diag', 'posthog_reader')
      and (has_function_privilege(r.oid, 'public.api_claim_state_transitions()', 'EXECUTE')
        or has_function_privilege(r.oid, 'public.api_ack_state_transitions(uuid[])', 'EXECUTE')
        or has_table_privilege(r.oid, 'public.state_transition_outbox', 'SELECT, INSERT, UPDATE, DELETE'))
  ) or not has_function_privilege('service_role', 'public.api_claim_state_transitions()', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.api_ack_state_transitions(uuid[])', 'EXECUTE') then
    raise exception 'ST-11 FAILED: outbox grants have drifted';
  end if;
end $$;
reset role;

-- ST-12: the extension and every entry point must stay absent after a DB reset.
do $$
begin
  if exists (select 1 from pg_extension where extname in ('pg_net', 'http'))
     or to_regnamespace('net') is not null then
    raise exception 'ST-12 FAILED: database HTTP is enabled again';
  end if;
end $$;

rollback;
