-- Loonext /for-you (D23) + notifications read-model (D24) assertion suite
-- (migration 20260702070000_appv2_for_you_notifications.sql). psql-runnable:
-- every test is a DO block that RAISEs EXCEPTION on failure. Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/for_you_notifications.test.sql
-- The whole suite runs in one transaction and ROLLS BACK: it never pollutes
-- the local database. now() is transaction-fixed, which these tests rely on
-- for deterministic "overdue" (due_at < now()) and unread-watermark checks.
--
-- ID scheme (all valid hex): companies c…01; users a…01 (lead/owner),
-- a…02 (member); number d…01; contacts e…01/e…02; conversations f…0a (W,
-- waiting+assigned+overdue-task), f…0b (U, open+assigned+unread), f…0c (T,
-- unassigned new → triage), f…0d (X, closed → never shown); source messages
-- 1…0a/0b/0c; tasks 2…0a (member, overdue) / 2…0c (unassigned); events 3…01/02/03.

\set ON_ERROR_STOP on

begin;

-- ===========================================================================
-- Fixtures (rolled back at the end).
-- ===========================================================================
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000000001', 'lead@fy.test',   '{"display_name":"Lead"}'::jsonb),
  ('a0000000-0000-4000-8000-000000000002', 'member@fy.test', '{"display_name":"Member"}'::jsonb);

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, plan, current_period_start, current_period_end)
values
  ('c0000000-0000-4000-8000-000000000001', 'FY Co',
   'a0000000-0000-4000-8000-000000000001', 'US', '613', now(),
   'active', 'starter', now() - interval '1 day', now() + interval '29 days');

insert into public.company_members (company_id, user_id, role) values
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'owner'),
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'member');

insert into public.phone_numbers (id, company_id, status, provisioning_key, country, number_e164)
values ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
        'active', 'cs_fy_1', 'US', '+16135550001');

-- One contact per OPEN conversation: the partial unique index
-- conversations_open_uq forbids two open threads for the same (number, contact).
insert into public.contacts (id, company_id, phone_e164, name) values
  ('e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', '+16135551001', 'Jane'),
  ('e0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', '+16135551002', 'Bob'),
  ('e0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', '+16135551003', 'Cara');

-- W: assigned to MEMBER, 'waiting', unread, + OVERDUE task (urgency 0).
-- U: assigned to MEMBER, 'open', unread (unread section).
-- T: UNASSIGNED, 'new', unread (triage; owner/admin only).
-- X: CLOSED, assigned to member (must never appear anywhere).
insert into public.conversations
  (id, company_id, contact_id, phone_number_id, status, assigned_user_id,
   last_message_at, closed_at, is_spam)
values
  ('f0000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001',
   'waiting', 'a0000000-0000-4000-8000-000000000002', now() - interval '2 hours', null, false),
  ('f0000000-0000-4000-8000-00000000000b', 'c0000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001',
   'open', 'a0000000-0000-4000-8000-000000000002', now() - interval '1 hour', null, false),
  ('f0000000-0000-4000-8000-00000000000c', 'c0000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001',
   'new', null, now() - interval '30 minutes', null, false),
  ('f0000000-0000-4000-8000-00000000000d', 'c0000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001',
   'closed', 'a0000000-0000-4000-8000-000000000002', now() - interval '3 hours',
   now() - interval '3 hours', false);

insert into public.messages
  (id, company_id, conversation_id, direction, body, status, created_at)
values
  ('10000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-000000000001',
   'f0000000-0000-4000-8000-00000000000a', 'inbound', 'Need a quote', 'received',
   now() - interval '2 hours'),
  ('10000000-0000-4000-8000-00000000000b', 'c0000000-0000-4000-8000-000000000001',
   'f0000000-0000-4000-8000-00000000000b', 'inbound', 'Are you free?', 'received',
   now() - interval '1 hour'),
  ('10000000-0000-4000-8000-00000000000c', 'c0000000-0000-4000-8000-000000000001',
   'f0000000-0000-4000-8000-00000000000c', 'inbound', 'New lead here', 'received',
   now() - interval '30 minutes');

