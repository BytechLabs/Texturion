-- #288 — the facts behind "has this crew earned the ask?".
--
-- The number on that card is the first thing an owner will check against their
-- own memory of the month, so every row this function declines to count is
-- asserted here rather than trusted. Each exclusion below is a way the card
-- could claim a customer heard from them when nobody did.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('cc110000-0000-4000-8000-000000000001', 'ask-owner@example.test')
  on conflict do nothing;

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values (
  'cc220000-0000-4000-8000-000000000001', 'Asked Plumbing',
  'cc110000-0000-4000-8000-000000000001', 'US', '212', now()
);

insert into public.phone_numbers
  (id, company_id, status, provisioning_key, country, number_e164)
values (
  'cc330000-0000-4000-8000-000000000001',
  'cc220000-0000-4000-8000-000000000001',
  'active', 'ask-key', 'US', '+12125559101'
);

-- Two contacts, and a THIRD thread belonging to the first of them: the card
-- says "customers", so a returning customer with two threads must count once.
insert into public.contacts (id, company_id, phone_e164) values
  ('cc440000-0000-4000-8000-000000000001',
   'cc220000-0000-4000-8000-000000000001', '+12125559801'),
  ('cc440000-0000-4000-8000-000000000002',
   'cc220000-0000-4000-8000-000000000001', '+12125559802'),
  ('cc440000-0000-4000-8000-000000000003',
   'cc220000-0000-4000-8000-000000000001', '+12125559803');

insert into public.conversations
  (id, company_id, contact_id, phone_number_id, status, last_message_at,
   closed_at)
values
  ('cc550000-0000-4000-8000-000000000001',
   'cc220000-0000-4000-8000-000000000001',
   'cc440000-0000-4000-8000-000000000001',
   'cc330000-0000-4000-8000-000000000001', 'open', now(), null),
  ('cc550000-0000-4000-8000-000000000002',
   'cc220000-0000-4000-8000-000000000001',
   'cc440000-0000-4000-8000-000000000002',
   'cc330000-0000-4000-8000-000000000001', 'open', now(), null),
  -- The SAME contact as the first thread, and closed because two open threads
  -- for one contact on one number are what conversations_open_uq forbids. This
  -- is the returning-customer shape the "customers, not conversations" count has
  -- to get right.
  ('cc550000-0000-4000-8000-000000000003',
   'cc220000-0000-4000-8000-000000000001',
   'cc440000-0000-4000-8000-000000000001',
   'cc330000-0000-4000-8000-000000000001', 'closed', now(), now()),
  ('cc550000-0000-4000-8000-000000000004',
   'cc220000-0000-4000-8000-000000000001',
   'cc440000-0000-4000-8000-000000000003',
   'cc330000-0000-4000-8000-000000000001', 'open', now(), null);

-- A helper so each assertion reads as the question it is asking.
create or replace function pg_temp.fact(p_key text)
returns text language sql as $$
  select public.api_referral_ask_facts(
           'cc220000-0000-4000-8000-000000000001', now()) ->> p_key;
$$;

-- 1. A workspace that has done nothing has nothing to be proud of yet.
do $$
begin
  if pg_temp.fact('activated') is distinct from 'false' then
    raise exception 'a brand-new workspace reads as activated';
  end if;
  if pg_temp.fact('replied_customers') is distinct from '0' then
    raise exception 'a workspace with no messages has replied to somebody';
  end if;
  if pg_temp.fact('rewards_this_year') is distinct from '0' then
    raise exception 'a workspace with no referrals has earned a reward';
  end if;
  if pg_temp.fact('dismissed_at') is not null then
    raise exception 'a prompt nobody has seen is already dismissed';
  end if;
end $$;

-- 2. Two threads, one customer. The card says "customers".
insert into public.messages
  (company_id, conversation_id, direction, body, status, sent_by_user_id,
   telnyx_message_id, automated)
values
  ('cc220000-0000-4000-8000-000000000001',
   'cc550000-0000-4000-8000-000000000001',
   'outbound', 'on my way', 'delivered',
   'cc110000-0000-4000-8000-000000000001', 'ask-tx-1', false),
  ('cc220000-0000-4000-8000-000000000001',
   'cc550000-0000-4000-8000-000000000003',
   'outbound', 'that other job', 'delivered',
   'cc110000-0000-4000-8000-000000000001', 'ask-tx-2', false);

do $$
begin
  if pg_temp.fact('replied_customers') is distinct from '1' then
    raise exception 'one customer across two threads counted as %',
      pg_temp.fact('replied_customers');
  end if;
end $$;

-- 3. An AUTO-REPLY is the product working, not the crew working. The whole
--    premise of the ask is that this crew has been answering people.
insert into public.messages
  (company_id, conversation_id, direction, body, status, sent_by_user_id,
   telnyx_message_id, automated)
values (
  'cc220000-0000-4000-8000-000000000001',
  'cc550000-0000-4000-8000-000000000002',
  'outbound', 'Thanks — we will get back to you.', 'delivered',
  'cc110000-0000-4000-8000-000000000001', 'ask-tx-3', true
);

