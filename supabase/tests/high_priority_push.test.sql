-- #452 — HIGH-priority push is a rationed resource: a counter, a shared
-- ceiling over the attacker-drivable bucket, and an alert before the ceiling.
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run: psql -v ON_ERROR_STOP=1 -f supabase/tests/high_priority_push.test.sql
-- The whole suite runs in one transaction and ROLLS BACK — it never pollutes
-- the local database. Self-contained fixtures with their own id prefix so it
-- can run standalone or after any other suite.
--   owner   = 45200000-0000-4000-8000-000000000001
--   company = 45200000-0000-4000-8000-000000000002

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                        created_at, updated_at, aud, role)
values ('45200000-0000-4000-8000-000000000001', 'hp@test.local', '', now(),
        now(), now(), 'authenticated', 'authenticated')
on conflict (id) do nothing;

-- Vancouver on purpose: the day key has to be the BUSINESS's day, and a zone
-- west of UTC is the one that exposes a UTC-keyed counter (the #343 bug).
insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, plan, timezone)
values ('45200000-0000-4000-8000-000000000002', 'HP Test Co',
        '45200000-0000-4000-8000-000000000001', 'CA', '604', now(), 'active',
        'pro', 'America/Vancouver');

-- ===========================================================================
-- HP-1. Both ledgers exist with RLS enabled. Service-role only, like every
--       other internal ledger — the attribution table names customers and the
--       budget table is a spending control; neither is end-user readable.
-- ===========================================================================
do $$
declare
  missing text;
  no_rls  text;
begin
  select string_agg(t, ', ') into missing
  from unnest(array['high_priority_push_days', 'high_priority_push_budget']) t
  where not exists (
    select 1 from pg_tables p
     where p.schemaname = 'public' and p.tablename = t);
  if missing is not null then
    raise exception 'HP-1 FAILED: missing tables: %', missing;
  end if;

  select string_agg(tablename, ', ') into no_rls
  from pg_tables
  where schemaname = 'public'
    and tablename in ('high_priority_push_days', 'high_priority_push_budget')
    and not rowsecurity;
  if no_rls is not null then
    raise exception 'HP-1 FAILED: RLS not enabled on: %', no_rls;
  end if;
end $$;

-- ===========================================================================
-- HP-2. The capped bucket is SHARED by lead and lead_chase.
--
--       This is the heart of the design. Both are driven by inbound text
--       volume — the one input an outsider controls — so a flood drives both.
--       Two independent ceilings would let it spend the budget twice over.
--
--       Also pins the SOFT BOUNDARY: the claim that crosses the ceiling is
--       allowed in FULL. Splitting one fan-out mid-crew would wake some of a
--       crew and not the rest for a single lead, which is worse than one
--       claim's overshoot.
-- ===========================================================================
do $$
declare
  co uuid := '45200000-0000-4000-8000-000000000002';
  r  jsonb;
begin
  -- Ceiling of 10, spent by two reasons.
  r := public.claim_high_priority_push(co, 'lead', 4, 10);
  if (r->>'allowed')::boolean is not true or (r->>'sends')::int is distinct from 4 then
    raise exception 'HP-2 FAILED: first lead claim: %', r;
  end if;
  if r->>'alert' is not null then
    raise exception 'HP-2 FAILED: alerted at 4/10: %', r;
  end if;

  -- 8/10 crosses the 80% rung.
  r := public.claim_high_priority_push(co, 'lead', 4, 10);
  if (r->>'sends')::int is distinct from 8 or (r->>'alert')::int is distinct from 80 then
    raise exception 'HP-2 FAILED: expected 8 sends + the 80 rung: %', r;
  end if;

  -- A DIFFERENT reason reads the SAME running total: 8 < 10, so this claim is
  -- allowed whole and carries the total past the ceiling to 11.
  r := public.claim_high_priority_push(co, 'lead_chase', 3, 10);
  if (r->>'allowed')::boolean is not true then
    raise exception 'HP-2 FAILED: the crossing claim must be allowed whole: %', r;
  end if;
  if (r->>'sends')::int is distinct from 11 then
    raise exception 'HP-2 FAILED: lead_chase must share the lead counter: %', r;
  end if;
  if (r->>'alert')::int is distinct from 100 then
    raise exception 'HP-2 FAILED: expected the 100 rung at 11/10: %', r;
  end if;
