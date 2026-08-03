-- [#237] Appointment reminders — assertion suite for
-- supabase/migrations/20260803100000_appointment_reminders.sql.
--
-- What is pinned here is the set of rules that fail SILENTLY, and for this
-- feature every one of them is a customer receiving something they should not:
-- a reminder for a job that was cancelled yesterday, two copies of the same
-- reminder, or a reminder that survived somebody switching reminders off.
--
-- The issue names the first of those as worse than no reminder at all, and it
-- is right: an automated text about a job that is not happening costs more
-- trust than the no-show it was trying to prevent.
--
-- The design claim these tests exist to defend is that A REMINDER IS A
-- SCHEDULED MESSAGE (see the migration header). That buys exactly-once firing,
-- the pre-send gates and the disclosure rules for free — but it also means the
-- regeneration sweep runs over a table that holds texts a HUMAN wrote, and
-- AR-4 is the assertion that keeps it off them.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/appointment_reminders.test.sql
--
-- One transaction, rolled back. Fixtures use a '5e' id prefix so the file runs
-- standalone OR after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('5e000000-0000-4000-8000-00000000000a'::uuid, 'remind-a@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('5e000000-0000-4000-8000-0000000000c1'::uuid, 'Remind Plumbing',
   '5e000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());

insert into public.company_members (company_id, user_id, role) values
  ('5e000000-0000-4000-8000-0000000000c1'::uuid,
   '5e000000-0000-4000-8000-00000000000a'::uuid, 'owner');

insert into public.phone_numbers
  (id, company_id, provisioning_key, country, number_e164, status)
values ('5e000000-0000-4000-8000-0000000000f1'::uuid,
        '5e000000-0000-4000-8000-0000000000c1'::uuid,
        'remind-1', 'US', '+12125557101', 'active');

insert into public.contacts (id, company_id, phone_e164, name)
values ('5e000000-0000-4000-8000-0000000000d1'::uuid,
        '5e000000-0000-4000-8000-0000000000c1'::uuid,
        '+12125559801', 'Remind Customer');

insert into public.conversations
  (id, company_id, contact_id, phone_number_id, status, last_message_at)
values ('5e000000-0000-4000-8000-0000000000e1'::uuid,
        '5e000000-0000-4000-8000-0000000000c1'::uuid,
        '5e000000-0000-4000-8000-0000000000d1'::uuid,
        '5e000000-0000-4000-8000-0000000000f1'::uuid, 'open', now());

insert into public.messages
  (id, company_id, conversation_id, direction, body, status, segments)
values ('5e000000-0000-4000-8000-00000000ab01'::uuid,
        '5e000000-0000-4000-8000-0000000000c1'::uuid,
        '5e000000-0000-4000-8000-0000000000e1'::uuid,
        'inbound', 'can you come thursday?', 'received', 1);

insert into public.tasks
  (id, company_id, message_id, conversation_id, title, due_at, created_by_user_id)
values ('5e000000-0000-4000-8000-00000000ab02'::uuid,
        '5e000000-0000-4000-8000-0000000000c1'::uuid,
        '5e000000-0000-4000-8000-00000000ab01'::uuid,
        '5e000000-0000-4000-8000-0000000000e1'::uuid,
        'Boiler swap', now() + interval '3 days',
        '5e000000-0000-4000-8000-00000000000a'::uuid);

-- The two reminders the API would hand in, already resolved against the
-- customer's clock. Written as a helper so every test below asks for the same
-- pair and a difference in an assertion is a difference in BEHAVIOUR.
create or replace function pg_temp.two_reminders() returns jsonb
language sql as $$
  select jsonb_build_array(
    jsonb_build_object(
      'offset_minutes', 1440,
      'body', 'Reminder: we are booked for Thursday at 9am.',
      'send_at', (now() + interval '2 days')::text
    ),
    jsonb_build_object(
      'offset_minutes', 120,
      'body', 'On our way to you in about two hours.',
      'send_at', (now() + interval '2 days 22 hours')::text
    )
  );
$$;

create or replace function pg_temp.sync(p_reminders jsonb) returns jsonb
language sql as $$
  select public.api_sync_task_reminders(
    '5e000000-0000-4000-8000-0000000000c1'::uuid,
    '5e000000-0000-4000-8000-00000000ab02'::uuid,
    '5e000000-0000-4000-8000-00000000000a'::uuid,
    p_reminders,
    'America/New_York', 'area_code',
    now() + interval '4 days'
  );
$$;

-- ===========================================================================
-- AR-1. A sync queues one scheduled message per rule, marked as a reminder and
--       carrying the offset it came from.
--
-- The offset is stored rather than derived from send_at minus due_at, because
-- BOTH of those move. A reminder whose identity is computed from two moving
-- values cannot be matched to its rule once either changes, which is exactly
-- the moment regeneration needs to match it.
-- ===========================================================================
do $$
declare
  v_res jsonb;
  v_count integer;
  v_offsets integer[];
begin
  v_res := pg_temp.sync(pg_temp.two_reminders());

  if v_res->>'outcome' <> 'synced' then
    raise exception 'AR-1 FAILED: sync returned %, expected synced', v_res;
  end if;
  if (v_res->>'added')::integer <> 2 then
    raise exception 'AR-1 FAILED: added % reminder(s), expected 2', v_res->>'added';
  end if;

  select count(*), array_agg(reminder_offset_minutes order by reminder_offset_minutes)
    into v_count, v_offsets
    from public.scheduled_messages
   where task_id = '5e000000-0000-4000-8000-00000000ab02'::uuid;

  if v_count <> 2 then
    raise exception 'AR-1 FAILED: % queued row(s), expected 2', v_count;
  end if;
  if v_offsets <> array[120, 1440] then
    raise exception 'AR-1 FAILED: offsets are %, expected {120,1440}', v_offsets;
  end if;

  if exists (
    select 1 from public.scheduled_messages
     where task_id = '5e000000-0000-4000-8000-00000000ab02'::uuid
       and origin <> 'reminder'
  ) then
    raise exception 'AR-1 FAILED: a queued reminder is not marked origin=reminder';
  end if;

  raise notice 'AR-1 PASSED: a sync queues one message per rule, with its offset';
end $$;

-- ===========================================================================
-- AR-2. Syncing again does not queue the same reminder twice.
--
-- The failure this prevents is the one a customer notices: the same reminder
-- arriving twice because a task was saved twice, or because two clients each
-- triggered a sync. Every write path in the product can call this, so the
-- idempotence has to live here rather than in whoever remembers.
-- ===========================================================================
do $$
declare
  v_res jsonb;
  v_count integer;
begin
  v_res := pg_temp.sync(pg_temp.two_reminders());

  select count(*) into v_count
    from public.scheduled_messages
   where task_id = '5e000000-0000-4000-8000-00000000ab02'::uuid;

  if v_count <> 2 then
    raise exception
      'AR-2 FAILED: a second sync left % row(s), expected 2. The customer '
      'receives every one of these.', v_count;
  end if;

  raise notice 'AR-2 PASSED: re-syncing is idempotent';
end $$;

-- ===========================================================================
-- AR-3. The job moving moves the reminders; the job losing its date cancels
--       them.
--
-- #237's acceptance criterion, and the one that makes the difference between a
-- reminder system and a liability: "an automated reminder for a job that was
-- cancelled yesterday is worse than no reminder".
-- ===========================================================================
do $$
declare
  v_res   jsonb;
  v_send  timestamptz;
  v_count integer;
begin
  -- Moved a day later: same offsets, new instants.
  v_res := pg_temp.sync(jsonb_build_array(
    jsonb_build_object(
      'offset_minutes', 1440,
      'body', 'Reminder: we are booked for Friday at 9am.',
      'send_at', (now() + interval '3 days')::text
    ),
    jsonb_build_object(
      'offset_minutes', 120,
      'body', 'On our way to you in about two hours.',
      'send_at', (now() + interval '3 days 22 hours')::text
    )
  ));

  if (v_res->>'removed')::integer <> 2 or (v_res->>'added')::integer <> 2 then
    raise exception
      'AR-3 FAILED: a reschedule removed % and added %, expected 2 and 2',
      v_res->>'removed', v_res->>'added';
  end if;

  select send_at, count(*) over () into v_send, v_count
    from public.scheduled_messages
   where task_id = '5e000000-0000-4000-8000-00000000ab02'::uuid
     and reminder_offset_minutes = 1440;

  if v_send < now() + interval '2 days 12 hours' then
    raise exception
      'AR-3 FAILED: the 24h reminder still points at the OLD appointment (%). '
      'The customer is told to expect us on the wrong day.', v_send;
  end if;

  -- And the date going away entirely: the caller passes an empty array, which
  -- is the ONE cancellation path — done, deleted, suppressed, moved into the
  -- past and rules-switched-off all arrive here identically.
  v_res := pg_temp.sync('[]'::jsonb);

  select count(*) into v_count
    from public.scheduled_messages
   where task_id = '5e000000-0000-4000-8000-00000000ab02'::uuid;

  if v_count <> 0 then
    raise exception
      'AR-3 FAILED: % reminder(s) survived the job losing its date. Every one '
      'of them tells a customer to expect somebody who is not coming.', v_count;
  end if;

  raise notice 'AR-3 PASSED: reminders follow the job, and die with it';
end $$;

-- ===========================================================================
-- AR-4. The regeneration sweep never touches a text a human wrote.
--
-- THE MOST IMPORTANT TEST IN THIS FILE. Reminders live in the same table as
-- hand-scheduled sends, which is what makes the whole design cheap — and it
-- means a sweep with a wrong WHERE clause deletes somebody's own words with no
-- error and no trace. `origin` exists solely to prevent this, so this test is
-- what says `origin` is doing its job rather than merely present.
-- ===========================================================================
do $$
declare
  v_res  jsonb;
  v_body text;
begin
  -- A person schedules their own text ABOUT THIS JOB.
  --
  -- `task_id` is set on purpose, and it is what makes this test mean anything.
  -- An unlinked human row is protected by the sweep's `task_id = p_task_id`
  -- predicate whatever `origin` says — so a fixture without it passes with the
  -- origin filter deleted, which is what the first version of this test did.
  -- Linking a scheduled text to the job it is about is an obvious next feature
  -- ("text them about Thursday"), and on the day it lands `origin` is the only
  -- thing standing between that text and this sweep.
  insert into public.scheduled_messages
    (company_id, conversation_id, task_id, body, send_at, clock_timezone,
     clock_source, expires_at, created_by)
  values ('5e000000-0000-4000-8000-0000000000c1'::uuid,
          '5e000000-0000-4000-8000-0000000000e1'::uuid,
          '5e000000-0000-4000-8000-00000000ab02'::uuid,
          'Quote attached — any questions before Thursday?',
          now() + interval '1 day', 'America/New_York', 'area_code',
          now() + interval '2 days',
          '5e000000-0000-4000-8000-00000000000a'::uuid);

  -- ...and the job is then rescheduled twice over.
  v_res := pg_temp.sync(pg_temp.two_reminders());
  v_res := pg_temp.sync('[]'::jsonb);

  select body into v_body
    from public.scheduled_messages
   where conversation_id = '5e000000-0000-4000-8000-0000000000e1'::uuid
     and origin = 'human';

  if v_body is null then
    raise exception
      'AR-4 FAILED: the reminder sweep deleted a text a PERSON wrote and '
      'scheduled. It shares a table with reminders; only `origin` keeps them '
      'apart, and it just failed to.';
  end if;

  raise notice 'AR-4 PASSED: a human''s scheduled text survives the sweep';
end $$;

-- ===========================================================================
-- AR-5. Suppressing reminders on one job cancels its queue and keeps it empty.
--
-- #237 asks for per-job suppression, and the reason is the job nobody should
-- be texted about: a callback on a complaint, a visit arranged face to face.
-- Clearing the queue is not enough — a later sync must not quietly refill it.
-- ===========================================================================
do $$
declare
  v_res   jsonb;
  v_count integer;
begin
  v_res := pg_temp.sync(pg_temp.two_reminders());

  update public.tasks set reminders_off = true
   where id = '5e000000-0000-4000-8000-00000000ab02'::uuid;

  v_res := pg_temp.sync(pg_temp.two_reminders());

  if v_res->>'reason' <> 'reminders_off' then
    raise exception 'AR-5 FAILED: sync gave reason %, expected reminders_off', v_res;
  end if;

  -- `origin = 'reminder'` on purpose: AR-4 left a human-written text linked to
  -- this same job, and that row SHOULD survive. Counting everything on the
  -- task would fail this assertion for the one behaviour the test above exists
  -- to protect.
  select count(*) into v_count
    from public.scheduled_messages
   where task_id = '5e000000-0000-4000-8000-00000000ab02'::uuid
     and origin = 'reminder';

  if v_count <> 0 then
    raise exception
      'AR-5 FAILED: % reminder(s) queued for a job with reminders switched '
      'off. The setting did nothing.', v_count;
  end if;

  update public.tasks set reminders_off = false
   where id = '5e000000-0000-4000-8000-00000000ab02'::uuid;

  raise notice 'AR-5 PASSED: per-job suppression empties the queue and holds it';
end $$;

-- ===========================================================================
-- AR-6. A HELD reminder is not silently replaced by a regeneration.
--
-- A held row is one the firing job stopped and told the owner about, in the
-- API's own words. docs/DECISIONS.md makes that disclosure binding — "silent
-- disappearance is the one unacceptable option" — so rebuilding over it would
-- erase the only record that anything went wrong.
-- ===========================================================================
do $$
declare
  v_res    jsonb;
  v_status text;
  v_reason text;
begin
  v_res := pg_temp.sync(pg_temp.two_reminders());

  update public.scheduled_messages
     set status = 'held',
         held_reason = 'They replied STOP after you scheduled this, so it was not sent. Only they can undo that.',
         held_at = now()
   where task_id = '5e000000-0000-4000-8000-00000000ab02'::uuid
     and reminder_offset_minutes = 1440;

  v_res := pg_temp.sync(pg_temp.two_reminders());

  select status, held_reason into v_status, v_reason
    from public.scheduled_messages
   where task_id = '5e000000-0000-4000-8000-00000000ab02'::uuid
     and reminder_offset_minutes = 1440;

  if v_status is distinct from 'held' or v_reason is null then
    raise exception
      'AR-6 FAILED: the held reminder came back as % with reason %. The reason '
      'it was held is the only thing telling the owner a customer was not '
      'reached.', v_status, v_reason;
  end if;

  raise notice 'AR-6 PASSED: a held reminder keeps its disclosure';
end $$;

-- ===========================================================================
-- AR-7. The shape constraint: a reminder always knows its job and its offset,
--       and a human's text never carries one.
--
-- Both halves are load-bearing. A 'reminder' with no offset cannot be matched
-- by regeneration and becomes immortal; a 'human' row carrying one is a row
-- some future sweep deletes by mistake, which is AR-4's failure arriving by a
-- different door.
-- ===========================================================================
do $$
declare
  v_ok boolean;
begin
  begin
    insert into public.scheduled_messages
      (company_id, conversation_id, body, send_at, clock_timezone, clock_source,
       expires_at, created_by, origin, task_id)
    values ('5e000000-0000-4000-8000-0000000000c1'::uuid,
            '5e000000-0000-4000-8000-0000000000e1'::uuid, 'x',
            now() + interval '1 day', 'UTC', 'company', now() + interval '2 days',
            '5e000000-0000-4000-8000-00000000000a'::uuid,
            'reminder', '5e000000-0000-4000-8000-00000000ab02'::uuid);
    v_ok := false;
  exception when check_violation then
    v_ok := true;
  end;
  if not v_ok then
    raise exception
      'AR-7 FAILED: a reminder with no offset was accepted. Regeneration '
      'matches on that offset, so this row can never be replaced or removed.';
  end if;

  begin
    insert into public.scheduled_messages
      (company_id, conversation_id, body, send_at, clock_timezone, clock_source,
       expires_at, created_by, origin, reminder_offset_minutes)
    values ('5e000000-0000-4000-8000-0000000000c1'::uuid,
            '5e000000-0000-4000-8000-0000000000e1'::uuid, 'x',
            now() + interval '1 day', 'UTC', 'company', now() + interval '2 days',
            '5e000000-0000-4000-8000-00000000000a'::uuid,
            'human', 1440);
    v_ok := false;
  exception when check_violation then
    v_ok := true;
  end;
  if not v_ok then
    raise exception
      'AR-7 FAILED: a human-written text was accepted carrying a reminder '
      'offset. That is exactly the row AR-4''s sweep would delete.';
  end if;

  raise notice 'AR-7 PASSED: the reminder shape constraint holds both ways';
end $$;

-- ===========================================================================
-- AR-8. Confirmation is recorded once, and says who confirmed.
--
-- A customer replying "C" twice, or replying to both reminders, has confirmed
-- once. The caller needs to tell "this reply confirmed it" from "it was already
-- confirmed", because only the first is worth posting to the thread.
-- ===========================================================================
do $$
declare
  v_first  jsonb;
  v_second jsonb;
  v_by     text;
begin
  v_first  := public.api_confirm_task(
    '5e000000-0000-4000-8000-0000000000c1'::uuid,
    '5e000000-0000-4000-8000-00000000ab02'::uuid, 'customer');
  v_second := public.api_confirm_task(
    '5e000000-0000-4000-8000-0000000000c1'::uuid,
    '5e000000-0000-4000-8000-00000000ab02'::uuid, 'customer');

  if v_first->>'outcome' <> 'confirmed' then
    raise exception 'AR-8 FAILED: first confirm returned %', v_first;
  end if;
  if v_second->>'outcome' <> 'already' then
    raise exception
      'AR-8 FAILED: the second confirm returned %, expected already. A '
      'customer who replies twice would be thanked twice.', v_second;
  end if;

  select confirmed_by into v_by from public.tasks
   where id = '5e000000-0000-4000-8000-00000000ab02'::uuid;
  if v_by <> 'customer' then
    raise exception
      'AR-8 FAILED: confirmed_by is %, expected customer. A crew confirmation '
      'is a note to ourselves; a customer one is a promise.', v_by;
  end if;

  raise notice 'AR-8 PASSED: confirmation is once, and attributed';
end $$;

-- ===========================================================================
-- AR-9. One workspace cannot sync another's job.
--
-- The tenant boundary on the one function in this feature that WRITES sends.
-- ===========================================================================
do $$
declare
  v_res jsonb;
begin
  v_res := public.api_sync_task_reminders(
    '5e000000-0000-4000-8000-0000000000c1'::uuid,
    '5e000000-0000-4000-8000-00000000ab02'::uuid,
    '5e000000-0000-4000-8000-00000000000a'::uuid,
    pg_temp.two_reminders(),
    'America/New_York', 'area_code', now() + interval '4 days'
  );
  if v_res->>'outcome' <> 'synced' then
    raise exception 'AR-9 FAILED: the owning company could not sync its own task';
  end if;

  v_res := public.api_sync_task_reminders(
    gen_random_uuid(),
    '5e000000-0000-4000-8000-00000000ab02'::uuid,
    '5e000000-0000-4000-8000-00000000000a'::uuid,
    pg_temp.two_reminders(),
    'America/New_York', 'area_code', now() + interval '4 days'
  );
  if v_res->>'outcome' <> 'not_found' then
    raise exception
      'AR-9 FAILED: another workspace synced this job (%). That queues texts '
      'from one company''s number about another company''s appointment.', v_res;
  end if;

  raise notice 'AR-9 PASSED: syncing is company-scoped';
end $$;

-- ===========================================================================
-- AR-10. Two rules cannot share an offset in one workspace.
--
-- Two rules both firing 24h before is the same reminder arriving twice, which
-- is the failure a customer notices and blames the business for.
-- ===========================================================================
do $$
declare
  v_ok boolean;
begin
  insert into public.appointment_reminder_rules
    (company_id, offset_minutes, body, created_by)
  values ('5e000000-0000-4000-8000-0000000000c1'::uuid, 1440,
          'See you tomorrow.', '5e000000-0000-4000-8000-00000000000a'::uuid);

  begin
    insert into public.appointment_reminder_rules
      (company_id, offset_minutes, body, created_by)
    values ('5e000000-0000-4000-8000-0000000000c1'::uuid, 1440,
            'Also see you tomorrow.', '5e000000-0000-4000-8000-00000000000a'::uuid);
    v_ok := false;
  exception when unique_violation then
    v_ok := true;
  end;

  if not v_ok then
    raise exception
      'AR-10 FAILED: a second rule at the same offset was accepted. The '
      'customer receives the same reminder twice.';
  end if;

  raise notice 'AR-10 PASSED: one rule per offset per workspace';
end $$;

rollback;
