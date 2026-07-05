-- #12 Pricing Phase 0 — outbound_spend_check verdicts + claim_auto_reply now
-- respects the overage cap. Self-contained fixtures under a distinct UUID
-- namespace, rolled back. (Cross-checks that the shared helper agrees with
-- gate_outbound_send's Gate 3 rate limit + Gate 4 overage cap.)

begin;

insert into auth.users (id, email, raw_user_meta_data)
values ('77777777-7777-4777-8777-777777777777', 'owner@phase0.test',
        '{"display_name":"Phase0 Owner"}'::jsonb);

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, plan, overage_cap_multiplier, current_period_start)
values ('77777777-7777-4777-8777-777000000000', 'Phase0 HVAC',
        '77777777-7777-4777-8777-777777777777', 'CA', '416', now(),
        'active', 'starter', 3.00, now() - interval '1 day');

insert into public.company_members (company_id, user_id, role)
values ('77777777-7777-4777-8777-777000000000',
        '77777777-7777-4777-8777-777777777777', 'owner');

insert into public.phone_numbers (id, company_id, status, provisioning_key, country, number_e164)
values ('77777777-7777-4777-8777-777000000001', '77777777-7777-4777-8777-777000000000',
        'active', 'cs_test_phase0_1', 'CA', '+14165550100');

insert into public.contacts (id, company_id, phone_e164, name)
values ('77777777-7777-4777-8777-777000000002', '77777777-7777-4777-8777-777000000000',
        '+14165550111', 'Phase0 Contact');

insert into public.conversations (id, company_id, contact_id, phone_number_id, status)
values ('77777777-7777-4777-8777-777000000003', '77777777-7777-4777-8777-777000000000',
        '77777777-7777-4777-8777-777000000002', '77777777-7777-4777-8777-777000000001', 'open');

-- ===========================================================================
-- P0-1. outbound_spend_check — a fresh company well under its cap: allowed (NULL).
-- ===========================================================================
do $$
begin
  if public.outbound_spend_check('77777777-7777-4777-8777-777000000000', 1) is not null then
    raise exception 'P0-1 FAILED: fresh company should be allowed (NULL)';
  end if;
  raise notice 'P0-1 PASSED: outbound_spend_check allows a send under the cap';
end $$;

-- Tighten the cap to 5 segments (0.01 x 500 quota; multiplier is numeric(6,2))
-- and park 5 queued segments (under the 250/hour rate limit) so the NEXT
-- segment breaches the overage cap.
update public.companies set overage_cap_multiplier = 0.01
 where id = '77777777-7777-4777-8777-777000000000';

insert into public.messages
  (company_id, conversation_id, direction, body, status, segments, sent_by_user_id)
values ('77777777-7777-4777-8777-777000000000', '77777777-7777-4777-8777-777000000003',
        'outbound', 'queued spend', 'queued', 5, '77777777-7777-4777-8777-777777777777');

-- ===========================================================================
-- P0-2. outbound_spend_check — over the overage cap → 'usage_cap_reached'.
-- ===========================================================================
do $$
begin
  if public.outbound_spend_check('77777777-7777-4777-8777-777000000000', 1)
     is distinct from 'usage_cap_reached' then
    raise exception 'P0-2 FAILED: over-cap should be usage_cap_reached, got %',
      public.outbound_spend_check('77777777-7777-4777-8777-777000000000', 1);
  end if;
  raise notice 'P0-2 PASSED: outbound_spend_check blocks a send past the overage cap';
end $$;

-- ===========================================================================
-- P0-3. claim_auto_reply — over the cap now SKIPS (no insert, no dispatch),
--       reusing the 'skipped' contract. This is the core Phase 0 fix.
-- ===========================================================================
do $$
declare
  res         jsonb;
  before_msgs int;
  after_msgs  int;
begin
  select count(*) into before_msgs from public.messages
   where conversation_id = '77777777-7777-4777-8777-777000000003';

  res := public.claim_auto_reply(
    '77777777-7777-4777-8777-777000000000',
    '77777777-7777-4777-8777-777000000003',
    'We are closed now — reply URGENT for a no-heat emergency.', 1, 10800);

  if res->>'skipped' is distinct from 'usage_cap_reached' then
    raise exception 'P0-3 FAILED: claim_auto_reply should skip usage_cap_reached, got %', res;
  end if;

  select count(*) into after_msgs from public.messages
   where conversation_id = '77777777-7777-4777-8777-777000000003';
  if after_msgs <> before_msgs then
    raise exception 'P0-3 FAILED: an over-cap auto-reply must not write a message';
  end if;
  raise notice 'P0-3 PASSED: claim_auto_reply skips (no spend) when over the overage cap';
end $$;

-- ===========================================================================
-- P0-3b. claim_missed_call_text — over the cap SKIPS too (it may thread the
--        caller, but writes NO outbound booking text and does not dispatch).
-- ===========================================================================
do $$
declare
  res        jsonb;
  out_before int;
  out_after  int;
begin
  select count(*) into out_before from public.messages
   where company_id = '77777777-7777-4777-8777-777000000000' and direction = 'outbound';

  res := public.claim_missed_call_text(
    '77777777-7777-4777-8777-777000000000',
    '77777777-7777-4777-8777-777000000001',
    '+14165559999', 'call-phase0-1',
    'Sorry we missed your call — text us here to book.', 1, 10800);

  if res->>'skipped' is distinct from 'usage_cap_reached' then
    raise exception 'P0-3b FAILED: claim_missed_call_text should skip usage_cap_reached, got %', res;
  end if;

  select count(*) into out_after from public.messages
   where company_id = '77777777-7777-4777-8777-777000000000' and direction = 'outbound';
  if out_after <> out_before then
    raise exception 'P0-3b FAILED: an over-cap missed-call text must not write an outbound message';
  end if;
  raise notice 'P0-3b PASSED: claim_missed_call_text skips (no spend) when over the overage cap';
end $$;

-- ===========================================================================
-- P0-4. outbound_spend_check — 250 segments in the trailing hour → 'rate_limited'
--       (Gate 3 is checked before the cap).
-- ===========================================================================
insert into public.messages
  (company_id, conversation_id, direction, body, status, segments, sent_by_user_id)
values ('77777777-7777-4777-8777-777000000000', '77777777-7777-4777-8777-777000000003',
        'outbound', 'rate filler', 'queued', 250, '77777777-7777-4777-8777-777777777777');

do $$
begin
  if public.outbound_spend_check('77777777-7777-4777-8777-777000000000', 1)
     is distinct from 'rate_limited' then
    raise exception 'P0-4 FAILED: >=250 segments/hour should be rate_limited, got %',
      public.outbound_spend_check('77777777-7777-4777-8777-777000000000', 1);
  end if;
  raise notice 'P0-4 PASSED: outbound_spend_check rate-limits at 250 segments/hour';
end $$;

-- ===========================================================================
-- P0-5. outbound_spend_check + claim_auto_reply are SERVICE-ROLE only.
-- ===========================================================================
do $$
declare
  fn   text;
  acl  boolean;
begin
  foreach fn in array array['outbound_spend_check', 'claim_auto_reply'] loop
    select has_function_privilege('authenticated', p.oid, 'EXECUTE') into acl
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn
     limit 1;
    if acl then
      raise exception 'P0-5 FAILED: % is executable by authenticated (should be service-role only)', fn;
    end if;
  end loop;
  raise notice 'P0-5 PASSED: outbound_spend_check + claim_auto_reply are service-role only';
end $$;

rollback;
