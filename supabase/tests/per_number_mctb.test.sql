-- [#307] Missed-call text-back, per number — assertion suite for
-- supabase/migrations/20260804340000_per_number_mctb.sql.
--
-- MB-1 is the migration's whole promise, and the reason mctb_enabled is
-- nullable rather than `boolean not null default false`: a default of false
-- would silence the text-back on every existing number the moment the
-- migration applied, and a default of true would switch it on for every
-- workspace that had deliberately turned it off. Only null can mean "carry on
-- doing whatever the workspace does".
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/per_number_mctb.test.sql
--
-- One transaction, rolled back. Fixtures use a '6e' id prefix so the file runs
-- standalone OR after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('6e000000-0000-4000-8000-00000000000a'::uuid, 'mctb-a@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   mctb_enabled, mctb_message)
values
  ('6e000000-0000-4000-8000-0000000000c1'::uuid, 'Reed Roofing',
   '6e000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(),
   true, 'Sorry we missed your call.');

insert into public.phone_numbers
  (id, company_id, provisioning_key, country, number_e164, status)
values
  ('6e000000-0000-4000-8000-0000000000b1'::uuid,
   '6e000000-0000-4000-8000-0000000000c1'::uuid, 'pk-6e-1', 'US',
   '+14155550101', 'active');

-- ---------------------------------------------------------------------------
-- MB-1: a new number overrides NOTHING.
--
-- THE MIGRATION'S PROMISE. Both columns are null on a number nobody has
-- touched, so every line keeps texting back exactly as it did before this
-- change shipped.
-- ---------------------------------------------------------------------------
do $$
declare
  v_enabled boolean;
  v_message text;
begin
  select mctb_enabled, mctb_message into v_enabled, v_message
  from public.phone_numbers
  where id = '6e000000-0000-4000-8000-0000000000b1'::uuid;

  if v_enabled is not null then
    raise exception 'MB-1 FAILED: mctb_enabled defaulted to % — every existing number just changed behaviour', v_enabled;
  end if;
  if v_message is not null then
    raise exception 'MB-1 FAILED: mctb_message defaulted to %', v_message;
  end if;
  raise notice 'MB-1 PASSED: a new number inherits both';
end $$;

-- ---------------------------------------------------------------------------
-- MB-2: false is STORABLE and distinct from null.
--
-- The tri-state, at the column. "This line never texts back" and "this line
-- follows the workspace" are different answers, and the yard-sign number in
-- #307's Scope needs the first one while the workspace keeps the second.
-- ---------------------------------------------------------------------------
do $$
declare
  v_enabled boolean;
  v_is_null boolean;
begin
  update public.phone_numbers set mctb_enabled = false
  where id = '6e000000-0000-4000-8000-0000000000b1'::uuid;

  select mctb_enabled, mctb_enabled is null into v_enabled, v_is_null
  from public.phone_numbers
  where id = '6e000000-0000-4000-8000-0000000000b1'::uuid;

  if v_is_null is distinct from false then
    raise exception 'MB-2 FAILED: false did not survive the write';
  end if;
  if v_enabled is distinct from false then
    raise exception 'MB-2 FAILED: expected false, got %', v_enabled;
  end if;

  -- And back to inherit, which is the whole point of "Use the workspace's".
  update public.phone_numbers set mctb_enabled = null
  where id = '6e000000-0000-4000-8000-0000000000b1'::uuid;

  select mctb_enabled is null into v_is_null
  from public.phone_numbers
  where id = '6e000000-0000-4000-8000-0000000000b1'::uuid;

  if v_is_null is distinct from true then
    raise exception 'MB-2 FAILED: a line could not go back to following the workspace';
  end if;
  raise notice 'MB-2 PASSED: on, off and inherit are three distinct states';
end $$;

-- ---------------------------------------------------------------------------
-- MB-3: the per-number message has the workspace's ceiling.
--
-- Without it a number could hold a message the workspace form would reject,
-- and the difference would surface as a carrier-side truncation on a caller
-- who has just been missed.
-- ---------------------------------------------------------------------------
do $$
declare
  v_rejected boolean := false;
begin
  begin
    update public.phone_numbers
    set mctb_message = repeat('x', 1001)
    where id = '6e000000-0000-4000-8000-0000000000b1'::uuid;
  exception when check_violation then
    v_rejected := true;
  end;

  if v_rejected is distinct from true then
    raise exception 'MB-3 FAILED: a 1001-character message was accepted';
  end if;

  -- The ceiling itself is fine — an off-by-one here would reject a message the
  -- workspace form accepts, which is a worse failure than the one above.
  update public.phone_numbers
  set mctb_message = repeat('x', 1000)
  where id = '6e000000-0000-4000-8000-0000000000b1'::uuid;

  raise notice 'MB-3 PASSED: 1000 fits, 1001 does not';
end $$;

rollback;
