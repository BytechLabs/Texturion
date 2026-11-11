-- #722 phase 4: every state transition is captured in the database.
-- Suite for supabase/migrations/20261111420000_every_state_transition_is_recorded.sql.
--
-- What is pinned:
--   ST-1  with no Vault secret a real transition enqueues nothing
--   ST-2  with the secret, an internal machine (conversation) enqueues exactly one
--         request whose body has the machine, from, to, record id and expected
--   ST-3  an update that does not change the state enqueues nothing
--   ST-4  a provider machine (subscription) is captured
--   ST-5  a derived machine (task) is captured, from and to computed from done_at
--   ST-6  the body carries the company as distinct_id and no person profile
--   ST-7  the edge list answers expected for an edge and a non-edge
--   ST-8  the capture never raises
--   ST-9  activity: a restored task writes record_activity, a phone number
--         status change writes an audit row with a null actor
--   ST-10 grants: no browser role can execute the new functions
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

-- A high-water mark on the pg_net queue, so each check sees only its own requests.
create temp table st_hw (hi bigint not null);
insert into st_hw values (coalesce((select max(id) from net.http_request_queue), 0));

create function pg_temp.st_new() returns table (body jsonb)
language sql as $$
  select convert_from(q.body, 'utf8')::jsonb
    from net.http_request_queue q
   where q.id > (select hi from st_hw)
     and convert_from(q.body, 'utf8')::jsonb ->> 'distinct_id'
         = '5c000000-0000-4000-8000-0000000000c1'
$$;

create function pg_temp.st_mark() returns void language sql as $$
  update st_hw set hi = coalesce((select max(id) from net.http_request_queue), 0)
$$;

-- ST-1: no secret, no request.
update public.conversations set status = 'waiting'
 where id = '5c000000-0000-4000-8000-000000000c01';
do $$
begin
  if exists (select 1 from pg_temp.st_new()) then
    raise exception 'ST-1 FAILED: a transition enqueued a request with no Vault secret';
  end if;
  raise notice 'ST-1 PASSED: no secret, nothing enqueued';
end $$;

select vault.create_secret('st-test-key', 'posthog_api_key');
select pg_temp.st_mark();

-- ST-2: an internal machine.
update public.conversations set status = 'open'
 where id = '5c000000-0000-4000-8000-000000000c01';
do $$
declare
  n int;
  b jsonb;
begin
  select count(*) into n from pg_temp.st_new();
  if n is distinct from 1 then
    raise exception 'ST-2 FAILED: expected exactly one request, found %', n;
  end if;
  select body into b from pg_temp.st_new();
  if b ->> 'event' is distinct from 'state_transition'
     or b -> 'properties' ->> 'machine' is distinct from 'conversation'
     or b -> 'properties' ->> 'from' is distinct from 'waiting'
     or b -> 'properties' ->> 'to' is distinct from 'open'
     or b -> 'properties' ->> 'record_id' is distinct from '5c000000-0000-4000-8000-000000000c01'
     or b -> 'properties' ->> 'expected' is distinct from 'true' then
    raise exception 'ST-2 FAILED: wrong body %', b;
  end if;
  -- ST-6
  if b ->> 'distinct_id' is distinct from '5c000000-0000-4000-8000-0000000000c1'
     or b ->> 'api_key' is distinct from 'st-test-key'
     or (b -> 'properties' ->> '$process_person_profile') is distinct from 'false'
     or b -> 'properties' ->> 'environment' is distinct from 'production'
     or b -> 'properties' ->> 'cause' is null then
    raise exception 'ST-6 FAILED: wrong envelope %', b;
  end if;
  raise notice 'ST-2 PASSED: one request with machine, from, to and record id';
  raise notice 'ST-6 PASSED: company as distinct_id, no person profile';
end $$;
select pg_temp.st_mark();

-- ST-3: an update that leaves the state alone.
update public.conversations set status = 'open', last_message_at = now()
 where id = '5c000000-0000-4000-8000-000000000c01';
do $$
begin
  if exists (select 1 from pg_temp.st_new()) then
    raise exception 'ST-3 FAILED: an unchanged state enqueued a request';
  end if;
  raise notice 'ST-3 PASSED: no change, no request';
end $$;

-- ST-4: a provider machine.
update public.companies set subscription_status = 'past_due'
 where id = '5c000000-0000-4000-8000-0000000000c1';
do $$
declare
  b jsonb;
begin
  select body into b from pg_temp.st_new()
   where body -> 'properties' ->> 'machine' = 'subscription';
  if b is null
     or b -> 'properties' ->> 'from' is distinct from 'active'
     or b -> 'properties' ->> 'to' is distinct from 'past_due' then
    raise exception 'ST-4 FAILED: subscription move not captured: %', b;
  end if;
  raise notice 'ST-4 PASSED: provider machine captured';
end $$;
select pg_temp.st_mark();

-- ST-5: a derived machine.
update public.tasks set done_at = now(), done_by_user_id = '5c000000-0000-4000-8000-00000000000a'
 where id = '5c000000-0000-4000-8000-000000000d01';
do $$
declare
  b jsonb;
begin
  select body into b from pg_temp.st_new()
   where body -> 'properties' ->> 'machine' = 'task';
  if b is null
     or b -> 'properties' ->> 'from' is distinct from 'open'
     or b -> 'properties' ->> 'to' is distinct from 'done'
     or b -> 'properties' ->> 'record_id' is distinct from '5c000000-0000-4000-8000-000000000d01'
     or b -> 'properties' ->> 'expected' is distinct from 'true' then
    raise exception 'ST-5 FAILED: task move not captured: %', b;
  end if;
  raise notice 'ST-5 PASSED: derived machine captured';
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

rollback;
