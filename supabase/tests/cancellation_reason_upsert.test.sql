-- [#277] Recording why a workspace is leaving — assertion suite for
-- supabase/migrations/20260805030000_cancellation_reason_upsert_rpc.sql.
--
-- THIS SUITE EXISTS BECAUSE THE FEATURE SHIPPED BROKEN AND EVERY TEST PASSED.
--
-- The route upserted through PostgREST with `on_conflict=company_id` against a
-- PARTIAL unique index (`... where confirmed_at is null`). Postgres will not
-- infer a partial index from a bare column list, so every call raised 42P10 and
-- 500ed, and the table never received a row. The route's own tests stub the
-- HTTP layer and assert that `on_conflict=company_id` was SENT — which it was,
-- faithfully, on the way to an error nothing could see. A guard that can only
-- ever pass was standing in for one that can fail.
--
-- So CR-1 is deliberately the dumbest assertion in the file: call the function
-- and count the row. It is the one that would have caught it.
--
-- The rest pin the two properties the partial index is there to express, and
-- which a plain unique index on company_id would quietly destroy:
--
--   ONE open statement per workspace  — opening the cancel screen three times
--                                       is one person giving one reason.
--   CONFIRMED rows are history        — a workspace can cancel, come back, and
--                                       cancel again; both statements are true
--                                       and the report reads both.
--
-- One transaction, rolled back. Fixtures use a 'c7' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('c7000000-0000-4000-8000-00000000000a'::uuid, 'cancel-owner@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('c7000000-0000-4000-8000-0000000000c1'::uuid, 'Leaving Plumbing',
   'c7000000-0000-4000-8000-00000000000a'::uuid, 'CA', '416', now()),
  ('c7000000-0000-4000-8000-0000000000c2'::uuid, 'Second Workspace',
   'c7000000-0000-4000-8000-00000000000a'::uuid, 'CA', '416', now());

-- ===========================================================================
-- CR-1: the statement is written at all. The whole feature rests on this line.
-- ===========================================================================
do $$
declare
  v_rows int;
  v_reason text;
begin
  perform public.api_record_cancellation_reason(
    'c7000000-0000-4000-8000-0000000000c1'::uuid,
    'c7000000-0000-4000-8000-00000000000a'::uuid,
    'seasonal',
    'Back in the spring.');

  select count(*), max(reason) into v_rows, v_reason
    from public.cancellation_reasons
   where company_id = 'c7000000-0000-4000-8000-0000000000c1'::uuid;

  if v_rows is distinct from 1 then
    raise exception 'CR-1 FAILED: expected the statement to be recorded, got % row(s)', v_rows;
  end if;
  if v_reason is distinct from 'seasonal' then
    raise exception 'CR-1 FAILED: recorded reason reads %', v_reason;
  end if;
  raise notice 'CR-1 PASSED: a reason reaches the table';
end $$;

-- ===========================================================================
-- CR-2: a skipped question is a real record. Both fields are optional, and a
-- call with neither is somebody who read the screen and said nothing. If this
-- ever became a not-null violation the exit would start depending on an
-- answer, which is the thing #277's devil's advocate forbids.
-- ===========================================================================
do $$
declare
  v_rows int;
begin
  perform public.api_record_cancellation_reason(
    'c7000000-0000-4000-8000-0000000000c2'::uuid, null, null, null);

  select count(*) into v_rows from public.cancellation_reasons
   where company_id = 'c7000000-0000-4000-8000-0000000000c2'::uuid
     and reason is null and detail is null;

  if v_rows is distinct from 1 then
    raise exception 'CR-2 FAILED: a skipped question recorded % row(s)', v_rows;
  end if;
  raise notice 'CR-2 PASSED: skipping is itself an answer, and it is stored';
end $$;

-- ===========================================================================
-- CR-3: opening the screen repeatedly is ONE statement, and the last word
-- wins. Three rows would triple-count one person in every report.
-- ===========================================================================
do $$
declare
  v_rows int;
  v_reason text;
  v_detail text;
  v_user uuid;
begin
  perform public.api_record_cancellation_reason(
    'c7000000-0000-4000-8000-0000000000c1'::uuid,
    'c7000000-0000-4000-8000-00000000000a'::uuid,
    'too_expensive', 'Second thoughts.');
  perform public.api_record_cancellation_reason(
    'c7000000-0000-4000-8000-0000000000c1'::uuid,
    'c7000000-0000-4000-8000-00000000000a'::uuid,
    'switched', null);

  select count(*) into v_rows from public.cancellation_reasons
   where company_id = 'c7000000-0000-4000-8000-0000000000c1'::uuid;
  if v_rows is distinct from 1 then
    raise exception 'CR-3 FAILED: three openings left % row(s), not one', v_rows;
  end if;

  select reason, detail, user_id into v_reason, v_detail, v_user
    from public.cancellation_reasons
   where company_id = 'c7000000-0000-4000-8000-0000000000c1'::uuid;
  if v_reason is distinct from 'switched' then
    raise exception 'CR-3 FAILED: the last word was ''switched'', table says %', v_reason;
  end if;
  -- Cleared deliberately: somebody who rewrites their answer and empties the
  -- box has retracted what they wrote, and a stale sentence from two screens
  -- ago is worse than nothing in a report a human reads.
  if v_detail is not null then
    raise exception 'CR-3 FAILED: a cleared note survived as %', v_detail;
  end if;
  if v_user is distinct from 'c7000000-0000-4000-8000-00000000000a'::uuid then
    raise exception 'CR-3 FAILED: whoever spoke last should own the row, got %', v_user;
  end if;
  raise notice 'CR-3 PASSED: one open statement per workspace, last word wins';
end $$;

-- ===========================================================================
-- CR-4: a CONFIRMED statement is history and must never be overwritten. This
-- is the whole reason the index is partial. A plain unique index on company_id
-- would pass CR-3 and silently destroy the record here.
-- ===========================================================================
do $$
declare
  v_total int;
  v_open int;
  v_confirmed_reason text;
begin
  update public.cancellation_reasons
     set confirmed_at = now()
   where company_id = 'c7000000-0000-4000-8000-0000000000c1'::uuid;

  -- They came back, and later left again.
  perform public.api_record_cancellation_reason(
    'c7000000-0000-4000-8000-0000000000c1'::uuid,
    'c7000000-0000-4000-8000-00000000000a'::uuid,
    'not_using', null);

  select count(*) into v_total from public.cancellation_reasons
   where company_id = 'c7000000-0000-4000-8000-0000000000c1'::uuid;
  if v_total is distinct from 2 then
    raise exception 'CR-4 FAILED: expected the old statement kept beside the new, got % row(s)', v_total;
  end if;

  select count(*) into v_open from public.cancellation_reasons
   where company_id = 'c7000000-0000-4000-8000-0000000000c1'::uuid
     and confirmed_at is null;
  if v_open is distinct from 1 then
    raise exception 'CR-4 FAILED: expected exactly one OPEN statement, got %', v_open;
  end if;

  select reason into v_confirmed_reason from public.cancellation_reasons
   where company_id = 'c7000000-0000-4000-8000-0000000000c1'::uuid
     and confirmed_at is not null;
  if v_confirmed_reason is distinct from 'switched' then
    raise exception 'CR-4 FAILED: the confirmed statement was rewritten to %', v_confirmed_reason;
  end if;
  raise notice 'CR-4 PASSED: a confirmed statement is history, and a new one opens beside it';
end $$;

-- ===========================================================================
-- CR-5: service-role only. Every read here is a report the owner of THIS
-- product runs, never something a customer queries.
-- ===========================================================================
do $$
begin
  if has_function_privilege('authenticated',
       'public.api_record_cancellation_reason(uuid, uuid, text, text)', 'execute') then
    raise exception 'CR-5 FAILED: authenticated can record a cancellation reason';
  end if;
  if has_function_privilege('anon',
       'public.api_record_cancellation_reason(uuid, uuid, text, text)', 'execute') then
    raise exception 'CR-5 FAILED: anon can record a cancellation reason';
  end if;
  if has_table_privilege('authenticated', 'public.cancellation_reasons', 'select') then
    raise exception 'CR-5 FAILED: authenticated can read the reasons table';
  end if;
  if not (select relrowsecurity from pg_class
           where oid = 'public.cancellation_reasons'::regclass) then
    raise exception 'CR-5 FAILED: RLS is off on cancellation_reasons';
  end if;
  raise notice 'CR-5 PASSED: recording and reading are service-role only, RLS on';
end $$;

select 'cancellation_reason_upsert.test.sql: CR-1..CR-5 PASSED' as result;

rollback;