-- Task OVERDUE, assigned to MEMBER, on W (promotes msg a).
-- Task UNASSIGNED, not overdue, on T (promotes msg c) → triage tasks.
insert into public.tasks
  (id, company_id, message_id, conversation_id, title, assigned_user_id,
   due_at, created_by_user_id)
values
  ('20000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-00000000000a', 'f0000000-0000-4000-8000-00000000000a',
   'Send the quote', 'a0000000-0000-4000-8000-000000000002',
   now() - interval '1 day', 'a0000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-00000000000c', 'c0000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-00000000000c', 'f0000000-0000-4000-8000-00000000000c',
   'Call the new lead', null, null, 'a0000000-0000-4000-8000-000000000001');

-- ===========================================================================
-- FY1. api_for_you (member): waiting_on_you = both assigned open|waiting
--      threads (W urgency 0 pinned by its overdue-linked task, then U urgency
--      2 for its unread state) — the urgency sort is the assertion. my_tasks
--      pins the overdue task; unread cross-cut has U (the assigned+unread
--      thread). triage is NULL (a member never gets the strip). Closed X is
--      absent everywhere.
-- ===========================================================================
do $$
declare r jsonb;
begin
  r := public.api_for_you('c0000000-0000-4000-8000-000000000001',
                          'a0000000-0000-4000-8000-000000000002', false, now(), 20);

  -- Both assigned open|waiting threads surface; W is FIRST by urgency (0 <2).
  if jsonb_array_length(r->'waiting_on_you') <> 2 then
    raise exception 'FY1 FAILED: waiting_on_you count %, expected 2: %',
      jsonb_array_length(r->'waiting_on_you'), r->'waiting_on_you';
  end if;
  if (r->'waiting_on_you'->0->>'conversation_id')
       <> 'f0000000-0000-4000-8000-00000000000a'
     or (r->'waiting_on_you'->0->>'urgency')::int <> 0
     or not (r->'waiting_on_you'->0->>'has_overdue_task')::boolean
     or not (r->'waiting_on_you'->0->>'unread')::boolean then
    raise exception 'FY1 FAILED: waiting_on_you top row (overdue-pinned) wrong: %',
      r->'waiting_on_you'->0;
  end if;
  if (r->'waiting_on_you'->1->>'conversation_id')
       <> 'f0000000-0000-4000-8000-00000000000b'
     or (r->'waiting_on_you'->1->>'urgency')::int <> 2 then
    raise exception 'FY1 FAILED: waiting_on_you second row (U, urgency 2) wrong: %',
      r->'waiting_on_you'->1;
  end if;

  if jsonb_array_length(r->'my_tasks') <> 1
     or (r->'my_tasks'->0->>'task_id') <> '20000000-0000-4000-8000-00000000000a'
     or not (r->'my_tasks'->0->>'overdue')::boolean then
    raise exception 'FY1 FAILED: my_tasks wrong: %', r->'my_tasks';
  end if;

  -- unread cross-cut = both assigned+unread threads (U, W), newest first (U at
  -- -1h before W at -2h). Unassigned T is NOT here (triage only).
  if jsonb_array_length(r->'unread') <> 2
     or (r->'unread'->0->>'conversation_id') <> 'f0000000-0000-4000-8000-00000000000b'
     or (r->'unread'->1->>'conversation_id') <> 'f0000000-0000-4000-8000-00000000000a' then
    raise exception 'FY1 FAILED: unread wrong: %', r->'unread';
  end if;

  if r->'triage' is distinct from 'null'::jsonb then
    raise exception 'FY1 FAILED: a member must not receive a triage section: %', r->'triage';
  end if;

  raise notice 'FY1 PASSED: member sections derived + urgency-sorted, no triage';
end $$;

