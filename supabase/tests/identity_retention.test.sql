-- Abandoned brand drafts are removed without losing carrier or customer records.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/identity_retention.test.sql
--
-- One transaction, rolled back. Fixtures use an 'fa' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('fa000000-0000-4000-8000-00000000000a'::uuid, 'identity-owner@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   registration_fee_paid_at)
values
  ('fa000000-0000-4000-8000-0000000000c1'::uuid, 'Abandoned Co',
   'fa000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(), null),
  ('fa000000-0000-4000-8000-0000000000c2'::uuid, 'Paying Co',
   'fa000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(), now()),
  ('fa000000-0000-4000-8000-0000000000c3'::uuid, 'Recent Co',
   'fa000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(), null),
  ('fa000000-0000-4000-8000-0000000000c4'::uuid, 'Registered Co',
   'fa000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(), null);

-- The identity payload the wizard's no-EIN path collects.
create or replace function pg_temp.identity_data() returns jsonb
language sql as $$
  select jsonb_build_object(
    'displayName', 'Ace Plumbing', 'website', 'https://ace.example',
    'firstName', 'Dana', 'lastName', 'Whitcomb',
    'ein', '1234', 'mobilePhone', '+14155550111'
  )
$$;

insert into public.messaging_registrations (id, company_id, kind, status, data, updated_at)
values
  -- Abandoned, old, never paid: the case this exists for.
  ('fa000000-0000-4000-8000-0000000000d1'::uuid,
   'fa000000-0000-4000-8000-0000000000c1'::uuid, 'brand', 'draft',
   pg_temp.identity_data(), now() - interval '60 days'),
  -- Abandoned but RECENT: somebody mid-signup who stepped away for coffee.
  ('fa000000-0000-4000-8000-0000000000d2'::uuid,
   'fa000000-0000-4000-8000-0000000000c3'::uuid, 'brand', 'draft',
   pg_temp.identity_data(), now() - interval '2 days'),
  -- SUBMITTED and old: a live carrier relationship.
  ('fa000000-0000-4000-8000-0000000000d3'::uuid,
   'fa000000-0000-4000-8000-0000000000c4'::uuid, 'brand', 'approved',
   pg_temp.identity_data(), now() - interval '120 days');

insert into public.messaging_registrations (id, company_id, kind, status, data, updated_at)
values
  ('fa000000-0000-4000-8000-0000000000d4'::uuid,
   'fa000000-0000-4000-8000-0000000000c2'::uuid, 'brand', 'draft',
   pg_temp.identity_data(), now() - interval '90 days'),
  ('fa000000-0000-4000-8000-0000000000d5'::uuid,
   'fa000000-0000-4000-8000-0000000000c1'::uuid, 'campaign', 'draft',
   '{"messageFlow":"Customers text us first."}', now() - interval '90 days');

do $$
declare
  v_cleared int;
  v_row     jsonb;
begin
  v_cleared := public.api_prune_abandoned_identity(30);

  -- ---------------------------------------------------------------------
  -- The one it must clear.
  -- ---------------------------------------------------------------------
  if exists (select 1 from public.messaging_registrations
   where id = 'fa000000-0000-4000-8000-0000000000d1'::uuid) then
    raise exception 'abandoned brand details were kept';
  end if;
  if exists (select 1 from public.messaging_registrations
   where id = 'fa000000-0000-4000-8000-0000000000d5'::uuid) then
    raise exception 'abandoned texting details were kept';
  end if;

  if v_cleared is distinct from 2 then
    raise exception 'expected exactly 2 rows cleared, got %', v_cleared;
  end if;

  -- ---------------------------------------------------------------------
  -- A SUBMITTED registration is a live carrier relationship. Deleting under
  -- it would break the thing it describes, and that failure surfaces late.
  -- ---------------------------------------------------------------------
  select data into v_row from public.messaging_registrations
   where id = 'fa000000-0000-4000-8000-0000000000d3'::uuid;
  if v_row is null or not (v_row ? 'ein') then
    raise exception 'an APPROVED registration was pruned — that is a live carrier record';
  end if;

  -- ---------------------------------------------------------------------
  -- A paying customer keeps theirs, even on an old draft. A lapsed customer
  -- is still a customer whose registration we may need to resubmit.
  -- ---------------------------------------------------------------------
  select data into v_row from public.messaging_registrations
   where id = 'fa000000-0000-4000-8000-0000000000d4'::uuid;
  if v_row is null or not (v_row ? 'ein') then
    raise exception 'a paying company''s draft was pruned';
  end if;

  -- ---------------------------------------------------------------------
  -- And somebody who stepped away mid-signup is not "abandoned".
  -- ---------------------------------------------------------------------
  select data into v_row from public.messaging_registrations
   where id = 'fa000000-0000-4000-8000-0000000000d2'::uuid;
  if v_row is null or not (v_row ? 'ein') then
    raise exception 'a 2-day-old draft was pruned — that person is mid-signup';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Idempotent: a second pass finds nothing left to do and writes nothing.
-- ---------------------------------------------------------------------------

do $$
begin
  if public.api_prune_abandoned_identity(30) is distinct from 0 then
    raise exception
      'a second pass rewrote rows it had already cleared — the guard on there '
      'being something to remove is what keeps this a no-op on a quiet month';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------------

do $$
begin
  if has_function_privilege('anon', 'public.api_prune_abandoned_identity(int)', 'execute')
     or has_function_privilege(
          'authenticated', 'public.api_prune_abandoned_identity(int)', 'execute')
  then
    raise exception 'the identity prune must not be reachable by anon/authenticated';
  end if;
end $$;

rollback;
