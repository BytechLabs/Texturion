-- #12 plan builder — company_modules table: PK, module check, disabled_at
-- semantics, and the grandfathering query shape. Self-contained fixtures,
-- rolled back.

begin;

insert into auth.users (id, email, raw_user_meta_data)
values ('77777777-7777-4777-8777-777777777777', 'owner@modules.test',
        '{"display_name":"Modules Owner"}'::jsonb);

-- A CA company WITH a forward number → grandfathered into mms + voice + regions_ca.
insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at, forward_to_cell)
values ('77777777-7777-4777-8777-777000000000', 'Modules HVAC',
        '77777777-7777-4777-8777-777777777777', 'CA', '416', now(), '+14165550100');

-- ===========================================================================
-- MOD-1. PK: the same (company, module) twice conflicts.
-- ===========================================================================
do $$
begin
  insert into public.company_modules (company_id, module) values
    ('77777777-7777-4777-8777-777000000000', 'mms'),
    ('77777777-7777-4777-8777-777000000000', 'mms');
  raise exception 'MOD-1 FAILED: duplicate (company, module) accepted';
exception
  when unique_violation then
    raise notice 'MOD-1 PASSED: (company_id, module) is unique';
end $$;

-- ===========================================================================
-- MOD-2. an unknown module is rejected by the check constraint.
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

-- ===========================================================================
-- MOD-3. the grandfathering queries: a CA company with a forward number seeds
--        exactly mms + voice + regions_ca (not extra_storage).
-- ===========================================================================
do $$
declare mods text[];
begin
  insert into public.company_modules (company_id, module)
    select id, 'mms' from public.companies
     where id = '77777777-7777-4777-8777-777000000000' and deleted_at is null
    on conflict do nothing;
  insert into public.company_modules (company_id, module)
    select id, 'voice' from public.companies
     where id = '77777777-7777-4777-8777-777000000000'
       and deleted_at is null and forward_to_cell is not null
    on conflict do nothing;
  insert into public.company_modules (company_id, module)
    select id, 'regions_ca' from public.companies
     where id = '77777777-7777-4777-8777-777000000000'
       and deleted_at is null and country = 'CA'
    on conflict do nothing;

  select array_agg(module order by module) into mods
    from public.company_modules
   where company_id = '77777777-7777-4777-8777-777000000000';
  if mods <> array['mms', 'regions_ca', 'voice'] then
    raise exception 'MOD-3 FAILED: grandfather seeded %, expected mms/regions_ca/voice', mods;
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
  if n <> 2 then
    raise exception 'MOD-4 FAILED: expected 2 enabled modules after disabling voice, got %', n;
  end if;
  raise notice 'MOD-4 PASSED: disabled_at excludes a module from the enabled set';
end $$;

rollback;
