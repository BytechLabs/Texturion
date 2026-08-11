-- #277 paid pause — the SQL half, and the one property it exists for.
--
-- A pause is a licensed-PRICE swap on the same Stripe subscription. The
-- subscription therefore stays genuinely `active`, which is the whole point
-- (the status mirror stays truthful, change-plan and reconcile keep working on
-- real data) and also the whole hazard: every SQL send gate in this schema was
-- written as `subscription_status <> 'active' or plan is null`, and every one of
-- those tests PASSES for a paused workspace.
--
-- So a pause implemented only in TypeScript is one forgotten `await` away from
-- being a 90%-off coupon for the full product — and the belt-and-braces SQL
-- gates, which exist precisely for the case where the TypeScript gate is
-- skipped, would be the ones handing it out.
--
-- P-13 is the assertion that makes the rest of them mean something: it restores
-- the pre-pause predicate inside this transaction and asserts the defect COMES
-- BACK, so every test above it is known to be capable of failing.
--
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/paid_pause.test.sql
-- Runs in one transaction and ROLLS BACK.

\set ON_ERROR_STOP on

begin;

-- ===========================================================================
-- Fixtures. Two workspaces, identical in every way a gate can see EXCEPT the
-- pause — so a gate that lets the paused one through cannot blame anything
-- else.
-- ===========================================================================
insert into auth.users (id, email, raw_user_meta_data)
values ('1a000000-0000-4000-8000-000000000901', 'owner@pause.test',
        '{"display_name":"Pause Owner"}'::jsonb);

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, plan, current_period_start, current_period_end,
   overage_cap_multiplier)
values
  ('2a000000-0000-4000-8000-000000000901', 'Paused Co',
   '1a000000-0000-4000-8000-000000000901', 'US', '613', now(),
   'active', 'starter', now() - interval '1 day', now() + interval '29 days', 3.00),
  ('2a000000-0000-4000-8000-000000000902', 'Working Co',
   '1a000000-0000-4000-8000-000000000901', 'US', '613', now(),
   'active', 'starter', now() - interval '1 day', now() + interval '29 days', 3.00);

insert into public.phone_numbers
  (id, company_id, status, provisioning_key, country, number_e164)
values
  ('3a000000-0000-4000-8000-000000000901', '2a000000-0000-4000-8000-000000000901',
   'active', 'cs_pause_test_1', 'US', '+16135550901'),
  ('3a000000-0000-4000-8000-000000000902', '2a000000-0000-4000-8000-000000000902',
   'active', 'cs_pause_test_2', 'US', '+16135550902');

-- Real threads, built the way the product builds them: an inbound text. A
-- hand-inserted conversation row could satisfy a gate that the real threading
-- path would not.
do $$
begin
  perform public.thread_inbound_message(
    '2a000000-0000-4000-8000-000000000901'::uuid,
    '3a000000-0000-4000-8000-000000000901'::uuid,
    '+16135551901', 'Are you around in the spring?', 'tx-pause-1');
end $$;

-- ===========================================================================
-- P-1. A pause is not the default state, and it is reversible in the schema.
--
-- A default of now() would mean every workspace in the table reads as paused,
-- which presents as a total outage rather than as a bug. NOT NULL would mean a
-- pause could be started and never lifted without another migration.
--
-- SCOPED TO THIS SUITE'S OWN FIXTURES, and that is not a detail. This asserted
-- `count(*) from public.companies where paused_at is not null = 0` across the
-- WHOLE table, as the FIRST assertion in a suite the runner fails fast on. So
-- the moment any workspace anywhere was legitimately paused - which is to say
-- the moment the feature was working - P-1 raised and P-2 through P-16 never
-- executed. Every one of the five SQL gate proofs, the break-proof that shows
-- the defect returns, and the resubscribe proofs would have gone quiet with no
-- failure naming them. A precondition about the whole world, in a suite about
-- one fixture, is a suite that disables itself exactly when it starts to
-- matter.
-- ===========================================================================
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.companies
   where paused_at is not null
     and id in ('2a000000-0000-4000-8000-000000000901',
                '2a000000-0000-4000-8000-000000000902',
                '2a000000-0000-4000-8000-000000000903');
  if v_count is distinct from 0 then
    raise exception 'P-1 FAILED: % of this suite''s workspace(s) read as paused '
      'with nothing having paused them', v_count;
  end if;

  update public.companies set paused_at = now(), paused_price_cents = 500
   where id = '2a000000-0000-4000-8000-000000000901';
  update public.companies set paused_at = null, paused_price_cents = null
   where id = '2a000000-0000-4000-8000-000000000901';
  raise notice 'P-1 PASSED: nothing is paused until something pauses it, and a pause can be lifted';
