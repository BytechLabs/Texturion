-- [#440] Geocode fair share — assertion suite for
-- supabase/migrations/20260730004700_geocode_fair_share.sql.
--
-- The bug was an ORDERING: both backfills scanned oldest-first across every
-- tenant, so a workspace that imported today queued behind every other tenant's
-- backlog. A large established address book with a trickle of failures could hold
-- a brand-new workspace at the back of the line indefinitely, which is the exact
-- customer moment #440 is about.
--
--   GF-1  no company can monopolise a run
--   GF-2  every company with work pending makes progress on every run
--   GF-3  the nearly-finished company goes first
--   GF-4  the queue's predicates match what the cron actually geocodes
--   GF-5  progress counts "no address" apart from "waiting"
--   GF-6  the task queue fair-shares the same way
--
-- One transaction, rolled back. Fixtures use an 'fa' id prefix (uuids are hex, so 'gf' is not a legal prefix).

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                        created_at, updated_at, aud, role)
values ('fa000000-0000-4000-8000-000000000001', 'geo@test.local', '', now(),
        now(), now(), 'authenticated', 'authenticated')
on conflict (id) do nothing;

-- Three workspaces: BIG has a large backlog (the established tenant), SMALL is
-- nearly done, NEW just imported.
insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, plan)
values ('fa000000-0000-4000-8000-0000000000b1', 'Big Co',
        'fa000000-0000-4000-8000-000000000001', 'US', '212', now(), 'active', 'pro'),
       ('fa000000-0000-4000-8000-0000000000c1', 'Small Co',
        'fa000000-0000-4000-8000-000000000001', 'US', '213', now(), 'active', 'pro'),
       ('fa000000-0000-4000-8000-0000000000d1', 'New Co',
        'fa000000-0000-4000-8000-000000000001', 'US', '214', now(), 'active', 'pro');

-- BIG: 30 pending, and OLDEST — under the previous ordering these went first and
-- filled every run.
insert into public.contacts
  (company_id, phone_e164, address, geocode_status, created_at)
select 'fa000000-0000-4000-8000-0000000000b1',
       '+1212555' || lpad(g::text, 4, '0'),
       g || ' Big Street',
       'pending',
       now() - interval '10 days' + (g || ' seconds')::interval
  from generate_series(1, 30) g;

-- SMALL: 2 pending, newer.
insert into public.contacts
  (company_id, phone_e164, address, geocode_status, created_at)
select 'fa000000-0000-4000-8000-0000000000c1',
       '+1213555' || lpad(g::text, 4, '0'),
       g || ' Small Street',
       'pending',
       now() - interval '1 day' + (g || ' seconds')::interval
  from generate_series(1, 2) g;

-- NEW: 20 pending, NEWEST — the switcher who just imported.
insert into public.contacts
  (company_id, phone_e164, address, geocode_status, created_at)
select 'fa000000-0000-4000-8000-0000000000d1',
       '+1214555' || lpad(g::text, 4, '0'),
       g || ' New Street',
       'pending',
       now() - interval '1 minute' + (g || ' seconds')::interval
  from generate_series(1, 20) g;

-- ===========================================================================
-- GF-1. No company can monopolise a run.
--
--       This is the whole fix. With a per-company seat limit, BIG's 30 rows
--       cannot fill a 10-row run and leave NEW with nothing.
-- ===========================================================================
do $$
declare
  big_rows int;
begin
  select count(*) into big_rows
    from public.api_geocode_contact_queue(10000, 4) q
    join public.contacts c on c.id = q.id
   where c.company_id = 'fa000000-0000-4000-8000-0000000000b1';
  if big_rows > 4 then
    raise exception 'GF-1 FAILED: one company took % seats of a 4-per-company run', big_rows;
  end if;
  raise notice 'GF-1 PASSED: the per-company seat limit holds (% of 4)', big_rows;
end $$;

-- ===========================================================================
-- GF-2. Every company with work pending makes progress on every run.
--
--       The starvation test. Under the old ordering NEW appeared in zero runs
--       until BIG was exhausted; now it appears in the first one.
-- ===========================================================================
do $$
declare
  companies int;
