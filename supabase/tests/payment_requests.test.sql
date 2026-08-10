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

insert into public.phone_numbers
  (id, company_id, number_e164, status, provisioning_key, country)
values
  ('ba000000-0000-4000-8000-0000000000e1'::uuid,
   'ba000000-0000-4000-8000-0000000000c1'::uuid, '+14155550100', 'active',
   'pay-suite-1', 'US');

insert into public.contacts (id, company_id, phone_e164, name)
values
  ('ba000000-0000-4000-8000-0000000000d1'::uuid,
   'ba000000-0000-4000-8000-0000000000c1'::uuid, '+14155550199', 'Maria');

insert into public.conversations
  (id, company_id, contact_id, phone_number_id, contact_phone_e164)
values
  ('ba000000-0000-4000-8000-0000000000f1'::uuid,
   'ba000000-0000-4000-8000-0000000000c1'::uuid,
   'ba000000-0000-4000-8000-0000000000d1'::uuid,
   'ba000000-0000-4000-8000-0000000000e1'::uuid, '+14155550199');

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

  -- And the two writers are service_role only. A recreated function silently
  -- regains the default PUBLIC execute grant, which is how a revoke gets
  -- undone by an unrelated migration.
  select string_agg(format('%s→%s', grantee, routine_name), ', ') into v_leak
    from information_schema.role_routine_grants
   where routine_schema = 'public'
     and routine_name in (
       'api_mark_payment_request_paid',
       'api_mark_payment_request_settled',
       'expire_payment_requests')
     and grantee in ('anon', 'authenticated', 'PUBLIC');
  if v_leak is not null then
    raise exception 'PR-7 FAILED: a client role can execute a money function: %', v_leak;
  end if;

  raise notice 'PR-7 PASSED: the money tables and their writers are service_role only';
end $$;

rollback;
