-- [#317] Attachment quarantine — assertion suite for
-- supabase/migrations/20260731000000_attachment_quarantine.sql.
--
-- The scan (D101) runs on ingest and stops what it can recognise. It is not
-- antivirus. When something gets past it, a crew member reports the file and it
-- has to stop downloading for EVERYONE — the file is already in the office
-- manager's inbox by then, so a per-person hide would be theatre.
--
-- What this pins is the storage half of that: the columns exist on BOTH tables
-- (a customer's texted-in photo is exactly as likely to be the problem as an
-- uploaded document), the reporter's note cannot become a payload, and the
-- reporter reference survives the reporter leaving the company.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/attachment_quarantine.test.sql
--
-- One transaction, rolled back. Fixtures use a 'cf' id prefix so the file runs
-- standalone OR after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('cf000000-0000-4000-8000-00000000000a'::uuid, 'quarantine-a@test.local');

-- A profile is created by trigger on the auth.users insert above, so this
-- fills in the name rather than creating the row.
update public.profiles
  set display_name = 'Reporter'
  where user_id = 'cf000000-0000-4000-8000-00000000000a'::uuid;

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  (
    'cf000000-0000-4000-8000-0000000000c1'::uuid,
    'Quarantine Plumbing',
    'cf000000-0000-4000-8000-00000000000a'::uuid,
    'US',
    '415',
    now()
  );

insert into public.contacts (id, company_id, phone_e164)
  values (
    'cf000000-0000-4000-8000-0000000000d1'::uuid,
    'cf000000-0000-4000-8000-0000000000c1'::uuid,
    '+15555550100'
  );

insert into public.phone_numbers
  (id, company_id, status, provisioning_key, country)
values
  (
    'cf000000-0000-4000-8000-0000000000b1'::uuid,
    'cf000000-0000-4000-8000-0000000000c1'::uuid,
    'active',
    'cf-quarantine-number',
    'US'
  );

insert into public.conversations (id, company_id, contact_id, phone_number_id)
  values (
    'cf000000-0000-4000-8000-0000000000e1'::uuid,
    'cf000000-0000-4000-8000-0000000000c1'::uuid,
    'cf000000-0000-4000-8000-0000000000d1'::uuid,
    'cf000000-0000-4000-8000-0000000000b1'::uuid
  );

insert into public.messages (id, company_id, conversation_id, direction, body)
  values (
    'cf000000-0000-4000-8000-0000000000f1'::uuid,
    'cf000000-0000-4000-8000-0000000000c1'::uuid,
    'cf000000-0000-4000-8000-0000000000e1'::uuid,
    'note',
    'the note that owns the file'
  );

-- ---------------------------------------------------------------------------
-- BOTH tables carry the quarantine, because a file arrives two ways.
-- ---------------------------------------------------------------------------
do $$
declare
  missing text;
begin
  select string_agg(t || '.' || c, ', ') into missing
  from (
    select t, c
    from unnest(array['attachments', 'message_attachments']) as t,
         unnest(array['quarantined_at', 'quarantined_by_user_id', 'quarantine_note']) as c
  ) wanted
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = wanted.t
      and column_name = wanted.c
  );
  if missing is not null then
    raise exception
      'quarantine columns missing: %. A file texted in by a customer is as '
      'likely to be the problem as an uploaded one, so both tables carry it.',
      missing;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The note is a MEMBER's sentence, and it renders in a timeline. Bounded so it
-- cannot become a payload of its own.
-- ---------------------------------------------------------------------------
insert into public.attachments
  (id, company_id, owner_type, owner_id, conversation_id, storage_path, file_name, content_type, size_bytes)
values
  (
    'cf000000-0000-4000-8000-00000000a001'::uuid,
    'cf000000-0000-4000-8000-0000000000c1'::uuid,
    'note',
    'cf000000-0000-4000-8000-0000000000f1'::uuid,
    'cf000000-0000-4000-8000-0000000000e1'::uuid,
    'attachments/cf/note/x-invoice.pdf',
    'invoice.pdf',
    'application/pdf',
    2048
  );

do $$
begin
  begin
    update public.attachments
      set quarantine_note = repeat('x', 281)
      where id = 'cf000000-0000-4000-8000-00000000a001'::uuid;
    raise exception 'a 281-character note was accepted; the bound is not enforced';
  exception
    when check_violation then null;  -- expected
  end;
end $$;

do $$
begin
  update public.attachments
    set quarantined_at = now(),
        quarantined_by_user_id = 'cf000000-0000-4000-8000-00000000000a'::uuid,
        quarantine_note = repeat('x', 280)
    where id = 'cf000000-0000-4000-8000-00000000a001'::uuid;
  if not exists (
    select 1 from public.attachments
    where id = 'cf000000-0000-4000-8000-00000000a001'::uuid
      and quarantined_at is not null
  ) then
    raise exception 'the quarantine stamp did not take';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The reporter can leave the company. The HOLD must not leave with them.
--
-- `on delete set null` rather than `restrict`: a departed tech's report is
-- still a report, and the file must stay held. Restrict would either block the
-- deletion or, worse, invite somebody to clear the flag to unblock it.
-- ---------------------------------------------------------------------------
do $$
begin
  delete from public.profiles
    where user_id = 'cf000000-0000-4000-8000-00000000000a'::uuid;
  if not exists (
    select 1 from public.attachments
    where id = 'cf000000-0000-4000-8000-00000000a001'::uuid
      and quarantined_at is not null
      and quarantined_by_user_id is null
  ) then
    raise exception
      'losing the reporter released the file — a departed tech''s report is '
      'still a report, and the hold has to outlive their account';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The partial indexes exist, and are partial: the common path is that nothing
-- is quarantined, and it should pay nothing for this feature.
-- ---------------------------------------------------------------------------
do $$
declare
  n int;
begin
  select count(*) into n
  from pg_indexes
  where schemaname = 'public'
    and indexname in ('attachments_quarantined_idx', 'message_attachments_quarantined_idx')
    and indexdef ilike '%where (quarantined_at is not null)%';
  if n is distinct from 2 then
    raise exception
      'expected 2 PARTIAL quarantine indexes, found %. A full index makes every '
      'clean workspace pay for a feature it never uses.', n;
  end if;
end $$;

rollback;
