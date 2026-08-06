-- [#303] Somewhere to report abuse, with a budget ordinary traffic cannot eat
-- — assertion suite for 20260804300000_abuse_intake.sql.
--
-- AB-2 is the whole point. The daily cap exists for a good reason: each stored
-- submission sends two emails, so an uncapped public form is a bot army
-- running up the bill. But counting a carrier's abuse report against the same
-- twenty as a sales enquiry means an ordinary Tuesday silently drops the one
-- message that protects every customer's deliverability.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/abuse_intake.test.sql
--
-- One transaction, rolled back.

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- AB-1: a submission that does not say what it is, is a general one.
--
-- The default is what keeps every existing caller meaning exactly what it
-- meant before this column existed.
-- ---------------------------------------------------------------------------
do $$
declare v_result jsonb; v_kind text;
begin
  v_result := public.api_claim_contact_message(
    'Dana', 'dana@example.com', null, 'A question about plans.', '203.0.113.7', 20);
  if (v_result->>'allowed')::boolean is not true then
    raise exception 'AB-1: an ordinary submission was refused (%)', v_result;
  end if;

  select kind into v_kind
    from public.contact_messages where id = (v_result->>'id')::uuid;
  if v_kind is distinct from 'general' then
    raise exception 'AB-1: the default kind is %, not general', v_kind;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- AB-2: a full general day does NOT block an abuse report.
--
-- THE ONE THAT MATTERS. Before this change the counters were shared, so the
-- twentieth sales enquiry closed the door on every report for the rest of the
-- day — the cost protection suppressing the reports that protect the sending
-- pool.
-- ---------------------------------------------------------------------------
do $$
declare v_result jsonb; i int; v_cap int;
begin
  -- The cap is relative to what today already holds: this file runs in ONE
  -- transaction, so AB-1's row is still visible and a literal cap would be
  -- consumed before the loop starts. (It was, first time round.)
  select count(*) + 5 into v_cap
    from public.contact_messages
   where created_at >= date_trunc('day', now()) and kind = 'general';

  -- Fill the general budget exactly.
  for i in 1..5 loop
    v_result := public.api_claim_contact_message(
      'Bot ' || i, 'bot' || i || '@example.com', null,
      'Generic enquiry number ' || i, '203.0.113.9', v_cap);
    if (v_result->>'allowed')::boolean is not true then
      raise exception 'AB-2: general submission % was refused early (%)', i, v_result;
    end if;
  end loop;

  -- The next general one is refused, which proves the cap is real.
  v_result := public.api_claim_contact_message(
    'One too many', 'over@example.com', null, 'Over the line.', '203.0.113.9', v_cap);
  if (v_result->>'allowed')::boolean is not false then
    raise exception 'AB-2: the general cap did not hold (%)', v_result;
  end if;

  -- And an abuse report still gets through, on its own counter.
  v_result := public.api_claim_contact_message(
    'Carrier Abuse Desk', 'abuse@carrier.example', null,
    'Number +14155550101 is sending unsolicited marketing.', '198.51.100.4',
    100, 'abuse');
  if (v_result->>'allowed')::boolean is not true then
    raise exception
      'AB-2: a full general day blocked an abuse report — the counters are '
      'still shared (%)', v_result;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- AB-3: and the reverse — abuse traffic cannot eat the general budget.
--
-- A separate counter has to be separate in both directions, or a burst of
-- reports (or somebody spamming the abuse form) silently closes the contact
-- form to customers.
-- ---------------------------------------------------------------------------
do $$
declare v_result jsonb; i int; v_cap int;
begin
  select count(*) + 3 into v_cap
    from public.contact_messages
   where created_at >= date_trunc('day', now()) and kind = 'abuse';

  for i in 1..3 loop
    v_result := public.api_claim_contact_message(
      'Reporter ' || i, 'r' || i || '@example.com', null,
      'Report number ' || i, '198.51.100.5', v_cap, 'abuse');
    if (v_result->>'allowed')::boolean is not true then
      raise exception 'AB-3: abuse submission % was refused early', i;
    end if;
  end loop;

  v_result := public.api_claim_contact_message(
    'Reporter 4', 'r4@example.com', null, 'One past the abuse cap.',
    '198.51.100.5', v_cap, 'abuse');
  if (v_result->>'allowed')::boolean is not false then
    raise exception 'AB-3: the abuse cap did not hold (%)', v_result;
  end if;

  -- A general submission is unaffected by the abuse day being full.
  v_result := public.api_claim_contact_message(
    'Customer', 'customer@example.com', null, 'A perfectly ordinary question.',
    '203.0.113.20', 20);
  if (v_result->>'allowed')::boolean is not true then
    raise exception 'AB-3: a full abuse day closed the contact form (%)', v_result;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- AB-4: an unknown kind is refused, never filed as general.
--
-- Filing it as general would put a report under the budget that runs out,
-- which is the failure this whole change removes.
-- ---------------------------------------------------------------------------
do $$
declare v_raised boolean := false; v_message text;
begin
  begin
    perform public.api_claim_contact_message(
      'X', 'x@example.com', null, 'A message.', '203.0.113.21', 20, 'urgent');
  exception when others then
    v_raised := true;
    get stacked diagnostics v_message = message_text;
  end;
  if not v_raised then
    raise exception 'AB-4: kind ''urgent'' was accepted';
  end if;
  -- The FUNCTION's own guard, not the column's. Written first as "any error
  -- was raised", which passed with the function's check deleted because the
  -- check constraint caught it on insert instead — a guard proven by the wrong
  -- mechanism is a guard that is not there.
  if v_message not like 'api_claim_contact_message: unknown kind%' then
    raise exception
      'AB-4: rejected by something other than the function guard (%)', v_message;
  end if;

  -- The column refuses it too, from its own side.
  v_raised := false;
  begin
    insert into public.contact_messages (name, email, message, kind)
    values ('X', 'x@example.com', 'A message.', 'urgent');
  exception when check_violation then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'AB-4: the kind constraint is missing';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- AB-5: yesterday's traffic does not count against today.
--
-- The cap is a DAILY one. A count over all time would close the form
-- permanently on a busy week, which is a worse outage than the bill it exists
-- to prevent.
-- ---------------------------------------------------------------------------
do $$
declare v_result jsonb;
begin
  insert into public.contact_messages (name, email, message, kind, created_at)
  select 'Old', 'old@example.com', 'Yesterday.', 'abuse', now() - interval '2 days'
    from generate_series(1, 50);

  v_result := public.api_claim_contact_message(
    'Today', 'today@example.com', null, 'A report today.', '198.51.100.9',
    -- Cast: count(*) is bigint and p_cap is int, so the bare subquery does not
    -- resolve to any overload of this function.
    (select (count(*) + 1)::int from public.contact_messages
      where created_at >= date_trunc('day', now()) and kind = 'abuse'),
    'abuse');
  if (v_result->>'allowed')::boolean is not true then
    raise exception 'AB-5: rows from two days ago counted against today (%)', v_result;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- AB-6: no end-user role can execute it.
--
-- SPEC §6 deny-by-default. It is security definer and writes an append-only
-- table from a PUBLIC endpoint; a stray grant would let anybody bypass the
-- Worker's honeypot, rate limit and captcha entirely.
-- ---------------------------------------------------------------------------
do $$
declare v_grantee text;
begin
  select string_agg(distinct grantee, ',') into v_grantee
    from information_schema.role_routine_grants
   where routine_schema = 'public'
     and routine_name = 'api_claim_contact_message'
     and grantee in ('PUBLIC', 'anon', 'authenticated');
  if v_grantee is not null then
    raise exception 'AB-6: api_claim_contact_message is executable by %', v_grantee;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- AB-7: the daily counter is locked PER KIND.
--
-- A concurrency property, so it is asserted against the function's definition
-- rather than its behaviour: in one session a shared lock produces identical
-- results, which is exactly why the break sweep found the per-kind key
-- decorative. What it costs in production is real though — a burst of sales
-- enquiries serialising a carrier's report behind them, at the moment the
-- report matters most.
-- ---------------------------------------------------------------------------
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'api_claim_contact_message';

  if v_def is null then
    raise exception 'AB-7: api_claim_contact_message not found';
  end if;
  if v_def not like '%contact_messages_daily:%p_kind%' then
    raise exception
      'AB-7: the advisory lock is not keyed by kind — general traffic can '
      'serialise an abuse report behind it';
  end if;
end $$;

rollback;
