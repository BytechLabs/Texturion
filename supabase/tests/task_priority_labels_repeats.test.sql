-- [#693] Task priority, labels and repeating jobs: assertion suite for
-- supabase/migrations/20261111090000_task_priority_labels_repeats.sql.
--
-- What is pinned:
--   PR-1  priority defaults to normal, is validated, changes write one event
--         and a no-op writes none; the bulk action sets it
--   LB-1  labels: add and remove write events with the tag name; a tag from
--         another workspace is refused; a merge folds task labels quietly;
--         api_tag_usage counts them
--   RP-1  the date arithmetic: weekdays, month end, nth weekday, last weekday,
--         leap day, every N days
--   RP-2  a schedule series keeps two occurrences ahead, does not backfill, and
--         running it again makes nothing
--   RP-3  an occurrence is a full task: carries assignee, labels, priority,
--         address, contact, conversation and description, and owns its done
--         state and its history
--   RP-4  IDEMPOTENCY: completing twice, reopening and completing again, a
--         message task completed through its message, and a lost race on the
--         key all leave exactly one next occurrence
--   RP-5  ends: after N, on a date; pause stops creation and resuming catches up
--   RP-6  deleting one occurrence skips it (after-done makes the next)
--   RP-7  "this and future": edits reach later open occurrences only; deleting
--         the series stops it and leaves finished ones alone
--   RP-8  changing the rule starts a new series at this task; clearing detaches
--   RP-9  the contact timeline names the series
--
-- One transaction, rolled back. Fixtures use a 'b7' id prefix. now() is frozen
-- inside a transaction, so the runner is given an explicit p_now.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('b7000000-0000-4000-8000-00000000000a'::uuid, 'rp-owner@test.local'),
  ('b7000000-0000-4000-8000-00000000000b'::uuid, 'rp-member@test.local'),
  ('b7000000-0000-4000-8000-00000000000c'::uuid, 'rp-other-owner@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status)
values
  ('b7000000-0000-4000-8000-0000000000c1'::uuid, 'Repeat Co',
   'b7000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(), 'active'),
  ('b7000000-0000-4000-8000-0000000000c2'::uuid, 'Other Co',
   'b7000000-0000-4000-8000-00000000000c'::uuid, 'US', '415', now(), 'active');

insert into public.company_members (company_id, user_id, role) values
  ('b7000000-0000-4000-8000-0000000000c1'::uuid,
   'b7000000-0000-4000-8000-00000000000a'::uuid, 'owner'),
  ('b7000000-0000-4000-8000-0000000000c1'::uuid,
   'b7000000-0000-4000-8000-00000000000b'::uuid, 'member'),
  ('b7000000-0000-4000-8000-0000000000c2'::uuid,
   'b7000000-0000-4000-8000-00000000000c'::uuid, 'owner');

insert into public.phone_numbers
  (id, company_id, provisioning_key, country, number_e164, status,
   requested_area_code)
values
  ('b7000000-0000-4000-8000-0000000000b1'::uuid,
   'b7000000-0000-4000-8000-0000000000c1'::uuid, 'rp-1', 'US',
   '+14155550160', 'active', '415');

insert into public.contacts (id, company_id, phone_e164, name) values
  ('b7000000-0000-4000-8000-0000000000a1'::uuid,
   'b7000000-0000-4000-8000-0000000000c1'::uuid, '+14155550161', 'Pat Plumber');

insert into public.conversations
  (id, company_id, phone_number_id, contact_id, status, last_message_at)
values
  ('b7000000-0000-4000-8000-0000000000e1'::uuid,
   'b7000000-0000-4000-8000-0000000000c1'::uuid,
   'b7000000-0000-4000-8000-0000000000b1'::uuid,
   'b7000000-0000-4000-8000-0000000000a1'::uuid, 'open', now());

insert into public.messages
  (id, company_id, conversation_id, direction, status, body, created_at)
values
  ('b7000000-0000-4000-8000-0000000000d1'::uuid,
   'b7000000-0000-4000-8000-0000000000c1'::uuid,
   'b7000000-0000-4000-8000-0000000000e1'::uuid, 'inbound', 'received',
   'Furnace is making noise', now() - interval '1 hour');

insert into public.tags (id, company_id, name) values
  ('b7000000-0000-4000-8000-0000000000f1'::uuid,
   'b7000000-0000-4000-8000-0000000000c1'::uuid, 'warranty'),
  ('b7000000-0000-4000-8000-0000000000f2'::uuid,
   'b7000000-0000-4000-8000-0000000000c1'::uuid, 'parts needed'),
  ('b7000000-0000-4000-8000-0000000000f3'::uuid,
   'b7000000-0000-4000-8000-0000000000c2'::uuid, 'foreign');

-- ---------------------------------------------------------------------------
-- PR-1. Priority.
-- ---------------------------------------------------------------------------
do $$
declare
  v_c1     uuid := 'b7000000-0000-4000-8000-0000000000c1';
  v_owner  uuid := 'b7000000-0000-4000-8000-00000000000a';
  v_task   uuid;
  r        jsonb;
  n        int;
begin
  r := public.create_task(v_c1, null, 'Plain', '', null, null, v_owner);
  v_task := (r->'task'->>'id')::uuid;
  if r->'task'->>'priority' is distinct from 'normal' then
    raise exception 'PR-1 FAILED: default priority is %', r->'task'->>'priority';
  end if;

  r := public.create_task(v_c1, null, 'Bad', '', null, null, v_owner,
    null, null, null, null, null, null, null, null, null, null, 'critical');
  if r->>'outcome' is distinct from 'bad_priority' then
    raise exception 'PR-1 FAILED: create_task accepted priority critical (%)', r->>'outcome';
  end if;

  r := public.create_task(v_c1, null, 'Hot', '', null, null, v_owner,
    null, null, null, null, null, null, null, null, null, null, 'urgent');
  if r->'task'->>'priority' is distinct from 'urgent'
     or (r->'task'->>'priority_rank')::int is distinct from 4 then
    raise exception 'PR-1 FAILED: urgent was stored as % / rank %',
      r->'task'->>'priority', r->'task'->>'priority_rank';
  end if;

  r := public.update_task(v_c1, v_task, null, null, null, false, v_owner,
    false, null, null, null, null, null, null, null, 'high');
  if r->>'outcome' is distinct from 'updated'
     or r->'task'->>'priority' is distinct from 'high' then
    raise exception 'PR-1 FAILED: update_task did not set high (%)', r;
  end if;
  select count(*) into n from public.task_events
   where task_id = v_task and kind = 'priority'
     and from_value = to_jsonb('normal'::text) and to_value = to_jsonb('high'::text)
     and actor_user_id = v_owner;
  if n is distinct from 1 then
    raise exception 'PR-1 FAILED: wanted one priority event, found %', n;
  end if;

  r := public.update_task(v_c1, v_task, null, null, null, false, v_owner,
    false, null, null, null, null, null, null, null, 'high');
  select count(*) into n from public.task_events
   where task_id = v_task and kind = 'priority';
  if r->>'outcome' is distinct from 'unchanged' or n is distinct from 1 then
    raise exception 'PR-1 FAILED: a no-op priority wrote an event (%, %)', r->>'outcome', n;
  end if;

  r := public.update_task(v_c1, v_task, null, null, null, false, v_owner,
    false, null, null, null, null, null, null, null, 'whenever');
  if r->>'outcome' is distinct from 'bad_priority' then
    raise exception 'PR-1 FAILED: update_task accepted priority whenever';
  end if;

  -- Bulk: set_priority applies to the tasks that differ, and reports the old value.
  r := public.api_bulk_tasks(v_c1, v_owner, 'set_priority', array[v_task], null, null, 'low');
  if jsonb_array_length(r->'applied') is distinct from 1
     or r->'applied'->0->'previous'->>'priority' is distinct from 'high' then
    raise exception 'PR-1 FAILED: bulk set_priority result %', r;
  end if;
  r := public.api_bulk_tasks(v_c1, v_owner, 'set_priority', array[v_task], null, null, 'bogus');
  if r->>'error' is distinct from 'validation_failed' then
    raise exception 'PR-1 FAILED: bulk accepted a bogus priority (%)', r;
  end if;
  raise notice 'PR-1 PASSED: priority';
end $$;

-- ---------------------------------------------------------------------------
-- LB-1. Labels.
-- ---------------------------------------------------------------------------
do $$
declare
  v_c1     uuid := 'b7000000-0000-4000-8000-0000000000c1';
  v_owner  uuid := 'b7000000-0000-4000-8000-00000000000a';
  v_t1     uuid := 'b7000000-0000-4000-8000-0000000000f1';
  v_t2     uuid := 'b7000000-0000-4000-8000-0000000000f2';
  v_t3     uuid := 'b7000000-0000-4000-8000-0000000000f3';
  v_task   uuid;
  v_task2  uuid;
  r        jsonb;
  n        int;
begin
  v_task := (public.create_task(v_c1, null, 'Labelled', '', null, null, v_owner)->'task'->>'id')::uuid;
  v_task2 := (public.create_task(v_c1, null, 'Labelled too', '', null, null, v_owner)->'task'->>'id')::uuid;

  r := public.api_set_task_tags(v_c1, v_task, v_owner, array[v_t1, v_t2], null);
  if jsonb_array_length(r->'labels') is distinct from 2 then
    raise exception 'LB-1 FAILED: expected two labels, got %', r;
  end if;
  select count(*) into n from public.task_events
   where task_id = v_task and kind = 'label_added'
     and actor_user_id = v_owner and to_value->>'name' in ('warranty', 'parts needed');
  if n is distinct from 2 then
    raise exception 'LB-1 FAILED: expected two label_added events, found %', n;
  end if;

  -- Adding what is already there writes nothing.
  perform public.api_set_task_tags(v_c1, v_task, v_owner, array[v_t1], null);
  select count(*) into n from public.task_events where task_id = v_task and kind = 'label_added';
  if n is distinct from 2 then
    raise exception 'LB-1 FAILED: a repeated add wrote an event (%)', n;
  end if;

  r := public.api_set_task_tags(v_c1, v_task, v_owner, null, array[v_t2]);
  if jsonb_array_length(r->'labels') is distinct from 1 then
    raise exception 'LB-1 FAILED: remove left % labels', jsonb_array_length(r->'labels');
  end if;
  if not exists (select 1 from public.task_events
                  where task_id = v_task and kind = 'label_removed'
                    and from_value->>'name' = 'parts needed') then
    raise exception 'LB-1 FAILED: no label_removed event with the name';
  end if;

  r := public.api_set_task_tags(v_c1, v_task, v_owner, array[v_t3], null);
  if r->>'outcome' is distinct from 'tag_not_found' then
    raise exception 'LB-1 FAILED: another workspace''s tag was accepted (%)', r;
  end if;

  -- Bulk add / remove.
  r := public.api_bulk_tasks(v_c1, v_owner, 'add_label', array[v_task, v_task2], null, null, null, v_t2);
  if jsonb_array_length(r->'applied') is distinct from 2 then
    raise exception 'LB-1 FAILED: bulk add_label applied %', r->'applied';
  end if;
  r := public.api_bulk_tasks(v_c1, v_owner, 'add_label', array[v_task, v_task2], null, null, null, v_t2);
  if jsonb_array_length(r->'applied') is distinct from 0 then
    raise exception 'LB-1 FAILED: bulk add_label re-applied';
  end if;
  r := public.api_bulk_tasks(v_c1, v_owner, 'remove_label', array[v_task2], null, null, null, v_t2);
  if jsonb_array_length(r->'applied') is distinct from 1 then
    raise exception 'LB-1 FAILED: bulk remove_label applied %', r->'applied';
  end if;
  r := public.api_bulk_tasks(v_c1, v_owner, 'add_label', array[v_task], null, null, null, v_t3);
  if r->>'error' is distinct from 'tag_not_found' then
    raise exception 'LB-1 FAILED: bulk accepted a foreign tag (%)', r;
  end if;

  -- A merge folds the task labels and records nobody labelling anything.
  select count(*) into n from public.task_events where task_id = v_task;
  r := public.api_merge_tags(v_c1, v_t2, v_t1);
  if r->>'outcome' is distinct from 'merged' then
    raise exception 'LB-1 FAILED: merge outcome %', r;
  end if;
  if exists (select 1 from public.task_tags where tag_id = v_t2) then
    raise exception 'LB-1 FAILED: a merged-away tag still labels a task';
  end if;
  if (select count(*) from public.task_events where task_id = v_task) is distinct from n then
    raise exception 'LB-1 FAILED: a tag merge wrote task history';
  end if;
  if (select uses from public.api_tag_usage(v_c1) where tag_id = v_t1) is distinct from 1 then
    raise exception 'LB-1 FAILED: api_tag_usage did not count task labels';
  end if;
  raise notice 'LB-1 PASSED: labels';
end $$;

-- ---------------------------------------------------------------------------
-- RP-1. The date arithmetic, through the real rules.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.series_of(p_due timestamptz, p_rule jsonb)
returns public.task_series language plpgsql as $$
declare
  v_task uuid;
  r jsonb;
  s public.task_series;
begin
  v_task := (public.create_task(
    'b7000000-0000-4000-8000-0000000000c1', null, 'Rule probe', '', null, p_due,
    'b7000000-0000-4000-8000-00000000000a')->'task'->>'id')::uuid;
  r := public.api_set_task_repeat(
    'b7000000-0000-4000-8000-0000000000c1', v_task,
    'b7000000-0000-4000-8000-00000000000a', p_rule);
  if r->>'outcome' is distinct from 'set' then
    raise exception 'series_of: %', r;
  end if;
  select * into s from public.task_series where id = (r->'task'->>'series_id')::uuid;
  return s;
end $$;

do $$
declare
  s public.task_series;
  d date;
begin
  -- Weekly on Mon, Wed, Fri from Monday 2027-03-01 (09:00 Toronto = 14:00 UTC).
  s := pg_temp.series_of('2027-03-01 14:00+00', '{"kind":"schedule","unit":"week","weekdays":[1,3,5]}');
  d := public.task_series_next_on(s, '2027-03-01');
  if d is distinct from date '2027-03-03' then raise exception 'RP-1 FAILED: weekly next after Mon is %', d; end if;
  d := public.task_series_next_on(s, '2027-03-05');
  if d is distinct from date '2027-03-08' then raise exception 'RP-1 FAILED: weekly next after Fri is %', d; end if;

  -- Every 2 weeks on Monday: the off week is skipped.
  s := pg_temp.series_of('2027-03-01 14:00+00', '{"kind":"schedule","unit":"week","every":2}');
  d := public.task_series_next_on(s, '2027-03-01');
  if d is distinct from date '2027-03-15' then raise exception 'RP-1 FAILED: biweekly next is %', d; end if;

  -- The 31st lands on the last day of a short month, then comes back.
  s := pg_temp.series_of('2027-01-31 14:00+00', '{"kind":"schedule","unit":"month"}');
  d := public.task_series_next_on(s, '2027-01-31');
  if d is distinct from date '2027-02-28' then raise exception 'RP-1 FAILED: monthly 31st gave %', d; end if;
  d := public.task_series_next_on(s, '2027-02-28');
  if d is distinct from date '2027-03-31' then raise exception 'RP-1 FAILED: monthly 31st after Feb gave %', d; end if;

  -- The 2nd Tuesday of the month.
  s := pg_temp.series_of('2027-03-09 14:00+00', '{"kind":"schedule","unit":"month","nth":2,"nth_weekday":2}');
  d := public.task_series_next_on(s, '2027-03-09');
  if d is distinct from date '2027-04-13' then raise exception 'RP-1 FAILED: 2nd Tuesday gave %', d; end if;

  -- The last Friday of the month.
  s := pg_temp.series_of('2027-03-26 14:00+00', '{"kind":"schedule","unit":"month","nth":-1,"nth_weekday":5}');
  d := public.task_series_next_on(s, '2027-03-26');
  if d is distinct from date '2027-04-30' then raise exception 'RP-1 FAILED: last Friday gave %', d; end if;

  -- Every 3 months on the 15th.
  s := pg_temp.series_of('2027-01-15 14:00+00', '{"kind":"schedule","unit":"month","every":3}');
  d := public.task_series_next_on(s, '2027-01-15');
  if d is distinct from date '2027-04-15' then raise exception 'RP-1 FAILED: quarterly gave %', d; end if;

  -- Leap day, yearly.
  s := pg_temp.series_of('2028-02-29 14:00+00', '{"kind":"schedule","unit":"year"}');
  d := public.task_series_next_on(s, '2028-02-29');
  if d is distinct from date '2029-02-28' then raise exception 'RP-1 FAILED: leap day gave %', d; end if;
  d := public.task_series_next_on(s, '2029-02-28');
  if d is distinct from date '2030-02-28' then raise exception 'RP-1 FAILED: year after leap gave %', d; end if;

  -- Every 3 days.
  s := pg_temp.series_of('2027-03-01 14:00+00', '{"kind":"schedule","unit":"day","every":3}');
  d := public.task_series_next_on(s, '2027-03-01');
  if d is distinct from date '2027-03-04' then raise exception 'RP-1 FAILED: every 3 days gave %', d; end if;

  -- The occurrence's wall-clock time survives the zone: 09:00 in Toronto.
  if public.task_series_due_at(s, '2027-07-01') is distinct from timestamptz '2027-07-01 13:00+00' then
    raise exception 'RP-1 FAILED: summer 09:00 Toronto is %', public.task_series_due_at(s, '2027-07-01');
  end if;

  -- Bad rules are refused.
  if (public.task_series_rule('{"kind":"after_done","unit":"year"}', date '2027-01-01') ? 'error') is false then
    raise exception 'RP-1 FAILED: after-done yearly was accepted';
  end if;
  if (public.task_series_rule('{"kind":"schedule","unit":"week","weekdays":[0]}', date '2027-01-01') ? 'error') is false then
    raise exception 'RP-1 FAILED: weekday 0 was accepted';
  end if;
  raise notice 'RP-1 PASSED: date arithmetic';
end $$;

-- ---------------------------------------------------------------------------
-- RP-2 / RP-3. A schedule series keeps two ahead, carries everything, and the
-- runner is idempotent.
-- ---------------------------------------------------------------------------
do $$
declare
  v_c1     uuid := 'b7000000-0000-4000-8000-0000000000c1';
  v_owner  uuid := 'b7000000-0000-4000-8000-00000000000a';
  v_member uuid := 'b7000000-0000-4000-8000-00000000000b';
  v_task   uuid;
  v_series uuid;
  v_next   public.tasks;
  r        jsonb;
  n        int;
begin
  r := public.create_task(
    v_c1, null, 'Filter change', 'Bring the 20x25', v_member,
    '2027-03-01 14:00+00', v_owner,
    '12 Elm St', 'Unit 4', 'Toronto', 'ON', 'M5V 1A1', 'CA', 'manual',
    null, 'b7000000-0000-4000-8000-0000000000a1',
    'b7000000-0000-4000-8000-0000000000e1', 'urgent');
  v_task := (r->'task'->>'id')::uuid;
  perform public.api_set_task_tags(v_c1, v_task, v_owner,
    array['b7000000-0000-4000-8000-0000000000f1'::uuid], null);

  r := public.api_set_task_repeat(v_c1, v_task, v_owner,
    '{"kind":"schedule","unit":"week"}');
  if r->>'outcome' is distinct from 'set' then
    raise exception 'RP-2 FAILED: set repeat gave %', r;
  end if;
  v_series := (r->'task'->>'series_id')::uuid;
  select count(*) into n from public.tasks where series_id = v_series;
  if n is distinct from 2 then
    raise exception 'RP-2 FAILED: expected the task and the next occurrence, found %', n;
  end if;

  -- RP-3. The next occurrence is a full task.
  select * into v_next from public.tasks
   where series_id = v_series and occurrence_no = 2;
  if v_next.occurrence_on is distinct from date '2027-03-08'
     or v_next.due_at is distinct from timestamptz '2027-03-08 14:00+00' then
    raise exception 'RP-3 FAILED: occurrence 2 is % / %', v_next.occurrence_on, v_next.due_at;
  end if;
  if v_next.title is distinct from 'Filter change'
     or v_next.description is distinct from 'Bring the 20x25'
     or v_next.assigned_user_id is distinct from v_member
     or v_next.priority is distinct from 'urgent'
     or v_next.addr_street is distinct from '12 Elm St'
     or v_next.addr_unit is distinct from 'Unit 4'
     or v_next.addr_postal_code is distinct from 'M5V 1A1'
     or v_next.contact_id is distinct from 'b7000000-0000-4000-8000-0000000000a1'
     or v_next.conversation_id is distinct from 'b7000000-0000-4000-8000-0000000000e1'
     or v_next.reminders_off is not true
     or v_next.done_at is not null then
    raise exception 'RP-3 FAILED: occurrence 2 did not carry the job: %', to_jsonb(v_next);
  end if;
  if not exists (select 1 from public.task_tags
                  where task_id = v_next.id
                    and tag_id = 'b7000000-0000-4000-8000-0000000000f1') then
    raise exception 'RP-3 FAILED: occurrence 2 lost its label';
  end if;
  -- Its own history, its own done state: completing the first leaves it open.
  perform public.set_task_done(v_c1, v_task, true, v_owner);
  if (select done_at from public.tasks where id = v_next.id) is not null then
    raise exception 'RP-3 FAILED: completing occurrence 1 completed occurrence 2';
  end if;
  if (select count(*) from public.task_events where task_id = v_next.id) is distinct from 1 then
    raise exception 'RP-3 FAILED: occurrence 2 should have a history of its own (created only)';
  end if;
  -- A schedule series makes nothing when one is completed.
  select count(*) into n from public.tasks where series_id = v_series;
  if n is distinct from 2 then
    raise exception 'RP-2 FAILED: completing a schedule occurrence made % occurrences', n;
  end if;

  -- Two ahead of Mar 2 means one more: Mar 8 is the only one still to come.
  n := public.task_series_materialize(v_series, '2027-03-02 12:00+00');
  if n is distinct from 1 then
    raise exception 'RP-2 FAILED: on Mar 2 expected 1 new occurrence, got %', n;
  end if;
  -- Idempotent: a second pass at the same instant makes nothing.
  n := public.task_series_materialize(v_series, '2027-03-02 12:00+00');
  if n is distinct from 0 then
    raise exception 'RP-2 FAILED: a second run made % more', n;
  end if;
  -- Time passes: on Mar 9 only Mar 15 is left ahead, so Mar 22 is made.
  n := public.task_series_materialize(v_series, '2027-03-09 12:00+00');
  if n is distinct from 1
     or not exists (select 1 from public.tasks where series_id = v_series and occurrence_on = date '2027-03-15')
     or not exists (select 1 from public.tasks where series_id = v_series and occurrence_on = date '2027-03-22') then
    raise exception 'RP-2 FAILED: expected Mar 15 and Mar 22 after Mar 9 (made %)', n;
  end if;

  -- A long outage does not backfill: months later, two ahead, none behind.
  n := public.task_series_materialize(v_series, '2027-09-01 12:00+00');
  if n is distinct from 2
     or exists (select 1 from public.tasks
                 where series_id = v_series and occurrence_no > 4
                   and occurrence_on < date '2027-09-01') then
    raise exception 'RP-2 FAILED: a gap backfilled (% made)', n;
  end if;

  -- The runner entry point: nothing is due in the past, something is due later,
  -- and a second pass is quiet.
  if public.api_materialize_task_repeats(1000, '2026-01-01 00:00+00') is distinct from 0 then
    raise exception 'RP-2 FAILED: the runner made occurrences that were not due';
  end if;
  n := public.api_materialize_task_repeats(1000, '2028-01-01 12:00+00');
  if n < 2 or not exists (select 1 from public.tasks
                           where series_id = v_series and occurrence_on >= date '2028-01-01') then
    raise exception 'RP-2 FAILED: the runner made % for a series that was due', n;
  end if;
  if public.api_materialize_task_repeats(1000, '2028-01-01 12:00+00') is distinct from 0 then
    raise exception 'RP-2 FAILED: a second runner pass made occurrences';
  end if;
  raise notice 'RP-2/RP-3 PASSED: schedule series';
end $$;

-- ---------------------------------------------------------------------------
-- RP-4. IDEMPOTENCY of the next occurrence.
-- ---------------------------------------------------------------------------
do $$
declare
  v_c1     uuid := 'b7000000-0000-4000-8000-0000000000c1';
  v_owner  uuid := 'b7000000-0000-4000-8000-00000000000a';
  v_task   uuid;
  v_series uuid;
  v_msg_t  uuid;
  s        public.task_series;
  r        jsonb;
  n        int;
  v_id     uuid;
begin
  v_task := (public.create_task(v_c1, null, 'Furnace service', '', null,
    '2027-03-01 14:00+00', v_owner)->'task'->>'id')::uuid;
  r := public.api_set_task_repeat(v_c1, v_task, v_owner,
    '{"kind":"after_done","unit":"month","every":6}');
  if r->>'outcome' is distinct from 'set' then
    raise exception 'RP-4 FAILED: set after-done gave %', r;
  end if;
  v_series := (r->'task'->>'series_id')::uuid;
  select count(*) into n from public.tasks where series_id = v_series;
  if n is distinct from 1 then
    raise exception 'RP-4 FAILED: an after-done series made % occurrences before any completion', n;
  end if;

  -- Complete: the next is dated from the completion, six months on.
  perform public.set_task_done(v_c1, v_task, true, v_owner);
  select count(*) into n from public.tasks where series_id = v_series and occurrence_no = 2;
  if n is distinct from 1 then
    raise exception 'RP-4 FAILED: completion made % next occurrences', n;
  end if;
  select * into s from public.task_series where id = v_series;
  if (select occurrence_on from public.tasks where series_id = v_series and occurrence_no = 2) is not null
     or (select (due_at at time zone 'America/Toronto')::date
           from public.tasks where series_id = v_series and occurrence_no = 2)
        is distinct from ((now() at time zone 'America/Toronto')::date + interval '6 months')::date then
    raise exception 'RP-4 FAILED: the next occurrence is not six months from the completion';
  end if;

  -- Completing again (done -> reopened -> done) makes nothing more.
  perform public.set_task_done(v_c1, v_task, false, v_owner);
  perform public.set_task_done(v_c1, v_task, true, v_owner);
  select count(*) into n from public.tasks where series_id = v_series;
  if n is distinct from 2 then
    raise exception 'RP-4 FAILED: completing twice left % occurrences, wanted 2', n;
  end if;

  -- Bulk completion of an already-completed occurrence is a no-op too.
  perform public.api_bulk_tasks(v_c1, v_owner, 'mark_done', array[v_task]);
  select count(*) into n from public.tasks where series_id = v_series;
  if n is distinct from 2 then
    raise exception 'RP-4 FAILED: a bulk completion left % occurrences', n;
  end if;

  -- A bulk completion of the NEWEST occurrence makes the third, once.
  v_id := (select id from public.tasks where series_id = v_series and occurrence_no = 2);
  perform public.api_bulk_tasks(v_c1, v_owner, 'mark_done', array[v_id]);
  perform public.api_bulk_tasks(v_c1, v_owner, 'mark_done', array[v_id]);
  select count(*) into n from public.tasks where series_id = v_series and occurrence_no = 3;
  if n is distinct from 1 then
    raise exception 'RP-4 FAILED: bulk completion made % third occurrences', n;
  end if;

  -- The key itself: a second inserter of the same (series, number) loses.
  select * into s from public.task_series where id = v_series;
  if public.task_series_spawn(s, 3, null, now()) is not null then
    raise exception 'RP-4 FAILED: a second spawn of occurrence 3 succeeded';
  end if;
  begin
    insert into public.tasks
      (company_id, title, created_by_user_id, series_id, occurrence_no)
    values (v_c1, 'dup', v_owner, v_series, 3);
    raise exception 'RP-4 FAILED: the unique key did not stop a duplicate occurrence';
  exception when unique_violation then
    null;
  end;
  -- Racing completions through the series entry points: both resolve to the
  -- same number and the second finds the key taken.
  if public.task_series_spawn_after(s, 3, current_date) is not null then
    -- s is stale (tail_no 3 already made), occurrence 4 does not exist yet, so
    -- this is the FIRST caller for number 4 and legitimately succeeds ...
    null;
  end if;
  if public.task_series_spawn_after(s, 3, current_date) is not null then
    raise exception 'RP-4 FAILED: the second racer for occurrence 4 also succeeded';
  end if;
  select count(*) into n from public.tasks where series_id = v_series and occurrence_no = 4;
  if n is distinct from 1 then
    raise exception 'RP-4 FAILED: two racers made % occurrence-4 rows', n;
  end if;

  -- A message-anchored task completes through its message.
  v_msg_t := (public.create_task(v_c1, 'b7000000-0000-4000-8000-0000000000d1', null, null,
    null, '2027-03-01 14:00+00', v_owner)->'task'->>'id')::uuid;
  r := public.api_set_task_repeat(v_c1, v_msg_t, v_owner,
    '{"kind":"after_done","unit":"week","every":2}');
  v_series := (r->'task'->>'series_id')::uuid;
  perform public.set_message_done(v_c1, 'b7000000-0000-4000-8000-0000000000d1', true, v_owner);
  perform public.set_message_done(v_c1, 'b7000000-0000-4000-8000-0000000000d1', false, v_owner);
  perform public.set_message_done(v_c1, 'b7000000-0000-4000-8000-0000000000d1', true, v_owner);
  select count(*) into n from public.tasks where series_id = v_series and occurrence_no = 2;
  if n is distinct from 1 then
    raise exception 'RP-4 FAILED: completing the source message made % next occurrences', n;
  end if;
  if (select message_id from public.tasks where series_id = v_series and occurrence_no = 2) is not null then
    raise exception 'RP-4 FAILED: the next occurrence reused the first one''s message';
  end if;
  raise notice 'RP-4 PASSED: the next occurrence is created once';
end $$;

-- ---------------------------------------------------------------------------
-- RP-5. Ends and pause.
-- ---------------------------------------------------------------------------
do $$
declare
  v_c1     uuid := 'b7000000-0000-4000-8000-0000000000c1';
  v_owner  uuid := 'b7000000-0000-4000-8000-00000000000a';
  v_task   uuid;
  v_series uuid;
  r        jsonb;
  n        int;
  v_id     uuid;
begin
  -- After 2 times (the task itself counts as the first).
  v_task := (public.create_task(v_c1, null, 'Twice', '', null,
    '2027-03-01 14:00+00', v_owner)->'task'->>'id')::uuid;
  r := public.api_set_task_repeat(v_c1, v_task, v_owner,
    '{"kind":"after_done","unit":"day","every":7,"ends":{"kind":"after","after":2}}');
  v_series := (r->'task'->>'series_id')::uuid;
  perform public.set_task_done(v_c1, v_task, true, v_owner);
  v_id := (select id from public.tasks where series_id = v_series and occurrence_no = 2);
  perform public.set_task_done(v_c1, v_id, true, v_owner);
  select count(*) into n from public.tasks where series_id = v_series;
  if n is distinct from 2 then
    raise exception 'RP-5 FAILED: "after 2" left % occurrences', n;
  end if;
  if (select stopped_at from public.task_series where id = v_series) is null then
    raise exception 'RP-5 FAILED: a series that ran its course is not marked stopped';
  end if;

  -- On a date: a completion whose next would fall after the end makes none.
  v_task := (public.create_task(v_c1, null, 'Until today', '', null,
    null, v_owner)->'task'->>'id')::uuid;
  r := public.api_set_task_repeat(v_c1, v_task, v_owner,
    '{"kind":"after_done","unit":"day","every":1,"ends":{"kind":"on","on":"2000-01-01"}}');
  if r->>'outcome' is distinct from 'invalid' then
    raise exception 'RP-5 FAILED: an end date before the start was accepted (%)', r->>'outcome';
  end if;
  r := public.api_set_task_repeat(v_c1, v_task, v_owner,
    format('{"kind":"after_done","unit":"day","every":1,"ends":{"kind":"on","on":"%s"}}',
           (now() at time zone 'America/Toronto')::date)::jsonb);
  v_series := (r->'task'->>'series_id')::uuid;
  perform public.set_task_done(v_c1, v_task, true, v_owner);
  if exists (select 1 from public.tasks where series_id = v_series and occurrence_no = 2) then
    raise exception 'RP-5 FAILED: an occurrence past the end date was made';
  end if;

  -- Pause stops creation; resuming catches up with the completion made meanwhile.
  v_task := (public.create_task(v_c1, null, 'Pausable', '', null,
    '2027-03-01 14:00+00', v_owner)->'task'->>'id')::uuid;
  r := public.api_set_task_repeat(v_c1, v_task, v_owner,
    '{"kind":"after_done","unit":"week","every":1}');
  v_series := (r->'task'->>'series_id')::uuid;
  r := public.api_set_task_repeat(v_c1, v_task, v_owner,
    '{"kind":"after_done","unit":"week","every":1,"paused":true}');
  if r->>'outcome' is distinct from 'set' and r->>'outcome' is distinct from 'unchanged' then
    raise exception 'RP-5 FAILED: pausing gave %', r;
  end if;
  if (select paused from public.task_series where id = v_series) is not true then
    raise exception 'RP-5 FAILED: the series is not paused';
  end if;
  perform public.set_task_done(v_c1, v_task, true, v_owner);
  if exists (select 1 from public.tasks where series_id = v_series and occurrence_no = 2) then
    raise exception 'RP-5 FAILED: a paused series made an occurrence';
  end if;
  perform public.api_set_task_repeat(v_c1, v_task, v_owner,
    '{"kind":"after_done","unit":"week","every":1,"paused":false}');
  select count(*) into n from public.tasks where series_id = v_series and occurrence_no = 2;
  if n is distinct from 1 then
    raise exception 'RP-5 FAILED: resuming made % catch-up occurrences', n;
  end if;
  raise notice 'RP-5 PASSED: ends and pause';
end $$;

-- ---------------------------------------------------------------------------
-- RP-6. Deleting one occurrence skips it.
-- ---------------------------------------------------------------------------
do $$
declare
  v_c1     uuid := 'b7000000-0000-4000-8000-0000000000c1';
  v_owner  uuid := 'b7000000-0000-4000-8000-00000000000a';
  v_task   uuid;
  v_series uuid;
  r        jsonb;
  n        int;
begin
  -- After-done: the chain would end, so deleting the open one makes the next.
  v_task := (public.create_task(v_c1, null, 'Skip me', '', null,
    '2027-03-01 14:00+00', v_owner)->'task'->>'id')::uuid;
  r := public.api_set_task_repeat(v_c1, v_task, v_owner,
    '{"kind":"after_done","unit":"month","every":1}');
  v_series := (r->'task'->>'series_id')::uuid;
  perform public.delete_task(v_c1, v_task, v_owner);
  select count(*) into n from public.tasks
   where series_id = v_series and occurrence_no = 2 and deleted_at is null;
  if n is distinct from 1 then
    raise exception 'RP-6 FAILED: skipping an after-done occurrence made % next ones', n;
  end if;
  -- The skipped one is deleted, its number stays used.
  perform public.delete_task(v_c1, v_task, v_owner);
  select count(*) into n from public.tasks where series_id = v_series;
  if n is distinct from 2 then
    raise exception 'RP-6 FAILED: deleting twice changed the series (% rows)', n;
  end if;

  -- Schedule: deleting the next occurrence does not bring it back.
  v_task := (public.create_task(v_c1, null, 'Weekly skip', '', null,
    '2027-03-01 14:00+00', v_owner)->'task'->>'id')::uuid;
  r := public.api_set_task_repeat(v_c1, v_task, v_owner,
    '{"kind":"schedule","unit":"week"}');
  v_series := (r->'task'->>'series_id')::uuid;
  perform public.delete_task(v_c1,
    (select id from public.tasks where series_id = v_series and occurrence_no = 2), v_owner);
  perform public.task_series_materialize(v_series, '2027-03-02 12:00+00');
  if exists (select 1 from public.tasks
              where series_id = v_series and occurrence_on = date '2027-03-08' and deleted_at is null) then
    raise exception 'RP-6 FAILED: a skipped schedule occurrence came back';
  end if;
  raise notice 'RP-6 PASSED: skip';
end $$;

-- ---------------------------------------------------------------------------
-- RP-7. This and future.
-- ---------------------------------------------------------------------------
do $$
declare
  v_c1     uuid := 'b7000000-0000-4000-8000-0000000000c1';
  v_owner  uuid := 'b7000000-0000-4000-8000-00000000000a';
  v_member uuid := 'b7000000-0000-4000-8000-00000000000b';
  v_tag    uuid := 'b7000000-0000-4000-8000-0000000000f1';
  v_task   uuid;
  v_series uuid;
  v_o2     uuid;
  v_o3     uuid;
  r        jsonb;
  n        int;
begin
  v_task := (public.create_task(v_c1, null, 'Weekly clean', 'old', null,
    '2027-03-01 14:00+00', v_owner)->'task'->>'id')::uuid;
  r := public.api_set_task_repeat(v_c1, v_task, v_owner, '{"kind":"schedule","unit":"week"}');
  v_series := (r->'task'->>'series_id')::uuid;
  perform public.task_series_materialize(v_series, '2027-03-09 12:00+00');
  v_o2 := (select id from public.tasks where series_id = v_series and occurrence_no = 2);
  v_o3 := (select id from public.tasks where series_id = v_series and occurrence_no = 3);
  -- Occurrence 2 is finished; 3 and 4 are open.
  perform public.set_task_done(v_c1, v_o2, true, v_owner);

  -- Edit from occurrence 2 forward: finished occurrences are history.
  r := public.api_edit_task_series(v_c1, v_o2, v_owner,
    jsonb_build_object('title', 'Weekly deep clean', 'priority', 'high',
      'assigned_user_id', v_member, 'labels_add', jsonb_build_array(v_tag),
      'due_time', '07:30'));
  if r->>'outcome' is distinct from 'updated' or (r->>'later')::int is distinct from 2 then
    raise exception 'RP-7 FAILED: edit-future result %', r;
  end if;
  if (select title from public.tasks where id = v_o3) is distinct from 'Weekly deep clean'
     or (select priority from public.tasks where id = v_o3) is distinct from 'high'
     or (select assigned_user_id from public.tasks where id = v_o3) is distinct from v_member
     or not exists (select 1 from public.task_tags where task_id = v_o3 and tag_id = v_tag) then
    raise exception 'RP-7 FAILED: a later open occurrence did not take the edit: %, labels %',
      (select to_jsonb(t) from public.tasks t where id = v_o3),
      (select count(*) from public.task_tags where task_id = v_o3);
  end if;
  if (select (due_at at time zone 'America/Toronto')::time from public.tasks where id = v_o3)
     is distinct from time '07:30' then
    raise exception 'RP-7 FAILED: the later occurrence kept its old time of day';
  end if;
  if (select title from public.tasks where id = v_task) is distinct from 'Weekly clean'
     or (select title from public.tasks where id = v_o2) is distinct from 'Weekly clean' then
    raise exception 'RP-7 FAILED: the edit reached this/earlier occurrences (the caller edits those)';
  end if;
  -- New occurrences carry the new template.
  perform public.task_series_materialize(v_series, '2027-04-15 12:00+00');
  if (select title from public.tasks
       where series_id = v_series order by occurrence_no desc limit 1) is distinct from 'Weekly deep clean' then
    raise exception 'RP-7 FAILED: a new occurrence used the old template';
  end if;

  -- Delete this and future from occurrence 3: 2 (done) and 1 stay, later open go.
  r := public.api_delete_task_series(v_c1, v_o3, v_owner);
  if r->>'outcome' is distinct from 'deleted' then
    raise exception 'RP-7 FAILED: delete-series result %', r;
  end if;
  if (select deleted_at from public.tasks where id = v_o2) is not null
     or (select deleted_at from public.tasks where id = v_task) is not null then
    raise exception 'RP-7 FAILED: deleting the series touched earlier occurrences';
  end if;
  select count(*) into n from public.tasks
   where series_id = v_series and occurrence_no >= 3 and deleted_at is null;
  if n is distinct from 0 then
    raise exception 'RP-7 FAILED: % future occurrences survived', n;
  end if;
  if (select stopped_at from public.task_series where id = v_series) is null then
    raise exception 'RP-7 FAILED: the series is not stopped';
  end if;
  perform public.api_materialize_task_repeats(1000, '2027-09-01 12:00+00');
  if public.task_series_materialize(v_series, '2027-09-01 12:00+00') is distinct from 0
     or exists (select 1 from public.tasks
                 where series_id = v_series and occurrence_on >= date '2027-09-01') then
    raise exception 'RP-7 FAILED: a stopped series made an occurrence';
  end if;
  raise notice 'RP-7 PASSED: this and future';
end $$;

-- ---------------------------------------------------------------------------
-- RP-8. A new rule starts a new series; clearing detaches.
-- ---------------------------------------------------------------------------
do $$
declare
  v_c1     uuid := 'b7000000-0000-4000-8000-0000000000c1';
  v_owner  uuid := 'b7000000-0000-4000-8000-00000000000a';
  v_task   uuid;
  v_s1     uuid;
  v_s2     uuid;
  r        jsonb;
  n        int;
begin
  v_task := (public.create_task(v_c1, null, 'Changing rule', '', null,
    '2027-03-01 14:00+00', v_owner)->'task'->>'id')::uuid;
  r := public.api_set_task_repeat(v_c1, v_task, v_owner, '{"kind":"schedule","unit":"week"}');
  v_s1 := (r->'task'->>'series_id')::uuid;
  r := public.api_set_task_repeat(v_c1, v_task, v_owner, '{"kind":"schedule","unit":"month"}');
  v_s2 := (r->'task'->>'series_id')::uuid;
  if v_s1 = v_s2 then
    raise exception 'RP-8 FAILED: a new rule kept the old series';
  end if;
  if (select stopped_at from public.task_series where id = v_s1) is null then
    raise exception 'RP-8 FAILED: the old series was not stopped';
  end if;
  select count(*) into n from public.tasks where series_id = v_s1 and deleted_at is null;
  if n is distinct from 0 then
    raise exception 'RP-8 FAILED: % old occurrences are still live', n;
  end if;
  select count(*) into n from public.tasks where series_id = v_s2 and deleted_at is null;
  if n is distinct from 2 then
    raise exception 'RP-8 FAILED: the new series has % live occurrences', n;
  end if;
  if (select count(*) from public.task_events where task_id = v_task and kind = 'repeat') is distinct from 2 then
    raise exception 'RP-8 FAILED: expected two repeat history events';
  end if;

  -- The same rule again changes nothing.
  r := public.api_set_task_repeat(v_c1, v_task, v_owner, '{"kind":"schedule","unit":"month"}');
  if r->>'outcome' is distinct from 'unchanged' then
    raise exception 'RP-8 FAILED: restating the rule gave %', r->>'outcome';
  end if;

  -- A schedule needs a date.
  r := public.api_set_task_repeat(v_c1,
    (public.create_task(v_c1, null, 'No date', '', null, null, v_owner)->'task'->>'id')::uuid,
    v_owner, '{"kind":"schedule","unit":"week"}');
  if r->>'outcome' is distinct from 'needs_due' then
    raise exception 'RP-8 FAILED: an undated schedule gave %', r->>'outcome';
  end if;

  -- Clear.
  r := public.api_set_task_repeat(v_c1, v_task, v_owner, null);
  if r->>'outcome' is distinct from 'cleared'
     or (select series_id from public.tasks where id = v_task) is not null then
    raise exception 'RP-8 FAILED: clear gave %', r->>'outcome';
  end if;
  select count(*) into n from public.tasks where series_id = v_s2 and deleted_at is null;
  if n is distinct from 0 then
    raise exception 'RP-8 FAILED: clearing left % future occurrences', n;
  end if;

  -- Another workspace cannot reach it.
  r := public.api_set_task_repeat('b7000000-0000-4000-8000-0000000000c2', v_task, v_owner,
    '{"kind":"schedule","unit":"week"}');
  if r->>'outcome' is distinct from 'not_found' then
    raise exception 'RP-8 FAILED: another workspace set a repeat (%)', r->>'outcome';
  end if;
  raise notice 'RP-8 PASSED: rule change and clear';
end $$;

-- ---------------------------------------------------------------------------
-- RP-9. The contact's timeline names the series; the grants are closed.
-- ---------------------------------------------------------------------------
do $$
declare
  v_c1     uuid := 'b7000000-0000-4000-8000-0000000000c1';
  v_owner  uuid := 'b7000000-0000-4000-8000-00000000000a';
  v_task   uuid;
  e        jsonb;
begin
  v_task := (public.create_task(v_c1, null, 'Annual backflow test', '', null,
    '2027-05-01 14:00+00', v_owner, null, null, null, null, null, null, null, null,
    'b7000000-0000-4000-8000-0000000000a1')->'task'->>'id')::uuid;
  perform public.api_set_task_repeat(v_c1, v_task, v_owner,
    '{"kind":"schedule","unit":"year"}');
  select x into e
    from public.api_contact_timeline(v_c1, 'b7000000-0000-4000-8000-0000000000a1') x
   where x->>'id' = v_task::text;
  if e is null or e->>'series_id' is null
     or e->'repeat'->>'unit' is distinct from 'year' then
    raise exception 'RP-9 FAILED: the timeline entry does not name its repeat: %', e;
  end if;

  if has_function_privilege('authenticated', 'public.api_set_task_repeat(uuid,uuid,uuid,jsonb)', 'execute')
     or has_function_privilege('anon', 'public.api_materialize_task_repeats(int,timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.api_set_task_tags(uuid,uuid,uuid,uuid[],uuid[])', 'execute')
     or has_function_privilege('authenticated', 'public.task_series_spawn(public.task_series,int,date,timestamptz)', 'execute') then
    raise exception 'RP-9 FAILED: a task repeat function is callable by a browser role';
  end if;
  if has_table_privilege('authenticated', 'public.task_series', 'select')
     or has_table_privilege('authenticated', 'public.task_tags', 'select') then
    raise exception 'RP-9 FAILED: a browser role can read the new tables';
  end if;
  raise notice 'RP-9 PASSED: timeline and grants';
end $$;

rollback;
