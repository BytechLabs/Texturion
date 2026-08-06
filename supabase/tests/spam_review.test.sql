-- Loonext spam-review assertion suite (#342).
--
-- The property under test is a discrimination, not a count: a robotexter that
-- keeps appending must produce NOTHING, and a customer who was marked by
-- mistake must be raised. Getting the first half wrong reintroduces exactly
-- the noise D7 rule 3 exists to remove.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- The whole suite runs in one transaction and ROLLS BACK.

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- Fixtures: one company, four contacts, four spam-marked conversations.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email)
values ('d1000000-0000-4000-8000-000000000001', 'spamreview@test.local')
on conflict (id) do nothing;

insert into public.companies (id, owner_user_id, name, country, timezone, requested_area_code, aup_accepted_at)
values ('d1000000-0000-4000-8000-000000000010',
        'd1000000-0000-4000-8000-000000000001',
        'Spam Review Co', 'CA', 'America/Toronto', '613', now());

insert into public.phone_numbers (id, company_id, status, provisioning_key, country, number_e164)
values ('d1000000-0000-4000-8000-000000000020',
        'd1000000-0000-4000-8000-000000000010',
        'active', 'cs_spam_review_1', 'CA', '+16135550199');

insert into public.contacts (id, company_id, phone_e164, name)
values
  ('d1000000-0000-4000-8000-000000000031', 'd1000000-0000-4000-8000-000000000010', '+16135551001', 'Robotexter'),
  ('d1000000-0000-4000-8000-000000000032', 'd1000000-0000-4000-8000-000000000010', '+16135551002', 'Mis-tapped Customer'),
  ('d1000000-0000-4000-8000-000000000033', 'd1000000-0000-4000-8000-000000000010', '+16135551003', 'Persistent Homeowner'),
  ('d1000000-0000-4000-8000-000000000034', 'd1000000-0000-4000-8000-000000000010', '+16135551004', 'Answered Once');

insert into public.conversations (id, company_id, contact_id, phone_number_id, status, is_spam, last_message_at, closed_at)
values
  ('d1000000-0000-4000-8000-000000000041', 'd1000000-0000-4000-8000-000000000010', 'd1000000-0000-4000-8000-000000000031', 'd1000000-0000-4000-8000-000000000020', 'closed', true, now() - interval '30 days', now() - interval '30 days'),
  ('d1000000-0000-4000-8000-000000000042', 'd1000000-0000-4000-8000-000000000010', 'd1000000-0000-4000-8000-000000000032', 'd1000000-0000-4000-8000-000000000020', 'closed', true, now() - interval '30 days', now() - interval '30 days'),
  ('d1000000-0000-4000-8000-000000000043', 'd1000000-0000-4000-8000-000000000010', 'd1000000-0000-4000-8000-000000000033', 'd1000000-0000-4000-8000-000000000020', 'closed', true, now() - interval '30 days', now() - interval '30 days'),
  ('d1000000-0000-4000-8000-000000000044', 'd1000000-0000-4000-8000-000000000010', 'd1000000-0000-4000-8000-000000000034', 'd1000000-0000-4000-8000-000000000020', 'closed', true, now() - interval '30 days', now() - interval '30 days');

-- The mark itself, 30 days ago, by a person, on every thread.
insert into public.conversation_events (company_id, conversation_id, actor_user_id, type, payload, created_at)
select 'd1000000-0000-4000-8000-000000000010', id,
       'd1000000-0000-4000-8000-000000000001', 'spam_marked', '{}'::jsonb,
       now() - interval '30 days'
  from public.conversations
 where company_id = 'd1000000-0000-4000-8000-000000000010';

-- (41) Robotexter: three inbound in one burst yesterday. Never texted by us.
--      A campaign. Must NOT be raised.
insert into public.messages (company_id, conversation_id, direction, body, status, created_at)
select 'd1000000-0000-4000-8000-000000000010', 'd1000000-0000-4000-8000-000000000041',
       'inbound', 'WIN A CRUISE', 'received', now() - interval '1 day' + (n || ' minutes')::interval
  from generate_series(1, 3) n;