do $$
begin
  if pg_temp.fact('replied_customers') is distinct from '1' then
    raise exception 'an auto-reply was counted as the crew answering somebody';
  end if;
end $$;

-- 4. A send the CARRIER NEVER ACCEPTED is not a customer who heard back.
insert into public.messages
  (company_id, conversation_id, direction, body, status, sent_by_user_id,
   telnyx_message_id, automated)
values (
  'cc220000-0000-4000-8000-000000000001',
  'cc550000-0000-4000-8000-000000000004',
  'outbound', 'never left the queue', 'failed',
  'cc110000-0000-4000-8000-000000000001', null, false
);

do $$
begin
  if pg_temp.fact('replied_customers') is distinct from '1' then
    raise exception 'a send that never reached the carrier was counted';
  end if;
end $$;

-- 5. And the positive twin, or every assertion above passes for the wrong
--    reason. A real human send to the third contact, and the count moves.
insert into public.messages
  (company_id, conversation_id, direction, body, status, sent_by_user_id,
   telnyx_message_id, automated)
values (
  'cc220000-0000-4000-8000-000000000001',
  'cc550000-0000-4000-8000-000000000004',
  'outbound', 'booked you for Tuesday', 'delivered',
  'cc110000-0000-4000-8000-000000000001', 'ask-tx-4', false
);

do $$
begin
  if pg_temp.fact('replied_customers') is distinct from '2' then
    raise exception 'a real human reply did not count: %',
      pg_temp.fact('replied_customers');
  end if;
end $$;

-- 6. Thirty days is a window, not "ever". A reply from last spring is not this
--    month's evidence.
insert into public.messages
  (company_id, conversation_id, direction, body, status, sent_by_user_id,
   telnyx_message_id, automated, created_at)
values (
  'cc220000-0000-4000-8000-000000000001',
  'cc550000-0000-4000-8000-000000000002',
  'outbound', 'last spring', 'delivered',
  'cc110000-0000-4000-8000-000000000001', 'ask-tx-5', false,
  now() - interval '200 days'
);

do $$
begin
  if pg_temp.fact('replied_customers') is distinct from '2' then
    raise exception 'a reply from 200 days ago counted toward this month';
  end if;
end $$;

-- 7. Activation is still D12's both-halves rule, through the one function.
do $$
begin
  update public.companies
     set first_inbound_reply_at = now()
   where id = 'cc220000-0000-4000-8000-000000000001';
  if pg_temp.fact('activated') is distinct from 'true' then
    raise exception 'sent and answered is not reading as activated';
  end if;
  if pg_temp.fact('activated_at') is null then
    raise exception 'activation has no date, so the month cannot be counted from it';
  end if;
end $$;

-- 8. The dismissal, and the rewards already earned this year.
do $$
declare v_referee uuid := 'cc220000-0000-4000-8000-000000000002'; begin
  update public.companies
     set referral_prompt_dismissed_at = now() - interval '5 days'
   where id = 'cc220000-0000-4000-8000-000000000001';
  if pg_temp.fact('dismissed_at') is null then
    raise exception 'a dismissal was not reported back';
  end if;

  insert into auth.users (id, email)
  values ('cc110000-0000-4000-8000-000000000002', 'ask-referee@example.test')
  on conflict do nothing;
  insert into public.companies
    (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
  values (v_referee, 'Referred Co', 'cc110000-0000-4000-8000-000000000002',
          'US', '212', now());

  -- One paid this year, one paid two years ago. The cap is a ROLLING year, so
  -- only the first counts — a referrer who hit the cap in 2024 must not be shut
  -- out of the programme forever.
  insert into public.referrals
    (company_id, referee_company_id, code, qualified_at, referrer_rewarded_at)
  values
    ('cc220000-0000-4000-8000-000000000001', v_referee, 'ASKCODE1',
     now() - interval '10 days', now() - interval '10 days');
  if pg_temp.fact('rewards_this_year') is distinct from '1' then
    raise exception 'a reward paid this year was not counted: %',
      pg_temp.fact('rewards_this_year');
  end if;

  update public.referrals
     set referrer_rewarded_at = now() - interval '2 years'
   where code = 'ASKCODE1';
  if pg_temp.fact('rewards_this_year') is distinct from '0' then
    raise exception 'a reward paid two years ago still counts against the cap';
  end if;
end $$;

-- 9. A workspace that does not exist gets no facts at all, and the caller reads
--    that as "do not ask" rather than as a zeroed-out healthy row.
do $$
begin
  if public.api_referral_ask_facts(
       'cc220000-0000-4000-8000-00000000ffff', now()) is not null then
    raise exception 'an unknown workspace returned facts';
  end if;
  update public.companies
     set deleted_at = now()
   where id = 'cc220000-0000-4000-8000-000000000001';
  if public.api_referral_ask_facts(
       'cc220000-0000-4000-8000-000000000001', now()) is not null then
    raise exception 'a deleted workspace returned facts';
  end if;
end $$;

do $$
begin
  raise notice 'RA OK: the ask is judged on what the crew actually did';
end $$;

rollback;