-- ===========================================================================
-- FY2. api_for_you (lead): triage strip present — unassigned open conv T +
--      unassigned open task. The lead is NOT assigned W/U, so their own
--      waiting_on_you/my_tasks are empty (assignment is per-user).
-- ===========================================================================
do $$
declare r jsonb;
begin
  r := public.api_for_you('c0000000-0000-4000-8000-000000000001',
                          'a0000000-0000-4000-8000-000000000001', true, now(), 20);

  if r->'triage' = 'null'::jsonb then
    raise exception 'FY2 FAILED: lead did not receive a triage section';
  end if;
  if jsonb_array_length(r->'triage'->'conversations') <> 1
     or (r->'triage'->'conversations'->0->>'conversation_id')
          <> 'f0000000-0000-4000-8000-00000000000c' then
    raise exception 'FY2 FAILED: triage conversations wrong: %', r->'triage'->'conversations';
  end if;
  if jsonb_array_length(r->'triage'->'tasks') <> 1
     or (r->'triage'->'tasks'->0->>'task_id') <> '20000000-0000-4000-8000-00000000000c' then
    raise exception 'FY2 FAILED: triage tasks wrong: %', r->'triage'->'tasks';
  end if;
  if jsonb_array_length(r->'waiting_on_you') <> 0
     or jsonb_array_length(r->'my_tasks') <> 0 then
    raise exception 'FY2 FAILED: lead sees another user''s assigned work: %', r;
  end if;

  raise notice 'FY2 PASSED: lead triage strip present, per-user assignment respected';
end $$;

-- ===========================================================================
-- FY3. Completing the source message removes the derived-open task from
--      my_tasks (completion DERIVES from messages.done_at, D17) and drops W's
--      urgency below 0 (no overdue task remaining).
-- ===========================================================================
do $$
declare r jsonb;
begin
  update public.messages set done_at = now(),
         done_by_user_id = 'a0000000-0000-4000-8000-000000000002'
   where id = '10000000-0000-4000-8000-00000000000a';

  r := public.api_for_you('c0000000-0000-4000-8000-000000000001',
                          'a0000000-0000-4000-8000-000000000002', false, now(), 20);

  if jsonb_array_length(r->'my_tasks') <> 0 then
    raise exception 'FY3 FAILED: a done task still appears in my_tasks: %', r->'my_tasks';
  end if;
  if (r->'waiting_on_you'->0->>'has_overdue_task')::boolean then
    raise exception 'FY3 FAILED: W still flagged overdue-task after completion';
  end if;

  -- undo so the notification tests below still see the inbound thread.
  update public.messages set done_at = null, done_by_user_id = null
   where id = '10000000-0000-4000-8000-00000000000a';

  raise notice 'FY3 PASSED: completion derives from messages.done_at (task drops out)';
end $$;

-- ===========================================================================
-- Notification-source fixtures: an 'assigned' event to the member (by the
-- lead) and a 'task_assigned' event to the member (by the lead). Plus a
-- SELF-assign that must NOT notify the actor.
-- ===========================================================================
insert into public.conversation_events
  (id, company_id, conversation_id, actor_user_id, type, payload, created_at)
values
  ('30000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   'f0000000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-000000000001',
   'assigned', '{"from":null,"to":"a0000000-0000-4000-8000-000000000002"}'::jsonb,
   now() - interval '50 minutes'),
  ('30000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001',
   'f0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000001',
   'task_assigned',
   '{"task_id":"20000000-0000-4000-8000-00000000000a","from_user_id":null,"to_user_id":"a0000000-0000-4000-8000-000000000002"}'::jsonb,
   now() - interval '40 minutes'),
  ('30000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001',
   'f0000000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-000000000002',
   'assigned', '{"from":null,"to":"a0000000-0000-4000-8000-000000000002"}'::jsonb,
   now() - interval '35 minutes');