end $$;

-- ===========================================================================
-- P-2/P-3. company_send_block, and the exact reading the old inline test got
-- wrong.
--
-- P-3 asserts BOTH halves: that the helper says 'workspace_paused', and that
-- the predicate it replaced would have said nothing at all. Without the second
-- half this test would also pass against a fixture that was blocked for some
-- unrelated reason, which is the most common way a gate test lies.
-- ===========================================================================
do $$
declare
  v_company public.companies%rowtype;
  v_block   text;
  v_old     boolean;
begin
  select * into v_company from public.companies
   where id = '2a000000-0000-4000-8000-000000000901';

  v_block := public.company_send_block(v_company);
  if v_block is not null then
    raise exception 'P-2 FAILED: a healthy active workspace is blocked with %', v_block;
  end if;
  raise notice 'P-2 PASSED: a healthy workspace is not blocked';

  update public.companies set paused_at = now(), paused_price_cents = 500
   where id = '2a000000-0000-4000-8000-000000000901';
  select * into v_company from public.companies
   where id = '2a000000-0000-4000-8000-000000000901';

  -- The predicate every send gate in this schema used before the pause existed.
  v_old := v_company.subscription_status <> 'active' or v_company.plan is null;
  if v_old is distinct from false then
    raise exception 'P-3 FAILED: the paused fixture is not `active` with a plan, so '
      'the OLD gate would already have caught it and this suite proves nothing';
  end if;

  v_block := public.company_send_block(v_company);
  if v_block is distinct from 'workspace_paused' then
    raise exception 'P-3 FAILED: a paused workspace blocks with %, not workspace_paused',
      coalesce(v_block, 'nothing');
  end if;
  raise notice 'P-3 PASSED: a paused workspace is `active` with a plan and is still blocked';
end $$;

-- ===========================================================================
-- P-4. Cancellation outranks the pause.
--
-- A workspace that paused and then cancelled has both facts true at once. The
-- one that matters is the cancellation: an irreversible 30-day clock is running
-- on their number and 'subscription_inactive' is the answer that says so. It is
-- also what keeps the #481 off-ramp alive — that exemption is written against
-- the subscription gate, and a pause fact outranking it would silence the one
-- message a departing workspace is allowed to send.
-- ===========================================================================
do $$
declare
  v_company public.companies%rowtype;
  v_block   text;
begin
  update public.companies
     set subscription_status = 'canceled', canceled_at = now()
   where id = '2a000000-0000-4000-8000-000000000901';
  select * into v_company from public.companies
   where id = '2a000000-0000-4000-8000-000000000901';

  v_block := public.company_send_block(v_company);
  if v_block is distinct from 'subscription_inactive' then
    raise exception 'P-4 FAILED: a cancelled-while-paused workspace answers %, so the '
      'off-ramp exemption has nothing to attach to', coalesce(v_block, 'nothing');
  end if;

  update public.companies
     set subscription_status = 'active', canceled_at = null
   where id = '2a000000-0000-4000-8000-000000000901';
  raise notice 'P-4 PASSED: cancellation outranks the pause';
end $$;

-- ===========================================================================
-- P-5/P-6. gate_outbound_send — the manual send path.
--
-- The paused workspace is refused AND nothing is written. A gate that returned
-- the error after inserting the queued row would still show the customer an
-- error while leaving a message a dispatcher could later pick up.
-- ===========================================================================
do $$
declare
  v_conv  uuid;
  res     jsonb;
  v_count int;
begin
  select conv.id into v_conv from public.conversations conv
   where conv.company_id = '2a000000-0000-4000-8000-000000000901' limit 1;
  if v_conv is null then
    raise exception 'P-5 FAILED: fixture thread missing';
  end if;

  res := public.gate_outbound_send(
    '2a000000-0000-4000-8000-000000000901'::uuid, v_conv,
    '1a000000-0000-4000-8000-000000000901'::uuid,
    'Back in April!', 'idem-pause-1', 1);
  if res->>'error' is distinct from 'workspace_paused' then
    raise exception 'P-5 FAILED: gate_outbound_send answered % for a paused workspace',
      coalesce(res->>'error', 'success');
  end if;

  select count(*) into v_count from public.messages
   where company_id = '2a000000-0000-4000-8000-000000000901' and direction = 'outbound';
  if v_count is distinct from 0 then
    raise exception 'P-5 FAILED: % outbound row(s) were written by a refused send', v_count;
  end if;
  raise notice 'P-5 PASSED: a paused workspace cannot send, and nothing is queued';

  -- P-6: and the gate is not simply broken — lift the pause and it sends.
  update public.companies set paused_at = null, paused_price_cents = null
   where id = '2a000000-0000-4000-8000-000000000901';
  res := public.gate_outbound_send(
    '2a000000-0000-4000-8000-000000000901'::uuid, v_conv,
    '1a000000-0000-4000-8000-000000000901'::uuid,
    'Back in April!', 'idem-pause-2', 1);
  if res->'message' is null then
    raise exception 'P-6 FAILED: an unpaused workspace was refused with %',
      coalesce(res->>'error', 'nothing');
  end if;
  raise notice 'P-6 PASSED: lifting the pause restores sending';
