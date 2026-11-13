-- Loonext §8 notification-debounce assertion suite (thread_inbound_message's
-- `notify` claim + last_notified_at stamp), and the bell badge against its
-- watermark (N8, N9). psql-runnable: every test is a DO
-- block that RAISEs EXCEPTION on failure. Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
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

  if (res->>'conversation_id')::uuid is distinct from v_conv_id then
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

  if (res->>'conversation_id')::uuid is distinct from v_conv_id then
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

-- ===========================================================================
-- Bell fixtures: member M (…01) and actor A (…02). Every arm of
-- notification_feed is spread over five hours on two numbers, with the rows
-- each arm must leave out beside them. num2 (…02) is the one N8 hides.
--
--   t-5h  inbound   conv1         t-90m  missed    conv2 (num2, unassigned)
--   t-4h  assigned  conv1         t-1h   inbound   conv1
--   t-3h  inbound   conv1         t-45m  mention   conv1
--   t-150m task_assigned conv1    t-30m  missed    conv1 (no direction key)
--   t-2h  inbound   conv3 (num2)
--
-- Left out: an assignment to A, M assigning themselves, an outbound missed
-- call, an answered call, an inbound text on the unassigned thread, M
-- mentioning themselves and an outbound text.
-- ===========================================================================
insert into auth.users (id, email, raw_user_meta_data) values
  ('12000000-0000-4000-8000-000000000001', 'member@bell.test', '{"display_name":"Bell Member"}'::jsonb),
  ('12000000-0000-4000-8000-000000000002', 'actor@bell.test',  '{"display_name":"Bell Actor"}'::jsonb);

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, plan, current_period_start, current_period_end)
values
  ('22000000-0000-4000-8000-000000000001', 'Bell Co',
   '12000000-0000-4000-8000-000000000002', 'US', '613', now(),
   'active', 'starter', now() - interval '1 day', now() + interval '29 days');

insert into public.company_members (company_id, user_id, role) values
  ('22000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000002', 'owner'),
  ('22000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000001', 'member');

insert into public.phone_numbers (id, company_id, status, provisioning_key, country, number_e164)
values
  ('32000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001',
   'active', 'cs_bell_test_1', 'US', '+16135550202'),
  ('32000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-000000000001',
   'active', 'cs_bell_test_2', 'US', '+16135550203');

insert into public.contacts (id, company_id, phone_e164, name) values
  ('42000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001', '+16135553101', 'Ada'),
  ('42000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-000000000001', '+16135553102', 'Ben'),
  ('42000000-0000-4000-8000-000000000003', '22000000-0000-4000-8000-000000000001', '+16135553103', 'Cy');

insert into public.conversations
  (id, company_id, contact_id, phone_number_id, status, assigned_user_id, last_message_at)
values
  ('52000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001',
   '42000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001',
   'open', '12000000-0000-4000-8000-000000000001', now() - interval '1 hour'),
  ('52000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-000000000001',
   '42000000-0000-4000-8000-000000000002', '32000000-0000-4000-8000-000000000002',
   'new', null, now() - interval '25 minutes'),
  ('52000000-0000-4000-8000-000000000003', '22000000-0000-4000-8000-000000000001',
   '42000000-0000-4000-8000-000000000003', '32000000-0000-4000-8000-000000000002',
   'open', '12000000-0000-4000-8000-000000000001', now() - interval '2 hours');

insert into public.messages
  (id, company_id, conversation_id, direction, body, status, sent_by_user_id, created_at)
values
  ('62000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001',
   '52000000-0000-4000-8000-000000000001', 'inbound', 'Gutters?', 'received', null,
   now() - interval '5 hours'),
  ('62000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-000000000001',
   '52000000-0000-4000-8000-000000000001', 'inbound', 'How much?', 'received', null,
   now() - interval '3 hours'),
  ('62000000-0000-4000-8000-000000000003', '22000000-0000-4000-8000-000000000001',
   '52000000-0000-4000-8000-000000000003', 'inbound', 'Roof leak', 'received', null,
   now() - interval '2 hours'),
  ('62000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-000000000001',
   '52000000-0000-4000-8000-000000000001', 'inbound', 'Still there?', 'received', null,
   now() - interval '1 hour'),
  ('62000000-0000-4000-8000-000000000006', '22000000-0000-4000-8000-000000000001',
   '52000000-0000-4000-8000-000000000002', 'inbound', 'Hello?', 'received', null,
   now() - interval '25 minutes'),
  ('62000000-0000-4000-8000-000000000008', '22000000-0000-4000-8000-000000000001',
   '52000000-0000-4000-8000-000000000001', 'outbound', 'On our way', 'sent',
   '12000000-0000-4000-8000-000000000001', now() - interval '8 minutes');

