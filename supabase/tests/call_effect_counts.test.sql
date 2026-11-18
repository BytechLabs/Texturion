begin;

insert into auth.users (id, email)
values ('8f000000-0000-4000-8000-00000000000b', 'call-effects@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('8f000000-0000-4000-8000-0000000000d1', 'Call Effects',
   '8f000000-0000-4000-8000-00000000000b', 'US', '415', now()),
  ('8f000000-0000-4000-8000-0000000000d2', 'Other Crew',
   '8f000000-0000-4000-8000-00000000000b', 'US', '415', now());

insert into public.phone_numbers (id, company_id, status, provisioning_key, country, number_e164)
values
  ('8f000000-0000-4000-8000-0000000000e1', '8f000000-0000-4000-8000-0000000000d1',
   'active', 'effect-counts-main', 'US', '+14155550159'),
  ('8f000000-0000-4000-8000-0000000000e2', '8f000000-0000-4000-8000-0000000000d2',
   'active', 'effect-counts-other', 'US', '+14155550160');

insert into public.calls
  (company_id, phone_number_id, call_session_id, outcome, routing, ended_reason, started_at)
select '8f000000-0000-4000-8000-0000000000d1', '8f000000-0000-4000-8000-0000000000e1',
  'effects-' || n, 'missed', 'nobody_reachable', 'nobody_reachable', now() - interval '1 hour'
from generate_series(1, 1201) n;

insert into public.calls
  (company_id, phone_number_id, call_session_id, outcome, routing, ended_reason, started_at, deleted_at)
values
  ('8f000000-0000-4000-8000-0000000000d1', '8f000000-0000-4000-8000-0000000000e1',
   'effects-one', 'missed', 'after_hours', 'caller_hung_up', now(), null),
  ('8f000000-0000-4000-8000-0000000000d1', '8f000000-0000-4000-8000-0000000000e1',
   'effects-old', 'missed', 'after_hours', 'caller_hung_up', now() - interval '31 days', null),
  ('8f000000-0000-4000-8000-0000000000d1', '8f000000-0000-4000-8000-0000000000e1',
   'effects-trash', 'missed', 'after_hours', 'caller_hung_up', now(), now()),
  ('8f000000-0000-4000-8000-0000000000d2', '8f000000-0000-4000-8000-0000000000e2',
   'effects-other', 'missed', 'after_hours', 'caller_hung_up', now(), null);

do $$
declare
  result jsonb;
begin
  select public.api_call_effect_counts(
    '8f000000-0000-4000-8000-0000000000d1', now() - interval '30 days'
  ) into result;
  if result is distinct from '{"nobody_reachable":1201,"after_hours":1,"caller_hung_up":1}'::jsonb then
    raise exception 'unexpected call effects %', result;
  end if;
end
$$;

rollback;