end $$;

-- ===========================================================================
-- P-7. claim_auto_reply — the away message.
--
-- The gate that matters most, because it needs nobody to press anything.
-- Inbound keeps arriving during a pause, so an ungated away reply would answer
-- every one of them, on our carrier bill, in the voice of a business that is
-- shut for the winter.
-- ===========================================================================
do $$
declare
  v_conv   uuid;
  res      jsonb;
  v_before int;
begin
  select conv.id into v_conv from public.conversations conv
   where conv.company_id = '2a000000-0000-4000-8000-000000000901' limit 1;

  update public.companies set paused_at = now(), paused_price_cents = 500
   where id = '2a000000-0000-4000-8000-000000000901';

  select count(*) into v_before from public.messages
   where company_id = '2a000000-0000-4000-8000-000000000901' and direction = 'outbound';

  res := public.claim_auto_reply(
    '2a000000-0000-4000-8000-000000000901'::uuid, v_conv,
    'Thanks — we will get back to you.', 1, 3600);
  if res->>'skipped' is distinct from 'workspace_paused' then
    raise exception 'P-7 FAILED: claim_auto_reply answered % for a paused workspace',
      coalesce(res->>'skipped', 'a sent message');
  end if;

  if (select count(*) from public.messages
       where company_id = '2a000000-0000-4000-8000-000000000901'
         and direction = 'outbound') is distinct from v_before then
    raise exception 'P-7 FAILED: a refused auto-reply still wrote an outbound row';
  end if;
  raise notice 'P-7 PASSED: a paused workspace sends no away replies';
end $$;

-- ===========================================================================
-- P-8. claim_missed_call_text — and the side effects it must NOT have.
--
-- The pause gate sits before the threading in this function, so a refused
-- missed-call text creates no contact and no conversation HERE. The crew still
-- learns about the call: the calls pipeline threads a missed inbound call
-- through api_thread_call, which this gate does not touch. What a gate placed
-- after the threading would add is a second, redundant write path — reopening
-- conversations the crew closed, for a text that is never sent.
-- ===========================================================================
do $$
declare
  res     jsonb;
  v_count int;
begin
  res := public.claim_missed_call_text(
    '2a000000-0000-4000-8000-000000000901'::uuid,
    '3a000000-0000-4000-8000-000000000901'::uuid,
    '+16135551902', 'call-pause-1', 'Sorry we missed you.', 1, 3600);
  if res->>'skipped' is distinct from 'workspace_paused' then
    raise exception 'P-8 FAILED: claim_missed_call_text answered % for a paused workspace',
      coalesce(res->>'skipped', 'a sent message');
  end if;

  select count(*) into v_count from public.contacts
   where company_id = '2a000000-0000-4000-8000-000000000901'
     and phone_e164 = '+16135551902';
  if v_count is distinct from 0 then
    raise exception 'P-8 FAILED: a refused missed-call text still threaded the caller';
  end if;
  raise notice 'P-8 PASSED: a paused workspace texts nobody back, and threads nothing';
end $$;

-- ===========================================================================
-- P-9. claim_emergency_ack — refused, but the crew still SEES it.
--
-- The one refusal here that must not be silent. The emergency flag and its
-- conversation event are stamped BEFORE the send gate on purpose: somebody
-- still watching a paused workspace must be able to see that an emergency
-- arrived, even though we will not answer it on their behalf.
-- ===========================================================================
do $$
declare
  v_conv  uuid;
  res     jsonb;
  v_flag  timestamptz;
  v_count int;
