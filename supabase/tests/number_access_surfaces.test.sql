-- ===========================================================================
-- #368 — number access is enforced by N independent SQL implementations, and
-- RLS can never catch a mistake in any of them.
--
-- #347 argues the same shape for COMPANY scoping, where RLS is at least a
-- theoretical backstop that the Worker's `sb_secret_` key bypasses. Number
-- access is WITHIN a company: no row-level policy keyed on tenancy could ever
-- express it. It is application logic all the way down, in one place per read
-- surface, and a divergence in any one of them is one customer's business
-- seeing another line's conversations inside the same workspace.
--
-- The failure is SILENT IN ONE DIRECTION. A too-permissive filter shows data
-- and nobody notices; a too-restrictive one hides data and somebody
-- complains. Only the harmless direction generates a report.
--
-- SO THIS FILE IS THE MECHANISM, not another assertion. NA-1 derives the list
-- of read surfaces from `pg_proc` and compares it to a roster maintained here.
-- Adding an eighth surface without an access assertion FAILS CI, which is
-- #368's acceptance criterion and the thing seven careful implementations
-- cannot give you.
--
-- WHAT THE ROSTER ALREADY CAUGHT, on the day it was written: #368's own list
-- of seven functions was wrong in both directions. It named
-- `api_period_forward_seconds`, which does not take the parameter at all, and
-- it omitted `api_spam_review`, which does. An unlisted eighth surface already
-- existed. That is precisely the outcome the issue predicted — "if the test
-- proves hard to write because there is no list of read surfaces, that absence
-- is itself the finding".
-- ===========================================================================

\set ON_ERROR_STOP on

begin;

-- ===========================================================================
-- NA-1. THE ROSTER. Every `public` function taking `p_hidden_number_ids` must
--       appear here, and every entry here must still exist.
--
--       Both directions matter. An unrostered function is a read surface
--       nobody asserted. A stale entry is a surface somebody deleted, and
--       leaving it would let the next real deletion hide behind it.
-- ===========================================================================
do $$
declare
  roster text[] := array[
    'api_for_you',
    'api_list_calls',
    'api_list_conversations',
    'api_notifications',
    'api_notifications_unread_count',
    -- #581: the response-time report. It NAMES phone numbers, which is what
    -- makes it worth more than a row count: a restricted member saw a denied
    -- line's E.164 together with its lead and unanswered totals. Every sibling
    -- read surface filtered and this one did not.
    'api_response_time_stats',
    'api_search_v2',
    -- Not in #368's list. It takes the parameter and filters on it correctly;
    -- it was simply missing from the enumeration the issue was written from.
    'api_spam_review',
    -- #689: a task's history and comments. A task on a denied number is not
    -- found, so its comments and field changes never reach the member.
    'api_task_activity',
    -- #714: one timeline for a contact, task, conversation or call. A record on
    -- a denied number is not found, and a contact's timeline drops the texts
    -- and calls that happened on a denied number.
    'api_record_activity',
    -- #690: a task's relations, what a thread or contact links to, and the two
    -- writes. A hidden task must not be linked to, listed or confirmed.
    'api_linked_tasks',
    'api_resolve_references',
    'api_set_task_link',
    'api_sync_references',
    'api_task_links',
    -- #275: the bulk WRITE surface, and the only one on this roster that is not
    -- a read. It belongs here for a stronger reason than the reads do: a missing
    -- filter on a read leaks rows, and a missing filter here MODIFIES them —
    -- three hundred at a time, on numbers the actor was denied. NA-5 asserts it.
    'api_bulk_conversations',
    -- #478: the second bulk WRITE surface, here for the same reason as the
    -- first. It marks tasks done, assigns and deletes them in batches, and a
    -- missing filter would do that to tasks on numbers the actor was denied.
    -- NA-6 asserts it.
    'api_bulk_tasks',
    -- #691: the Trash. A member holding records.delete who is denied a number
    -- must not list, trash, restore or erase anything on it. The writes belong
    -- here for the reason the bulk ones do: a missing filter changes or destroys
    -- a row the actor was never allowed to see. NA-7 asserts all of them.
    'api_list_trash',
    'api_purge_trash_item',
    'api_restore_trash',
    'api_trash_call',
    'api_trash_conversations',
    'api_trash_message',
    'api_trash_object_paths',
    -- The shared definition behind api_notifications + its badge (#359, the
    -- one-notification-definition refactor). It is not called directly by any
    -- route — both notification surfaces read THROUGH it — which is exactly
    -- why it belongs here: a filter regression in this one function would show
    -- up in the list and the badge at once.
    'notification_feed'
  ];
  actual text[];
  unrostered text;
  stale text;
