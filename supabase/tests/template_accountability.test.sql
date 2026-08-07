-- [#419] Saved replies — assertion suite for
-- supabase/migrations/20260730001600_template_accountability.sql and
-- 20260730001700_search_skips_deleted_templates.sql.
--
-- A template is the only object in this product where one person's edit
-- changes what everyone else says to customers. The permission stays
-- member-level and that is deliberate; what these assertions protect is the
-- two things that were wrong regardless of anybody's intent — an accidental
-- delete was unrecoverable, and no change left a trace.
--
-- One transaction, rolled back. Fixtures use a 'bd' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('bd000000-0000-4000-8000-00000000000a'::uuid, 'tpl-owner@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('bd000000-0000-4000-8000-0000000000c1'::uuid, 'Saved Reply Co',
   'bd000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());

do $$
declare
  v_id    uuid;
  v_other uuid;
  v_count int;
  v_hits  jsonb;
begin
  insert into public.templates (company_id, name, body, created_by)
  values ('bd000000-0000-4000-8000-0000000000c1'::uuid, 'On my way',
          'On our way, about twenty minutes out.',
          'bd000000-0000-4000-8000-00000000000a'::uuid)
  returning id into v_id;

  -- ==========================================================================
  -- A DELETED NAME MUST NOT STAY HOSTAGE.
  --
  -- The unique index is on (company_id, lower(name)). If it kept counting
  -- deleted rows, a crew who deleted "On my way" could never create another
  -- one — the conflict would point at a row nobody can see, which is the worst
  -- kind of error message.
  -- ==========================================================================
  update public.templates set deleted_at = now() where id = v_id;

  insert into public.templates (company_id, name, body, created_by)
  values ('bd000000-0000-4000-8000-0000000000c1'::uuid, 'On my way',
          'Heading over now.',
          'bd000000-0000-4000-8000-00000000000a'::uuid)
  returning id into v_other;

  -- …and the live ones still collide with each other.
  begin
    insert into public.templates (company_id, name, body, created_by)
    values ('bd000000-0000-4000-8000-0000000000c1'::uuid, 'ON MY WAY',
            'Third one.', 'bd000000-0000-4000-8000-00000000000a'::uuid);
    raise exception 'two LIVE templates may not share a name';
  exception
    when unique_violation then null;
  end;

  -- ==========================================================================
  -- THE BODY SURVIVES THE DELETE.
  --
  -- This is the whole point of ask 1: an accidental delete is recoverable.
  -- Templates were the one shared object here that simply ceased to exist,
  -- while tasks (D17) and attachments (D19) both soft-delete.
  -- ==========================================================================
  select count(*) into v_count
    from public.templates
   where id = v_id and body = 'On our way, about twenty minutes out.';
  if v_count is distinct from 1 then
    raise exception 'a deleted template must keep its body, got % rows', v_count;
  end if;

  -- ==========================================================================
  -- SEARCH MUST NOT OFFER WHAT NOBODY CAN OPEN.
  --
  -- api_search_v2 was the only reader of this table outside its own route.
  -- Without the filter it would keep returning a saved reply that every other
  -- path now hides.
  -- ==========================================================================
  select (public.api_search_v2(
            'bd000000-0000-4000-8000-0000000000c1'::uuid,
            'twenty minutes', 5, 5, 5, 5, 5, null, null, null
          ) -> 'templates') into v_hits;
  if jsonb_array_length(coalesce(v_hits, '[]'::jsonb)) is distinct from 0 then
    raise exception 'search returned a deleted template: %', v_hits;
  end if;

  -- The live one IS still findable, so the filter did not simply break search.
  select (public.api_search_v2(
            'bd000000-0000-4000-8000-0000000000c1'::uuid,
            'Heading over', 5, 5, 5, 5, 5, null, null, null
          ) -> 'templates') into v_hits;
  if jsonb_array_length(coalesce(v_hits, '[]'::jsonb)) is distinct from 1 then
    raise exception 'search lost a LIVE template: %', v_hits;
  end if;

  -- ==========================================================================
  -- WHO LAST TOUCHED SHARED COPY.
  --
  -- Not a permission — visibility. In a crew of ten, "Sam changed this on
  -- Tuesday" settles the question before it becomes a dispute.
  -- ==========================================================================
  update public.templates
     set body = 'Heading over now, ten minutes.',
         updated_by = 'bd000000-0000-4000-8000-00000000000a'::uuid
   where id = v_other;

  select count(*) into v_count
    from public.templates
   where id = v_other
     and updated_by = 'bd000000-0000-4000-8000-00000000000a'::uuid;
  if v_count is distinct from 1 then
    raise exception 'the last editor must be recorded';
  end if;

  raise notice 'template accountability (#419): all assertions passed';
end $$;

rollback;