begin
  select conv.id into v_conv from public.conversations conv
   where conv.company_id = '2a000000-0000-4000-8000-000000000901' limit 1;

  res := public.claim_emergency_ack(
    '2a000000-0000-4000-8000-000000000901'::uuid, v_conv,
    'We have your emergency.', 1, 3600, 5);
  if res->>'skipped' is distinct from 'workspace_paused' then
    raise exception 'P-9 FAILED: claim_emergency_ack answered % for a paused workspace',
      coalesce(res->>'skipped', 'a sent message');
  end if;

  select emergency_at into v_flag from public.conversations where id = v_conv;
  if v_flag is null then
    raise exception 'P-9 FAILED: the emergency was neither answered nor recorded, so a '
      'paused workspace cannot even see that one arrived';
  end if;

  select count(*) into v_count from public.conversation_events
   where conversation_id = v_conv and type = 'emergency_flagged';
  if v_count < 1 then
    raise exception 'P-9 FAILED: no emergency_flagged event was written';
  end if;
  raise notice 'P-9 PASSED: the emergency is recorded and visible, and not auto-answered';
end $$;

-- ===========================================================================
-- P-10. claim_message_retry — retrying a send IS a send.
--
-- Every failed message in a workspace's history stays retryable, so a pause
-- that blocked new sends but not retries would leak an unbounded number of
-- outbound messages from a workspace that is not paying for any.
-- ===========================================================================
do $$
declare
  v_conv uuid;
  v_msg  uuid;
  res    jsonb;
  v_row  public.messages%rowtype;
begin
  select conv.id into v_conv from public.conversations conv
   where conv.company_id = '2a000000-0000-4000-8000-000000000901' limit 1;

  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments,
     sent_by_user_id, error_code)
  values
    ('2a000000-0000-4000-8000-000000000901', v_conv, 'outbound',
     'Did not go out', 'failed', 1,
     '1a000000-0000-4000-8000-000000000901', 'carrier_error')
  returning id into v_msg;

  res := public.claim_message_retry(
    '2a000000-0000-4000-8000-000000000901'::uuid, v_msg, 900);
  if res->>'error' is distinct from 'workspace_paused' then
    raise exception 'P-10 FAILED: claim_message_retry answered % for a paused workspace',
      coalesce(res->>'error', 'a requeued message');
  end if;

  select * into v_row from public.messages where id = v_msg;
  if v_row.status is distinct from 'failed' then
    raise exception 'P-10 FAILED: the message was requeued as % by a refused retry',
      v_row.status;
  end if;
  raise notice 'P-10 PASSED: a paused workspace cannot retry its way back onto the carrier';
end $$;

-- ===========================================================================
-- P-11. The pause did not break the spending cap — the reason it is NOT a
-- third plan_id.
--
-- 20260701001100_messaging_functions.sql derives the quota with
-- `case plan when 'starter' then 500 when 'pro' then 2500 end` and NO ELSE. A
-- third plan value yields NULL, so v_cap is NULL, so `used > v_cap` is NULL, so
-- the overage spending cap NEVER FIRES — a cost-protection ceiling failing
-- OPEN, on exactly the cohort we had just told to stop watching their account.
--
-- The pause therefore leaves `plan` alone, and this asserts both halves: the
-- plan survives a pause, and the cap it feeds still refuses an over-cap send.
-- ===========================================================================
do $$
declare
  v_conv  uuid;
  v_plan  text;
  v_quota int;
  res     jsonb;
begin
  select plan::text into v_plan from public.companies
   where id = '2a000000-0000-4000-8000-000000000901';
  if v_plan is distinct from 'starter' then
    raise exception 'P-11 FAILED: the pause changed plan to %, so the quota CASE has '
      'no arm for this workspace and the spending cap is now NULL — open',
      coalesce(v_plan, 'null');
  end if;

  v_quota := case v_plan when 'starter' then 500 when 'pro' then 2500 end;
  if v_quota is null then
    raise exception 'P-11 FAILED: the quota CASE yields NULL, so the cap comparison '
      'is NULL and the ceiling never fires';
  end if;

  -- And the cap genuinely still bites: 3.00 x 500 = 1500 segments, so a period
  -- already past it must be refused rather than waved through.
  update public.companies set paused_at = null, paused_price_cents = null
   where id = '2a000000-0000-4000-8000-000000000901';
  insert into public.usage_events (company_id, type, quantity)
  values ('2a000000-0000-4000-8000-000000000901', 'sms_outbound', 1600);

  select conv.id into v_conv from public.conversations conv
   where conv.company_id = '2a000000-0000-4000-8000-000000000901' limit 1;
  res := public.gate_outbound_send(
    '2a000000-0000-4000-8000-000000000901'::uuid, v_conv,
    '1a000000-0000-4000-8000-000000000901'::uuid,
    'One more', 'idem-pause-cap', 1);
  if res->>'error' is distinct from 'usage_cap_reached' then
    raise exception 'P-11 FAILED: an over-cap send answered %, so the spending cap is '
      'not firing', coalesce(res->>'error', 'success');
  end if;
  raise notice 'P-11 PASSED: a pause leaves the plan, and the plan''s spending cap, intact';
