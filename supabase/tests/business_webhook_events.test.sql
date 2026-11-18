begin;

insert into auth.users (id, email)
values ('8f000000-0000-4000-8000-00000000000e', 'business-events@test.local');

insert into public.companies (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values ('8f000000-0000-4000-8000-0000000000d6', 'Business Events',
  '8f000000-0000-4000-8000-00000000000e', 'US', '415', now());

do $$
declare
  company constant uuid := '8f000000-0000-4000-8000-0000000000d6';
  line uuid;
  customer uuid;
  thread uuid;
  endpoint uuid;
  payment uuid;
  quote uuid;
  paid integer;
  refunds integer;
  accepted integer;
begin
  insert into public.phone_numbers (company_id, number_e164, status, provisioning_key, country)
  values (company, '+14155550171', 'active', 'business-event-line', 'US') returning id into line;
  insert into public.contacts (company_id, phone_e164, name)
  values (company, '+14155550172', 'Customer') returning id into customer;
  insert into public.conversations (company_id, contact_id, phone_number_id, contact_phone_e164)
  values (company, customer, line, '+14155550172') returning id into thread;

  insert into public.webhook_endpoints (company_id, url, secret, events)
  values (company, 'https://example.invalid/business-events', 'fixture',
    array['payment.paid', 'payment.refunded', 'quote.accepted']) returning id into endpoint;
  insert into public.webhook_endpoints (company_id, url, secret, events, active)
  values (company, 'https://example.invalid/inactive', 'fixture',
    array['payment.paid', 'payment.refunded', 'quote.accepted'], false);

  insert into public.payment_requests (
    company_id, conversation_id, contact_id, amount_cents, currency, description, stripe_account_id, expires_at
  )
  values (company, thread, customer, 500, 'usd', 'Deposit', 'fixture-account', now() + interval '1 day')
  returning id into payment;
  insert into public.quotes (
    company_id, conversation_id, contact_id, amount_cents, currency, description, expires_at
  )
  values (company, thread, customer, 1000, 'usd', 'First quote', now() + interval '1 day')
  returning id into quote;

  if exists (select from public.webhook_deliveries where company_id = company) then
    raise exception 'draft or unpaid records sent a settlement event';
  end if;

  update public.payment_requests set status = 'paid', amount_received_cents = 500, paid_at = now() where id = payment;
  update public.payment_requests set status = 'paid' where id = payment;
  update public.payment_requests set amount_refunded_cents = 300, refunded_at = now() where id = payment;
  update public.payment_requests set amount_refunded_cents = 300 where id = payment;
  update public.payment_requests set amount_refunded_cents = 500 where id = payment;
  update public.quotes set status = 'sent', sent_at = now() where id = quote;
  update public.quotes set status = 'accepted', decided_at = now() where id = quote;
  update public.quotes set status = 'accepted' where id = quote;

  select count(*) filter (where event_type = 'payment.paid'),
         count(*) filter (where event_type = 'payment.refunded'),
         count(*) filter (where event_type = 'quote.accepted')
    into paid, refunds, accepted from public.webhook_deliveries where company_id = company;
  if paid is distinct from 1 or refunds is distinct from 2 or accepted is distinct from 1 then
    raise exception 'unexpected delivery counts for paid %, refunded %, accepted %', paid, refunds, accepted;
  end if;

  if exists (select from public.webhook_deliveries where company_id = company and
      (endpoint_id is distinct from endpoint or payload->>'id' is distinct from id::text
        or payload->>'type' is distinct from event_type
        or payload->'data'->>'conversation_id' is distinct from thread::text)) then
    raise exception 'a settlement event has an incorrect destination or envelope';
  end if;
end
$$;

rollback;
