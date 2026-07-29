-- #388 — the unanswered-lead clock and the escalation ladder.
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run: psql -v ON_ERROR_STOP=1 -f supabase/tests/lead_response_clock.test.sql
-- The whole suite runs in one transaction and ROLLS BACK.
--
-- What this suite is really guarding: the ladder is a thing that makes phones
-- ring, so almost every test below is about it NOT firing. A klaxon loses more
-- leads than a missed nudge wins (#244), and the cases that turn it off —
-- somebody replied, somebody claimed it, a robot answered, the rung already
-- went out — are the ones a later change is most likely to break silently.
--
--   owner   = 38800000-0000-4000-8000-000000000001
--   tech    = 38800000-0000-4000-8000-000000000002
--   company = 38800000-0000-4000-8000-000000000010
--   number  = 38800000-0000-4000-8000-000000000020
--   contact = 38800000-0000-4000-8000-00000000003x

\set ON_ERROR_STOP on

begin;

-- ===========================================================================
-- LC-0. The settings columns, and their defaults — which ARE the product
--       decision, not a detail. Rung 1 defaults ON because it reaches nobody
--       who was not already told once. Rung 2 defaults OFF because it tells
--       people who were not told before, and that is the setting that can
--       turn into a klaxon.
-- ===========================================================================
do $$
declare d1 text; d2 text; n1 boolean; n2 boolean;
begin
  select column_default, is_nullable = 'YES' into d1, n1
    from information_schema.columns
   where table_schema='public' and table_name='companies'
     and column_name='lead_chase_enabled';
  select column_default, is_nullable = 'YES' into d2, n2
    from information_schema.columns
   where table_schema='public' and table_name='companies'
     and column_name='lead_chase_crew_enabled';

  if d1 is null then raise exception 'LC-0 FAILED: companies.lead_chase_enabled missing'; end if;
  if d2 is null then raise exception 'LC-0 FAILED: companies.lead_chase_crew_enabled missing'; end if;
  if n1 or n2 then raise exception 'LC-0 FAILED: both settings must be NOT NULL'; end if;
  if d1 not like '%true%' then
    raise exception 'LC-0 FAILED: lead_chase_enabled defaults % (want true)', d1;
  end if;
  if d2 not like '%false%' then
    raise exception 'LC-0 FAILED: lead_chase_crew_enabled defaults % (want false — opt-in)', d2;
  end if;
end $$;

-- ===========================================================================
-- Fixtures.
-- ===========================================================================
insert into auth.users (id, email, raw_user_meta_data) values
  ('38800000-0000-4000-8000-000000000001', 'owner@chase.test', '{"display_name":"Chase Owner"}'::jsonb),
  ('38800000-0000-4000-8000-000000000002', 'tech@chase.test',  '{"display_name":"Chase Tech"}'::jsonb);

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, plan)
values ('38800000-0000-4000-8000-000000000010', 'Riverbend Plumbing',
        '38800000-0000-4000-8000-000000000001', 'CA', '416', now(),
        'active', 'starter');

insert into public.company_members (company_id, user_id, role) values
  ('38800000-0000-4000-8000-000000000010', '38800000-0000-4000-8000-000000000001', 'owner'),
  ('38800000-0000-4000-8000-000000000010', '38800000-0000-4000-8000-000000000002', 'member');

insert into public.phone_numbers
  (id, company_id, status, provisioning_key, country, number_e164)
values ('38800000-0000-4000-8000-000000000020',
        '38800000-0000-4000-8000-000000000010',
        'active', 'cs_test_chase_1', 'CA', '+14165550300');

insert into public.contacts (id, company_id, phone_e164, name) values
  ('38800000-0000-4000-8000-000000000031', '38800000-0000-4000-8000-000000000010', '+14165550311', 'Nora Vance'),
  ('38800000-0000-4000-8000-000000000032', '38800000-0000-4000-8000-000000000010', '+14165550312', 'Perry Alden'),
  ('38800000-0000-4000-8000-000000000033', '38800000-0000-4000-8000-000000000010', '+14165550313', 'Quinn Ross'),
  ('38800000-0000-4000-8000-000000000034', '38800000-0000-4000-8000-000000000010', '+14165550314', 'Rae Cordell'),
  ('38800000-0000-4000-8000-000000000035', '38800000-0000-4000-8000-000000000010', '+14165550315', 'Sam Delacroix'),
  ('38800000-0000-4000-8000-000000000036', '38800000-0000-4000-8000-000000000010', '+14165550316', 'Tess Marlow'),
  ('38800000-0000-4000-8000-000000000037', '38800000-0000-4000-8000-000000000010', '+14165550317', 'Ida Brannock');

