-- [#304] One definition of "what did this workspace use, between these two
-- instants" — assertion suite for supabase/migrations/20260804180000_usage_window.sql.
--
-- UW-2 is the one to read twice. The bookkeeper's whole request is a CLOSED
-- window — a month that has already ended — and every usage function before
-- this one took `p_since` and ran to the end of time. A function that ignored
-- its upper bound would pass a test that only ever asked about "everything
-- since", and would hand a bookkeeper next month's traffic inside last
-- month's total. So the exclusions are asserted on BOTH sides.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/usage_window.test.sql
--
-- One transaction, rolled back. Fixtures use an '9a' id prefix so the file
-- runs standalone OR after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('9a000000-0000-4000-8000-00000000000a'::uuid, 'usage-a@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('9a000000-0000-4000-8000-0000000000c1'::uuid, 'Window HVAC',
   '9a000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now()),
  -- The neighbour. Every figure below must ignore it entirely.
  ('9a000000-0000-4000-8000-0000000000c2'::uuid, 'Other HVAC',
   '9a000000-0000-4000-8000-00000000000a'::uuid, 'US', '416', now());

insert into public.phone_numbers
  (id, company_id, provisioning_key, country, number_e164, status)
values
  ('9a000000-0000-4000-8000-0000000000d1'::uuid,
   '9a000000-0000-4000-8000-0000000000c1'::uuid, 'pk-9a-1', 'US',
   '+14155550001', 'active');

insert into public.contacts (id, company_id, phone_e164, name) values
  ('9a000000-0000-4000-8000-0000000000e1'::uuid,
   '9a000000-0000-4000-8000-0000000000c1'::uuid, '+14155559001', 'Dana');

insert into public.conversations (id, company_id, contact_id, phone_number_id) values
  ('9a000000-0000-4000-8000-0000000000f1'::uuid,
   '9a000000-0000-4000-8000-0000000000c1'::uuid,
   '9a000000-0000-4000-8000-0000000000e1'::uuid,
   '9a000000-0000-4000-8000-0000000000d1'::uuid);

-- The window under test is all of June 2026. Rows are placed deliberately on
-- both sides of it and on both of its edges.
insert into public.usage_events (company_id, type, quantity, stripe_reported_at, created_at)
values
  -- Inside, already reported to Stripe: 4 + 3 = 7 segments.
  ('9a000000-0000-4000-8000-0000000000c1'::uuid, 'sms_outbound', 4,
   '2026-07-01T02:00:00Z', '2026-06-10T12:00:00Z'),
  ('9a000000-0000-4000-8000-0000000000c1'::uuid, 'mms_outbound', 3,
   '2026-07-01T02:00:00Z', '2026-06-20T12:00:00Z'),
  -- Inside, NOT yet reported: 5 segments. This is the reconciliation gap.
  ('9a000000-0000-4000-8000-0000000000c1'::uuid, 'sms_outbound', 5,
   null, '2026-06-25T12:00:00Z'),
  -- Before the window, and after it. Neither may appear in any total.
  ('9a000000-0000-4000-8000-0000000000c1'::uuid, 'sms_outbound', 100,
   null, '2026-05-31T23:59:59Z'),
  ('9a000000-0000-4000-8000-0000000000c1'::uuid, 'sms_outbound', 200,
   null, '2026-07-01T00:00:01Z'),
  -- The neighbour's traffic, squarely inside the window.
  ('9a000000-0000-4000-8000-0000000000c2'::uuid, 'sms_outbound', 999,
   null, '2026-06-15T12:00:00Z');

insert into public.messages
  (company_id, conversation_id, direction, body, status, segments,
   sent_by_user_id, created_at)
values
  -- Inside: 2 + 1 (null defaults to one) = 3 inbound segments.
  ('9a000000-0000-4000-8000-0000000000c1'::uuid,
   '9a000000-0000-4000-8000-0000000000f1'::uuid, 'inbound', 'hi', 'received', 2,
   null, '2026-06-11T12:00:00Z'),
  ('9a000000-0000-4000-8000-0000000000c1'::uuid,
   '9a000000-0000-4000-8000-0000000000f1'::uuid, 'inbound', 'again', 'received', null,
   null, '2026-06-12T12:00:00Z'),
  -- Outbound inside the window: metered by usage_events, never by this arm.
  ('9a000000-0000-4000-8000-0000000000c1'::uuid,
   '9a000000-0000-4000-8000-0000000000f1'::uuid, 'outbound', 'reply', 'sent', 9,
   '9a000000-0000-4000-8000-00000000000a'::uuid, '2026-06-13T12:00:00Z'),
  -- Inbound outside the window.
  ('9a000000-0000-4000-8000-0000000000c1'::uuid,
   '9a000000-0000-4000-8000-0000000000f1'::uuid, 'inbound', 'later', 'received', 50,
   null, '2026-07-05T12:00:00Z');

insert into public.call_records
  (company_id, phone_number_id, call_leg_id, leg, billable_seconds, created_at)
values
  -- Both DIALED legs count, because both are what the meter bills.
  ('9a000000-0000-4000-8000-0000000000c1'::uuid,
   '9a000000-0000-4000-8000-0000000000d1'::uuid, 'leg-9a-1', 'forward', 90,
   '2026-06-14T12:00:00Z'),
  ('9a000000-0000-4000-8000-0000000000c1'::uuid,
   '9a000000-0000-4000-8000-0000000000d1'::uuid, 'leg-9a-2', 'out_customer', 30,
   '2026-06-15T12:00:00Z'),
  -- The inbound leg is the one somebody else paid to dial. Never ours.
  ('9a000000-0000-4000-8000-0000000000c1'::uuid,
   '9a000000-0000-4000-8000-0000000000d1'::uuid, 'leg-9a-3', 'inbound', 600,
   '2026-06-16T12:00:00Z'),
  -- Outside the window.
  ('9a000000-0000-4000-8000-0000000000c1'::uuid,
   '9a000000-0000-4000-8000-0000000000d1'::uuid, 'leg-9a-4', 'forward', 7200,
   '2026-07-09T12:00:00Z');

-- ---------------------------------------------------------------------------
-- UW-1: the billed segment total is the meter's, and only the window's.
-- ---------------------------------------------------------------------------
do $$
declare v_out bigint;
begin
  select outbound_segments into v_out
    from public.api_usage_window(
      '9a000000-0000-4000-8000-0000000000c1'::uuid,
      '2026-06-01T00:00:00Z'::timestamptz,
      '2026-06-30T23:59:59Z'::timestamptz);
  if v_out <> 12 then
    raise exception 'UW-1: expected 12 outbound segments in June, got %', v_out;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- UW-2: the UPPER bound is real.
--
-- The failure this suite exists for. Every usage function before this one ran
-- from p_since to the end of time; one that kept doing so would answer "June"
-- with June plus July and nothing would look wrong. Asserted by asking for a
-- window that ENDS mid-fixture and checking the later rows are absent.
-- ---------------------------------------------------------------------------
do $$
declare v_out bigint; v_open bigint;
begin
  select outbound_segments into v_out
    from public.api_usage_window(
      '9a000000-0000-4000-8000-0000000000c1'::uuid,
      '2026-06-01T00:00:00Z'::timestamptz,
      '2026-06-15T00:00:00Z'::timestamptz);
  if v_out <> 4 then
    raise exception
      'UW-2: a window ending 15 June returned % segments, not the 4 before it', v_out;
  end if;

  -- And the open-ended form still means "everything since", which is what the
  -- live usage screen asks for and must not have changed.
  select outbound_segments into v_open
    from public.api_usage_window(
      '9a000000-0000-4000-8000-0000000000c1'::uuid,
      '2026-06-01T00:00:00Z'::timestamptz,
      null);
  if v_open <> 212 then
    raise exception 'UW-2: the open-ended window returned %, not 212', v_open;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- UW-3: inbound is counted from messages, and a null segment count is one.
--
-- Inbound has never been billed (#12) and so has no meter row. Reading it from
-- usage_events would silently report zero — a workspace that received two
-- hundred texts would look like it received none.
-- ---------------------------------------------------------------------------
do $$
declare v_in bigint;
begin
  select inbound_segments into v_in
    from public.api_usage_window(
      '9a000000-0000-4000-8000-0000000000c1'::uuid,
      '2026-06-01T00:00:00Z'::timestamptz,
      '2026-06-30T23:59:59Z'::timestamptz);
  if v_in <> 3 then
    raise exception
      'UW-3: expected 3 inbound segments (2 + a null counted as 1), got %', v_in;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- UW-4: voice is the DIALED legs only.
--
-- The inbound leg is the one the caller's own carrier billed them for. Adding
-- it here would roughly quintuple the minutes on a workspace that mostly
-- receives calls, and the first they would know is the invoice.
-- ---------------------------------------------------------------------------
do $$
declare v_seconds bigint;
begin
  select forward_seconds into v_seconds
    from public.api_usage_window(
      '9a000000-0000-4000-8000-0000000000c1'::uuid,
      '2026-06-01T00:00:00Z'::timestamptz,
      '2026-06-30T23:59:59Z'::timestamptz);
  if v_seconds <> 120 then
    raise exception
      'UW-4: expected 120 dialed seconds (90 forward + 30 outbound), got %', v_seconds;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- UW-5: the reconciliation split, and that it accounts for everything.
--
-- The two halves must sum to the total. A split that dropped rows — a filter
-- that missed the ones written before stripe_reported_at existed, say — would
-- hand a bookkeeper two numbers that do not add up to the one above them,
-- which is worse than not splitting at all.
-- ---------------------------------------------------------------------------
do $$
declare v_row record;
begin
  select * into v_row
    from public.api_usage_window(
      '9a000000-0000-4000-8000-0000000000c1'::uuid,
      '2026-06-01T00:00:00Z'::timestamptz,
      '2026-06-30T23:59:59Z'::timestamptz);

  if v_row.reported_segments <> 7 then
    raise exception 'UW-5: expected 7 reported segments, got %', v_row.reported_segments;
  end if;
  if v_row.unreported_segments <> 5 then
    raise exception 'UW-5: expected 5 unreported segments, got %', v_row.unreported_segments;
  end if;
  if v_row.reported_segments + v_row.unreported_segments <> v_row.outbound_segments then
    raise exception
      'UW-5: the split (% + %) does not account for the total (%)',
      v_row.reported_segments, v_row.unreported_segments, v_row.outbound_segments;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- UW-6: another workspace's traffic is not in this one's figures.
--
-- The function is security definer, so it carries no RLS. The company filter
-- IS the tenant boundary here, and a bookkeeper's export is exactly the
-- artifact that would carry a leak out of the building.
-- ---------------------------------------------------------------------------
do $$
declare v_row record;
begin
  select * into v_row
    from public.api_usage_window(
      '9a000000-0000-4000-8000-0000000000c1'::uuid,
      '2026-06-01T00:00:00Z'::timestamptz,
      '2026-06-30T23:59:59Z'::timestamptz);
  if v_row.outbound_segments >= 999 then
    raise exception
      'UW-6: the neighbouring workspace''s 999 segments are in this total (%)',
      v_row.outbound_segments;
  end if;

  -- And the neighbour reads its own traffic, so the filter is a filter rather
  -- than something that returns nothing at all.
  select * into v_row
    from public.api_usage_window(
      '9a000000-0000-4000-8000-0000000000c2'::uuid,
      '2026-06-01T00:00:00Z'::timestamptz,
      '2026-06-30T23:59:59Z'::timestamptz);
  if v_row.outbound_segments <> 999 then
    raise exception 'UW-6: the neighbour reads % of its own 999 segments',
      v_row.outbound_segments;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- UW-7: an empty window is zero, not null.
--
-- coalesce on every arm. A null total would render as an empty cell in the
-- bookkeeper's spreadsheet, which reads as "we did not measure this" rather
-- than "nothing happened".
-- ---------------------------------------------------------------------------
do $$
declare v_row record;
begin
  select * into v_row
    from public.api_usage_window(
      '9a000000-0000-4000-8000-0000000000c1'::uuid,
      '2020-01-01T00:00:00Z'::timestamptz,
      '2020-01-31T00:00:00Z'::timestamptz);
  if v_row.outbound_segments is distinct from 0
     or v_row.inbound_segments is distinct from 0
     or v_row.forward_seconds is distinct from 0
     or v_row.reported_segments is distinct from 0
     or v_row.unreported_segments is distinct from 0 then
    raise exception 'UW-7: an empty window did not read as zeros (%)', v_row;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- UW-8: no end-user role can execute it.
--
-- SPEC §6 deny-by-default. It is security definer over every workspace's
-- usage, so a stray grant would let any authenticated user total any company.
-- ---------------------------------------------------------------------------
do $$
declare v_grantee text;
begin
  select string_agg(grantee, ',') into v_grantee
    from information_schema.role_routine_grants
    where routine_schema = 'public'
      and routine_name = 'api_usage_window'
      and grantee in ('PUBLIC', 'anon', 'authenticated');
  if v_grantee is not null then
    raise exception 'UW-8: api_usage_window is executable by %', v_grantee;
  end if;
end $$;

rollback;
