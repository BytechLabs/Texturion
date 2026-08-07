-- [#397] Per-workspace call silence — assertion suite for
-- supabase/migrations/20260730000800_call_silence.sql.
--
-- Call volume is the lowest-volume signal in the product, so the false-alarm
-- cases are what this mostly pins. A three-person crew can genuinely take no
-- calls for a fortnight; telling the founder that customer is leaving would
-- burn the one alert that matters when it is real.
--
-- One transaction, rolled back. Fixtures use a 'ba' id prefix.

\set ON_ERROR_STOP on

begin;

delete from public.call_silence_state;
delete from public.calls;

insert into auth.users (id, email) values
  ('ba000000-0000-4000-8000-00000000000a'::uuid, 'silence-owner@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status)
values
  -- Established rhythm, now nothing: the case this exists for.
  ('ba000000-0000-4000-8000-0000000000c1'::uuid, 'Gone Quiet Co',
   'ba000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(), 'active'),
  -- Never took calls. Cannot stop.
  ('ba000000-0000-4000-8000-0000000000c2'::uuid, 'No Calls Co',
   'ba000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(), 'active'),
  -- Still busy.
  ('ba000000-0000-4000-8000-0000000000c3'::uuid, 'Busy Co',
   'ba000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(), 'active');

create or replace function pg_temp.seed_calls(
  p_company uuid, p_count int, p_age_days int
) returns void language plpgsql as $$
begin
  -- call_session_id is NOT NULL and is the DO's idFromName key; any unique
  -- value serves here.
  insert into public.calls (company_id, call_session_id, direction, created_at)
  select p_company, gen_random_uuid()::text, 'inbound',
         now() - make_interval(days => p_age_days)
  from generate_series(1, p_count);
end $$;

-- c1: ~40 calls across the baseline window, none in the recent fortnight.
select pg_temp.seed_calls('ba000000-0000-4000-8000-0000000000c1'::uuid, 40, 30);
-- c3: the same history, and still taking them.
select pg_temp.seed_calls('ba000000-0000-4000-8000-0000000000c3'::uuid, 40, 30);
select pg_temp.seed_calls('ba000000-0000-4000-8000-0000000000c3'::uuid, 10, 3);
-- c2 gets nothing at all.

do $$
declare
  v_state text;
begin
  perform public.api_assess_call_silence();

  select state into v_state from public.call_silence_state
   where company_id = 'ba000000-0000-4000-8000-0000000000c1'::uuid;
  if v_state is distinct from 'silent' then
    raise exception
      'a workspace with an established call rhythm and zero recent calls must '
      'be flagged, got %', v_state;
  end if;

  -- THE false alarm. A workspace that never took calls cannot stop taking
  -- them, and flagging it would be flagging somebody who does not use voice.
  select state into v_state from public.call_silence_state
   where company_id = 'ba000000-0000-4000-8000-0000000000c2'::uuid;
  if v_state is distinct from 'ok' then
    raise exception
      'a workspace with no call history was flagged as silent — it never had a '
      'rhythm to lose, got %', v_state;
  end if;

  select state into v_state from public.call_silence_state
   where company_id = 'ba000000-0000-4000-8000-0000000000c3'::uuid;
  if v_state is distinct from 'ok' then
    raise exception 'a busy workspace was flagged as silent, got %', v_state;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Only a TRANSITION is news, and the clock does not restart.
-- ---------------------------------------------------------------------------

do $$
declare
  v_changed int;
  v_since   timestamptz;
  v_after   timestamptz;
begin
  select silent_since into v_since from public.call_silence_state
   where company_id = 'ba000000-0000-4000-8000-0000000000c1'::uuid;

  select count(*) into v_changed from public.api_assess_call_silence();
  if v_changed is distinct from 0 then
    raise exception
      'a workspace silent since yesterday is not news today; got % transitions',
      v_changed;
  end if;

  select silent_since into v_after from public.call_silence_state
   where company_id = 'ba000000-0000-4000-8000-0000000000c1'::uuid;
  if v_after is distinct from v_since then
    raise exception 'silent_since must be held across assessments';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Recovery clears it, and is reported.
-- ---------------------------------------------------------------------------

do $$
declare
  v_state text;
  v_since timestamptz;
  v_rows  int;
begin
  perform pg_temp.seed_calls('ba000000-0000-4000-8000-0000000000c1'::uuid, 5, 1);

  select count(*) into v_rows from public.api_assess_call_silence();
  if v_rows is distinct from 1 then
    raise exception 'coming back must be reported as a transition, got %', v_rows;
  end if;

  select state, silent_since into v_state, v_since from public.call_silence_state
   where company_id = 'ba000000-0000-4000-8000-0000000000c1'::uuid;
  if v_state is distinct from 'ok' or v_since is not null then
    raise exception 'recovery must clear both the state and the clock';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------------

do $$
begin
  if has_function_privilege('anon', 'public.api_assess_call_silence()', 'execute')
     or has_function_privilege('authenticated', 'public.api_assess_call_silence()', 'execute')
  then
    raise exception 'api_assess_call_silence must not be reachable by anon/authenticated';
  end if;
end $$;

rollback;
