-- [#247] The thread catch-up — assertion suite for
-- supabase/migrations/20260805160000_thread_summary.sql.
--
-- Two things ship in that migration and both fail SILENTLY when they go wrong,
-- which is what makes them worth a suite:
--
--   TS-1  the opt-in defaults ON, like every AI toggle except voicemail intake.
--         A default that drifted to false would leave the feature switched off
--         for every workspace and look exactly like nobody using it.
--
--   TS-2  a NULL argument LEAVES the stored value alone. This is the
--         expand/contract seam, and it is the THIRD toggle to need it: between
--         `supabase db push` and `wrangler deploy` the live Worker calls the
--         eight-argument signature, and an older mobile build sends the object
--         without the field forever. If the RPC read "absent" as "false", every
--         one of those calls would turn catch-ups back off behind the owner's
--         back and nothing would look broken.
--
--   TS-3  an explicit false still turns it off. The other half: a "null leaves
--         it alone" rule implemented as "falsy leaves it alone" makes the
--         switch impossible to turn off at all.
--
--   TS-4  the cache is deny-by-default and service-role only. It holds a
--         paraphrase of a customer's messages, so a stray end-user grant would
--         be a cross-tenant read of exactly the content this product is most
--         careful about.
--
--   TS-5  the cache CASCADES with the message it is anchored to. A summary of
--         words that no longer exist is a claim with nothing behind it, and
--         serving one is the only way this feature could show somebody a line
--         with no message to tap through to.
--
--   TS-6  one row per conversation, overwritten in place. A stale catch-up is
--         worthless, and keeping the history would grow this table with message
--         volume for no reader.
--
-- One transaction, rolled back. Fixtures use an 'f7' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                        created_at, updated_at, aud, role)
values ('f7000000-0000-4000-8000-000000000001', 'summary@test.local', '', now(),
        now(), now(), 'authenticated', 'authenticated')
on conflict (id) do nothing;

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, plan)
values ('f7000000-0000-4000-8000-0000000000c1', 'Bolt Plumbing',
        'f7000000-0000-4000-8000-000000000001', 'CA', '613', now(), 'active', 'pro');

-- ===========================================================================
-- TS-1. A workspace that has never touched the settings has catch-ups ON.
-- ===========================================================================
do $$
declare
  v_summarize boolean;
  v_intake    boolean;
begin
  perform public.upsert_company_ai_settings(
    'f7000000-0000-4000-8000-0000000000c1'::uuid, true, true);

  select summarize_threads, voicemail_intake
    into v_summarize, v_intake
    from public.company_ai_settings
   where company_id = 'f7000000-0000-4000-8000-0000000000c1';

  if v_summarize is not true then
    raise exception 'TS-1: catch-ups defaulted to % — every AI toggle except intake is on', v_summarize;
  end if;
  -- The contrast is the point: intake is the ONE exception, and it is the
  -- exception because it changes what a stranger hears (D89). A catch-up
  -- changes nothing anyone outside the crew can observe.
  if v_intake is not false then
    raise exception 'TS-1: voicemail intake should still be the only default-off toggle, got %', v_intake;
  end if;
  raise notice 'TS-1 PASSED: catch-ups default on, intake is still the exception';
end $$;

-- ===========================================================================
-- TS-2. NULL leaves it alone — the expand/contract seam, third time around.
-- ===========================================================================
do $$
declare
  v_summarize boolean;
begin
  -- Turn it off explicitly, the way an owner would.
  perform public.upsert_company_ai_settings(
    'f7000000-0000-4000-8000-0000000000c1'::uuid, true, true, true, null, true,
    true, true, false);

  -- Now save the OTHER switches the way a client that predates this field does:
  -- eight arguments, no catch-up toggle.
  perform public.upsert_company_ai_settings(
    'f7000000-0000-4000-8000-0000000000c1'::uuid, true, true, true, null, true,
    true, true);

  select summarize_threads into v_summarize
    from public.company_ai_settings
   where company_id = 'f7000000-0000-4000-8000-0000000000c1';

  if v_summarize is not false then
    raise exception 'TS-2: an omitted argument turned catch-ups back on (got %)', v_summarize;
  end if;
  raise notice 'TS-2 PASSED: an older client saving other switches leaves catch-ups alone';
end $$;

-- ===========================================================================
-- TS-3. An explicit true turns it back on, so the switch is a switch.
-- ===========================================================================
do $$
declare
  v_summarize boolean;
