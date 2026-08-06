-- D30 storage accounting assertion suite — api_storage_usage(p_company_id)
-- (supabase/migrations/20260704050000_storage_accounting.sql): the exact
-- per-company stored-bytes sums behind the POST /v1/attachments budget gate
-- and the GET /v1/usage `storage` arm. Extended (SA-7..SA-11) with the #15/#16
-- storage-cost hardening (20260707120000_storage_egress_and_orphans.sql): the
-- atomic signed-URL egress claim + period sum, the widened usage_alerts
-- `egress` metric, and the orphan-object / ghost-row anti-join scans.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/storage_accounting.test.sql
--
-- The whole suite runs in one transaction and ROLLS BACK: it never pollutes
-- the local database. Self-contained fixtures with a distinct 'd3' id prefix
-- so the file runs standalone OR after the other suites in one psql session.
--   owner     = d3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3
--   company A = d3d3d3d3-d3d3-4d3d-8d3d-d3d300000001
--   company B = d3d3d3d3-d3d3-4d3d-8d3d-d3d300000002  (isolation control)
--   number    = d3d3d3d3-d3d3-4d3d-8d3d-d3d300000003
--   contact   = d3d3d3d3-d3d3-4d3d-8d3d-d3d300000004
--   convo     = d3d3d3d3-d3d3-4d3d-8d3d-d3d300000005
--   message   = d3d3d3d3-d3d3-4d3d-8d3d-d3d300000006

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- Fixtures.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('d3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3','storage-owner@test.local');

