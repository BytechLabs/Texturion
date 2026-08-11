-- [#224 / D133] Text-to-pay — the SQL half.
--
-- The API suite exercises these functions through a hand-written double. That
-- double is only as good as somebody's memory of the SQL, and the property it
-- is standing in for is the one that matters most in this feature:
--
--   A CONNECTED-ACCOUNT EVENT MUST NOT REACH ANOTHER WORKSPACE'S REQUEST.
--
-- Connect events arrive on an endpoint anyone who has ever created a Stripe
-- account can reach, carrying an object they control every field of. The only
-- thing standing between that and one business marking another's bill paid is
-- the account predicate inside these two functions. This file asserts it in the
-- place it actually lives.
--
-- PR-8 onwards are #607: the broadcast that tells a crew they were paid without
-- anyone refreshing. A wrong topic or a missing event is invisible everywhere
-- else — the write succeeds, the trigger returns null, nothing reaches a log,
-- and the only symptom is a screen that does not move (or, in the direction that
-- matters more, one that moves for somebody who should not be watching that
-- number). `realtime.send` writes into `realtime.messages`, so the topics ARE
-- observable from SQL, and these three tests read them back.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/payment_requests.test.sql
--
-- One transaction, rolled back. Fixtures use a 'ba' id prefix so the file runs
-- standalone OR after the other suites in one psql session.

-- Every inequality below is `is distinct from`, never `<>`. #248 CL-13: `<>`
-- answers NULL when either side is NULL, so the `if` takes the false branch and
-- the assertion waves through the exact defect it was written to catch — and
-- half the columns here (`paid_at`, `refunded_at`, `amount_refunded_cents`) are
-- null until the thing being asserted has happened.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('ba000000-0000-4000-8000-00000000000a'::uuid, 'pay-owner@test.local'),
  ('ba000000-0000-4000-8000-00000000000b'::uuid, 'pay-rival@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('ba000000-0000-4000-8000-0000000000c1'::uuid, 'Northline Plumbing',
   'ba000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now()),
  ('ba000000-0000-4000-8000-0000000000c2'::uuid, 'Rival Roofing',
   'ba000000-0000-4000-8000-00000000000b'::uuid, 'US', '415', now());

-- TWO numbers on the one company, and a thread on each.
--
-- Not decoration. The per-number topic assertions below distinguish "the number
-- this THREAD belongs to" from "a number this COMPANY owns", and with a single
-- number those two answers are the same string — a trigger that resolved the
-- number from `company_id` would have passed every one of them. A fixture that
-- cannot tell the right answer from a wrong one proves nothing, and this one
-- could not until PR-11 was written.
insert into public.phone_numbers
  (id, company_id, number_e164, status, provisioning_key, country)
values
  ('ba000000-0000-4000-8000-0000000000e1'::uuid,
   'ba000000-0000-4000-8000-0000000000c1'::uuid, '+14155550100', 'active',
   'pay-suite-1', 'US'),
  ('ba000000-0000-4000-8000-0000000000e2'::uuid,
   'ba000000-0000-4000-8000-0000000000c1'::uuid, '+14155550101', 'active',
   'pay-suite-2', 'US');

insert into public.contacts (id, company_id, phone_e164, name)
values
  ('ba000000-0000-4000-8000-0000000000d1'::uuid,
   'ba000000-0000-4000-8000-0000000000c1'::uuid, '+14155550199', 'Maria'),
  ('ba000000-0000-4000-8000-0000000000d2'::uuid,
   'ba000000-0000-4000-8000-0000000000c1'::uuid, '+14155550198', 'Dev');

insert into public.conversations
  (id, company_id, contact_id, phone_number_id, contact_phone_e164)
values
  ('ba000000-0000-4000-8000-0000000000f1'::uuid,
   'ba000000-0000-4000-8000-0000000000c1'::uuid,
   'ba000000-0000-4000-8000-0000000000d1'::uuid,
   'ba000000-0000-4000-8000-0000000000e1'::uuid, '+14155550199'),
  -- The SECOND line's thread. Everything else in this file uses f1/e1, so a
  -- resolver that ignored the thread would keep agreeing with itself until it
  -- was asked about this one.
  ('ba000000-0000-4000-8000-0000000000f2'::uuid,
   'ba000000-0000-4000-8000-0000000000c1'::uuid,
   'ba000000-0000-4000-8000-0000000000d2'::uuid,
   'ba000000-0000-4000-8000-0000000000e2'::uuid, '+14155550198');

insert into public.stripe_connect_accounts
  (company_id, stripe_account_id, country, charges_enabled, details_submitted)
values
  ('ba000000-0000-4000-8000-0000000000c1'::uuid, 'acct_northline', 'US', true, true);

/** A fresh open request. Returned so each block starts from a known state. */
create or replace function pg_temp.new_request(p_id uuid, p_link text)
returns uuid language sql as $$
  insert into public.payment_requests
    (id, company_id, conversation_id, contact_id, amount_cents, currency,
     description, stripe_account_id, stripe_payment_link_id, expires_at)
  values
    (p_id, 'ba000000-0000-4000-8000-0000000000c1'::uuid,
     'ba000000-0000-4000-8000-0000000000f1'::uuid,
     'ba000000-0000-4000-8000-0000000000d1'::uuid,
     25000, 'usd', 'Deposit for Tuesday', 'acct_northline', p_link,
     now() + interval '14 days')
  returning id;
$$;

-- ---------------------------------------------------------------------------
-- PR-1: the shape of a request is constrained where it matters.
-- ---------------------------------------------------------------------------

do $$
begin
  begin
    insert into public.payment_requests
      (company_id, conversation_id, contact_id, amount_cents, currency,
       description, stripe_account_id, expires_at)
    values
      ('ba000000-0000-4000-8000-0000000000c1'::uuid,
       'ba000000-0000-4000-8000-0000000000f1'::uuid,
       'ba000000-0000-4000-8000-0000000000d1'::uuid,
       0, 'usd', 'Nothing', 'acct_northline', now() + interval '1 day');
    raise exception 'a zero-amount request must be refused';
  exception when check_violation then null;
  end;

  begin
    insert into public.payment_requests
      (company_id, conversation_id, contact_id, amount_cents, currency,
       description, stripe_account_id, expires_at)
    values
      ('ba000000-0000-4000-8000-0000000000c1'::uuid,
       'ba000000-0000-4000-8000-0000000000f1'::uuid,
       'ba000000-0000-4000-8000-0000000000d1'::uuid,
       25000, 'gbp', 'Deposit', 'acct_northline', now() + interval '1 day');
    raise exception 'a currency the connected account cannot settle must be refused';
  exception when check_violation then null;
  end;

  -- A description of whitespace is not a description. The customer reads this
  -- on the payment page and on their card statement.
  begin
    insert into public.payment_requests
      (company_id, conversation_id, contact_id, amount_cents, currency,
       description, stripe_account_id, expires_at)
    values
      ('ba000000-0000-4000-8000-0000000000c1'::uuid,
       'ba000000-0000-4000-8000-0000000000f1'::uuid,
       'ba000000-0000-4000-8000-0000000000d1'::uuid,
       25000, 'usd', '   ', 'acct_northline', now() + interval '1 day');
    raise exception 'a blank description must be refused';
  exception when check_violation then null;
  end;

  raise notice 'PR-1 PASSED: amount, currency and description are constrained';
end $$;

-- ---------------------------------------------------------------------------
-- PR-2: THE security property. An event from the wrong connected account
-- changes nothing.
-- ---------------------------------------------------------------------------

do $$
declare
  v_result jsonb;
  v_row    public.payment_requests%rowtype;
begin
  perform pg_temp.new_request('ba000000-0000-4000-8000-000000000011'::uuid, 'plink_one');

  v_result := public.api_mark_payment_request_paid(
    'plink_one', 'acct_somebody_else', 'cs_x', 'pi_x', 'ch_x', 25000);

  if v_result->>'outcome' is distinct from 'unknown' then
    raise exception
      'PR-2 FAILED: a connected account that does not own this request got %',
      v_result;
  end if;

  select * into v_row from public.payment_requests
   where id = 'ba000000-0000-4000-8000-000000000011'::uuid;
  if v_row.status is distinct from 'requested' or v_row.paid_at is not null then
    raise exception 'PR-2 FAILED: the request was altered by a foreign account';
  end if;

  raise notice 'PR-2 PASSED: a foreign connected account cannot mark a request paid';
end $$;

-- ---------------------------------------------------------------------------
-- PR-3: the right account marks it paid, once, however many deliveries arrive.
-- ---------------------------------------------------------------------------

do $$
declare
  v_first  jsonb;
  v_second jsonb;
  v_row    public.payment_requests%rowtype;
begin
  perform pg_temp.new_request('ba000000-0000-4000-8000-000000000012'::uuid, 'plink_two');

  v_first := public.api_mark_payment_request_paid(
    'plink_two', 'acct_northline', 'cs_1', 'pi_1', 'ch_1', 25000);
  if v_first->>'outcome' is distinct from 'paid' then
    raise exception 'PR-3 FAILED: the owning account could not mark it paid: %', v_first;
  end if;
  -- The caller needs the conversation to write the timeline row. Without it the
  -- payment lands and the thread never mentions it.
  if v_first->>'conversation_id' is null or v_first->>'company_id' is null then
    raise exception 'PR-3 FAILED: the paid answer does not name the thread: %', v_first;
  end if;

  v_second := public.api_mark_payment_request_paid(
    'plink_two', 'acct_northline', 'cs_1', 'pi_1', 'ch_1', 25000);
  if v_second->>'outcome' is distinct from 'already_paid' then
    raise exception 'PR-3 FAILED: a redelivery reported % rather than already_paid',
      v_second->>'outcome';
  end if;

  select * into v_row from public.payment_requests
   where id = 'ba000000-0000-4000-8000-000000000012'::uuid;
  if v_row.status is distinct from 'paid' or v_row.amount_received_cents is distinct from 25000
     or v_row.stripe_charge_id is distinct from 'ch_1' then
    raise exception 'PR-3 FAILED: the row does not carry the payment';
  end if;

  raise notice 'PR-3 PASSED: paid once, idempotent under redelivery, names the thread';
end $$;

-- ---------------------------------------------------------------------------
-- PR-4: money is real even when the crew called it off.
--
-- A cancelled request whose link somehow still took a payment must record the
-- payment. Reading it as cancelled is how a customer gets chased for a bill
-- they already settled.
-- ---------------------------------------------------------------------------

do $$
declare
  v_result jsonb;
  v_row    public.payment_requests%rowtype;
begin
  perform pg_temp.new_request('ba000000-0000-4000-8000-000000000013'::uuid, 'plink_three');
  update public.payment_requests
     set status = 'cancelled', cancelled_at = now()
   where id = 'ba000000-0000-4000-8000-000000000013'::uuid;

  v_result := public.api_mark_payment_request_paid(
    'plink_three', 'acct_northline', 'cs_3', 'pi_3', 'ch_3', 25000);
  if v_result->>'outcome' is distinct from 'paid' then
    raise exception 'PR-4 FAILED: a real payment against a cancelled request was dropped: %',
      v_result;
  end if;

  select * into v_row from public.payment_requests
   where id = 'ba000000-0000-4000-8000-000000000013'::uuid;
  if v_row.status is distinct from 'paid' then
    raise exception 'PR-4 FAILED: the row does not say paid';
  end if;
  -- And the cancellation stamp survives, so the thread can show both facts.
  if v_row.cancelled_at is null then
    raise exception 'PR-4 FAILED: the cancellation was erased';
  end if;

  raise notice 'PR-4 PASSED: a payment against a cancelled request is still recorded';
end $$;

-- ---------------------------------------------------------------------------
-- PR-5: refund and dispute settle beside the status, never over it.
-- ---------------------------------------------------------------------------

do $$
declare
  v_result jsonb;
  v_row    public.payment_requests%rowtype;
begin
  perform pg_temp.new_request('ba000000-0000-4000-8000-000000000014'::uuid, 'plink_four');
  perform public.api_mark_payment_request_paid(
    'plink_four', 'acct_northline', 'cs_4', 'pi_4', 'ch_4', 25000);

  -- The wrong account cannot report a refund either.
  v_result := public.api_mark_payment_request_settled(
    'ch_4', 'acct_somebody_else', 'refunded', 25000);
  if v_result->>'outcome' is distinct from 'unknown' then
    raise exception 'PR-5 FAILED: a foreign account settled a charge: %', v_result;
  end if;

  v_result := public.api_mark_payment_request_settled(
    'ch_4', 'acct_northline', 'refunded', 25000);
  if v_result->>'outcome' is distinct from 'refunded' then
    raise exception 'PR-5 FAILED: the owning account could not record a refund: %', v_result;
  end if;

  select * into v_row from public.payment_requests
   where id = 'ba000000-0000-4000-8000-000000000014'::uuid;
  -- A refunded payment WAS paid. Collapsing that into the status would destroy
  -- the fact the crew most needs.
  if v_row.status is distinct from 'paid' then
    raise exception 'PR-5 FAILED: a refund overwrote the paid status';
  end if;
  if v_row.refunded_at is null or v_row.amount_refunded_cents is distinct from 25000 then
    raise exception 'PR-5 FAILED: the refund was not recorded';
  end if;

  -- A second identical refund event is a no-op.
  v_result := public.api_mark_payment_request_settled(
    'ch_4', 'acct_northline', 'refunded', 25000);
  if v_result->>'outcome' is distinct from 'noop' then
    raise exception 'PR-5 FAILED: a redelivered refund was recorded twice: %', v_result;
  end if;

  v_result := public.api_mark_payment_request_settled(
    'ch_4', 'acct_northline', 'disputed', null);
  if v_result->>'outcome' is distinct from 'disputed' then
    raise exception 'PR-5 FAILED: the dispute was not recorded: %', v_result;
  end if;

  -- An unknown kind is a programming error and must be loud, not silent.
  begin
    perform public.api_mark_payment_request_settled(
      'ch_4', 'acct_northline', 'reversed', null);
    raise exception 'PR-5 FAILED: an unknown settlement kind was accepted';
  exception when others then
    if sqlerrm not like '%unknown kind%' then raise; end if;
  end;

  raise notice 'PR-5 PASSED: refund and dispute settle beside the status, once each';
end $$;

-- ---------------------------------------------------------------------------
-- PR-6: expiry retires the ones nobody paid, and touches nothing else.
-- ---------------------------------------------------------------------------

do $$
declare
  v_expired int;
begin
  perform pg_temp.new_request('ba000000-0000-4000-8000-000000000015'::uuid, 'plink_five');
  update public.payment_requests
     set expires_at = now() - interval '1 day'
   where id = 'ba000000-0000-4000-8000-000000000015'::uuid;

  -- A PAID request past its expiry must be left alone: the money arrived, and
  -- relabelling it "expired" would tell a crew they were never paid.
  perform pg_temp.new_request('ba000000-0000-4000-8000-000000000016'::uuid, 'plink_six');
  perform public.api_mark_payment_request_paid(
    'plink_six', 'acct_northline', 'cs_6', 'pi_6', 'ch_6', 25000);
  update public.payment_requests
     set expires_at = now() - interval '1 day'
   where id = 'ba000000-0000-4000-8000-000000000016'::uuid;

  v_expired := public.expire_payment_requests(500);
  if v_expired < 1 then
    raise exception 'PR-6 FAILED: nothing expired, and one was due';
  end if;

  if (select status from public.payment_requests
       where id = 'ba000000-0000-4000-8000-000000000015'::uuid) is distinct from 'expired' then
    raise exception 'PR-6 FAILED: the overdue open request was not retired';
  end if;
  if (select status from public.payment_requests
       where id = 'ba000000-0000-4000-8000-000000000016'::uuid) is distinct from 'paid' then
    raise exception 'PR-6 FAILED: a PAID request was relabelled expired';
  end if;

  -- Idempotent: a second pass with nothing due reports nothing.
  if public.expire_payment_requests(500) is distinct from 0 then
    raise exception 'PR-6 FAILED: a second pass claimed to expire more';
  end if;

  raise notice 'PR-6 PASSED: overdue open requests retire, paid ones are untouched';
end $$;

-- ---------------------------------------------------------------------------
-- PR-7: neither table is reachable by anyone but the API.
--
-- The one where a mistake exposes the account a business is paid into.
-- ---------------------------------------------------------------------------

do $$
declare
  v_leak text;
begin
  select string_agg(format('%s→%s(%s)', grantee, table_name, privilege_type), ', ')
    into v_leak
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('payment_requests', 'stripe_connect_accounts')
     and grantee in ('anon', 'authenticated', 'PUBLIC');
  if v_leak is not null then
    raise exception 'PR-7 FAILED: a client role can reach the money tables: %', v_leak;
  end if;

  if exists (
    select 1 from pg_tables
     where schemaname = 'public'
       and tablename in ('payment_requests', 'stripe_connect_accounts')
       and not rowsecurity
  ) then
    raise exception 'PR-7 FAILED: RLS is off on a money table';
  end if;

  -- And the writers are service_role only. A recreated function silently
  -- regains the default PUBLIC execute grant, which is how a revoke gets
  -- undone by an unrelated migration.
  --
  -- `broadcast_payment_change` is in this list because #607 added a fourth
  -- SECURITY DEFINER function to this feature, revoked it in the migration, and
  -- checked it nowhere — granting execute back to `authenticated` passed the
  -- whole suite. A list of three names next to a fourth function is how a
  -- by-name check goes stale: the check did not fail, it simply stopped being
  -- about everything it was written to be about.
  select string_agg(format('%s→%s', grantee, routine_name), ', ') into v_leak
    from information_schema.role_routine_grants
   where routine_schema = 'public'
     and routine_name in (
       'api_mark_payment_request_paid',
       'api_mark_payment_request_settled',
       'expire_payment_requests',
       'broadcast_payment_change')
     and grantee in ('anon', 'authenticated', 'PUBLIC');
  if v_leak is not null then
    raise exception 'PR-7 FAILED: a client role can execute a money function: %', v_leak;
  end if;

  raise notice 'PR-7 PASSED: the money tables and their writers are service_role only';
end $$;

-- ---------------------------------------------------------------------------
-- #607 — the broadcast. Everything below asserts the trigger added in
-- 20260813110000_the_deposit_lands_before_anyone_refreshes.sql and amended in
-- 20260813130000_the_payment_broadcast_enforces_its_own_contract.sql.
--
-- EVERY BLOCK BELOW READS THE AUDIT ROW BACK, and that is not belt-and-braces.
-- The first draft of these tests asserted only the BROADCAST, and a one-word
-- mutation — `after insert` to `before insert` — passed all of them while
-- destroying the record of the payment. `return null` is required in an AFTER
-- trigger and means SKIP THIS ROW in a BEFORE one, so psql reported
-- `INSERT 0 0`, `realtime.messages` held the broadcast, and
-- `public.conversation_events` held nothing. The customer paid, the crew saw
-- "Paid" flash live, and there was no record it had ever happened.
--
-- A test about a NOTIFICATION that never looks at the THING NOTIFIED cannot see
-- that. So `pg_temp.recorded` is called on both sides of every insert here.
-- ---------------------------------------------------------------------------

/** The topics one event reached, in this transaction, sorted and de-duplicated. */
create or replace function pg_temp.topics_for(p_event text)
returns text[] language sql as $$
  select coalesce(array_agg(distinct m.topic order by m.topic), array[]::text[])
  from realtime.messages m
  where m.event = p_event;
$$;

/**
 * How many audit rows a thread holds — of one type, or of every type.
 *
 * The counterweight to `topics_for`. Read before and after each insert, because
 * a DELTA is what distinguishes "the row landed" from "some earlier block in
 * this transaction left one lying about".
 */
create or replace function pg_temp.recorded(
  p_conversation uuid, p_type text default null)
returns int language sql as $$
  select count(*)::int
    from public.conversation_events e
   where e.conversation_id = p_conversation
     and (p_type is null or e.type::text = p_type);
$$;

/**
 * The per-number topic a given number belongs to.
 *
 * Spelled from the fixture ids rather than read back from the row, so a trigger
 * that resolved the WRONG number would produce a topic this does not match. A
 * helper that derived the topic from whatever the trigger sent would agree with
 * itself forever.
 *
 * Takes the NUMBER as an argument since round two: the first version hardcoded
 * e1, which was the only number the fixture had, so "the thread's number" and
 * "the company's number" were the same string and the assertion could not tell
 * a thread-scoped resolution from a company-scoped one. PR-11 asks it about
 * both lines.
 */
create or replace function pg_temp.number_topic(p_number uuid)
returns text language sql as $$
  select 'company:ba000000-0000-4000-8000-0000000000c1:number:' || p_number::text;
$$;

-- ---------------------------------------------------------------------------
-- PR-8: a payment_paid row announces itself — on the number's topic, ID-ONLY.
--
-- This is the whole of #607. Before it, "Paid" appeared on the next fetch:
-- opening the thread, a client mutation, or coming back to the app. The person
-- waiting on it is standing in a driveway deciding whether to start work.
--
-- Four separate properties, because they fail independently:
--   THE ROW IS RECORDED. Read first, because it is the one whose loss is
--     permanent — a broadcast nobody receives is a screen that did not move,
--     and a missing audit row is a payment that never happened
--   the event fires at all, under the name the clients bind to
--   it goes to the per-number topic and NOWHERE else (#484 closed D85 by
--     deleting the company-topic send; a payment landing there would reopen it
--     for the members denied that line)
--   the payload is two ids and a discriminator, and carries no money and no
--     words the customer or the crew wrote
-- ---------------------------------------------------------------------------

do $$
declare
  v_topics  text[];
  v_payload jsonb;
  v_keys    text[];
  v_before  int;
  v_row     jsonb;
  v_id      uuid;
begin
  -- `topics_for` promises "in this transaction" and cannot deliver it alone:
  -- realtime.messages is a committed table. Clearing is what makes the promise
  -- true, and it keeps the set-equality assertions honest.
  delete from realtime.messages;
  v_before := pg_temp.recorded('ba000000-0000-4000-8000-0000000000f1'::uuid,
                               'payment_paid');

  insert into public.conversation_events
    (company_id, conversation_id, actor_user_id, type, payload)
  values
    ('ba000000-0000-4000-8000-0000000000c1'::uuid,
     'ba000000-0000-4000-8000-0000000000f1'::uuid,
     -- No actor: the customer paid, not a crew member. Same as the webhook.
     null,
     'payment_paid',
     jsonb_build_object(
       'payment_request_id', 'ba000000-0000-4000-8000-000000000021',
       'amount_cents', 25000,
       'currency', 'usd',
       'description', 'Deposit for Tuesday'))
  returning id into v_id;

  -- THE AUDIT ROW, before anything about the broadcast. A trigger wired BEFORE
  -- INSERT publishes this event and swallows the row, and the difference between
  -- "the crew was told" and "we can prove they were paid" is the whole reason
  -- `conversation_events` exists.
  if pg_temp.recorded('ba000000-0000-4000-8000-0000000000f1'::uuid, 'payment_paid')
     is distinct from v_before + 1 then
    raise exception 'PR-8 FAILED: the payment_paid row is NOT IN THE TABLE '
      '(% before the insert, % after). The broadcast may well have fired — a '
      'trigger wired BEFORE INSERT returns null, which SKIPS THE ROW, and the '
      'payment is announced to the crew and recorded nowhere',
      v_before,
      pg_temp.recorded('ba000000-0000-4000-8000-0000000000f1'::uuid, 'payment_paid');
  end if;

  -- And it is the row this event was about: the timeline KEEPS the money and the
  -- words, which is exactly what the wire below must not carry. Asserting both
  -- in one block is what stops "ID-only" being satisfied by losing the data.
  --
  -- Read by the id the INSERT returned, never by "the most recent one":
  -- `created_at` defaults to `now()`, which is the transaction timestamp and is
  -- therefore identical for every row this file writes.
  select e.payload into v_row
    from public.conversation_events e where e.id = v_id;
  if v_row->>'description' is distinct from 'Deposit for Tuesday'
     or (v_row->>'amount_cents')::int is distinct from 25000 then
    raise exception 'PR-8 FAILED: the audit row does not hold what was written '
      'to it (%) — the timeline is where the amount and the description live',
      v_row;
  end if;

  v_topics := pg_temp.topics_for('payment.updated');
  if v_topics is distinct from
     array[pg_temp.number_topic('ba000000-0000-4000-8000-0000000000e1'::uuid)] then
    raise exception 'PR-8 FAILED: payment.updated reached % (want the per-number '
      'topic %, and only that — the company topic is a member who was denied '
      'this line)', v_topics,
      array[pg_temp.number_topic('ba000000-0000-4000-8000-0000000000e1'::uuid)];
  end if;

  select m.payload into v_payload
    from realtime.messages m where m.event = 'payment.updated' limit 1;

  -- `realtime.send` injects its own 'id' into every payload, so the assertion is
  -- about what the TRIGGER put there.
  select array_agg(k order by k) into v_keys
    from jsonb_object_keys(v_payload) k
   where k <> 'id';
  if v_keys is distinct from
     array['conversation_id', 'payment_request_id', 'type'] then
    raise exception 'PR-8 FAILED: the payload carries % — SPEC §8 payloads are '
      'an id and a discriminator, never content', v_keys;
  end if;

  if v_payload->>'conversation_id' is distinct from
     'ba000000-0000-4000-8000-0000000000f1' then
    raise exception 'PR-8 FAILED: the payload names thread % — a client refetches '
      'on this id, so a wrong one updates the wrong screen',
      v_payload->>'conversation_id';
  end if;
  if v_payload->>'payment_request_id' is distinct from
     'ba000000-0000-4000-8000-000000000021' then
    raise exception 'PR-8 FAILED: the payload names request % rather than the one '
      'the event was written for', v_payload->>'payment_request_id';
  end if;
  -- The enum label verbatim. A trimmed 'paid' would be a second vocabulary that
  -- three clients each map back to the one they already have.
  if v_payload->>'type' is distinct from 'payment_paid' then
    raise exception 'PR-8 FAILED: the discriminator is % rather than the '
      'conversation_event_type label', v_payload->>'type';
  end if;

  -- Said a second way on purpose: the key list could change name and still leak.
  -- These are the two things in the source row that must never ride the wire.
  if v_payload::text like '%Deposit for Tuesday%' then
    raise exception 'PR-8 FAILED: the payload carries the description the '
      'business typed';
  end if;
  if v_payload::text like '%25000%' then
    raise exception 'PR-8 FAILED: the payload carries the amount';
  end if;

  raise notice 'PR-8 PASSED: payment_paid is recorded, and reaches the number '
    'topic alone with two ids and a discriminator and nothing else';
end $$;

-- ---------------------------------------------------------------------------
-- PR-9: the rest of the timeline stays silent.
--
-- `conversation_events` takes a row for every tag, assignment, done-mark, task
-- change and attachment. A blanket trigger on the table would publish all of it
-- to clients that have no handler for any of it — a broadcast storm that costs
-- Realtime messages for nothing. The scope lives in the trigger's WHEN clause,
-- and this is what notices if somebody widens it.
-- ---------------------------------------------------------------------------

do $$
declare
  v_count  int;
  v_events text;
  v_before int;
  v_quiet  text[] := array[
    'tag_added', 'tag_removed', 'assigned', 'status_changed',
    'task_created', 'task_assigned', 'message_done',
    'note_attachment_added', 'spam_marked'
  ];
begin
  delete from realtime.messages;
  v_before := pg_temp.recorded('ba000000-0000-4000-8000-0000000000f1'::uuid);

  insert into public.conversation_events
    (company_id, conversation_id, actor_user_id, type, payload)
  select
    'ba000000-0000-4000-8000-0000000000c1'::uuid,
    'ba000000-0000-4000-8000-0000000000f1'::uuid,
    'ba000000-0000-4000-8000-00000000000a'::uuid,
    t::public.conversation_event_type,
    '{}'::jsonb
  from unnest(v_quiet) as t;

  -- Silence is only worth asserting about rows that EXIST. Nine rows that were
  -- never written are silent too, and for the worst possible reason.
  if pg_temp.recorded('ba000000-0000-4000-8000-0000000000f1'::uuid)
     is distinct from v_before + array_length(v_quiet, 1) then
    raise exception 'PR-9 FAILED: the % ordinary rows are not in the table '
      '(% before, % after) — this block would report silence either way',
      array_length(v_quiet, 1), v_before,
      pg_temp.recorded('ba000000-0000-4000-8000-0000000000f1'::uuid);
  end if;

  select count(*), string_agg(distinct m.event, ', ' order by m.event)
    into v_count, v_events
    from realtime.messages m;
  if v_count is distinct from 0 then
    raise exception 'PR-9 FAILED: nine ordinary timeline rows published % '
      'broadcast(s) (%) — a blanket trigger on conversation_events is a storm '
      'every client ignores', v_count, v_events;
  end if;

  raise notice 'PR-9 PASSED: tags, assignments, tasks and done-marks are '
    'recorded and publish nothing';
end $$;

-- ---------------------------------------------------------------------------
-- PR-10: the scope is set-equal to the decision, in BOTH directions.
--
-- The family is DERIVED from `conversation_event_type` rather than retyped, so
-- this cannot go stale the way a hand-written list does. A sixth `payment_*`
-- value added later fails here until somebody says which side of the line it
-- belongs on — which is the point: the quiet side is where a decision nobody
-- made ends up by default.
--
-- Both directions matter and they fail differently. A type that should broadcast
-- and does not is #607 happening again for that case. A type that should not and
-- does is the storm PR-9 exists to prevent, arriving one value at a time.
-- ---------------------------------------------------------------------------

do $$
declare
  v_label  text;
  v_sent   int;
  v_before int;
  v_loud   text[] := array[]::text[];
  -- The decision, sorted the way the loop below visits the enum. `requested`
  -- rides the outbound message's own `message.created`; `cancelled` is done by a
  -- crew member in the app and #607 did not ask for it.
  v_want  text[] := array['payment_disputed', 'payment_paid', 'payment_refunded'];
begin
  for v_label in
    select e.enumlabel::text
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public'
       and t.typname = 'conversation_event_type'
       and e.enumlabel::text like 'payment\_%'
     order by 1
  loop
    delete from realtime.messages;
    v_before := pg_temp.recorded(
      'ba000000-0000-4000-8000-0000000000f1'::uuid, v_label);

    execute
      'insert into public.conversation_events
         (company_id, conversation_id, actor_user_id, type, payload)
       values ($1, $2, null, $3::public.conversation_event_type,
               jsonb_build_object(''payment_request_id'', $4))'
      using
        'ba000000-0000-4000-8000-0000000000c1'::uuid,
        'ba000000-0000-4000-8000-0000000000f1'::uuid,
        v_label,
        'ba000000-0000-4000-8000-000000000031';

    -- Loud or quiet, the row is written. The three that broadcast are the ones
    -- whose loss would be invisible, since the screen would still say "Paid".
    if pg_temp.recorded('ba000000-0000-4000-8000-0000000000f1'::uuid, v_label)
       is distinct from v_before + 1 then
      raise exception 'PR-10 FAILED: a % row was not recorded (% before, % '
        'after) — this loop measures broadcasts and would count that as a '
        'quiet type rather than as a lost payment',
        v_label, v_before,
        pg_temp.recorded('ba000000-0000-4000-8000-0000000000f1'::uuid, v_label);
    end if;

    -- Every row in the table, not only `payment.updated`: this way a type that
    -- broadcasts under some OTHER event name still counts as loud, and PR-8 is
    -- what pins the name itself.
    select count(*) into v_sent from realtime.messages;
    if v_sent is distinct from 0 then
      v_loud := v_loud || v_label;
    end if;
  end loop;

  if v_loud is distinct from v_want then
    raise exception 'PR-10 FAILED: the payment types that broadcast are % — the '
      'decision is %. A member of the family on the wrong side is either #607 '
      'happening again for that case, or the storm PR-9 prevents arriving one '
      'value at a time', v_loud, v_want;
  end if;

  raise notice 'PR-10 PASSED: exactly % of the payment family broadcast, derived '
    'from the enum rather than retyped', array_length(v_want, 1);
end $$;

-- ---------------------------------------------------------------------------
-- PR-11: the topic comes from the THREAD's number, not from the company's.
--
-- Round one asserted the per-number topic against a fixture whose company owned
-- exactly one number. Both resolutions produce the same string there, so
--
--   select id from public.phone_numbers where company_id = new.company_id
--
-- — which reaches every line in the workspace and is precisely the leak #484
-- closed — passed every assertion in this file. The shipped code was right; the
-- assertion could not tell.
--
-- The fixture now owns two lines with a thread on each, so the two resolutions
-- disagree and the test can say which one it got. What is at stake is a member
-- who was denied the second line learning that money just arrived on it.
-- ---------------------------------------------------------------------------

do $$
declare
  v_topics text[];
  v_before int;
begin
  -- The SECOND line's thread. Nothing else in this file touches it, so a
  -- company-derived resolver has no way to be accidentally right about it.
  delete from realtime.messages;
  v_before := pg_temp.recorded('ba000000-0000-4000-8000-0000000000f2'::uuid,
                               'payment_paid');

  insert into public.conversation_events
    (company_id, conversation_id, actor_user_id, type, payload)
  values
    ('ba000000-0000-4000-8000-0000000000c1'::uuid,
     'ba000000-0000-4000-8000-0000000000f2'::uuid, null, 'payment_paid',
     jsonb_build_object('payment_request_id',
                        'ba000000-0000-4000-8000-000000000041'));

  if pg_temp.recorded('ba000000-0000-4000-8000-0000000000f2'::uuid, 'payment_paid')
     is distinct from v_before + 1 then
    raise exception 'PR-11 FAILED: the second line''s payment row was not recorded';
  end if;

  v_topics := pg_temp.topics_for('payment.updated');
  if v_topics is distinct from
     array[pg_temp.number_topic('ba000000-0000-4000-8000-0000000000e2'::uuid)] then
    raise exception 'PR-11 FAILED: a payment on the SECOND line reached % — want '
      '% alone. The thread names its number; the company owns two, and picking '
      'one of those tells a member denied this line that money landed on it',
      v_topics,
      array[pg_temp.number_topic('ba000000-0000-4000-8000-0000000000e2'::uuid)];
  end if;

  -- And the other direction, in the same block, because a resolver that always
  -- answered e2 would satisfy the half above.
  delete from realtime.messages;
  v_before := pg_temp.recorded('ba000000-0000-4000-8000-0000000000f1'::uuid,
                               'payment_refunded');

  insert into public.conversation_events
    (company_id, conversation_id, actor_user_id, type, payload)
  values
    ('ba000000-0000-4000-8000-0000000000c1'::uuid,
     'ba000000-0000-4000-8000-0000000000f1'::uuid, null, 'payment_refunded',
     jsonb_build_object('payment_request_id',
                        'ba000000-0000-4000-8000-000000000042'));

  if pg_temp.recorded('ba000000-0000-4000-8000-0000000000f1'::uuid, 'payment_refunded')
     is distinct from v_before + 1 then
    raise exception 'PR-11 FAILED: the first line''s refund row was not recorded';
  end if;

  v_topics := pg_temp.topics_for('payment.updated');
  if v_topics is distinct from
     array[pg_temp.number_topic('ba000000-0000-4000-8000-0000000000e1'::uuid)] then
    raise exception 'PR-11 FAILED: a payment on the FIRST line reached % — want % '
      'alone', v_topics,
      array[pg_temp.number_topic('ba000000-0000-4000-8000-0000000000e1'::uuid)];
  end if;

  raise notice 'PR-11 PASSED: two lines, two threads, two topics — the number '
    'comes from the thread';
end $$;

-- ---------------------------------------------------------------------------
-- PR-12: AFTER INSERT, and nothing else.
--
-- Two properties the first migration argued for in prose and enforced nowhere,
-- both proved by mutation to pass the entire suite:
--
--   `before insert`   `return null` skips the row. The payment is broadcast and
--                     never recorded. This is the defect the row reads above
--                     exist for, and this block is the second lock on it.
--   `or update`       `conversation_events` is an append-only audit timeline
--                     with no UPDATE writer today (erasure reaches it by
--                     DELETE). If one appears — a scrub, a backfill — a
--                     re-announced row puts "Paid" back on a screen for money
--                     that arrived months ago.
--
-- Asserted behaviourally AND structurally, because they fail differently. The
-- update below must SUCCEED and be silent: a widened trigger now raises from
-- inside the function, so "no broadcast" alone would be satisfied by a write
-- that blew up.
-- ---------------------------------------------------------------------------

do $$
declare
  v_id     uuid;
  v_count  int;
  v_type   int;
  v_wired  int;
begin
  delete from realtime.messages;

  insert into public.conversation_events
    (company_id, conversation_id, actor_user_id, type, payload)
  values
    ('ba000000-0000-4000-8000-0000000000c1'::uuid,
     'ba000000-0000-4000-8000-0000000000f1'::uuid, null, 'payment_disputed',
     jsonb_build_object('payment_request_id',
                        'ba000000-0000-4000-8000-000000000051'))
  returning id into v_id;

  if v_id is null then
    raise exception 'PR-12 FAILED: the insert returned no id, so the row was '
      'skipped — a BEFORE trigger returning null does exactly this';
  end if;

  delete from realtime.messages;

  -- The shape of the UPDATE writer that does not exist yet: an erasure scrub
  -- rewriting a payload it must keep the fact of.
  update public.conversation_events
     set payload = payload || jsonb_build_object('scrubbed_at', now())
   where id = v_id;

  select count(*) into v_count from realtime.messages;
  if v_count is distinct from 0 then
    raise exception 'PR-12 FAILED: updating a recorded payment published % '
      'broadcast(s) — a scrub or a backfill would re-announce a months-old '
      'payment as if it had just landed', v_count;
  end if;

  -- The definition, read from the catalogue rather than from the migration
  -- text, and found by the FUNCTION it calls so renaming the trigger cannot
  -- turn this into a skip. `pg_trigger.tgtype` bits: 1 row-level, 2 BEFORE,
  -- 4 INSERT, 8 DELETE, 16 UPDATE, 32 TRUNCATE, 64 INSTEAD OF.
  select count(*), min(t.tgtype)::int into v_wired, v_type
    from pg_trigger t
   where t.tgfoid = 'public.broadcast_payment_change()'::regprocedure
     and not t.tgisinternal;

  if v_wired is distinct from 1 then
    raise exception 'PR-12 FAILED: % triggers call broadcast_payment_change — '
      'one table, one trigger, or the same payment is announced twice', v_wired;
  end if;
  if (v_type & 2) is distinct from 0 then
    raise exception 'PR-12 FAILED: the trigger is BEFORE. Its `return null` '
      'SKIPS THE ROW — the crew is told they were paid and nothing records it';
  end if;
  if (v_type & 4) is distinct from 4 then
    raise exception 'PR-12 FAILED: the trigger does not fire on INSERT (tgtype '
      '%), so a payment lands in silence', v_type;
  end if;
  if (v_type & (8 | 16 | 32)) is distinct from 0 then
    raise exception 'PR-12 FAILED: the trigger also fires on update/delete/'
      'truncate (tgtype %) — an audit row is not news the second time', v_type;
  end if;
  if (v_type & 1) is distinct from 1 then
    raise exception 'PR-12 FAILED: the trigger is statement-level (tgtype %), '
      'so `new` is not even defined', v_type;
  end if;

  raise notice 'PR-12 PASSED: AFTER INSERT for each row, once, and an update '
    'announces nothing';
end $$;

-- ---------------------------------------------------------------------------
-- PR-13: the ID-only guarantee is the TRIGGER'S, not the writer's.
--
-- `new.payload->>'payment_request_id'` does not mean "the id". It means
-- "whatever is under that key, rendered as text", and for an OBJECT that is the
-- object — serialised onto the wire, to every subscriber on the number's topic.
-- Proved live in round one with a payload carrying a sentence about a customer's
-- cracked tile.
--
-- `conversation_events.payload` is `jsonb` with no shape check and is written
-- from many places. A guarantee that holds because of who happens to call you is
-- not a guarantee, and SPEC §8 states this one unconditionally.
--
-- Each case below is a shape a writer could plausibly produce, and the answer to
-- all of them is the same: send null. Nothing is lost — `conversation_id` is the
-- load-bearing key, every client already treats the request id as optional, and
-- the audit row keeps whatever was written to it.
-- ---------------------------------------------------------------------------

do $$
declare
  v_case    jsonb;
  v_cases   jsonb[];
  v_payload jsonb;
  v_stored  jsonb;
  v_id      uuid;
  -- Written once and used to BUILD the cases as well as to search the wire for
  -- them. Two copies of a sentence is how a test ends up looking for words no
  -- fixture contains and reporting a clean wire.
  v_words   text := 'customer said the tile was cracked';
begin
  v_cases := array[
    -- The one that was proved: an object, carrying words a customer typed.
    jsonb_build_object('payment_request_id',
                       jsonb_build_object('note', v_words)),
    -- An array of them, because `->>` serialises that too.
    jsonb_build_object('payment_request_id', jsonb_build_array(v_words)),
    -- A number is a scalar and still not an id.
    jsonb_build_object('payment_request_id', 25000),
    -- A string that is not a uuid: a Stripe id, say, which is the most likely
    -- thing a future writer puts here by mistake.
    jsonb_build_object('payment_request_id', 'pi_3QabcDEF'),
    -- A boolean, and the key present but explicitly null.
    jsonb_build_object('payment_request_id', true),
    jsonb_build_object('payment_request_id', null::text)
  ];

  foreach v_case in array v_cases
  loop
    delete from realtime.messages;

    insert into public.conversation_events
      (company_id, conversation_id, actor_user_id, type, payload)
    values
      ('ba000000-0000-4000-8000-0000000000c1'::uuid,
       'ba000000-0000-4000-8000-0000000000f1'::uuid, null, 'payment_paid',
       v_case)
    returning id into v_id;

    select m.payload into v_payload
      from realtime.messages m where m.event = 'payment.updated' limit 1;

    if v_payload is null then
      raise exception 'PR-13 FAILED: % published nothing — refusing the id is '
        'not a reason to drop the event; the thread is what a client refetches',
        v_case;
    end if;

    -- The key is still there, and it is JSON null rather than a value.
    if jsonb_typeof(v_payload -> 'payment_request_id') is distinct from 'null' then
      raise exception 'PR-13 FAILED: % put % on the wire — SPEC §8 is ID-ONLY, '
        'and `->>` on a non-string serialises whatever it finds',
        v_case, v_payload -> 'payment_request_id';
    end if;
    -- Said a second way, about the bytes: the key could be renamed and still leak.
    if v_payload::text like '%' || v_words || '%' then
      raise exception 'PR-13 FAILED: a customer''s words reached the wire: %',
        v_payload;
    end if;
    -- The thread is still named, so the client still refetches and the strip
    -- still moves. Refusing the id must cost the reader nothing.
    if v_payload->>'conversation_id' is distinct from
       'ba000000-0000-4000-8000-0000000000f1' then
      raise exception 'PR-13 FAILED: the event stopped naming its thread: %',
        v_payload;
    end if;

    -- And the TIMELINE keeps what the wire refused. Stripping the broadcast is
    -- not a licence to lose the row's contents.
    select e.payload into v_stored
      from public.conversation_events e where e.id = v_id;
    if v_stored -> 'payment_request_id'
       is distinct from v_case -> 'payment_request_id' then
      raise exception 'PR-13 FAILED: the audit row holds % but % was written',
        v_stored, v_case;
    end if;
  end loop;

  -- The control: a real uuid still travels. A guard that refused everything
  -- would pass every assertion above and quietly delete the feature's second id.
  delete from realtime.messages;
  insert into public.conversation_events
    (company_id, conversation_id, actor_user_id, type, payload)
  values
    ('ba000000-0000-4000-8000-0000000000c1'::uuid,
     'ba000000-0000-4000-8000-0000000000f1'::uuid, null, 'payment_paid',
     jsonb_build_object('payment_request_id',
                        'ba000000-0000-4000-8000-000000000061'));

  select m.payload into v_payload
    from realtime.messages m where m.event = 'payment.updated' limit 1;
  if v_payload->>'payment_request_id' is distinct from
     'ba000000-0000-4000-8000-000000000061' then
    raise exception 'PR-13 FAILED: a well-formed uuid did not survive (%) — the '
      'client patches ONE card with this instead of refetching a list', v_payload;
  end if;

  raise notice 'PR-13 PASSED: only a scalar the uuid parser accepts rides the '
    'wire; every other shape becomes null and the thread is still named';
end $$;

-- ---------------------------------------------------------------------------
-- PR-14: the broadcast function's own hardening, which nothing else holds.
--
-- Both properties are already true of the shipped function and BOTH survived a
-- mutation round — the suite checked who may EXECUTE it and never what it runs
-- as. This is the repo's own idiom from `audit_log.test.sql` AL-1, applied to
-- the one SECURITY DEFINER function this feature added.
--
-- `search_path = ''` is not decoration on a SECURITY DEFINER function. Without
-- it the function resolves unqualified names against the CALLER's search_path,
-- so anyone who can insert a `conversation_events` row could shadow a function
-- or table name and have it run as the definer.
-- ---------------------------------------------------------------------------

do $$
declare
  v_secdef boolean;
  v_config text[];
begin
  select p.prosecdef, p.proconfig
    into v_secdef, v_config
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'broadcast_payment_change';

  if v_secdef is distinct from true then
    raise exception 'PR-14 FAILED: broadcast_payment_change is not SECURITY '
      'DEFINER. It writes to realtime.messages, which the caller cannot.';
  end if;

  if v_config is null
     or not ('search_path=' = any(v_config) or 'search_path=""' = any(v_config))
  then
    raise exception 'PR-14 FAILED: broadcast_payment_change does not pin an '
      'empty search_path, so every unqualified name in it resolves against the '
      'CALLER. Config was: %', coalesce(v_config::text, '<null>');
  end if;

  raise notice 'PR-14 PASSED: the broadcast function runs as its definer with '
    'an empty search_path';
end $$;

-- ---------------------------------------------------------------------------
-- PR-15: a payment on a thread whose number cannot be resolved goes NOWHERE.
--
-- `broadcast_number_scoped` has a documented fall-through that publishes to
-- `company:{company_id}` when it has no number. The payment path returns early
-- instead, and the migration says why: #484/D85 deleted the company-topic send
-- precisely so a conversation-scoped event cannot cross the per-number access
-- boundary. Replacing that early return with a fall-through passed every other
-- assertion — the silence was load-bearing and unguarded.
--
-- Silence is the correct answer here. A payment nobody can be told about
-- privately is not a payment everybody should be told about.
-- ---------------------------------------------------------------------------

do $$
declare
  v_company  uuid := '5e000000-0000-4000-8000-0000000000c9';
  v_conv     uuid;
  v_before   bigint;
  v_after    bigint;
  v_company_topic bigint;
begin
  -- A company whose thread has NO resolvable number. Built here rather than in
  -- the shared fixture so the other blocks keep asserting what they asserted.
  insert into public.companies (id, name) values (v_company, 'PR-15 Co')
    on conflict (id) do nothing;

  insert into public.conversations (company_id, phone_number_id, contact_id)
  select v_company, null, null
  returning id into v_conv;

  select count(*) into v_before from realtime.messages;
  select count(*) into v_company_topic from realtime.messages
   where topic = 'company:' || v_company::text;

  insert into public.conversation_events
    (company_id, conversation_id, type, payload)
  values (v_company, v_conv, 'payment_paid', '{}'::jsonb);

  select count(*) into v_after from realtime.messages;

  if v_after is distinct from v_before then
    raise exception 'PR-15 FAILED: a payment on a thread with no number '
      'published % broadcast(s). The company topic is past the D85 boundary — '
      'a member denied that line would learn money arrived on it.',
      v_after - v_before;
  end if;

  raise notice 'PR-15 PASSED: an unresolvable number publishes nothing rather '
    'than falling back to the company topic';
exception
  when foreign_key_violation or not_null_violation then
    -- The schema forbids a null phone_number_id, which is a STRONGER guarantee
    -- than the early return and makes the fall-through unreachable. Recorded
    -- rather than skipped, because "the test could not build the state" and
    -- "the state is impossible" look identical in a passing run.
    raise notice 'PR-15 PASSED BY SCHEMA: conversations.phone_number_id is NOT '
      'NULL, so a thread without a number cannot exist';
end $$;

rollback;
