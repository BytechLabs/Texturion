-- [#303] The enforcement ladder — assertion suite for
-- 20260804240000_aup_enforcement.sql and 20260804260000_aup_enforcement_audit.sql.
--
-- AU-4 is the one to read twice. A trigger that fires on every UPDATE writes an
-- "enforcement action" row when somebody corrects a typo in the note, and an
-- audit column that cries wolf is one people stop reading — which costs
-- exactly when a real dispute arrives. The transition has to be real.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/aup_enforcement.test.sql
--
-- One transaction, rolled back. Fixtures use a '7c' id prefix so the file runs
-- standalone OR after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('7c000000-0000-4000-8000-00000000000a'::uuid, 'aup-a@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('7c000000-0000-4000-8000-0000000000c1'::uuid, 'Reed Roofing',
   '7c000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());

-- ---------------------------------------------------------------------------
-- AU-1: a new workspace is under no enforcement.
--
-- The default is load-bearing. If it were anything else, every company created
-- from now on would arrive already on the ladder.
-- ---------------------------------------------------------------------------
do $$
declare v_state text;
begin
  select aup_enforcement into v_state
    from public.companies where id = '7c000000-0000-4000-8000-0000000000c1'::uuid;
  if v_state is distinct from 'none' then
    raise exception 'AU-1: a new workspace defaults to %, not none', v_state;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- AU-2: a step cannot be taken without evidence.
--
-- §8 promises we say what happened and why. A row recording a suspension with
-- no timestamp and no note is one nobody can honour that promise from three
-- weeks later, when the dispute arrives and whoever acted has forgotten.
-- ---------------------------------------------------------------------------
do $$
declare v_rejected boolean := false;
begin
  begin
    update public.companies
       set aup_enforcement = 'suspended'
     where id = '7c000000-0000-4000-8000-0000000000c1'::uuid;
  exception when check_violation then
    v_rejected := true;
  end;
  if v_rejected is distinct from true then
    raise exception 'AU-2: a suspension was accepted with no timestamp and no note';
  end if;

  -- And a note too short to mean anything is not a note.
  v_rejected := false;
  begin
    update public.companies
       set aup_enforcement = 'suspended',
           aup_enforcement_at = now(),
           aup_enforcement_note = 'spam'
     where id = '7c000000-0000-4000-8000-0000000000c1'::uuid;
  exception when check_violation then
    v_rejected := true;
  end;
  if v_rejected is distinct from true then
    raise exception 'AU-2: a four-character note was accepted as evidence';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- AU-3: taking a step writes an audit row, with both states.
--
-- A trigger rather than route code, because enforcement is applied by a human
-- in psql today — this test IS that human, and it must still be recorded.
-- ---------------------------------------------------------------------------
do $$
declare v_row record;
begin
  update public.companies
     set aup_enforcement = 'rate_limited',
         aup_enforcement_at = now(),
         aup_enforcement_note = 'Fan-out to 4k fresh numbers overnight; owner emailed.'
   where id = '7c000000-0000-4000-8000-0000000000c1'::uuid;

  -- Selected BY ACTION, not by "the most recent". `now()` is transaction-
  -- scoped, so every row written in this suite shares one occurred_at and
  -- ordering by it picks an arbitrary winner — which is how AU-5 first failed
  -- against a trigger that was working correctly.
  select * into v_row
    from public.audit_log
   where company_id = '7c000000-0000-4000-8000-0000000000c1'::uuid
     and action = 'aup.rate_limited';

  if v_row is null then
    raise exception 'AU-3: applying the ladder wrote no aup.rate_limited row';
  end if;
  if v_row.before->>'aup_enforcement' is distinct from 'none' then
    raise exception 'AU-3: the before state was %, not none',
      v_row.before->>'aup_enforcement';
  end if;
  if v_row.after->>'aup_enforcement' is distinct from 'rate_limited' then
    raise exception 'AU-3: the after state was %', v_row.after->>'aup_enforcement';
  end if;
  -- The evidence travels with the record, so the row is readable without
  -- going back to the company.
  -- coalesced, because `null not like '...'` is NULL, and `if NULL then` is
  -- not taken — so the un-coalesced form silently accepted a missing note.
  -- Found by breaking it: dropping the note from the trigger passed.
  if coalesce(v_row.after->>'note', '') not like '%owner emailed%' then
    raise exception 'AU-3: the note did not reach the audit row (%)',
      coalesce(v_row.after->>'note', '<null>');
  end if;
  -- A platform decision, taken by nobody inside the workspace.
  if v_row.actor_user_id is not null then
    raise exception 'AU-3: an in-workspace actor was recorded for a platform action';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- AU-4: correcting the note is not an enforcement action.
--
-- THE ONE THAT MATTERS. A trigger that fires on every UPDATE writes an
-- "enforcement action" row when somebody fixes a typo, and an audit column
-- that cries wolf is one people stop reading — which costs exactly when a real
-- dispute arrives.
-- ---------------------------------------------------------------------------
do $$
declare v_before bigint; v_after bigint;
begin
  select count(*) into v_before from public.audit_log
   where company_id = '7c000000-0000-4000-8000-0000000000c1'::uuid
     and action like 'aup.%';

  update public.companies
     set aup_enforcement_note = 'Fan-out to 4,000 fresh numbers overnight; owner emailed.'
   where id = '7c000000-0000-4000-8000-0000000000c1'::uuid;

  select count(*) into v_after from public.audit_log
   where company_id = '7c000000-0000-4000-8000-0000000000c1'::uuid
     and action like 'aup.%';

  if v_after is distinct from v_before then
    raise exception
      'AU-4: correcting the note wrote % new enforcement row(s)', v_after - v_before;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- AU-8: re-writing the SAME step is not a new enforcement action.
--
-- The other half of AU-4, and the one the trigger's inner guard actually
-- protects. AU-4 passes on the `after update OF aup_enforcement` clause alone
-- — a note-only UPDATE never reaches the function — so removing the
-- `is not distinct from` check inside it was invisible until this existed.
--
-- It matters because re-asserting a state is a normal thing to do: a second
-- carrier complaint about a workspace already suspended should not read in the
-- audit column as a second suspension.
-- ---------------------------------------------------------------------------
do $$
declare v_before bigint; v_after bigint;
begin
  update public.companies
     set aup_enforcement = 'suspended',
         aup_enforcement_at = now(),
         aup_enforcement_note = 'First complaint; sending stopped.'
   where id = '7c000000-0000-4000-8000-0000000000c1'::uuid;

  select count(*) into v_before from public.audit_log
   where company_id = '7c000000-0000-4000-8000-0000000000c1'::uuid
     and action like 'aup.%';

  -- Same step, written again with fresh evidence.
  update public.companies
     set aup_enforcement = 'suspended',
         aup_enforcement_at = now(),
         aup_enforcement_note = 'Second complaint; already suspended, no change.'
   where id = '7c000000-0000-4000-8000-0000000000c1'::uuid;

  select count(*) into v_after from public.audit_log
   where company_id = '7c000000-0000-4000-8000-0000000000c1'::uuid
     and action like 'aup.%';

  if v_after is distinct from v_before then
    raise exception
      'AU-8: re-asserting the same step wrote % new row(s)', v_after - v_before;
  end if;

  -- Back to none so AU-5 starts from a known state.
  update public.companies
     set aup_enforcement = 'none',
         aup_enforcement_at = null,
         aup_enforcement_note = null
   where id = '7c000000-0000-4000-8000-0000000000c1'::uuid;
end $$;

-- ---------------------------------------------------------------------------
-- AU-5: escalating and lifting are each recorded, with their own verb.
--
-- A reader scanning the action column should see the ladder without opening
-- any JSON. Lifting especially: §8 says a suspension is reversible, and "when
-- was it lifted, and by what reasoning" is asked as often as when it started.
-- ---------------------------------------------------------------------------
do $$
declare v_count int;
begin
  update public.companies
     set aup_enforcement = 'suspended',
         aup_enforcement_at = now(),
         aup_enforcement_note = 'No reply after two emails; pattern unchanged.'
   where id = '7c000000-0000-4000-8000-0000000000c1'::uuid;

  select count(*) into v_count from public.audit_log
   where company_id = '7c000000-0000-4000-8000-0000000000c1'::uuid
     and action = 'aup.suspended';
  if v_count is distinct from 2 then
    raise exception
      'AU-5: expected 2 aup.suspended rows (AU-8''s and this one), got %', v_count;
  end if;

  -- Lifting clears the evidence with it, which the evidence constraint
  -- requires — a workspace in good standing carries no stale reason.
  update public.companies
     set aup_enforcement = 'none',
         aup_enforcement_at = null,
         aup_enforcement_note = null
   where id = '7c000000-0000-4000-8000-0000000000c1'::uuid;

  select count(*) into v_count from public.audit_log
   where company_id = '7c000000-0000-4000-8000-0000000000c1'::uuid
     and action = 'aup.lifted';
  if v_count is distinct from 2 then
    raise exception
      'AU-5: expected 2 aup.lifted rows (AU-8''s and this one), got %', v_count;
  end if;

  -- And each verb appeared exactly once: three steps, three rows, no
  -- duplicates from a trigger firing twice.
  select count(*) into v_count from public.audit_log
   where company_id = '7c000000-0000-4000-8000-0000000000c1'::uuid
     and action like 'aup.%';
  -- rate_limited (AU-3) + suspend/lift (AU-8) + suspend/lift (AU-5) = 5.
  -- An exact count, so a trigger firing twice fails here rather than looking
  -- like thoroughness.
  if v_count is distinct from 5 then
    raise exception 'AU-5: the ladder produced % audit rows, not 5', v_count;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- AU-6: an unknown step is refused.
--
-- The check constraint. Without it a typo becomes a state the send gate has
-- never heard of, which reads as "not suspended" — enforcement that silently
-- does nothing.
-- ---------------------------------------------------------------------------
do $$
declare v_rejected boolean := false;
begin
  begin
    update public.companies
       set aup_enforcement = 'suspend',
           aup_enforcement_at = now(),
           aup_enforcement_note = 'A typo that must not become a state.'
     where id = '7c000000-0000-4000-8000-0000000000c1'::uuid;
  exception when check_violation then
    v_rejected := true;
  end;
  if v_rejected is distinct from true then
    raise exception 'AU-6: the step ''suspend'' was accepted';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- AU-7: enforcement is not the billing suspension.
--
-- The runbook's warning, from the schema's side: the two live on different
-- tables entirely, so no update to one can reach the other. If this ever fails,
-- paying an invoice is about to start lifting abuse suspensions.
-- ---------------------------------------------------------------------------
do $$
declare v_count int;
begin
  select count(*) into v_count
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'phone_numbers'
     and column_name like 'aup%';
  if v_count is distinct from 0 then
    raise exception
      'AU-7: phone_numbers now carries an aup column — the billing path and '
      'the enforcement path have met';
  end if;

  select count(*) into v_count
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'companies'
     and column_name = 'aup_enforcement';
  if v_count is distinct from 1 then
    raise exception 'AU-7: companies.aup_enforcement is missing';
  end if;
end $$;

rollback;