end $$;

-- ===========================================================================
-- P-12. The control: a workspace that was never paused is untouched.
--
-- Every assertion above is about one row. This is the one that says the change
-- did not simply break sending for everybody.
-- ===========================================================================
do $$
declare
  r      jsonb;
  v_conv uuid;
  res    jsonb;
begin
  r := public.thread_inbound_message(
    '2a000000-0000-4000-8000-000000000902'::uuid,
    '3a000000-0000-4000-8000-000000000902'::uuid,
    '+16135551903', 'Can you quote a deck?', 'tx-pause-2');
  v_conv := (r->>'conversation_id')::uuid;

  res := public.gate_outbound_send(
    '2a000000-0000-4000-8000-000000000902'::uuid, v_conv,
    '1a000000-0000-4000-8000-000000000901'::uuid,
    'Yes — Tuesday?', 'idem-pause-ctl', 1);
  if res->'message' is null then
    raise exception 'P-12 FAILED: an ordinary workspace was refused with %',
      coalesce(res->>'error', 'nothing');
  end if;

  res := public.claim_auto_reply(
    '2a000000-0000-4000-8000-000000000902'::uuid, v_conv,
    'Thanks — back shortly.', 1, 3600);
  if res->'message' is null then
    raise exception 'P-12 FAILED: an ordinary workspace''s away reply was refused with %',
      coalesce(res->>'skipped', 'nothing');
  end if;
  raise notice 'P-12 PASSED: an unpaused workspace still sends, manually and automatically';
end $$;

-- ===========================================================================
-- P-13. PROVE THE GUARD BY BREAKING IT.
--
-- Everything above passes on the day it is written. What none of it can tell
-- you is whether it would FAIL if the pause clause went away — and a guard that
-- has only ever passed is unproven.
--
-- So: restore the pre-pause predicate (subscription only) inside this
-- transaction, and assert the defect comes straight back — a paused workspace
-- sending successfully, which is the exact failure this feature exists to
-- prevent. Then restore the real definition and assert it blocks again, so the
-- suite never leaves the database describing a broken world, even for the rest
-- of its own run.
--
-- DDL is transactional in Postgres and this file rolls back, so nothing here
-- outlives the test.
-- ===========================================================================
create or replace function public.company_send_block(p_company public.companies)
returns text
language sql
immutable
as $$
  select case
    when p_company.subscription_status <> 'active' or p_company.plan is null
      then 'subscription_inactive'
  end
$$;

do $$
declare
  v_conv uuid;
  res    jsonb;
begin
  update public.companies set paused_at = now(), paused_price_cents = 500
   where id = '2a000000-0000-4000-8000-000000000902';

  select conv.id into v_conv from public.conversations conv
   where conv.company_id = '2a000000-0000-4000-8000-000000000902' limit 1;

  res := public.gate_outbound_send(
    '2a000000-0000-4000-8000-000000000902'::uuid, v_conv,
    '1a000000-0000-4000-8000-000000000901'::uuid,
    'Sending while paused', 'idem-pause-broken', 1);
  if res->'message' is null then
    raise exception 'P-13 FAILED: with the pause clause REMOVED the send was still '
      'refused (%), so the assertions above are not testing the pause — something '
      'else in this fixture is doing the blocking',
      coalesce(res->>'error', 'nothing');
  end if;
  raise notice 'P-13a PASSED: without the pause clause the defect returns — the guards above are real';
end $$;

create or replace function public.company_send_block(p_company public.companies)
returns text
language sql
immutable
as $$
  select case
    when p_company.subscription_status <> 'active' or p_company.plan is null
      then 'subscription_inactive'
    when p_company.paused_at is not null
      then 'workspace_paused'
  end
$$;

do $$
declare
  v_conv uuid;
  res    jsonb;
begin
  select conv.id into v_conv from public.conversations conv
   where conv.company_id = '2a000000-0000-4000-8000-000000000902' limit 1;
  res := public.gate_outbound_send(
    '2a000000-0000-4000-8000-000000000902'::uuid, v_conv,
    '1a000000-0000-4000-8000-000000000901'::uuid,
    'Sending while paused', 'idem-pause-fixed', 1);
  if res->>'error' is distinct from 'workspace_paused' then
    raise exception 'P-13 FAILED: the restored gate answered %',
      coalesce(res->>'error', 'success');
  end if;
  raise notice 'P-13b PASSED: the real definition blocks again';
end $$;

