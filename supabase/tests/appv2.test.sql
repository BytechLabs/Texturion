-- JobText app-v2 backend schema assertion suite (D17/D19/D22/D25).
-- Covers: tasks (derived-completion model, message_id NOT NULL + partial-unique,
-- NO status/done column), generic attachments (owner_type discriminator, 25 MB,
-- append-only/no updated_at, RLS deny-by-default), contacts geocode columns, the
-- ten conversation_event_type additions (TASKS.md T8), and the private
-- `attachments` storage bucket (25 MB + MIME allow-list).
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_JobText psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/appv2.test.sql
-- (root script: pnpm run db:test:appv2, wired into db:test:all)
--
-- The whole suite runs in one transaction and ROLLS BACK: it never pollutes the
-- local database. Self-contained fixtures (own auth.users / company / number /
-- contact / conversation / message) with a distinct 'a7'/'b7' id prefix so the
-- file runs standalone OR after the other suites in one psql session without id
-- collisions.
--   owner      = a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7
--   member2    = a7a7a7a7-a7a7-4a7a-8a7a-a7a700000002
--   company    = b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7
--   number     = b7b7b7b7-b7b7-4b7b-8b7b-b7b700000001
--   contact    = b7b7b7b7-b7b7-4b7b-8b7b-b7b700000002
--   convo      = b7b7b7b7-b7b7-4b7b-8b7b-b7b700000003
--   message    = b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004
--
-- NOTE: psql :vars are NOT interpolated inside dollar-quoted DO blocks (the
-- server receives the body verbatim), so fixture ids are written as literal
-- UUIDs throughout.

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- Fixtures (shared by the behavioral tests below).
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7','appv2-owner@test.local'),
  ('a7a7a7a7-a7a7-4a7a-8a7a-a7a700000002','appv2-member2@test.local');

insert into public.companies (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
  values ('b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7','App-v2 Co',
          'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7','US','415', now());

insert into public.phone_numbers (id, company_id, status, provisioning_key, country, number_e164)
  values ('b7b7b7b7-b7b7-4b7b-8b7b-b7b700000001','b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7',
          'active','appv2-pk','US','+14155557001');

insert into public.contacts (id, company_id, phone_e164, address)
  values ('b7b7b7b7-b7b7-4b7b-8b7b-b7b700000002','b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7',
          '+14155559001','1 Market St, San Francisco, CA');

insert into public.conversations (id, company_id, contact_id, phone_number_id)
  values ('b7b7b7b7-b7b7-4b7b-8b7b-b7b700000003','b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7',
          'b7b7b7b7-b7b7-4b7b-8b7b-b7b700000002','b7b7b7b7-b7b7-4b7b-8b7b-b7b700000001');

insert into public.messages (id, company_id, conversation_id, direction, body, status)
  values ('b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004','b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7',
          'b7b7b7b7-b7b7-4b7b-8b7b-b7b700000003','inbound','fix the sink please','received');

-- ===========================================================================
-- A1. tasks exists; RLS ENABLED; NO RLS policies (deny-by-default — the Worker
--     uses the service_role sb_secret_ key, SPEC §6/D8).
-- ===========================================================================
do $$
declare has_rls boolean; n_pol int;
begin
  select relrowsecurity into has_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname='public' and c.relname='tasks';
  if has_rls is null then raise exception 'A1 FAILED: public.tasks table missing'; end if;
  if not has_rls then raise exception 'A1 FAILED: RLS not enabled on tasks'; end if;
  select count(*) into n_pol from pg_policies where schemaname='public' and tablename='tasks';
  if n_pol <> 0 then raise exception 'A1 FAILED: tasks has % RLS policies (want 0)', n_pol; end if;
  raise notice 'A1 PASSED: tasks exists, RLS enabled, deny-by-default (0 policies)';
end $$;

-- ===========================================================================
-- A2. tasks has the DERIVED model: message_id NOT NULL, conversation_id NOT
--     NULL, and NO status / done_at / done_by / task_status column or enum
--     (completion is a JOIN read of messages.done_at, D17).
-- ===========================================================================
do $$
declare mid_null boolean; cid_null boolean; bad text;
begin
  select is_nullable='YES' into mid_null from information_schema.columns
  where table_schema='public' and table_name='tasks' and column_name='message_id';
  if mid_null is null then raise exception 'A2 FAILED: tasks.message_id missing'; end if;
  if mid_null then raise exception 'A2 FAILED: tasks.message_id must be NOT NULL (D17)'; end if;

  select is_nullable='YES' into cid_null from information_schema.columns
  where table_schema='public' and table_name='tasks' and column_name='conversation_id';
  if cid_null is null then raise exception 'A2 FAILED: tasks.conversation_id missing'; end if;
  if cid_null then raise exception 'A2 FAILED: tasks.conversation_id must be NOT NULL'; end if;

  select string_agg(column_name, ', ') into bad from information_schema.columns
  where table_schema='public' and table_name='tasks'
    and column_name in ('status','done_at','done_by_user_id','done');
  if bad is not null then
    raise exception 'A2 FAILED: tasks must NOT have a completion column (D17), found: %', bad;
  end if;

  if exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
             where n.nspname='public' and t.typname='task_status') then
    raise exception 'A2 FAILED: task_status enum must NOT exist (D17 derived model)';
  end if;
  raise notice 'A2 PASSED: tasks is the derived model (message_id+conversation_id NOT NULL; no status/done column; no task_status enum)';
end $$;

-- ===========================================================================
-- A3. tasks FK ON DELETE actions (SPEC §6): message_id/conversation_id/company_id
--     /created_by RESTRICT; assigned_user_id SET NULL (mirrors conversations).
-- ===========================================================================
do $$
declare
  r record;
  want jsonb := jsonb_build_object(
    'company_id','r','message_id','r','conversation_id','r',
    'created_by_user_id','r','assigned_user_id','n');
