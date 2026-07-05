-- #12 Increment A — api_period_inbound_segments: derives current-period inbound
-- volume from the messages table (visibility, not billing). Self-contained
-- fixtures, rolled back.

begin;

insert into auth.users (id, email, raw_user_meta_data)
values ('66666666-6666-4666-8666-666666666666', 'owner@meter.test',
        '{"display_name":"Meter Owner"}'::jsonb);

insert into public.companies (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values ('66666666-6666-4666-8666-666000000000', 'Meter HVAC',
        '66666666-6666-4666-8666-666666666666', 'CA', '416', now());

insert into public.company_members (company_id, user_id, role)
values ('66666666-6666-4666-8666-666000000000',
        '66666666-6666-4666-8666-666666666666', 'owner');

insert into public.phone_numbers (id, company_id, status, provisioning_key, country, number_e164)
values ('66666666-6666-4666-8666-666000000001', '66666666-6666-4666-8666-666000000000',
        'active', 'cs_test_meter_1', 'CA', '+14165550100');

insert into public.contacts (id, company_id, phone_e164, name)
values ('66666666-6666-4666-8666-666000000002', '66666666-6666-4666-8666-666000000000',
        '+14165550111', 'Meter Contact');

insert into public.conversations (id, company_id, contact_id, phone_number_id, status)
values ('66666666-6666-4666-8666-666000000003', '66666666-6666-4666-8666-666000000000',
        '66666666-6666-4666-8666-666000000002', '66666666-6666-4666-8666-666000000001', 'open');

-- Two inbound IN period (1 + 3 segments), one inbound BEFORE period (excluded by
-- the since cutoff), one outbound (excluded by direction), and one inbound with
-- NULL segments (counts as the coalesce floor of 1).
insert into public.messages (company_id, conversation_id, direction, body, status, segments, created_at)
values
  ('66666666-6666-4666-8666-666000000000', '66666666-6666-4666-8666-666000000003', 'inbound', 'a', 'received', 1, now()),
  ('66666666-6666-4666-8666-666000000000', '66666666-6666-4666-8666-666000000003', 'inbound', 'b', 'received', 3, now()),
  ('66666666-6666-4666-8666-666000000000', '66666666-6666-4666-8666-666000000003', 'inbound', 'old', 'received', 9, now() - interval '40 days'),
  ('66666666-6666-4666-8666-666000000000', '66666666-6666-4666-8666-666000000003', 'inbound', 'nullseg', 'received', null, now());
insert into public.messages (company_id, conversation_id, direction, body, status, segments, sent_by_user_id, created_at)
values
  ('66666666-6666-4666-8666-666000000000', '66666666-6666-4666-8666-666000000003', 'outbound', 'out', 'sent', 5, '66666666-6666-4666-8666-666666666666', now());

-- ===========================================================================
-- M-1. counts only IN-period INBOUND segments (1 + 3 + null→1 = 5); excludes the
--      40-day-old inbound and the outbound.
-- ===========================================================================
do $$
declare v bigint;
begin
  v := public.api_period_inbound_segments(
    '66666666-6666-4666-8666-666000000000', now() - interval '30 days');
  if v <> 5 then
    raise exception 'M-1 FAILED: expected 5 inbound segments in period, got %', v;
  end if;
  raise notice 'M-1 PASSED: api_period_inbound_segments sums in-period inbound (null=1), excludes outbound + pre-period';
end $$;

-- ===========================================================================
-- M-2. service-role only.
-- ===========================================================================
do $$
declare acl boolean;
begin
  select has_function_privilege('authenticated', p.oid, 'EXECUTE') into acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'api_period_inbound_segments' limit 1;
  if acl then raise exception 'M-2 FAILED: api_period_inbound_segments executable by authenticated'; end if;
  raise notice 'M-2 PASSED: api_period_inbound_segments is service-role only';
end $$;

rollback;