-- ===========================================================================
-- COMING BACK. P-14 to P-16 are about the other end of the pause: the
-- workspace that paused, then cancelled or lapsed, and later resubscribed.
--
-- claim_checkout_activation is the ONE writer of a checkout completion's
-- activation. It clears `canceled_at` because that fact belongs to the
-- subscription being replaced — and `paused_at` is the same kind of fact,
-- attached to a licensed item that no longer exists. Left behind, it produces
-- the worst shape a billing bug takes: the workspace is `active`, on a plan,
-- PAYING FULL PRICE, and blocked in all five SQL gates above plus every
-- TypeScript one — with no way out that the customer can reach. Pause refuses
-- (`already_paused`), change-plan refuses (paused), and resume 409s because it
-- swaps the PAUSE price back and the new subscription has never carried one.
--
-- A third company, because these assertions need a clean billing history: 901
-- ends the run over its usage cap and 902 is left paused by P-13.
-- ===========================================================================
insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, plan, current_period_start, current_period_end,
   overage_cap_multiplier, stripe_customer_id, stripe_subscription_id)
values
  ('2a000000-0000-4000-8000-000000000903', 'Winter Co',
   '1a000000-0000-4000-8000-000000000901', 'US', '613', now(),
   'active', 'starter', now() - interval '1 day', now() + interval '29 days',
   3.00, 'cus_pause_903', 'sub_pause_old');

insert into public.phone_numbers
  (id, company_id, status, provisioning_key, country, number_e164)
values
  ('3a000000-0000-4000-8000-000000000903', '2a000000-0000-4000-8000-000000000903',
   'active', 'cs_pause_test_3', 'US', '+16135550903');

do $$
begin
  perform public.thread_inbound_message(
    '2a000000-0000-4000-8000-000000000903'::uuid,
    '3a000000-0000-4000-8000-000000000903'::uuid,
    '+16135551904', 'Are you taking work again?', 'tx-pause-3');
end $$;

-- ===========================================================================
-- P-14. The resubscribe frees the workspace.
--
-- The pre-state is the real one: paused in the autumn, cancelled in the winter,
-- so the pause fact is months old and NOTHING has re-read it (the daily
-- reconcile skips canceled tenants on purpose). The claim then attaches a brand
-- new subscription on a plan price, and the workspace must come back able to
-- send — not merely `active`, which is what made this defect invisible.
-- ===========================================================================
do $$
declare
  v_company public.companies%rowtype;
  v_conv    uuid;
  res       jsonb;
  v_block   text;
begin
  update public.companies
     set paused_at           = now() - interval '90 days',
         paused_price_cents  = 500,
         subscription_status = 'canceled',
         canceled_at         = now() - interval '30 days'
   where id = '2a000000-0000-4000-8000-000000000903';

  -- Where they start: blocked, and for the RIGHT reason — they cancelled.
  select * into v_company from public.companies
   where id = '2a000000-0000-4000-8000-000000000903';
  if public.company_send_block(v_company) is distinct from 'subscription_inactive' then
    raise exception 'P-14 FAILED: the cancelled fixture is not blocked as cancelled, so '
      'this test starts somewhere other than where the trap starts';
  end if;

  res := public.claim_checkout_activation(
    '2a000000-0000-4000-8000-000000000903'::uuid,
    'cus_pause_903', 'sub_pause_new', 'active',
    now() - interval '1 day', now() + interval '29 days', false, 'starter');
  if res->>'outcome' is distinct from 'claimed' then
    raise exception 'P-14 FAILED: the resubscribe was answered %, so nothing was activated',
      coalesce(res->>'outcome', 'nothing');
  end if;

  select * into v_company from public.companies
   where id = '2a000000-0000-4000-8000-000000000903';
  if v_company.paused_at is not null then
    raise exception 'P-14 FAILED: the resubscribed workspace is still marked paused '
      '(since %), so it pays the full plan price and cannot send a word',
      v_company.paused_at;
  end if;
  if v_company.paused_price_cents is not null then
    raise exception 'P-14 FAILED: the pause FEE survived the resubscribe (% cents), so the '
      '#85 margin report values a full-price tenant at the holding fee',
      v_company.paused_price_cents;
  end if;
  -- The facts the claim already got right, asserted here so a future edit to
  -- this function cannot trade one of them for the pause fix.
  if v_company.canceled_at is not null
     or v_company.subscription_status is distinct from 'active'
     or v_company.plan::text is distinct from 'starter'
     or v_company.stripe_subscription_id is distinct from 'sub_pause_new' then
    raise exception 'P-14 FAILED: the activation itself did not land (status %, plan %, sub %, canceled_at %)',
      v_company.subscription_status, coalesce(v_company.plan::text, 'null'),
      coalesce(v_company.stripe_subscription_id, 'null'),
      coalesce(v_company.canceled_at::text, 'null');
  end if;

  v_block := public.company_send_block(v_company);
  if v_block is not null then
    raise exception 'P-14 FAILED: a workspace that just paid to come back is blocked with %',
      v_block;
  end if;

  -- The one that matters: a real send through the real gate. `active` with a
  -- plan is what the customer is being charged for; this is what they bought.
  select conv.id into v_conv from public.conversations conv
   where conv.company_id = '2a000000-0000-4000-8000-000000000903' limit 1;
  res := public.gate_outbound_send(
    '2a000000-0000-4000-8000-000000000903'::uuid, v_conv,
    '1a000000-0000-4000-8000-000000000901'::uuid,
    'We are back — Tuesday work?', 'idem-pause-resub-1', 1);
  if res->'message' is null then
    raise exception 'P-14 FAILED: the resubscribed workspace was refused with % — and '
      'there is no self-serve way out of that state', coalesce(res->>'error', 'nothing');
  end if;
  raise notice 'P-14 PASSED: resubscribing clears the stale pause and the workspace can send again';