begin
  for r in
    select att.attname as col, con.confdeltype as del
    from pg_constraint con
    join pg_attribute att on att.attrelid=con.conrelid and att.attnum=con.conkey[1]
    where con.conrelid='public.tasks'::regclass and con.contype='f'
  loop
    if want ? r.col and (want->>r.col) <> r.del then
      raise exception 'A3 FAILED: tasks.% ON DELETE is % (want %)', r.col, r.del, want->>r.col;
    end if;
  end loop;
  raise notice 'A3 PASSED: tasks FK ON DELETE actions correct (assignee SET NULL, rest RESTRICT)';
end $$;

-- ===========================================================================
-- A4. tasks indexes: the partial-unique on message_id WHERE deleted_at IS NULL
--     (one live task per message) + the three read indexes (all partial on
--     deleted_at) exist (TASKS.md T1.1).
-- ===========================================================================
do $$
declare miss text;
begin
  select string_agg(x.name, ', ') into miss from (values
    ('tasks_message_uq'),('tasks_conversation_idx'),
    ('tasks_company_assignee_idx'),('tasks_company_due_idx')) x(name)
  where not exists (select 1 from pg_indexes
    where schemaname='public' and tablename='tasks' and indexname=x.name);
  if miss is not null then raise exception 'A4 FAILED: missing task indexes: %', miss; end if;

  -- the message_uq must be UNIQUE and partial on deleted_at IS NULL
  if not exists (
    select 1 from pg_indexes
    where schemaname='public' and tablename='tasks' and indexname='tasks_message_uq'
      and indexdef ilike '%unique%' and indexdef ilike '%deleted_at is null%')
  then
    raise exception 'A4 FAILED: tasks_message_uq is not a partial-UNIQUE on (message_id) WHERE deleted_at IS NULL';
  end if;
  raise notice 'A4 PASSED: tasks partial-unique + 3 read indexes present';
end $$;

-- ===========================================================================
-- A5. ONE LIVE TASK PER MESSAGE (the partial-unique in action) + re-promote
--     after soft-delete gets a fresh task (D17/TASKS.md T1.1).
-- ===========================================================================
do $$
begin
  insert into public.tasks (company_id, message_id, conversation_id, title, created_by_user_id)
  values ('b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7','b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004',
          'b7b7b7b7-b7b7-4b7b-8b7b-b7b700000003','Fix sink',
          'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7');

  begin
    insert into public.tasks (company_id, message_id, conversation_id, title, created_by_user_id)
    values ('b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7','b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004',
            'b7b7b7b7-b7b7-4b7b-8b7b-b7b700000003','dup',
            'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7');
    raise exception 'A5 FAILED: a second LIVE task for the same message was allowed';
  exception when unique_violation then null;  -- expected
  end;

  -- soft-delete the live task, then re-promote → a fresh task is allowed
  update public.tasks set deleted_at=now()
  where message_id='b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004' and deleted_at is null;
  insert into public.tasks (company_id, message_id, conversation_id, title, created_by_user_id)
  values ('b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7','b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004',
          'b7b7b7b7-b7b7-4b7b-8b7b-b7b700000003','re-promoted',
          'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7');

  if (select count(*) from public.tasks
      where message_id='b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004' and deleted_at is null) <> 1 then
    raise exception 'A5 FAILED: expected exactly one LIVE task after re-promote';
  end if;
  raise notice 'A5 PASSED: one live task per message; re-promote after soft-delete works';
end $$;

-- ===========================================================================
-- A6. COMPLETION IS DERIVED from messages.done_at (D17). The task carries no
--     done state; marking the source message done flips the derived status, and
--     soft-deleting the task does NOT touch messages.done_at.
-- ===========================================================================
do $$
declare derived_open boolean; derived_done boolean; msg_done_after_delete boolean;
begin
  -- with message not done → derived status is open
  select m.done_at is null into derived_open
  from public.tasks t join public.messages m on m.id=t.message_id
  where t.message_id='b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004' and t.deleted_at is null;
  if not derived_open then raise exception 'A6 FAILED: task should render open while message not done'; end if;

  -- mark the SOURCE MESSAGE done (the single write path, D14/D17) → derived done
  update public.messages set done_at=now(),
         done_by_user_id='a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7'
  where id='b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004';
  select m.done_at is not null into derived_done
  from public.tasks t join public.messages m on m.id=t.message_id
  where t.message_id='b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004' and t.deleted_at is null;
  if not derived_done then raise exception 'A6 FAILED: task did not derive done from messages.done_at'; end if;

  -- soft-delete the task → messages.done_at is UNTOUCHED (D17/T1.1)
  update public.tasks set deleted_at=now()
  where message_id='b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004' and deleted_at is null;
  select done_at is not null into msg_done_after_delete
  from public.messages where id='b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004';
  if not msg_done_after_delete then
    raise exception 'A6 FAILED: soft-deleting the task cleared messages.done_at (it must not)';
  end if;
  raise notice 'A6 PASSED: completion derives from messages.done_at; task soft-delete never touches it';
end $$;

-- reset the fixture message + tasks so later tests start clean
delete from public.tasks where message_id='b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004';
update public.messages set done_at=null, done_by_user_id=null
  where id='b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004';

-- ===========================================================================
-- A7. title length CHECK (1..500) — empty and over-long titles are rejected.
-- ===========================================================================
do $$
begin
  begin
    insert into public.tasks (company_id, message_id, conversation_id, title, created_by_user_id)
    values ('b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7','b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004',
            'b7b7b7b7-b7b7-4b7b-8b7b-b7b700000003','',
            'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7');
    raise exception 'A7 FAILED: empty title accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.tasks (company_id, message_id, conversation_id, title, created_by_user_id)
    values ('b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7','b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004',
            'b7b7b7b7-b7b7-4b7b-8b7b-b7b700000003', repeat('x',501),
            'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7');
    raise exception 'A7 FAILED: 501-char title accepted';
  exception when check_violation then null;
  end;
  raise notice 'A7 PASSED: title length CHECK (1..500) enforced';