begin
  perform public.upsert_company_ai_settings(
    'f7000000-0000-4000-8000-0000000000c1'::uuid, true, true, true, null, true,
    true, true, true);

  select summarize_threads into v_summarize
    from public.company_ai_settings
   where company_id = 'f7000000-0000-4000-8000-0000000000c1';

  if v_summarize is not true then
    raise exception 'TS-3: an explicit true did not turn catch-ups on (got %)', v_summarize;
  end if;
  raise notice 'TS-3 PASSED: both directions are reachable';
end $$;

-- ===========================================================================
-- TS-4. The cache is deny-by-default, service-role only.
-- ===========================================================================
do $$
begin
  if not (select relrowsecurity from pg_class
           where oid = 'public.conversation_summaries'::regclass) then
    raise exception 'TS-4: RLS is not enabled on conversation_summaries';
  end if;
  if has_table_privilege('anon', 'public.conversation_summaries', 'select')
     or has_table_privilege('authenticated', 'public.conversation_summaries', 'select') then
    raise exception 'TS-4: an end-user role can read cached summaries directly';
  end if;
  -- And the Worker still can, or the feature is locked out of its own cache.
  if not has_table_privilege('service_role', 'public.conversation_summaries', 'select') then
    raise exception 'TS-4: the Worker cannot read its own cache';
  end if;
  raise notice 'TS-4 PASSED: the cache is the Worker''s alone';
end $$;

-- ===========================================================================
-- TS-5 / TS-6. The cache is anchored, overwritten in place, and cascades.
-- ===========================================================================
do $$
declare
  v_conv      uuid := 'f7000000-0000-4000-8000-0000000000e1';
  v_contact   uuid := 'f7000000-0000-4000-8000-0000000000b1';
  v_number    uuid := 'f7000000-0000-4000-8000-0000000000a1';
  v_company   uuid := 'f7000000-0000-4000-8000-0000000000c1';
  v_msg_one   uuid;
  v_msg_two   uuid;
  v_rows      int;
  v_anchor    uuid;
begin
  insert into public.phone_numbers
    (id, company_id, provisioning_key, country, number_e164, status)
  values (v_number, v_company, 'f7-key-1', 'CA', '+16135550111', 'active');

  insert into public.contacts (id, company_id, phone_e164, name)
  values (v_contact, v_company, '+16135550100', 'Dana Reyes');

  insert into public.conversations (id, company_id, contact_id, phone_number_id, status)
  values (v_conv, v_company, v_contact, v_number, 'open');

  insert into public.messages (company_id, conversation_id, direction, body, status)
  values (v_company, v_conv, 'inbound', 'no hot water since Friday', 'received')
  returning id into v_msg_one;

  insert into public.conversation_summaries
    (conversation_id, company_id, last_message_id, lines, model)
  values (v_conv, v_company, v_msg_one,
          jsonb_build_object('lines', jsonb_build_array(
            jsonb_build_object('section', 'asked',
                               'text', 'no hot water since Friday',
                               'message_id', v_msg_one::text)),
            'truncated', false),
          '@cf/meta/llama-3.1-8b-instruct-fast');

  -- TS-6: a second summary for the same thread REPLACES the first. One row per
  -- conversation, because nobody wants last week's catch-up on a thread that
  -- has moved on.
  insert into public.messages
    (company_id, conversation_id, direction, body, status, sent_by_user_id)
  values (v_company, v_conv, 'outbound', 'we can come Thursday', 'sent',
          'f7000000-0000-4000-8000-000000000001')
  returning id into v_msg_two;

  insert into public.conversation_summaries
    (conversation_id, company_id, last_message_id, lines, model)
  values (v_conv, v_company, v_msg_two,
          jsonb_build_object('lines', '[]'::jsonb, 'truncated', false),
          '@cf/meta/llama-3.1-8b-instruct-fast')
  on conflict (conversation_id) do update
    set last_message_id = excluded.last_message_id,
        lines           = excluded.lines;

  select count(*), min(last_message_id::text)::uuid into v_rows, v_anchor
    from public.conversation_summaries where conversation_id = v_conv;
  if v_rows is distinct from 1 then
    raise exception 'TS-6: % summary rows for one conversation — history is being kept', v_rows;
  end if;
  if v_anchor is distinct from v_msg_two then
    raise exception 'TS-6: the summary is still anchored to the old message';
  end if;
  raise notice 'TS-6 PASSED: one row per conversation, re-anchored in place';

  -- TS-5: the anchor message goes, the summary goes with it. A summary of words
  -- that no longer exist is a claim with nothing behind it.
  delete from public.messages where id = v_msg_two;

  select count(*) into v_rows
    from public.conversation_summaries where conversation_id = v_conv;
  if v_rows is distinct from 0 then
    raise exception 'TS-5: the cached summary outlived the message it was written from';
  end if;
  raise notice 'TS-5 PASSED: the cache cascades with its anchor';
end $$;

rollback;
