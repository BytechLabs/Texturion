-- #288 — a referral is earned when the referred business starts working.
--
-- The scope of this issue says the abuse question must be answered in the design and
-- not after launch. This is that answer, asserted: a workspace that sends one text
-- and is never answered has NOT activated, and its referrer is not paid.
--
-- Requiring the reply is what makes farming hard, because the second half is not in
-- the farmer's control — somebody has to text back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('bb110000-0000-4000-8000-000000000001', 'referrer@example.test'),
  ('bb110000-0000-4000-8000-000000000002', 'referee@example.test')
  on conflict do nothing;

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('bb220000-0000-4000-8000-000000000001', 'Referring Plumbing',
   'bb110000-0000-4000-8000-000000000001', 'US', '212', now()),
  ('bb220000-0000-4000-8000-000000000002', 'Referred Heating',
   'bb110000-0000-4000-8000-000000000002', 'US', '212', now());

insert into public.phone_numbers
  (id, company_id, status, provisioning_key, country, number_e164)
values (
  'bb330000-0000-4000-8000-000000000001',
  'bb220000-0000-4000-8000-000000000002',
  'active', 'ref-key', 'US', '+12125559001'
);

insert into public.contacts (id, company_id, phone_e164)
values (
  'bb440000-0000-4000-8000-000000000001',
  'bb220000-0000-4000-8000-000000000002',
  '+12125559777'
);

insert into public.conversations
  (id, company_id, contact_id, phone_number_id, status, last_message_at)
values (
  'bb550000-0000-4000-8000-000000000001',
  'bb220000-0000-4000-8000-000000000002',
  'bb440000-0000-4000-8000-000000000001',
  'bb330000-0000-4000-8000-000000000001',
  'open', now()
);

-- The referral itself, recorded at signup and not yet earned.
insert into public.referrals (company_id, referee_company_id, code)
values (
  'bb220000-0000-4000-8000-000000000001',
  'bb220000-0000-4000-8000-000000000002',
  'TESTCODE'
);

-- 1. A brand-new workspace has not activated, and nothing is owed.
do $$
begin
  if public.company_is_activated('bb220000-0000-4000-8000-000000000002') then
    raise exception 'a workspace that has done nothing counts as activated';
  end if;
  if (public.qualify_referral('bb220000-0000-4000-8000-000000000002') ->> 'outcome')
       is distinct from 'not_yet' then
    raise exception 'a referral qualified before the referee did anything';
  end if;
end $$;

-- 2. THE ONE THAT MATTERS. They send a text. Nobody answers. Still not earned.
--
--    This is exactly the farm: spin up a workspace, send one message into the void,
--    collect. Under the old rule this call stamped the referral.
insert into public.messages
  (company_id, conversation_id, direction, body, status, sent_by_user_id,
   telnyx_message_id)
values (
  'bb220000-0000-4000-8000-000000000002',
  'bb550000-0000-4000-8000-000000000001',
  'outbound', 'hello?', 'delivered',
  'bb110000-0000-4000-8000-000000000002', 'telnyx-ref-1'
);

do $$
begin
  if public.company_is_activated('bb220000-0000-4000-8000-000000000002') then
    raise exception 'one unanswered text counts as activated';
  end if;
  if (public.qualify_referral('bb220000-0000-4000-8000-000000000002') ->> 'outcome')
       is distinct from 'not_yet' then
    raise exception 'a referral was earned by one unanswered text';
  end if;
  if exists (
    select 1 from public.referrals
     where referee_company_id = 'bb220000-0000-4000-8000-000000000002'
       and qualified_at is not null
  ) then
    raise exception 'the referral was stamped despite not qualifying';
  end if;
end $$;

-- 3. Somebody answers. NOW it is earned, and the call says it was this one.
update public.companies
   set first_inbound_reply_at = now()
 where id = 'bb220000-0000-4000-8000-000000000002';

do $$
declare v_result jsonb; begin
  if not public.company_is_activated('bb220000-0000-4000-8000-000000000002') then
    raise exception 'sent and answered is not being read as activated';
  end if;
  v_result := public.qualify_referral('bb220000-0000-4000-8000-000000000002');
  if v_result ->> 'outcome' is distinct from 'qualified' then
    raise exception 'an activated referee did not earn the referral: %', v_result;
  end if;
  if v_result ->> 'referrer_company_id'
       is distinct from 'bb220000-0000-4000-8000-000000000001' then
    raise exception 'the wrong workspace was credited';
  end if;
end $$;

-- 4. And only once, because the caller runs on every single send.
do $$
begin
  if (public.qualify_referral('bb220000-0000-4000-8000-000000000002') ->> 'outcome')
       is distinct from 'noop' then
    raise exception 'a referral qualified twice and would pay twice';
  end if;
end $$;

-- 5. A reply with no send is not activation either. Both halves, always — otherwise
--    an inbound-only workspace that never used the product earns somebody money.
do $$
declare v_other uuid := 'bb220000-0000-4000-8000-000000000003'; begin
  insert into auth.users (id, email)
  values ('bb110000-0000-4000-8000-000000000003', 'inbound-only@example.test')
  on conflict do nothing;
  insert into public.companies
    (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
     first_inbound_reply_at)
  values (v_other, 'Inbound Only', 'bb110000-0000-4000-8000-000000000003',
          'US', '212', now(), now());
  if public.company_is_activated(v_other) then
    raise exception 'a workspace that never sent anything counts as activated';
  end if;
end $$;

-- 6. The signup report now names the channel this business actually runs on.
--    A texted link lands on '/' with no parameters and no referrer, so before this
--    every referred signup was reported as ordinary direct traffic.
do $$
declare v_rows int; begin
  select count(*) into v_rows
    from public.api_signup_attribution(3650, 1)
   where landing_path = '(referral)';
  if v_rows < 1 then
    raise exception 'a referred signup is still invisible in the channel report';
  end if;
end $$;

do $$
begin
  raise notice 'RP OK: a referral is earned by activation, and shows up as a channel';
end $$;

rollback;