insert into public.messages
  (id, company_id, conversation_id, direction, body, sent_by_user_id, created_at)
values
  ('62000000-0000-4000-8000-000000000005', '22000000-0000-4000-8000-000000000001',
   '52000000-0000-4000-8000-000000000001', 'note', '@Bell Member can you take this?',
   '12000000-0000-4000-8000-000000000002', now() - interval '45 minutes'),
  ('62000000-0000-4000-8000-000000000007', '22000000-0000-4000-8000-000000000001',
   '52000000-0000-4000-8000-000000000001', 'note', '@Bell Member note to self',
   '12000000-0000-4000-8000-000000000001', now() - interval '12 minutes');

insert into public.message_mentions (message_id, user_id, company_id, conversation_id) values
  ('62000000-0000-4000-8000-000000000005', '12000000-0000-4000-8000-000000000001',
   '22000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001'),
  ('62000000-0000-4000-8000-000000000007', '12000000-0000-4000-8000-000000000001',
   '22000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001');

insert into public.conversation_events
  (id, company_id, conversation_id, actor_user_id, type, payload, created_at)
values
  ('72000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001',
   '52000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000002',
   'assigned', '{"from":null,"to":"12000000-0000-4000-8000-000000000001"}'::jsonb,
   now() - interval '4 hours'),
  ('72000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-000000000001',
   '52000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000002',
   'task_assigned',
   '{"task_id":"82000000-0000-4000-8000-000000000001","from_user_id":null,"to_user_id":"12000000-0000-4000-8000-000000000001"}'::jsonb,
   now() - interval '150 minutes'),
  ('72000000-0000-4000-8000-000000000003', '22000000-0000-4000-8000-000000000001',
   '52000000-0000-4000-8000-000000000002', null, 'call_completed',
   '{"call_session_id":"bell-a","outcome":"missed","direction":"inbound"}'::jsonb,
   now() - interval '90 minutes'),
  ('72000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-000000000001',
   '52000000-0000-4000-8000-000000000001', null, 'call_completed',
   '{"call_session_id":"bell-b","outcome":"missed"}'::jsonb,
   now() - interval '30 minutes'),
  ('72000000-0000-4000-8000-000000000005', '22000000-0000-4000-8000-000000000001',
   '52000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000001',
   'assigned', '{"from":null,"to":"12000000-0000-4000-8000-000000000002"}'::jsonb,
   now() - interval '20 minutes'),
  ('72000000-0000-4000-8000-000000000006', '22000000-0000-4000-8000-000000000001',
   '52000000-0000-4000-8000-000000000003', '12000000-0000-4000-8000-000000000001',
   'assigned', '{"from":null,"to":"12000000-0000-4000-8000-000000000001"}'::jsonb,
   now() - interval '15 minutes'),
  ('72000000-0000-4000-8000-000000000007', '22000000-0000-4000-8000-000000000001',
   '52000000-0000-4000-8000-000000000001', null, 'call_completed',
   '{"call_session_id":"bell-c","outcome":"missed","direction":"outbound"}'::jsonb,
   now() - interval '10 minutes'),
  ('72000000-0000-4000-8000-000000000008', '22000000-0000-4000-8000-000000000001',
   '52000000-0000-4000-8000-000000000002', null, 'call_completed',
   '{"call_session_id":"bell-d","outcome":"answered","direction":"inbound"}'::jsonb,
   now() - interval '5 minutes');

-- The badge as 20260730003100_one_notification_definition.sql defined it: the
-- whole feed, then past the watermark, then not read one by one.
create function pg_temp.old_badge(p_company uuid, p_user uuid, p_hidden uuid[])
returns bigint
language sql
as $$
  select count(*)::bigint
    from public.notification_feed(p_company, p_user, p_hidden) f
   where f.created_at > coalesce(
           (select nr.last_seen_at from public.notification_reads nr
             where nr.user_id = p_user and nr.company_id = p_company),
           '-infinity'::timestamptz)
     and not exists (
       select 1 from public.notification_read_items ri
        where ri.user_id = p_user
          and ri.company_id = p_company
          and ri.notification_id = f.id)
$$;

-- The badge, the old definition and the list's unread rows agree, and equal
-- the count this step expects, with and without num2 hidden.
create function pg_temp.badge_check(p_step text, p_want bigint, p_want_hidden bigint)
returns void
language plpgsql
as $$
declare
  co     uuid := '22000000-0000-4000-8000-000000000001';
  usr    uuid := '12000000-0000-4000-8000-000000000001';
  hidden uuid[];
  want   bigint;
  badge  bigint;
  old    bigint;
  listed bigint;
