-- ===========================================================================
-- #722: when a call ends, its ring legs stop ringing and it has an end time.
-- ===========================================================================
begin;

\set co  '\'72200000-0000-4000-8000-000000000001\''
\set own '\'72200000-0000-4000-8000-000000000002\''
\set mem '\'72200000-0000-4000-8000-000000000003\''

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                        created_at, updated_at, aud, role)
values (:own, 'cl-own@test.local', '', now(), now(), now(), 'authenticated', 'authenticated'),
       (:mem, 'cl-mem@test.local', '', now(), now(), now(), 'authenticated', 'authenticated')
on conflict (id) do nothing;

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, plan)
values (:co, 'Call Cleanup Co', :own, 'US', '212', now(), 'active', 'pro');

insert into public.calls (company_id, call_session_id, direction, state, started_at)
values (:co, 'cl-sess-1', 'inbound', 'ringing', now() - interval '1 minute');

insert into public.call_member_legs (call_session_id, call_control_id, company_id, user_id, state)
values ('cl-sess-1', 'cl-leg-own', :co, :own, 'answered'),
       ('cl-sess-1', 'cl-leg-mem', :co, :mem, 'ringing');

-- CL-1: the call ends; the answered leg stays answered, the ringing one stops.
update public.calls set state = 'ended_answered', outcome = 'answered'
 where call_session_id = 'cl-sess-1';
do $$
begin
  if (select state from public.call_member_legs where call_control_id = 'cl-leg-mem')
       is distinct from 'failed' then
    raise exception 'CL-1 FAILED: a leg still rings on a call that has ended';
  end if;
  if (select state from public.call_member_legs where call_control_id = 'cl-leg-own')
       is distinct from 'answered' then
    raise exception 'CL-1 FAILED: the answered leg was changed';
  end if;
  raise notice 'CL-1 PASSED: an ended call closes its ringing legs';
end $$;

-- CL-2: the end time is stamped, and an ended call without one is refused.
do $$
begin
  if (select ended_at from public.calls where call_session_id = 'cl-sess-1') is null then
    raise exception 'CL-2 FAILED: the call ended with no end time';
  end if;
  begin
    alter table public.calls disable trigger calls_stamp_ended_at;
    update public.calls set ended_at = null where call_session_id = 'cl-sess-1';
    raise exception 'CL-2 FAILED: an ended call with no end time was stored';
  exception when check_violation then
    null;
  end;
  alter table public.calls enable trigger calls_stamp_ended_at;
  raise notice 'CL-2 PASSED: an ended call always has an end time';
end $$;

rollback;