end $$;

-- ===========================================================================
-- A8. tasks moddatetime + task.changed broadcast trigger both wired (T1.3).
-- ===========================================================================
do $$
declare has_mod boolean; has_bcast boolean; is_definer boolean;
begin
  select exists (select 1 from pg_trigger where tgrelid='public.tasks'::regclass
    and tgname='set_updated_at' and not tgisinternal) into has_mod;
  if not has_mod then raise exception 'A8 FAILED: tasks missing moddatetime set_updated_at trigger'; end if;

  select exists (select 1 from pg_trigger where tgrelid='public.tasks'::regclass
    and tgname='tasks_broadcast' and not tgisinternal) into has_bcast;
  if not has_bcast then raise exception 'A8 FAILED: tasks missing tasks_broadcast trigger'; end if;

  select prosecdef into is_definer from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='broadcast_task_changed';
  if is_definer is null then raise exception 'A8 FAILED: broadcast_task_changed() function missing'; end if;
  if not is_definer then raise exception 'A8 FAILED: broadcast_task_changed() must be SECURITY DEFINER'; end if;
  raise notice 'A8 PASSED: tasks has moddatetime + SECURITY DEFINER task.changed broadcast trigger';
end $$;

-- ===========================================================================
-- A9. attachments exists; RLS ENABLED; NO RLS policies (deny-by-default, D8);
--     APPEND-ONLY — it must have NO updated_at column and NO moddatetime trigger
--     (APP-FEATURES-V2 §2.1).
-- ===========================================================================
do $$
declare has_rls boolean; n_pol int; has_upd boolean; n_trig int;
begin
  select relrowsecurity into has_rls
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='attachments';
  if has_rls is null then raise exception 'A9 FAILED: public.attachments table missing'; end if;
  if not has_rls then raise exception 'A9 FAILED: RLS not enabled on attachments'; end if;
  select count(*) into n_pol from pg_policies where schemaname='public' and tablename='attachments';
  if n_pol <> 0 then raise exception 'A9 FAILED: attachments has % RLS policies (want 0)', n_pol; end if;

  select exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='attachments' and column_name='updated_at') into has_upd;
  if has_upd then raise exception 'A9 FAILED: attachments must be append-only (no updated_at, D19)'; end if;

  select count(*) into n_trig from pg_trigger
  where tgrelid='public.attachments'::regclass and not tgisinternal;
  if n_trig <> 0 then
    raise exception 'A9 FAILED: attachments must have no triggers (append-only; no moddatetime), found %', n_trig;
  end if;
  raise notice 'A9 PASSED: attachments exists, RLS deny-by-default, append-only (no updated_at, no triggers)';
end $$;

-- ===========================================================================
-- A10. attachments owner_type discriminator (D19): CHECK IN ('note','task');
--      owner_id NOT NULL; both valid owner_types insert; a bogus one is rejected.
-- ===========================================================================
do $$
declare oid_null boolean;
begin
  select is_nullable='YES' into oid_null from information_schema.columns
  where table_schema='public' and table_name='attachments' and column_name='owner_id';
  if oid_null is null then raise exception 'A10 FAILED: attachments.owner_id missing'; end if;
  if oid_null then raise exception 'A10 FAILED: attachments.owner_id must be NOT NULL'; end if;

  -- a note attachment (owner_id → a messages row) inserts
  insert into public.attachments (company_id, owner_type, owner_id, conversation_id, storage_path, file_name, content_type, size_bytes, uploaded_by_user_id)
  values ('b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7','note','b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004',
          'b7b7b7b7-b7b7-4b7b-8b7b-b7b700000003',
          'attachments/b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7/note/x/u-quote.pdf',
          'quote.pdf','application/pdf', 12345, 'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7');

  -- a task attachment (owner_id → a tasks row) inserts
  insert into public.attachments (company_id, owner_type, owner_id, conversation_id, storage_path, file_name, content_type, size_bytes, uploaded_by_user_id)
  values ('b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7','task', gen_random_uuid(),
          'b7b7b7b7-b7b7-4b7b-8b7b-b7b700000003',
          'attachments/b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7/task/x/u-part.jpg',
          'part.jpg','image/jpeg', 98765, 'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7');

  begin
    insert into public.attachments (company_id, owner_type, owner_id, storage_path)
    values ('b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7','bogus', gen_random_uuid(),'x');
    raise exception 'A10 FAILED: owner_type ''bogus'' accepted';
  exception when check_violation then null;
  end;
  raise notice 'A10 PASSED: attachments owner_type discriminator enforced (note/task ok, bogus rejected)';
end $$;

-- ===========================================================================
-- A11. attachments indexes (D19): the two partial (deleted_at IS NULL) indexes
--      the gallery + owner-fetch paths need.
-- ===========================================================================
do $$
declare miss text;
begin
  select string_agg(x.name, ', ') into miss from (values
    ('attachments_company_conversation_idx'),('attachments_owner_idx')) x(name)
  where not exists (select 1 from pg_indexes
    where schemaname='public' and tablename='attachments' and indexname=x.name);
  if miss is not null then raise exception 'A11 FAILED: missing attachments indexes: %', miss; end if;
  raise notice 'A11 PASSED: attachments has the two partial gallery/owner indexes';
end $$;