insert into public.companies (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('d3d3d3d3-d3d3-4d3d-8d3d-d3d300000001','Storage Co A',
   'd3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3','US','415', now()),
  ('d3d3d3d3-d3d3-4d3d-8d3d-d3d300000002','Storage Co B',
   'd3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3','US','415', now());

insert into public.phone_numbers (id, company_id, status, provisioning_key, country, number_e164)
  values ('d3d3d3d3-d3d3-4d3d-8d3d-d3d300000003','d3d3d3d3-d3d3-4d3d-8d3d-d3d300000001',
          'active','storage-pk','US','+14155557301');

insert into public.contacts (id, company_id, phone_e164)
  values ('d3d3d3d3-d3d3-4d3d-8d3d-d3d300000004','d3d3d3d3-d3d3-4d3d-8d3d-d3d300000001',
          '+14155559301');

insert into public.conversations (id, company_id, contact_id, phone_number_id)
  values ('d3d3d3d3-d3d3-4d3d-8d3d-d3d300000005','d3d3d3d3-d3d3-4d3d-8d3d-d3d300000001',
          'd3d3d3d3-d3d3-4d3d-8d3d-d3d300000004','d3d3d3d3-d3d3-4d3d-8d3d-d3d300000003');

insert into public.messages (id, company_id, conversation_id, direction, body, status)
  values ('d3d3d3d3-d3d3-4d3d-8d3d-d3d300000006','d3d3d3d3-d3d3-4d3d-8d3d-d3d300000001',
          'd3d3d3d3-d3d3-4d3d-8d3d-d3d300000005','inbound','photo attached','received');

-- ===========================================================================
-- SA-1. api_storage_usage exists with the api_* security posture:
--       SECURITY DEFINER, empty search_path, EXECUTE denied to end-user roles
--       and granted to service_role only.
-- ===========================================================================
do $$
declare fn regprocedure; is_secdef boolean; cfg text[];
begin
  select p.oid::regprocedure, p.prosecdef, p.proconfig
    into fn, is_secdef, cfg
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='api_storage_usage';
  if fn is null then raise exception 'SA-1 FAILED: public.api_storage_usage missing'; end if;
  if not is_secdef then raise exception 'SA-1 FAILED: api_storage_usage must be SECURITY DEFINER'; end if;
  if cfg is null or not ('search_path=' = any(cfg) or 'search_path=""' = any(cfg)) then
    raise exception 'SA-1 FAILED: api_storage_usage must pin an empty search_path (got %)', cfg;
  end if;
  if has_function_privilege('anon', fn, 'execute')
     or has_function_privilege('authenticated', fn, 'execute') then
    raise exception 'SA-1 FAILED: anon/authenticated must not EXECUTE api_storage_usage';
  end if;
  if not has_function_privilege('service_role', fn, 'execute') then
    raise exception 'SA-1 FAILED: service_role must EXECUTE api_storage_usage';
  end if;
  raise notice 'SA-1 PASSED: api_storage_usage security posture';
end $$;

-- ===========================================================================
-- SA-2. Empty company → both sums are 0 (never NULL — the Worker Number()s
--       the fields directly).
-- ===========================================================================
do $$
declare result jsonb;
begin
  result := public.api_storage_usage('d3d3d3d3-d3d3-4d3d-8d3d-d3d300000002');
  if (result->>'attachments_bytes')::bigint is distinct from 0 then
    raise exception 'SA-2 FAILED: empty company attachments_bytes = % (want 0)', result->>'attachments_bytes';
  end if;
  if (result->>'mms_bytes')::bigint is distinct from 0 then
    raise exception 'SA-2 FAILED: empty company mms_bytes = % (want 0)', result->>'mms_bytes';
  end if;
  raise notice 'SA-2 PASSED: empty company sums to zeros';
end $$;

-- ===========================================================================
-- SA-3. attachments_bytes sums LIVE generic rows only: soft-deleted rows and
--       other companies' rows are excluded. mms_bytes sums message_attachments
--       for the company (no deleted_at concept there).
-- ===========================================================================
do $$
declare result jsonb; other jsonb;
begin
  -- Live note-owned rows for company A: 1000 + 2500 bytes.
  insert into public.attachments (company_id, owner_type, owner_id, conversation_id, storage_path, file_name, content_type, size_bytes)
  values
    ('d3d3d3d3-d3d3-4d3d-8d3d-d3d300000001','note','d3d3d3d3-d3d3-4d3d-8d3d-d3d300000006',
     'd3d3d3d3-d3d3-4d3d-8d3d-d3d300000005','a/live-1','part.jpg','image/jpeg',1000),
    ('d3d3d3d3-d3d3-4d3d-8d3d-d3d300000001','task','d3d3d3d3-d3d3-4d3d-8d3d-d3d300000006',
     'd3d3d3d3-d3d3-4d3d-8d3d-d3d300000005','a/live-2','quote.pdf','application/pdf',2500);
  -- Soft-deleted row: must NOT count (frees budget as soon as it is deleted).
  insert into public.attachments (company_id, owner_type, owner_id, conversation_id, storage_path, size_bytes, deleted_at)
  values
    ('d3d3d3d3-d3d3-4d3d-8d3d-d3d300000001','note','d3d3d3d3-d3d3-4d3d-8d3d-d3d300000006',
     'd3d3d3d3-d3d3-4d3d-8d3d-d3d300000005','a/deleted',999999, now());
  -- Another company's live row: must NOT leak into A's sum.
  insert into public.attachments (company_id, owner_type, owner_id, storage_path, size_bytes)
  values
    ('d3d3d3d3-d3d3-4d3d-8d3d-d3d300000002','note','d3d3d3d3-d3d3-4d3d-8d3d-d3d300000006',
     'b/live-1',777);
  -- MMS media for company A: 300 + 450 bytes (one NULL size_bytes row is a 0).
  insert into public.message_attachments (message_id, company_id, storage_path, content_type, size_bytes, source_url)
  values
    ('d3d3d3d3-d3d3-4d3d-8d3d-d3d300000006','d3d3d3d3-d3d3-4d3d-8d3d-d3d300000001',
     'd3.../0','image/jpeg',300,'https://media.telnyx.com/d3-0'),
    ('d3d3d3d3-d3d3-4d3d-8d3d-d3d300000006','d3d3d3d3-d3d3-4d3d-8d3d-d3d300000001',
     'd3.../1','image/png',450,'https://media.telnyx.com/d3-1'),
    ('d3d3d3d3-d3d3-4d3d-8d3d-d3d300000006','d3d3d3d3-d3d3-4d3d-8d3d-d3d300000001',
     'd3.../2','image/gif',null,'https://media.telnyx.com/d3-2');

  result := public.api_storage_usage('d3d3d3d3-d3d3-4d3d-8d3d-d3d300000001');
  if (result->>'attachments_bytes')::bigint is distinct from 3500 then
    raise exception 'SA-3 FAILED: attachments_bytes = % (want 3500: live rows only, both owner types)', result->>'attachments_bytes';
  end if;
  if (result->>'mms_bytes')::bigint is distinct from 750 then
    raise exception 'SA-3 FAILED: mms_bytes = % (want 750; NULL size_bytes contributes 0)', result->>'mms_bytes';
  end if;

  -- Company B sees only its own live row.
  other := public.api_storage_usage('d3d3d3d3-d3d3-4d3d-8d3d-d3d300000002');
  if (other->>'attachments_bytes')::bigint is distinct from 777 then
    raise exception 'SA-3 FAILED: company B attachments_bytes = % (want 777 — tenant isolation)', other->>'attachments_bytes';
  end if;
  raise notice 'SA-3 PASSED: live-only, tenant-scoped sums (attachments 3500, mms 750)';
end $$;

-- ===========================================================================
-- SA-4. message_attachments(company_id) index exists — the per-company MMS
--       sum must not seq-scan a table that grows with every tenant's media.
-- ===========================================================================
do $$
declare n int;
begin
  select count(*) into n from pg_indexes
  where schemaname='public' and tablename='message_attachments'
    and indexname='message_attachments_company_id_idx';
  if n is distinct from 1 then
    raise exception 'SA-4 FAILED: message_attachments_company_id_idx missing';
  end if;
  raise notice 'SA-4 PASSED: message_attachments(company_id) index present';
end $$;

-- ===========================================================================
-- Attachment/task follow-up fixes (20260704030000_attach_fixes.sql).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- SA-5 [#2]. create_task links a promoted NOTE back to the new task
--       (messages.task_id), so the note's OWN files surface in the task's
--       derived attachments union (arm (b): notes WHERE messages.task_id =
--       task). Before the fix, create_task set tasks.message_id but never the
--       source note's task_id, so a note-with-a-file promoted to a task showed
--       zero attachments. Also asserts an inbound source is NOT linked.
--       Fixtures reuse company A + convo/contact/number from above.
-- ---------------------------------------------------------------------------
do $$
declare
  v_note_id    uuid := 'd3d3d3d3-d3d3-4d3d-8d3d-d3d300000010';
  v_inbound_id uuid := 'd3d3d3d3-d3d3-4d3d-8d3d-d3d300000011';
  v_note_task  uuid;
  v_in_task    uuid;
  v_linked     uuid;
  v_att_count  int;
begin
  -- A note (status must be NULL per messages_note_status) and an inbound msg.
  insert into public.messages (id, company_id, conversation_id, direction, body, status)
  values
    (v_note_id,   'd3d3d3d3-d3d3-4d3d-8d3d-d3d300000001',
     'd3d3d3d3-d3d3-4d3d-8d3d-d3d300000005','note','order the flush valve', null),
    (v_inbound_id,'d3d3d3d3-d3d3-4d3d-8d3d-d3d300000001',
     'd3d3d3d3-d3d3-4d3d-8d3d-d3d300000005','inbound','is it fixed yet?','received');

  -- Promote the NOTE → its task_id must be set to the new task.
  v_note_task := (public.create_task(
    'd3d3d3d3-d3d3-4d3d-8d3d-d3d300000001', v_note_id,
    null, null, null, null,
    'd3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3') -> 'task' ->> 'id')::uuid;

  select task_id into v_linked from public.messages where id = v_note_id;
  if v_linked is distinct from v_note_task then
    raise exception 'SA-5 FAILED: promoted note task_id=% (want %)', v_linked, v_note_task;
  end if;

  -- Promote the INBOUND message → it must NOT be linked (only notes are).
  v_in_task := (public.create_task(
    'd3d3d3d3-d3d3-4d3d-8d3d-d3d300000001', v_inbound_id,
    null, null, null, null,
    'd3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3') -> 'task' ->> 'id')::uuid;
  select task_id into v_linked from public.messages where id = v_inbound_id;
  if v_linked is not null then
    raise exception 'SA-5 FAILED: inbound source was linked (task_id=%), only notes should link', v_linked;
  end if;

  -- Attach a file to the source NOTE, then assert the derived union counts it:
  -- the same query loadTaskAttachments arm (b) runs (live note attachments of
  -- notes linked to the task). One file → count 1.
  insert into public.attachments (company_id, owner_type, owner_id, conversation_id, storage_path, file_name, content_type, size_bytes)
  values ('d3d3d3d3-d3d3-4d3d-8d3d-d3d300000001','note', v_note_id,
          'd3d3d3d3-d3d3-4d3d-8d3d-d3d300000005','a/note-file','flush-valve.pdf','application/pdf',4096);

  select count(*) into v_att_count
    from public.attachments a
    join public.messages m on m.id = a.owner_id and m.direction = 'note'
   where a.company_id = 'd3d3d3d3-d3d3-4d3d-8d3d-d3d300000001'
     and a.owner_type = 'note'
     and a.deleted_at is null
     and m.task_id = v_note_task;
  if v_att_count is distinct from 1 then
    raise exception 'SA-5 FAILED: derived union count = % for the promoted note (want 1)', v_att_count;
  end if;

  raise notice 'SA-5 PASSED: create_task links the promoted note; its file reaches the union';
end $$;

-- ---------------------------------------------------------------------------
-- SA-6 [#3]. claim_attachment_storage is the atomic D30 budget claim: it
--       re-sums LIVE generic bytes under a per-company advisory xact lock and
--       inserts IFF sum + size <= budget, returning the row or allowed=false.
--       This replaces the check-then-write TOCTOU. Asserts: exactly-at boundary
--       is allowed (and inserts one row), one byte over is rejected (and writes
--       NO row), and the boundary holds across sequential claims (no overshoot).
--       Uses a fresh company (SA-6) with a tiny budget so the math is exact.
-- ---------------------------------------------------------------------------
do $$
declare
  v_company uuid := 'd3d3d3d3-d3d3-4d3d-8d3d-d3d300000020';
  v_convo   uuid := 'd3d3d3d3-d3d3-4d3d-8d3d-d3d300000021';
  v_owner   uuid := 'd3d3d3d3-d3d3-4d3d-8d3d-d3d300000022';
  v_r1 jsonb; v_r2 jsonb; v_r3 jsonb;
  v_live int8;
begin
  insert into public.companies (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
  values (v_company,'Claim Co','d3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3','US','415', now());
  insert into public.phone_numbers (id, company_id, status, provisioning_key, country, number_e164)
  values ('d3d3d3d3-d3d3-4d3d-8d3d-d3d300000023', v_company,'active','claim-pk-6','US','+14155557620');
  insert into public.contacts (id, company_id, phone_e164)
  values ('d3d3d3d3-d3d3-4d3d-8d3d-d3d300000024', v_company,'+14155559620');
  insert into public.conversations (id, company_id, contact_id, phone_number_id)
  values (v_convo, v_company,'d3d3d3d3-d3d3-4d3d-8d3d-d3d300000024','d3d3d3d3-d3d3-4d3d-8d3d-d3d300000023');

  -- Budget = 1000, one 600-byte live row already present → 400 bytes free.
  insert into public.attachments (company_id, owner_type, owner_id, conversation_id, storage_path, size_bytes)
  values (v_company,'note', v_owner, v_convo,'c/pre',600);

  -- Exactly-at boundary: 600 + 400 = 1000 <= 1000 → allowed, one row inserted.
  v_r1 := public.claim_attachment_storage(
    v_company,'note', v_owner, v_convo,'c/at','at.pdf','application/pdf',400,
    'd3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3', 1000);
  if (v_r1->>'allowed')::boolean is not true then
    raise exception 'SA-6 FAILED: at-boundary claim not allowed: %', v_r1;
  end if;
  if v_r1->'attachment'->>'id' is null then
    raise exception 'SA-6 FAILED: at-boundary claim returned no row: %', v_r1;
  end if;

  -- One byte over: used is now 1000; 1000 + 1 > 1000 → rejected, no row.
  v_r2 := public.claim_attachment_storage(
    v_company,'note', v_owner, v_convo,'c/over','over.pdf','application/pdf',1,
    'd3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3', 1000);
  if (v_r2->>'allowed')::boolean is not false then
    raise exception 'SA-6 FAILED: over-boundary claim was allowed: %', v_r2;
  end if;

  -- A SECOND at-boundary claim (the TOCTOU scenario): budget is already full,
  -- so it is rejected too — no N×overshoot.
  v_r3 := public.claim_attachment_storage(
    v_company,'note', v_owner, v_convo,'c/second','second.pdf','application/pdf',400,
    'd3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3', 1000);
  if (v_r3->>'allowed')::boolean is not false then
    raise exception 'SA-6 FAILED: second boundary claim overshot the budget: %', v_r3;
  end if;

  -- Live total is exactly the budget: pre (600) + at (400) = 1000; the two
  -- rejected claims wrote nothing.
  select coalesce(sum(size_bytes),0)::int8 into v_live
    from public.attachments where company_id = v_company and deleted_at is null;
  if v_live is distinct from 1000 then
    raise exception 'SA-6 FAILED: live bytes = % (want 1000 — no overshoot)', v_live;
  end if;

  raise notice 'SA-6 PASSED: atomic budget claim holds the boundary, no overshoot';
end $$;

-- ===========================================================================
-- Storage cost hardening (20260707120000_storage_egress_and_orphans.sql).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- SA-7 [#16]. The four new functions carry the api_*/claim_* security posture:
--       SECURITY DEFINER, empty search_path, EXECUTE denied to end-user roles
--       and granted to service_role only.
-- ---------------------------------------------------------------------------
do $$
declare
  fn_name text; fn regprocedure; is_secdef boolean; cfg text[];
begin
  foreach fn_name in array array[
    'claim_signed_url_egress', 'api_period_egress_bytes',
    'api_orphan_attachment_objects', 'api_ghost_attachment_rows',
    -- [#261] the per-object claim and its helper
    'claim_signed_url_egress_objects', 'egress_claimable_objects'
  ] loop
    select p.oid::regprocedure, p.prosecdef, p.proconfig
      into fn, is_secdef, cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname=fn_name;
    if fn is null then raise exception 'SA-7 FAILED: public.% missing', fn_name; end if;
    if not is_secdef then raise exception 'SA-7 FAILED: % must be SECURITY DEFINER', fn_name; end if;
    if cfg is null or not ('search_path=' = any(cfg) or 'search_path=""' = any(cfg)) then
      raise exception 'SA-7 FAILED: % must pin an empty search_path (got %)', fn_name, cfg;
    end if;
    if has_function_privilege('anon', fn, 'execute')
       or has_function_privilege('authenticated', fn, 'execute') then
      raise exception 'SA-7 FAILED: anon/authenticated must not EXECUTE %', fn_name;
    end if;
    if not has_function_privilege('service_role', fn, 'execute') then
      raise exception 'SA-7 FAILED: service_role must EXECUTE %', fn_name;
    end if;
  end loop;
  raise notice 'SA-7 PASSED: egress/orphan function security posture';
end $$;

-- ---------------------------------------------------------------------------
-- SA-8 [#16]. claim_signed_url_egress is the atomic mint-time egress claim:
--       re-sum + insert under a per-company advisory lock; exactly-at boundary
--       allowed, one byte over rejected (nothing written), a second boundary
--       claim rejected (no overshoot), a zero-byte claim at the cap rejected.
--       Uses company B (no other egress fixtures touch it) and a tiny limit.
-- ---------------------------------------------------------------------------
do $$
declare
  v_company uuid := 'd3d3d3d3-d3d3-4d3d-8d3d-d3d300000002';
  v_since timestamptz := now() - interval '1 day';
  v_r jsonb; v_total int8;
begin
  -- 600 of 1000 already minted this window.
  insert into public.egress_events (company_id, bucket, bytes, created_at)
  values (v_company, 'attachments', 600, now() - interval '1 hour');

  -- Exactly-at boundary: 600 + 400 = 1000 <= 1000 → allowed, row written.
  v_r := public.claim_signed_url_egress(v_company, v_since, 'attachments', 400, 1000);
  if (v_r->>'allowed')::boolean is not true or (v_r->>'used_bytes')::int8 is distinct from 1000 then
    raise exception 'SA-8 FAILED: at-boundary claim: %', v_r;
  end if;

  -- One byte over: rejected, nothing written, used_bytes reports the total.
  v_r := public.claim_signed_url_egress(v_company, v_since, 'mms-media', 1, 1000);
  if (v_r->>'allowed')::boolean is not false or (v_r->>'used_bytes')::int8 is distinct from 1000 then
    raise exception 'SA-8 FAILED: over-boundary claim: %', v_r;
  end if;

  -- A second boundary-sized claim (the TOCTOU scenario): rejected too.
  v_r := public.claim_signed_url_egress(v_company, v_since, 'attachments', 400, 1000);
  if (v_r->>'allowed')::boolean is not false then
    raise exception 'SA-8 FAILED: second boundary claim overshot: %', v_r;
  end if;

  -- Even a ZERO-byte claim is refused only when it would exceed — at exactly
  -- the cap, 1000 + 0 <= 1000 → allowed (a NULL-size legacy MMS row still
  -- downloads at the boundary but not past it).
  v_r := public.claim_signed_url_egress(v_company, v_since, 'mms-media', 0, 1000);
  if (v_r->>'allowed')::boolean is not true then
    raise exception 'SA-8 FAILED: zero-byte claim at the cap: %', v_r;
  end if;

  -- Ledger total is exactly the boundary; the rejected claims wrote nothing.
  select coalesce(sum(bytes),0)::int8 into v_total
    from public.egress_events where company_id = v_company;
  if v_total is distinct from 1000 then
    raise exception 'SA-8 FAILED: ledger total = % (want 1000 — no overshoot)', v_total;
  end if;

  raise notice 'SA-8 PASSED: atomic egress claim holds the boundary';
end $$;

-- ---------------------------------------------------------------------------
-- SA-8b [#261]. claim_signed_url_egress_objects charges per OBJECT, not per
--       request. The old claim counted mints, so re-minting a URL for the same
--       attachment charged again even though the previous URL was still valid
--       — one 25 MB file and a shell loop could spend the whole workspace's
--       period allowance, leaving everybody on 402 until it rolled. Asking
--       again inside the URL's own lifetime must now cost nothing, while a
--       genuinely new object still charges.
--       Uses company B, continuing from SA-8's ledger (1000 bytes at the cap).
-- ---------------------------------------------------------------------------
do $$
declare
  v_company uuid := 'd3d3d3d3-d3d3-4d3d-8d3d-d3d300000002';
  v_since timestamptz := now() - interval '1 day';
  v_ttl timestamptz := now() - interval '1 hour';   -- the URL lifetime window
  v_r jsonb; v_total int8; v_rows int;
begin
  -- Start this test from a clean ledger for B so the numbers read plainly.
  delete from public.egress_events where company_id = v_company;

  -- First mint of two objects: both are new, both charged.
  v_r := public.claim_signed_url_egress_objects(
    v_company, v_since, v_ttl,
    '[{"key":"attachments/a.pdf","bucket":"attachments","bytes":300},
      {"key":"mms-media/b.jpg","bucket":"mms-media","bytes":200}]'::jsonb,
    1000);
  if (v_r->>'allowed')::boolean is not true
     or (v_r->>'claimed_bytes')::int8 is distinct from 500
     or (v_r->>'used_bytes')::int8 is distinct from 500 then
    raise exception 'SA-8b FAILED: first claim: %', v_r;
  end if;

  -- THE BUG: the same two objects again, while their URLs are still live.
  -- Nothing new became downloadable, so nothing may be charged.
  v_r := public.claim_signed_url_egress_objects(
    v_company, v_since, v_ttl,
    '[{"key":"attachments/a.pdf","bucket":"attachments","bytes":300},
      {"key":"mms-media/b.jpg","bucket":"mms-media","bytes":200}]'::jsonb,
    1000);
  if (v_r->>'allowed')::boolean is not true
     or (v_r->>'claimed_bytes')::int8 is distinct from 0
     or (v_r->>'used_bytes')::int8 is distinct from 500 then
    raise exception 'SA-8b FAILED: repeat claim was charged: %', v_r;
  end if;

  -- A page mixing the seen object with a new one charges only the new one.
  v_r := public.claim_signed_url_egress_objects(
    v_company, v_since, v_ttl,
    '[{"key":"attachments/a.pdf","bucket":"attachments","bytes":300},
      {"key":"attachments/c.pdf","bucket":"attachments","bytes":100}]'::jsonb,
    1000);
  if (v_r->>'claimed_bytes')::int8 is distinct from 100
     or (v_r->>'used_bytes')::int8 is distinct from 600 then
    raise exception 'SA-8b FAILED: mixed page: %', v_r;
  end if;

  -- One object listed twice in a single page is one charge.
  v_r := public.claim_signed_url_egress_objects(
    v_company, v_since, v_ttl,
    '[{"key":"attachments/d.pdf","bucket":"attachments","bytes":50},
      {"key":"attachments/d.pdf","bucket":"attachments","bytes":50}]'::jsonb,
    1000);
  if (v_r->>'claimed_bytes')::int8 is distinct from 50 then
    raise exception 'SA-8b FAILED: intra-page duplicate charged twice: %', v_r;
  end if;

  -- Past the window the same object IS new exposure again, and the boundary
  -- still holds: 650 + 400 > 1000 → refused, nothing written. (The cutoff is
  -- pushed past the rows above: inside one transaction now() is frozen, so
  -- `now()` alone would still cover a row stamped in this same statement.)
  v_r := public.claim_signed_url_egress_objects(
    v_company, v_since, now() + interval '1 second',
    '[{"key":"attachments/a.pdf","bucket":"attachments","bytes":400}]'::jsonb,
    1000);
  if (v_r->>'allowed')::boolean is not false
     or (v_r->>'claimed_bytes')::int8 is distinct from 0
     or (v_r->>'used_bytes')::int8 is distinct from 650 then
    raise exception 'SA-8b FAILED: over-boundary re-exposure: %', v_r;
  end if;

  -- Ledger: one row per charged object, totalling what was charged.
  select count(*), coalesce(sum(bytes),0)::int8 into v_rows, v_total
    from public.egress_events where company_id = v_company;
  if v_rows is distinct from 4 or v_total is distinct from 650 then
    raise exception 'SA-8b FAILED: ledger = % rows / % bytes (want 4 / 650)',
      v_rows, v_total;
  end if;
  -- Every row carries the object it paid for, which is what makes the repeat
  -- lookup possible at all.
  if exists (select 1 from public.egress_events
              where company_id = v_company and object_key is null) then
    raise exception 'SA-8b FAILED: a claimed row has no object_key';
  end if;

  raise notice 'SA-8b PASSED: egress is charged per object, not per request';
end $$;

-- ---------------------------------------------------------------------------
-- SA-9 [#16]. api_period_egress_bytes: window- and tenant-scoped sum (rows
--       before p_since and other companies' rows are excluded; empty → 0).
-- ---------------------------------------------------------------------------
do $$
declare v int8;
begin
  -- Company A: one row inside the window, one before it, plus B's SA-8 rows.
  insert into public.egress_events (company_id, bucket, bytes, created_at) values
    ('d3d3d3d3-d3d3-4d3d-8d3d-d3d300000001', 'attachments', 250, now() - interval '1 hour'),
    ('d3d3d3d3-d3d3-4d3d-8d3d-d3d300000001', 'mms-media',   999, now() - interval '10 days');

  v := public.api_period_egress_bytes('d3d3d3d3-d3d3-4d3d-8d3d-d3d300000001', now() - interval '1 day');
  if v is distinct from 250 then
    raise exception 'SA-9 FAILED: window sum = % (want 250: in-window, own-company only)', v;
  end if;
  v := public.api_period_egress_bytes('d3d3d3d3-d3d3-4d3d-8d3d-d3d300000001', now() - interval '30 days');
  if v is distinct from 1249 then
    raise exception 'SA-9 FAILED: wide-window sum = % (want 1249)', v;
  end if;

  raise notice 'SA-9 PASSED: api_period_egress_bytes window + tenant scoping';
end $$;

-- ---------------------------------------------------------------------------
-- SA-10 [#16]. usage_alerts accepts the new 'egress' metric (the alert cron's
--       sixth arm) and still rejects an unknown metric.
-- ---------------------------------------------------------------------------
do $$
begin
  insert into public.usage_alerts (company_id, period_start, metric, threshold)
  values ('d3d3d3d3-d3d3-4d3d-8d3d-d3d300000001', now(), 'egress', 80);

  begin
    insert into public.usage_alerts (company_id, period_start, metric, threshold)
    values ('d3d3d3d3-d3d3-4d3d-8d3d-d3d300000001', now(), 'bogus', 80);
    raise exception 'SA-10 FAILED: unknown metric was accepted';
  exception when check_violation then
    null; -- expected
  end;

  raise notice 'SA-10 PASSED: usage_alerts egress metric allowed, unknown rejected';
end $$;

-- ---------------------------------------------------------------------------
-- SA-11 [#15]. The orphan/ghost anti-joins:
--       api_orphan_attachment_objects returns attachments-bucket objects older
--       than the cutoff with NO attachments row (live OR soft-deleted rows
--       both anchor their object); api_ghost_attachment_rows returns LIVE rows
--       older than the cutoff with NO object (soft-deleted and young rows are
--       excluded). Fixtures write storage.objects directly (postgres-owned
--       test session; the Worker only ever reads via the RPCs).
-- ---------------------------------------------------------------------------
do $$
declare
  v_company uuid := 'd3d3d3d3-d3d3-4d3d-8d3d-d3d300000001';
  v_owner   uuid := 'd3d3d3d3-d3d3-4d3d-8d3d-d3d300000006';
  v_convo   uuid := 'd3d3d3d3-d3d3-4d3d-8d3d-d3d300000005';
  v_names text[]; v_ids uuid[];
begin
  -- Storage objects: an aged orphan (returned), a fresh orphan (grace window),
  -- an aged object WITH a live row, an aged object WITH a soft-deleted row
  -- (still anchored — pass 1 owns it), and an aged orphan in ANOTHER bucket.
  insert into storage.objects (bucket_id, name, created_at) values
    ('attachments', 'sa11/orphan-old',    now() - interval '1 hour'),
    ('attachments', 'sa11/orphan-fresh',  now()),
    ('attachments', 'sa11/anchored-live', now() - interval '1 hour'),
    ('attachments', 'sa11/anchored-soft', now() - interval '1 hour'),
    ('mms-media',   'sa11/other-bucket',  now() - interval '1 hour');
  insert into public.attachments (company_id, owner_type, owner_id, conversation_id, storage_path, size_bytes)
  values (v_company, 'note', v_owner, v_convo, 'sa11/anchored-live', 10);
  insert into public.attachments (company_id, owner_type, owner_id, conversation_id, storage_path, size_bytes, deleted_at)
  values (v_company, 'note', v_owner, v_convo, 'sa11/anchored-soft', 10, now());

  -- Generous limit: a local dev bucket may hold unrelated aged orphans; the
  -- sa11/ filter isolates this suite's fixtures.
  select coalesce(array_agg(name), '{}') into v_names
    from public.api_orphan_attachment_objects(now() - interval '15 minutes', 10000) as name
   where name like 'sa11/%';
  if v_names is distinct from array['sa11/orphan-old'] then
    raise exception 'SA-11 FAILED: orphan objects = % (want {sa11/orphan-old})', v_names;
  end if;

  -- Ghost rows: an aged live row with no object (returned), an aged
  -- soft-deleted row with no object (pass-1 territory, excluded), a fresh live
  -- row with no object (grace window, excluded); anchored-live has its object.
  insert into public.attachments (company_id, owner_type, owner_id, conversation_id, storage_path, size_bytes, created_at)
  values (v_company, 'note', v_owner, v_convo, 'sa11/ghost-old', 10, now() - interval '1 hour');
  insert into public.attachments (company_id, owner_type, owner_id, conversation_id, storage_path, size_bytes, created_at, deleted_at)
  values (v_company, 'note', v_owner, v_convo, 'sa11/soft-no-object', 10, now() - interval '1 hour', now());
  insert into public.attachments (company_id, owner_type, owner_id, conversation_id, storage_path, size_bytes)
  values (v_company, 'note', v_owner, v_convo, 'sa11/ghost-fresh', 10);

  select coalesce(array_agg(a.id), '{}') into v_ids
    from public.api_ghost_attachment_rows(now() - interval '15 minutes', 10000) as gid
    join public.attachments a on a.id = gid
   where a.storage_path like 'sa11/%';
  if array_length(v_ids, 1) is distinct from 1
     or not exists (
       select 1 from public.attachments a
       where a.id = v_ids[1] and a.storage_path = 'sa11/ghost-old'
     ) then
    raise exception 'SA-11 FAILED: ghost rows matched paths % (want exactly sa11/ghost-old)',
      (select array_agg(a.storage_path) from public.attachments a where a.id = any(v_ids));
  end if;

  raise notice 'SA-11 PASSED: orphan-object and ghost-row anti-joins';
end $$;

-- ---------------------------------------------------------------------------
-- SA-12 [#263]. The mms-media anti-joins. Passes 2/3 hardcode
--       bucket_id = 'attachments', so NOTHING had ever swept the bucket that
--       holds message media: a crashed MMS send left objects no read path could
--       reach, no accounting counted (mms_bytes sums ROWS), and no pass would
--       ever reclaim. These two RPCs are the same pair for that bucket.
--
--       The load-bearing assertion is the LAST one. message_attachments holds
--       INBOUND rows as well as outbound (they carry source_url), so a ghost
--       sweep that got its predicate wrong would hard-delete a customer's
--       received photos. Inbound stores its own copy in this bucket before
--       inserting the row, so an anchored row is safe in both directions — and
--       that has to be asserted, not assumed.
-- ---------------------------------------------------------------------------
do $$
declare
  v_company uuid := 'd3d3d3d3-d3d3-4d3d-8d3d-d3d300000001';
  v_message uuid := 'd3d3d3d3-d3d3-4d3d-8d3d-d3d300000006';
  v_names text[]; v_ids uuid[];
  fn oid; is_secdef boolean; cfg text[];
begin
  -- Security posture, same bar as every other api_* function. Both must exist;
  -- the orphan one carries the full posture assertions below (they share a
  -- definition template, so one is enough to catch a slipped GRANT).
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'api_ghost_mms_media_rows'
  ) then
    raise exception 'SA-12 FAILED: public.api_ghost_mms_media_rows missing';
  end if;

  select p.oid, p.prosecdef, p.proconfig into fn, is_secdef, cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'api_orphan_mms_media_objects';
  if not is_secdef then
    raise exception 'SA-12 FAILED: api_orphan_mms_media_objects must be SECURITY DEFINER';
  end if;
  if cfg is null or not ('search_path=' = any(cfg) or 'search_path=""' = any(cfg)) then
    raise exception 'SA-12 FAILED: api_orphan_mms_media_objects must pin an empty search_path (got %)', cfg;
  end if;
  if has_function_privilege('anon', fn, 'EXECUTE')
     or has_function_privilege('authenticated', fn, 'EXECUTE') then
    raise exception 'SA-12 FAILED: anon/authenticated must not EXECUTE api_orphan_mms_media_objects';
  end if;
  if not has_function_privilege('service_role', fn, 'EXECUTE') then
    raise exception 'SA-12 FAILED: service_role must EXECUTE api_orphan_mms_media_objects';
  end if;

  -- Fixtures. sa12/ paths keep this independent of SA-11's objects (which
  -- deliberately include one mms-media object of its own).
  insert into storage.objects (bucket_id, name, created_at) values
    ('mms-media',   'sa12/orphan-old',    now() - interval '1 hour'),
    ('mms-media',   'sa12/orphan-fresh',  now()),
    ('mms-media',   'sa12/anchored-out',  now() - interval '1 hour'),
    ('mms-media',   'sa12/anchored-in',   now() - interval '1 hour'),
    ('attachments', 'sa12/wrong-bucket',  now() - interval '1 hour');

  -- An OUTBOUND row (source_url null) and an INBOUND row (source_url set), both
  -- with their object present. Neither may be swept from either direction.
  insert into public.message_attachments
    (message_id, company_id, storage_path, content_type, size_bytes, source_url, created_at)
  values
    (v_message, v_company, 'sa12/anchored-out', 'image/jpeg', 300, null,
     now() - interval '1 hour'),
    (v_message, v_company, 'sa12/anchored-in', 'image/png', 450,
     'https://media.telnyx.com/sa12-in', now() - interval '1 hour');

  -- Orphan objects: aged + row-less only. The fresh one is inside the grace
  -- window (that window is what stops an in-flight send being swept between its
  -- upload and its row insert), the anchored two have rows, and the
  -- attachments-bucket object belongs to a different pass entirely.
  select coalesce(array_agg(name order by name), '{}') into v_names
    from public.api_orphan_mms_media_objects(now() - interval '15 minutes', 10000) as name
   where name like 'sa12/%';
  if v_names is distinct from array['sa12/orphan-old'] then
    raise exception 'SA-12 FAILED: orphan mms objects = % (want {sa12/orphan-old})', v_names;
  end if;

  -- And the reverse containment: the mms scan must never return an
  -- attachments-bucket object, or the sweeper would try to remove it from the
  -- wrong bucket and report success having deleted nothing.
  if exists (
    select 1 from public.api_orphan_mms_media_objects(now() - interval '15 minutes', 10000) as name
     where name = 'sa12/wrong-bucket'
  ) then
    raise exception 'SA-12 FAILED: mms orphan scan reached into the attachments bucket';
  end if;

  -- Ghost rows: an aged row whose object is gone (returned), and a fresh one
  -- (grace window, excluded).
  insert into public.message_attachments
    (message_id, company_id, storage_path, content_type, size_bytes, source_url, created_at)
  values
    (v_message, v_company, 'sa12/ghost-old', 'image/jpeg', 10, null,
     now() - interval '1 hour'),
    (v_message, v_company, 'sa12/ghost-fresh', 'image/jpeg', 10, null, now());

  select coalesce(array_agg(a.storage_path order by a.storage_path), '{}') into v_names
    from public.api_ghost_mms_media_rows(now() - interval '15 minutes', 10000) as gid
    join public.message_attachments a on a.id = gid
   where a.storage_path like 'sa12/%';
  if v_names is distinct from array['sa12/ghost-old'] then
    raise exception 'SA-12 FAILED: ghost mms rows = % (want {sa12/ghost-old})', v_names;
  end if;

  -- THE ONE THAT MATTERS: neither anchored row is a ghost. If the predicate
  -- were wrong in the inbound direction this sweep would hard-delete photos a
  -- customer actually sent us, which is data loss dressed as garbage collection.
  select coalesce(array_agg(a.storage_path), '{}') into v_names
    from public.api_ghost_mms_media_rows(now() - interval '15 minutes', 10000) as gid
    join public.message_attachments a on a.id = gid
   where a.storage_path in ('sa12/anchored-out', 'sa12/anchored-in');
  if v_names is distinct from '{}'::text[] then
    raise exception 'SA-12 FAILED: swept anchored rows % — an object EXISTS for each', v_names;
  end if;

  raise notice 'SA-12 PASSED: mms-media anti-joins, both directions, inbound rows safe';
end $$;



-- ===========================================================================
-- SA-13 (#479). The two buckets that had NO reclamation at all.
--
--   `voicemails` had none in either direction: a recording is pulled into our
--   bucket and the Telnyx copy deleted, so ours is the only one, and nothing
--   ever looked for the objects no call row points at. Those are a stranger's
--   recorded voice, in a bucket the product could not enumerate.
--
--   `exports` had delete-on-expiry only, driven entirely by the data_exports
--   row (#378). Lose the row, or fail midway through a reap, and a copy of
--   every message in a workspace sits in a bucket with nothing tracking it.
--
-- The asymmetry asserted here is the one that matters: an orphan OBJECT is
-- deletable, but a ghost voicemail row is NOT deleted. `calls` is a business
-- record and outlives its audio, so the RPC only reports and the caller clears
-- the pointer while keeping the transcript.
-- ===========================================================================
do $$
declare
  v_company uuid := 'd3d3d3d3-d3d3-4d3d-8d3d-d3d300000001';
  v_names   text[];
  v_ids     uuid[];
begin
  insert into storage.objects (bucket_id, name, created_at) values
    ('voicemails', 'sa13/vm-orphan-old',   now() - interval '1 hour'),
    ('voicemails', 'sa13/vm-orphan-fresh', now()),
    ('voicemails', 'sa13/vm-anchored',     now() - interval '1 hour'),
    ('attachments','sa13/vm-wrong-bucket', now() - interval '1 hour');

  insert into public.calls
    (id, company_id, call_session_id, caller_e164, direction, outcome,
     started_at, voicemail_seconds, voicemail_path, voicemail_transcript)
  values
    ('d3d3d3d3-d3d3-4d3d-8d3d-d3d300000131', v_company, 'sa13-s1', '+14155550131',
     'inbound', 'voicemail', now() - interval '1 hour', 12, 'sa13/vm-anchored', 'anchored words'),
    ('d3d3d3d3-d3d3-4d3d-8d3d-d3d300000132', v_company, 'sa13-s2', '+14155550132',
     'inbound', 'voicemail', now() - interval '1 hour', 9, 'sa13/vm-ghost', 'ghost words'),
    ('d3d3d3d3-d3d3-4d3d-8d3d-d3d300000133', v_company, 'sa13-s3', '+14155550133',
     'inbound', 'voicemail', now(), 5, 'sa13/vm-ghost-fresh', 'too new');

  -- Orphan objects: old, in this bucket, with no call pointing at them. The
  -- fresh one is inside the grace window (an upload whose row stamp has not
  -- landed yet); the attachments-bucket object belongs to another sweep.
  select coalesce(array_agg(name order by name), '{}') into v_names
    from public.api_orphan_voicemail_objects(now() - interval '15 minutes', 10000) as name
   where name like 'sa13/%';
  if v_names is distinct from array['sa13/vm-orphan-old'] then
    raise exception 'SA-13 FAILED: orphan voicemail objects = % (want {sa13/vm-orphan-old})', v_names;
  end if;

  -- Ghost calls: a voicemail_path with no object. The fresh row is inside the
  -- grace window; the anchored one has its object and must never be reported.
  select coalesce(array_agg(gid), '{}') into v_ids
    from public.api_ghost_voicemail_calls(now() - interval '15 minutes', 10000) as gid
   where gid in ('d3d3d3d3-d3d3-4d3d-8d3d-d3d300000131',
                 'd3d3d3d3-d3d3-4d3d-8d3d-d3d300000132',
                 'd3d3d3d3-d3d3-4d3d-8d3d-d3d300000133');
  if v_ids is distinct from array['d3d3d3d3-d3d3-4d3d-8d3d-d3d300000132']::uuid[] then
    raise exception 'SA-13 FAILED: ghost voicemail calls = % (want the one ghost)', v_ids;
  end if;

  raise notice 'SA-13 PASSED: voicemail anti-joins, both directions, anchored call safe';
end $$;

-- ===========================================================================
-- SA-14 (#479). Orphan export objects, and the prefix match that must not be
-- a pattern match.
--
-- An export object is a copy of an entire company's data. The predicate uses
-- left(name, length(prefix)) rather than `like prefix || '%'` precisely so a
-- prefix containing an underscore or a percent sign cannot be read as a
-- wildcard and match a DIFFERENT workspace's export. Asserted rather than
-- trusted, because the cost of getting it wrong is deleting the wrong
-- company's data.
-- ===========================================================================
do $$
declare
  v_company uuid := 'd3d3d3d3-d3d3-4d3d-8d3d-d3d300000001';
  v_user    uuid := 'd3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3';
  v_names   text[];
begin
  insert into storage.objects (bucket_id, name, created_at) values
    ('exports', 'sa14/live_x/messages.csv',  now() - interval '1 hour'),
    ('exports', 'sa14/reaped/messages.csv',  now() - interval '1 hour'),
    ('exports', 'sa14/nobody/messages.csv',  now() - interval '1 hour'),
    ('exports', 'sa14/fresh/messages.csv',   now());

  -- A LIVE export whose prefix contains an underscore. Under a `like` predicate
  -- the underscore is a single-character wildcard, so 'sa14/live_x' would also
  -- match 'sa14/liveQx' -- the shape of accident this asserts against.
  insert into public.data_exports (id, company_id, requested_by, status, storage_prefix)
  values ('d3d3d3d3-d3d3-4d3d-8d3d-d3d300000141', v_company, v_user, 'ready', 'sa14/live_x');
  -- A REAPED export: #378 already removed its objects, so anything still under
  -- its prefix is debris from a partly-failed reap.
  insert into public.data_exports
    (id, company_id, requested_by, status, storage_prefix, reaped_at)
  values ('d3d3d3d3-d3d3-4d3d-8d3d-d3d300000142', v_company, v_user, 'ready',
          'sa14/reaped', now() - interval '1 day');

  select coalesce(array_agg(name order by name), '{}') into v_names
    from public.api_orphan_export_objects(now() - interval '15 minutes', 10000) as name
   where name like 'sa14/%';
  if v_names is distinct from array['sa14/nobody/messages.csv', 'sa14/reaped/messages.csv'] then
    raise exception 'SA-14 FAILED: orphan export objects = % (want the reaped and the unreferenced)', v_names;
  end if;

  -- The live export's object is NOT orphaned. This is the assertion that would
  -- catch a predicate deleting a customer's downloadable export.
  if 'sa14/live_x/messages.csv' = any(v_names) then
    raise exception 'SA-14 FAILED: swept a LIVE export object';
  end if;

  raise notice 'SA-14 PASSED: export orphans found, live export untouched, prefix is not a pattern';
end $$;

-- ===========================================================================
-- SA-15 (#479). The three new functions carry the same posture as the rest:
-- SECURITY DEFINER, empty search_path, service_role only.
--
-- They read storage.objects and, for exports, every workspace's prefixes. An
-- authenticated grant on any of them would let one tenant enumerate another
-- tenant's object keys.
-- ===========================================================================
do $$
declare
  fn        regprocedure;
  is_secdef boolean;
  cfg       text[];
  fname     text;
begin
  foreach fname in array array[
    'api_orphan_voicemail_objects',
    'api_ghost_voicemail_calls',
    'api_orphan_export_objects'
  ] loop
    fn := ('public.' || fname || '(timestamptz, int)')::regprocedure;
    select p.prosecdef, p.proconfig into is_secdef, cfg
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fname;
    if not is_secdef then
      raise exception 'SA-15 FAILED: % must be SECURITY DEFINER', fname;
    end if;
    if cfg is null or not ('search_path=' = any(cfg) or 'search_path=""' = any(cfg)) then
      raise exception 'SA-15 FAILED: % must pin an empty search_path (got %)', fname, cfg;
    end if;
    if has_function_privilege('anon', fn, 'EXECUTE')
       or has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception 'SA-15 FAILED: anon/authenticated must not EXECUTE %', fname;
    end if;
    if not has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception 'SA-15 FAILED: service_role must EXECUTE %', fname;
    end if;
  end loop;
  raise notice 'SA-15 PASSED: the three #479 functions are service-role only';
end $$;

rollback;