-- ===========================================================================
-- N1. api_notifications (member): the derived union carries the two inbound
--     messages in the member's assigned threads (W, U) + the assigned event +
--     the task_assigned event = 4 items; the self-assign is excluded. With no
--     watermark yet, every item is unread.
-- ===========================================================================
do $$
declare cnt int; unread_cnt int;
begin
  select count(*) into cnt from public.api_notifications(
    'c0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000002', 100, null, null) x;
  if cnt <> 4 then
    raise exception 'N1 FAILED: expected 4 derived notifications, got %', cnt;
  end if;

  select count(*) into unread_cnt from public.api_notifications(
    'c0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000002', 100, null, null) x
   where (x->>'unread')::boolean;
  if unread_cnt <> 4 then
    raise exception 'N1 FAILED: expected 4 unread (no watermark), got %', unread_cnt;
  end if;

  if public.api_notifications_unread_count(
       'c0000000-0000-4000-8000-000000000001',
       'a0000000-0000-4000-8000-000000000002') <> 4 then
    raise exception 'N1 FAILED: unread_count <> 4';
  end if;

  raise notice 'N1 PASSED: derived union (inbound + assigned + task_assigned), self-assign excluded, all unread';
end $$;

-- ===========================================================================
-- N2. Ordering is (created_at, id) DESC and the cursor pages it. Timeline of
--     the member's 4 items (self-assign at -35m excluded): task_assigned event
--     at -40m (newest), assigned event at -50m, U inbound at -60m, W inbound at
--     -120m. So the first page's newest is the task_assigned event; paging
--     p_before past it drops it, leaving 3.
-- ===========================================================================
do $$
declare first_ts timestamptz; first_id uuid; cnt_after int;
begin
  select (x->>'created_at')::timestamptz, (x->>'id')::uuid
    into first_ts, first_id
  from public.api_notifications(
    'c0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000002', 1, null, null) x;

  if first_id <> '30000000-0000-4000-8000-000000000002'::uuid then
    raise exception 'N2 FAILED: newest notification is % not the task_assigned event', first_id;
  end if;

  select count(*) into cnt_after from public.api_notifications(
    'c0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000002', 100, first_ts, first_id) x;
  if cnt_after <> 3 then
    raise exception 'N2 FAILED: cursor did not drop the first page item (got % after)', cnt_after;
  end if;

  raise notice 'N2 PASSED: DESC order + keyset cursor paginate the union';
end $$;

-- ===========================================================================
-- N3. Mark-all-read stamps the watermark to now(): every current item becomes
--     read and the bell count drops to 0. Then a NEW inbound (after the
--     watermark) is unread again.
-- ===========================================================================
do $$
declare seen timestamptz; unread_cnt int;
begin
  seen := public.api_mark_notifications_read(
    'c0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000002', now());
  if seen is distinct from now() then
    raise exception 'N3 FAILED: watermark not stamped to now(): %', seen;
  end if;

  if public.api_notifications_unread_count(
       'c0000000-0000-4000-8000-000000000001',
       'a0000000-0000-4000-8000-000000000002') <> 0 then
    raise exception 'N3 FAILED: unread_count not 0 after mark-all-read';
  end if;

  insert into public.messages (id, company_id, conversation_id, direction, body, status, created_at)
  values ('10000000-0000-4000-8000-00000000000e', 'c0000000-0000-4000-8000-000000000001',
          'f0000000-0000-4000-8000-00000000000a', 'inbound', 'Any update?', 'received',
          now() + interval '1 minute');

  select count(*) into unread_cnt from public.api_notifications(
    'c0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000002', 100, null, null) x
   where (x->>'unread')::boolean;
  if unread_cnt <> 1 then
    raise exception 'N3 FAILED: post-watermark inbound not unread (got % unread)', unread_cnt;
  end if;

  raise notice 'N3 PASSED: watermark marks all read; later items re-surface as unread';
end $$;