-- ===========================================================================
-- A12. GALLERY two-arm union scope (D21/T7.2): the generic arm is conversation-
--      scoped with NO join (attachments.conversation_id), while the MMS arm
--      needs a join through messages (message_attachments has no conversation_id
--      column). Assert both facts.
-- ===========================================================================
do $$
declare generic_has_cid boolean; mms_has_cid boolean; n_generic int;
begin
  select exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='attachments' and column_name='conversation_id')
    into generic_has_cid;
  if not generic_has_cid then
    raise exception 'A12 FAILED: attachments must denormalize conversation_id (gallery generic arm)';
  end if;

  select exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='message_attachments' and column_name='conversation_id')
    into mms_has_cid;
  if mms_has_cid then
    raise exception 'A12 FAILED: message_attachments unexpectedly has conversation_id (MMS arm must join through messages)';
  end if;

  -- generic arm returns the fixture's note + task rows for this conversation
  select count(*) into n_generic from public.attachments
  where company_id='b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7'
    and conversation_id='b7b7b7b7-b7b7-4b7b-8b7b-b7b700000003' and deleted_at is null;
  if n_generic <> 2 then
    raise exception 'A12 FAILED: generic gallery arm returned % rows (want 2: note+task)', n_generic;
  end if;
  raise notice 'A12 PASSED: gallery arms have the right shapes (generic conversation-scoped; MMS needs the messages join)';
end $$;

-- ===========================================================================
-- A13. message_attachments(message_id) is indexed for the MMS gallery join
--      (T7.2 — the FK column, served either by a standalone index or by the
--      leading column of the shipped composite unique).
-- ===========================================================================
do $$
begin
  if not exists (
    select 1 from pg_index i
    join pg_class ic on ic.oid=i.indexrelid
    join pg_class tc on tc.oid=i.indrelid
    join pg_namespace n on n.oid=tc.relnamespace
    join pg_attribute a on a.attrelid=tc.oid and a.attnum=i.indkey[0]
    where n.nspname='public' and tc.relname='message_attachments' and a.attname='message_id')
  then
    raise exception 'A13 FAILED: no index leads with message_attachments.message_id (MMS gallery join)';
  end if;
  raise notice 'A13 PASSED: message_attachments.message_id is indexed (MMS gallery join)';
end $$;

-- ===========================================================================
-- A14. contacts geocode columns (D25): lat/lng double precision, geocoded_at
--      timestamptz, geocode_status text NOT NULL default 'pending' with the
--      constrained vocabulary; plus the pending-backfill partial index.
-- ===========================================================================
do $$
declare lat_t text; lng_t text; ga_t text; gs_t text; gs_null boolean; gs_def text;
begin
  select data_type into lat_t from information_schema.columns
    where table_schema='public' and table_name='contacts' and column_name='lat';
  select data_type into lng_t from information_schema.columns
    where table_schema='public' and table_name='contacts' and column_name='lng';
  select data_type into ga_t  from information_schema.columns
    where table_schema='public' and table_name='contacts' and column_name='geocoded_at';
  select data_type, is_nullable='YES', column_default
    into gs_t, gs_null, gs_def from information_schema.columns
    where table_schema='public' and table_name='contacts' and column_name='geocode_status';

  if lat_t <> 'double precision' then raise exception 'A14 FAILED: contacts.lat type % (want double precision)', lat_t; end if;
  if lng_t <> 'double precision' then raise exception 'A14 FAILED: contacts.lng type % (want double precision)', lng_t; end if;
  if ga_t is null or ga_t not like 'timestamp%' then raise exception 'A14 FAILED: contacts.geocoded_at not timestamptz'; end if;
  if gs_t is null then raise exception 'A14 FAILED: contacts.geocode_status missing'; end if;
  if gs_null then raise exception 'A14 FAILED: contacts.geocode_status must be NOT NULL'; end if;
  if gs_def is null or gs_def not like '%pending%' then
    raise exception 'A14 FAILED: contacts.geocode_status default should be ''pending'', got %', gs_def;
  end if;

  -- the vocabulary CHECK rejects an unknown status
  begin
    update public.contacts set geocode_status='bogus'
      where id='b7b7b7b7-b7b7-4b7b-8b7b-b7b700000002';
    raise exception 'A14 FAILED: geocode_status ''bogus'' accepted';
  exception when check_violation then null;
  end;

  -- the four valid statuses are accepted
  update public.contacts set geocode_status='ok', lat=37.7937, lng=-122.3965, geocoded_at=now()
    where id='b7b7b7b7-b7b7-4b7b-8b7b-b7b700000002';

  if not exists (select 1 from pg_indexes where schemaname='public'
    and tablename='contacts' and indexname='contacts_geocode_pending_idx') then
    raise exception 'A14 FAILED: contacts_geocode_pending_idx (backfill work-set) missing';
  end if;
  raise notice 'A14 PASSED: contacts geocode columns + CHECK + pending-backfill index correct';
end $$;

-- ===========================================================================
-- A15. conversation_event_type additions (TASKS.md T8): the ten new literals are
--      present; the DROPPED task_completed/task_reopened are ABSENT; and the
--      conversation_events_conv_required CHECK is UNCHANGED (permits null cid
--      only for the original three contact-level types).
-- ===========================================================================
do $$
declare labels text[]; miss text; check_src text;
begin
  select array_agg(enumlabel) into labels
  from pg_enum e join pg_type t on t.oid=e.enumtypid
  join pg_namespace n on n.oid=t.typnamespace
  where n.nspname='public' and t.typname='conversation_event_type';

  select string_agg(w, ', ') into miss from unnest(array[
    'message_done','message_undone','task_created','task_assigned','task_due_set',
    'task_deleted','note_attachment_added','note_attachment_removed',
    'task_attachment_added','task_attachment_removed']) w
  where not (w = any(labels));
  if miss is not null then raise exception 'A15 FAILED: missing event types: %', miss; end if;

  if 'task_completed' = any(labels) or 'task_reopened' = any(labels) then
    raise exception 'A15 FAILED: task_completed/task_reopened must NOT exist (done rides message_done/undone, T2.1)';
  end if;

  -- the shipped CHECK is untouched: still only these three permit a null conversation_id.
  select pg_get_constraintdef(oid) into check_src from pg_constraint
  where conname='conversation_events_conv_required' and conrelid='public.conversation_events'::regclass;
  if check_src is null then raise exception 'A15 FAILED: conversation_events_conv_required CHECK missing'; end if;
  if not (check_src like '%opted_out%' and check_src like '%opt_out_revoked%' and check_src like '%consent_attested%') then
    raise exception 'A15 FAILED: conv_required CHECK altered unexpectedly: %', check_src;
  end if;
  if check_src like '%message_done%' or check_src like '%task_%' or check_src like '%attachment%' then
    raise exception 'A15 FAILED: conv_required CHECK must NOT reference new types (they always carry a conversation_id): %', check_src;
  end if;
  raise notice 'A15 PASSED: 10 event types added; task_completed/task_reopened absent; conv_required CHECK unchanged';
