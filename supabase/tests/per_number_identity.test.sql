-- [#307] A second number is a second business — assertion suite for
-- supabase/migrations/20260804320000_per_number_identity.sql.
--
-- PN-1 is the migration's whole promise: every existing number is all-null,
-- so nobody's greeting changes on deploy. A default on any of these columns
-- would silently re-configure every line in production the moment it applied.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/per_number_identity.test.sql
--
-- One transaction, rolled back. Fixtures use a '6d' id prefix so the file runs
-- standalone OR after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('6d000000-0000-4000-8000-00000000000a'::uuid, 'identity-a@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   voicemail_greeting)
values
  ('6d000000-0000-4000-8000-0000000000c1'::uuid, 'Reed Roofing',
   '6d000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(),
   'You have reached Reed Roofing.');

insert into public.phone_numbers
  (id, company_id, provisioning_key, country, number_e164, status)
values
  ('6d000000-0000-4000-8000-0000000000b1'::uuid,
   '6d000000-0000-4000-8000-0000000000c1'::uuid, 'pk-6d-1', 'US',
   '+14155550001', 'active');

-- ---------------------------------------------------------------------------
-- PN-1: a new number overrides NOTHING.
--
-- THE MIGRATION'S PROMISE. Every column is null, so a number added today
-- behaves exactly as one added before this change. A default on any of them
-- would re-configure every line in production the moment the migration ran,
-- and the first evidence would be a customer hearing the wrong greeting.
-- ---------------------------------------------------------------------------
do $$
declare v_row record;
begin
  select * into v_row from public.phone_numbers
   where id = '6d000000-0000-4000-8000-0000000000b1'::uuid;

  if v_row.label is not null
     or v_row.voicemail_greeting is not null
     or v_row.away_message is not null
     or v_row.away_enabled is not null
     or v_row.timezone is not null
     or v_row.business_hours is not null
     or v_row.business_hours_exceptions is not null then
    raise exception
      'PN-1: a new number arrives with an override — the deploy is not a no-op';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PN-2: away_enabled is TRI-state.
--
-- A boolean defaulting to false could not express "follow the workspace",
-- which is what every existing number must keep doing. All three states have
-- to be storable and distinguishable.
-- ---------------------------------------------------------------------------
do $$
declare v_value boolean; v_is_null boolean;
begin
  update public.phone_numbers set away_enabled = false
   where id = '6d000000-0000-4000-8000-0000000000b1'::uuid;
  select away_enabled, away_enabled is null into v_value, v_is_null
    from public.phone_numbers where id = '6d000000-0000-4000-8000-0000000000b1'::uuid;
  if v_is_null or v_value is distinct from false then
    raise exception 'PN-2: an explicit false did not survive as false';
  end if;

  update public.phone_numbers set away_enabled = null
   where id = '6d000000-0000-4000-8000-0000000000b1'::uuid;
  select away_enabled is null into v_is_null
    from public.phone_numbers where id = '6d000000-0000-4000-8000-0000000000b1'::uuid;
  if v_is_null is distinct from true then
    raise exception 'PN-2: clearing the override did not return it to inherit';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PN-3: a label cannot be blank.
--
-- The schema's half of the "null means inherit, never empty" rule. A
-- whitespace label would resolve as a real override and give the line a name
-- made of spaces — on the greeting, the caller ID and every automated reply
-- at once. The resolver trims too (NI-6); this stops it reaching the column.
-- ---------------------------------------------------------------------------
do $$
declare v_rejected boolean := false;
begin
  begin
    update public.phone_numbers set label = '   '
     where id = '6d000000-0000-4000-8000-0000000000b1'::uuid;
  exception when check_violation then
    v_rejected := true;
  end;
  if v_rejected is distinct from true then
    raise exception 'PN-3: a whitespace-only label was accepted';
  end if;

  -- And a real one is fine.
  update public.phone_numbers set label = 'Reed Roofing Sales'
   where id = '6d000000-0000-4000-8000-0000000000b1'::uuid;
end $$;

-- ---------------------------------------------------------------------------
-- PN-4: the overrides are per NUMBER, not per company.
--
-- The bug this issue is about, asserted from the schema's side: setting a
-- second line's greeting must not touch the first one's.
-- ---------------------------------------------------------------------------
do $$
declare v_first text; v_second text;
begin
  insert into public.phone_numbers
    (id, company_id, provisioning_key, country, number_e164, status,
     voicemail_greeting)
  values
    ('6d000000-0000-4000-8000-0000000000b2'::uuid,
     '6d000000-0000-4000-8000-0000000000c1'::uuid, 'pk-6d-2', 'US',
     '+14155550002', 'active', 'Sales line. Leave your number.');

  select voicemail_greeting into v_first from public.phone_numbers
   where id = '6d000000-0000-4000-8000-0000000000b1'::uuid;
  select voicemail_greeting into v_second from public.phone_numbers
   where id = '6d000000-0000-4000-8000-0000000000b2'::uuid;

  if v_first is not null then
    raise exception
      'PN-4: setting the second line''s greeting changed the first (%)', v_first;
  end if;
  if v_second is distinct from 'Sales line. Leave your number.' then
    raise exception 'PN-4: the second line''s greeting did not stick (%)', v_second;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PN-5: the company's own values are untouched.
--
-- Overriding a line must never write through to the workspace — that is the
-- direction that would change every OTHER line, including ones the owner
-- never opened.
-- ---------------------------------------------------------------------------
do $$
declare v_company text;
begin
  select voicemail_greeting into v_company from public.companies
   where id = '6d000000-0000-4000-8000-0000000000c1'::uuid;
  if v_company is distinct from 'You have reached Reed Roofing.' then
    raise exception
      'PN-5: the workspace greeting changed when a line was overridden (%)', v_company;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PN-6: a greeting cannot be unbounded.
--
-- It is read aloud by TTS on a live call, and it is somebody else's phone bill
-- while it plays.
-- ---------------------------------------------------------------------------
do $$
declare v_rejected boolean := false;
begin
  begin
    update public.phone_numbers set voicemail_greeting = repeat('a', 1001)
     where id = '6d000000-0000-4000-8000-0000000000b1'::uuid;
  exception when check_violation then
    v_rejected := true;
  end;
  if v_rejected is distinct from true then
    raise exception 'PN-6: a 1001-character greeting was accepted';
  end if;
end $$;

rollback;
