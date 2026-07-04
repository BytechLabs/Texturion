-- FEATURE-GAPS BUILD-NOW send-features schema + function assertion suite.
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run: psql -v ON_ERROR_STOP=1 -f supabase/tests/send_features.test.sql
-- The whole suite runs in one transaction and ROLLS BACK — it never pollutes
-- the local database. Self-contained fixtures (own auth.users/company/etc.),
-- distinct 'g'/'h' id prefixes so it can run standalone or after other suites.
--   owner   = 88888888-8888-4888-8888-888888888888
--   company = 99999999-9999-4999-8999-999999999999
--   number  = 99999999-9999-4999-8999-999000000001
--   contact = 99999999-9999-4999-8999-999000000002
--   conv    = 99999999-9999-4999-8999-999000000003

\set ON_ERROR_STOP on

begin;

-- ===========================================================================
-- SF-1. companies gains business_hours (jsonb NOT NULL default '{}'),
--       away_enabled (bool NOT NULL default false), away_message (text NULL),
--       google_review_link (text NULL).
-- ===========================================================================
do $$
declare
  bh_type    text; bh_null boolean; bh_default text;
  ae_type    text; ae_null boolean; ae_default text;
  am_null    boolean;
  grl_null   boolean;
begin
  select data_type, is_nullable='YES', column_default
    into bh_type, bh_null, bh_default
  from information_schema.columns
  where table_schema='public' and table_name='companies' and column_name='business_hours';
  if bh_type is null then raise exception 'SF-1 FAILED: companies.business_hours missing'; end if;
  if bh_type <> 'jsonb' then raise exception 'SF-1 FAILED: business_hours is % (want jsonb)', bh_type; end if;
  if bh_null then raise exception 'SF-1 FAILED: business_hours must be NOT NULL'; end if;
  if bh_default is null or bh_default not like '%{}%' then
    raise exception 'SF-1 FAILED: business_hours default is % (want {})', bh_default;
  end if;

  select data_type, is_nullable='YES', column_default
    into ae_type, ae_null, ae_default
  from information_schema.columns
  where table_schema='public' and table_name='companies' and column_name='away_enabled';
  if ae_type is null then raise exception 'SF-1 FAILED: companies.away_enabled missing'; end if;
  if ae_type <> 'boolean' then raise exception 'SF-1 FAILED: away_enabled is % (want boolean)', ae_type; end if;
  if ae_null then raise exception 'SF-1 FAILED: away_enabled must be NOT NULL'; end if;
  if ae_default not like '%false%' then raise exception 'SF-1 FAILED: away_enabled default is % (want false)', ae_default; end if;

  select is_nullable='YES' into am_null from information_schema.columns
  where table_schema='public' and table_name='companies' and column_name='away_message';
  if am_null is null then raise exception 'SF-1 FAILED: companies.away_message missing'; end if;
  if not am_null then raise exception 'SF-1 FAILED: away_message must be NULLable'; end if;

  select is_nullable='YES' into grl_null from information_schema.columns
  where table_schema='public' and table_name='companies' and column_name='google_review_link';
  if grl_null is null then raise exception 'SF-1 FAILED: companies.google_review_link missing'; end if;
  if not grl_null then raise exception 'SF-1 FAILED: google_review_link must be NULLable'; end if;

  raise notice 'SF-1 PASSED: companies send-features columns present with correct types/defaults';
end $$;

-- ===========================================================================
-- SF-2. conversations gains last_auto_reply_at (timestamptz NULL).
-- ===========================================================================
do $$
declare c_type text; c_null boolean;
begin
  select data_type, is_nullable='YES' into c_type, c_null
  from information_schema.columns
  where table_schema='public' and table_name='conversations' and column_name='last_auto_reply_at';
  if c_type is null then raise exception 'SF-2 FAILED: conversations.last_auto_reply_at missing'; end if;
  if c_type <> 'timestamp with time zone' then
    raise exception 'SF-2 FAILED: last_auto_reply_at is % (want timestamptz)', c_type;
  end if;
  if not c_null then raise exception 'SF-2 FAILED: last_auto_reply_at must be NULLable'; end if;
  raise notice 'SF-2 PASSED: conversations.last_auto_reply_at timestamptz NULL';
end $$;