end $$;

-- ===========================================================================
-- HP-3. Past the ceiling: refused, but STILL COUNTED, and the rungs are
--       one-shot.
--
--       Counting refused demand is the point of the `degraded` column — a big
--       degraded number is how anyone learns the ceiling is too low or the
--       workspace is being flooded, and collapsing it into `sends` would hide
--       exactly that.
-- ===========================================================================
do $$
declare
  co uuid := '45200000-0000-4000-8000-000000000002';
  r  jsonb;
begin
  r := public.claim_high_priority_push(co, 'lead', 2, 10);
  if (r->>'allowed')::boolean is not false then
    raise exception 'HP-3 FAILED: past the ceiling must refuse: %', r;
  end if;
  if (r->>'sends')::int is distinct from 13 then
    raise exception 'HP-3 FAILED: refused demand must still be counted: %', r;
  end if;
  if r->>'alert' is not null then
    raise exception 'HP-3 FAILED: the 100 rung must be one-shot: %', r;
  end if;

  -- A second refusal still alerts nothing.
  r := public.claim_high_priority_push(co, 'lead', 2, 10);
  if r->>'alert' is not null then
    raise exception 'HP-3 FAILED: repeat alert at 15/10: %', r;
  end if;
end $$;

-- ===========================================================================
-- HP-4. The uncapped reasons are never refused and never alert.
--
--       ring/call_end need a phone call to have actually happened, and a ring
--       delivered at NORMAL priority is not a ring. emergency needs one of the
--       four fixed words in EMERGENCY_KEYWORDS. None can be manufactured from
--       outside at volume, so none of them shares the lead ceiling — proven
--       here by blowing 50 through a limit of 10.
-- ===========================================================================
do $$
declare
  co uuid := '45200000-0000-4000-8000-000000000002';
  reason text;
  r jsonb;
begin
  foreach reason in array array['ring', 'call_end', 'emergency'] loop
    r := public.claim_high_priority_push(co, reason, 50, 10);
    if (r->>'allowed')::boolean is not true then
      raise exception 'HP-4 FAILED: % must never be capped: %', reason, r;
    end if;
    if r->>'alert' is not null then
      raise exception 'HP-4 FAILED: % must never alert: %', reason, r;
    end if;
    if r->>'limit' is not null then
      raise exception 'HP-4 FAILED: % must report no limit: %', reason, r;
    end if;
  end loop;
end $$;

-- ===========================================================================
-- HP-5. Attribution is per reason, and splits spend from refused demand.
-- ===========================================================================
do $$
declare
  co uuid := '45200000-0000-4000-8000-000000000002';
  n  int;
begin
  select sends into n from public.high_priority_push_days
   where company_id = co and reason = 'lead';
  if n is distinct from 8 then
    raise exception 'HP-5 FAILED: lead sends = % (want 8)', n;
  end if;
  select degraded into n from public.high_priority_push_days
   where company_id = co and reason = 'lead';
  if n is distinct from 4 then
    raise exception 'HP-5 FAILED: lead degraded = % (want 4)', n;
  end if;
  select sends into n from public.high_priority_push_days
   where company_id = co and reason = 'lead_chase';
  if n is distinct from 3 then
    raise exception 'HP-5 FAILED: lead_chase sends = % (want 3)', n;
  end if;
  -- An uncapped reason can never accrue degraded demand.
  select coalesce(sum(degraded), 0) into n from public.high_priority_push_days
   where company_id = co and reason in ('ring', 'call_end', 'emergency');
  if n is distinct from 0 then
    raise exception 'HP-5 FAILED: an uncapped reason degraded % sends', n;
  end if;
end $$;

-- ===========================================================================
-- HP-6. The budget row records the ceiling that was IN FORCE, and both stamps.
--       A row read weeks later has to say what the limit WAS, not what it is
--       now — the #343 lesson.
-- ===========================================================================
do $$
declare
  co uuid := '45200000-0000-4000-8000-000000000002';
  b  public.high_priority_push_budget%rowtype;
