-- [#367] The receptionist that asks — assertion suite for
-- supabase/migrations/20260730090000_voicemail_intake.sql (D89).
--
-- Depth (1) of #367: the voicemail greeting asks the caller what the problem is
-- and where, and the transcript is broken out into those fields. Two things in
-- that migration can go wrong silently, and both are about the SETTING rather
-- than the data:
--
--   VI-1  the opt-in defaults OFF — the one AI toggle in this product that
--         does, because it is the one that changes what a STRANGER hears in the
--         business's own name. A default that drifted to true would put a
--         changed greeting on every workspace that never asked for one.
--
--   VI-2  a NULL argument LEAVES the stored value alone. This is the
--         expand/contract seam: between `supabase db push` and `wrangler
--         deploy` the live Worker calls the six-argument signature, and an
--         older mobile build sends the object without the field forever. If the
--         RPC read "absent" as "false", every one of those calls would turn the
--         greeting back off behind the owner's back, and nothing would look
--         broken — the toggle would simply never stay on.
--
--   VI-3  an explicit false still turns it off. The obvious other half: a
--         "null leaves it alone" rule implemented as "falsy leaves it alone"
--         would make the switch impossible to turn off at all.
--
--   VI-4  the calls projection carries the object, so the log and the call
--         detail render it without a second read per row.
--
-- One transaction, rolled back. Fixtures use an 'f1' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                        created_at, updated_at, aud, role)
values ('f1000000-0000-4000-8000-000000000001', 'intake@test.local', '', now(),
        now(), now(), 'authenticated', 'authenticated')
on conflict (id) do nothing;

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, plan)
values ('f1000000-0000-4000-8000-0000000000c1', 'Ace Plumbing',
        'f1000000-0000-4000-8000-000000000001', 'CA', '613', now(), 'active', 'pro');

-- ===========================================================================
-- VI-1. A workspace that has never touched the settings has intake OFF.
-- ===========================================================================
do $$
declare
  v_intake      boolean;
  v_transcribe  boolean;
begin
  perform public.upsert_company_ai_settings(
    'f1000000-0000-4000-8000-0000000000c1'::uuid, true, true);

  select voicemail_intake, transcribe_voicemail
    into v_intake, v_transcribe
    from public.company_ai_settings
   where company_id = 'f1000000-0000-4000-8000-0000000000c1';

  if v_intake is not false then
    raise exception 'VI-1: intake defaulted to % — it must be off until asked for', v_intake;
  end if;
  -- The contrast is the point: every OTHER AI toggle defaults on, and this one
  -- is the exception because of who it speaks to.
  if v_transcribe is not true then
    raise exception 'VI-1: transcription should still default ON, got %', v_transcribe;
  end if;
  raise notice 'VI-1 PASSED: intake is off by default, transcription is not';
end $$;

-- ===========================================================================
-- VI-2. NULL leaves it alone — the expand/contract seam.
--
--       An older Worker or an un-updated mobile build omits the argument. If
--       that read as "off", the toggle could be turned on and would silently
--       revert the next time anybody saved any other switch.
-- ===========================================================================
do $$
declare
  v_intake boolean;
begin
  -- Turn it on explicitly.
  perform public.upsert_company_ai_settings(
    'f1000000-0000-4000-8000-0000000000c1'::uuid, true, true, true, null, true, true);

  -- Now save the OTHER switches the way a client that predates the field does:
  -- six arguments, no intake.
  perform public.upsert_company_ai_settings(
    'f1000000-0000-4000-8000-0000000000c1'::uuid, false, false, false, null, false);

  select voicemail_intake into v_intake
    from public.company_ai_settings
   where company_id = 'f1000000-0000-4000-8000-0000000000c1';

  if v_intake is not true then
    raise exception 'VI-2: an omitted argument turned the greeting off (got %)', v_intake;
  end if;
  raise notice 'VI-2 PASSED: an older client saving other switches leaves the greeting alone';
end $$;

-- ===========================================================================
-- VI-3. An explicit false still turns it off.
-- ===========================================================================
do $$
declare
  v_intake boolean;
begin
  perform public.upsert_company_ai_settings(
    'f1000000-0000-4000-8000-0000000000c1'::uuid, true, true, true, null, true, false);

  select voicemail_intake into v_intake
    from public.company_ai_settings
   where company_id = 'f1000000-0000-4000-8000-0000000000c1';

  if v_intake is not false then
    raise exception 'VI-3: an explicit false did not turn the greeting off (got %)', v_intake;
  end if;
  raise notice 'VI-3 PASSED: off is reachable, so the switch is a switch';
end $$;

-- ===========================================================================
-- VI-4. The calls projection carries the intake object.
-- ===========================================================================
do $$
declare
  v_row jsonb;
begin
  insert into public.calls
    (id, company_id, call_session_id, caller_e164, direction, outcome,
     started_at, voicemail_seconds, voicemail_transcript, voicemail_intake)
  values ('f1000000-0000-4000-8000-0000000000a1',
          'f1000000-0000-4000-8000-0000000000c1',
          'f1-session-1', '+16135550100', 'inbound', 'voicemail', now(), 14,
          'hi it is dave the water heater is leaking at twelve mill road',
          '{"problem":"water heater leaking","address":"12 Mill Road",
            "callback":null,"name":"Dave"}'::jsonb);

  select r into v_row
    from public.api_list_calls('f1000000-0000-4000-8000-0000000000c1'::uuid, 10) r
   limit 1;

  if v_row -> 'voicemail_intake' is null
     or v_row -> 'voicemail_intake' = 'null'::jsonb then
    raise exception 'VI-4: api_list_calls dropped voicemail_intake (row %)', v_row;
  end if;
  if v_row #>> '{voicemail_intake,address}' is distinct from '12 Mill Road' then
    raise exception 'VI-4: the projected address was %',
      v_row #>> '{voicemail_intake,address}';
  end if;
  -- A field the caller never gave stays null rather than becoming a string:
  -- the clients drop null fields, and "null" as text would render as a row.
  if v_row #> '{voicemail_intake,callback}' is distinct from 'null'::jsonb then
    raise exception 'VI-4: an absent field did not survive as json null (%)',
      v_row #> '{voicemail_intake,callback}';
  end if;
  raise notice 'VI-4 PASSED: the projection carries the object, nulls intact';
end $$;

rollback;