-- ===========================================================================
-- SF-3. conversation_event_type gained 'auto_reply_sent' + 'review_requested'.
-- ===========================================================================
do $$
declare labels text[];
begin
  select array_agg(e.enumlabel::text) into labels
  from pg_enum e join pg_type t on t.oid = e.enumtypid
  where t.typname = 'conversation_event_type';
  if not ('auto_reply_sent' = any(labels)) then
    raise exception 'SF-3 FAILED: conversation_event_type missing auto_reply_sent';
  end if;
  if not ('review_requested' = any(labels)) then
    raise exception 'SF-3 FAILED: conversation_event_type missing review_requested';
  end if;
  raise notice 'SF-3 PASSED: auto_reply_sent + review_requested enum values present';
end $$;

-- ===========================================================================
-- SF-4. claim_auto_reply / claim_review_request are service-role-only
--       (EXECUTE revoked from public/anon/authenticated).
-- ===========================================================================
do $$
declare fn text; leaked text;
begin
  foreach fn in array array['claim_auto_reply','claim_review_request'] loop
    select string_agg(distinct r.rolname, ',') into leaked
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(p.proacl) a
    join pg_roles r on r.oid = a.grantee
    where n.nspname='public' and p.proname=fn
      and a.privilege_type='EXECUTE'
      and r.rolname in ('public','anon','authenticated');
    if leaked is not null then
      raise exception 'SF-4 FAILED: % has EXECUTE leaked to %', fn, leaked;
    end if;
  end loop;
  raise notice 'SF-4 PASSED: claim_* functions are service-role-only';
end $$;

-- ===========================================================================
-- Fixtures for the behavioural function tests.
-- ===========================================================================
insert into auth.users (id, email, raw_user_meta_data)
values ('88888888-8888-4888-8888-888888888888', 'owner@send.test',
        '{"display_name":"Send Owner"}'::jsonb);

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, plan)
values ('99999999-9999-4999-8999-999999999999', 'Send Test HVAC',
        '88888888-8888-4888-8888-888888888888', 'CA', '416', now(),
        'active', 'starter');

insert into public.company_members (company_id, user_id, role)
values ('99999999-9999-4999-8999-999999999999',
        '88888888-8888-4888-8888-888888888888', 'owner');

insert into public.phone_numbers (id, company_id, status, provisioning_key, country, number_e164)
values ('99999999-9999-4999-8999-999000000001', '99999999-9999-4999-8999-999999999999',
        'active', 'cs_test_send_1', 'CA', '+14165550100');

insert into public.contacts (id, company_id, phone_e164, name)
values ('99999999-9999-4999-8999-999000000002', '99999999-9999-4999-8999-999999999999',
        '+14165550111', 'Send Contact');

insert into public.conversations (id, company_id, contact_id, phone_number_id, status)
values ('99999999-9999-4999-8999-999000000003', '99999999-9999-4999-8999-999999999999',
        '99999999-9999-4999-8999-999000000002', '99999999-9999-4999-8999-999000000001', 'open');

-- ===========================================================================
-- SF-5. claim_auto_reply — happy path: inserts a queued outbound message,
--       stamps last_auto_reply_at, logs an auto_reply_sent event.
-- ===========================================================================
do $$
declare
  res      jsonb;
  msg_id   uuid;
  la       timestamptz;
  ev_count int;
begin
  res := public.claim_auto_reply(
    '99999999-9999-4999-8999-999999999999',
    '99999999-9999-4999-8999-999000000003',
    'We are closed now — reply URGENT for a no-heat emergency.', 1, 10800);
  if res ? 'skipped' then
    raise exception 'SF-5 FAILED: unexpected skip %', res->>'skipped';
  end if;
  msg_id := (res->'message'->>'id')::uuid;
  if msg_id is null then raise exception 'SF-5 FAILED: no message returned'; end if;

  -- Queued outbound row with the body, no idempotency key.
  perform 1 from public.messages
   where id = msg_id and direction='outbound' and status='queued'
     and body like 'We are closed%';
  if not found then raise exception 'SF-5 FAILED: queued outbound row not written correctly'; end if;

  -- last_auto_reply_at stamped.
  select last_auto_reply_at into la from public.conversations
   where id = '99999999-9999-4999-8999-999000000003';
  if la is null then raise exception 'SF-5 FAILED: last_auto_reply_at not stamped'; end if;

  -- auto_reply_sent event logged (actor null = system).
  select count(*) into ev_count from public.conversation_events
   where conversation_id='99999999-9999-4999-8999-999000000003'
     and type='auto_reply_sent' and actor_user_id is null;
  if ev_count <> 1 then raise exception 'SF-5 FAILED: expected 1 auto_reply_sent event, got %', ev_count; end if;

  raise notice 'SF-5 PASSED: claim_auto_reply inserts, stamps throttle, logs event';