begin
  for i in 0..1 loop
    hidden := case when i = 1 then array['32000000-0000-4000-8000-000000000002']::uuid[] end;
    want := case when i = 1 then p_want_hidden else p_want end;
    badge := public.api_notifications_unread_count(co, usr, hidden);
    old := pg_temp.old_badge(co, usr, hidden);
    select count(*) into listed
      from public.api_notifications(co, usr, 100, null, null, hidden) x
     where (x->>'unread')::boolean;
    if badge is distinct from old
       or badge is distinct from listed
       or badge is distinct from want then
      raise exception
        'N8 FAILED at "%"%: badge %, old definition %, unread in the list %, expected %',
        p_step, case when i = 1 then ' (num2 hidden)' else '' end,
        badge, old, listed, want;
    end if;
  end loop;
end $$;

-- ===========================================================================
-- N8. The bell badge gives the old definition's answer with no watermark, with
--     a watermark in the middle of the history, and with items read one by
--     one on either side of it.
-- ===========================================================================
do $$
declare
  co  uuid := '22000000-0000-4000-8000-000000000001';
  usr uuid := '12000000-0000-4000-8000-000000000001';
begin
  perform pg_temp.badge_check('no watermark', 9, 7);

  -- Read one by one before there is any watermark.
  perform public.api_mark_notification_read(co, usr,
    '72000000-0000-4000-8000-000000000001', now() - interval '4 hours');
  perform pg_temp.badge_check('an old item read', 8, 6);

  -- Mark all read in the middle of the history.
  perform public.api_mark_notifications_read(co, usr, now() - interval '100 minutes');
  perform pg_temp.badge_check('mid-history watermark', 4, 3);

  -- A read row the watermark also covers is not taken off twice.
  insert into public.notification_read_items
    (user_id, company_id, notification_id, item_created_at)
  values (usr, co, '62000000-0000-4000-8000-000000000002', now() - interval '3 hours');
  perform pg_temp.badge_check('a covered item also read', 4, 3);

  perform public.api_mark_notification_read(co, usr,
    '62000000-0000-4000-8000-000000000004', now() - interval '1 hour');
  perform pg_temp.badge_check('an item past the watermark read', 3, 2);

  perform public.api_mark_notification_read(co, usr,
    '72000000-0000-4000-8000-000000000003', now() - interval '90 minutes');
  perform pg_temp.badge_check('an item on the hidden number read', 2, 2);

  raise notice 'N8 PASSED: the badge equals the old definition with no watermark, a mid-history one and per-item reads';
end $$;

-- ===========================================================================
-- N9. notification_feed's p_since: at every point in the history each arm
--     keeps exactly its own rows created after it, and the 3-argument call
--     still reads the whole feed.
-- ===========================================================================
do $$
declare
  co     uuid := '22000000-0000-4000-8000-000000000001';
  usr    uuid := '12000000-0000-4000-8000-000000000001';
  hidden uuid[];
  cut    timestamptz;
  arms   int;
  diff   int;
  cuts   int := 0;
begin
  select count(distinct f.type) into arms from public.notification_feed(co, usr) f;
  if arms is distinct from 5 then
    raise exception 'N9 FAILED: the fixture must hold all five arms, it holds %', arms;
  end if;

  for i in 0..1 loop
    hidden := case when i = 1 then array['32000000-0000-4000-8000-000000000002']::uuid[] end;
    for cut in
      select '-infinity'::timestamptz
      union select f.created_at from public.notification_feed(co, usr) f
      union select f.created_at - interval '1 second' from public.notification_feed(co, usr) f
    loop
      select count(*) into diff from (
        (select f.id, f.type from public.notification_feed(co, usr, hidden, cut) f
         except all
         select f.id, f.type from public.notification_feed(co, usr, hidden) f
          where f.created_at > cut)
        union all
        (select f.id, f.type from public.notification_feed(co, usr, hidden) f
          where f.created_at > cut
         except all
         select f.id, f.type from public.notification_feed(co, usr, hidden, cut) f)
      ) d;
      if diff is distinct from 0 then
        raise exception 'N9 FAILED: p_since % keeps % wrong rows%', cut, diff,
          case when i = 1 then ' (num2 hidden)' else '' end;
      end if;
      cuts := cuts + 1;
    end loop;
  end loop;

  raise notice 'N9 PASSED: p_since cuts every arm at % points, with and without a hidden number', cuts;
end $$;

rollback;
