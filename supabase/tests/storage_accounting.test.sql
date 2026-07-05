-- D30 storage accounting assertion suite — api_storage_usage(p_company_id)
-- (supabase/migrations/20260704050000_storage_accounting.sql): the exact
-- per-company stored-bytes sums behind the POST /v1/attachments budget gate
-- and the GET /v1/usage `storage` arm.
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
  if (result->>'attachments_bytes')::bigint <> 0 then
    raise exception 'SA-2 FAILED: empty company attachments_bytes = % (want 0)', result->>'attachments_bytes';
  end if;
  if (result->>'mms_bytes')::bigint <> 0 then
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
  if (result->>'attachments_bytes')::bigint <> 3500 then
    raise exception 'SA-3 FAILED: attachments_bytes = % (want 3500: live rows only, both owner types)', result->>'attachments_bytes';
  end if;
  if (result->>'mms_bytes')::bigint <> 750 then
    raise exception 'SA-3 FAILED: mms_bytes = % (want 750; NULL size_bytes contributes 0)', result->>'mms_bytes';
  end if;

  -- Company B sees only its own live row.
  other := public.api_storage_usage('d3d3d3d3-d3d3-4d3d-8d3d-d3d300000002');
  if (other->>'attachments_bytes')::bigint <> 777 then
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
  if n <> 1 then
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
  if v_att_count <> 1 then
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
  if v_live <> 1000 then
    raise exception 'SA-6 FAILED: live bytes = % (want 1000 — no overshoot)', v_live;
  end if;

  raise notice 'SA-6 PASSED: atomic budget claim holds the boundary, no overshoot';
end $$;

rollback;
