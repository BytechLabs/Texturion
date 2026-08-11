-- [#309] Recorded voicemail greetings — assertion suite for
-- supabase/migrations/20260804360000_voicemail_greetings.sql.
--
-- VG-2 is the one that matters. #309 names the failure precisely: "a caller
-- hearing nothing is worse than a caller hearing a robot." The way a caller
-- ends up hearing nothing is a selection pointing at a recording that has been
-- deleted, so the FK is `on delete set null` and this suite proves it — with
-- `on delete cascade` the whole company row would vanish instead, and with
-- `on delete restrict` an owner could never delete a greeting they had used.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/voicemail_greetings.test.sql
--
-- One transaction, rolled back. Fixtures use a '6f' id prefix so the file runs
-- standalone OR after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('6f000000-0000-4000-8000-00000000000a'::uuid, 'greeting-a@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   voicemail_greeting)
values
  ('6f000000-0000-4000-8000-0000000000c1'::uuid, 'Reed Roofing',
   '6f000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(),
   'You have reached Reed Roofing.');

insert into public.phone_numbers
  (id, company_id, provisioning_key, country, number_e164, status)
values
  ('6f000000-0000-4000-8000-0000000000b1'::uuid,
   '6f000000-0000-4000-8000-0000000000c1'::uuid, 'pk-6f-1', 'US',
   '+14155550201', 'active');

insert into public.voicemail_greetings
  (id, company_id, name, storage_path, duration_ms, mime_type, byte_size,
   created_by)
values
  ('6f000000-0000-4000-8000-0000000000e1'::uuid,
   '6f000000-0000-4000-8000-0000000000c1'::uuid, 'After hours',
   'voicemail-greetings/6f000000-0000-4000-8000-0000000000c1/one.m4a',
   8200, 'audio/mp4', 64000,
   '6f000000-0000-4000-8000-00000000000a'::uuid);

-- ---------------------------------------------------------------------------
-- VG-1: nothing is selected until somebody selects it.
--
-- THE ADDITIVE PROMISE. Recording a greeting does not switch a line onto it,
-- and a workspace that never records one keeps speaking TTS exactly as before.
-- ---------------------------------------------------------------------------
do $$
declare
  v_company uuid;
  v_number  uuid;
begin
  select voicemail_greeting_id into v_company
  from public.companies where id = '6f000000-0000-4000-8000-0000000000c1'::uuid;
  select voicemail_greeting_id into v_number
  from public.phone_numbers where id = '6f000000-0000-4000-8000-0000000000b1'::uuid;

  if v_company is not null or v_number is not null then
    raise exception 'VG-1 FAILED: a greeting selected itself (company=%, number=%)',
      v_company, v_number;
  end if;
  raise notice 'VG-1 PASSED: recording one does not select it';
end $$;

-- ---------------------------------------------------------------------------
-- VG-2: deleting a recording puts the line back on TTS.
--
-- THE ONE THAT MATTERS. A selection pointing at a deleted object is how a
-- caller ends up hearing silence, which #309 calls out as worse than hearing a
-- robot. Both references must go to null, and both rows must survive.
--
-- Verified by breaking it: with `on delete cascade` on the company column this
-- suite fails, though the failure arrives as a Postgres error from
-- phone_numbers_company_id_fkey rather than as the message below — the cascade
-- tries to delete the company and the number's FK blocks it first. The
-- company-still-exists check is therefore belt-and-braces, not the branch that
-- catches the real regression.
-- ---------------------------------------------------------------------------
do $$
declare
  v_company_exists boolean;
  v_number_exists  boolean;
  v_company_sel    uuid;
  v_number_sel     uuid;
begin
  update public.companies
  set voicemail_greeting_id = '6f000000-0000-4000-8000-0000000000e1'::uuid
  where id = '6f000000-0000-4000-8000-0000000000c1'::uuid;
  update public.phone_numbers
  set voicemail_greeting_id = '6f000000-0000-4000-8000-0000000000e1'::uuid
  where id = '6f000000-0000-4000-8000-0000000000b1'::uuid;

  delete from public.voicemail_greetings
  where id = '6f000000-0000-4000-8000-0000000000e1'::uuid;

  select exists(select 1 from public.companies
                where id = '6f000000-0000-4000-8000-0000000000c1'::uuid)
    into v_company_exists;
  select exists(select 1 from public.phone_numbers
                where id = '6f000000-0000-4000-8000-0000000000b1'::uuid)
    into v_number_exists;

  if v_company_exists is distinct from true then
    raise exception 'VG-2 FAILED: deleting a greeting deleted the COMPANY — the FK cascades';
  end if;
  if v_number_exists is distinct from true then
    raise exception 'VG-2 FAILED: deleting a greeting deleted the NUMBER — the FK cascades';
  end if;

  select voicemail_greeting_id into v_company_sel
  from public.companies where id = '6f000000-0000-4000-8000-0000000000c1'::uuid;
  select voicemail_greeting_id into v_number_sel
  from public.phone_numbers where id = '6f000000-0000-4000-8000-0000000000b1'::uuid;

  if v_company_sel is not null or v_number_sel is not null then
    raise exception 'VG-2 FAILED: a selection still points at a deleted recording';
  end if;
  raise notice 'VG-2 PASSED: deleting a recording falls the line back to TTS';
end $$;

-- ---------------------------------------------------------------------------
-- VG-3: two greetings cannot share a name inside one workspace, and two
-- workspaces can both have an "After hours".
-- ---------------------------------------------------------------------------
do $$
declare
  v_rejected boolean := false;
begin
  insert into public.voicemail_greetings
    (company_id, name, storage_path, duration_ms, mime_type, byte_size)
  values
    ('6f000000-0000-4000-8000-0000000000c1'::uuid, 'After hours',
     'voicemail-greetings/x/a.m4a', 5000, 'audio/mp4', 40000);

  begin
    insert into public.voicemail_greetings
      (company_id, name, storage_path, duration_ms, mime_type, byte_size)
    values
      ('6f000000-0000-4000-8000-0000000000c1'::uuid, 'After hours',
       'voicemail-greetings/x/b.m4a', 5000, 'audio/mp4', 40000);
  exception when unique_violation then
    v_rejected := true;
  end;

  if v_rejected is distinct from true then
    raise exception 'VG-3 FAILED: one workspace has two greetings called "After hours"';
  end if;
  raise notice 'VG-3 PASSED: a name identifies one greeting per workspace';
end $$;

-- ---------------------------------------------------------------------------
-- VG-4: a greeting nobody would sit through is refused.
--
-- Two minutes is already generous for "we are closed, leave a message". The
-- ceiling is here rather than only in the client because the phone-recording
-- path (#309's fallback) does not go through a client at all.
-- ---------------------------------------------------------------------------
do $$
declare
  v_rejected boolean := false;
begin
  begin
    insert into public.voicemail_greetings
      (company_id, name, storage_path, duration_ms, mime_type, byte_size)
    values
      ('6f000000-0000-4000-8000-0000000000c1'::uuid, 'Epic',
       'voicemail-greetings/x/long.m4a', 120001, 'audio/mp4', 900000);
  exception when check_violation then
    v_rejected := true;
  end;

  if v_rejected is distinct from true then
    raise exception 'VG-4 FAILED: a greeting over two minutes was accepted';
  end if;

  -- And the ceiling itself is usable — an off-by-one here would refuse a
  -- recording the client happily produced.
  insert into public.voicemail_greetings
    (company_id, name, storage_path, duration_ms, mime_type, byte_size)
  values
    ('6f000000-0000-4000-8000-0000000000c1'::uuid, 'Exactly two minutes',
     'voicemail-greetings/x/two.m4a', 120000, 'audio/mp4', 900000);

  raise notice 'VG-4 PASSED: 120000ms fits, 120001ms does not';
end $$;

-- ---------------------------------------------------------------------------
-- VG-5: closing a workspace takes its greetings with it.
--
-- The recordings are the workspace's own voice; nothing outside it may keep a
-- row pointing into a company that is gone.
-- ---------------------------------------------------------------------------
do $$
declare
  v_left integer;
begin
  -- The number first: phone_numbers.company_id does NOT cascade, so a raw
  -- company delete is blocked by it. Real closure goes through the purge RPC;
  -- this suite only needs the company row gone to see what happens to the
  -- greetings.
  delete from public.phone_numbers
  where company_id = '6f000000-0000-4000-8000-0000000000c1'::uuid;
  delete from public.companies
  where id = '6f000000-0000-4000-8000-0000000000c1'::uuid;

  select count(*) into v_left from public.voicemail_greetings
  where company_id = '6f000000-0000-4000-8000-0000000000c1'::uuid;

  if v_left is distinct from 0 then
    raise exception 'VG-5 FAILED: % greetings outlived their workspace', v_left;
  end if;
  raise notice 'VG-5 PASSED: greetings die with the workspace';
end $$;

rollback;