end $$;

-- ===========================================================================
-- SF-6. claim_auto_reply — throttle: a second call within the window skips.
-- ===========================================================================
do $$
declare res jsonb;
begin
  res := public.claim_auto_reply(
    '99999999-9999-4999-8999-999999999999',
    '99999999-9999-4999-8999-999000000003', 'again', 1, 10800);
  if res->>'skipped' <> 'throttled' then
    raise exception 'SF-6 FAILED: expected throttled, got %', res;
  end if;
  raise notice 'SF-6 PASSED: claim_auto_reply throttles a repeat within the window';
end $$;

-- ===========================================================================
-- SF-7. claim_auto_reply — opt-out: never auto-sends to an opted-out contact.
-- ===========================================================================
do $$
declare res jsonb;
begin
  -- Clear the throttle so opt-out is the reason (not the SF-6 stamp).
  update public.conversations set last_auto_reply_at = null
   where id='99999999-9999-4999-8999-999000000003';
  insert into public.opt_outs (company_id, phone_e164, source)
  values ('99999999-9999-4999-8999-999999999999', '+14165550111', 'manual');

  res := public.claim_auto_reply(
    '99999999-9999-4999-8999-999999999999',
    '99999999-9999-4999-8999-999000000003', 'blocked', 1, 10800);
  if res->>'skipped' <> 'recipient_opted_out' then
    raise exception 'SF-7 FAILED: expected recipient_opted_out, got %', res;
  end if;

  -- Revoke for the review tests below.
  update public.opt_outs set revoked_at = now()
   where company_id='99999999-9999-4999-8999-999999999999' and phone_e164='+14165550111';
  raise notice 'SF-7 PASSED: claim_auto_reply honors the opt-out mirror';
end $$;

-- ===========================================================================
-- SF-8. claim_review_request — happy path: inserts, logs review_requested
--       with actor = the member.
-- ===========================================================================
do $$
declare res jsonb; msg_id uuid; ev_count int;
begin
  res := public.claim_review_request(
    '99999999-9999-4999-8999-999999999999',
    '99999999-9999-4999-8999-999000000003',
    '88888888-8888-4888-8888-888888888888',
    'Thanks! Review us: https://g.page/r/x', 1, 2592000);
  if res ? 'skipped' then raise exception 'SF-8 FAILED: unexpected skip %', res->>'skipped'; end if;
  msg_id := (res->'message'->>'id')::uuid;
  if msg_id is null then raise exception 'SF-8 FAILED: no message returned'; end if;

  select count(*) into ev_count from public.conversation_events
   where conversation_id='99999999-9999-4999-8999-999000000003'
     and type='review_requested'
     and actor_user_id='88888888-8888-4888-8888-888888888888';
  if ev_count <> 1 then raise exception 'SF-8 FAILED: expected 1 review_requested event, got %', ev_count; end if;
  raise notice 'SF-8 PASSED: claim_review_request inserts + logs review_requested (actor stamped)';
end $$;

-- ===========================================================================
-- SF-9. claim_review_request — one-per-job suppression: a second ask within
--       the window skips (already_requested).
-- ===========================================================================
do $$
declare res jsonb;
begin
  res := public.claim_review_request(
    '99999999-9999-4999-8999-999999999999',
    '99999999-9999-4999-8999-999000000003',
    '88888888-8888-4888-8888-888888888888',
    'again', 1, 2592000);
  if res->>'skipped' <> 'already_requested' then
    raise exception 'SF-9 FAILED: expected already_requested, got %', res;
  end if;
  raise notice 'SF-9 PASSED: claim_review_request suppresses a repeat ask (one per job)';
end $$;

-- ===========================================================================
-- SF-10. claim_review_request — opt-out is honored.
-- ===========================================================================
do $$
declare res jsonb;
begin
  insert into public.opt_outs (company_id, phone_e164, source)
  values ('99999999-9999-4999-8999-999999999999', '+14165550111', 'manual')
  on conflict (company_id, phone_e164) do update set revoked_at = null;

  res := public.claim_review_request(
    '99999999-9999-4999-8999-999999999999',
    '99999999-9999-4999-8999-999000000003',
    '88888888-8888-4888-8888-888888888888',
    'blocked review', 1, 2592000);
  if res->>'skipped' <> 'recipient_opted_out' then
    raise exception 'SF-10 FAILED: expected recipient_opted_out, got %', res;
  end if;
  raise notice 'SF-10 PASSED: claim_review_request honors the opt-out mirror';
end $$;

rollback;