-- ===========================================================================
-- N4. mark-read never moves the watermark backwards (greatest() guard): a
--     stamp with an OLDER timestamp keeps the newer watermark.
-- ===========================================================================
do $$
declare seen timestamptz;
begin
  seen := public.api_mark_notifications_read(
    'c0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000002', now() - interval '1 day');
  if seen < now() - interval '1 minute' then
    raise exception 'N4 FAILED: watermark moved backwards to %', seen;
  end if;
  raise notice 'N4 PASSED: watermark is monotonic (greatest guard)';
end $$;

-- ===========================================================================
-- N5. Tenant isolation: another company sees NONE of FY Co's notifications,
--     and api_for_you returns empty sections for it.
-- ===========================================================================
do $$
declare cnt int; r jsonb;
begin
  select count(*) into cnt from public.api_notifications(
    'c0000000-0000-4000-8000-000000000099',
    'a0000000-0000-4000-8000-000000000002', 100, null, null) x;
  if cnt <> 0 then
    raise exception 'N5 FAILED: cross-company notifications leaked (got %)', cnt;
  end if;

  r := public.api_for_you('c0000000-0000-4000-8000-000000000099',
                          'a0000000-0000-4000-8000-000000000002', true, now(), 20);
  if jsonb_array_length(r->'waiting_on_you') <> 0
     or jsonb_array_length(r->'unread') <> 0
     or jsonb_array_length(r->'triage'->'conversations') <> 0 then
    raise exception 'N5 FAILED: cross-company for-you leaked: %', r;
  end if;
  raise notice 'N5 PASSED: read-models are company-scoped (tenant isolation)';
end $$;

-- ===========================================================================
-- N6 (#106). p_hidden_number_ids is a DENY list: hiding FY Co's only number
--     empties the MEMBER's queue (every conversation + task rides that number),
--     zeroes the notification feed + badge, while null (unrestricted) still
--     shows them. Proves the read-model filters, count-consistently.
-- ===========================================================================
do $$
declare
  hidden uuid[] := array['d0000000-0000-4000-8000-000000000001']::uuid[];
  r_open jsonb; r_hidden jsonb;
  feed_open int; feed_hidden int;
  badge_open bigint; badge_hidden bigint;
begin
  r_open := public.api_for_you('c0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000002', false, now(), 20, null);
  r_hidden := public.api_for_you('c0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000002', false, now(), 20, hidden);

  if jsonb_array_length(r_open->'waiting_on_you') = 0
     or jsonb_array_length(r_open->'my_tasks') = 0 then
    raise exception 'N6 FAILED: baseline (unrestricted) queue is unexpectedly empty: %', r_open;
  end if;
  if jsonb_array_length(r_hidden->'waiting_on_you') <> 0
     or jsonb_array_length(r_hidden->'unread') <> 0
     or jsonb_array_length(r_hidden->'my_tasks') <> 0 then
    raise exception 'N6 FAILED: hidden number still surfaces in for-you: %', r_hidden;
  end if;

  select count(*) into feed_open from public.api_notifications(
    'c0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000002', 100, null, null, null) x;
  select count(*) into feed_hidden from public.api_notifications(
    'c0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000002', 100, null, null, hidden) x;
  if feed_open = 0 then
    raise exception 'N6 FAILED: baseline notification feed is unexpectedly empty';
  end if;
  if feed_hidden <> 0 then
    raise exception 'N6 FAILED: hidden number still surfaces in notifications (got %)', feed_hidden;
  end if;

  badge_open := public.api_notifications_unread_count(
    'c0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000002', null);
  badge_hidden := public.api_notifications_unread_count(
    'c0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000002', hidden);
  if badge_open = 0 then
    raise exception 'N6 FAILED: baseline unread badge is unexpectedly zero';
  end if;
  if badge_hidden <> 0 then
    raise exception 'N6 FAILED: hidden number still counted in the badge (got %)', badge_hidden;
  end if;

  raise notice 'N6 PASSED: p_hidden_number_ids denies read-model rows, count-consistently';
end $$;

rollback;
