-- [#457] The daily outbound count — assertion suite for
-- supabase/migrations/20260730001200_daily_outbound.sql.
--
-- D59 has the ceilings and the predicate. This function is the only reason
-- either can be used, and every assertion below is a way of getting the number
-- wrong that would still look plausible in a dashboard.
--
-- One transaction, rolled back. Fixtures use a 'da' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('da000000-0000-4000-8000-00000000000a'::uuid, 'ceiling@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('da000000-0000-4000-8000-0000000000c1'::uuid, 'Long Message Co',
   'da000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now()),
  ('da000000-0000-4000-8000-0000000000c2'::uuid, 'Sole Prop Co',
   'da000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());

insert into public.phone_numbers
  (id, company_id, status, provisioning_key, country, number_e164)
values
  ('da000000-0000-4000-8000-00000000b001'::uuid,
   'da000000-0000-4000-8000-0000000000c1'::uuid, 'active', 'da-key-1', 'US', '+14155550101'),
  ('da000000-0000-4000-8000-00000000b002'::uuid,
   'da000000-0000-4000-8000-0000000000c2'::uuid, 'active', 'da-key-2', 'US', '+14155550102');

insert into public.contacts (id, company_id, phone_e164)
values
  ('da000000-0000-4000-8000-00000000e001'::uuid,
   'da000000-0000-4000-8000-0000000000c1'::uuid, '+16135551111'),
  ('da000000-0000-4000-8000-00000000e002'::uuid,
   'da000000-0000-4000-8000-0000000000c2'::uuid, '+16135552222');

insert into public.conversations (id, company_id, contact_id, phone_number_id, status)
values
  ('da000000-0000-4000-8000-00000000d001'::uuid,
   'da000000-0000-4000-8000-0000000000c1'::uuid,
   'da000000-0000-4000-8000-00000000e001'::uuid,
   'da000000-0000-4000-8000-00000000b001'::uuid, 'open'),
  ('da000000-0000-4000-8000-00000000d002'::uuid,
   'da000000-0000-4000-8000-0000000000c2'::uuid,
   'da000000-0000-4000-8000-00000000e002'::uuid,
   'da000000-0000-4000-8000-00000000b002'::uuid, 'open');

do $$
declare
  v_count bigint;
  v_case  text;
begin
  -- ==========================================================================
  -- SEGMENTS, NOT ROWS.
  --
  -- The carrier counts what it carries. Three long texts are nine segments to
  -- T-Mobile and three rows here — and a crew sending long messages is exactly
  -- the crew most likely to be near a ceiling, so counting rows would
  -- under-report by precisely the factor that matters.
  -- ==========================================================================
  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments,
     sent_by_user_id, created_at)
  values
    ('da000000-0000-4000-8000-0000000000c1'::uuid,
     'da000000-0000-4000-8000-00000000d001'::uuid,
     'outbound', 'long one', 'delivered', 3,
     'da000000-0000-4000-8000-00000000000a'::uuid, now()),
    ('da000000-0000-4000-8000-0000000000c1'::uuid,
     'da000000-0000-4000-8000-00000000d001'::uuid,
     'outbound', 'long two', 'sent', 3,
     'da000000-0000-4000-8000-00000000000a'::uuid, now()),
    ('da000000-0000-4000-8000-0000000000c1'::uuid,
     'da000000-0000-4000-8000-00000000d001'::uuid,
     'outbound', 'long three', 'queued', 3,
     'da000000-0000-4000-8000-00000000000a'::uuid, now());

  select sent_today into v_count from public.api_daily_outbound(date_trunc('day', now()))
   where company_id = 'da000000-0000-4000-8000-0000000000c1'::uuid;
  if v_count is distinct from 9 then
    raise exception 'segments must be summed, not rows counted: got %', v_count;
  end if;

  -- ==========================================================================
  -- AN UNSETTLED SEND COUNTS AS ONE, NOT ZERO.
  --
  -- `segments` is null until the provider settles. Treating null as zero would
  -- silently under-count exactly during a large batch — the only time this
  -- number is ever consulted.
  -- ==========================================================================
  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments,
     sent_by_user_id, created_at)
  values
    ('da000000-0000-4000-8000-0000000000c1'::uuid,
     'da000000-0000-4000-8000-00000000d001'::uuid,
     'outbound', 'in flight', 'queued', null,
     'da000000-0000-4000-8000-00000000000a'::uuid, now());

  select sent_today into v_count from public.api_daily_outbound(date_trunc('day', now()))
   where company_id = 'da000000-0000-4000-8000-0000000000c1'::uuid;
  if v_count is distinct from 10 then
    raise exception 'an unsettled send must count as one segment: got %', v_count;
  end if;

  -- ==========================================================================
  -- WHAT MUST NOT BE COUNTED.
  --
  -- Inbound is not ours to send. A note never touched a carrier at all. A
  -- failure did not land. And yesterday's traffic is against yesterday's
  -- ceiling — counting it would warn a crew for a batch already delivered.
  -- ==========================================================================
  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments,
     sent_by_user_id, created_at)
  values
    ('da000000-0000-4000-8000-0000000000c1'::uuid,
     'da000000-0000-4000-8000-00000000d001'::uuid,
     'inbound', 'reply', 'received', 5, null, now()),
    ('da000000-0000-4000-8000-0000000000c1'::uuid,
     'da000000-0000-4000-8000-00000000d001'::uuid,
     'note', 'internal', null, 5, null, now()),
    ('da000000-0000-4000-8000-0000000000c1'::uuid,
     'da000000-0000-4000-8000-00000000d001'::uuid,
     'outbound', 'bounced', 'failed', 5,
     'da000000-0000-4000-8000-00000000000a'::uuid, now()),
    ('da000000-0000-4000-8000-0000000000c1'::uuid,
     'da000000-0000-4000-8000-00000000d001'::uuid,
     'outbound', 'yesterday', 'delivered', 50,
     'da000000-0000-4000-8000-00000000000a'::uuid, now() - interval '2 days');

  select sent_today into v_count from public.api_daily_outbound(date_trunc('day', now()))
   where company_id = 'da000000-0000-4000-8000-0000000000c1'::uuid;
  if v_count is distinct from 10 then
    raise exception
      'inbound, notes, failures and older days must not count: got %', v_count;
  end if;

  -- ==========================================================================
  -- THE USE CASE DECIDES WHICH CEILING BINDS.
  --
  -- A sole proprietor is capped at HALF the low-volume number and it cannot be
  -- raised by vetting. Reporting the wrong use case warns the wrong crews at
  -- the wrong volume, in both directions.
  -- ==========================================================================
  select use_case into v_case from public.api_daily_outbound(date_trunc('day', now()))
   where company_id = 'da000000-0000-4000-8000-0000000000c1'::uuid;
  if v_case is distinct from 'LOW_VOLUME' then
    raise exception 'an unregistered company must default to LOW_VOLUME: got %', v_case;
  end if;

  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments,
     sent_by_user_id, created_at)
  values
    ('da000000-0000-4000-8000-0000000000c2'::uuid,
     'da000000-0000-4000-8000-00000000d002'::uuid,
     'outbound', 'sole prop', 'delivered', 2,
     'da000000-0000-4000-8000-00000000000a'::uuid, now());

  insert into public.messaging_registrations (company_id, kind, status, sole_proprietor, data)
  values ('da000000-0000-4000-8000-0000000000c2'::uuid, 'campaign', 'approved', true, '{}'::jsonb);

  select use_case into v_case from public.api_daily_outbound(date_trunc('day', now()))
   where company_id = 'da000000-0000-4000-8000-0000000000c2'::uuid;
  if v_case is distinct from 'SOLE_PROPRIETOR' then
    raise exception 'a sole-prop campaign must report SOLE_PROPRIETOR: got %', v_case;
  end if;

  -- Each workspace is counted alone. A shared count would warn a quiet crew
  -- about a loud one's batch.
  select sent_today into v_count from public.api_daily_outbound(date_trunc('day', now()))
   where company_id = 'da000000-0000-4000-8000-0000000000c2'::uuid;
  if v_count is distinct from 2 then
    raise exception 'counts must be per company: got %', v_count;
  end if;

  raise notice 'daily outbound (#457): all assertions passed';
end $$;

-- The function reads message BODIES' metadata across every tenant, so it must
-- never be reachable by a signed-in user (§ SECURITY DEFINER convention).
do $$
begin
  if has_function_privilege('authenticated', 'public.api_daily_outbound(timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.api_daily_outbound(timestamptz)', 'execute') then
    raise exception 'api_daily_outbound must not be executable by anon or authenticated';
  end if;
end $$;

rollback;
