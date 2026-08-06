-- [#304] An export somebody can hand to a bookkeeper or an adjuster —
-- assertion suite for supabase/migrations/20260804160000_scoped_exports.sql.
--
-- SE-3 and SE-4 are the pair that matter, and they pull against each other:
--
--   SE-3 — one export of a kind at a time, because an export reads every row
--   it covers and writes a copy. Ten queued is ten times the read and ten
--   copies in the bucket, for a button somebody clicked twice.
--
--   SE-4 — and yet a scoped export must NOT wait behind a full dump. An
--   adjuster wants one customer's thread today; a bookkeeper's dump of two
--   hundred thousand messages is not a reason they cannot have it. The cost
--   rule is about cost, not about the queue slot.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/scoped_exports.test.sql
--
-- One transaction, rolled back. Fixtures use an '8e' id prefix so the file
-- runs standalone OR after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('8e000000-0000-4000-8000-00000000000a'::uuid, 'exports-a@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('8e000000-0000-4000-8000-0000000000c1'::uuid, 'Export HVAC',
   '8e000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now()),
  -- A workspace with nothing in flight, so SE-10 can ask for one of every kind
  -- without the earlier tests' queued rows answering for it.
  ('8e000000-0000-4000-8000-0000000000c2'::uuid, 'Quiet HVAC',
   '8e000000-0000-4000-8000-00000000000a'::uuid, 'US', '416', now());

-- ---------------------------------------------------------------------------
-- SE-1: the #227 call site still means the whole workspace.
--
-- The kind is defaulted precisely so the privacy dump keeps working untouched.
-- A default that had changed would quietly turn a legal-right export into
-- something narrower, which is the one export that must never be partial.
-- ---------------------------------------------------------------------------
do $$
declare
  v_result jsonb;
  v_kind text;
begin
  v_result := public.request_data_export(
    '8e000000-0000-4000-8000-0000000000c1'::uuid,
    '8e000000-0000-4000-8000-00000000000a'::uuid
  );
  if v_result->>'outcome' is distinct from 'queued' then
    raise exception 'SE-1: the dump was not queued (%)', v_result;
  end if;

  select kind into v_kind
    from public.data_exports where id = (v_result->>'export_id')::uuid;
  if v_kind is distinct from 'workspace' then
    raise exception 'SE-1: the default kind is now %, not workspace', v_kind;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- SE-2: a scoped export remembers WHAT was asked for.
--
-- A row saying only "conversation_history" cannot tell an owner six months
-- later which history somebody took — which is the question asked after a
-- member leaves (#276).
-- ---------------------------------------------------------------------------
do $$
declare
  v_result jsonb;
  v_filters jsonb;
begin
  v_result := public.request_data_export(
    '8e000000-0000-4000-8000-0000000000c1'::uuid,
    '8e000000-0000-4000-8000-00000000000a'::uuid,
    interval '7 days',
    'conversation_history',
    '{"contact_id": "8e000000-0000-4000-8000-0000000000d1", "from": "2026-07-01", "to": "2026-07-31"}'::jsonb
  );
  if v_result->>'outcome' is distinct from 'queued' then
    raise exception 'SE-2: the scoped export was not queued (%)', v_result;
  end if;

  select filters into v_filters
    from public.data_exports where id = (v_result->>'export_id')::uuid;
  if v_filters->>'contact_id' is null or v_filters->>'from' is null then
    raise exception 'SE-2: the export does not record what it was asked for (%)', v_filters;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- SE-3: one export of a KIND at a time.
--
-- The cost rule, kept. A second click gets told about the first rather than
-- silently making another copy of everything.
-- ---------------------------------------------------------------------------
do $$
declare v_again jsonb;
begin
  v_again := public.request_data_export(
    '8e000000-0000-4000-8000-0000000000c1'::uuid,
    '8e000000-0000-4000-8000-00000000000a'::uuid
  );
  if v_again->>'outcome' is distinct from 'in_flight' then
    raise exception 'SE-3: a second workspace dump was queued alongside the first';
  end if;

  v_again := public.request_data_export(
    '8e000000-0000-4000-8000-0000000000c1'::uuid,
    '8e000000-0000-4000-8000-00000000000a'::uuid,
    interval '7 days',
    'conversation_history',
    '{}'::jsonb
  );
  if v_again->>'outcome' is distinct from 'in_flight' then
    raise exception 'SE-3: a second scoped export was queued alongside the first';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- SE-4: and a scoped export does NOT wait behind a full dump.
--
-- THE ONE THIS MIGRATION IS FOR. Both kinds are in flight above; each refused
-- a SECOND of its own kind, and neither refused the other. Asserted as a count
-- rather than trusting the two outcomes: the shape that would fail here is one
-- queue slot shared by both, and a shared slot shows up as a missing row.
-- ---------------------------------------------------------------------------
do $$
declare v_in_flight int;
begin
  select count(*) into v_in_flight
    from public.data_exports
   where company_id = '8e000000-0000-4000-8000-0000000000c1'::uuid
     and status in ('pending', 'running');
  if v_in_flight is distinct from 2 then
    raise exception
      'SE-4: % export(s) in flight, expected one of each kind — a scoped export is queued behind the dump',
      v_in_flight;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- SE-5: a kind nobody defined is refused, not stored.
--
-- An unknown kind stored is a row the builder cron will pick up and not know
-- what to do with, forever.
-- ---------------------------------------------------------------------------
do $$
declare v_message text;
begin
  begin
    perform public.request_data_export(
      '8e000000-0000-4000-8000-0000000000c1'::uuid,
      '8e000000-0000-4000-8000-00000000000a'::uuid,
      interval '7 days',
      'everything_ever',
      '{}'::jsonb
    );
    raise exception 'SE-5: an unknown export kind was accepted';
  exception
    when others then
      if sqlerrm like 'SE-5:%' then raise; end if;
      v_message := sqlerrm;
  end;

  -- Refused BY THE FUNCTION, not merely by the column's check constraint.
  --
  -- Both refuse it, so "an exception was raised" cannot tell them apart —
  -- proven by deleting the function's guard and watching this pass on the
  -- constraint alone. The distinction is worth keeping: the function refuses
  -- BEFORE taking the advisory lock and before touching the table, and it says
  -- which argument was wrong, where a constraint violation names a column and
  -- leaves the caller to work out why.
  if v_message not like '%request_data_export%' then
    raise exception
      'SE-5: the unknown kind was refused by something other than the function: %',
      v_message;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- SE-6: the queue read is indexed BY KIND.
--
-- The builder asks for the oldest unfinished export of one kind. Without the
-- kind in the index that is a scan of every export the platform has ever run,
-- and it degrades quietly as the table grows rather than failing.
-- ---------------------------------------------------------------------------
do $$
declare v_cols text;
begin
  select pg_get_indexdef(i.indexrelid) into v_cols
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
   where c.relname = 'data_exports_pending_idx';
  if v_cols is null then
    raise exception 'SE-6: the pending-queue index is gone';
  end if;
  if position('kind' in v_cols) = 0 then
    raise exception 'SE-6: the queue index does not lead with kind: %', v_cols;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- SE-7: the old four-argument form is gone.
--
-- Two functions of the same name would mean a caller that forgot the kind got
-- the dump — silently, and only in production.
-- ---------------------------------------------------------------------------
do $$
declare v_forms int;
begin
  select count(*) into v_forms
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'request_data_export';
  if v_forms is distinct from 1 then
    raise exception 'SE-7: % overloads of request_data_export, expected one', v_forms;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- SE-8: the bookkeeper's kind is accepted, and an unknown one still is not.
--
-- The pair matters. Widening a check constraint is one line, and the way it
-- goes wrong is not that the new value is rejected — it is that the constraint
-- gets dropped and never re-added, after which `kind` accepts anything and the
-- queue dispatches a typo to the workspace dump. That is the branch that reads
-- every row the company owns.
-- ---------------------------------------------------------------------------
do $$
declare
  v_result jsonb;
  v_kind text;
  v_rejected boolean := false;
begin
  v_result := public.request_data_export(
    p_company_id => '8e000000-0000-4000-8000-0000000000c1'::uuid,
    p_user_id    => '8e000000-0000-4000-8000-00000000000a'::uuid,
    p_kind       => 'usage_summary',
    p_filters    => jsonb_build_object('from', '2026-06-01T00:00:00Z')
  );
  if v_result->>'outcome' is distinct from 'queued' then
    raise exception 'SE-8: a usage export was not queued (%)', v_result;
  end if;
  select kind into v_kind
    from public.data_exports where id = (v_result->>'export_id')::uuid;
  if v_kind is distinct from 'usage_summary' then
    raise exception 'SE-8: the kind was stored as %, not usage_summary', v_kind;
  end if;

  begin
    insert into public.data_exports (company_id, requested_by, kind)
    values ('8e000000-0000-4000-8000-0000000000c1'::uuid,
            '8e000000-0000-4000-8000-00000000000a'::uuid,
            'usage_sumary');
  exception when check_violation then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'SE-8: a misspelled kind was accepted — the constraint is gone';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- SE-9: the work kind, and the two gates that both have to be widened.
--
-- The failure this catches is not a rejected new kind — it is a table that
-- accepts the row while request_data_export still raises on it, or the reverse.
-- Adding a kind means touching a check constraint AND a list inside a
-- function, and nothing about either one points at the other.
-- ---------------------------------------------------------------------------
do $$
declare
  v_result jsonb;
  v_kind text;
  v_rejected boolean := false;
begin
  v_result := public.request_data_export(
    p_company_id => '8e000000-0000-4000-8000-0000000000c1'::uuid,
    p_user_id    => '8e000000-0000-4000-8000-00000000000a'::uuid,
    p_kind       => 'tasks',
    p_filters    => jsonb_build_object('state', 'open')
  );
  if v_result->>'outcome' is distinct from 'queued' then
    raise exception 'SE-9: a task export was not queued (%)', v_result;
  end if;
  select kind into v_kind
    from public.data_exports where id = (v_result->>'export_id')::uuid;
  if v_kind is distinct from 'tasks' then
    raise exception 'SE-9: the kind was stored as %, not tasks', v_kind;
  end if;

  -- The other gate, from the table's side.
  begin
    insert into public.data_exports (company_id, requested_by, kind)
    values ('8e000000-0000-4000-8000-0000000000c1'::uuid,
            '8e000000-0000-4000-8000-00000000000a'::uuid,
            'task');
  exception when check_violation then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'SE-9: kind ''task'' was accepted — the constraint is stale';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- SE-10: each kind gets its own queue slot.
--
-- The per-kind lock, asserted across all four now that there are four. A lock
-- that had drifted back to per-company would make the bookkeeper's dump block
-- the adjuster's thread, which is the exact thing SE-4 was written to stop.
-- ---------------------------------------------------------------------------
do $$
declare
  v_kinds text[] := array['workspace', 'conversation_history', 'usage_summary', 'tasks'];
  v_kind text;
  v_result jsonb;
begin
  foreach v_kind in array v_kinds loop
    v_result := public.request_data_export(
      p_company_id => '8e000000-0000-4000-8000-0000000000c2'::uuid,
      p_user_id    => '8e000000-0000-4000-8000-00000000000a'::uuid,
      p_kind       => v_kind
    );
    if v_result->>'outcome' is distinct from 'queued' then
      raise exception 'SE-10: kind % waited behind another kind (%)', v_kind, v_result;
    end if;
  end loop;

  -- And a SECOND of the same kind still waits, so the slot is per-kind rather
  -- than simply absent.
  v_result := public.request_data_export(
    p_company_id => '8e000000-0000-4000-8000-0000000000c2'::uuid,
    p_user_id    => '8e000000-0000-4000-8000-00000000000a'::uuid,
    p_kind       => 'tasks'
  );
  if v_result->>'outcome' is distinct from 'in_flight' then
    raise exception 'SE-10: a second task export was queued rather than joined (%)', v_result;
  end if;
end $$;

rollback;
