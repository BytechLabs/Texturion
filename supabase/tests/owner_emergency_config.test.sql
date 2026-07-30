-- [#460] The owner's emergency words and reply — assertion suite for
-- supabase/migrations/20260730080000_owner_emergency_config.sql.
--
-- The founder's complaint was that the product assumes a trade: the shipped
-- default told every landscaper, locksmith and mobile mechanic's customers to
-- reply URGENT "for a no-heat or burst-pipe emergency". Two things were already
-- editable (the away message, the missed-call text-back) and the two that most
-- needed to be were not — WHICH WORD summons the crew, and WHAT WE SAY BACK.
--
-- Everything asserted here is about the column REFUSING a setting that could
-- never work. That is the real risk of making this configurable: a keyword the
-- matcher can never match is worse than no keyword at all, because the owner
-- believes they are covered. The matcher splits an inbound on whitespace and
-- punctuation and upper-cases the first token, so the CHECK exists to keep the
-- storable set equal to the matchable set.
--
--   OE-1  NULL means the product list, and is the shipped state
--   OE-2  a real list is stored as given
--   OE-3  every unmatchable shape is refused
--   OE-4  duplicates are refused
--   OE-5  the reply is free text with a ceiling, and NULL means the default
--
-- One transaction, rolled back. Fixtures use an 'ae' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                        created_at, updated_at, aud, role)
values ('ae000000-0000-4000-8000-000000000001', 'emerg@test.local', '', now(),
        now(), now(), 'authenticated', 'authenticated')
on conflict (id) do nothing;

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, plan)
values ('ae000000-0000-4000-8000-0000000000c1', 'Ace Locksmith',
        'ae000000-0000-4000-8000-000000000001', 'CA', '613', now(), 'active', 'pro');

-- ===========================================================================
-- OE-1. NULL is the shipped state, and it means "the product's list".
--
--       Storing the defaults instead would freeze whatever the list was on the
--       day each workspace signed up, so improving it later would reach nobody.
-- ===========================================================================
do $$
declare
  v_keywords text[];
  v_message  text;
begin
  select emergency_keywords, emergency_message
    into v_keywords, v_message
    from public.companies
   where id = 'ae000000-0000-4000-8000-0000000000c1';

  if v_keywords is not null then
    raise exception 'OE-1 FAILED: a new workspace starts with keywords % (want NULL)',
      v_keywords;
  end if;
  if v_message is not null then
    raise exception 'OE-1 FAILED: a new workspace starts with a message (want NULL)';
  end if;
  raise notice 'OE-1 PASSED: a new workspace defers to the product list';
end $$;

-- ===========================================================================
-- OE-2. An owner's own words are stored exactly as given.
-- ===========================================================================
do $$
declare v_keywords text[];
begin
  update public.companies
     set emergency_keywords = array['LOCKEDOUT', 'URGENT']
   where id = 'ae000000-0000-4000-8000-0000000000c1';

  select emergency_keywords into v_keywords
    from public.companies where id = 'ae000000-0000-4000-8000-0000000000c1';
  if v_keywords <> array['LOCKEDOUT', 'URGENT'] then
    raise exception 'OE-2 FAILED: stored % ', v_keywords;
  end if;

  -- Ten is the ceiling; a list past it is a tag system, not an emergency word.
  update public.companies
     set emergency_keywords = array['K1','K2','K3','K4','K5','K6','K7','K8','K9','K10']
   where id = 'ae000000-0000-4000-8000-0000000000c1';

  raise notice 'OE-2 PASSED: an owner list round-trips, up to the ceiling of ten';
end $$;

-- ===========================================================================
-- OE-3. Every shape the matcher could never match is REFUSED.
--
--       This is the assertion that matters. Accepting one of these would show an
--       owner a saved setting that does nothing — and they would find out on the
--       night it was supposed to work.
-- ===========================================================================
do $$
declare
  -- One case per element, written as a comma-joined list and split below.
  -- A text[][] cannot hold rows of differing length, and one of these cases is
  -- the EMPTY list — which is exactly the case most worth asserting.
  cases text[] := array[
    -- Two words: the matcher reads the FIRST token, so this can never equal
    -- itself. The single most likely thing an owner types.
    'NO HEAT',
    -- Lowercase: the inbound word is upper-cased before comparing.
    'lockedout',
    -- Punctuation: stripped from the inbound before matching.
    'SOS!',
    'LOCKED-OUT',
    -- Too short to be a deliberate instruction, too long to be one word.
    'X',
    'ABCDEFGHIJKLMNOP',
    -- An empty list is not "no emergencies"; the toggle already says that
    -- honestly, and this would be a silent switch-off with no switch.
    ''
  ];
  bad text[];
  raw text;
begin
  foreach raw in array cases loop
    bad := case when raw = '' then array[]::text[] else array[raw] end;
    begin
      update public.companies
         set emergency_keywords = bad
       where id = 'ae000000-0000-4000-8000-0000000000c1';
      raise exception 'OE-3 FAILED: %L was accepted and can never match', bad;
    exception when check_violation then
      null;  -- refused, which is the point
    end;
  end loop;

  -- Eleven: one past the ceiling.
  begin
    update public.companies
       set emergency_keywords =
             array['K1','K2','K3','K4','K5','K6','K7','K8','K9','K10','K11']
     where id = 'ae000000-0000-4000-8000-0000000000c1';
    raise exception 'OE-3 FAILED: eleven keywords accepted';
  exception when check_violation then
    null;
  end;

  raise notice 'OE-3 PASSED: unmatchable and out-of-range keyword lists are refused';
end $$;

-- ===========================================================================
-- OE-4. The same word twice is refused.
--
--       Not pedantry: the settings screen counts this list, so a duplicate
--       would report a number the owner never typed and read as a bug.
-- ===========================================================================
do $$
begin
  begin
    update public.companies
       set emergency_keywords = array['URGENT', 'URGENT']
     where id = 'ae000000-0000-4000-8000-0000000000c1';
    raise exception 'OE-4 FAILED: a duplicate keyword was accepted';
  exception when check_violation then
    null;
  end;
  raise notice 'OE-4 PASSED: duplicates are refused';
end $$;

-- ===========================================================================
-- OE-5. The reply is free text with a ceiling, and NULL restores the default.
--
--       Deliberately NOT constrained in content. The product's safety sentence
--       is appended at send time (emergencyReplyBody) rather than stored, so an
--       owner cannot delete it by editing this column — which is how #414 ask 4
--       survives while the trade-specific wording does not.
-- ===========================================================================
do $$
declare v_message text;
begin
  update public.companies
     set emergency_message = 'Got it - we are on it. Call the shop if it gets worse.'
   where id = 'ae000000-0000-4000-8000-0000000000c1';

  select emergency_message into v_message
    from public.companies where id = 'ae000000-0000-4000-8000-0000000000c1';
  if v_message is null or v_message not like 'Got it%' then
    raise exception 'OE-5 FAILED: the owner message did not round-trip (got %)', v_message;
  end if;

  begin
    update public.companies
       set emergency_message = repeat('x', 1001)
     where id = 'ae000000-0000-4000-8000-0000000000c1';
    raise exception 'OE-5 FAILED: a 1001-character reply was accepted';
  exception when check_violation then
    null;
  end;

  update public.companies
     set emergency_message = null
   where id = 'ae000000-0000-4000-8000-0000000000c1';

  raise notice 'OE-5 PASSED: owner reply stored, capped, and clearable back to the default';
end $$;

select 'owner_emergency_config.test.sql: OE-1..OE-5 PASSED' as result;

rollback;
