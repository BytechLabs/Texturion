-- #251 — a workspace big enough for a query to be wrong about.
--
-- The issue's own words: "Empty-table benchmarks measure nothing." Every
-- performance question this repo has is about index behaviour on realistic
-- volume, and Postgres will happily sequential-scan 200 rows faster than it
-- uses an index on them. A plan measured on a seeded 40-row dev workspace tells
-- you nothing about the workspace we are trying to sell to.
--
-- WHAT IT BUILDS. One company at the size the issue names as the thing a CEO
-- needs an answer about before selling to a 50-tech operation:
--
--   50,000 conversations
--   200,000 messages          (four per thread, which is the shape real
--                              threads have: a question, an answer, a
--                              follow-up, a confirmation)
--   50,000 contacts
--   20 members
--
-- SET-BASED, not row-by-row. `generate_series` builds the whole thing in a
-- handful of statements: a loop inserting 200k rows one at a time would take
-- long enough that nobody would run this twice, and a harness nobody re-runs is
-- a harness that stops being true.
--
-- THE DISTRIBUTIONS ARE NOT UNIFORM, deliberately. Real data is skewed and the
-- skew is what breaks plans:
--   - recency: `last_message_at` spreads over two years, so an ORDER BY on it
--     has something to sort rather than 50,000 identical timestamps
--   - unread: about one thread in eight, not half, matching how a crew that
--     keeps up actually looks
--   - assignment: about half assigned, so the assigned-only arms of the
--     for-you query see both branches
--   - names: drawn from a small pool with a numeric suffix, so an ILIKE search
--     matches a realistic fraction rather than everything or nothing
--
-- Usage:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < scripts/load/seed-volume.sql
--
-- Idempotent by teardown: it drops the load company and rebuilds it, so
-- re-running never doubles the volume or measures a bigger workspace than the
-- one it claims.

\set ON_ERROR_STOP on
\timing on

-- Fixed ids so the measurement script can name them without a lookup, and so a
-- re-run replaces the same rows rather than accumulating workspaces.
\set load_company '''11111111-1111-4111-8111-111111111111'''
\set load_owner   '''22222222-2222-4222-8222-222222222222'''

begin;

-- Teardown first. Order follows the foreign keys inward.
delete from public.messages       where company_id = :load_company::uuid;
delete from public.conversations  where company_id = :load_company::uuid;
delete from public.contacts       where company_id = :load_company::uuid;
delete from public.company_members where company_id = :load_company::uuid;
delete from public.phone_numbers  where company_id = :load_company::uuid;
delete from public.companies      where id = :load_company::uuid;
delete from auth.users            where id = :load_owner::uuid;
-- The nineteen members are created with generated ids, so they are found by
-- their email pattern rather than by id. Without this a re-run collides on the
-- unique email and the whole seed aborts after the teardown has already run,
-- which leaves no workspace at all.
delete from auth.users            where email like 'load-member-%@loonext.local';