-- A helper so each test reads as "a lead arrived" rather than six inserts.
create or replace function pg_temp.new_lead(p_conv uuid, p_contact uuid)
returns void language plpgsql as $$
begin
  insert into public.conversations (id, company_id, contact_id, phone_number_id, status)
  values (p_conv, '38800000-0000-4000-8000-000000000010', p_contact,
          '38800000-0000-4000-8000-000000000020', 'new');
  insert into public.messages (company_id, conversation_id, direction, body, status)
  values ('38800000-0000-4000-8000-000000000010', p_conv, 'inbound', 'Need a quote', 'received');
end $$;

-- ===========================================================================
-- LC-1. An inbound on a NEW thread starts the clock. This is the only thing
--       that starts it, and it is stamped from the message rather than from
--       the update, so the window is measured from when the CUSTOMER texted —
--       not from when our trigger got around to it.
-- ===========================================================================
do $$
declare c record; m timestamptz;
begin
  perform pg_temp.new_lead('38800000-0000-4000-8000-000000000041',
                           '38800000-0000-4000-8000-000000000031');
  select * into c from public.conversations where id='38800000-0000-4000-8000-000000000041';
  select created_at into m from public.messages
   where conversation_id='38800000-0000-4000-8000-000000000041' limit 1;

  if c.awaiting_reply_since is null then
    raise exception 'LC-1 FAILED: an inbound lead did not start the clock';
  end if;
  if c.awaiting_reply_since is distinct from m then
    raise exception 'LC-1 FAILED: clock started at % but the text arrived at %',
      c.awaiting_reply_since, m;
  end if;
  if c.chase_level <> 0 then
    raise exception 'LC-1 FAILED: a fresh clock is at rung %, want 0', c.chase_level;
  end if;

  raise notice 'LC-1 PASSED: an inbound lead starts the clock at the customer''s timestamp';
end $$;

-- ===========================================================================
-- LC-2. A SECOND inbound does not restart the clock. A customer who texts
--       "hello?" three minutes later is more reason to escalate, not less —
--       restarting would push the deadline away every time they got impatient,
--       so the angriest customer would be the last one chased.
-- ===========================================================================
do $$
declare before_at timestamptz; after_at timestamptz;
begin
  select awaiting_reply_since into before_at from public.conversations
   where id='38800000-0000-4000-8000-000000000041';

  insert into public.messages (company_id, conversation_id, direction, body, status)
  values ('38800000-0000-4000-8000-000000000010', '38800000-0000-4000-8000-000000000041',
          'inbound', 'hello? are you there', 'received');

  select awaiting_reply_since into after_at from public.conversations
   where id='38800000-0000-4000-8000-000000000041';

  if after_at is distinct from before_at then
    raise exception 'LC-2 FAILED: a follow-up text moved the deadline from % to %',
      before_at, after_at;
  end if;

  raise notice 'LC-2 PASSED: an impatient customer does not push their own deadline back';
end $$;