-- (42) Mis-tapped customer: ONE message since, but we had texted them before
--      the mark. Reply-shaped by the only definition that holds up.
insert into public.messages (company_id, conversation_id, direction, body, status, sent_by_user_id, created_at)
values ('d1000000-0000-4000-8000-000000000010', 'd1000000-0000-4000-8000-000000000042',
        'outbound', 'On our way', 'delivered', 'd1000000-0000-4000-8000-000000000001', now() - interval '31 days'),
       ('d1000000-0000-4000-8000-000000000010', 'd1000000-0000-4000-8000-000000000042',
        'inbound', 'are you still coming?', 'received', null, now() - interval '2 days');

-- (43) Persistent homeowner: two messages, eight days apart. Never texted by
--      us, low volume — sustained is the only thing that catches this one.
insert into public.messages (company_id, conversation_id, direction, body, status, created_at)
values ('d1000000-0000-4000-8000-000000000010', 'd1000000-0000-4000-8000-000000000043',
        'inbound', 'hi, do you do water heaters?', 'received', now() - interval '10 days'),
       ('d1000000-0000-4000-8000-000000000010', 'd1000000-0000-4000-8000-000000000043',
        'inbound', 'still looking for a quote', 'received', now() - interval '2 days');

-- (44) Answered once: outbound before the mark, so it WOULD be raised — but
--      someone has since confirmed the mark. Used by SR-3.
insert into public.messages (company_id, conversation_id, direction, body, status, sent_by_user_id, created_at)
values ('d1000000-0000-4000-8000-000000000010', 'd1000000-0000-4000-8000-000000000044',
        'outbound', 'thanks', 'delivered', 'd1000000-0000-4000-8000-000000000001', now() - interval '31 days'),
       ('d1000000-0000-4000-8000-000000000010', 'd1000000-0000-4000-8000-000000000044',
        'inbound', 'buy now', 'received', null, now() - interval '5 days');

-- ===========================================================================
-- SR-1. A robotexter appending forever produces nothing. This is the one that
--       matters most: the value of rule 3 is that a spammer stops costing
--       attention, and a review strip that lists them has undone it.
-- ===========================================================================
do $$
declare
  result jsonb;
begin
  result := public.api_spam_review('d1000000-0000-4000-8000-000000000010');
  if exists (
    select 1 from jsonb_array_elements(result) r
     where r->>'conversation_id' = 'd1000000-0000-4000-8000-000000000041'
  ) then
    raise exception 'SR-1 FAILED: a burst of robotexts was raised for review';
  end if;
  raise notice 'SR-1 PASSED: real spam stays quiet';
end $$;

-- ===========================================================================
-- SR-2. The two mistakes ARE raised, and the strongest signal sorts first —
--       a number we texted before marking it outranks one we never did.
-- ===========================================================================
do $$
declare
  result jsonb;
  first_row jsonb;
begin
  result := public.api_spam_review('d1000000-0000-4000-8000-000000000010');

  if not exists (
    select 1 from jsonb_array_elements(result) r
     where r->>'conversation_id' = 'd1000000-0000-4000-8000-000000000042'
       and (r->>'we_texted_them')::boolean
  ) then
    raise exception 'SR-2 FAILED: a customer we had texted was not raised';
  end if;

  if not exists (
    select 1 from jsonb_array_elements(result) r
     where r->>'conversation_id' = 'd1000000-0000-4000-8000-000000000043'
       and (r->>'sustained')::boolean
  ) then
    raise exception 'SR-2 FAILED: messages spread over days were not raised';
  end if;

  first_row := result->0;
  if first_row->>'conversation_id' is distinct from 'd1000000-0000-4000-8000-000000000042' then
    raise exception 'SR-2 FAILED: the strongest signal did not sort first (got %)',
      first_row->>'conversation_id';
  end if;

  -- The real message time, not the frozen sort key. If these were equal the
  -- strip would be as blind as the list it exists to compensate for.
  if (first_row->>'last_inbound_at')::timestamptz
     <= (select last_message_at from public.conversations
          where id = 'd1000000-0000-4000-8000-000000000042') then
    raise exception 'SR-2 FAILED: last_inbound_at came from the frozen sort key';
  end if;

  raise notice 'SR-2 PASSED: mistakes are raised, strongest signal first, on real timestamps';
end $$;

