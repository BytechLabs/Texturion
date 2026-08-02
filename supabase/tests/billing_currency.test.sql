-- [#328] Nobody's currency changes under them.
--
-- Two currencies is the change; the risk is entirely in the seams. A workspace
-- that is already paying must not be repriced by a migration, a new Canadian
-- workspace must not have to hunt for a selector, and a third currency must not
-- be storable by anything that happens to write the column.
--
-- One transaction, rolled back. Fixtures use a '7c' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('7c000000-0000-4000-8000-00000000000a'::uuid, 'cur-owner@test.local');

-- A workspace that existed BEFORE this shipped. Inserted without naming the
-- column at all, which is exactly what a pre-migration row looks like.
insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('7c000000-0000-4000-8000-0000000000c1'::uuid, 'Grandfathered Co',
   '7c000000-0000-4000-8000-00000000000a'::uuid, 'CA', '416', now());

-- ---------------------------------------------------------------------------
-- BC-1. An existing Canadian workspace stays on USD.
--
-- The one that matters. #328 asks that existing customers switch only if they
-- choose to, and a Canadian workspace is precisely the one a country-based
-- backfill would have moved without asking — changing what an active
-- subscription bills in, which Stripe would not even honour.
do $$
declare
  v_currency text;
begin
  select billing_currency into v_currency
    from public.companies
   where id = '7c000000-0000-4000-8000-0000000000c1'::uuid;

  if v_currency <> 'usd' then
    raise exception 'BC-1 FAILED: a workspace that predates this migration is '
      'on %, not usd. Existing customers must be grandfathered — their '
      'subscription currency is already pinned at Stripe.', v_currency;
  end if;
  raise notice 'BC-1 PASSED: existing workspaces are grandfathered onto usd';
end $$;

-- ---------------------------------------------------------------------------
-- BC-2. A NEW Canadian workspace is created in CAD, without being asked.
do $$
declare
  v_result jsonb;
  v_currency text;
begin
  select public.api_create_company(
    '7c000000-0000-4000-8000-00000000000a'::uuid,
    'New Canada Co', 'CA', '416', false
  ) into v_result;

  select billing_currency into v_currency
    from public.companies
   where id = (v_result ->> 'id')::uuid;

  if v_currency is distinct from 'cad' then
    raise exception 'BC-2 FAILED: a new Canadian workspace was created in %, '
      'not cad. Defaulting from the country is the whole point — a selector a '
      'plumber has to find is not a default.', v_currency;
  end if;
  raise notice 'BC-2 PASSED: a new Canadian workspace bills in CAD';
end $$;

-- ---------------------------------------------------------------------------
-- BC-3. A new US workspace is untouched.
do $$
declare
  v_result jsonb;
  v_currency text;
begin
  select public.api_create_company(
    '7c000000-0000-4000-8000-00000000000a'::uuid,
    'New US Co', 'US', '212', true
  ) into v_result;

  select billing_currency into v_currency
    from public.companies
   where id = (v_result ->> 'id')::uuid;

  if v_currency is distinct from 'usd' then
    raise exception 'BC-3 FAILED: a new US workspace was created in %.',
      v_currency;
  end if;
  raise notice 'BC-3 PASSED: a new US workspace bills in USD';
end $$;

-- ---------------------------------------------------------------------------
-- BC-4. A currency we do not price cannot be stored.
--
-- A third currency is a price book, a margin model and a tax question — not a
-- row value. The constraint is where that is said, so a well-meaning update
-- cannot create a workspace nothing knows how to charge.
do $$
declare
  v_stored boolean := false;
begin
  begin
    update public.companies
       set billing_currency = 'gbp'
     where id = '7c000000-0000-4000-8000-0000000000c1'::uuid;
    v_stored := true;
  exception when check_violation then
    null; -- refused, which is the point
  end;

  if v_stored then
    raise exception 'BC-4 FAILED: a workspace can be set to a currency the '
      'price book has never heard of.';
  end if;
  raise notice 'BC-4 PASSED: only priced currencies are storable';
end $$;

-- ---------------------------------------------------------------------------
-- BC-5. Switching a workspace that has not paid yet is allowed.
--
-- The other half of #328's ask: defaulted, but changeable. Before a
-- subscription exists there is nothing pinned at Stripe, so the row moves
-- freely — the API is what refuses it afterwards, and it can only do that
-- honestly if the database permits it here.
do $$
declare
  v_currency text;
begin
  update public.companies
     set billing_currency = 'cad'
   where id = '7c000000-0000-4000-8000-0000000000c1'::uuid;

  select billing_currency into v_currency
    from public.companies
   where id = '7c000000-0000-4000-8000-0000000000c1'::uuid;

  if v_currency <> 'cad' then
    raise exception 'BC-5 FAILED: a pre-checkout workspace could not change '
      'currency, so the default could never be corrected.';
  end if;
  raise notice 'BC-5 PASSED: a pre-checkout workspace can change currency';
end $$;

rollback;
