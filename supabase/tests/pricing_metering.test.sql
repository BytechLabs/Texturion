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

-- ===========================================================================
-- M-3. usage_alerts.metric (#12 storage alerts): the PK spans metric, so the
--      same (company, period, threshold) coexists across the three metrics;
--      the column defaults to 'segments' for the pre-#12 backfill.
-- ===========================================================================
do $$
declare v_count int;
begin
  insert into public.usage_alerts (company_id, period_start, metric, threshold)
  values ('66666666-6666-4666-8666-666000000000', '2026-06-01T00:00:00Z', 'segments', 80),
         ('66666666-6666-4666-8666-666000000000', '2026-06-01T00:00:00Z', 'mms_storage', 80),
         ('66666666-6666-4666-8666-666000000000', '2026-06-01T00:00:00Z', 'attachment_storage', 80);
  select count(*) into v_count from public.usage_alerts
   where company_id = '66666666-6666-4666-8666-666000000000'
     and period_start = '2026-06-01T00:00:00Z';
  if v_count <> 3 then
    raise exception 'M-3 FAILED: expected 3 metric rows at one threshold, got %', v_count;
  end if;

  insert into public.usage_alerts (company_id, period_start, threshold)
  values ('66666666-6666-4666-8666-666000000000', '2026-07-01T00:00:00Z', 100);
  perform 1 from public.usage_alerts
   where company_id = '66666666-6666-4666-8666-666000000000'
     and period_start = '2026-07-01T00:00:00Z' and metric = 'segments';
  if not found then
    raise exception 'M-3 FAILED: metric did not default to segments';
  end if;
  raise notice 'M-3 PASSED: usage_alerts.metric widens the PK; defaults to segments';
end $$;

-- ===========================================================================
-- M-4. a duplicate within a single metric still conflicts on the PK.
-- ===========================================================================
do $$
begin
  insert into public.usage_alerts (company_id, period_start, metric, threshold)
  values ('66666666-6666-4666-8666-666000000000', '2026-06-01T00:00:00Z', 'segments', 80);
  raise exception 'M-4 FAILED: duplicate (company, period, metric, threshold) accepted';
exception
  when unique_violation then
    raise notice 'M-4 PASSED: duplicate within a metric still conflicts on the PK';
end $$;

-- ===========================================================================
-- M-5. an unknown metric is rejected by the check constraint.
-- ===========================================================================
do $$
begin
  insert into public.usage_alerts (company_id, period_start, metric, threshold)
  values ('66666666-6666-4666-8666-666000000000', '2026-06-01T00:00:00Z', 'bogus', 80);
  raise exception 'M-5 FAILED: unknown metric accepted';
exception
  when check_violation then
    raise notice 'M-5 PASSED: unknown metric rejected by the check constraint';
end $$;

-- ===========================================================================
-- M-5b. 'voice_minutes' is an accepted metric (#12 voice alerts).
-- ===========================================================================
do $$
begin
  insert into public.usage_alerts (company_id, period_start, metric, threshold)
  values ('66666666-6666-4666-8666-666000000000', '2026-08-01T00:00:00Z', 'voice_minutes', 80);
  raise notice 'M-5b PASSED: voice_minutes accepted by the metric check';
end $$;

-- ===========================================================================
-- M-6. api_period_voice_seconds (#12 voice metering) sums billable_seconds over
--      BOTH legs in the period and excludes pre-period rows.
-- ===========================================================================
do $$
declare v bigint;
begin
  insert into public.call_records
    (company_id, phone_number_id, call_session_id, call_leg_id, leg, billable_seconds, created_at)
  values
    ('66666666-6666-4666-8666-666000000000', '66666666-6666-4666-8666-666000000001', 'sess-1', 'leg-inb-1', 'inbound', 30, now()),
    ('66666666-6666-4666-8666-666000000000', '66666666-6666-4666-8666-666000000001', 'sess-1', 'leg-fwd-1', 'forward', 25, now()),
    ('66666666-6666-4666-8666-666000000000', '66666666-6666-4666-8666-666000000001', 'sess-0', 'leg-old-1', 'inbound', 999, now() - interval '40 days');
  v := public.api_period_voice_seconds(
    '66666666-6666-4666-8666-666000000000', now() - interval '30 days');
  if v <> 55 then
    raise exception 'M-6 FAILED: expected 55 in-period voice seconds (30+25), got %', v;
  end if;
  raise notice 'M-6 PASSED: api_period_voice_seconds sums both legs in-period, excludes pre-period';
end $$;

-- ===========================================================================
-- M-7. a duplicate call_leg_id conflicts (webhook replay is a no-op).
-- ===========================================================================
do $$
begin
  insert into public.call_records (company_id, call_leg_id, leg, billable_seconds)
  values ('66666666-6666-4666-8666-666000000000', 'leg-inb-1', 'inbound', 10);
  raise exception 'M-7 FAILED: duplicate call_leg_id accepted';
exception
  when unique_violation then
    raise notice 'M-7 PASSED: duplicate call_leg_id conflicts on the unique key';
end $$;

-- ===========================================================================
-- M-8. api_period_voice_seconds is service-role only.
-- ===========================================================================
do $$
declare acl boolean;
begin
  select has_function_privilege('authenticated', p.oid, 'EXECUTE') into acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'api_period_voice_seconds' limit 1;
  if acl then raise exception 'M-8 FAILED: api_period_voice_seconds executable by authenticated'; end if;
  raise notice 'M-8 PASSED: api_period_voice_seconds is service-role only';
end $$;

rollback;