-- ===========================================================================
-- LC-3. A HUMAN reply stops the clock. An AUTO-REPLY does not.
--       This is the load-bearing distinction in the whole feature: the away
--       message, MCTB and the emergency ack are all outbound rows, and if any
--       of them counted as an answer then every after-hours lead would be
--       marked handled by a robot saying "we'll get back to you".
--
--       Note what the automated fixture looks like: it carries the OWNER as
--       sent_by_user_id, because messages_outbound_actor requires an actor on
--       every outbound row and the claim functions supply the owner. That is
--       exactly why `automated` had to exist — the obvious test, "did a person
--       send it", reads true for every auto-reply this product has ever sent.
-- ===========================================================================
do $$
declare still timestamptz;
begin
  perform pg_temp.new_lead('38800000-0000-4000-8000-000000000042',
                           '38800000-0000-4000-8000-000000000032');

  -- An automated send, shaped exactly as claim_auto_reply writes it.
  insert into public.messages
    (company_id, conversation_id, direction, body, status, sent_by_user_id, automated)
  values ('38800000-0000-4000-8000-000000000010', '38800000-0000-4000-8000-000000000042',
          'outbound', 'Thanks! We are closed right now.', 'sent',
          '38800000-0000-4000-8000-000000000001', true);

  select awaiting_reply_since into still from public.conversations
   where id='38800000-0000-4000-8000-000000000042';
  if still is null then
    raise exception 'LC-3 FAILED: an auto-reply stopped the clock — a robot is not an answer';
  end if;

  -- A person.
  insert into public.messages (company_id, conversation_id, direction, body, status, sent_by_user_id)
  values ('38800000-0000-4000-8000-000000000010', '38800000-0000-4000-8000-000000000042',
          'outbound', 'Morning Perry — can be there at 2.', 'sent',
          '38800000-0000-4000-8000-000000000002');

  select awaiting_reply_since into still from public.conversations
   where id='38800000-0000-4000-8000-000000000042';
  if still is not null then
    raise exception 'LC-3 FAILED: a human reply did not stop the clock';
  end if;

  raise notice 'LC-3 PASSED: a person answering stops the clock, a robot answering does not';
end $$;

-- ===========================================================================
-- LC-4. Claiming the thread stops the clock. Somebody typing a reply must not
--       be interrupted by a crew-wide alarm about the thread they are visibly
--       working on — that is precisely how a crew learns to mute the app.
--       Closing and spam-marking stop it too.
-- ===========================================================================
do $$
declare c record;
begin
  perform pg_temp.new_lead('38800000-0000-4000-8000-000000000043',
                           '38800000-0000-4000-8000-000000000033');

  update public.conversations
     set assigned_user_id = '38800000-0000-4000-8000-000000000002'
   where id = '38800000-0000-4000-8000-000000000043';

  select * into c from public.conversations where id='38800000-0000-4000-8000-000000000043';
  if c.awaiting_reply_since is not null then
    raise exception 'LC-4 FAILED: claiming a lead left the clock running';
  end if;
  if c.chase_level <> 0 then
    raise exception 'LC-4 FAILED: claiming left the rung at %', c.chase_level;
  end if;

  -- Spam.
  perform pg_temp.new_lead('38800000-0000-4000-8000-000000000044',
                           '38800000-0000-4000-8000-000000000034');
  update public.conversations set is_spam = true
   where id = '38800000-0000-4000-8000-000000000044';
  if (select awaiting_reply_since from public.conversations
       where id='38800000-0000-4000-8000-000000000044') is not null then
    raise exception 'LC-4 FAILED: marking spam left the clock running';
  end if;

  -- Closing.
  perform pg_temp.new_lead('38800000-0000-4000-8000-000000000045',
                           '38800000-0000-4000-8000-000000000035');
  update public.conversations set status='closed', closed_at = now()
   where id = '38800000-0000-4000-8000-000000000045';
  if (select awaiting_reply_since from public.conversations
       where id='38800000-0000-4000-8000-000000000045') is not null then
    raise exception 'LC-4 FAILED: closing left the clock running';
  end if;

  raise notice 'LC-4 PASSED: claiming, spam and closing all stop the clock';
end $$;