begin
  select * into b from public.high_priority_push_budget where company_id = co;
  if b.requested is distinct from 15 then
    raise exception 'HP-6 FAILED: requested = % (want 15)', b.requested;
  end if;
  if b.day_limit is distinct from 10 then
    raise exception 'HP-6 FAILED: day_limit = % (want 10)', b.day_limit;
  end if;
  if b.warned_at is null or b.capped_at is null then
    raise exception 'HP-6 FAILED: both rungs must be stamped (warned=%, capped=%)',
      b.warned_at, b.capped_at;
  end if;
  -- The business's day, not UTC's (D15/#343): a Vancouver company rolling over
  -- at 5pm local is the bug that keying on UTC caused last time.
  if b.day is distinct from (now() at time zone 'America/Vancouver')::date then
    raise exception 'HP-6 FAILED: day % is not the company local date', b.day;
  end if;
end $$;

-- ===========================================================================
-- HP-7. The ops-only per-company override wins over the caller's default, and
--       a zero claim is a no-op rather than an error (a fan-out can legitimately
--       find no registered devices).
-- ===========================================================================
do $$
declare
  co uuid := '45200000-0000-4000-8000-000000000002';
  r  jsonb;
begin
  r := public.claim_high_priority_push(co, 'lead', 0, 10);
  if (r->>'allowed')::boolean is not true or (r->>'sends')::int is distinct from 0 then
    raise exception 'HP-7 FAILED: a zero claim must be a no-op: %', r;
  end if;

  update public.companies set high_priority_push_limit = 99999 where id = co;
  r := public.claim_high_priority_push(co, 'lead', 1, 10);
  if (r->>'allowed')::boolean is not true then
    raise exception 'HP-7 FAILED: the override must lift the ceiling: %', r;
  end if;
  if (r->>'limit')::int is distinct from 99999 then
    raise exception 'HP-7 FAILED: limit = % (want the 99999 override)', r->>'limit';
  end if;
end $$;

-- ===========================================================================
-- HP-8. An unknown reason cannot be recorded at all — the reason vocabulary is
--       a CHECK, so a typo in a caller fails loudly instead of quietly
--       creating an unattributable fifth bucket.
-- ===========================================================================
do $$
declare
  co uuid := '45200000-0000-4000-8000-000000000002';
begin
  begin
    perform public.claim_high_priority_push(co, 'nonsense', 1, 10);
    raise exception 'HP-8 FAILED: an unknown reason was accepted';
  exception when check_violation then
    null; -- expected
  end;
end $$;

-- ===========================================================================
-- HP-9. The ops report answers #452's definition of done: "how many
--       high-priority pushes did we send last week, and to whom?"
-- ===========================================================================
do $$
declare
  co  uuid := '45200000-0000-4000-8000-000000000002';
  rep jsonb;
  row jsonb;
begin
  rep := public.api_high_priority_push_report(7);
  if jsonb_typeof(rep) is distinct from 'array' then
    raise exception 'HP-9 FAILED: report is % (want an array)', jsonb_typeof(rep);
  end if;

  select value into row
    from jsonb_array_elements(rep)
   where value->>'company_id' = co::text
     and value->>'reason' = 'lead';
  if row is null then
    raise exception 'HP-9 FAILED: the lead row is missing from the report';
  end if;
  if row->>'company_name' is null then
    raise exception 'HP-9 FAILED: the report must name the company ("to whom")';
  end if;
  if (row->>'sends')::int is distinct from 9 or (row->>'degraded')::int is distinct from 4 then
    raise exception 'HP-9 FAILED: lead row = % (want sends 9, degraded 4)', row;
  end if;
end $$;

-- ===========================================================================
-- HP-10. Neither ledger is reachable by an end-user role. These rows name
--        customers and gate a spending control; only the Worker may touch them.
-- ===========================================================================
do $$
declare
  leaked text;
begin
  select string_agg(format('%s:%s', table_name, grantee), ', ') into leaked
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('high_priority_push_days', 'high_priority_push_budget')
    and grantee in ('anon', 'authenticated');
  if leaked is not null then
    raise exception 'HP-10 FAILED: end-user grants present: %', leaked;
  end if;

  select string_agg(grantee, ', ') into leaked
  from information_schema.role_routine_grants
  where routine_schema = 'public'
    and routine_name in ('claim_high_priority_push', 'api_high_priority_push_report')
    and grantee in ('anon', 'authenticated', 'public');
  if leaked is not null then
    raise exception 'HP-10 FAILED: end-user execute grants present: %', leaked;
  end if;
end $$;

\echo 'high_priority_push.test.sql: HP-1..HP-10 PASSED'

rollback;
