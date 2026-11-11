-- ===========================================================================
-- #722: a text's status only moves forward along the message machine.
-- ===========================================================================
begin;

\set co  '\'72200000-0000-4000-8000-000000000101\''
\set own '\'72200000-0000-4000-8000-000000000102\''
\set cv  '\'72200000-0000-4000-8000-000000000103\''

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                        created_at, updated_at, aud, role)
values (:own, 'ml-own@test.local', '', now(), now(), now(), 'authenticated', 'authenticated')
on conflict (id) do nothing;

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, plan)
values (:co, 'Message Lifecycle Co', :own, 'US', '212', now(), 'active', 'pro');

insert into public.contacts (id, company_id, phone_e164, name)
values ('72200000-0000-4000-8000-000000000104', :co, '+12125559104', 'Lifecycle Customer');

insert into public.phone_numbers
  (id, company_id, provisioning_key, country, number_e164, status)
values ('72200000-0000-4000-8000-000000000105', :co, 'ml-line', 'US', '+12125550105', 'active');

insert into public.conversations (id, company_id, contact_id, phone_number_id, status, last_message_at)
values (:cv, :co, '72200000-0000-4000-8000-000000000104',
        '72200000-0000-4000-8000-000000000105', 'open', now());

insert into public.messages
  (id, company_id, conversation_id, direction, body, status, sent_by_user_id)
values ('72200000-0000-4000-8000-000000000110', :co, :cv, 'outbound', 'hi', 'queued', :own),
       ('72200000-0000-4000-8000-000000000111', :co, :cv, 'outbound', 'hi', 'failed', :own);

do $$
declare
  delivered uuid := '72200000-0000-4000-8000-000000000110';
  failed uuid := '72200000-0000-4000-8000-000000000111';
begin
  update public.messages set status = 'delivered' where id = delivered;
  -- A late `message.sent` replay.
  update public.messages set status = 'sent' where id = delivered;
  if (select status::text from public.messages where id = delivered) is distinct from 'delivered' then
    raise exception 'ML-1 FAILED: a late event moved a delivered text back';
  end if;

  update public.messages set status = 'queued' where id = failed;
  if (select status::text from public.messages where id = failed) is distinct from 'queued' then
    raise exception 'ML-2 FAILED: a retry could not re-queue a failed text';
  end if;
  raise notice 'ML PASSED: texts only move forward, and a failed one can be retried';
end $$;

rollback;