begin
  -- Scoped to this suite's three workspaces: the queue is global by design (it
  -- feeds a system cron), and the database it runs against has other tenants.
  select count(distinct c.company_id) into companies
    from public.api_geocode_contact_queue(10000, 4) q
    join public.contacts c on c.id = q.id
   where c.company_id in (
     'fa000000-0000-4000-8000-0000000000b1',
     'fa000000-0000-4000-8000-0000000000c1',
     'fa000000-0000-4000-8000-0000000000d1'
   );
  if companies <> 3 then
    raise exception
      'GF-2 FAILED: only % of 3 workspaces got a seat in one run', companies;
  end if;
  raise notice 'GF-2 PASSED: all 3 workspaces progress on the same run';
end $$;

-- ===========================================================================
-- GF-3. The nearly-finished company goes first.
--
--       SMALL has 2 rows left, so one run finishes its Map entirely. Serving it
--       first converts a whole customer from "waiting" to "working"; BIG was
--       always going to take several runs either way.
-- ===========================================================================
do $$
declare
  first_company uuid;
begin
  -- Among THIS suite's workspaces (other tenants exist and may have fewer rows),
  -- the 2-row one must come before the 20-row and 30-row ones.
  select c.company_id into first_company
    from public.api_geocode_contact_queue(10000, 4) q
    join public.contacts c on c.id = q.id
   where c.company_id in (
     'fa000000-0000-4000-8000-0000000000b1',
     'fa000000-0000-4000-8000-0000000000c1',
     'fa000000-0000-4000-8000-0000000000d1'
   )
   limit 1;
  if first_company <> 'fa000000-0000-4000-8000-0000000000c1' then
    raise exception 'GF-3 FAILED: the fewest-pending company was not first (got %)',
      first_company;
  end if;
  raise notice 'GF-3 PASSED: the nearly-finished workspace is served first';
end $$;

-- ===========================================================================
-- GF-4. The queue selects exactly what the cron would geocode.
--
--       If the predicates drift, the cron geocodes a different set than the queue
--       reports and the Map's progress line becomes fiction. Asserted by building
--       the cron's own filter by hand and comparing counts.
-- ===========================================================================
do $$
declare
  queue_total int;
  cron_total  int;
begin
  -- A generous limit and seat count so the queue returns everything eligible.
  select count(*) into queue_total
    from public.api_geocode_contact_queue(10000, 10000);

  select count(*) into cron_total
    from public.contacts c
   where c.deleted_at is null
     and c.address is not null
     and c.geocode_status in ('pending', 'failed');

  if queue_total <> cron_total then
    raise exception
      'GF-4 FAILED: the queue sees % rows, the cron predicate sees %',
      queue_total, cron_total;
  end if;

  -- And the exclusions actually exclude: a soft-deleted row, an addressless row,
  -- and an already-located row must never appear.
  insert into public.contacts
    (company_id, phone_e164, address, geocode_status, deleted_at)
  values ('fa000000-0000-4000-8000-0000000000d1', '+12145559991',
          '1 Deleted Street', 'pending', now());
  insert into public.contacts
    (company_id, phone_e164, address, geocode_status)
  values ('fa000000-0000-4000-8000-0000000000d1', '+12145559992', null, 'no_address'),
         ('fa000000-0000-4000-8000-0000000000d1', '+12145559993',
          '2 Done Street', 'ok');

  if (select count(*) from public.api_geocode_contact_queue(10000, 10000))
     <> queue_total then
    raise exception
      'GF-4 FAILED: a deleted, addressless, or already-located row entered the queue';
  end if;

  raise notice 'GF-4 PASSED: the queue and the cron agree on % rows', queue_total;
end $$;

-- ===========================================================================
-- GF-5. Progress counts "no address" APART from "waiting".
--
--       Folding them together would make a "1,240 of 2,000" that never reaches
--       its total, which is worse than no number: it looks permanently stuck.
-- ===========================================================================
do $$
declare
  progress jsonb;
