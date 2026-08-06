-- [#233] Send later — assertion suite for
-- supabase/migrations/20260803090000_scheduled_messages.sql.
--
-- What is pinned here is the set of rules that would fail SILENTLY, which for
-- this feature means one of three things happening without anybody noticing:
-- a customer gets the same text twice, a customer gets a text somebody
-- cancelled, or a message the owner scheduled quietly never goes at all.
--
-- The last is the one this repo has already ruled on. docs/DECISIONS.md fixed
-- the policy for queued work before the feature existed: held not dropped,
-- every hold and cancellation disclosed, and time-sensitive work expiring
-- rather than arriving late. Several tests below exist only because of that
-- rule — in particular SM-8, which asserts the expiry sweep RETURNS the rows it
-- expired, because a caller cannot disclose what it cannot see.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/scheduled_messages.test.sql
--
-- One transaction, rolled back. Fixtures use a '5d' id prefix so the file runs
-- standalone OR after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;


insert into auth.users (id, email) values
  ('5d000000-0000-4000-8000-00000000000a'::uuid, 'later-a@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('5d000000-0000-4000-8000-0000000000c1'::uuid, 'Later Plumbing',
   '5d000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now()),
  ('5d000000-0000-4000-8000-0000000000c2'::uuid, 'Other Plumbing',
   '5d000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());

insert into public.company_members (company_id, user_id, role) values
  ('5d000000-0000-4000-8000-0000000000c1'::uuid,
   '5d000000-0000-4000-8000-00000000000a'::uuid, 'owner');

insert into public.phone_numbers
  (id, company_id, provisioning_key, country, number_e164, status)
values ('5d000000-0000-4000-8000-0000000000f1'::uuid,
        '5d000000-0000-4000-8000-0000000000c1'::uuid,
        'later-1', 'US', '+12125557001', 'active'),
       ('5d000000-0000-4000-8000-0000000000f2'::uuid,
        '5d000000-0000-4000-8000-0000000000c2'::uuid,
        'later-2', 'US', '+12125557002', 'active');

insert into public.contacts (id, company_id, phone_e164, name)
values ('5d000000-0000-4000-8000-0000000000d1'::uuid,
        '5d000000-0000-4000-8000-0000000000c1'::uuid,
        '+12125559701', 'Later Customer'),
       ('5d000000-0000-4000-8000-0000000000d2'::uuid,
        '5d000000-0000-4000-8000-0000000000c2'::uuid,
        '+12125559702', 'Other Customer');

insert into public.conversations
  (id, company_id, contact_id, phone_number_id, status, last_message_at)
values ('5d000000-0000-4000-8000-0000000000e1'::uuid,
        '5d000000-0000-4000-8000-0000000000c1'::uuid,
        '5d000000-0000-4000-8000-0000000000d1'::uuid,
        '5d000000-0000-4000-8000-0000000000f1'::uuid, 'open', now()),
       ('5d000000-0000-4000-8000-0000000000e2'::uuid,
        '5d000000-0000-4000-8000-0000000000c2'::uuid,
        '5d000000-0000-4000-8000-0000000000d2'::uuid,
        '5d000000-0000-4000-8000-0000000000f2'::uuid, 'open', now());

-- ===========================================================================
-- SM-1. Scheduling stores the wall clock, WHOSE clock it was, and where the
--       conversation stood at the time.
--
-- The provenance is not decoration. On the weakest rung "Monday 8am" is the
-- shop's 8am, not the customer's, and a UI that cannot tell the difference
-- implies a precision this product does not have.
-- ===========================================================================
do $$
declare
  v_res jsonb;
  v_row public.scheduled_messages;
begin
  -- An inbound already in the thread, so the watermark has something to record.
  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments)
  values ('5d000000-0000-4000-8000-0000000000c1'::uuid,
          '5d000000-0000-4000-8000-0000000000e1'::uuid,
          'inbound', 'how much for the boiler?', 'received', 1);

  v_res := public.api_schedule_message(
    '5d000000-0000-4000-8000-0000000000c1'::uuid,
    '5d000000-0000-4000-8000-0000000000e1'::uuid,
    '5d000000-0000-4000-8000-00000000000a'::uuid,
    '  Still thinking about that quote?  ',
    now() + interval '2 hours',
    'America/New_York', 'area_code',
    now() + interval '26 hours');

  if v_res->>'outcome' is distinct from 'scheduled' then
    raise exception 'SM-1 FAILED: expected scheduled, got %', v_res->>'outcome';
  end if;

  select * into v_row from public.scheduled_messages
   where id = (v_res->'scheduled_message'->>'id')::uuid;

  if v_row.body is distinct from 'Still thinking about that quote?' then
    raise exception 'SM-1 FAILED: body not trimmed, got %', v_row.body;
  end if;
  if v_row.clock_source is distinct from 'area_code'
     or v_row.clock_timezone is distinct from 'America/New_York' then
    raise exception 'SM-1 FAILED: clock provenance not stored (% / %)',
      v_row.clock_source, v_row.clock_timezone;
  end if;
  if v_row.inbound_watermark is null then
    raise exception 'SM-1 FAILED: inbound watermark not captured, so a reply '
      'arriving before fire time could never be noticed';
  end if;
  if v_row.status is distinct from 'pending' then
    raise exception 'SM-1 FAILED: expected pending, got %', v_row.status;
  end if;

  raise notice 'SM-1 PASSED: the wall clock, whose clock it is, and where the thread stood';
end $$;

-- ===========================================================================
-- SM-2. A time in the past, and a time past the horizon, are answers rather
--       than exceptions.
--
-- Both are things to tell somebody. A raise would make the route translate an
-- exception string into a message, which is how error copy drifts.
-- ===========================================================================
do $$
declare
  v_past jsonb;
  v_far  jsonb;
begin
  v_past := public.api_schedule_message(
    '5d000000-0000-4000-8000-0000000000c1'::uuid,
    '5d000000-0000-4000-8000-0000000000e1'::uuid,
    '5d000000-0000-4000-8000-00000000000a'::uuid,
    'yesterday', now() - interval '1 minute',
    'America/New_York', 'contact', now() + interval '1 day');

  if v_past->>'outcome' is distinct from 'in_the_past' then
    raise exception 'SM-2 FAILED: a past send_at was accepted (%)', v_past;
  end if;

  v_far := public.api_schedule_message(
    '5d000000-0000-4000-8000-0000000000c1'::uuid,
    '5d000000-0000-4000-8000-0000000000e1'::uuid,
    '5d000000-0000-4000-8000-00000000000a'::uuid,
    'in two years', now() + interval '2 years',
    'America/New_York', 'contact', now() + interval '2 years');

  if v_far->>'outcome' is distinct from 'too_far_out' then
    raise exception 'SM-2 FAILED: a send two years out was accepted (%)', v_far;
  end if;
  if (v_far->>'limit_days')::int is distinct from 90 then
    raise exception 'SM-2 FAILED: the horizon was not reported to the caller';
  end if;

  raise notice 'SM-2 PASSED: the past and the far future are answers, not exceptions';
end $$;

-- ===========================================================================
-- SM-3. Scheduling into another workspace's conversation is not found.
--
-- These functions are SECURITY DEFINER, so a bug in one route must not be able
-- to reach another tenant's thread. Checked in the function, not only above it.
-- ===========================================================================
do $$
declare
  v_res jsonb;
begin
  v_res := public.api_schedule_message(
    '5d000000-0000-4000-8000-0000000000c1'::uuid,
    '5d000000-0000-4000-8000-0000000000e2'::uuid,   -- the OTHER company's
    '5d000000-0000-4000-8000-00000000000a'::uuid,
    'wrong tenant', now() + interval '1 hour',
    'America/New_York', 'company', now() + interval '2 days');

  if v_res->>'outcome' is distinct from 'not_found' then
    raise exception 'SM-3 FAILED: scheduled into another tenant''s thread (%)',
      v_res;
  end if;

  raise notice 'SM-3 PASSED: SECURITY DEFINER cannot be steered across tenants';
end $$;

-- ===========================================================================
-- SM-4. The claim is a LEASE, and it is exclusive.
--
-- Two workers in the same minute must not both take the same row — that is one
-- customer receiving one message twice. But a worker that dies must not strand
-- the row either, so the lease ages out and the row becomes due again.
-- ===========================================================================
do $$
declare
  v_id     uuid;
  v_first  jsonb;
  v_second jsonb;
  v_later  jsonb;
begin
  v_id := (public.api_schedule_message(
    '5d000000-0000-4000-8000-0000000000c1'::uuid,
    '5d000000-0000-4000-8000-0000000000e1'::uuid,
    '5d000000-0000-4000-8000-00000000000a'::uuid,
    'lease me', now() + interval '1 hour',
    'America/New_York', 'contact', now() + interval '2 days'
  )->'scheduled_message'->>'id')::uuid;

  -- Due, from the firing job's point of view.
  v_first := public.api_claim_due_scheduled_messages(
    now() + interval '90 minutes', 10, 300);
  if jsonb_array_length(v_first) < 1 then
    raise exception 'SM-4 FAILED: a due message was not claimed';
  end if;

  -- A second worker in the same window gets nothing.
  v_second := public.api_claim_due_scheduled_messages(
    now() + interval '90 minutes', 10, 300);
  if jsonb_array_length(v_second) is distinct from 0 then
    raise exception 'SM-4 FAILED: a second worker claimed a leased row — that '
      'is the same text sent to the customer twice';
  end if;

  -- ...but a worker that died leaves a row that comes back, rather than one
  -- that is stuck forever in a state nothing scans.
  v_later := public.api_claim_due_scheduled_messages(
    now() + interval '100 minutes', 10, 300);
  if jsonb_array_length(v_later) < 1 then
    raise exception 'SM-4 FAILED: an expired lease did not release the row, so '
      'a crashed worker would strand a customer''s message permanently';
  end if;

  raise notice 'SM-4 PASSED: exclusive while held, released when the worker dies';
end $$;

-- ===========================================================================
-- SM-5. Firing makes the outbound row and closes the intent in one statement,
--       and cannot happen twice.
-- ===========================================================================
do $$
declare
  v_id      uuid;
  v_fired   jsonb;
  v_again   jsonb;
  v_row     public.scheduled_messages;
  v_message public.messages;
begin
  v_id := (public.api_schedule_message(
    '5d000000-0000-4000-8000-0000000000c1'::uuid,
    '5d000000-0000-4000-8000-0000000000e1'::uuid,
    '5d000000-0000-4000-8000-00000000000a'::uuid,
    'the quote is 400', now() + interval '1 hour',
    'America/New_York', 'contact', now() + interval '2 days'
  )->'scheduled_message'->>'id')::uuid;

  v_fired := public.api_fire_scheduled_message(v_id, 1);
  if v_fired->>'outcome' is distinct from 'fired' then
    raise exception 'SM-5 FAILED: expected fired, got %', v_fired->>'outcome';
  end if;

  select * into v_message from public.messages
   where id = (v_fired->'message'->>'id')::uuid;

  if v_message.direction is distinct from 'outbound' or v_message.status is distinct from 'queued' then
    raise exception 'SM-5 FAILED: the message must land queued+outbound so the '
      '#411 interrupted-send retry owns the crash window (got % / %)',
      v_message.direction, v_message.status;
  end if;
  if v_message.body is distinct from 'the quote is 400' then
    raise exception 'SM-5 FAILED: the body did not survive to the message';
  end if;

  select * into v_row from public.scheduled_messages where id = v_id;
  if v_row.status is distinct from 'sent' or v_row.sent_message_id is distinct from v_message.id then
    raise exception 'SM-5 FAILED: the intent was not closed against the message';
  end if;

  -- A replayed job tick must not send it again.
  v_again := public.api_fire_scheduled_message(v_id, 1);
  if v_again->>'outcome' is distinct from 'gone' then
    raise exception 'SM-5 FAILED: fired twice — the customer gets it twice';
  end if;

  raise notice 'SM-5 PASSED: one statement, one message, exactly once';
end $$;

-- ===========================================================================
-- SM-6. A cancel that lands while the gates are running WINS.
--
-- The real sequence is: claim, then run the pre-send gates (which take network
-- time), then fire. Somebody hitting cancel during that window must not receive
-- the message anyway — that is the most visible way this feature can betray
-- somebody, because they watched themselves cancel it.
-- ===========================================================================
do $$
declare
  v_id     uuid;
  v_before bigint;
  v_after  bigint;
  v_cancel jsonb;
  v_fired  jsonb;
begin
  v_id := (public.api_schedule_message(
    '5d000000-0000-4000-8000-0000000000c1'::uuid,
    '5d000000-0000-4000-8000-0000000000e1'::uuid,
    '5d000000-0000-4000-8000-00000000000a'::uuid,
    'ignore this', now() + interval '1 hour',
    'America/New_York', 'contact', now() + interval '2 days'
  )->'scheduled_message'->>'id')::uuid;

  select count(*) into v_before from public.messages
   where conversation_id = '5d000000-0000-4000-8000-0000000000e1'::uuid;

  v_cancel := public.api_cancel_scheduled_message(
    v_id,
    '5d000000-0000-4000-8000-0000000000c1'::uuid,
    '5d000000-0000-4000-8000-00000000000a'::uuid);
  if v_cancel->>'outcome' is distinct from 'canceled' then
    raise exception 'SM-6 FAILED: cancel did not take';
  end if;

  v_fired := public.api_fire_scheduled_message(v_id, 1);
  if v_fired->>'outcome' is distinct from 'gone' then
    raise exception 'SM-6 FAILED: a cancelled message fired anyway (%)', v_fired;
  end if;

  select count(*) into v_after from public.messages
   where conversation_id = '5d000000-0000-4000-8000-0000000000e1'::uuid;
  if v_after is distinct from v_before then
    raise exception 'SM-6 FAILED: a message row was written for a cancelled send';
  end if;

  raise notice 'SM-6 PASSED: cancel beats a fire already in flight';
end $$;

-- ===========================================================================
-- SM-7. A hold keeps a readable reason and puts the row back in the scan.
--
-- "Held, not dropped, and resumes on reinstatement" is the binding rule. The
-- resume is not a separate hook — the row simply becomes claimable again, and
-- the reason is re-evaluated at the next attempt.
-- ===========================================================================
do $$
declare
  v_id    uuid;
  v_held  jsonb;
  v_row   public.scheduled_messages;
  v_claim jsonb;
begin
  v_id := (public.api_schedule_message(
    '5d000000-0000-4000-8000-0000000000c1'::uuid,
    '5d000000-0000-4000-8000-0000000000e1'::uuid,
    '5d000000-0000-4000-8000-00000000000a'::uuid,
    'hold me', now() + interval '1 hour',
    'America/New_York', 'contact', now() + interval '5 days'
  )->'scheduled_message'->>'id')::uuid;

  v_held := public.api_hold_scheduled_message(
    v_id, 'your subscription is paused, so we did not send this yet');
  if v_held->>'outcome' is distinct from 'held' then
    raise exception 'SM-7 FAILED: hold did not take';
  end if;

  select * into v_row from public.scheduled_messages where id = v_id;
  if v_row.held_reason is null or v_row.held_at is null then
    raise exception 'SM-7 FAILED: a hold with no stated reason is the silent '
      'disappearance docs/DECISIONS.md rules out';
  end if;
  if v_row.claimed_at is not null then
    raise exception 'SM-7 FAILED: the lease was not released, so the held row '
      'would wait a full lease before anyone looked at it again';
  end if;

  -- Resumes: it is claimable again on a later tick.
  v_claim := public.api_claim_due_scheduled_messages(
    now() + interval '2 hours', 10, 300);
  if not exists (
    select 1 from jsonb_array_elements(v_claim) e
     where (e->>'id')::uuid = v_id) then
    raise exception 'SM-7 FAILED: a held message never comes back, so it was '
      'dropped rather than held';
  end if;

  raise notice 'SM-7 PASSED: held with a reason, and it comes back';
end $$;

-- ===========================================================================
-- SM-8. Expiry sweeps the horizon AND HANDS BACK WHAT IT EXPIRED.
--
-- Rule 3 is "expires rather than arriving late"; rule 2 is "anything held or
-- cancelled is disclosed". A sweep returning a COUNT would satisfy the first
-- and quietly make the second impossible, because the caller cannot tell an
-- owner about rows it never saw. This is the assertion that keeps the two
-- rules from being implemented one at a time.
-- ===========================================================================
do $$
declare
  v_id      uuid;
  v_expired jsonb;
  v_row     public.scheduled_messages;
begin
  v_id := (public.api_schedule_message(
    '5d000000-0000-4000-8000-0000000000c1'::uuid,
    '5d000000-0000-4000-8000-0000000000e1'::uuid,
    '5d000000-0000-4000-8000-00000000000a'::uuid,
    'too late to matter', now() + interval '1 hour',
    'America/New_York', 'contact', now() + interval '3 hours'
  )->'scheduled_message'->>'id')::uuid;

  v_expired := public.api_expire_scheduled_messages(now() + interval '4 hours', 50);

  -- Checked before the membership test below, so that a sweep reporting a
  -- COUNT fails with the reason rather than with "cannot extract elements from
  -- an object" eight frames down. A count satisfies rule 3 and makes rule 2
  -- impossible, which is exactly the plausible half-implementation.
  if jsonb_typeof(v_expired) is distinct from 'array' then
    raise exception 'SM-8 FAILED: the sweep returned % rather than the rows. '
      'A count expires the work and leaves nobody able to say WHICH message is '
      'not going, which is the silent disappearance docs/DECISIONS.md rules out',
      jsonb_typeof(v_expired);
  end if;

  if not exists (
    select 1 from jsonb_array_elements(v_expired) e
     where (e->>'id')::uuid = v_id) then
    raise exception 'SM-8 FAILED: the sweep did not hand back the row it '
      'expired, so nobody can be told it is not going';
  end if;

  select * into v_row from public.scheduled_messages where id = v_id;
  if v_row.status is distinct from 'expired' then
    raise exception 'SM-8 FAILED: expected expired, got %', v_row.status;
  end if;
  if v_row.held_reason is null then
    raise exception 'SM-8 FAILED: an expiry with no stated reason is silent';
  end if;

  raise notice 'SM-8 PASSED: expired past the horizon, and returned to be disclosed';
end $$;

-- ===========================================================================
-- SM-9. Closing a workspace cancels what it had queued, with a reason.
--
-- The degradation matrix says "cancelled with notice". A row that outlived its
-- workspace would fire into a number that has been released.
-- ===========================================================================
do $$
declare
  v_id       uuid;
  v_canceled jsonb;
  v_row      public.scheduled_messages;
begin
  v_id := (public.api_schedule_message(
    '5d000000-0000-4000-8000-0000000000c1'::uuid,
    '5d000000-0000-4000-8000-0000000000e1'::uuid,
    '5d000000-0000-4000-8000-00000000000a'::uuid,
    'after closure', now() + interval '3 hours',
    'America/New_York', 'contact', now() + interval '5 days'
  )->'scheduled_message'->>'id')::uuid;

  v_canceled := public.api_cancel_scheduled_for_company(
    '5d000000-0000-4000-8000-0000000000c1'::uuid,
    'the workspace was closed before this was due to send');

  if not exists (
    select 1 from jsonb_array_elements(v_canceled) e
     where (e->>'id')::uuid = v_id) then
    raise exception 'SM-9 FAILED: closure did not hand back the cancelled rows';
  end if;

  select * into v_row from public.scheduled_messages where id = v_id;
  if v_row.status is distinct from 'canceled' or v_row.held_reason is null then
    raise exception 'SM-9 FAILED: cancelled without notice (% / %)',
      v_row.status, v_row.held_reason;
  end if;

  raise notice 'SM-9 PASSED: closure cancels queued work, with notice';
end $$;

-- ===========================================================================
-- SM-10. The table is service_role only, RLS on.
-- ===========================================================================
do $$
declare
  v_rls  boolean;
  v_leak text;
begin
  select c.relrowsecurity into v_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'scheduled_messages';

  if not coalesce(v_rls, false) then
    raise exception 'SM-10 FAILED: RLS is not enabled on scheduled_messages';
  end if;

  select string_agg(grantee, ', ') into v_leak
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name = 'scheduled_messages'
     and grantee in ('anon', 'authenticated', 'public');

  if v_leak is not null then
    raise exception 'SM-10 FAILED: scheduled_messages is reachable by %', v_leak;
  end if;

  raise notice 'SM-10 PASSED: service_role only, RLS on';
end $$;

-- ===========================================================================
-- SM-11. The caps hold, and they are counted inside the function.
--
-- Per-thread, because one conversation quietly becoming a drip campaign is the
-- shape this feature makes easy. The count includes held rows: a workspace
-- whose sends are all held is exactly the one that should not keep queueing.
-- ===========================================================================
do $$
declare
  v_res jsonb;
  i     integer;
begin
  for i in 1..20 loop
    v_res := public.api_schedule_message(
      '5d000000-0000-4000-8000-0000000000c1'::uuid,
      '5d000000-0000-4000-8000-0000000000e1'::uuid,
      '5d000000-0000-4000-8000-00000000000a'::uuid,
      'drip ' || i, now() + interval '1 hour',
      'America/New_York', 'contact', now() + interval '5 days');
    if v_res->>'outcome' = 'thread_cap' then
      exit;
    end if;
  end loop;

  v_res := public.api_schedule_message(
    '5d000000-0000-4000-8000-0000000000c1'::uuid,
    '5d000000-0000-4000-8000-0000000000e1'::uuid,
    '5d000000-0000-4000-8000-00000000000a'::uuid,
    'one too many', now() + interval '1 hour',
    'America/New_York', 'contact', now() + interval '5 days');

  if v_res->>'outcome' is distinct from 'thread_cap' then
    raise exception 'SM-11 FAILED: the per-thread cap did not hold (%)', v_res;
  end if;
  if (v_res->>'limit')::int is distinct from 20 then
    raise exception 'SM-11 FAILED: the cap was not reported to the caller';
  end if;

  raise notice 'SM-11 PASSED: one thread cannot become a drip campaign';
end $$;

rollback;