-- ===========================================================================
-- LC-5. api_due_lead_chases respects the deadline, then the settings.
--       #463 removed the 2-minute rung, so the deadline is now 5 minutes and
--       the switch is lead_chase_crew_enabled — the one that survived.
-- ===========================================================================
do $$
declare due jsonb;
begin
  -- The surviving rung needs an ASSIGNED thread (widening an unassigned one
  -- reaches nobody new) and the crew switch on.
  -- Assign FIRST, then start the clock: assigning stops a running clock
  -- (LC-4), so setting both in one statement would leave nothing due.
  update public.conversations
     set assigned_user_id = '38800000-0000-4000-8000-000000000002'
   where id = '38800000-0000-4000-8000-000000000041';
  update public.conversations
     set awaiting_reply_since = now() - interval '8 minutes', chase_level = 0
   where id = '38800000-0000-4000-8000-000000000041';
  update public.companies set lead_chase_crew_enabled = true
   where id = '38800000-0000-4000-8000-000000000010';

  due := public.api_due_lead_chases(now(), 5, 100);
  if not (due @> '[{"conversation_id":"38800000-0000-4000-8000-000000000041"}]'::jsonb) then
    raise exception 'LC-5 FAILED: an 8-minute-old unanswered lead was not due: %', due;
  end if;

  -- Not yet due before the five-minute mark.
  update public.conversations set awaiting_reply_since = now() - interval '1 minute'
   where id = '38800000-0000-4000-8000-000000000041';
  due := public.api_due_lead_chases(now(), 5, 100);
  if due @> '[{"conversation_id":"38800000-0000-4000-8000-000000000041"}]'::jsonb then
    raise exception 'LC-5 FAILED: a 1-minute-old lead was chased before its deadline';
  end if;

  -- The company switch is a real switch. #463: it is the CREW one now, and it
  -- no longer depends on a nudge setting that no longer exists.
  update public.conversations set awaiting_reply_since = now() - interval '8 minutes'
   where id = '38800000-0000-4000-8000-000000000041';
  update public.companies set lead_chase_crew_enabled = false
   where id = '38800000-0000-4000-8000-000000000010';
  due := public.api_due_lead_chases(now(), 5, 100);
  if due <> '[]'::jsonb then
    raise exception 'LC-5 FAILED: chasing is off and something was still due: %', due;
  end if;
  update public.companies set lead_chase_crew_enabled = true
   where id = '38800000-0000-4000-8000-000000000010';

  raise notice 'LC-5 PASSED: the deadline and the company switch both gate the queue';
end $$;

-- ===========================================================================
-- LC-6. Rung 2 widens an ASSIGNED thread only, and only when opted in.
--       An unassigned thread has already told everybody twice — a third buzz
--       reaches no new person, so the ladder ends. This is the anti-klaxon
--       rule and it is the one most likely to be "simplified" away later.
--
--       The fixture creates the thread ALREADY assigned, which is the only way
--       a live clock and an assignee coexist: assigning while the clock runs
--       stops it (LC-4). Real threads reach this state by being reopened —
--       a past customer texts again and their old assignee is still on it.
-- ===========================================================================
do $$
declare due jsonb;
begin
  insert into public.conversations
    (id, company_id, contact_id, phone_number_id, status, assigned_user_id)
  values ('38800000-0000-4000-8000-000000000047',
          '38800000-0000-4000-8000-000000000010',
          '38800000-0000-4000-8000-000000000036',
          '38800000-0000-4000-8000-000000000020', 'new',
          '38800000-0000-4000-8000-000000000002');
  insert into public.messages (company_id, conversation_id, direction, body, status)
  values ('38800000-0000-4000-8000-000000000010', '38800000-0000-4000-8000-000000000047',
          'inbound', 'Boiler is out again', 'received');

  -- Park every other clock so this test sees only its own thread.
  update public.conversations set awaiting_reply_since = null
   where company_id = '38800000-0000-4000-8000-000000000010'
     and id <> '38800000-0000-4000-8000-000000000047';

  update public.companies set lead_chase_crew_enabled = true
   where id = '38800000-0000-4000-8000-000000000010';
  update public.conversations
     set awaiting_reply_since = now() - interval '30 minutes', chase_level = 0
   where id = '38800000-0000-4000-8000-000000000047';

  due := public.api_due_lead_chases(now(), 5, 100);
  if not (due @> '[{"to_level":2}]'::jsonb) then
    raise exception 'LC-6 FAILED: an assigned, overdue, opted-in thread did not reach rung 2: %', due;
  end if;

  -- The opt-in is real.
  update public.companies set lead_chase_crew_enabled = false
   where id = '38800000-0000-4000-8000-000000000010';
  due := public.api_due_lead_chases(now(), 5, 100);
  if due <> '[]'::jsonb then
    raise exception 'LC-6 FAILED: rung 2 fired without the owner opting in: %', due;
  end if;

  -- And the same thread UNASSIGNED, opted in, thirty minutes overdue, still
  -- does not widen: everybody was already told twice.
  update public.companies set lead_chase_crew_enabled = true
   where id = '38800000-0000-4000-8000-000000000010';
  update public.conversations set assigned_user_id = null
   where id = '38800000-0000-4000-8000-000000000047';
  update public.conversations
     set awaiting_reply_since = now() - interval '30 minutes', chase_level = 1
   where id = '38800000-0000-4000-8000-000000000047';

  due := public.api_due_lead_chases(now(), 5, 100);
  if due <> '[]'::jsonb then
    raise exception 'LC-6 FAILED: an unassigned thread was widened to a crew that already knows: %', due;
  end if;
  update public.companies set lead_chase_crew_enabled = false
   where id = '38800000-0000-4000-8000-000000000010';

  raise notice 'LC-6 PASSED: rung 2 needs an assignee AND an opt-in, and ends the ladder otherwise';
