-- [#291] Finding a customer by what is IN their custom fields — assertion
-- suite for supabase/migrations/20260804140000_contact_custom_values_search.sql.
--
-- CV-2 is the whole point of the file. The one-line version of this feature is
-- `custom_fields::text`, which carries the KEYS as well: a workspace with a
-- `boiler_model` field would then return every contact that merely HAS the
-- field — blank ones included — the moment somebody typed "boiler". That
-- failure looks like the search working, which is what makes it expensive.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/contact_custom_values.test.sql
--
-- One transaction, rolled back. Fixtures use a '9c' id prefix so the file runs
-- standalone OR after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('9c000000-0000-4000-8000-00000000000a'::uuid, 'values-a@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('9c000000-0000-4000-8000-0000000000c1'::uuid, 'Serial HVAC',
   '9c000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());

insert into public.contacts (id, company_id, phone_e164, name, custom_fields)
values
  ('9c000000-0000-4000-8000-0000000000d1'::uuid,
   '9c000000-0000-4000-8000-0000000000c1'::uuid,
   '+12125559701', 'Filled In',
   '{"boiler_model": "Worcester 8000", "gate_code": "4821"}'::jsonb),
  -- The same workspace, the same field, NOTHING typed into it. This row is
  -- what CV-2 is about.
  ('9c000000-0000-4000-8000-0000000000d2'::uuid,
   '9c000000-0000-4000-8000-0000000000c1'::uuid,
   '+12125559702', 'Asked, No Answer',
   '{"boiler_model": ""}'::jsonb),
  ('9c000000-0000-4000-8000-0000000000d3'::uuid,
   '9c000000-0000-4000-8000-0000000000c1'::uuid,
   '+12125559703', 'Never Asked', '{}'::jsonb);

-- ---------------------------------------------------------------------------
-- CV-1: the values are searchable.
-- ---------------------------------------------------------------------------
do $$
declare v_found int;
begin
  select count(*) into v_found
    from public.contacts
   where company_id = '9c000000-0000-4000-8000-0000000000c1'::uuid
     and custom_values ilike '%Worcester%';
  if v_found is distinct from 1 then
    raise exception 'CV-1: searching a stored value found % row(s)', v_found;
  end if;

  -- And a second field on the same contact, so the projection is not just the
  -- first value it happened to reach.
  select count(*) into v_found
    from public.contacts
   where company_id = '9c000000-0000-4000-8000-0000000000c1'::uuid
     and custom_values ilike '%4821%';
  if v_found is distinct from 1 then
    raise exception 'CV-1: only one field is searchable, found % for the gate code', v_found;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CV-2: the KEYS are not searchable.
--
-- THE ONE THAT MATTERS. "boiler" is a field name here, not an answer. A crew
-- typing it must not get back every customer the field exists on.
-- ---------------------------------------------------------------------------
do $$
declare v_found int;
begin
  select count(*) into v_found
    from public.contacts
   where company_id = '9c000000-0000-4000-8000-0000000000c1'::uuid
     and custom_values ilike '%boiler%';
  if v_found is distinct from 0 then
    raise exception
      'CV-2: searching a field NAME returned % contact(s) — the keys are in the projection',
      v_found;
  end if;

  select count(*) into v_found
    from public.contacts
   where company_id = '9c000000-0000-4000-8000-0000000000c1'::uuid
     and custom_values ilike '%gate_code%';
  if v_found is distinct from 0 then
    raise exception 'CV-2: the gate_code KEY is searchable';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CV-3: an unanswered field contributes nothing.
--
-- "We asked and there is no gate code" is a fact worth storing (#291), but it
-- is not something anybody searches FOR. A blank that widened every search
-- would make the empty answer cost something to record.
-- ---------------------------------------------------------------------------
do $$
declare v_values text;
begin
  select custom_values into v_values
    from public.contacts
   where id = '9c000000-0000-4000-8000-0000000000d2'::uuid;
  if coalesce(v_values, 'x') is distinct from '' then
    raise exception 'CV-3: an empty answer projected to "%"', v_values;
  end if;

  select custom_values into v_values
    from public.contacts
   where id = '9c000000-0000-4000-8000-0000000000d3'::uuid;
  if coalesce(v_values, 'x') is distinct from '' then
    raise exception 'CV-3: a contact with no fields projected to "%"', v_values;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CV-4: it follows the values, without anybody maintaining it.
--
-- A derived column that goes stale is worse than none: the search answers
-- confidently with what used to be true.
-- ---------------------------------------------------------------------------
do $$
declare v_values text;
begin
  update public.contacts
     set custom_fields = '{"boiler_model": "Vaillant ecoTEC"}'::jsonb
   where id = '9c000000-0000-4000-8000-0000000000d1'::uuid;

  select custom_values into v_values
    from public.contacts
   where id = '9c000000-0000-4000-8000-0000000000d1'::uuid;
  if v_values not like '%Vaillant%' then
    raise exception 'CV-4: the projection did not follow the edit (got "%")', v_values;
  end if;
  if v_values like '%Worcester%' then
    raise exception 'CV-4: the projection still carries the OLD value';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CV-5: it cannot be written directly.
--
-- It holds no information the row does not already carry, so a value written
-- straight into it would be a claim about a contact that nothing backs.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    update public.contacts
       set custom_values = 'anything at all'
     where id = '9c000000-0000-4000-8000-0000000000d1'::uuid;
    raise exception 'CV-5: the derived column accepted a direct write';
  exception
    when generated_always then null;
    when syntax_error_or_access_rule_violation then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- CV-6: the search index exists.
--
-- The arm joins the same `or` as the name and phone arms. Without the index,
-- one sequential scan makes the WHOLE search slow, and it degrades quietly as
-- a workspace grows rather than failing.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and tablename = 'contacts'
       and indexname = 'contacts_custom_values_trgm'
  ) then
    raise exception 'CV-6: the trigram index on custom_values is missing';
  end if;
end $$;

rollback;
