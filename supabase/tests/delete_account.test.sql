-- [#346] Deleting your own account.
--
-- The store requirement is about the PERSON, not their workspace. And it
-- cannot be a row deletion: 11 foreign keys point at the auth user with
-- `on delete restrict`, and they are exactly the records that must survive —
-- messages sent, tasks created, consent attested, opt-outs recorded, audit
-- entries. A tech who leaves cannot take the record of who texted a customer
-- with them.
--
-- So these pin severance: the personal data goes, the business's history stays
-- and stops naming anyone, and an owner is refused with something specific.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/delete_account.test.sql
--
-- One transaction, rolled back. 'da' id prefix so the file runs standalone OR
-- after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('da000000-0000-4000-8000-00000000000a','account-owner@test.local'),
  ('da000000-0000-4000-8000-00000000000b','account-tech@test.local');

-- A trigger creates the profile row with the auth user; name them here.
update public.profiles set display_name = 'Dana Owner'
 where user_id = 'da000000-0000-4000-8000-00000000000a';
update public.profiles set display_name = 'Sam Tech'
 where user_id = 'da000000-0000-4000-8000-00000000000b';

insert into public.companies (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values ('da000000-0000-4000-8000-000000000001','Account Co',
        'da000000-0000-4000-8000-00000000000a','US','415', now());

insert into public.company_members (id, company_id, user_id, role) values
  ('da000000-0000-4000-8000-000000000010','da000000-0000-4000-8000-000000000001',
   'da000000-0000-4000-8000-00000000000a','owner'),
  ('da000000-0000-4000-8000-000000000011','da000000-0000-4000-8000-000000000001',
   'da000000-0000-4000-8000-00000000000b','member');

insert into public.phone_numbers (id, company_id, status, provisioning_key, country, number_e164)
  values ('da000000-0000-4000-8000-000000000020','da000000-0000-4000-8000-000000000001',
          'active','account-pk','US','+14155557701');

insert into public.contacts (id, company_id, phone_e164, name)
  values ('da000000-0000-4000-8000-000000000030','da000000-0000-4000-8000-000000000001',
          '+14155559701','Customer');

insert into public.conversations
  (id, company_id, contact_id, phone_number_id, assigned_user_id, status)
values ('da000000-0000-4000-8000-000000000040','da000000-0000-4000-8000-000000000001',
        'da000000-0000-4000-8000-000000000030','da000000-0000-4000-8000-000000000020',
        'da000000-0000-4000-8000-00000000000b','open');

-- The record that must outlive the person: a text they sent to a customer.
insert into public.messages
  (id, company_id, conversation_id, direction, body, status, sent_by_user_id)
values ('da000000-0000-4000-8000-000000000050','da000000-0000-4000-8000-000000000001',
        'da000000-0000-4000-8000-000000000040','outbound','On my way','sent',
        'da000000-0000-4000-8000-00000000000b');

-- Personal data with no business meaning.
insert into public.notification_prefs (user_id, company_id, email_enabled, push_enabled)
values ('da000000-0000-4000-8000-00000000000b','da000000-0000-4000-8000-000000000001', true, true);

-- ---------------------------------------------------------------------------
-- DA-1. An owner is refused, and told WHICH workspaces — a generic failure
--       leaves them with no idea what to do about it (#332: there is no
--       transfer path yet, so this rule has to be stated, not discovered).
-- ---------------------------------------------------------------------------
do $$
declare
  v_owner uuid := 'da000000-0000-4000-8000-00000000000a';
  v jsonb;
begin
  v := public.account_deletion_preview(v_owner);
  if v->>'blocked_by' <> 'owner' then
    raise exception 'DA-1 FAILED: an owner was not blocked: %', v;
  end if;
  if jsonb_array_length(v->'owned') <> 1
     or (v->'owned'->0->>'name') <> 'Account Co' then
    raise exception 'DA-1 FAILED: the blocked preview did not name the workspace: %', v;
  end if;

  -- And the deletion itself refuses too, not just the preview.
  v := public.delete_account(v_owner);
  if v->>'outcome' <> 'owner' then
    raise exception 'DA-1 FAILED: delete_account let an owner through: %', v;
  end if;
  if (select display_name from public.profiles where user_id = v_owner) <> 'Dana Owner' then
    raise exception 'DA-1 FAILED: a refused deletion still stripped the profile';
  end if;

  raise notice 'DA-1 PASSED: an owner is refused, and told which workspaces';
end $$;

-- ---------------------------------------------------------------------------
-- DA-2. A member's preview says what deleting would touch, using the SAME
--       counts the offboarding flow shows — two numbers that disagree are
--       worse than one.
-- ---------------------------------------------------------------------------
do $$
declare
  v_tech uuid := 'da000000-0000-4000-8000-00000000000b';
  v jsonb;
begin
  v := public.account_deletion_preview(v_tech);
  if v->>'blocked_by' is not null then
    raise exception 'DA-2 FAILED: a plain member was blocked: %', v;
  end if;
  if (v->>'memberships')::int <> 1 then
    raise exception 'DA-2 FAILED: memberships = % (want 1)', v;
  end if;
  if (v->>'conversations')::int <> 1 then
    raise exception 'DA-2 FAILED: open conversations = % (want 1)', v;
  end if;
  raise notice 'DA-2 PASSED: the preview reports what deleting would touch';
end $$;

-- ---------------------------------------------------------------------------
-- DA-3. Deletion strips the identity and keeps the record. The text they sent
--       a customer is still there, still attributed to them structurally — the
--       business's history has to stay coherent — but nothing names them.
-- ---------------------------------------------------------------------------
do $$
declare
  v_tech uuid := 'da000000-0000-4000-8000-00000000000b';
  v jsonb;
  v_name text;
begin
  v := public.delete_account(v_tech);
  if v->>'outcome' <> 'deleted' then
    raise exception 'DA-3 FAILED: outcome %', v;
  end if;

  -- The tombstone: the row survives (11 restrict FKs reach the auth user
  -- through it) and no longer says who this was.
  select display_name into v_name from public.profiles where user_id = v_tech;
  if v_name is null then
    raise exception 'DA-3 FAILED: the profile row was removed, breaking attribution';
  end if;
  if v_name <> '' then
    raise exception 'DA-3 FAILED: the display name survived as %', v_name;
  end if;

  -- The business's record is intact.
  if not exists (
    select 1 from public.messages
     where id = 'da000000-0000-4000-8000-000000000050'
       and sent_by_user_id = v_tech
  ) then
    raise exception 'DA-3 FAILED: a message sent to a customer was erased';
  end if;

  -- Personal data with no business meaning is gone.
  if exists (select 1 from public.notification_prefs where user_id = v_tech) then
    raise exception 'DA-3 FAILED: notification preferences survived';
  end if;

  raise notice 'DA-3 PASSED: identity severed, business record intact';
end $$;

-- ---------------------------------------------------------------------------
-- DA-4. Deleting twice is harmless. A retried request must not fail, and there
--       is nothing left for it to do.
-- ---------------------------------------------------------------------------
do $$
declare
  v_tech uuid := 'da000000-0000-4000-8000-00000000000b';
  v jsonb;
begin
  v := public.delete_account(v_tech);
  if v->>'outcome' <> 'deleted' then
    raise exception 'DA-4 FAILED: a repeat deletion returned %', v;
  end if;
  if (v->>'personal_rows')::int <> 0 then
    raise exception 'DA-4 FAILED: a repeat deletion removed % rows', v;
  end if;
  raise notice 'DA-4 PASSED: deleting twice is a safe no-op';
end $$;

rollback;
