-- [#332] Ownership transfer — assertion suite for
-- supabase/migrations/20260729000200_ownership_transfer.sql.
--
-- This guards the role that controls spending and phone numbers, so the tests
-- that matter most are the REFUSALS: an admin cannot seize it, a non-backup
-- cannot claim it, a claim cannot land early, and no path can leave a
-- workspace without an owner. `api_ownership_integrity()` is asserted empty
-- after every single operation, because the failure it guards against — the
-- two places ownership lives disagreeing — is invisible from every screen in
-- the product until somebody cannot do their job.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/ownership_transfer.test.sql
--
-- One transaction, rolled back. Fixtures use an 'ob' id prefix so the file
-- runs standalone OR after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('0b000000-0000-4000-8000-00000000000a','own-founder@test.local'),
  ('0b000000-0000-4000-8000-00000000000b','own-partner@test.local'),
  ('0b000000-0000-4000-8000-00000000000c','own-tech@test.local'),
  ('0b000000-0000-4000-8000-00000000000d','own-stranger@test.local');

insert into public.companies (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values ('0b000000-0000-4000-8000-000000000001','Founder Plumbing',
        '0b000000-0000-4000-8000-00000000000a','US','415', now());

insert into public.company_members (id, company_id, user_id, role) values
  ('0b000000-0000-4000-8000-000000000010','0b000000-0000-4000-8000-000000000001','0b000000-0000-4000-8000-00000000000a','owner'),
  ('0b000000-0000-4000-8000-000000000011','0b000000-0000-4000-8000-000000000001','0b000000-0000-4000-8000-00000000000b','admin'),
  ('0b000000-0000-4000-8000-000000000012','0b000000-0000-4000-8000-000000000001','0b000000-0000-4000-8000-00000000000c','member');

-- Asserted after every operation below.
create or replace function pg_temp.assert_sane(p_where text) returns void
language plpgsql as $$
declare v_problem text;
begin
  select problem into v_problem from public.api_ownership_integrity()
   where company_id = '0b000000-0000-4000-8000-000000000001';
  if v_problem is not null then
    raise exception 'ownership integrity broken after %: %', p_where, v_problem;
  end if;
end $$;

-- ===========================================================================
-- 0. The invariant that was missing: a second owner row is now impossible.
-- ===========================================================================
do $$
begin
  begin
    update public.company_members set role = 'owner'
     where id = '0b000000-0000-4000-8000-000000000011';
    raise exception 'a second owner row was accepted';
  exception when unique_violation then
    null; -- the index did its job
  end;
end $$;

-- ===========================================================================
-- 1. Naming a backup. Owner only, an active member only, never yourself.
-- ===========================================================================
do $$
declare v jsonb;
begin
  -- An admin cannot name a backup: that is choosing who may one day take the
  -- business, and it is the owner's choice alone.
  v := public.api_set_backup_owner(
    '0b000000-0000-4000-8000-000000000001',
    '0b000000-0000-4000-8000-00000000000b',
    '0b000000-0000-4000-8000-000000000012');
  if v ->> 'outcome' <> 'forbidden' then
    raise exception 'an admin named a backup owner: %', v;
  end if;

  -- "Me" is a spelling of "nobody" that would read as covered on a settings
  -- screen, so it is refused rather than stored.
  v := public.api_set_backup_owner(
    '0b000000-0000-4000-8000-000000000001',
    '0b000000-0000-4000-8000-00000000000a',
    '0b000000-0000-4000-8000-000000000010');
  if v ->> 'outcome' <> 'self' then
    raise exception 'the owner named themselves as backup: %', v;
  end if;

  v := public.api_set_backup_owner(
    '0b000000-0000-4000-8000-000000000001',
    '0b000000-0000-4000-8000-00000000000a',
    '0b000000-0000-4000-8000-000000000011');
  if v ->> 'outcome' <> 'set' then
    raise exception 'the owner could not name a backup: %', v;
  end if;
  perform pg_temp.assert_sane('naming a backup');
end $$;

-- ===========================================================================
-- 2. THE CLAIM PATH — the one that guards a business, tested by its refusals.
-- ===========================================================================
do $$
declare v jsonb;
begin
  -- A plain member is not the backup.
  v := public.api_claim_ownership(
    '0b000000-0000-4000-8000-000000000001','0b000000-0000-4000-8000-00000000000c');
  if v ->> 'outcome' <> 'forbidden' then
    raise exception 'a member who is not the backup started a claim: %', v;
  end if;

  -- Neither is somebody outside the workspace entirely.
  v := public.api_claim_ownership(
    '0b000000-0000-4000-8000-000000000001','0b000000-0000-4000-8000-00000000000d');
  if v ->> 'outcome' <> 'forbidden' then
    raise exception 'a stranger started a claim: %', v;
  end if;

  -- The named backup can.
  v := public.api_claim_ownership(
    '0b000000-0000-4000-8000-000000000001','0b000000-0000-4000-8000-00000000000b');
  if v ->> 'outcome' <> 'claimed' then
    raise exception 'the named backup could not claim: %', v;
  end if;
  -- And nothing has moved yet. This is the whole safety property.
  if (select owner_user_id from public.companies
       where id = '0b000000-0000-4000-8000-000000000001')
     <> '0b000000-0000-4000-8000-00000000000a' then
    raise exception 'starting a claim moved ownership immediately';
  end if;
  perform pg_temp.assert_sane('starting a claim');
end $$;

-- A ripe-in-a-week claim cannot be completed today.
do $$
declare v jsonb;
begin
  v := public.api_accept_ownership(
    '0b000000-0000-4000-8000-000000000001','0b000000-0000-4000-8000-00000000000b');
  if v ->> 'outcome' <> 'not_yet' then
    raise exception 'a claim completed inside its waiting period: %', v;
  end if;
end $$;

-- Two handovers cannot race each other.
do $$
declare v jsonb;
begin
  v := public.api_offer_ownership(
    '0b000000-0000-4000-8000-000000000001',
    '0b000000-0000-4000-8000-00000000000a',
    '0b000000-0000-4000-8000-000000000012');
  if v ->> 'outcome' <> 'in_flight' then
    raise exception 'an offer was opened alongside a live claim: %', v;
  end if;
end $$;

-- THE VETO. The owner kills the claim, instantly, at any point in the week.
do $$
declare v jsonb;
begin
  -- ...and an admin who is not party to it cannot. An admin able to cancel
  -- could keep a dead owner's workspace frozen forever.
  v := public.api_cancel_ownership_transfer(
    '0b000000-0000-4000-8000-000000000001','0b000000-0000-4000-8000-00000000000c');
  if v ->> 'outcome' <> 'forbidden' then
    raise exception 'an uninvolved member cancelled a handover: %', v;
  end if;

  v := public.api_cancel_ownership_transfer(
    '0b000000-0000-4000-8000-000000000001','0b000000-0000-4000-8000-00000000000a');
  if v ->> 'outcome' <> 'canceled' then
    raise exception 'the owner could not veto a claim against them: %', v;
  end if;
  perform pg_temp.assert_sane('vetoing a claim');
end $$;

-- A claim that has ripened DOES complete, and lands the swap.
do $$
declare v jsonb;
begin
  v := public.api_claim_ownership(
    '0b000000-0000-4000-8000-000000000001','0b000000-0000-4000-8000-00000000000b');
  if v ->> 'outcome' <> 'claimed' then
    raise exception 'a second claim after a veto was refused: %', v;
  end if;
  -- Fast-forward past the waiting period.
  update public.ownership_transfers
     set ripens_at = now() - interval '1 minute'
   where company_id = '0b000000-0000-4000-8000-000000000001'
     and accepted_at is null and declined_at is null and canceled_at is null;

  v := public.api_accept_ownership(
    '0b000000-0000-4000-8000-000000000001','0b000000-0000-4000-8000-00000000000b');
  if v ->> 'outcome' <> 'accepted' then
    raise exception 'a ripe claim did not complete: %', v;
  end if;
  perform pg_temp.assert_sane('completing a claim');
end $$;

-- The swap landed in BOTH places, and the outgoing owner is an admin who
-- still works here rather than somebody who was removed.
do $$
begin
  if (select owner_user_id from public.companies
       where id = '0b000000-0000-4000-8000-000000000001')
     <> '0b000000-0000-4000-8000-00000000000b' then
    raise exception 'companies.owner_user_id did not move';
  end if;
  if (select role::text from public.company_members
       where id = '0b000000-0000-4000-8000-000000000011') <> 'owner' then
    raise exception 'the new owner has no owner membership';
  end if;
  if (select role::text from public.company_members
       where id = '0b000000-0000-4000-8000-000000000010') <> 'admin' then
    raise exception 'the outgoing owner was not left as an admin';
  end if;
  if (select deactivated_at from public.company_members
       where id = '0b000000-0000-4000-8000-000000000010') is not null then
    raise exception 'the outgoing owner was removed from the workspace';
  end if;
  -- The nomination does NOT survive its own use: leaving it in place would
  -- hand the previous owner a standing claim on a business that changed hands.
  if (select backup_owner_user_id from public.companies
       where id = '0b000000-0000-4000-8000-000000000001') is not null then
    raise exception 'the backup nomination survived the handover';
  end if;
end $$;

-- ===========================================================================
-- 3. THE OFFER PATH. Two-sided: paperwork until the recipient says yes.
-- ===========================================================================
do $$
declare v jsonb;
begin
  -- The NEW owner offers it on; the old one no longer can.
  v := public.api_offer_ownership(
    '0b000000-0000-4000-8000-000000000001',
    '0b000000-0000-4000-8000-00000000000a',
    '0b000000-0000-4000-8000-000000000012');
  if v ->> 'outcome' <> 'forbidden' then
    raise exception 'the former owner could still hand the business on: %', v;
  end if;

  v := public.api_offer_ownership(
    '0b000000-0000-4000-8000-000000000001',
    '0b000000-0000-4000-8000-00000000000b',
    '0b000000-0000-4000-8000-000000000012');
  if v ->> 'outcome' <> 'offered' then
    raise exception 'the owner could not offer ownership: %', v;
  end if;
  -- Still nothing moved.
  if (select owner_user_id from public.companies
       where id = '0b000000-0000-4000-8000-000000000001')
     <> '0b000000-0000-4000-8000-00000000000b' then
    raise exception 'an unaccepted offer moved ownership';
  end if;
  perform pg_temp.assert_sane('offering ownership');
end $$;

-- Somebody else cannot take an offer addressed to a colleague.
do $$
declare v jsonb;
begin
  v := public.api_accept_ownership(
    '0b000000-0000-4000-8000-000000000001','0b000000-0000-4000-8000-00000000000a');
  if v ->> 'outcome' <> 'forbidden' then
    raise exception 'a bystander accepted somebody else''s offer: %', v;
  end if;
end $$;

-- The recipient may decline, and that is not a cancel by the owner.
do $$
declare v jsonb;
begin
  v := public.api_cancel_ownership_transfer(
    '0b000000-0000-4000-8000-000000000001','0b000000-0000-4000-8000-00000000000c');
  if v ->> 'outcome' <> 'declined' then
    raise exception 'the recipient could not decline: %', v;
  end if;
  perform pg_temp.assert_sane('declining an offer');
end $$;

-- An expired offer cannot be accepted, however keen the recipient is.
do $$
declare v jsonb;
begin
  perform public.api_offer_ownership(
    '0b000000-0000-4000-8000-000000000001',
    '0b000000-0000-4000-8000-00000000000b',
    '0b000000-0000-4000-8000-000000000012');
  update public.ownership_transfers
     set expires_at = now() - interval '1 minute'
   where company_id = '0b000000-0000-4000-8000-000000000001'
     and accepted_at is null and declined_at is null and canceled_at is null;

  v := public.api_accept_ownership(
    '0b000000-0000-4000-8000-000000000001','0b000000-0000-4000-8000-00000000000c');
  if v ->> 'outcome' <> 'expired' then
    raise exception 'an expired offer was accepted: %', v;
  end if;
  perform public.api_cancel_ownership_transfer(
    '0b000000-0000-4000-8000-000000000001','0b000000-0000-4000-8000-00000000000b');
end $$;

-- A recipient removed between the offer and the answer cannot take it: a
-- workspace must never end up owned by somebody who is not in it.
do $$
declare v jsonb;
begin
  perform public.api_offer_ownership(
    '0b000000-0000-4000-8000-000000000001',
    '0b000000-0000-4000-8000-00000000000b',
    '0b000000-0000-4000-8000-000000000012');
  update public.company_members set deactivated_at = now()
   where id = '0b000000-0000-4000-8000-000000000012';

  v := public.api_accept_ownership(
    '0b000000-0000-4000-8000-000000000001','0b000000-0000-4000-8000-00000000000c');
  if v ->> 'outcome' <> 'no_member' then
    raise exception 'a removed member accepted ownership: %', v;
  end if;
  perform pg_temp.assert_sane('an offer to somebody since removed');

  update public.company_members set deactivated_at = null
   where id = '0b000000-0000-4000-8000-000000000012';
  perform public.api_cancel_ownership_transfer(
    '0b000000-0000-4000-8000-000000000001','0b000000-0000-4000-8000-00000000000b');
end $$;

-- ===========================================================================
-- 4. The state read the three clients render, including the one field a
--    client would get wrong on its own.
-- ===========================================================================
do $$
declare v jsonb;
begin
  perform public.api_set_backup_owner(
    '0b000000-0000-4000-8000-000000000001',
    '0b000000-0000-4000-8000-00000000000b',
    '0b000000-0000-4000-8000-000000000010');

  v := public.api_ownership_state('0b000000-0000-4000-8000-000000000001');
  if v ->> 'owner_member_id' <> '0b000000-0000-4000-8000-000000000011' then
    raise exception 'the owner member id is wrong: %', v;
  end if;
  if v ->> 'backup_member_id' <> '0b000000-0000-4000-8000-000000000010' then
    raise exception 'the backup member id is wrong: %', v;
  end if;
  if v -> 'pending' <> 'null'::jsonb then
    raise exception 'a finished handover is still reported as pending: %', v;
  end if;

  -- A nomination that no longer resolves to an ACTIVE member reads as "name
  -- one" rather than showing a name nobody can act on.
  update public.company_members set deactivated_at = now()
   where id = '0b000000-0000-4000-8000-000000000010';
  v := public.api_ownership_state('0b000000-0000-4000-8000-000000000001');
  if v ->> 'backup_member_id' is not null then
    raise exception 'a departed backup is still offered as one: %', v;
  end if;
  update public.company_members set deactivated_at = null
   where id = '0b000000-0000-4000-8000-000000000010';
end $$;

-- ===========================================================================
-- 5. Grants: every function here can move a business, so none of them may be
--    reachable from a browser's anon/authenticated key.
-- ===========================================================================
do $$
declare fn text;
begin
  foreach fn in array array[
    'apply_ownership', 'api_set_backup_owner', 'api_offer_ownership',
    'api_claim_ownership', 'api_accept_ownership',
    'api_cancel_ownership_transfer', 'api_ownership_state',
    'api_ownership_integrity'
  ] loop
    if exists (
      select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = fn
         and (has_function_privilege('anon', p.oid, 'execute')
              or has_function_privilege('authenticated', p.oid, 'execute'))
    ) then
      raise exception '%() is executable by a browser key', fn;
    end if;
  end loop;
end $$;

rollback;