end $$;

-- ===========================================================================
-- A16. A new event type WRITES with a non-null conversation_id and satisfies the
--      unchanged CHECK (T8/D22): a task_created audit row on the fixture convo.
-- ===========================================================================
do $$
declare n int;
begin
  insert into public.conversation_events (company_id, conversation_id, actor_user_id, type, payload)
  values ('b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7','b7b7b7b7-b7b7-4b7b-8b7b-b7b700000003',
          'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7','task_created',
          jsonb_build_object('task_id', gen_random_uuid(),
                             'message_id','b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004'));
  insert into public.conversation_events (company_id, conversation_id, actor_user_id, type, payload)
  values ('b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7','b7b7b7b7-b7b7-4b7b-8b7b-b7b700000003',
          'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7','message_done',
          jsonb_build_object('message_id','b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004'));
  select count(*) into n from public.conversation_events
  where conversation_id='b7b7b7b7-b7b7-4b7b-8b7b-b7b700000003'
    and type in ('task_created','message_done');
  if n <> 2 then raise exception 'A16 FAILED: expected 2 new audit rows, got %', n; end if;
  raise notice 'A16 PASSED: new event types write with a non-null conversation_id (audit reuse)';
end $$;

-- ===========================================================================
-- A17. Deny-by-default grants (SPEC §6/D8): anon/authenticated hold NO privilege
--      on tasks or attachments; service_role holds full DML on both.
-- ===========================================================================
do $$
begin
  if has_table_privilege('anon','public.tasks','SELECT,INSERT,UPDATE,DELETE')
   or has_table_privilege('authenticated','public.tasks','SELECT,INSERT,UPDATE,DELETE')
   or has_table_privilege('anon','public.attachments','SELECT,INSERT,UPDATE,DELETE')
   or has_table_privilege('authenticated','public.attachments','SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'A17 FAILED: anon/authenticated have privileges on tasks/attachments';
  end if;
  if not (has_table_privilege('service_role','public.tasks','SELECT')
      and has_table_privilege('service_role','public.tasks','INSERT')
      and has_table_privilege('service_role','public.tasks','UPDATE')
      and has_table_privilege('service_role','public.tasks','DELETE')
      and has_table_privilege('service_role','public.attachments','SELECT')
      and has_table_privilege('service_role','public.attachments','INSERT')
      and has_table_privilege('service_role','public.attachments','UPDATE')
      and has_table_privilege('service_role','public.attachments','DELETE')) then
    raise exception 'A17 FAILED: service_role missing DML on tasks/attachments';
  end if;
  raise notice 'A17 PASSED: anon/authenticated denied; service_role has full DML on tasks + attachments';
end $$;

-- ===========================================================================
-- A18. Private `attachments` storage bucket exists: private, 25 MB limit, with
--      a non-empty MIME allow-list that permits images+PDF and does NOT permit
--      an executable type (D19).
-- ===========================================================================
do $$
declare pub boolean; lim bigint; mimes text[];
begin
  select public, file_size_limit, allowed_mime_types into pub, lim, mimes
  from storage.buckets where id='attachments';
  if pub is null then raise exception 'A18 FAILED: attachments storage bucket missing'; end if;
  if pub then raise exception 'A18 FAILED: attachments bucket must be private'; end if;
  if lim <> 26214400 then raise exception 'A18 FAILED: attachments bucket file_size_limit % (want 26214400 = 25 MB)', lim; end if;
  if mimes is null or array_length(mimes,1) < 1 then raise exception 'A18 FAILED: attachments bucket has no allowed_mime_types'; end if;
  if not ('image/jpeg' = any(mimes) and 'application/pdf' = any(mimes)) then
    raise exception 'A18 FAILED: attachments allow-list missing image/jpeg or application/pdf';
  end if;
  if 'application/x-msdownload' = any(mimes) or 'text/html' = any(mimes) then
    raise exception 'A18 FAILED: attachments allow-list must NOT permit executables/scripts';
  end if;
  raise notice 'A18 PASSED: private attachments bucket, 25 MB, image+doc allow-list (no executables)';
end $$;

-- ===========================================================================
-- A19. storage.objects deny-by-default for the attachments bucket (D8/D19):
--      RLS enabled on storage.objects, and NO end-user policy references the
--      attachments bucket (service-role-only, mirroring mms-media).
-- ===========================================================================
do $$
declare has_rls boolean; bad text;
begin
  select relrowsecurity into has_rls from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='storage' and c.relname='objects';
  if not coalesce(has_rls,false) then raise exception 'A19 FAILED: storage.objects RLS not enabled'; end if;
  select string_agg(policyname, ', ') into bad from pg_policies
  where schemaname='storage' and tablename='objects'
    and (qual like '%''attachments''%' or with_check like '%''attachments''%');
  if bad is not null then
    raise exception 'A19 FAILED: attachments bucket must have no end-user storage.objects policies, found: %', bad;
  end if;
  raise notice 'A19 PASSED: storage.objects RLS on; attachments bucket is service-role-only (no end-user policy)';
end $$;

-- ===========================================================================
-- Task mutation RPCs (TASKS.md T3): create_task / assign_task / update_task /
-- delete_task run task mutations as `security definer` PostgREST functions, so
-- each is ONE atomic transaction (the row write AND its conversation_events
-- audit — and, for delete, the generic attachment soft-deletes — together). The
-- inline-PostgREST implementation split these across separate round-trips.
--
-- Membership fixture: the owner is an active member (assign_task validates it);
-- member2 is DEACTIVATED (frees the seat) so the not_member path is testable.
-- ===========================================================================
insert into public.company_members (company_id, user_id, role, deactivated_at) values
  ('b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7','a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7','owner',null),
  ('b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7','a7a7a7a7-a7a7-4a7a-8a7a-a7a700000002','member', now());

-- ---------------------------------------------------------------------------
-- A20. create_task: resolves conversation_id from the source message, seeds the
--      title from the body snippet when none is given, inserts the task AND the
--      task_created event in ONE call. Company-scoping: a foreign message id →
--      'no_message'. A second live promotion of the same message → 'conflict'.
--      An inactive assignee → 'not_member' with NO task and NO event written.
-- ---------------------------------------------------------------------------
do $$
declare res jsonb; v_task_id uuid; n_events int;
begin
  -- Happy path: no title → snippet default, no assignee.
  res := public.create_task(
    'b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7',       -- company
    'b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004',       -- message
    null, null, null, null,                       -- title/desc/assignee/due
    'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7');       -- actor
  if res->>'outcome' <> 'created' then
    raise exception 'A20 FAILED: create_task outcome % (want created)', res->>'outcome';
  end if;
  v_task_id := (res->'task'->>'id')::uuid;
  if (res->'task'->>'conversation_id') <> 'b7b7b7b7-b7b7-4b7b-8b7b-b7b700000003' then
    raise exception 'A20 FAILED: create_task did not resolve conversation_id from the message';
  end if;
  if (res->'task'->>'title') <> 'fix the sink please' then
    raise exception 'A20 FAILED: title snippet default wrong: %', res->'task'->>'title';
  end if;
  select count(*) into n_events from public.conversation_events
   where conversation_id='b7b7b7b7-b7b7-4b7b-8b7b-b7b700000003'
     and type='task_created' and (payload->>'task_id')::uuid=v_task_id;
  if n_events <> 1 then raise exception 'A20 FAILED: want exactly 1 task_created event, got %', n_events; end if;

  -- A foreign / non-existent message id → no_message (no task, no event).
  res := public.create_task(
    'b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7',
    'b7b7b7b7-b7b7-4b7b-8b7b-b7b7000000ff',        -- not a message in this company
    null, null, null, null,
    'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7');
  if res->>'outcome' <> 'no_message' then
    raise exception 'A20 FAILED: foreign message outcome % (want no_message)', res->>'outcome';
  end if;

  -- A second LIVE promotion of the same message → conflict (partial-unique).
  res := public.create_task(
    'b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7',
    'b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004',
    null, null, null, null,
    'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7');
  if res->>'outcome' <> 'conflict' then
    raise exception 'A20 FAILED: re-promote outcome % (want conflict)', res->>'outcome';
  end if;

  -- An inactive assignee → not_member (member2 is deactivated). Delete the live
  -- task first so this attempt is a fresh promotion, not a conflict.
  delete from public.tasks where id=v_task_id;
  res := public.create_task(
    'b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7',
    'b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004',
    null, null,
    'a7a7a7a7-a7a7-4a7a-8a7a-a7a700000002',        -- deactivated member
    null,
    'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7');
  if res->>'outcome' <> 'not_member' then
    raise exception 'A20 FAILED: inactive assignee outcome % (want not_member)', res->>'outcome';
  end if;
  if exists (select 1 from public.tasks where message_id='b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004' and deleted_at is null) then
    raise exception 'A20 FAILED: not_member left a task row behind (not atomic)';
  end if;

  raise notice 'A20 PASSED: create_task (snippet default, conversation resolve, no_message/conflict/not_member, atomic event)';
end $$;

-- clean up A20 tasks/events so later blocks start from a known state
delete from public.conversation_events where conversation_id='b7b7b7b7-b7b7-4b7b-8b7b-b7b700000003';
delete from public.tasks where message_id='b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004';

-- ---------------------------------------------------------------------------
-- A21. assign_task + update_task: each writes its audit event atomically and is
--      an idempotent no-op ('unchanged') when nothing changes. A due_at change
--      writes task_due_set; a title/description-only change writes NO event.
-- ---------------------------------------------------------------------------
do $$
declare res jsonb; v_task_id uuid; n int;
begin
  v_task_id := (public.create_task(
    'b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7',
    'b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004',
    'Original title', 'first', null, null,
    'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7')->'task'->>'id')::uuid;

  -- assign to the active owner → task_assigned with from=null, to=owner.
  res := public.assign_task(
    'b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7', v_task_id,
    'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7',
    'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7');
  if res->>'outcome' <> 'updated' then raise exception 'A21 FAILED: assign outcome %', res->>'outcome'; end if;
  select count(*) into n from public.conversation_events
   where type='task_assigned' and (payload->>'task_id')::uuid=v_task_id
     and payload->>'from_user_id' is null
     and (payload->>'to_user_id')='a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7';
  if n <> 1 then raise exception 'A21 FAILED: want 1 task_assigned(from=null,to=owner), got %', n; end if;

  -- re-assign to the SAME user → unchanged (no write, no event).
  res := public.assign_task(
    'b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7', v_task_id,
    'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7',
    'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7');
  if res->>'outcome' <> 'unchanged' then raise exception 'A21 FAILED: re-assign outcome % (want unchanged)', res->>'outcome'; end if;
  select count(*) into n from public.conversation_events
   where type='task_assigned' and (payload->>'task_id')::uuid=v_task_id;
  if n <> 1 then raise exception 'A21 FAILED: unchanged re-assign wrote an extra event (got %)', n; end if;

  -- assign an INACTIVE member → not_member, no write.
  res := public.assign_task(
    'b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7', v_task_id,
    'a7a7a7a7-a7a7-4a7a-8a7a-a7a700000002',
    'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7');
  if res->>'outcome' <> 'not_member' then raise exception 'A21 FAILED: inactive assignee outcome %', res->>'outcome'; end if;

  -- update due_at → task_due_set; title/description-only later writes no event.
  res := public.update_task(
    'b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7', v_task_id,
    null, null, '2026-08-01T12:00:00Z'::timestamptz, false,
    'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7');
  if res->>'outcome' <> 'updated' then raise exception 'A21 FAILED: update due outcome %', res->>'outcome'; end if;
  select count(*) into n from public.conversation_events
   where type='task_due_set' and (payload->>'task_id')::uuid=v_task_id;
  if n <> 1 then raise exception 'A21 FAILED: want 1 task_due_set, got %', n; end if;

  -- title-only update → updated, but NO new event (only due_at is audited).
  res := public.update_task(
    'b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7', v_task_id,
    'Renamed', null, null, false,
    'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7');
  if res->>'outcome' <> 'updated' then raise exception 'A21 FAILED: title update outcome %', res->>'outcome'; end if;
  select count(*) into n from public.conversation_events where (payload->>'task_id')::uuid=v_task_id;
  -- events so far: 1 task_created + 1 task_assigned + 1 task_due_set = 3 (title write adds none)
  if n <> 3 then raise exception 'A21 FAILED: title-only update changed the event count (got %, want 3)', n; end if;

  -- clearing due via p_clear_due writes another task_due_set(due_at=null).
  res := public.update_task(
    'b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7', v_task_id,
    null, null, null, true,
    'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7');
  if res->>'outcome' <> 'updated' then raise exception 'A21 FAILED: clear due outcome %', res->>'outcome'; end if;
  if (select due_at from public.tasks where id=v_task_id) is not null then
    raise exception 'A21 FAILED: p_clear_due did not null due_at';
  end if;

  raise notice 'A21 PASSED: assign_task/update_task write audit atomically; unchanged no-op; due-only audited; clear-due works';
end $$;

delete from public.conversation_events where conversation_id='b7b7b7b7-b7b7-4b7b-8b7b-b7b700000003';
delete from public.tasks where message_id='b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004';

-- ---------------------------------------------------------------------------
-- A22. delete_task ATOMICITY (the T3 guarantee that closes the orphaned-gallery
--      gap): one call soft-deletes the task, soft-deletes its generic
--      attachment rows, AND writes the task_deleted event — all together. After
--      the call NO live attachment for the task remains, so the gallery generic
--      arm (filters attachments.deleted_at IS NULL) can never surface an
--      orphan. messages.done_at is untouched.
-- ---------------------------------------------------------------------------
do $$
declare v_task_id uuid; res jsonb; n_live_att int; n_ev int; msg_done timestamptz;
begin
  v_task_id := (public.create_task(
    'b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7',
    'b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004',
    'To delete', null, null, null,
    'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7')->'task'->>'id')::uuid;

  -- Two generic attachments own this task (owner_type='task').
  insert into public.attachments (company_id, owner_type, owner_id, conversation_id, storage_path)
  values
    ('b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7','task',v_task_id,'b7b7b7b7-b7b7-4b7b-8b7b-b7b700000003','attachments/x/task/1'),
    ('b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7','task',v_task_id,'b7b7b7b7-b7b7-4b7b-8b7b-b7b700000003','attachments/x/task/2');

  -- mark the source message done first, to prove delete never clears it.
  -- (done_at + done_by_user_id are set together — messages_done_consistency.)
  update public.messages set done_at=now(),
         done_by_user_id='a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7'
  where id='b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004';

  res := public.delete_task(
    'b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7', v_task_id,
    'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7');
  if res->>'outcome' <> 'deleted' then raise exception 'A22 FAILED: delete outcome % (want deleted)', res->>'outcome'; end if;

  -- task is soft-deleted.
  if exists (select 1 from public.tasks where id=v_task_id and deleted_at is null) then
    raise exception 'A22 FAILED: task still live after delete_task';
  end if;
  -- NO live attachment remains for the task (the orphan-gallery guarantee).
  select count(*) into n_live_att from public.attachments
   where owner_type='task' and owner_id=v_task_id and deleted_at is null;
  if n_live_att <> 0 then
    raise exception 'A22 FAILED: % live attachment(s) left after delete_task (orphan-gallery gap)', n_live_att;
  end if;
  -- task_deleted event written once.
  select count(*) into n_ev from public.conversation_events
   where type='task_deleted' and (payload->>'task_id')::uuid=v_task_id;
  if n_ev <> 1 then raise exception 'A22 FAILED: want 1 task_deleted event, got %', n_ev; end if;
  -- messages.done_at untouched.
  select done_at into msg_done from public.messages where id='b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004';
  if msg_done is null then raise exception 'A22 FAILED: delete_task cleared messages.done_at (it must not)'; end if;

  -- a second delete of the now-gone task → not_found (idempotent, lost race).
  res := public.delete_task(
    'b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7', v_task_id,
    'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7');
  if res->>'outcome' <> 'not_found' then raise exception 'A22 FAILED: re-delete outcome % (want not_found)', res->>'outcome'; end if;

  raise notice 'A22 PASSED: delete_task atomically soft-deletes task + attachments + writes task_deleted (no gallery orphans); done_at untouched';
end $$;

update public.messages set done_at=null, done_by_user_id=null where id='b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004';
delete from public.conversation_events where conversation_id='b7b7b7b7-b7b7-4b7b-8b7b-b7b700000003';
delete from public.attachments where conversation_id='b7b7b7b7-b7b7-4b7b-8b7b-b7b700000003';
delete from public.tasks where message_id='b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004';

-- ---------------------------------------------------------------------------
-- A23. EXECUTE grants on the four task RPCs (SPEC §6 RLS posture): service_role
--      only; public/anon/authenticated hold NO execute (they never touch
--      PostgREST). Mirrors A17 for the RPC surface.
-- ---------------------------------------------------------------------------
do $$
declare fn text; bad text;
begin
  foreach fn in array array['create_task','assign_task','update_task','delete_task'] loop
    foreach bad in array array['anon','authenticated','public'] loop
      -- Any end-user role holding execute on a task RPC is a leak.
      if exists (
        select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname=fn
          and has_function_privilege(bad, p.oid, 'execute')
      ) then
        raise exception 'A23 FAILED: role % can execute %', bad, fn;
      end if;
    end loop;
    -- service_role MUST be able to execute it.
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=fn
        and has_function_privilege('service_role', p.oid, 'execute')
    ) then
      raise exception 'A23 FAILED: service_role cannot execute %', fn;
    end if;
  end loop;
  raise notice 'A23 PASSED: task RPCs are service-role-only (anon/authenticated/public denied)';