begin
  select coalesce(array_agg(distinct p.proname order by p.proname), '{}')
    into actual
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and pg_get_function_arguments(p.oid) like '%p_hidden_number_ids%';

  select string_agg(name, ', ') into unrostered
    from unnest(actual) name
   where name <> all(roster);
  if unrostered is not null then
    raise exception
      'NA-1 FAILED: read surface(s) filter on number access but are not '
      'rostered here, so nothing asserts they do it correctly: %. '
      'Add the function to the roster AND give it an assertion below.',
      unrostered;
  end if;

  select string_agg(name, ', ') into stale
    from unnest(roster) name
   where name <> all(actual);
  if stale is not null then
    raise exception
      'NA-1 FAILED: rostered function(s) no longer take p_hidden_number_ids: %. '
      'Either the filter was dropped from a live read surface, or the roster '
      'is stale and is now hiding the next real removal.',
      stale;
  end if;
end $$;

-- ===========================================================================
-- NA-2. Accepting the parameter is not the same as USING it.
--
--       A function that takes `p_hidden_number_ids` for signature consistency
--       and never references it in its body is the exact silent divergence
--       this issue is about: it looks filtered from every call site, and
--       returns everything. The roster above cannot see that; this can.
-- ===========================================================================
do $$
declare
  ignoring text;
begin
  select string_agg(p.proname, ', ') into ignoring
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and pg_get_function_arguments(p.oid) like '%p_hidden_number_ids%'
     -- One mention is the declaration itself; a function that USES the
     -- parameter mentions it at least twice.
     and (length(pg_get_functiondef(p.oid))
          - length(replace(pg_get_functiondef(p.oid), 'p_hidden_number_ids', '')))
         / length('p_hidden_number_ids') < 2;
  if ignoring is not null then
    raise exception
      'NA-2 FAILED: function(s) accept p_hidden_number_ids and never use it, '
      'so every caller believes the read is filtered and it is not: %',
      ignoring;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures for the behavioural assertions: one company, two numbers, and a
-- row of every shape on EACH of them. The member is denied the second number.
-- ---------------------------------------------------------------------------
\set co   '\'36800000-0000-4000-8000-000000000001\''
\set usr  '\'36800000-0000-4000-8000-000000000002\''
\set nvis '\'36800000-0000-4000-8000-000000000010\''
\set nhid '\'36800000-0000-4000-8000-000000000011\''
\set cvis '\'36800000-0000-4000-8000-000000000020\''
\set chid '\'36800000-0000-4000-8000-000000000021\''
\set vvis '\'36800000-0000-4000-8000-000000000030\''
\set vhid '\'36800000-0000-4000-8000-000000000031\''

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                        created_at, updated_at, aud, role)
values (:usr, 'na@test.local', '', now(), now(), now(), 'authenticated',
        'authenticated')
on conflict (id) do nothing;

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, plan)
values (:co, 'Number Access Co', :usr, 'US', '212', now(), 'active', 'pro');

insert into public.company_members (company_id, user_id, role)
values (:co, :usr, 'owner');

insert into public.phone_numbers
  (id, company_id, provisioning_key, country, number_e164, status)
values (:nvis, :co, 'na-vis', 'US', '+12125550001', 'active'),
       (:nhid, :co, 'na-hid', 'US', '+12125550002', 'active');

insert into public.contacts (id, company_id, phone_e164, name)
values (:cvis, :co, '+12125559001', 'Visible Customer'),
       (:chid, :co, '+12125559002', 'Hidden Customer');

