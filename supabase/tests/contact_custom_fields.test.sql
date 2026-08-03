-- [#291] Workspace-defined contact fields — assertion suite for
-- supabase/migrations/20260804000000_contact_custom_fields.sql.
--
-- CX-2 is the one worth reading twice. Values are keyed on `key`, not on the
-- definition's id or its label, so renaming "Boiler model" to "Appliance
-- model" must keep every value attached. Getting that wrong orphans a
-- workspace's operational knowledge in a single edit, silently — the fields
-- simply go blank and nobody can say when.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/contact_custom_fields.test.sql
--
-- One transaction, rolled back. Fixtures use a '9e' id prefix so the file runs
-- standalone OR after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('9e000000-0000-4000-8000-00000000000a'::uuid, 'custom-a@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('9e000000-0000-4000-8000-0000000000c1'::uuid, 'Custom HVAC',
   '9e000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());

insert into public.contacts (id, company_id, phone_e164, name)
values ('9e000000-0000-4000-8000-0000000000d1'::uuid,
        '9e000000-0000-4000-8000-0000000000c1'::uuid,
        '+12125559501', 'Boiler Customer');

-- ---------------------------------------------------------------------------
-- CX-1: a workspace defines its own fields, and the value round-trips.
-- ---------------------------------------------------------------------------
insert into public.contact_field_defs (company_id, key, label, kind, position)
values ('9e000000-0000-4000-8000-0000000000c1'::uuid,
        'boiler_model', 'Boiler model', 'text', 0);

do $$
begin
  update public.contacts
     set custom_fields = '{"boiler_model": "Worcester 8000"}'::jsonb
   where id = '9e000000-0000-4000-8000-0000000000d1'::uuid;

  if not exists (
    select 1 from public.contacts
     where id = '9e000000-0000-4000-8000-0000000000d1'::uuid
       and custom_fields->>'boiler_model' = 'Worcester 8000'
  ) then
    raise exception 'CX-1: the custom field value did not round-trip';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CX-2: renaming the LABEL keeps every value attached.
--
-- THE SILENT ONE. Values are keyed on `key`, so a relabel is cosmetic. Keying
-- them on the definition's id or its label would orphan a workspace's
-- operational knowledge in a single edit — the fields go blank and nobody can
-- say when.
-- ---------------------------------------------------------------------------
do $$
begin
  update public.contact_field_defs
     set label = 'Appliance model'
   where company_id = '9e000000-0000-4000-8000-0000000000c1'::uuid
     and key = 'boiler_model';

  if not exists (
    select 1 from public.contacts
     where id = '9e000000-0000-4000-8000-0000000000d1'::uuid
       and custom_fields->>'boiler_model' = 'Worcester 8000'
  ) then
    raise exception 'CX-2: relabelling a field orphaned its values';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CX-3: a key has to survive being a JSON key and a CSV header.
--
-- Import mapping (#248) and export (#227) both put this string in a column
-- head. A key with a space or a comma in it makes a CSV that reads back wrong.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into public.contact_field_defs (company_id, key, label, kind)
    values ('9e000000-0000-4000-8000-0000000000c1'::uuid,
            'Boiler Model', 'Bad key', 'text');
    raise exception 'CX-3: a key with spaces and capitals was accepted';
  exception
    when check_violation then null;
  end;

  begin
    insert into public.contact_field_defs (company_id, key, label, kind)
    values ('9e000000-0000-4000-8000-0000000000c1'::uuid,
            'serial,number', 'Bad key', 'text');
    raise exception 'CX-3: a key with a comma was accepted';
  exception
    when check_violation then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- CX-4: a select needs options, and nothing else may have them.
--
-- A dropdown with no options is a control nobody can use; options on a
-- checkbox are a promise the input will not keep.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into public.contact_field_defs (company_id, key, label, kind)
    values ('9e000000-0000-4000-8000-0000000000c1'::uuid,
            'system_type', 'System type', 'select');
    raise exception 'CX-4: a select with no options was accepted';
  exception
    when check_violation then null;
  end;

  begin
    insert into public.contact_field_defs (company_id, key, label, kind, options)
    values ('9e000000-0000-4000-8000-0000000000c1'::uuid,
            'has_dog', 'Dog on site', 'checkbox', array['yes', 'no']);
    raise exception 'CX-4: a checkbox was given dropdown options';
  exception
    when check_violation then null;
  end;

  -- And the good shape works.
  insert into public.contact_field_defs (company_id, key, label, kind, options)
  values ('9e000000-0000-4000-8000-0000000000c1'::uuid,
          'system_type', 'System type', 'select',
          array['Combi', 'System', 'Heat only']);
end $$;

-- ---------------------------------------------------------------------------
-- CX-5: one definition per key per workspace.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into public.contact_field_defs (company_id, key, label, kind)
    values ('9e000000-0000-4000-8000-0000000000c1'::uuid,
            'boiler_model', 'Duplicate', 'text');
    raise exception 'CX-5: two definitions share one key';
  exception
    when unique_violation then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- CX-6: the values object is capped.
--
-- An unbounded JSONB column on a row every contact read touches is weight
-- nobody chose to pay for.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    update public.contacts
       set custom_fields = jsonb_build_object('notes', repeat('x', 5000))
     where id = '9e000000-0000-4000-8000-0000000000d1'::uuid;
    raise exception 'CX-6: a five-kilobyte custom-field payload was accepted';
  exception
    when check_violation then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- CX-7: an unanswered field and an empty one are different facts.
--
-- "We have not asked about the gate code" and "we asked, there is not one" are
-- not the same, and a record that cannot tell them apart makes somebody ask
-- twice.
-- ---------------------------------------------------------------------------
do $$
begin
  update public.contacts
     set custom_fields = '{"boiler_model": "Worcester 8000", "gate_code": ""}'::jsonb
   where id = '9e000000-0000-4000-8000-0000000000d1'::uuid;

  if not (
    select custom_fields ? 'gate_code'
      from public.contacts
     where id = '9e000000-0000-4000-8000-0000000000d1'::uuid
  ) then
    raise exception 'CX-7: an empty answer was stored as no answer';
  end if;

  if (
    select custom_fields ? 'warranty_expiry'
      from public.contacts
     where id = '9e000000-0000-4000-8000-0000000000d1'::uuid
  ) then
    raise exception 'CX-7: a key nobody set appeared in the values';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CX-8: deleting the workspace takes its definitions with it.
-- ---------------------------------------------------------------------------
do $$
declare orphans int;
begin
  -- A second workspace so the cascade is tested rather than the FK.
  insert into auth.users (id, email) values
    ('9e000000-0000-4000-8000-00000000000b'::uuid, 'custom-b@test.local');
  insert into public.companies
    (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
  values
    ('9e000000-0000-4000-8000-0000000000c2'::uuid, 'Gone Plumbing',
     '9e000000-0000-4000-8000-00000000000b'::uuid, 'US', '415', now());
  insert into public.contact_field_defs (company_id, key, label, kind)
  values ('9e000000-0000-4000-8000-0000000000c2'::uuid, 'lot', 'Lot', 'text');

  delete from public.companies
   where id = '9e000000-0000-4000-8000-0000000000c2'::uuid;

  select count(*) into orphans
    from public.contact_field_defs
   where company_id = '9e000000-0000-4000-8000-0000000000c2'::uuid;
  if orphans <> 0 then
    raise exception 'CX-8: % definition(s) outlived their workspace', orphans;
  end if;
end $$;

rollback;
