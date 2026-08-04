-- [#278] Ring strategy and window — assertion suite for
-- supabase/migrations/20260804400000_ring_strategy.sql.
--
-- RS-1 is the deploy-day guarantee, same as the after-hours suite's: every
-- workspace and every line must behave exactly as they did, because the
-- alternative is thousands of numbers changing how they ring on a deploy
-- nobody asked for.
--
-- RS-3 is the one worth reading. The 45-second ceiling is not a taste
-- judgement — it is RING_TIMEOUT_SECS, the leg-level bound each dial carries,
-- which the calls-v3 spec marks load-bearing. A session window longer than the
-- leg timeout is a window during which the legs have already died, so the
-- column refuses to express it rather than letting a screen promise sixty
-- seconds of ringing that cannot happen.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/ring_strategy.test.sql
--
-- One transaction, rolled back. Fixtures use a '7b' id prefix so the file runs
-- standalone OR after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('7b000000-0000-4000-8000-00000000000a'::uuid, 'ring-a@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('7b000000-0000-4000-8000-0000000000c1'::uuid, 'Reed Roofing',
   '7b000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());

insert into public.phone_numbers
  (id, company_id, provisioning_key, country, number_e164, status)
values
  ('7b000000-0000-4000-8000-0000000000b1'::uuid,
   '7b000000-0000-4000-8000-0000000000c1'::uuid, 'pk-7b-1', 'US',
   '+14155550401', 'active');

-- ---------------------------------------------------------------------------
-- RS-1: nothing rings differently until somebody asks.
-- ---------------------------------------------------------------------------
do $$
declare
  v_strategy text;
  v_seconds  integer;
  v_n_strat  text;
  v_n_secs   integer;
begin
  select ring_strategy, ring_seconds into v_strategy, v_seconds
    from public.companies where id = '7b000000-0000-4000-8000-0000000000c1'::uuid;
  if v_strategy is distinct from 'all' then
    raise exception 'RS-1: a fresh company must ring all phones, got %', v_strategy;
  end if;
  -- 45 is RING_WINDOW_SECS, the window the product used before this column
  -- existed. Any other default silently shortens or lengthens every call.
  if v_seconds is distinct from 45 then
    raise exception 'RS-1: a fresh company must ring for 45s, got %', v_seconds;
  end if;

  select ring_strategy, ring_seconds into v_n_strat, v_n_secs
    from public.phone_numbers where id = '7b000000-0000-4000-8000-0000000000b1'::uuid;
  if v_n_strat is not null or v_n_secs is not null then
    raise exception 'RS-1: a fresh number must inherit both (%, %)', v_n_strat, v_n_secs;
  end if;
  raise notice 'RS-1 PASSED: nothing rings differently until somebody asks';
end $$;

-- ---------------------------------------------------------------------------
-- RS-2: two strategies, and a typo is not a third.
-- ---------------------------------------------------------------------------
do $$
declare
  v_ok boolean;
begin
  update public.companies set ring_strategy = 'in_turn'
    where id = '7b000000-0000-4000-8000-0000000000c1'::uuid;
  update public.phone_numbers set ring_strategy = 'all'
    where id = '7b000000-0000-4000-8000-0000000000b1'::uuid;
  update public.phone_numbers set ring_strategy = null
    where id = '7b000000-0000-4000-8000-0000000000b1'::uuid;

  -- A value the machine has no branch for would fall through to whichever
  -- side its `if` ends on — a ring decision made by a typo.
  begin
    update public.companies set ring_strategy = 'round_robin'
      where id = '7b000000-0000-4000-8000-0000000000c1'::uuid;
    v_ok := false;
  exception when check_violation then
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'RS-2: an unknown ring_strategy was accepted';
  end if;

  update public.companies set ring_strategy = 'all'
    where id = '7b000000-0000-4000-8000-0000000000c1'::uuid;
  raise notice 'RS-2 PASSED: two strategies, and a typo is not a third';
end $$;

-- ---------------------------------------------------------------------------
-- RS-3: the window cannot outlive the legs it waits on.
-- ---------------------------------------------------------------------------
do $$
declare
  v_ok boolean;
begin
  -- Both ends of the range are reachable, so the column is a range and not a
  -- constant with extra steps.
  update public.companies set ring_seconds = 10
    where id = '7b000000-0000-4000-8000-0000000000c1'::uuid;
  update public.companies set ring_seconds = 45
    where id = '7b000000-0000-4000-8000-0000000000c1'::uuid;

  -- THE ONE THAT MATTERS. 46 seconds of "ringing" is one second during which
  -- every leg has already timed out at RING_TIMEOUT_SECS and nothing is
  -- ringing at all — a promise the product cannot keep, refused by the column
  -- rather than by a comment somebody has to remember.
  begin
    update public.companies set ring_seconds = 60
      where id = '7b000000-0000-4000-8000-0000000000c1'::uuid;
    v_ok := false;
  exception when check_violation then
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'RS-3: a window longer than the leg timeout was accepted';
  end if;

  -- And a window so short the crew could not have been woken by a push yet
  -- reads to a caller as nobody being there.
  begin
    update public.companies set ring_seconds = 3
      where id = '7b000000-0000-4000-8000-0000000000c1'::uuid;
    v_ok := false;
  exception when check_violation then
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'RS-3: a window too short to answer was accepted';
  end if;

  update public.companies set ring_seconds = 45
    where id = '7b000000-0000-4000-8000-0000000000c1'::uuid;
  raise notice 'RS-3 PASSED: the window cannot outlive the legs it waits on';
end $$;

-- ---------------------------------------------------------------------------
-- RS-4: a NUMBER may inherit, but not invent.
-- ---------------------------------------------------------------------------
do $$
declare
  v_ok boolean;
begin
  update public.phone_numbers set ring_seconds = 20
    where id = '7b000000-0000-4000-8000-0000000000b1'::uuid;
  update public.phone_numbers set ring_seconds = null
    where id = '7b000000-0000-4000-8000-0000000000b1'::uuid;

  begin
    update public.phone_numbers set ring_seconds = 300
      where id = '7b000000-0000-4000-8000-0000000000b1'::uuid;
    v_ok := false;
  exception when check_violation then
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'RS-4: a per-number window past the leg timeout was accepted';
  end if;
  raise notice 'RS-4 PASSED: a line may inherit, but not invent';
end $$;

rollback;