begin
  progress := public.api_geocode_progress('fa000000-0000-4000-8000-0000000000d1');

  -- NEW has 20 pending, 1 located ('ok'), 1 with no address. The soft-deleted row
  -- counts nowhere.
  if (progress ->> 'contacts_pending')::int <> 20 then
    raise exception 'GF-5 FAILED: pending = % (want 20)', progress ->> 'contacts_pending';
  end if;
  if (progress ->> 'contacts_located')::int <> 1 then
    raise exception 'GF-5 FAILED: located = % (want 1)', progress ->> 'contacts_located';
  end if;
  if (progress ->> 'contacts_without_address')::int <> 1 then
    raise exception 'GF-5 FAILED: without_address = % (want 1)',
      progress ->> 'contacts_without_address';
  end if;

  -- Tenant-scoped: BIG's 30 must not appear in NEW's progress.
  if (progress ->> 'contacts_pending')::int > 20 then
    raise exception 'GF-5 FAILED: progress leaked another workspace''s rows';
  end if;

  raise notice 'GF-5 PASSED: located / pending / no-address counted separately, per tenant';
end $$;

-- ===========================================================================
-- GF-6. The task queue fair-shares the same way (#440 ask 5).
-- ===========================================================================
do $$
declare
  companies int;
  per_company int;
  co uuid;
  num uuid;
  ct uuid;
  conv uuid;
  msg uuid;
  idx int := 0;
begin
  -- tasks requires message_id/conversation_id/description/created_by_user_id, so
  -- each company needs the full chain before a task can exist.
  for co in select unnest(array[
    'fa000000-0000-4000-8000-0000000000b1'::uuid,
    'fa000000-0000-4000-8000-0000000000d1'::uuid
  ]) loop
    -- A counter, not a slice of the uuid: both fixture uuids end in the same
    -- character, so deriving the number from them collided on e164 uniqueness.
    idx := idx + 1;
    insert into public.phone_numbers
      (company_id, number_e164, status, provisioning_key, country)
    values (co, '+121555510' || idx::text, 'active', 'gf-key-' || idx::text, 'US')
    returning id into num;

    insert into public.contacts (company_id, phone_e164)
    values (co, '+121655520' || idx::text)
    returning id into ct;

    insert into public.conversations
      (company_id, contact_id, phone_number_id, status, last_message_at)
    values (co, ct, num, 'open', now())
    returning id into conv;

    insert into public.messages
      (company_id, conversation_id, direction, body, status)
    values (co, conv, 'inbound', 'task source', 'received')
    returning id into msg;

    -- tasks_message_uq is one task per message, so each task needs its own
    -- message. One conversation carries them all.
    with made as (
      insert into public.messages
        (company_id, conversation_id, direction, body, status)
      select co, conv, 'inbound', 'task source ' || g, 'received'
        from generate_series(1, case when co::text like '%b1' then 25 else 8 end) g
      returning id
    )
    insert into public.tasks
      (company_id, message_id, conversation_id, title, description,
       created_by_user_id, addr_street, geocode_status, created_at)
    select co, made.id, conv,
           'Task ' || row_number() over (order by made.id), '',
           'fa000000-0000-4000-8000-000000000001',
           row_number() over (order by made.id) || ' Street', 'pending',
           case when co::text like '%b1' then now() - interval '10 days' else now() end
      from made;
  end loop;

  -- No address at all: never queued, whatever its status says.
  insert into public.tasks
    (company_id, message_id, conversation_id, title, description,
     created_by_user_id, geocode_status)
  values ('fa000000-0000-4000-8000-0000000000d1', msg, conv, 'No address', '',
          'fa000000-0000-4000-8000-000000000001', 'pending');

  select count(distinct t.company_id),
         max(seats.n)
    into companies, per_company
    from public.api_geocode_task_queue(10000, 4) q
    join public.tasks t on t.id = q.id
    join (
      select t2.company_id, count(*) as n
        from public.api_geocode_task_queue(10000, 4) q2
        join public.tasks t2 on t2.id = q2.id
       group by t2.company_id
    ) seats on seats.company_id = t.company_id;

  if companies < 2 then
    raise exception 'GF-6 FAILED: % of 2 workspaces got task seats', companies;
  end if;
  if per_company > 4 then
    raise exception 'GF-6 FAILED: one workspace took % task seats (cap 4)', per_company;
  end if;
  if exists (
    select 1 from public.api_geocode_task_queue(10000, 10000) q
    join public.tasks t on t.id = q.id
    where t.title = 'No address'
  ) then
    raise exception 'GF-6 FAILED: a task with no address entered the queue';
  end if;

  raise notice 'GF-6 PASSED: task queue fair-shares and skips addressless rows';
end $$;

select 'geocode_fair_share.test.sql: GF-1..GF-6 PASSED' as result;

rollback;
