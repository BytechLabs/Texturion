-- [#475] The template-use ledger — assertion suite for
-- supabase/migrations/20260802000000_template_uses.sql.
--
-- What this exists to prove is mostly what the table does NOT do. It records a
-- template id and a timestamp, it refuses a cross-tenant write, it survives a
-- soft delete and dies with a hard one, and it lists every template including
-- the ones nobody has ever used — which is the half of the question that
-- actually needed answering.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/template_uses.test.sql
--
-- One transaction, rolled back. Fixtures use a '54' id prefix so the file runs
-- standalone OR after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('54000000-0000-4000-8000-00000000000a'::uuid, 'tpl-a@test.local'),
  ('54000000-0000-4000-8000-00000000000b'::uuid, 'tpl-b@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('54000000-0000-4000-8000-0000000000c1'::uuid, 'Tpl Plumbing',
   '54000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now()),
  ('54000000-0000-4000-8000-0000000000c2'::uuid, 'Other Shop',
   '54000000-0000-4000-8000-00000000000b'::uuid, 'US', '415', now());

insert into public.templates (id, company_id, name, body) values
  ('54000000-0000-4000-8000-0000000000e1'::uuid,
   '54000000-0000-4000-8000-0000000000c1'::uuid, 'On my way', 'On our way.'),
  ('54000000-0000-4000-8000-0000000000e2'::uuid,
   '54000000-0000-4000-8000-0000000000c1'::uuid, 'Never used', 'Nobody sends this.'),
  ('54000000-0000-4000-8000-0000000000e9'::uuid,
   '54000000-0000-4000-8000-0000000000c2'::uuid, 'Their template', 'Not ours.');

-- ===========================================================================
-- TU-1: a use is recorded, and the edited flag rides with it.
-- ===========================================================================
do $$
declare v_uses bigint; v_edits bigint;
begin
  perform public.api_record_template_use(
    '54000000-0000-4000-8000-0000000000c1'::uuid,
    '54000000-0000-4000-8000-0000000000e1'::uuid, false);
  perform public.api_record_template_use(
    '54000000-0000-4000-8000-0000000000c1'::uuid,
    '54000000-0000-4000-8000-0000000000e1'::uuid, true);

  select uses, edits into v_uses, v_edits
    from public.api_template_usage('54000000-0000-4000-8000-0000000000c1'::uuid)
   where template_id = '54000000-0000-4000-8000-0000000000e1'::uuid;

  if v_uses is distinct from 2 then
    raise exception 'TU-1: expected 2 uses, got %', v_uses;
  end if;
  -- The half that matters: a template edited every time is a defect report
  -- nobody filed, and a count that lumps the two together cannot say so.
  if v_edits is distinct from 1 then
    raise exception 'TU-1: expected 1 edit, got %', v_edits;
  end if;
end $$;

-- ===========================================================================
-- TU-2: a template belonging to ANOTHER workspace records nothing.
--
-- A cross-tenant write here would be invisible — it corrupts a counter, not a
-- message, so nothing downstream would ever surface it. That is exactly why
-- the check is inside the function rather than in the Worker.
-- ===========================================================================
do $$
declare v_count bigint;
begin
  perform public.api_record_template_use(
    '54000000-0000-4000-8000-0000000000c1'::uuid,
    '54000000-0000-4000-8000-0000000000e9'::uuid, false);

  select count(*) into v_count from public.template_uses
   where template_id = '54000000-0000-4000-8000-0000000000e9'::uuid;
  if v_count is distinct from 0 then
    raise exception 'TU-2: one workspace wrote a use against another''s template';
  end if;
end $$;

-- ===========================================================================
-- TU-3: an unknown template id is silently ignored, never an error.
--
-- A template deleted between the composer opening and the message sending is
-- ordinary. A send must never fail because its bookkeeping did.
-- ===========================================================================
do $$
begin
  perform public.api_record_template_use(
    '54000000-0000-4000-8000-0000000000c1'::uuid,
    '54000000-0000-4000-8000-0000000000ef'::uuid, false);
exception
  when others then
    raise exception 'TU-3: an unknown template id raised: %', sqlerrm;
end $$;

-- ===========================================================================
-- TU-4: the list includes templates nobody has ever used.
--
-- The whole point is telling the dead ones from the ones carrying the work. A
-- join that dropped the zeroes would answer only the easy half.
-- ===========================================================================
do $$
declare r record;
begin
  select * into r
    from public.api_template_usage('54000000-0000-4000-8000-0000000000c1'::uuid)
   where template_id = '54000000-0000-4000-8000-0000000000e2'::uuid;

  if r.template_id is null then
    raise exception 'TU-4: an unused template is missing from the list';
  end if;
  if r.uses is distinct from 0 then
    raise exception 'TU-4: an unused template reported % uses', r.uses;
  end if;
  if r.last_used is not null then
    raise exception 'TU-4: an unused template reported a last-used date';
  end if;
end $$;

-- ===========================================================================
-- TU-5: busiest first, so the picker's sort comes straight off this.
-- ===========================================================================
do $$
declare v_first uuid;
begin
  select template_id into v_first
    from public.api_template_usage('54000000-0000-4000-8000-0000000000c1'::uuid)
   limit 1;
  if v_first is distinct from '54000000-0000-4000-8000-0000000000e1'::uuid then
    raise exception 'TU-5: the list did not lead with the most-used template';
  end if;
end $$;

-- ===========================================================================
-- TU-6: a SOFT-deleted template keeps its history and leaves the list.
--
-- #419 made template deletion soft precisely so an accidental one is
-- recoverable. A restored template that came back with its usage erased would
-- be a different object wearing the same name.
-- ===========================================================================
do $$
declare v_listed int; v_rows bigint;
begin
  update public.templates set deleted_at = now()
   where id = '54000000-0000-4000-8000-0000000000e1'::uuid;

  select count(*) into v_listed
    from public.api_template_usage('54000000-0000-4000-8000-0000000000c1'::uuid)
   where template_id = '54000000-0000-4000-8000-0000000000e1'::uuid;
  if v_listed is distinct from 0 then
    raise exception 'TU-6: a deleted template is still in the list';
  end if;

  select count(*) into v_rows from public.template_uses
   where template_id = '54000000-0000-4000-8000-0000000000e1'::uuid;
  if v_rows is distinct from 2 then
    raise exception 'TU-6: a soft delete destroyed the history (% rows left)', v_rows;
  end if;

  update public.templates set deleted_at = null
   where id = '54000000-0000-4000-8000-0000000000e1'::uuid;
end $$;

-- ===========================================================================
-- TU-6a: #274 — the picker's list is most-used first, and includes the unused.
--
-- Somebody about to send is looking for the reply they send twenty times a
-- day. Alphabetical puts it wherever its name falls. A never-used template
-- still appears: a picker that hid them would hide every reply a crew has just
-- written.
-- ===========================================================================
do $$
declare
  v_first uuid;
  v_count int;
begin
  select id into v_first
    from public.api_templates_by_use('54000000-0000-4000-8000-0000000000c1'::uuid)
   limit 1;
  if v_first is distinct from '54000000-0000-4000-8000-0000000000e1'::uuid then
    raise exception 'TU-6a: the picker did not lead with the most-used template';
  end if;

  select count(*) into v_count
    from public.api_templates_by_use('54000000-0000-4000-8000-0000000000c1'::uuid)
   where id = '54000000-0000-4000-8000-0000000000e2'::uuid;
  if v_count is distinct from 1 then
    raise exception 'TU-6a: a never-used template is missing from the picker';
  end if;
end $$;

-- ===========================================================================
-- TU-6b: #274 — a category is the crew's own text, and the guard is its length.
-- ===========================================================================
do $$
declare r record;
begin
  update public.templates set category = 'Quoting'
   where id = '54000000-0000-4000-8000-0000000000e1'::uuid;

  select * into r
    from public.api_template_usage('54000000-0000-4000-8000-0000000000c1'::uuid)
   where template_id = '54000000-0000-4000-8000-0000000000e1'::uuid;
  if r.category is distinct from 'Quoting' then
    raise exception 'TU-6b: the usage list dropped the category';
  end if;

  -- Over the limit, the write must fail rather than silently truncate a label
  -- somebody chose.
  begin
    update public.templates set category = repeat('x', 41)
     where id = '54000000-0000-4000-8000-0000000000e1'::uuid;
    raise exception 'TU-6b: a 41-character category was accepted';
  exception
    when check_violation then null;
  end;

  -- Blank is not a category. The API normalises "" to null before it gets
  -- here; the CHECK is the backstop for anything that does not.
  begin
    update public.templates set category = '   '
     where id = '54000000-0000-4000-8000-0000000000e1'::uuid;
    raise exception 'TU-6b: a whitespace-only category was accepted';
  exception
    when check_violation then null;
  end;
end $$;

-- ===========================================================================
-- TU-6c: a soft-deleted template leaves the PICKER too, not just the settings
-- list. It is the same rule stated twice because they are two functions.
-- ===========================================================================
do $$
declare v_count int;
begin
  update public.templates set deleted_at = now()
   where id = '54000000-0000-4000-8000-0000000000e2'::uuid;

  select count(*) into v_count
    from public.api_templates_by_use('54000000-0000-4000-8000-0000000000c1'::uuid)
   where id = '54000000-0000-4000-8000-0000000000e2'::uuid;
  if v_count is distinct from 0 then
    raise exception 'TU-6c: a deleted template is still in the picker';
  end if;

  update public.templates set deleted_at = null
   where id = '54000000-0000-4000-8000-0000000000e2'::uuid;
end $$;

-- ===========================================================================
-- TU-7: a HARD delete takes the ledger with it, both ways.
--
-- #475's retention criterion: the ledger outlives neither the template nor the
-- workspace.
-- ===========================================================================
do $$
declare v_rows bigint;
begin
  delete from public.templates
   where id = '54000000-0000-4000-8000-0000000000e1'::uuid;

  select count(*) into v_rows from public.template_uses
   where template_id = '54000000-0000-4000-8000-0000000000e1'::uuid;
  if v_rows is distinct from 0 then
    raise exception 'TU-7: the ledger outlived its template (% rows)', v_rows;
  end if;
end $$;

-- ===========================================================================
-- TU-8: the purge walker knows about the table.
--
-- A company-scoped table missing from purge_workspace_step is a workspace that
-- cannot be erased — the failure #341 built the whole walker to prevent, and
-- one that stays invisible until somebody actually asks to be forgotten.
-- ===========================================================================
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'purge_workspace_step';

  if v_def not like '%template_uses%' then
    raise exception 'TU-8: purge_workspace_step does not delete template_uses';
  end if;
  -- Before `templates`, so the batch loop drains it rather than leaving one
  -- unbounded cascade at the end.
  if position('''template_uses''' in v_def) > position('''templates''' in v_def) then
    raise exception 'TU-8: template_uses is purged after templates';
  end if;
end $$;

rollback;