-- ASSIGNED to the member on purpose: notification_feed's inbound arm only
-- returns a conversation assigned to the reader, so an unassigned fixture made
-- every notification surface return zero rows — which passes a "denying never
-- ADDS" assertion while asserting nothing at all, the exact fake this file's
-- header warns about. With both lines assigned, the feed returns one row per
-- number and the filter is genuinely exercised.
insert into public.conversations
  (id, company_id, contact_id, phone_number_id, status, last_message_at,
   assigned_user_id)
values (:vvis, :co, :cvis, :nvis, 'open', now(), :usr),
       (:vhid, :co, :chid, :nhid, 'open', now(), :usr);

insert into public.messages
  (company_id, conversation_id, direction, body, status, created_at)
values (:co, :vvis, 'inbound', 'visible line needs a quote', 'received', now()),
       (:co, :vhid, 'inbound', 'hidden line needs a quote', 'received', now());

-- #478: a task on EACH line, so NA-6 has something to refuse. A task hangs off
-- its source message, and completion is derived from that message's done_at
-- (T2), so the pair has to exist for the bulk surface to have anything to flip.
insert into public.tasks
  (company_id, conversation_id, message_id, title, created_by_user_id)
select :co, m.conversation_id, m.id,
       'follow up on ' || m.conversation_id::text, :usr
  from public.messages m
 where m.company_id = :co
   and m.conversation_id in (:vvis, :vhid);

insert into public.call_records
  (company_id, phone_number_id, call_leg_id, leg, caller_e164, billable_seconds)
values (:co, :nvis, 'na-leg-vis', 'inbound', '+12125559001', 30),
       (:co, :nhid, 'na-leg-hid', 'inbound', '+12125559002', 30);

-- ===========================================================================
-- NA-3. Every rostered surface returns NOTHING from a denied number, and
--       something from an allowed one.
--
--       The second half is what makes the first half mean anything: a filter
--       that returns nothing at all would pass a deny-only assertion while
--       being completely broken, and #368 notes that the over-restrictive
--       direction is the one somebody complains about — which is to say, the
--       one a test is least needed for and most easily faked.
-- ===========================================================================
do $$
declare
  hidden uuid[] := array['36800000-0000-4000-8000-000000000011']::uuid[];
  co uuid := '36800000-0000-4000-8000-000000000001';
  usr uuid := '36800000-0000-4000-8000-000000000002';
  open_n int; hidden_n int;
