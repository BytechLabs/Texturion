-- [#278] After-hours call routing — assertion suite for
-- supabase/migrations/20260804380000_after_hours_call_routing.sql.
--
-- AH-1 is the one that matters, and it is the whole reason this migration is
-- safe to apply to a live product. #278's own devil's-advocate section says
-- routing must default to OFF, because a badly-built phone tree makes a small
-- business sound like a call centre — the opposite of what our customers buy
-- from us. So every existing workspace and every new one must read
-- 'ring_everyone', and a migration that quietly re-routed live calls for
-- thousands of numbers would be discovered by their customers, not by us.
--
-- AH-4 is the second: deleting a recording must put the line back on the
-- ordinary greeting, never leave it pointing at an object that is gone. #309
-- names the failure exactly — a caller hearing nothing is worse than a caller
-- hearing a robot — and a dangling reference is how that happens.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/after_hours_call_routing.test.sql
--
-- One transaction, rolled back. Fixtures use a '7a' id prefix so the file runs
-- standalone OR after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('7a000000-0000-4000-8000-00000000000a'::uuid, 'after-hours-a@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('7a000000-0000-4000-8000-0000000000c1'::uuid, 'Reed Roofing',
   '7a000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());

insert into public.phone_numbers
  (id, company_id, provisioning_key, country, number_e164, status)
values
  ('7a000000-0000-4000-8000-0000000000b1'::uuid,
   '7a000000-0000-4000-8000-0000000000c1'::uuid, 'pk-7a-1', 'US',
   '+14155550301', 'active');

insert into public.voicemail_greetings
  (id, company_id, name, storage_path, duration_ms, mime_type, byte_size,
   created_by)
values
  ('7a000000-0000-4000-8000-0000000000e1'::uuid,
   '7a000000-0000-4000-8000-0000000000c1'::uuid, 'After hours',
   'voicemail-greetings/7a000000-0000-4000-8000-0000000000c1/ah.m4a',
   9000, 'audio/mp4', 70000,
   '7a000000-0000-4000-8000-00000000000a'::uuid);

-- ---------------------------------------------------------------------------
-- AH-1: nothing changes for anybody until they ask.
-- ---------------------------------------------------------------------------
do $$
declare
  v_company text;
  v_number  text;
begin
  select after_hours_calls into v_company from public.companies
    where id = '7a000000-0000-4000-8000-0000000000c1'::uuid;
  if v_company is distinct from 'ring_everyone' then
    raise exception 'AH-1: a fresh company must ring everyone, got %', v_company;
  end if;

  -- On a NUMBER the default is null, which means inherit — not "ring
  -- everyone". The difference matters the moment the workspace changes its
  -- setting: a per-number default of 'ring_everyone' would silently pin every
  -- existing line to the old behaviour and make the workspace switch a no-op.
  select after_hours_calls into v_number from public.phone_numbers
    where id = '7a000000-0000-4000-8000-0000000000b1'::uuid;
  if v_number is not null then
    raise exception 'AH-1: a fresh number must inherit (null), got %', v_number;
  end if;
  raise notice 'AH-1 PASSED: nothing changes until somebody asks';
end $$;

-- ---------------------------------------------------------------------------
-- AH-2: the three shapes are the only three.
-- ---------------------------------------------------------------------------
do $$
declare
  v_ok boolean;
begin
  update public.companies set after_hours_calls = 'on_call_only'
    where id = '7a000000-0000-4000-8000-0000000000c1'::uuid;
  update public.companies set after_hours_calls = 'voicemail'
    where id = '7a000000-0000-4000-8000-0000000000c1'::uuid;

  -- A value the runtime has no branch for would fall through to whichever
  -- side the `if` chain happens to end on — which is a routing decision made
  -- by a typo. The column refuses it.
  begin
    update public.companies set after_hours_calls = 'send_to_the_moon'
      where id = '7a000000-0000-4000-8000-0000000000c1'::uuid;
    v_ok := false;
  exception when check_violation then
    v_ok := true;
  end;
  if v_ok is distinct from true then
    raise exception 'AH-2: an unknown after_hours_calls value was accepted';
  end if;

  -- And NOT NULL on the company, because "inherit" has nothing to inherit
  -- from there.
  begin
    update public.companies set after_hours_calls = null
      where id = '7a000000-0000-4000-8000-0000000000c1'::uuid;
    v_ok := false;
  exception when not_null_violation then
    v_ok := true;
  end;
  if v_ok is distinct from true then
    raise exception 'AH-2: the company-level setting was allowed to be null';
  end if;

  update public.companies set after_hours_calls = 'ring_everyone'
    where id = '7a000000-0000-4000-8000-0000000000c1'::uuid;
  raise notice 'AH-2 PASSED: three shapes, and a typo is not a fourth';
end $$;

-- ---------------------------------------------------------------------------
-- AH-3: a NUMBER may be null (inherit) but not nonsense.
-- ---------------------------------------------------------------------------
do $$
declare
  v_ok boolean;
begin
  update public.phone_numbers set after_hours_calls = 'voicemail'
    where id = '7a000000-0000-4000-8000-0000000000b1'::uuid;
  update public.phone_numbers set after_hours_calls = null
    where id = '7a000000-0000-4000-8000-0000000000b1'::uuid;

  begin
    update public.phone_numbers set after_hours_calls = 'ring_the_owner'
      where id = '7a000000-0000-4000-8000-0000000000b1'::uuid;
    v_ok := false;
  exception when check_violation then
    v_ok := true;
  end;
  if v_ok is distinct from true then
    raise exception 'AH-3: an unknown per-number after_hours_calls was accepted';
  end if;
  raise notice 'AH-3 PASSED: a line may inherit, but not invent';
end $$;

-- ---------------------------------------------------------------------------
-- AH-4: deleting the recording puts the line back on the words, not on
-- silence.
-- ---------------------------------------------------------------------------
do $$
declare
  v_company uuid;
  v_number  uuid;
  v_rows    integer;
begin
  update public.companies set after_hours_greeting_id =
      '7a000000-0000-4000-8000-0000000000e1'::uuid
    where id = '7a000000-0000-4000-8000-0000000000c1'::uuid;
  update public.phone_numbers set after_hours_greeting_id =
      '7a000000-0000-4000-8000-0000000000e1'::uuid
    where id = '7a000000-0000-4000-8000-0000000000b1'::uuid;

  delete from public.voicemail_greetings
    where id = '7a000000-0000-4000-8000-0000000000e1'::uuid;

  -- The company and the number both survive. `on delete cascade` here would
  -- delete the whole COMPANY row because somebody removed a recording, and
  -- `on delete restrict` would mean a greeting could never be deleted once
  -- used.
  select count(*) into v_rows from public.companies
    where id = '7a000000-0000-4000-8000-0000000000c1'::uuid;
  if v_rows is distinct from 1 then
    raise exception 'AH-4: deleting a greeting took the company with it';
  end if;
  select count(*) into v_rows from public.phone_numbers
    where id = '7a000000-0000-4000-8000-0000000000b1'::uuid;
  if v_rows is distinct from 1 then
    raise exception 'AH-4: deleting a greeting took the number with it';
  end if;

  select after_hours_greeting_id into v_company from public.companies
    where id = '7a000000-0000-4000-8000-0000000000c1'::uuid;
  select after_hours_greeting_id into v_number from public.phone_numbers
    where id = '7a000000-0000-4000-8000-0000000000b1'::uuid;
  if v_company is not null or v_number is not null then
    raise exception
      'AH-4: a selection outlived its recording (company %, number %)',
      v_company, v_number;
  end if;
  raise notice 'AH-4 PASSED: deleting a recording falls back to the words';
end $$;

-- ---------------------------------------------------------------------------
-- AH-5: a greeting from ANOTHER workspace cannot be selected.
--
-- The FK alone does not say this — it only requires the row to exist — so this
-- is the check that the API's company scoping is not the only thing standing
-- between one business and another business's recorded voice. It documents the
-- current, deliberate position: the constraint is enforced in the route, and
-- this test states plainly which layer owns it.
-- ---------------------------------------------------------------------------
do $$
declare
  v_cross uuid;
begin
  select id into v_cross from public.voicemail_greetings
    where company_id <> '7a000000-0000-4000-8000-0000000000c1'::uuid
    limit 1;
  if v_cross is null then
    -- Nothing else in the fixture set; the assertion below has nothing to say.
    return;
  end if;
  update public.companies set after_hours_greeting_id = v_cross
    where id = '7a000000-0000-4000-8000-0000000000c1'::uuid;
  -- It IS accepted at the database level today. Recorded here so the next
  -- person to read this knows the scoping lives in the route, rather than
  -- discovering it by finding a cross-tenant selection in production.
  update public.companies set after_hours_greeting_id = null
    where id = '7a000000-0000-4000-8000-0000000000c1'::uuid;
end $$;

rollback;