end $$;

-- LC-7. api_claim_lead_chases is exactly-once. Two overlapping cron runs both
--       see the same conversation; the second must claim nothing and therefore
--       send nothing. Without this the customer's phone buzzes twice for one
--       rung, which reads as a bug to them and as spam to the crew.
-- ===========================================================================
do $$
declare first_claim jsonb; second_claim jsonb; lvl smallint;
begin
  update public.conversations
     set awaiting_reply_since = now() - interval '3 minutes', chase_level = 0
   where id = '38800000-0000-4000-8000-000000000041';

  first_claim := public.api_claim_lead_chases(
    array['38800000-0000-4000-8000-000000000041']::uuid[], 0::smallint);
  second_claim := public.api_claim_lead_chases(
    array['38800000-0000-4000-8000-000000000041']::uuid[], 0::smallint);

  if jsonb_array_length(first_claim) <> 1 then
    raise exception 'LC-7 FAILED: the first run claimed % rows, want 1', jsonb_array_length(first_claim);
  end if;
  if second_claim <> '[]'::jsonb then
    raise exception 'LC-7 FAILED: a concurrent run re-claimed the same rung: %', second_claim;
  end if;

  select chase_level into lvl from public.conversations
   where id='38800000-0000-4000-8000-000000000041';
  if lvl <> 1 then
    raise exception 'LC-7 FAILED: the rung advanced to % after two claims, want 1', lvl;
  end if;

  raise notice 'LC-7 PASSED: a rung is claimed exactly once however many runs overlap';
end $$;

-- ===========================================================================
-- LC-8. A claim on a thread whose clock stopped in the meantime sends nothing.
--       This is the race that matters: the crew replied in the milliseconds
--       between the scan and the claim, and that is the outcome the whole
--       feature wanted — it must not be followed by "nobody has replied".
-- ===========================================================================
do $$
declare claimed jsonb;
begin
  perform pg_temp.new_lead('38800000-0000-4000-8000-000000000046',
                           '38800000-0000-4000-8000-000000000037');
  update public.conversations set awaiting_reply_since = now() - interval '3 minutes'
   where id = '38800000-0000-4000-8000-000000000046';

  -- Somebody answers, right between the scan and the claim.
  insert into public.messages (company_id, conversation_id, direction, body, status, sent_by_user_id)
  values ('38800000-0000-4000-8000-000000000010', '38800000-0000-4000-8000-000000000046',
          'outbound', 'On my way', 'sent', '38800000-0000-4000-8000-000000000002');

  claimed := public.api_claim_lead_chases(
    array['38800000-0000-4000-8000-000000000046']::uuid[], 0::smallint);
  if claimed <> '[]'::jsonb then
    raise exception 'LC-8 FAILED: chased a lead that had just been answered: %', claimed;
  end if;

  raise notice 'LC-8 PASSED: answering between the scan and the claim cancels the chase';
end $$;

-- ===========================================================================
-- LC-9. Grants: both functions are service_role only. They read across every
--       tenant by design, so an authenticated caller reaching either one is a
--       cross-tenant read.
-- ===========================================================================
do $$
declare bad text;
begin
  select string_agg(format('%s→%s', p.proname, g.grantee), ', ') into bad
    from information_schema.role_routine_grants g
    join pg_proc p on p.proname = g.routine_name
   where g.routine_schema = 'public'
     and p.proname in ('api_due_lead_chases', 'api_claim_lead_chases')
     and g.grantee in ('PUBLIC', 'anon', 'authenticated');

  if bad is not null then
    raise exception 'LC-9 FAILED: cross-tenant functions are reachable: %', bad;
  end if;

  raise notice 'LC-9 PASSED: the ladder RPCs are service_role only';
end $$;

rollback;
