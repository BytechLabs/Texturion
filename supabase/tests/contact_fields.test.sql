-- [#291] Contact fields — assertion suite for
-- supabase/migrations/20260803220000_contact_fields.sql.
--
-- CF-3 is the one that matters. "Which address" is a question with exactly one
-- answer, and a record that cannot answer it sends a van to the wrong
-- building — silently, because both rows are real addresses for a real
-- customer and nothing anywhere is in an error state.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/contact_fields.test.sql
--
-- One transaction, rolled back. Fixtures use an '8c' id prefix so the file runs
-- standalone OR after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('8c000000-0000-4000-8000-00000000000a'::uuid, 'fields-a@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('8c000000-0000-4000-8000-0000000000c1'::uuid, 'Fields Plumbing',
   '8c000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());

insert into public.contacts (id, company_id, phone_e164, name)
values ('8c000000-0000-4000-8000-0000000000d1'::uuid,
        '8c000000-0000-4000-8000-0000000000c1'::uuid,
        '+12125559601', 'Dave'),
       ('8c000000-0000-4000-8000-0000000000d2'::uuid,
        '8c000000-0000-4000-8000-0000000000c1'::uuid,
        '+12125559602', 'Property Manager');

-- ---------------------------------------------------------------------------
-- CF-1: the new fields hold what they say they hold.
-- ---------------------------------------------------------------------------
do $$
begin
  update public.contacts
     set email = 'dave@mapleproperty.example',
         business_name = 'Maple Property Group'
   where id = '8c000000-0000-4000-8000-0000000000d1'::uuid;

  if not exists (
    select 1 from public.contacts
     where id = '8c000000-0000-4000-8000-0000000000d1'::uuid
       and email = 'dave@mapleproperty.example'
       and business_name = 'Maple Property Group'
  ) then
    raise exception 'CF-1: the new contact fields did not round-trip';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CF-2: something that is plainly not an email is refused.
--
-- Cheap sanity, not validation — an address-shaped string is the caller's
-- problem. What this stops is a phone number or a 400-character paragraph
-- landing in the field that quote delivery will later trust.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    update public.contacts set email = 'not-an-email'
     where id = '8c000000-0000-4000-8000-0000000000d1'::uuid;
    raise exception 'CF-2: a string with no @ was accepted as an email';
  exception
    when check_violation then null;
  end;

  begin
    update public.contacts set email = '@leading.example'
     where id = '8c000000-0000-4000-8000-0000000000d1'::uuid;
    raise exception 'CF-2: an email with nothing before the @ was accepted';
  exception
    when check_violation then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- CF-3: exactly one primary address per contact.
--
-- THE SILENT ONE. Two primaries is not an error state anywhere — both rows are
-- real addresses for a real customer — and whichever the query happens to
-- return first is where the van goes.
-- ---------------------------------------------------------------------------
insert into public.contact_addresses
  (company_id, contact_id, label, address, is_primary)
values
  ('8c000000-0000-4000-8000-0000000000c1'::uuid,
   '8c000000-0000-4000-8000-0000000000d1'::uuid,
   'Site', '12 Elm St', true);

do $$
begin
  begin
    insert into public.contact_addresses
      (company_id, contact_id, label, address, is_primary)
    values
      ('8c000000-0000-4000-8000-0000000000c1'::uuid,
       '8c000000-0000-4000-8000-0000000000d1'::uuid,
       'Billing', '99 Oak Ave', true);
    raise exception 'CF-3: a contact was given a second primary address';
  exception
    when unique_violation then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- CF-4: a contact may hold many NON-primary addresses.
--
-- The property manager with forty buildings is the case the whole table exists
-- for, so the uniqueness above must constrain the primary only.
-- ---------------------------------------------------------------------------
do $$
declare held int;
begin
  insert into public.contact_addresses
    (company_id, contact_id, label, address, is_primary)
  values
    ('8c000000-0000-4000-8000-0000000000c1'::uuid,
     '8c000000-0000-4000-8000-0000000000d2'::uuid,
     'Unit 1', '1 Birch Rd', true),
    ('8c000000-0000-4000-8000-0000000000c1'::uuid,
     '8c000000-0000-4000-8000-0000000000d2'::uuid,
     'Unit 2', '2 Birch Rd', false),
    ('8c000000-0000-4000-8000-0000000000c1'::uuid,
     '8c000000-0000-4000-8000-0000000000d2'::uuid,
     'Unit 3', '3 Birch Rd', false);

  select count(*) into held
    from public.contact_addresses
   where contact_id = '8c000000-0000-4000-8000-0000000000d2'::uuid;
  if held <> 3 then
    raise exception 'CF-4: expected three addresses on one contact, got %', held;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CF-5: deleting the contact takes its addresses with it.
--
-- #227 erasure has to be able to promise this. An address row that outlived
-- its contact is personal data with nothing pointing at it, which is the
-- shape nobody finds until an access request.
-- ---------------------------------------------------------------------------
do $$
declare orphans int;
begin
  delete from public.contacts
   where id = '8c000000-0000-4000-8000-0000000000d2'::uuid;

  select count(*) into orphans
    from public.contact_addresses
   where contact_id = '8c000000-0000-4000-8000-0000000000d2'::uuid;
  if orphans <> 0 then
    raise exception 'CF-5: % address row(s) outlived their contact', orphans;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CF-6: the old column still works.
--
-- EXPAND-only. `contacts.address` is still read by the map (#214), by task
-- addresses and by merge fields, and a deploy window where those read a column
-- that no longer exists is the lesson this repo has already paid for once.
-- ---------------------------------------------------------------------------
do $$
begin
  update public.contacts set address = '12 Elm St'
   where id = '8c000000-0000-4000-8000-0000000000d1'::uuid;

  if not exists (
    select 1 from public.contacts
     where id = '8c000000-0000-4000-8000-0000000000d1'::uuid
       and address = '12 Elm St'
  ) then
    raise exception 'CF-6: the legacy address column stopped working';
  end if;
end $$;

rollback;