insert into auth.users (id, email)
values (:load_owner::uuid, 'load-owner@loonext.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, plan)
values
  (:load_company::uuid, 'Load Test Plumbing', :load_owner::uuid, 'US', '415',
   now(), 'active', 'pro');

insert into public.company_members (company_id, user_id, role)
values (:load_company::uuid, :load_owner::uuid, 'owner');

-- Nineteen more members, so the assigned-to fan-out has something to spread
-- across. The issue names "a workspace with 20 members on a busy day".
insert into auth.users (id, email)
select gen_random_uuid(), 'load-member-' || g || '@loonext.local'
  from generate_series(1, 19) g;

insert into public.company_members (company_id, user_id, role)
select :load_company::uuid, u.id, 'member'
  from auth.users u
 where u.email like 'load-member-%@loonext.local';

-- `provisioning_key` and `country` are both not null and neither has a default:
-- the key is the idempotency claim the provisioning saga writes, and the
-- country decides which registration rules apply. A fixture cannot skip either.
insert into public.phone_numbers
  (id, company_id, number_e164, status, requested_area_code, provisioning_key,
   country)
values
  ('33333333-3333-4333-8333-333333333333', :load_company::uuid,
   '+14155550100', 'active', '415', 'load-test-number', 'US');

commit;

-- Contacts, conversations and messages outside the teardown transaction so a
-- failure part-way leaves the workspace obviously incomplete rather than
-- silently half-sized.
begin;

insert into public.contacts (id, company_id, phone_e164, name, created_at)
select
  gen_random_uuid(),
  :load_company::uuid,
  -- +1415 555 xxxx runs out at 10k, so the block widens rather than colliding.
  '+1415' || lpad((5550000 + g)::text, 7, '0'),
  (array['Dave','Sam','Priya','Chen','Maria','Tom','Aisha','Luc'])[1 + (g % 8)]
    || ' ' || (array['Ng','Patel','Silva','Okafor','Roy','Kim'])[1 + (g % 6)]
    || ' ' || g,
  now() - (g % 730) * interval '1 day'
  from generate_series(1, 50000) g;

commit;

begin;

-- The member ids are materialised first: a window function cannot appear in
-- OFFSET, and spreading assignment across the crew needs a positional pick.
with crew as (
  select user_id, (row_number() over (order by user_id)) - 1 as slot
    from public.company_members
   where company_id = :load_company::uuid
),
numbered as (
  select c.id, c.phone_e164, row_number() over (order by c.id) as n
    from public.contacts c
   where c.company_id = :load_company::uuid
)
insert into public.conversations
  (id, company_id, contact_id, phone_number_id, contact_phone_e164,
   last_message_at, status, closed_at, assigned_user_id, awaiting_reply_since,
   created_at)
select
  gen_random_uuid(),
  :load_company::uuid,
  n.id,
  '33333333-3333-4333-8333-333333333333',
  n.phone_e164,
  -- Two years of recency, so ORDER BY last_message_at has real work to do.
  now() - (n.n % 730) * interval '1 day',
  -- Most threads closed, a minority open. An inbox where everything is open is
  -- an abandoned one, and the open-only filters would then match everything.
  case when n.n % 8 = 0 then 'open' else 'closed' end::conversation_status,
  -- `conversations_closed_consistency` requires the stamp to agree with the
  -- status. The constraint is right and the fixture has to be too, or the
  -- seeded workspace would not be a shape the product can actually produce.
  case when n.n % 8 <> 0
    then now() - (n.n % 730) * interval '1 day'
  end,
  -- About half assigned, spread across the crew, so both arms of the for-you
  -- query are exercised rather than only the unassigned one.
  case when n.n % 2 = 0
    then (select user_id from crew where slot = n.n % 20)
  end,
  -- A tenth of threads waiting on us, which is what the for-you query ranks.
  case when n.n % 10 = 0
    then now() - (n.n % 72) * interval '1 hour'
  end,
  now() - (n.n % 730) * interval '1 day'
  from numbered n;

commit;

begin;

-- Four messages a thread: question, answer, follow-up, confirmation.
insert into public.messages
  (id, company_id, conversation_id, direction, body, status, sent_by_user_id,
   created_at)
select
  gen_random_uuid(),
  :load_company::uuid,
  v.id,
  case when m % 2 = 1 then 'inbound' else 'outbound' end::message_direction,
  -- A JOB REFERENCE PER THREAD, and it is not decoration.
  --
  -- The first version of this used four canned sentences and nothing else, so
  -- every message in the workspace shared a vocabulary of about twenty words.
  -- Searching one of them matched 150,000 of 200,000 rows, Postgres chose a
  -- sequential scan because at that selectivity a sequential scan IS the right
  -- plan, and the measurement looked exactly like a missing index. The GIN
  -- index was there the whole time.
  --
  -- That is the same mistake as benchmarking empty tables, one level down: the
  -- volume was right and the CARDINALITY was wrong. A real inbox contains
  -- addresses, names, part numbers and dates, so a search term matches a
  -- handful of threads rather than most of them. The reference makes each
  -- thread findable by something only it contains, which is what a person
  -- searching actually types.
  (array[
    'Hi, can you come look at the water heater this week? ref ' || v.ref,
    'We can be there Thursday morning, does 9am work? ref ' || v.ref,
    'Thursday 9am is good, the side gate will be unlocked. ref ' || v.ref,
    'Booked you in for Thursday at 9. See you then. ref ' || v.ref
  ])[m],
  case when m % 2 = 1 then 'received' else 'delivered' end::message_status,
  -- `messages_outbound_actor`: an outbound message names who sent it. The
  -- constraint is what makes "who texted this customer" answerable, so a
  -- fixture that skipped it would be measuring a shape the product cannot
  -- produce. Attributed to the assigned member where there is one, else the
  -- owner.
  case when m % 2 = 0
    then coalesce(v.assigned_user_id, :load_owner::uuid)
  end,
  v.last_message_at - (4 - m) * interval '11 minutes'
  from (
    select c.*, 'jobref' || row_number() over (order by c.id) as ref
      from public.conversations c
     where c.company_id = :load_company::uuid
  ) v
 cross join generate_series(1, 4) m;

commit;

analyze public.contacts;
analyze public.conversations;
analyze public.messages;

select
  (select count(*) from public.contacts      where company_id = :load_company::uuid) as contacts,
  (select count(*) from public.conversations where company_id = :load_company::uuid) as conversations,
  (select count(*) from public.messages      where company_id = :load_company::uuid) as messages,
  (select count(*) from public.company_members where company_id = :load_company::uuid) as members;