end $$;

-- ===========================================================================
-- P-15. The fail-closed arm: an activation with NO readable plan price leaves
-- the pause exactly where it is.
--
-- p_plan is `subscriptionPlan()` — the plan whose licensed price is on the
-- subscription being attached. Null means either "not a plan price" (a paused
-- subscription carries the pause price) or "the price catalog is unreadable in
-- this deploy". An unconditional `paused_at = null` would treat both as a
-- resume, and hand full service to every paused workspace that completed any
-- checkout on the day the plan price ids went missing.
-- ===========================================================================
do $$
declare
  v_company public.companies%rowtype;
  res       jsonb;
begin
  update public.companies
     set paused_at          = now(),
         paused_price_cents = 500
   where id = '2a000000-0000-4000-8000-000000000903';

  res := public.claim_checkout_activation(
    '2a000000-0000-4000-8000-000000000903'::uuid,
    'cus_pause_903', 'sub_pause_new', 'active',
    now() - interval '1 day', now() + interval '29 days', false, null);
  if res->>'outcome' is distinct from 'noop' then
    raise exception 'P-15 FAILED: re-claiming the SAME subscription answered %, not noop',
      coalesce(res->>'outcome', 'nothing');
  end if;

  select * into v_company from public.companies
   where id = '2a000000-0000-4000-8000-000000000903';
  if v_company.paused_at is null or v_company.paused_price_cents is null then
    raise exception 'P-15 FAILED: an activation with no readable plan price cleared the '
      'pause anyway — a workspace paying a holding fee just got the whole product';
  end if;
  -- The same reading, applied to the column beside it: `plan` is coalesced, not
  -- overwritten, for exactly this reason.
  if v_company.plan::text is distinct from 'starter' then
    raise exception 'P-15 FAILED: a null p_plan overwrote the stored plan with %',
      coalesce(v_company.plan::text, 'null');
  end if;
  raise notice 'P-15 PASSED: an unreadable plan price is not treated as a resume';
end $$;

-- ===========================================================================
-- P-16. PROVE THE GUARD BY BREAKING IT.
--
-- P-14 passes on the day it is written. What it cannot say by itself is whether
-- it would FAIL if the two `case when p_plan is not null` arms were dropped from
-- claim_checkout_activation — and a guard that has only ever passed is unproven.
--
-- So: stash the real definition, replace it with the PRE-FIX body (the same
-- function with the two pause lines removed), replay the resubscribe, and assert
-- the trap comes straight back — a full-price workspace that cannot send.
--
-- The stash is `pg_get_functiondef` rather than a third hand-copy of the body:
-- a copy would have to be re-edited every time the real function changes, and
-- the day somebody forgets is the day this test silently restores a stale
-- definition for the rest of the suite. DDL is transactional and this file rolls
-- back, so nothing here outlives the test either way.
-- ===========================================================================
create temp table pause_real_claim as
select pg_get_functiondef(p.oid) as def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'claim_checkout_activation';

