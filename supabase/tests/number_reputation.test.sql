-- [#235] Number reputation — assertion suite for
-- supabase/migrations/20260730000300_number_reputation.sql.
--
-- The hard part of this feature is not detection, it is NOT CRYING WOLF, so
-- that is what most of this pins. At this platform's size a number sends a few
-- dozen texts a week; a system that called three bad Tuesdays "your number has
-- been flagged as spam" would cost us the customer over a false alarm, and
-- then nobody would believe the one that was real.
--
-- So: a thin sample must stay quiet, a healthy number must stay quiet, 'watch'
-- must never reach a customer, and a genuinely collapsed number must be caught.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/number_reputation.test.sql
--
-- One transaction, rolled back. Fixtures use a 'da' id prefix so the file runs
-- standalone OR after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

-- Only these numbers exist for the duration, so counts are about the fixtures.
--
-- The dependents come first because their foreign keys are ON DELETE RESTRICT,
-- not CASCADE: tasks and usage_events hold messages down, tasks also holds
-- conversations, and port_requests/text_enablement_orders hold phone_numbers.
-- Without these the wipe fails the moment the database contains anything at
-- all — which is what `node scripts/dev-seed.mjs && npm run db:test:all` does
-- (#474). Everything here is inside the transaction this file rolls back.
delete from public.tasks;
delete from public.usage_events;
delete from public.messages;
delete from public.conversations;
delete from public.number_health;
delete from public.port_requests;
delete from public.text_enablement_orders;
delete from public.phone_numbers;

insert into auth.users (id, email) values
  ('da000000-0000-4000-8000-00000000000a'::uuid, 'rep-owner@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('da000000-0000-4000-8000-0000000000c1'::uuid, 'Rep Co',
   'da000000-0000-4000-8000-00000000000a'::uuid, 'CA', '416', now());

insert into public.phone_numbers
  (id, company_id, status, country, number_e164, provisioning_key)
values
  -- healthy, plenty of volume
  ('da000000-0000-4000-8000-00000000a1a1'::uuid,
   'da000000-0000-4000-8000-0000000000c1'::uuid, 'active', 'CA', '+14165550001', 'k1'),
  -- collapsed against its own baseline
  ('da000000-0000-4000-8000-00000000a2a2'::uuid,
   'da000000-0000-4000-8000-0000000000c1'::uuid, 'active', 'CA', '+14165550002', 'k2'),
  -- thin sample, terrible rate
  ('da000000-0000-4000-8000-00000000a3a3'::uuid,
   'da000000-0000-4000-8000-0000000000c1'::uuid, 'active', 'CA', '+14165550003', 'k3');

insert into public.contacts (id, company_id, phone_e164) values
  ('da000000-0000-4000-8000-0000000000e1'::uuid,
   'da000000-0000-4000-8000-0000000000c1'::uuid, '+14165559999');

insert into public.conversations (id, company_id, contact_id, phone_number_id, status)
values
  ('da000000-0000-4000-8000-00000000b1b1'::uuid, 'da000000-0000-4000-8000-0000000000c1'::uuid,
   'da000000-0000-4000-8000-0000000000e1'::uuid, 'da000000-0000-4000-8000-00000000a1a1'::uuid, 'open'),
  ('da000000-0000-4000-8000-00000000b2b2'::uuid, 'da000000-0000-4000-8000-0000000000c1'::uuid,
   'da000000-0000-4000-8000-0000000000e1'::uuid, 'da000000-0000-4000-8000-00000000a2a2'::uuid, 'open'),
  ('da000000-0000-4000-8000-00000000b3b3'::uuid, 'da000000-0000-4000-8000-0000000000c1'::uuid,
   'da000000-0000-4000-8000-0000000000e1'::uuid, 'da000000-0000-4000-8000-00000000a3a3'::uuid, 'open');

-- Helper: N messages of a given direction/status at an age in days.
create or replace function pg_temp.seed(
  p_conversation uuid, p_direction text, p_status text, p_count int, p_age_days int
) returns void language plpgsql as $$
begin
  insert into public.messages
    (conversation_id, company_id, direction, body, status, sent_by_user_id, created_at)
  select p_conversation,
         (select company_id from public.conversations where id = p_conversation),
         p_direction::public.message_direction, 'x',
         -- messages_note_status: only a note may have a null status, so an
         -- inbound row carries 'received'.
         case when p_direction = 'inbound' then 'received'
              else p_status end::public.message_status,
         -- messages_outbound_actor: an outbound row must name who sent it.
         case when p_direction = 'outbound'
              then 'da000000-0000-4000-8000-00000000000a'::uuid end,
         now() - make_interval(days => p_age_days)
  from generate_series(1, p_count);
end $$;

-- n1: healthy. 40 recent, 39 delivered; a matching baseline.
select pg_temp.seed('da000000-0000-4000-8000-00000000b1b1'::uuid, 'outbound', 'delivered', 39, 2);
select pg_temp.seed('da000000-0000-4000-8000-00000000b1b1'::uuid, 'outbound', 'failed', 1, 2);
select pg_temp.seed('da000000-0000-4000-8000-00000000b1b1'::uuid, 'outbound', 'delivered', 78, 14);
select pg_temp.seed('da000000-0000-4000-8000-00000000b1b1'::uuid, 'outbound', 'failed', 2, 14);
select pg_temp.seed('da000000-0000-4000-8000-00000000b1b1'::uuid, 'inbound', 'received', 10, 2);
select pg_temp.seed('da000000-0000-4000-8000-00000000b1b1'::uuid, 'inbound', 'received', 40, 14);

-- n2: was delivering ~98%, now ~50%. The case this feature exists for.
select pg_temp.seed('da000000-0000-4000-8000-00000000b2b2'::uuid, 'outbound', 'delivered', 20, 2);
select pg_temp.seed('da000000-0000-4000-8000-00000000b2b2'::uuid, 'outbound', 'failed', 20, 2);
select pg_temp.seed('da000000-0000-4000-8000-00000000b2b2'::uuid, 'outbound', 'delivered', 98, 14);
select pg_temp.seed('da000000-0000-4000-8000-00000000b2b2'::uuid, 'outbound', 'failed', 2, 14);

-- n3: 4 sends, 1 delivered. A dreadful rate on a meaningless sample.
select pg_temp.seed('da000000-0000-4000-8000-00000000b3b3'::uuid, 'outbound', 'delivered', 1, 2);
select pg_temp.seed('da000000-0000-4000-8000-00000000b3b3'::uuid, 'outbound', 'failed', 3, 2);

-- ---------------------------------------------------------------------------
-- The assessment itself.
-- ---------------------------------------------------------------------------

do $$
declare
  v_state text;
begin
  perform public.api_assess_number_health();

  -- n1: nothing wrong, nothing said.
  select state into v_state from public.number_health
   where phone_number_id = 'da000000-0000-4000-8000-00000000a1a1'::uuid;
  if v_state <> 'healthy' then
    raise exception 'a number delivering 97%% against a 97%% baseline must be healthy, got %',
      v_state;
  end if;

  -- n2: caught. 50% against a 98% baseline is not a bad week.
  select state into v_state from public.number_health
   where phone_number_id = 'da000000-0000-4000-8000-00000000a2a2'::uuid;
  if v_state <> 'degraded' then
    raise exception 'a collapse from 98%% to 50%% must be degraded, got %', v_state;
  end if;

  -- n3: THE false-alarm case. 25% delivery looks catastrophic and means
  -- nothing on four sends. Telling this customer their number is flagged
  -- would be the failure mode that costs us the account.
  select state into v_state from public.number_health
   where phone_number_id = 'da000000-0000-4000-8000-00000000a3a3'::uuid;
  if v_state <> 'healthy' then
    raise exception
      'a 4-message sample must never produce a verdict, got % — this is the '
      'false alarm that costs a customer', v_state;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 'watch' is ours. The customer never sees it.
-- ---------------------------------------------------------------------------

do $$
declare
  v_visible text;
begin
  update public.number_health set state = 'watch'
   where phone_number_id = 'da000000-0000-4000-8000-00000000a1a1'::uuid;

  select state into v_visible
    from public.api_number_health('da000000-0000-4000-8000-0000000000c1'::uuid)
   where phone_number_id = 'da000000-0000-4000-8000-00000000a1a1'::uuid;

  if v_visible <> 'healthy' then
    raise exception
      'watch must read as healthy to the owner, got % — a maybe-degraded '
      'warning on a thin signal is how a false alarm becomes a cancellation',
      v_visible;
  end if;

  -- Put it back. This block forced a state the data does not support, and
  -- leaving it would make the NEXT block see a watch->healthy transition that
  -- the assessor was right to report.
  update public.number_health set state = 'healthy'
   where phone_number_id = 'da000000-0000-4000-8000-00000000a1a1'::uuid;
end $$;

-- ---------------------------------------------------------------------------
-- Only a TRANSITION is news. A number bad for nine days is not news on day 9.
-- ---------------------------------------------------------------------------

do $$
declare
  v_changed int;
  v_since   timestamptz;
  v_after   timestamptz;
begin
  select degraded_since into v_since from public.number_health
   where phone_number_id = 'da000000-0000-4000-8000-00000000a2a2'::uuid;

  -- Re-running against unchanged data must report nothing.
  select count(*) into v_changed from public.api_assess_number_health();
  if v_changed <> 0 then
    raise exception
      're-assessing unchanged data reported % transitions; a known-bad number '
      'must not re-announce itself every morning until somebody mutes it',
      v_changed;
  end if;

  -- And the clock must not restart, or the banner cannot say how long.
  select degraded_since into v_after from public.number_health
   where phone_number_id = 'da000000-0000-4000-8000-00000000a2a2'::uuid;
  if v_after is distinct from v_since then
    raise exception 'degraded_since must be held across assessments';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Recovery clears the state and the clock.
-- ---------------------------------------------------------------------------

do $$
declare
  v_state text;
  v_since timestamptz;
begin
  -- The number starts delivering again.
  update public.messages set status = 'delivered'
   where conversation_id = 'da000000-0000-4000-8000-00000000b2b2'::uuid
     and status = 'failed';

  perform public.api_assess_number_health();

  select state, degraded_since into v_state, v_since from public.number_health
   where phone_number_id = 'da000000-0000-4000-8000-00000000a2a2'::uuid;
  if v_state <> 'healthy' then
    raise exception 'a recovered number must return to healthy, got %', v_state;
  end if;
  if v_since is not null then
    raise exception 'degraded_since must clear on recovery';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Silent filtering: delivered, billed, and never answered.
-- ---------------------------------------------------------------------------

do $$
declare
  v_state text;
begin
  -- n1 used to get 40 replies over the baseline window and now gets none,
  -- while delivery still reads ~97%. This is the shape of a carrier accepting
  -- and dropping, which no delivery-rate check would ever catch.
  delete from public.messages
   where conversation_id = 'da000000-0000-4000-8000-00000000b1b1'::uuid
     and direction = 'inbound'
     and created_at > now() - interval '7 days';

  perform public.api_assess_number_health();

  select state into v_state from public.number_health
   where phone_number_id = 'da000000-0000-4000-8000-00000000a1a1'::uuid;
  if v_state <> 'degraded' then
    raise exception
      'a number with a healthy delivery rate and zero replies against an '
      'established baseline must be degraded, got % — this is the only signal '
      'that shows silent filtering', v_state;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------------

do $$
declare
  v_leak text;
begin
  select string_agg(p.proname, ', ') into v_leak
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('api_assess_number_health', 'api_number_health')
     and (
       has_function_privilege('anon', p.oid, 'execute')
       or has_function_privilege('authenticated', p.oid, 'execute')
     );
  if v_leak is not null then
    raise exception 'these must not be reachable by anon/authenticated: %', v_leak;
  end if;
end $$;

rollback;