begin
  -- api_list_conversations
  select jsonb_array_length(public.api_list_conversations(co, usr, 50)->'items')
    into open_n;
  select jsonb_array_length(
           public.api_list_conversations(co, usr, 50, null, null, null, false,
                                         false, null, null, null, null, hidden)
           ->'items')
    into hidden_n;
  if open_n < 2 then
    raise exception 'NA-3 FAILED: baseline conversations = % (want both)', open_n;
  end if;
  if hidden_n is distinct from open_n - 1 then
    raise exception
      'NA-3 FAILED: api_list_conversations returned % rows with a number denied '
      '(want % — exactly the hidden line removed)', hidden_n, open_n - 1;
  end if;

  -- api_list_calls
  select jsonb_array_length(public.api_list_calls(co, 50)->'items') into open_n;
  select jsonb_array_length(
           public.api_list_calls(co, 50, null, null, null, hidden)->'items')
    into hidden_n;
  if open_n < 2 then
    raise exception 'NA-3 FAILED: baseline calls = % (want both)', open_n;
  end if;
  if hidden_n is distinct from open_n - 1 then
    raise exception
      'NA-3 FAILED: api_list_calls returned % rows with a number denied (want %)',
      hidden_n, open_n - 1;
  end if;

  -- api_search_v2 — the surface #290 is about to add an arm to.
  select jsonb_array_length(
           public.api_search_v2(co, 'quote', 20, 20, 20, 20, 20)
           ->'conversations')
    into open_n;
  select jsonb_array_length(
           public.api_search_v2(co, 'quote', 20, 20, 20, 20, 20, null, null,
                                hidden)
           ->'conversations')
    into hidden_n;
  if open_n < 2 then
    raise exception 'NA-3 FAILED: baseline search hits = % (want both)', open_n;
  end if;
  if hidden_n is distinct from open_n - 1 then
    raise exception
      'NA-3 FAILED: api_search_v2 returned % conversation hits with a number '
      'denied (want %)', hidden_n, open_n - 1;
  end if;

  -- api_notifications + its badge, which must agree with each other (#359).
  select count(*) into open_n
    from public.api_notifications(co, usr, 50);
  select count(*) into hidden_n
    from public.api_notifications(co, usr, 50, null, null, hidden);
  if hidden_n > open_n then
    raise exception 'NA-3 FAILED: denying a number ADDED notifications';
  end if;
  if public.api_notifications_unread_count(co, usr, hidden)
     > public.api_notifications_unread_count(co, usr) then
    raise exception 'NA-3 FAILED: denying a number RAISED the unread badge';
  end if;

  -- notification_feed — the shared definition both surfaces above read
  -- through. Asserted in its own right so a filter regression is attributed to
  -- the one function rather than blamed on two callers (#359).
  select count(*) into open_n
    from public.notification_feed(co, usr);
  select count(*) into hidden_n
    from public.notification_feed(co, usr, hidden);
  if hidden_n > open_n then
    raise exception 'NA-3 FAILED: denying a number ADDED notification_feed rows';
  end if;
  if hidden_n = open_n then
    raise exception
      'NA-3 FAILED: denying a number changed nothing in notification_feed, so '
      'the fixture no longer exercises the filter';
  end if;

  -- api_task_activity: the hidden line's task is not found, the visible one is.
  if public.api_task_activity(co,
       (select id from public.tasks
         where conversation_id = '36800000-0000-4000-8000-000000000031'),
       hidden)->>'outcome' is distinct from 'not_found' then
    raise exception 'NA-3 FAILED: api_task_activity read a task on a denied number';
  end if;
  if public.api_task_activity(co,
       (select id from public.tasks
         where conversation_id = '36800000-0000-4000-8000-000000000031'))
       ->>'outcome' is distinct from 'ok' then
    raise exception 'NA-3 FAILED: api_task_activity hid a task with no number denied';
  end if;
  if public.api_task_activity(co,
       (select id from public.tasks
         where conversation_id = '36800000-0000-4000-8000-000000000030'),
       hidden)->>'outcome' is distinct from 'ok' then
    raise exception 'NA-3 FAILED: api_task_activity hid a task on an allowed number';
  end if;

  -- #714: api_record_activity. The denied line's conversation is not found,
  -- the allowed one is, and the hidden customer's timeline keeps the contact
  -- but drops the text that came in on the denied line.
  if public.api_record_activity(co, 'conversation',
       '36800000-0000-4000-8000-000000000031', hidden)->>'outcome'
       is distinct from 'not_found' then
    raise exception 'NA-3 FAILED: api_record_activity read a conversation on a denied number';
  end if;
  if public.api_record_activity(co, 'conversation',
       '36800000-0000-4000-8000-000000000030', hidden)->>'outcome'
       is distinct from 'ok' then
    raise exception 'NA-3 FAILED: api_record_activity hid a conversation on an allowed number';
  end if;
  select count(*) into open_n
    from jsonb_array_elements(public.api_record_activity(co, 'contact',
           '36800000-0000-4000-8000-000000000021')->'items') i
   where i->>'conversation_id' = '36800000-0000-4000-8000-000000000031';
  select count(*) into hidden_n
    from jsonb_array_elements(public.api_record_activity(co, 'contact',
           '36800000-0000-4000-8000-000000000021', hidden)->'items') i
   where i->>'conversation_id' = '36800000-0000-4000-8000-000000000031';
  if open_n < 1 then
    raise exception 'NA-3 FAILED: baseline contact timeline has no text from the hidden line';
  end if;
  if hidden_n is distinct from 0 then
    raise exception
      'NA-3 FAILED: api_record_activity showed % rows from a denied number on a contact timeline',
      hidden_n;
  end if;

  -- #690: the relation, reference and linked-task surfaces. Called first with
  -- the denied list, read after.
  if public.api_task_links(co,
       (select id from public.tasks
         where conversation_id = '36800000-0000-4000-8000-000000000031'),
       hidden)->>'outcome' is distinct from 'not_found' then
    raise exception 'NA-3 FAILED: api_task_links read a task on a denied number';
  end if;
  if public.api_linked_tasks(co, 'conversation',
       '36800000-0000-4000-8000-000000000031', hidden)->>'outcome'
       is distinct from 'not_found' then
    raise exception 'NA-3 FAILED: api_linked_tasks listed a denied conversation';
  end if;
  if public.api_set_task_link(co,
       (select id from public.tasks
         where conversation_id = '36800000-0000-4000-8000-000000000031'),
       (select id from public.tasks
         where conversation_id = '36800000-0000-4000-8000-000000000030'),
       'blocks', true, usr, hidden)->>'outcome' is distinct from 'not_found' then
    raise exception 'NA-3 FAILED: api_set_task_link linked a task on a denied number';
  end if;
  if jsonb_array_length(public.api_sync_references(co, 'task_description',
       (select id from public.tasks
         where conversation_id = '36800000-0000-4000-8000-000000000030'),
       '#T-' || (select number from public.tasks
                  where conversation_id = '36800000-0000-4000-8000-000000000031'),
       usr, hidden)->'references') is distinct from 0 then
    raise exception 'NA-3 FAILED: api_sync_references confirmed a task on a denied number';
  end if;

  if jsonb_array_length(public.api_resolve_references(co, array[(select number from public.tasks
         where conversation_id = '36800000-0000-4000-8000-000000000031')],
       null, null, hidden)->'tasks') is distinct from 0 then
    raise exception 'NA-3 FAILED: api_resolve_references resolved a task on a denied number';
  end if;
  if jsonb_array_length(public.api_resolve_references(co, array[(select number from public.tasks
         where conversation_id = '36800000-0000-4000-8000-000000000031')])->'tasks') is distinct from 1 then
    raise exception 'NA-3 FAILED: api_resolve_references hid a task from an unrestricted caller';
  end if;

  -- api_for_you
  if jsonb_array_length(
       public.api_for_you(co, usr, now(), 20, hidden)->'unread')
     > jsonb_array_length(
       public.api_for_you(co, usr, now(), 20)->'unread') then
    raise exception 'NA-3 FAILED: denying a number ADDED for-you rows';
  end if;
end $$;

-- ===========================================================================
-- NA-4. The spam review strip, which #368 did not know was a read surface.
--
--       It matters for the reason the function's own comment gives: a
--       restricted member must not learn that a hidden number's conversations
--       EXIST. A review strip that lists them leaks the fact of the
--       conversation even though it never shows the thread.
-- ===========================================================================
do $$
declare
  hidden uuid[] := array['36800000-0000-4000-8000-000000000011']::uuid[];
  co uuid := '36800000-0000-4000-8000-000000000001';
  r jsonb;
begin
  update public.conversations set is_spam = true
   where id = '36800000-0000-4000-8000-000000000031';
  insert into public.conversation_events (company_id, conversation_id, type)
  values (co, '36800000-0000-4000-8000-000000000031', 'spam_marked');

  r := public.api_spam_review(co, 20, hidden, 0, 0);
  if jsonb_array_length(coalesce(r->'items', '[]'::jsonb)) is distinct from 0 then
    raise exception
      'NA-4 FAILED: the spam review strip surfaced a denied number: %', r;
  end if;
end $$;

\echo 'number_access_surfaces.test.sql: NA-1..NA-4 PASSED'


-- ===========================================================================
-- NA-5 [#275]. The bulk WRITE surface: a denied number is not merely hidden
--       from it, it is UNREACHABLE BY IT.
--
--       Every other entry on this roster is a read, where a missing filter leaks
--       rows. This one writes, so a missing filter changes rows the actor was
--       denied — and at bulk scale, three hundred of them before anybody notices.
--       Asserted in both selection modes, because they resolve the selection
--       differently: the filter mode enumerates, the id mode intersects.
-- ===========================================================================
do $$
declare
  hidden uuid[] := array['36800000-0000-4000-8000-000000000011']::uuid[];
  co   uuid := '36800000-0000-4000-8000-000000000001';
  usr  uuid := '36800000-0000-4000-8000-000000000002';
  res  jsonb;
  n_open int; n_denied int;
begin
  -- These blocks share one transaction, and NA-4 marks the hidden line's
  -- conversation as spam — which the default filter excludes on its own, making
  -- the comparison below vacuous for the wrong reason. So this block establishes
  -- the state it asserts on rather than inheriting NA-4's.
  update public.conversations set is_spam = false where company_id = co;

  -- Filter mode: denying a number must reach strictly FEWER rows than the
  -- unrestricted call — the fixture has one conversation on each number.
  n_open := jsonb_array_length(
    public.api_bulk_conversations(co, usr, 'mark_read') -> 'applied');
  n_denied := jsonb_array_length(
    public.api_bulk_conversations(
      co, usr, 'mark_read', null, null, null, null, false, false, null,
      null, null, null, null, hidden) -> 'applied');
  -- The unrestricted call must reach SOMETHING, or the comparison below is
  -- vacuous — the exact trap NA-3's header warns about: a surface that returns
  -- nothing at all passes every deny-only assertion while being broken.
  if n_open = 0 then
    raise exception 'NA-5 FAILED: the unrestricted bulk call reached 0 rows, so '
      'the deny assertion proves nothing';
  end if;
  if n_denied >= n_open then
    raise exception
      'NA-5 FAILED: denying a number did not reduce what the bulk action reached '
      '(% denied vs % open)', n_denied, n_open;
  end if;

  -- Id mode: naming a conversation on a denied number must apply nothing and
  -- report it as unreached, rather than honouring it because it was asked for.
  res := public.api_bulk_conversations(
    co, usr, 'mark_read',
    (select array_agg(c.id) from public.conversations c
      where c.company_id = co
        and c.phone_number_id = '36800000-0000-4000-8000-000000000011'),
    null, null, null, false, false, null, null, null, null, null, hidden);
  if jsonb_array_length(res -> 'applied') is distinct from 0 then
    raise exception 'NA-5 FAILED: a named conversation on a denied number was written';
  end if;

  raise notice 'NA-5 PASSED: the bulk write surface cannot reach a denied number';
end $$;

-- ===========================================================================
-- NA-6 [#478] api_bulk_tasks — the same rule, for the other bulk write.
--
-- Tasks hang off a conversation, and a conversation has a number. So a task on
-- a denied number is a task the actor cannot see, and a bulk action must not
-- reach it — with the same consequence NA-5 names: a missing filter here does
-- not leak a row, it MODIFIES one, five hundred at a time.
--
-- Named-id mode only, deliberately. Unlike the conversations function, this one
-- takes no filters: the Worker resolves ids with the list's own query builder
-- and hands them over, so the only way a denied task can arrive is by being
-- named. That is exactly the case asserted here.
-- ===========================================================================
do $$
declare
  co     uuid := '36800000-0000-4000-8000-000000000001';
  usr    uuid := '36800000-0000-4000-8000-000000000002';
  hidden uuid[] := array['36800000-0000-4000-8000-000000000011']::uuid[];
  denied_task uuid;
  res    jsonb;
begin
  select t.id into denied_task
    from public.tasks t
    join public.conversations c on c.id = t.conversation_id
   where t.company_id = co
     and c.phone_number_id = '36800000-0000-4000-8000-000000000011'
   limit 1;

  -- Guard the guard: with no task on the denied number this assertion would
  -- pass by having nothing to refuse, which is the vacuous-pass trap NA-3's
  -- header warns about.
  if denied_task is null then
    raise exception 'NA-6 FAILED: no task exists on the denied number, so the '
      'refusal below would prove nothing';
  end if;

  -- Unrestricted first, so the refusal is measured against a call that works.
  res := public.api_bulk_tasks(co, usr, 'mark_done', array[denied_task], null, null);
  if jsonb_array_length(res -> 'applied') is distinct from 1 then
    raise exception 'NA-6 FAILED: the unrestricted bulk call reached 0 tasks, so '
      'the deny assertion proves nothing';
  end if;

  -- Undo it, so the deny run below is testing the filter and not idempotence.
  res := public.api_bulk_tasks(co, usr, 'mark_undone', array[denied_task], null, null);

  -- Denied: applied nothing, and SAID so rather than silently dropping it.
  res := public.api_bulk_tasks(co, usr, 'mark_done', array[denied_task], null, hidden);
  if jsonb_array_length(res -> 'applied') is distinct from 0 then
    raise exception 'NA-6 FAILED: a named task on a denied number was written';
  end if;
  if jsonb_array_length(res -> 'failed') is distinct from 1 then
    raise exception 'NA-6 FAILED: the denied task was dropped silently rather '
      'than reported — the caller would render a count that never happened';
  end if;

  raise notice 'NA-6 PASSED: the task bulk write cannot reach a denied number';
end $$;

-- ===========================================================================
-- NA-7 [#691] The Trash: list, trash, restore, object paths and purge.
--
-- The list and the object paths are reads; trash, restore and purge are writes,
-- and the last one destroys. Each is asserted against a denied item (refused,
-- row unchanged) and an allowed one (works), so a filter that refuses everything
-- cannot pass for a correct one. The block undoes itself: it raises a private
-- error at the end and the enclosing sub-transaction rolls back.
-- ===========================================================================
do $$
declare
  co     uuid := '36800000-0000-4000-8000-000000000001';
  usr    uuid := '36800000-0000-4000-8000-000000000002';
  hidden uuid[] := array['36800000-0000-4000-8000-000000000011']::uuid[];
  vvis   uuid := '36800000-0000-4000-8000-000000000030';
  vhid   uuid := '36800000-0000-4000-8000-000000000031';
  call_v uuid := '36800000-0000-4000-8000-0000000000c1';
  call_h uuid := '36800000-0000-4000-8000-0000000000c2';
  msg_v  uuid;
  msg_h  uuid;
  r      jsonb;
begin
  select m.id into msg_v from public.messages m where m.conversation_id = vvis limit 1;
  select m.id into msg_h from public.messages m where m.conversation_id = vhid limit 1;
  insert into public.calls
    (id, company_id, phone_number_id, call_session_id, caller_e164, outcome,
     voicemail_path, voicemail_transcript)
  values (call_v, co, '36800000-0000-4000-8000-000000000010', 'na7-vis',
          '+12125559001', 'voicemail', 'na7/vis.mp3', 'visible words'),
         (call_h, co, '36800000-0000-4000-8000-000000000011', 'na7-hid',
          '+12125559002', 'voicemail', 'na7/hid.mp3', 'hidden words');

  begin
    -- Trash a message: the denied one is refused and untouched, the allowed works.
    r := public.api_trash_message(co, usr, msg_h, hidden);
    if r ->> 'outcome' is distinct from 'not_found'
       or (select deleted_at from public.messages where id = msg_h) is not null then
      raise exception 'NA-7 FAILED: a message on a denied number was trashed';
    end if;
    if public.api_trash_message(co, usr, msg_v, hidden) ->> 'outcome' is distinct from 'trashed' then
      raise exception 'NA-7 FAILED: a message on an allowed number could not be trashed';
    end if;

    -- Trash a call: same.
    r := public.api_trash_call(co, usr, call_h, false, hidden);
    if r ->> 'outcome' is distinct from 'not_found'
       or (select deleted_at from public.calls where id = call_h) is not null then
      raise exception 'NA-7 FAILED: a call on a denied number was trashed';
    end if;
    if public.api_trash_call(co, usr, call_v, false, hidden) ->> 'outcome' is distinct from 'trashed' then
      raise exception 'NA-7 FAILED: a call on an allowed number could not be trashed';
    end if;

    -- Put the denied items in the Trash as an unrestricted actor, so the list,
    -- restore and purge have something to refuse.
    perform public.api_trash_message(co, usr, msg_h);
    perform public.api_trash_call(co, usr, call_h, false);

    -- The list (a read): denied absent, allowed present, and the unrestricted
    -- list shows both, so absence is the filter and not an empty fixture.
    if not exists (select 1 from public.api_list_trash(co, 50, null, null, hidden) t
                    where t ->> 'id' = msg_v::text)
       or not exists (select 1 from public.api_list_trash(co, 50, null, null, hidden) t
                       where t ->> 'id' = call_v::text) then
      raise exception 'NA-7 FAILED: the Trash list hid items on an allowed number';
    end if;
    if exists (select 1 from public.api_list_trash(co, 50, null, null, hidden) t
                where t ->> 'id' in (msg_h::text, call_h::text)) then
      raise exception 'NA-7 FAILED: the Trash list showed an item on a denied number';
    end if;
    if (select count(*) from public.api_list_trash(co, 50) t
         where t ->> 'id' in (msg_h::text, call_h::text)) is distinct from 2 then
      raise exception 'NA-7 FAILED: the unrestricted Trash list lacks the denied items';
    end if;

    -- Restore: refused on the denied item, works on the allowed one.
    r := public.api_restore_trash(co, usr, 'message', msg_h, hidden);
    if r ->> 'outcome' is distinct from 'not_found'
       or (select deleted_at from public.messages where id = msg_h) is null then
      raise exception 'NA-7 FAILED: a message on a denied number was restored';
    end if;
    r := public.api_restore_trash(co, usr, 'call', call_h, hidden);
    if r ->> 'outcome' is distinct from 'not_found'
       or (select deleted_at from public.calls where id = call_h) is null then
      raise exception 'NA-7 FAILED: a call on a denied number was restored';
    end if;
    if public.api_restore_trash(co, usr, 'message', msg_v, hidden) ->> 'outcome' is distinct from 'restored' then
      raise exception 'NA-7 FAILED: a message on an allowed number could not be restored';
    end if;

    -- Object paths (a read): nothing for the denied call, its audio for the allowed one.
    if exists (select 1 from public.api_trash_object_paths('call', call_h, co, hidden)) then
      raise exception 'NA-7 FAILED: object paths named a denied number''s voicemail';
    end if;
    if not exists (select 1 from public.api_trash_object_paths('call', call_v, co, hidden) p
                    where p.path = 'na7/vis.mp3') then
      raise exception 'NA-7 FAILED: object paths hid an allowed number''s voicemail';
    end if;

    -- Purge: refused on the denied item with the row unchanged, works on the allowed one.
    if public.api_purge_trash_item('call', call_h, usr, co, hidden) ->> 'outcome' is distinct from 'not_found' then
      raise exception 'NA-7 FAILED: a call on a denied number was purged';
    end if;
    if exists (select 1 from public.calls
                where id = call_h
                  and (purged_at is not null or voicemail_path is null
                       or voicemail_transcript is null)) then
      raise exception 'NA-7 FAILED: the refused purge still changed the denied call';
    end if;
    -- Purge first, then read: one statement would read the row as it was before.
    r := public.api_purge_trash_item('call', call_v, usr, co, hidden);
    if r ->> 'outcome' is distinct from 'purged'
       or (select voicemail_path from public.calls where id = call_v) is not null then
      raise exception 'NA-7 FAILED: a call on an allowed number could not be purged';
    end if;

    -- Trash a conversation: the denied one is untouched, the allowed one goes.
    r := public.api_trash_conversations(co, usr, array[vhid], hidden);
    if r -> 'trashed' is distinct from '[]'::jsonb
       or (select deleted_at from public.conversations where id = vhid) is not null then
      raise exception 'NA-7 FAILED: a conversation on a denied number was trashed';
    end if;
    r := public.api_trash_conversations(co, usr, array[vvis], hidden);
    if r -> 'trashed' is distinct from to_jsonb(array[vvis]) then
      raise exception 'NA-7 FAILED: a conversation on an allowed number could not be trashed';
    end if;

    raise exception 'NA7-UNDO';
  exception when raise_exception then
    if sqlerrm is distinct from 'NA7-UNDO' then
      raise;
    end if;
  end;

  raise notice 'NA-7 PASSED: the Trash cannot list, trash, restore or erase a denied number''s items';
end $$;

rollback;