create or replace function public.claim_checkout_activation(
  p_company_id           uuid,
  p_customer_id          text,
  p_subscription_id      text,
  p_status               text,
  p_period_start         timestamptz,
  p_period_end           timestamptz,
  p_cancel_at_period_end boolean,
  p_plan                 text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub     text;
  v_status  text;
  v_modules jsonb;
begin
  select stripe_subscription_id, subscription_status
    into v_sub, v_status
    from public.companies
   where id = p_company_id
     for update;
  if not found then
    raise exception 'claim_checkout_activation: company % not found', p_company_id;
  end if;

  if v_sub is not null
     and v_sub is distinct from p_subscription_id
     and v_status in ('active', 'past_due', 'unpaid') then
    return jsonb_build_object(
      'outcome', 'duplicate',
      'existing_subscription_id', v_sub);
  end if;

  update public.companies set
    stripe_customer_id     = p_customer_id,
    stripe_subscription_id = p_subscription_id,
    subscription_status    = p_status::public.subscription_status,
    current_period_start   = p_period_start,
    current_period_end     = p_period_end,
    canceled_at            = null,
    cancel_at_period_end   = p_cancel_at_period_end,
    plan                   = coalesce(p_plan::public.plan_id, plan)
  where id = p_company_id;

  select coalesce(
           jsonb_agg(jsonb_build_object(
             'module', module,
             'disabled_at', disabled_at,
             'grandfathered', grandfathered)),
           '[]'::jsonb)
    into v_modules
    from public.company_modules
   where company_id = p_company_id;

  return jsonb_build_object(
    'outcome',
    case when v_sub = p_subscription_id then 'noop' else 'claimed' end,
    'existing_subscription_id', v_sub,
    'modules', v_modules);
end $$;

do $$
declare
  v_company public.companies%rowtype;
  v_conv    uuid;
  res       jsonb;
begin
  -- Back to the trapped pre-state: paused, then cancelled.
  update public.companies
     set paused_at           = now() - interval '90 days',
         paused_price_cents  = 500,
         subscription_status = 'canceled',
         canceled_at         = now() - interval '30 days',
         stripe_subscription_id = 'sub_pause_old'
   where id = '2a000000-0000-4000-8000-000000000903';

  res := public.claim_checkout_activation(
    '2a000000-0000-4000-8000-000000000903'::uuid,
    'cus_pause_903', 'sub_pause_broken', 'active',
    now() - interval '1 day', now() + interval '29 days', false, 'starter');
  if res->>'outcome' is distinct from 'claimed' then
    raise exception 'P-16 FAILED: the pre-fix claim did not activate at all (%), so this '
      'block is not reproducing the defect', coalesce(res->>'outcome', 'nothing');
  end if;

  select * into v_company from public.companies
   where id = '2a000000-0000-4000-8000-000000000903';
  if v_company.paused_at is null then
    raise exception 'P-16 FAILED: with the pause clear REMOVED the resubscribe still '
      'cleared the pause, so P-14 is not testing that clear — something else is doing it';
  end if;
  if v_company.subscription_status is distinct from 'active' or v_company.plan is null then
    raise exception 'P-16 FAILED: the pre-fix claim left the company non-active, so the '
      'block below would be the cancellation and not the pause';
  end if;

  select conv.id into v_conv from public.conversations conv
   where conv.company_id = '2a000000-0000-4000-8000-000000000903' limit 1;
  res := public.gate_outbound_send(
    '2a000000-0000-4000-8000-000000000903'::uuid, v_conv,
    '1a000000-0000-4000-8000-000000000901'::uuid,
    'Anyone there?', 'idem-pause-resub-broken', 1);
  if res->>'error' is distinct from 'workspace_paused' then
    raise exception 'P-16 FAILED: the pre-fix resubscribe answered %, so the trap P-14 '
      'asserts against does not exist and P-14 proves nothing',
      coalesce(res->>'error', 'a sent message');
  end if;
  raise notice 'P-16a PASSED: without the pause clear a full-price workspace is trapped — P-14 is real';
end $$;

do $$
declare
  v_def text;
begin
  select def into v_def from pause_real_claim;
  if v_def is null then
    raise exception 'P-16 FAILED: the real claim_checkout_activation was never stashed';
  end if;
  execute v_def;
end $$;

do $$
declare
  v_company public.companies%rowtype;
  res       jsonb;
begin
  update public.companies
     set paused_at           = now() - interval '90 days',
         paused_price_cents  = 500,
         subscription_status = 'canceled',
         canceled_at         = now() - interval '30 days',
         stripe_subscription_id = 'sub_pause_old'
   where id = '2a000000-0000-4000-8000-000000000903';

  res := public.claim_checkout_activation(
    '2a000000-0000-4000-8000-000000000903'::uuid,
    'cus_pause_903', 'sub_pause_restored', 'active',
    now() - interval '1 day', now() + interval '29 days', false, 'starter');

  select * into v_company from public.companies
   where id = '2a000000-0000-4000-8000-000000000903';
  if v_company.paused_at is not null or v_company.paused_price_cents is not null then
    raise exception 'P-16 FAILED: the restored definition did not clear the pause';
  end if;
  raise notice 'P-16b PASSED: the real definition frees the workspace again';
end $$;

rollback;
