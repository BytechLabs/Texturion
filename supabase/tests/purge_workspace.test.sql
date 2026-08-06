-- [#341 / D48] Erasing a closed workspace — phase 2
-- (supabase/migrations/20260726000500_purge_workspace.sql).
--
-- The teardown walks 37 tables in an order forced by restrict edges, a batch
-- at a time, so an interrupted run resumes rather than stranding a workspace
-- half-erased. And it must refuse to run early: the 30-day window is the
-- customer's chance to change their mind, and a purge that ignores it is the
-- one bug this whole design exists to prevent.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/purge_workspace.test.sql
--
-- One transaction, rolled back. 'pg' id prefix so the file runs standalone OR
-- after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('a9000000-0000-4000-8000-00000000000a','purge-owner@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   stripe_customer_id, cnam_display_name, mctb_message)
values ('a9000000-0000-4000-8000-000000000001','Purge Co',
        'a9000000-0000-4000-8000-00000000000a','US','415', now(),
        'cus_purge','PURGECO','sorry we missed you');

insert into public.company_members (id, company_id, user_id, role) values
  ('a9000000-0000-4000-8000-000000000010','a9000000-0000-4000-8000-000000000001',
   'a9000000-0000-4000-8000-00000000000a','owner');

insert into public.phone_numbers (id, company_id, status, provisioning_key, country, number_e164)
  values ('a9000000-0000-4000-8000-000000000020','a9000000-0000-4000-8000-000000000001',
          'active','purge-pk','US','+14155557601');

insert into public.contacts (id, company_id, phone_e164, name)
  values ('a9000000-0000-4000-8000-000000000030','a9000000-0000-4000-8000-000000000001',
          '+14155559801','Dana');

insert into public.conversations
  (id, company_id, contact_id, phone_number_id, status)
values ('a9000000-0000-4000-8000-000000000040','a9000000-0000-4000-8000-000000000001',
        'a9000000-0000-4000-8000-000000000030','a9000000-0000-4000-8000-000000000020','open');

insert into public.messages (id, company_id, conversation_id, direction, body, status)
values ('a9000000-0000-4000-8000-000000000050','a9000000-0000-4000-8000-000000000001',
        'a9000000-0000-4000-8000-000000000040','inbound','Gutters?','received');

-- #247: the cached catch-up, which paraphrases what the customer said. Present
-- in the fixture so the survivor check below has something to catch — a
-- teardown assertion with no row of that kind behind it passes on an empty
-- table and proves nothing.
insert into public.conversation_summaries
  (conversation_id, company_id, last_message_id, lines, model)
values ('a9000000-0000-4000-8000-000000000040','a9000000-0000-4000-8000-000000000001',
        'a9000000-0000-4000-8000-000000000050',
        '{"lines":[{"section":"asked","text":"asked about gutters"}]}'::jsonb,
        '@cf/meta/llama-3.1-8b-instruct-fast');

insert into public.tasks
  (id, company_id, message_id, conversation_id, title, created_by_user_id)
values ('a9000000-0000-4000-8000-000000000060','a9000000-0000-4000-8000-000000000001',
        'a9000000-0000-4000-8000-000000000050','a9000000-0000-4000-8000-000000000040',
        'Quote it','a9000000-0000-4000-8000-00000000000a');

-- The STOP that must outlive the business that received it.
insert into public.opt_outs (id, company_id, phone_e164, source)
values ('a9000000-0000-4000-8000-000000000070','a9000000-0000-4000-8000-000000000001',
        '+14155559999','stop_keyword');

-- ---------------------------------------------------------------------------
-- PW-1. A workspace that is not past its window CANNOT be erased — not while
--       live, and not during the 30 days the customer can still change their
--       mind. This is the guard the whole two-phase design rests on.
-- ---------------------------------------------------------------------------
do $$
declare
  v_company uuid := 'a9000000-0000-4000-8000-000000000001';
  v_ran boolean := false;
begin
  -- Live: refused.
  begin
    perform public.purge_workspace_step(v_company);
    v_ran := true;
  exception when others then null;
  end;
  if v_ran then raise exception 'PW-1 FAILED: a LIVE workspace was purged'; end if;

  -- Closed, but inside the window: still refused.
  perform public.close_workspace(v_company);
  v_ran := false;
  begin
    perform public.purge_workspace_step(v_company);
    v_ran := true;
  exception when others then null;
  end;
  if v_ran then
    raise exception 'PW-1 FAILED: a workspace inside its window was purged';
  end if;

  -- And the data is all still there.
  if not exists (select 1 from public.messages where company_id = v_company) then
    raise exception 'PW-1 FAILED: a refused purge still deleted rows';
  end if;

  raise notice 'PW-1 PASSED: nothing is erased before the window is up';
end $$;

-- ---------------------------------------------------------------------------
-- PW-2. Past the window it walks the order a batch at a time, reporting the
--       step it is on, and finishes. Re-running after `done` is a no-op —
--       which is what makes an interrupted run safe to resume.
-- ---------------------------------------------------------------------------
do $$
declare
  v_company uuid := 'a9000000-0000-4000-8000-000000000001';
  v jsonb;
  v_steps int := 0;
  v_first text;
begin
  update public.companies set purge_after = now() - interval '1 minute'
   where id = v_company;

  -- The first cut is a restrict-child, never a parent: tasks and usage_events
  -- have to go before messages, whatever the company-level policy says.
  v := public.purge_workspace_step(v_company, 500);
  v_first := v->>'step';
  if v_first not in ('usage_events', 'tasks') then
    raise exception 'PW-2 FAILED: first step was % (want a restrict-child)', v_first;
  end if;

  loop
    v := public.purge_workspace_step(v_company, 500);
    v_steps := v_steps + 1;
    exit when (v->>'done')::boolean;
    if v_steps > 100 then
      raise exception 'PW-2 FAILED: teardown did not converge';
    end if;
  end loop;

  -- Everything company-scoped is gone...
  if exists (select 1 from public.messages where company_id = v_company)
     -- #247: a catch-up is a QUOTATION of the customer's messages, so an
     -- erasure that took the bodies and left this would leave their words in
     -- the workspace under a different table name. Named here rather than
     -- trusted to the cascade: this survivor list is hand-written, so a table
     -- nobody adds is a table nobody checks.
     or exists (select 1 from public.conversation_summaries where company_id = v_company)
     or exists (select 1 from public.conversations where company_id = v_company)
     or exists (select 1 from public.contacts where company_id = v_company)
     or exists (select 1 from public.phone_numbers where company_id = v_company)
     or exists (select 1 from public.company_members where company_id = v_company)
     or exists (select 1 from public.tasks where company_id = v_company) then
    raise exception 'PW-2 FAILED: company-scoped rows survived the teardown';
  end if;

  -- ...and running again finds nothing to do.
  v := public.purge_workspace_step(v_company, 500);
  if (v->>'done')::boolean is not true or (v->>'deleted')::int <> 0 then
    raise exception 'PW-2 FAILED: a repeat run was not a no-op: %', v;
  end if;

  raise notice 'PW-2 PASSED: the teardown walks the order and converges';
end $$;

-- ---------------------------------------------------------------------------
-- PW-3. The STOP survives. A do-not-text record belongs to the person who
--       sent it, not to the business that received it — erasing it would let
--       the same owner, re-signed-up, text somebody who told them to stop.
--       This is the one place honouring a deletion request would harm a third
--       party, and the reason the companies row is anonymised rather than
--       deleted (opt_outs.company_id is NOT NULL).
-- ---------------------------------------------------------------------------
do $$
declare v_company uuid := 'a9000000-0000-4000-8000-000000000001';
begin
  if not exists (
    select 1 from public.opt_outs
     where company_id = v_company and phone_e164 = '+14155559999'
  ) then
    raise exception 'PW-3 FAILED: the teardown erased a STOP';
  end if;
  raise notice 'PW-3 PASSED: a do-not-text record outlives the workspace';
end $$;

-- ---------------------------------------------------------------------------
-- PW-4. The row is anonymised, not deleted: nothing left says who the business
--       was, and what remains is the minimum a regulator's question needs —
--       was there consent, when, in what jurisdiction.
-- ---------------------------------------------------------------------------
do $$
declare
  v_company uuid := 'a9000000-0000-4000-8000-000000000001';
  v_name text; v_cus text; v_cnam text; v_mctb text; v_receipt text;
  v_country text; v_created timestamptz; v_purged timestamptz;
begin
  -- #371: the receipt address is carried across the 30-day window so the
  -- erasure can be confirmed to a customer whose membership row is long gone.
  update public.companies set purge_receipt_email = 'owner@purge.test'
   where id = v_company;

  perform public.anonymize_purged_workspace(v_company);

  select name, stripe_customer_id, cnam_display_name, mctb_message,
         country, created_at, purged_at, purge_receipt_email
    into v_name, v_cus, v_cnam, v_mctb, v_country, v_created, v_purged, v_receipt
    from public.companies where id = v_company;

  if v_cus is not null or v_cnam is not null or v_mctb is not null then
    raise exception 'PW-4 FAILED: identifying fields survived (% / % / %)',
      v_cus, v_cnam, v_mctb;
  end if;
  if v_name = 'Purge Co' then
    raise exception 'PW-4 FAILED: the business name survived';
  end if;
  if v_purged is null then
    raise exception 'PW-4 FAILED: purged_at was not stamped';
  end if;
  -- #371: the sweep reads it before this runs. Keeping an address on a
  -- workspace whose whole point is that it has been erased would be the
  -- contradiction the receipt exists to avoid.
  if v_receipt is not null then
    raise exception 'PW-4 FAILED: the receipt address outlived the erasure';
  end if;
  -- Kept, deliberately.
  if v_country is null or v_created is null then
    raise exception 'PW-4 FAILED: the consent anchor lost its date or jurisdiction';
  end if;

  raise notice 'PW-4 PASSED: the workspace row survives carrying no identity';
end $$;

rollback;
