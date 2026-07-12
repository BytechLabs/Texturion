-- #12 plan builder — company_modules table: PK, module check, disabled_at
-- semantics, the grandfathering query shape, the #17 grandfathered-flag
-- reconcile predicate, and the #52 email_ledger idempotency. Self-contained
-- fixtures, rolled back.

begin;

insert into auth.users (id, email, raw_user_meta_data)
values ('77777777-7777-4777-8777-777777777777', 'owner@modules.test',
        '{"display_name":"Modules Owner"}'::jsonb);

-- A CA company → grandfathered into voice + regions_ca. (D42: voice is
-- included for everyone; D43 dropped companies.forward_to_cell — the browser
-- is the phone, so there is no forward-number predicate anymore.)
insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values ('77777777-7777-4777-8777-777000000000', 'Modules HVAC',
        '77777777-7777-4777-8777-777777777777', 'CA', '416', now());

-- ===========================================================================
-- MOD-1. PK: the same (company, module) twice conflicts.
-- ===========================================================================
do $$
begin
  insert into public.company_modules (company_id, module) values
    ('77777777-7777-4777-8777-777000000000', 'voice'),
    ('77777777-7777-4777-8777-777000000000', 'voice');
  raise exception 'MOD-1 FAILED: duplicate (company, module) accepted';
exception
  when unique_violation then
    raise notice 'MOD-1 PASSED: (company_id, module) is unique';
end $$;

-- ===========================================================================
-- MOD-2. unknown AND retired modules are rejected by the check constraint.
--        (#97/#103: 'mms' and #121: 'extra_storage' left the module set — the
--        tightened CHECK must refuse them exactly like any unknown value, so a
--        retired module can never be re-seeded.)
-- ===========================================================================
do $$
begin
  insert into public.company_modules (company_id, module)
  values ('77777777-7777-4777-8777-777000000000', 'bogus');
  raise exception 'MOD-2 FAILED: unknown module accepted';
exception
  when check_violation then
    raise notice 'MOD-2 PASSED: unknown module rejected by the check';
end $$;

do $$
begin
  insert into public.company_modules (company_id, module)
  values ('77777777-7777-4777-8777-777000000000', 'mms');
  raise exception 'MOD-2b FAILED: retired mms module accepted';
exception
  when check_violation then
    raise notice 'MOD-2b PASSED: retired mms module rejected by the tightened check (#103)';
end $$;

do $$
begin
  insert into public.company_modules (company_id, module)
  values ('77777777-7777-4777-8777-777000000000', 'extra_storage');
  raise exception 'MOD-2c FAILED: retired extra_storage module accepted';
exception
  when check_violation then
    raise notice 'MOD-2c PASSED: retired extra_storage module rejected by the tightened check (#121)';
end $$;

-- ===========================================================================
-- MOD-3. the grandfathering queries: a CA company seeds exactly voice +
--        regions_ca (not extra_storage; #103: mms is retired and no longer
--        seedable). D42: voice is now seeded for every non-deleted company
--        (the forward_to_cell predicate died with the column in D43).
-- ===========================================================================
do $$
declare mods text[];
begin
  insert into public.company_modules (company_id, module)
    select id, 'voice' from public.companies
     where id = '77777777-7777-4777-8777-777000000000'
       and deleted_at is null
    on conflict do nothing;
  insert into public.company_modules (company_id, module)
    select id, 'regions_ca' from public.companies
     where id = '77777777-7777-4777-8777-777000000000'
       and deleted_at is null and country = 'CA'
    on conflict do nothing;

  select array_agg(module order by module) into mods
    from public.company_modules
   where company_id = '77777777-7777-4777-8777-777000000000';
  if mods <> array['regions_ca', 'voice'] then
    raise exception 'MOD-3 FAILED: grandfather seeded %, expected regions_ca/voice', mods;
  end if;
  raise notice 'MOD-3 PASSED: grandfathering seeds the live capabilities only';
end $$;

-- ===========================================================================
-- MOD-4. disabled_at semantics: a disabled row is excluded from the enabled set.
-- ===========================================================================
do $$
declare n int;
begin
  update public.company_modules set disabled_at = now()
   where company_id = '77777777-7777-4777-8777-777000000000' and module = 'voice';
  select count(*) into n from public.company_modules
   where company_id = '77777777-7777-4777-8777-777000000000' and disabled_at is null;
  if n <> 1 then
    raise exception 'MOD-4 FAILED: expected 1 enabled module after disabling voice, got %', n;
  end if;
  raise notice 'MOD-4 PASSED: disabled_at excludes a module from the enabled set';
end $$;

-- ===========================================================================
-- MOD-5. #17 grandfathered flag: defaults false for new (purchased) rows, and
--        the reconcile's disable predicate (enabled AND NOT grandfathered)
--        skips grandfathered seeds while catching unpaid purchases.
-- ===========================================================================
do $$
declare victims text[];
begin
  if exists (select 1 from public.company_modules
              where company_id = '77777777-7777-4777-8777-777000000000'
                and grandfathered) then
    raise exception 'MOD-5 FAILED: fresh rows must default grandfathered = false';
  end if;

  -- regions_ca plays a protected pre-#12 seed; voice a normal (purchased,
  -- unpaid) enabled row. (#121: extra_storage is retired, so voice is now the
  -- surviving billable module that stands in for the unpaid purchase.) MOD-4
  -- disabled voice above, so re-enable it here to make it the enabled victim.
  update public.company_modules set disabled_at = null
   where company_id = '77777777-7777-4777-8777-777000000000' and module = 'voice';
  update public.company_modules set grandfathered = true
   where company_id = '77777777-7777-4777-8777-777000000000' and module = 'regions_ca';

  -- The #17 reconcile disable shape: enabled, not grandfathered, no paid item.
  select array_agg(module order by module) into victims
    from public.company_modules
   where company_id = '77777777-7777-4777-8777-777000000000'
     and disabled_at is null
     and not grandfathered;
  if victims <> array['voice'] then
    raise exception 'MOD-5 FAILED: reconcile predicate selected %, expected voice only', victims;
  end if;
  raise notice 'MOD-5 PASSED: grandfathered rows are exempt from the reconcile disable predicate';
end $$;

-- ===========================================================================
-- LEDG-1. #52 email_ledger: the (company_id, email_key) PK dedupes, and the
--         insert-first claim shape (on conflict do nothing) returns no row on
--         a replay — the caller then skips the send.
-- ===========================================================================
do $$
declare claimed int;
begin
  insert into public.email_ledger (company_id, email_key)
  values ('77777777-7777-4777-8777-777000000000', 'port_documents_needed:test');

  begin
    insert into public.email_ledger (company_id, email_key)
    values ('77777777-7777-4777-8777-777000000000', 'port_documents_needed:test');
    raise exception 'LEDG-1 FAILED: duplicate (company_id, email_key) accepted';
  exception
    when unique_violation then
      null; -- the PK held
  end;

  with claim as (
    insert into public.email_ledger (company_id, email_key)
    values ('77777777-7777-4777-8777-777000000000', 'port_documents_needed:test')
    on conflict (company_id, email_key) do nothing
    returning 1
  )
  select count(*) into claimed from claim;
  if claimed <> 0 then
    raise exception 'LEDG-1 FAILED: a replayed claim returned a row (would re-send)';
  end if;
  raise notice 'LEDG-1 PASSED: email_ledger claims are insert-first idempotent';
end $$;

rollback;
