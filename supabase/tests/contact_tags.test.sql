-- [#695] Contact tags: assertion suite for
-- supabase/migrations/20261110130000_contacts_carry_tags.sql.
--
-- Pins what would fail silently: one link per (contact, tag), the links going
-- with the contact and with the tag, a tag merge folding the contact links (and
-- keeping the earlier stamp), the usage count seeing contact-only tags, and the
-- table staying closed to browsers.
--
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/contact_tags.test.sql
--
-- One transaction, rolled back. Fixtures use a 'b5' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('b5000000-0000-4000-8000-00000000000a'::uuid, 'ctags-a@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('b5000000-0000-4000-8000-0000000000c1'::uuid, 'Tagged Plumbing',
   'b5000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());

insert into public.contacts (id, company_id, phone_e164) values
  ('b5000000-0000-4000-8000-0000000000d1'::uuid,
   'b5000000-0000-4000-8000-0000000000c1'::uuid, '+15555550695'),
  ('b5000000-0000-4000-8000-0000000000d2'::uuid,
   'b5000000-0000-4000-8000-0000000000c1'::uuid, '+15555550696');

insert into public.tags (id, company_id, name) values
  ('b5000000-0000-4000-8000-0000000000f1'::uuid,
   'b5000000-0000-4000-8000-0000000000c1'::uuid, 'Property manager'),
  ('b5000000-0000-4000-8000-0000000000f2'::uuid,
   'b5000000-0000-4000-8000-0000000000c1'::uuid, 'Prop mgr');

-- ===========================================================================
-- CT-1. One link per (contact, tag): a second insert conflicts.
-- ===========================================================================
do $$
begin
  insert into public.contact_tags (company_id, contact_id, tag_id) values
    ('b5000000-0000-4000-8000-0000000000c1'::uuid,
     'b5000000-0000-4000-8000-0000000000d1'::uuid,
     'b5000000-0000-4000-8000-0000000000f1'::uuid);
  begin
    insert into public.contact_tags (company_id, contact_id, tag_id) values
      ('b5000000-0000-4000-8000-0000000000c1'::uuid,
       'b5000000-0000-4000-8000-0000000000d1'::uuid,
       'b5000000-0000-4000-8000-0000000000f1'::uuid);
    raise exception 'CT-1 FAILED: a duplicate (contact, tag) link was accepted';
  exception when unique_violation then
    null;
  end;
  raise notice 'CT-1 PASSED: one link per contact and tag';
end $$;

-- ===========================================================================
-- CT-2. Usage counts a tag that lives only on contacts.
-- ===========================================================================
do $$
declare
  v_uses bigint;
begin
  select uses into v_uses
    from public.api_tag_usage('b5000000-0000-4000-8000-0000000000c1'::uuid)
   where tag_id = 'b5000000-0000-4000-8000-0000000000f1'::uuid;
  if v_uses is distinct from 1 then
    raise exception 'CT-2 FAILED: contact-only tag reports % uses, expected 1', v_uses;
  end if;
  raise notice 'CT-2 PASSED: usage sees contact links';
end $$;

-- ===========================================================================
-- CT-3. Merging tags folds the contact links: d1 is on both (earlier stamp
--       kept, one row), d2 is only on the loser (moved).
-- ===========================================================================
do $$
declare
  v_rows integer;
  v_stamp timestamptz;
begin
  update public.contact_tags set created_at = created_at + interval '1 day'
   where tag_id = 'b5000000-0000-4000-8000-0000000000f1'::uuid;
  insert into public.contact_tags (company_id, contact_id, tag_id, created_at) values
    ('b5000000-0000-4000-8000-0000000000c1'::uuid,
     'b5000000-0000-4000-8000-0000000000d1'::uuid,
     'b5000000-0000-4000-8000-0000000000f2'::uuid, now() - interval '1 day'),
    ('b5000000-0000-4000-8000-0000000000c1'::uuid,
     'b5000000-0000-4000-8000-0000000000d2'::uuid,
     'b5000000-0000-4000-8000-0000000000f2'::uuid, now());

  perform public.api_merge_tags(
    'b5000000-0000-4000-8000-0000000000c1'::uuid,
    'b5000000-0000-4000-8000-0000000000f2'::uuid,
    'b5000000-0000-4000-8000-0000000000f1'::uuid);

  select count(*) into v_rows from public.contact_tags
   where tag_id = 'b5000000-0000-4000-8000-0000000000f1'::uuid;
  if v_rows is distinct from 2 then
    raise exception 'CT-3 FAILED: survivor carries % link(s), expected 2', v_rows;
  end if;
  select created_at into v_stamp from public.contact_tags
   where tag_id = 'b5000000-0000-4000-8000-0000000000f1'::uuid
     and contact_id = 'b5000000-0000-4000-8000-0000000000d1'::uuid;
  if v_stamp > now() - interval '12 hours' then
    raise exception 'CT-3 FAILED: the earlier stamp was not kept';
  end if;
  raise notice 'CT-3 PASSED: tag merge folds contact links';
end $$;

-- ===========================================================================
-- CT-4. Deleting a contact takes its links; deleting a tag takes its links.
-- ===========================================================================
do $$
declare
  v_left integer;
begin
  delete from public.contacts
   where id = 'b5000000-0000-4000-8000-0000000000d2'::uuid;
  select count(*) into v_left from public.contact_tags
   where contact_id = 'b5000000-0000-4000-8000-0000000000d2'::uuid;
  if v_left is distinct from 0 then
    raise exception 'CT-4 FAILED: % link(s) outlived their contact', v_left;
  end if;
  delete from public.tags where id = 'b5000000-0000-4000-8000-0000000000f1'::uuid;
  select count(*) into v_left from public.contact_tags;
  if v_left is distinct from 0 then
    raise exception 'CT-4 FAILED: % link(s) outlived their tag', v_left;
  end if;
  raise notice 'CT-4 PASSED: links cascade with contact and tag';
end $$;

-- ===========================================================================
-- CT-5. Closed to browsers: RLS on, no grants to anon or authenticated.
-- ===========================================================================
do $$
begin
  if not (select relrowsecurity from pg_class
           where oid = 'public.contact_tags'::regclass) then
    raise exception 'CT-5 FAILED: RLS is off';
  end if;
  if has_table_privilege('anon', 'public.contact_tags', 'SELECT')
     or has_table_privilege('authenticated', 'public.contact_tags', 'SELECT') then
    raise exception 'CT-5 FAILED: a browser role can read the table';
  end if;
  if not has_table_privilege('service_role', 'public.contact_tags', 'DELETE') then
    raise exception 'CT-5 FAILED: the Worker cannot write the table';
  end if;
  raise notice 'CT-5 PASSED: deny-by-default, service_role only';
end $$;

rollback;
