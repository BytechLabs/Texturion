-- [#341 / D48] Workspace closure — phase 1
-- (supabase/migrations/20260726000400_workspace_closure.sql).
--
-- Closing is the part the customer experiences as deletion, and it has to be
-- one transaction: the workspace closes, and the caller is handed everything
-- it must clean up outside the database, read under the same lock. A caller
-- acting on a stale picture of what the workspace owned is how a number stays
-- billed after the account is gone.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/workspace_closure.test.sql
--
-- One transaction, rolled back. 'wc' id prefix so the file runs standalone OR
-- after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('9c000000-0000-4000-8000-00000000000a','closure-owner@test.local'),
  ('9c000000-0000-4000-8000-00000000000b','closure-crew@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   stripe_subscription_id, stripe_customer_id)
values ('9c000000-0000-4000-8000-000000000001','Closing Co',
        '9c000000-0000-4000-8000-00000000000a','US','415', now(),
        'sub_test_closing','cus_test_closing');

insert into public.company_members (id, company_id, user_id, role, deactivated_at) values
  ('9c000000-0000-4000-8000-000000000010','9c000000-0000-4000-8000-000000000001',
   '9c000000-0000-4000-8000-00000000000a','owner', null),
  -- Deactivated last week, and still able to hold a live session.
  ('9c000000-0000-4000-8000-000000000011','9c000000-0000-4000-8000-000000000001',
   '9c000000-0000-4000-8000-00000000000b','member', now() - interval '7 days');

insert into public.phone_numbers (id, company_id, status, provisioning_key, country, number_e164) values
  ('9c000000-0000-4000-8000-000000000020','9c000000-0000-4000-8000-000000000001',
   'active','closing-pk-1','US','+14155557501'),
  -- Already gone: nothing to release a second time.
  ('9c000000-0000-4000-8000-000000000021','9c000000-0000-4000-8000-000000000001',
   'released','closing-pk-2','US','+14155557502');

-- ---------------------------------------------------------------------------
-- WC-1. A live workspace has no purge date. The constraint says so, because
--       "erasure scheduled, but not closed" is not a state that should exist.
-- ---------------------------------------------------------------------------
do $$
declare v_allowed boolean := false;
begin
  begin
    update public.companies set purge_after = now() + interval '30 days'
     where id = '9c000000-0000-4000-8000-000000000001';
    v_allowed := true;
  exception when check_violation then
    null;
  end;
  if v_allowed then
    raise exception 'WC-1 FAILED: a live workspace accepted a purge date';
  end if;
  raise notice 'WC-1 PASSED: a purge date requires a closed workspace';
end $$;

-- ---------------------------------------------------------------------------
-- WC-2. Closing stamps the window AND hands back the external cleanup list,
--       read under the same lock. Every member is listed, deactivated ones
--       included — a closed workspace is closed to everyone who could still
--       reach it. Already-released numbers are not listed: there is nothing
--       to release twice.
-- ---------------------------------------------------------------------------
do $$
declare
  v_company uuid := '9c000000-0000-4000-8000-000000000001';
  v jsonb;
begin
  v := public.close_workspace(v_company);
  if v->>'outcome' <> 'closed' then
    raise exception 'WC-2 FAILED: outcome %', v;
  end if;
  if (v->>'purge_after')::timestamptz <= now() then
    raise exception 'WC-2 FAILED: purge_after is not in the future: %', v;
  end if;
  if jsonb_array_length(v->'user_ids') <> 2 then
    raise exception 'WC-2 FAILED: % members listed (want 2 — the deactivated one counts)', v->'user_ids';
  end if;
  if jsonb_array_length(v->'phone_number_ids') <> 1 then
    raise exception 'WC-2 FAILED: % numbers listed (want 1 — the released one does not)', v->'phone_number_ids';
  end if;
  if v->>'stripe_subscription_id' <> 'sub_test_closing' then
    raise exception 'WC-2 FAILED: subscription not handed back: %', v;
  end if;

  -- Closed on the row itself, with the window recorded.
  if not exists (
    select 1 from public.companies
     where id = v_company and deleted_at is not null and purge_after is not null
  ) then
    raise exception 'WC-2 FAILED: the workspace row was not closed';
  end if;

  raise notice 'WC-2 PASSED: closing stamps the window and reports the cleanup';
end $$;

-- ---------------------------------------------------------------------------
-- WC-3. Closing twice is a no-op. A retried request must not extend the
--       window, and must not hand back a cleanup list that would re-release a
--       number or re-cancel a subscription that is already gone.
-- ---------------------------------------------------------------------------
do $$
declare
  v_company uuid := '9c000000-0000-4000-8000-000000000001';
  v_first timestamptz;
  v jsonb;
begin
  select purge_after into v_first from public.companies where id = v_company;

  v := public.close_workspace(v_company);
  if v->>'outcome' <> 'already' then
    raise exception 'WC-3 FAILED: second close returned %', v;
  end if;
  if v ? 'phone_number_ids' then
    raise exception 'WC-3 FAILED: a repeat close handed back a cleanup list: %', v;
  end if;

  if (select purge_after from public.companies where id = v_company) <> v_first then
    raise exception 'WC-3 FAILED: the window moved on a repeat close';
  end if;

  raise notice 'WC-3 PASSED: closing twice changes nothing';
end $$;

-- ---------------------------------------------------------------------------
-- WC-4. The undo works inside the window and refuses outside it — once the
--       window has passed the erasure may have started, and a "restored"
--       workspace would be a hollow one.
-- ---------------------------------------------------------------------------
do $$
declare
  v_company uuid := '9c000000-0000-4000-8000-000000000001';
  v jsonb;
begin
  v := public.reopen_workspace(v_company);
  if v->>'outcome' <> 'reopened' then
    raise exception 'WC-4 FAILED: reopen returned %', v;
  end if;
  if exists (
    select 1 from public.companies
     where id = v_company and (deleted_at is not null or purge_after is not null)
  ) then
    raise exception 'WC-4 FAILED: the workspace is still closed after reopening';
  end if;

  -- Reopening a live workspace says so rather than pretending it did something.
  v := public.reopen_workspace(v_company);
  if v->>'outcome' <> 'not_closed' then
    raise exception 'WC-4 FAILED: reopening a live workspace returned %', v;
  end if;

  -- Past the window: refused.
  perform public.close_workspace(v_company);
  update public.companies set purge_after = now() - interval '1 minute'
   where id = v_company;
  v := public.reopen_workspace(v_company);
  if v->>'outcome' <> 'too_late' then
    raise exception 'WC-4 FAILED: reopening past the window returned %', v;
  end if;
  if not exists (
    select 1 from public.companies where id = v_company and deleted_at is not null
  ) then
    raise exception 'WC-4 FAILED: a refused reopen still reopened it';
  end if;

  raise notice 'WC-4 PASSED: the undo works inside the window and only inside it';
end $$;

-- ---------------------------------------------------------------------------
-- WC-5. A workspace nobody has is not found — the caller must not treat a
--       missing row as a successful close.
-- ---------------------------------------------------------------------------
do $$
declare v jsonb;
begin
  v := public.close_workspace('9c000000-0000-4000-8000-0000000000ff');
  if v->>'outcome' <> 'not_found' then
    raise exception 'WC-5 FAILED: unknown workspace returned %', v;
  end if;
  v := public.reopen_workspace('9c000000-0000-4000-8000-0000000000ff');
  if v->>'outcome' <> 'not_found' then
    raise exception 'WC-5 FAILED: reopening an unknown workspace returned %', v;
  end if;
  raise notice 'WC-5 PASSED: an unknown workspace is not a silent success';
end $$;

rollback;