-- ===========================================================================
-- SR-3. "Yes, still spam" is answerable: confirming moves the watermark and
--       the same messages are not raised again. New activity past it can.
-- ===========================================================================
do $$
declare
  result jsonb;
begin
  -- Before: raised (we texted them before the mark).
  result := public.api_spam_review('d1000000-0000-4000-8000-000000000010');
  if not exists (
    select 1 from jsonb_array_elements(result) r
     where r->>'conversation_id' = 'd1000000-0000-4000-8000-000000000044'
  ) then
    raise exception 'SR-3 FAILED: precondition — 44 should be raised before review';
  end if;

  update public.conversations set spam_reviewed_at = now() - interval '1 day'
   where id = 'd1000000-0000-4000-8000-000000000044';

  result := public.api_spam_review('d1000000-0000-4000-8000-000000000010');
  if exists (
    select 1 from jsonb_array_elements(result) r
     where r->>'conversation_id' = 'd1000000-0000-4000-8000-000000000044'
  ) then
    raise exception 'SR-3 FAILED: a confirmed mark was raised again on the same messages';
  end if;

  -- New activity after the confirmation raises it again — the decision stays
  -- revisitable rather than becoming permanent a second time.
  insert into public.messages (company_id, conversation_id, direction, body, status, created_at)
  values ('d1000000-0000-4000-8000-000000000010', 'd1000000-0000-4000-8000-000000000044',
          'inbound', 'hello? it is me', 'received', now() - interval '1 hour');

  result := public.api_spam_review('d1000000-0000-4000-8000-000000000010');
  if not exists (
    select 1 from jsonb_array_elements(result) r
     where r->>'conversation_id' = 'd1000000-0000-4000-8000-000000000044'
  ) then
    raise exception 'SR-3 FAILED: new activity after a confirmation was not raised';
  end if;

  raise notice 'SR-3 PASSED: confirming answers the prompt without silencing it forever';
end $$;

-- ===========================================================================
-- SR-4. Sheer volume is caught on its own, even with no other signal.
-- ===========================================================================
do $$
declare
  result jsonb;
begin
  insert into public.messages (company_id, conversation_id, direction, body, status, created_at)
  select 'd1000000-0000-4000-8000-000000000010', 'd1000000-0000-4000-8000-000000000041',
         'inbound', 'more', 'received', now() - interval '1 day' + (n || ' minutes')::interval
    from generate_series(10, 20) n;

  result := public.api_spam_review('d1000000-0000-4000-8000-000000000010');
  if not exists (
    select 1 from jsonb_array_elements(result) r
     where r->>'conversation_id' = 'd1000000-0000-4000-8000-000000000041'
       and (r->>'high_volume')::boolean
  ) then
    raise exception 'SR-4 FAILED: fourteen messages since the mark went unraised';
  end if;
  raise notice 'SR-4 PASSED: volume alone is worth a human glance';
end $$;

-- ===========================================================================
-- SR-5. #106: a restricted member is not told a hidden number's spam threads
--       exist, review strip included.
-- ===========================================================================
do $$
declare
  result jsonb;
begin
  result := public.api_spam_review(
    'd1000000-0000-4000-8000-000000000010', 20,
    array['d1000000-0000-4000-8000-000000000020']::uuid[]);
  if jsonb_array_length(result) is distinct from 0 then
    raise exception 'SR-5 FAILED: hidden-number threads leaked into the review strip';
  end if;
  raise notice 'SR-5 PASSED: hidden numbers stay hidden here too';
end $$;

-- ===========================================================================
-- SR-6. Service-role only, like every other api_ read model.
-- ===========================================================================
do $$
begin
  if has_function_privilege('authenticated',
       'public.api_spam_review(uuid, int, uuid[], int, int)', 'execute')
     or has_function_privilege('anon',
       'public.api_spam_review(uuid, int, uuid[], int, int)', 'execute') then
    raise exception 'SR-6 FAILED: api_spam_review is reachable by an end-user role';
  end if;
  if not has_function_privilege('service_role',
       'public.api_spam_review(uuid, int, uuid[], int, int)', 'execute') then
    raise exception 'SR-6 FAILED: service_role cannot execute api_spam_review';
  end if;
  raise notice 'SR-6 PASSED: api_spam_review is service-role only';
end $$;

rollback;
