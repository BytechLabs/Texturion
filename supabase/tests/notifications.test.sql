-- JobText §8 notification-debounce assertion suite (thread_inbound_message's
-- `notify` claim + last_notified_at stamp). psql-runnable: every test is a DO
-- block that RAISEs EXCEPTION on failure. Run with:
--   docker exec -i supabase_db_JobText psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/notifications.test.sql
-- The whole suite runs in one transaction and ROLLS BACK: it never pollutes
-- the local database. (now() is transaction-fixed, which these tests rely on:
-- a stamp taken "just now" is exactly now().)

\set ON_ERROR_STOP on

begin;

-- ===========================================================================
-- Fixtures (rolled back at the end).
-- ===========================================================================
insert into auth.users (id, email, raw_user_meta_data)
values ('11000000-0000-4000-8000-000000000001', 'owner@notify.test',
        '{"display_name":"Notify Owner"}'::jsonb);

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, plan, current_period_start, current_period_end)
values
  ('21000000-0000-4000-8000-000000000001', 'Notify Co',
   '11000000-0000-4000-8000-000000000001', 'US', '613', now(),
   'active', 'starter', now() - interval '1 day', now() + interval '29 days');

insert into public.phone_numbers (id, company_id, status, provisioning_key, country, number_e164)
values
  ('31000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001',
   'active', 'cs_notify_test_1', 'US', '+16135550201');

-- ===========================================================================
-- N1. New conversation (§8 trigger): first inbound claims the notification
--     and stamps last_notified_at.
-- ===========================================================================
do $$
declare
  res jsonb;
  v_stamp timestamptz;
begin
  res := public.thread_inbound_message(
    '21000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000001',
    '+16135553000', 'Hi, do you do gutters?', 'tx-n1-1');

  if not (res->>'notify')::boolean then
    raise exception 'N1 FAILED: new conversation did not claim a notification';
  end if;
  select last_notified_at into v_stamp from public.conversations
   where id = (res->>'conversation_id')::uuid;
  if v_stamp is distinct from now() then
    raise exception 'N1 FAILED: last_notified_at not stamped (%)', v_stamp;
  end if;
  raise notice 'N1 PASSED: new conversation notifies and stamps last_notified_at';
end $$;

-- ===========================================================================
-- N2. Debounce (§8: "never one email per message"): a rapid append inside
--     the 15-minute window does NOT claim.
-- ===========================================================================
do $$
declare
  res jsonb;
begin
  res := public.thread_inbound_message(
    '21000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000001',
    '+16135553000', 'Also: how much?', 'tx-n2-1');

  if (res->>'notify')::boolean then
    raise exception 'N2 FAILED: append within 15 minutes claimed a notification';
  end if;
  raise notice 'N2 PASSED: append inside the window is debounced';
end $$;

-- ===========================================================================
-- N3. Gate reopens after 15 minutes: an append with last_notified_at older
--     than 15 minutes claims again and re-stamps.
-- ===========================================================================
do $$
declare
  res jsonb;
  v_conv_id uuid;
  v_stamp timestamptz;
begin
  select c.id into v_conv_id from public.conversations c
   join public.contacts ct on ct.id = c.contact_id
   where c.company_id = '21000000-0000-4000-8000-000000000001'
     and ct.phone_e164 = '+16135553000' and c.closed_at is null;
  update public.conversations
     set last_notified_at = now() - interval '16 minutes' where id = v_conv_id;

  res := public.thread_inbound_message(
    '21000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000001',
    '+16135553000', 'Still there?', 'tx-n3-1');

  if not (res->>'notify')::boolean then
    raise exception 'N3 FAILED: first inbound after 15 minutes did not claim';
  end if;
  select last_notified_at into v_stamp from public.conversations where id = v_conv_id;
  if v_stamp is distinct from now() then
    raise exception 'N3 FAILED: last_notified_at not re-stamped (%)', v_stamp;
  end if;
  raise notice 'N3 PASSED: >=15-minute-old stamp claims again and re-stamps';
end $$;

-- ===========================================================================
-- N4. Duplicate delivery (same telnyx_message_id) never claims and never
--     re-stamps, even when the gate would otherwise be open.
-- ===========================================================================
do $$
declare
  res jsonb;
  v_conv_id uuid;
  v_stamp timestamptz;
