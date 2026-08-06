-- [#283] Runtime feature flags — assertion suite for
-- supabase/migrations/20260730000200_feature_flags.sql.
--
-- Two things are pinned here, and they are the two that would hurt.
--
-- PRECEDENCE, because the order is the product. A per-workspace override that
-- lost to a global switch would make "ship to the founder first" impossible;
-- a percentage that beat a global OFF would make the kill switch a suggestion.
--
-- BUCKET STABILITY, because a company that flapped in and out of a 10% rollout
-- on consecutive requests would watch a feature appear and disappear mid-task,
-- which is worse than never having it.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/feature_flags.test.sql
--
-- One transaction, rolled back. Fixtures use a 'ce' id prefix so the file runs
-- standalone OR after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('ce000000-0000-4000-8000-00000000000a'::uuid, 'flags-owner@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at, is_internal)
values
  ('ce000000-0000-4000-8000-0000000000c1'::uuid, 'Internal Co',
   'ce000000-0000-4000-8000-00000000000a'::uuid, 'CA', '416', now(), true),
  ('ce000000-0000-4000-8000-0000000000c2'::uuid, 'Outside Co',
   'ce000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(), false);

-- ---------------------------------------------------------------------------
-- An empty table says nothing. This is the safe state and has to stay that way.
-- ---------------------------------------------------------------------------

do $$
declare
  v_flags jsonb;
begin
  v_flags := public.api_evaluate_flags('ce000000-0000-4000-8000-0000000000c2'::uuid);
  if v_flags is distinct from '{}'::jsonb then
    raise exception
      'with no rows, evaluation must return {} so every key falls through to '
      'its code default; got %', v_flags::text;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The global switch.
-- ---------------------------------------------------------------------------

do $$
declare
  v_result jsonb;
begin
  v_result := public.api_set_feature_flag('kill:calls', false, null, false, 'incident', null);

  if (public.api_evaluate_flags('ce000000-0000-4000-8000-0000000000c2'::uuid) ->> 'kill:calls')
     is distinct from 'false' then
    raise exception 'a global off must reach a workspace with no override';
  end if;

  -- The reach is reported because "off" is an abstraction and "0 of 41
  -- workspaces still have calls" is a decision. Asserted as a relationship
  -- rather than a literal: this database may carry rows from local dev, and a
  -- test that breaks on somebody's seed data teaches people to ignore it.
  if (v_result->>'active_companies')::int < 2 then
    raise exception 'expected at least the 2 fixtures, got %',
      v_result->>'active_companies';
  end if;
  if (v_result->>'reached_companies')::int is distinct from 0 then
    raise exception 'a global off should reach nobody, got %', v_result->>'reached_companies';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- A per-workspace override beats the global switch — in BOTH directions.
-- ---------------------------------------------------------------------------

do $$
begin
  -- On, against a global off: the founder keeps a feature everyone else lost.
  perform public.api_override_feature_flag(
    'kill:calls', 'ce000000-0000-4000-8000-0000000000c1'::uuid, true, 'testing the fix', null
  );
  if (public.api_evaluate_flags('ce000000-0000-4000-8000-0000000000c1'::uuid) ->> 'kill:calls')
     is distinct from 'true' then
    raise exception 'an override ON must beat a global OFF';
  end if;
  -- And the workspace next door is untouched.
  if (public.api_evaluate_flags('ce000000-0000-4000-8000-0000000000c2'::uuid) ->> 'kill:calls')
     is distinct from 'false' then
    raise exception 'an override must not leak to another workspace';
  end if;

  -- Off, against a global on: one workspace contained without touching anyone
  -- else — the single-tenant incident response.
  perform public.api_set_feature_flag('kill:ai', true, null, false, null, null);
  perform public.api_override_feature_flag(
    'kill:ai', 'ce000000-0000-4000-8000-0000000000c2'::uuid, false, 'runaway cost', null
  );
  if (public.api_evaluate_flags('ce000000-0000-4000-8000-0000000000c2'::uuid) ->> 'kill:ai')
     is distinct from 'false' then
    raise exception 'an override OFF must beat a global ON';
  end if;
  if (public.api_evaluate_flags('ce000000-0000-4000-8000-0000000000c1'::uuid) ->> 'kill:ai')
     is distinct from 'true' then
    raise exception 'the other workspace must keep the global ON';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Internal-only: the beta cohort, and it ignores any percentage.
-- ---------------------------------------------------------------------------

do $$
begin
  perform public.api_set_feature_flag('rollout:demo', true, 100, true, 'internal first', null);

  if (public.api_evaluate_flags('ce000000-0000-4000-8000-0000000000c1'::uuid) ->> 'rollout:demo')
     is distinct from 'true' then
    raise exception 'the internal cohort must receive an internal-only flag';
  end if;
  -- 100% AND internal-only must still mean internal only, or "internal" is
  -- just a label on a full rollout.
  if (public.api_evaluate_flags('ce000000-0000-4000-8000-0000000000c2'::uuid) ->> 'rollout:demo')
     is distinct from 'false' then
    raise exception 'internal_only must exclude everyone else, even at 100 percent';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Percentage rollout: stable, spread, and never above a global OFF.
-- ---------------------------------------------------------------------------

do $$
declare
  v_first  int;
  v_second int;
  v_low    int;
  v_high   int;
begin
  -- The same company and flag must land in the same bucket forever. A bucket
  -- that moved would flicker a feature under somebody mid-task.
  v_first := public.flag_bucket('rollout:x', 'ce000000-0000-4000-8000-0000000000c1'::uuid);
  v_second := public.flag_bucket('rollout:x', 'ce000000-0000-4000-8000-0000000000c1'::uuid);
  if v_first is distinct from v_second then
    raise exception 'a bucket must be stable, got % then %', v_first, v_second;
  end if;
  if v_first < 0 or v_first > 99 then
    raise exception 'a bucket must be 0-99, got %', v_first;
  end if;

  -- Two different flags must not land on the same tenth of the customer base,
  -- or every 10% rollout would hit the same unlucky workspaces.
  if public.flag_bucket('rollout:x', 'ce000000-0000-4000-8000-0000000000c1'::uuid)
     = public.flag_bucket('rollout:y', 'ce000000-0000-4000-8000-0000000000c1'::uuid)
     and public.flag_bucket('rollout:x', 'ce000000-0000-4000-8000-0000000000c2'::uuid)
       = public.flag_bucket('rollout:y', 'ce000000-0000-4000-8000-0000000000c2'::uuid)
  then
    raise exception 'the bucket must depend on the flag key, not the company alone';
  end if;

  -- 0% reaches nobody and 100% reaches everybody. The two ends have to be
  -- exact, because they are how a rollout starts and finishes.
  perform public.api_set_feature_flag('rollout:pct', true, 0, false, null, null);
  select count(*) into v_low from public.companies c
   where (public.api_evaluate_flags(c.id) ->> 'rollout:pct') = 'true';
  if v_low is distinct from 0 then
    raise exception '0 percent must reach nobody, reached %', v_low;
  end if;

  perform public.api_set_feature_flag('rollout:pct', true, 100, false, null, null);
  select count(*) into v_high from public.companies c;
  select count(*) into v_low from public.companies c
   where (public.api_evaluate_flags(c.id) ->> 'rollout:pct') = 'true';
  if v_low is distinct from v_high then
    raise exception '100 percent must reach everybody: % of %', v_low, v_high;
  end if;

  -- A global OFF outranks any percentage. Otherwise the kill switch is a
  -- suggestion whenever a rollout is mid-flight.
  perform public.api_set_feature_flag('rollout:pct', false, 100, false, 'incident', null);
  select count(*) into v_low from public.companies c
   where (public.api_evaluate_flags(c.id) ->> 'rollout:pct') = 'true';
  if v_low is distinct from 0 then
    raise exception 'a global OFF must beat a 100 percent rollout, reached %', v_low;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Clearing an override returns the workspace to the global answer.
-- ---------------------------------------------------------------------------

do $$
begin
  perform public.api_clear_feature_flag_override(
    'kill:calls', 'ce000000-0000-4000-8000-0000000000c1'::uuid
  );
  if (public.api_evaluate_flags('ce000000-0000-4000-8000-0000000000c1'::uuid) ->> 'kill:calls')
     is distinct from 'false' then
    raise exception 'clearing an override must fall back to the global switch';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- A percentage refuses a nonsense value rather than storing it.
-- ---------------------------------------------------------------------------

do $$
begin
  begin
    perform public.api_set_feature_flag('rollout:bad', true, 140, false, null, null);
    raise exception 'a percentage above 100 must be rejected';
  exception
    when others then
      if sqlerrm like '%must be 0-100%' then
        null;  -- expected
      else
        raise;
      end if;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Grants: nothing here is reachable by anon or authenticated.
-- ---------------------------------------------------------------------------

do $$
declare
  v_leak text;
begin
  select string_agg(p.proname, ', ') into v_leak
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'api_evaluate_flags', 'api_set_feature_flag', 'flag_bucket',
       'api_override_feature_flag', 'api_clear_feature_flag_override'
     )
     and (
       has_function_privilege('anon', p.oid, 'execute')
       or has_function_privilege('authenticated', p.oid, 'execute')
     );

  if v_leak is not null then
    raise exception 'these must not be reachable by anon/authenticated: %', v_leak;
  end if;
end $$;

rollback;