end $$;

-- ---------------------------------------------------------------------------
-- A24. set_message_done ATOMICITY (D22 §5.1 — closes the D14 two-write gap):
--      ONE call flips messages.done_at + done_by_user_id AND writes the
--      message_done/message_undone audit row in the SAME transaction, is
--      idempotent (a redundant mark writes no second event), and is
--      company-scoped (a foreign company_id → not_found, no write).
-- ---------------------------------------------------------------------------
do $$
declare
  res jsonb; n_done int; n_undone int;
  v_done_at timestamptz; v_done_by uuid;
begin
  -- Clean slate for the fixture message/conversation.
  update public.messages set done_at=null, done_by_user_id=null
   where id='b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004';
  delete from public.conversation_events
   where conversation_id='b7b7b7b7-b7b7-4b7b-8b7b-b7b700000003'
     and type in ('message_done','message_undone');

  -- Mark done → flip + exactly one message_done audit, atomically.
  res := public.set_message_done(
    'b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7',
    'b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004', true,
    'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7');
  if res->>'outcome' <> 'updated' then raise exception 'A24 FAILED: mark-done outcome % (want updated)', res->>'outcome'; end if;

  select done_at, done_by_user_id into v_done_at, v_done_by
   from public.messages where id='b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004';
  if v_done_at is null or v_done_by <> 'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7' then
    raise exception 'A24 FAILED: done_at/done_by not stamped by set_message_done';
  end if;
  select count(*) into n_done from public.conversation_events
   where conversation_id='b7b7b7b7-b7b7-4b7b-8b7b-b7b700000003' and type='message_done'
     and (payload->>'message_id')::uuid='b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004';
  if n_done <> 1 then raise exception 'A24 FAILED: want 1 message_done event, got %', n_done; end if;

  -- Idempotent: re-mark done → unchanged, NO second event, no write.
  res := public.set_message_done(
    'b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7',
    'b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004', true,
    'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7');
  if res->>'outcome' <> 'unchanged' then raise exception 'A24 FAILED: redundant mark outcome % (want unchanged)', res->>'outcome'; end if;
  select count(*) into n_done from public.conversation_events
   where conversation_id='b7b7b7b7-b7b7-4b7b-8b7b-b7b700000003' and type='message_done';
  if n_done <> 1 then raise exception 'A24 FAILED: idempotent mark wrote a 2nd message_done event (got %)', n_done; end if;

  -- Undo → clears both columns + exactly one message_undone audit.
  res := public.set_message_done(
    'b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7',
    'b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004', false,
    'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7');
  if res->>'outcome' <> 'updated' then raise exception 'A24 FAILED: undo outcome % (want updated)', res->>'outcome'; end if;
  select done_at, done_by_user_id into v_done_at, v_done_by
   from public.messages where id='b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004';
  if v_done_at is not null or v_done_by is not null then
    raise exception 'A24 FAILED: undo did not clear done_at/done_by';
  end if;
  select count(*) into n_undone from public.conversation_events
   where conversation_id='b7b7b7b7-b7b7-4b7b-8b7b-b7b700000003' and type='message_undone';
  if n_undone <> 1 then raise exception 'A24 FAILED: want 1 message_undone event, got %', n_undone; end if;

  -- Company-scoped: a foreign company_id → not_found, and writes nothing.
  res := public.set_message_done(
    'c7c7c7c7-c7c7-4c7c-8c7c-c7c7c7c7c7c7',
    'b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004', true,
    'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7');
  if res->>'outcome' <> 'not_found' then raise exception 'A24 FAILED: cross-company outcome % (want not_found)', res->>'outcome'; end if;
  select done_at into v_done_at from public.messages where id='b7b7b7b7-b7b7-4b7b-8b7b-b7b700000004';
  if v_done_at is not null then raise exception 'A24 FAILED: cross-company call mutated the message'; end if;

  raise notice 'A24 PASSED: set_message_done flips done_at + writes audit atomically; idempotent; company-scoped';
end $$;

-- ---------------------------------------------------------------------------
-- A25. set_message_done is service-role-only (SPEC §6 RLS posture): mirrors A23.
-- ---------------------------------------------------------------------------
do $$
declare bad text;
begin
  foreach bad in array array['anon','authenticated','public'] loop
    if exists (
      select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='set_message_done'
        and has_function_privilege(bad, p.oid, 'execute')
    ) then
      raise exception 'A25 FAILED: role % can execute set_message_done', bad;
    end if;
  end loop;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='set_message_done'
      and has_function_privilege('service_role', p.oid, 'execute')
  ) then
    raise exception 'A25 FAILED: service_role cannot execute set_message_done';
  end if;
  raise notice 'A25 PASSED: set_message_done is service-role-only';
end $$;

rollback;

select 'ALL APP-V2 SCHEMA TESTS PASSED' as result;