begin
  select c.id into v_conv_id from public.conversations c
   join public.contacts ct on ct.id = c.contact_id
   where c.company_id = '21000000-0000-4000-8000-000000000001'
     and ct.phone_e164 = '+16135553000' and c.closed_at is null;
  update public.conversations
     set last_notified_at = now() - interval '16 minutes' where id = v_conv_id;

  res := public.thread_inbound_message(
    '21000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000001',
    '+16135553000', 'Still there?', 'tx-n3-1'); -- tx-n3-1 already recorded

  if (res->>'created')::boolean or (res->>'notify')::boolean then
    raise exception 'N4 FAILED: duplicate delivery claimed a notification';
  end if;
  select last_notified_at into v_stamp from public.conversations where id = v_conv_id;
  if v_stamp is distinct from now() - interval '16 minutes' then
    raise exception 'N4 FAILED: duplicate delivery re-stamped last_notified_at';
  end if;
  raise notice 'N4 PASSED: duplicate deliveries never claim or re-stamp';
end $$;

-- ===========================================================================
-- N5. Reopened by inbound (§8 trigger): claims even with a fresh stamp.
-- ===========================================================================
do $$
declare
  res jsonb;
  v_conv_id uuid;
begin
  select c.id into v_conv_id from public.conversations c
   join public.contacts ct on ct.id = c.contact_id
   where c.company_id = '21000000-0000-4000-8000-000000000001'
     and ct.phone_e164 = '+16135553000' and c.closed_at is null;
  -- Close it moments after a notification (stamp is fresh): the reopen
  -- trigger must still notify.
  update public.conversations
     set status = 'closed', closed_at = now() - interval '5 minutes',
         last_notified_at = now() - interval '6 minutes'
   where id = v_conv_id;

  res := public.thread_inbound_message(
    '21000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000001',
    '+16135553000', 'One more thing…', 'tx-n5-1');

  if (res->>'conversation_id')::uuid <> v_conv_id then
    raise exception 'N5 FAILED: did not reopen the recently-closed conversation';
  end if;
  if not (res->>'notify')::boolean then
    raise exception 'N5 FAILED: reopened-by-inbound did not claim a notification';
  end if;
  raise notice 'N5 PASSED: reopened-by-inbound claims regardless of the gate';
end $$;

-- ===========================================================================
-- N6. Spam absorb (threading rule 3) never notifies and never stamps.
-- ===========================================================================
do $$
declare
  res jsonb;
  v_conv_id uuid;
  v_stamp timestamptz;
begin
  select c.id into v_conv_id from public.conversations c
   join public.contacts ct on ct.id = c.contact_id
   where c.company_id = '21000000-0000-4000-8000-000000000001'
     and ct.phone_e164 = '+16135553000' and c.closed_at is null;
  update public.conversations
     set status = 'closed', closed_at = now(), is_spam = true,
         last_notified_at = null
   where id = v_conv_id;

  res := public.thread_inbound_message(
    '21000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000001',
    '+16135553000', 'CLICK THIS LINK', 'tx-n6-1');

  if (res->>'conversation_id')::uuid <> v_conv_id then
    raise exception 'N6 FAILED: spam inbound did not absorb into the spam thread';
  end if;
  if (res->>'notify')::boolean then
    raise exception 'N6 FAILED: spam-thread append claimed a notification';
  end if;
  select last_notified_at into v_stamp from public.conversations where id = v_conv_id;
  if v_stamp is not null then
    raise exception 'N6 FAILED: spam-thread append stamped last_notified_at';
  end if;
  raise notice 'N6 PASSED: spam-thread appends never notify (§8)';
end $$;

-- ===========================================================================
-- N7. Post-window create (threading rule 5 via an expired 30-day window):
--     the brand-new conversation claims.
-- ===========================================================================
do $$
declare
  res jsonb;
  v_old_conv_id uuid;
begin
  select c.id into v_old_conv_id from public.conversations c
   join public.contacts ct on ct.id = c.contact_id
   where c.company_id = '21000000-0000-4000-8000-000000000001'
     and ct.phone_e164 = '+16135553000'
   order by c.created_at desc limit 1;
  update public.conversations
     set is_spam = false, status = 'closed', closed_at = now() - interval '40 days'
   where id = v_old_conv_id;

  res := public.thread_inbound_message(
    '21000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000001',
    '+16135553000', 'Long time!', 'tx-n7-1');

  if (res->>'conversation_id')::uuid = v_old_conv_id then
    raise exception 'N7 FAILED: expected a new conversation after the 30-day window';
  end if;
  if not (res->>'notify')::boolean then
    raise exception 'N7 FAILED: post-window new conversation did not claim';
  end if;
  raise notice 'N7 PASSED: post-window create claims the notification';
end $$;

rollback;
