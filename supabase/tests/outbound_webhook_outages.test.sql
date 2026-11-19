\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email)
values ('8d000000-0000-4000-8000-00000000000e', 'outbound-webhook-outages@test.local');

insert into public.companies (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values ('8d000000-0000-4000-8000-0000000000d6', 'Webhook Outages',
  '8d000000-0000-4000-8000-00000000000e', 'US', '415', now());

do $$
declare
  company constant uuid := '8d000000-0000-4000-8000-0000000000d6';
  first_endpoint uuid;
  second_endpoint uuid;
  delivered_id uuid;
  first_claimed integer;
  second_claimed integer;
begin
  insert into public.webhook_endpoints (company_id, url, secret, events, last_success_at)
  values (company, 'https://example.invalid/primary', 'fixture', array['message.sent'], now() - interval '20 minutes')
  returning id into first_endpoint;
  insert into public.webhook_endpoints (company_id, url, secret, events)
  values (company, 'https://example.invalid/secondary', 'fixture', array['message.sent'])
  returning id into second_endpoint;

  for batch in 1..5 loop
    if public.api_record_webhook_delivery_outcome(first_endpoint, false, 4, 20) then
      raise exception 'a 20-minute outage disabled the endpoint';
    end if;
  end loop;
  update public.webhook_endpoints set failure_streak_started_at = now() - interval '7 hours'
   where id = first_endpoint;
  if public.api_record_webhook_delivery_outcome(first_endpoint, false, 1, 20) then
    raise exception 'an endpoint with a recent success was disabled';
  end if;
  update public.webhook_endpoints set last_success_at = now() - interval '7 hours'
   where id = first_endpoint;
  insert into public.webhook_deliveries (company_id, endpoint_id, event_type, payload)
  values (company, first_endpoint, 'message.sent', '{}') returning id into delivered_id;
  update public.webhook_deliveries set status = 'delivering' where id = delivered_id;
  update public.webhook_deliveries set status = 'succeeded', delivered_at = now() where id = delivered_id;
  if public.api_record_webhook_delivery_outcome(first_endpoint, false, 1, 20) then
    raise exception 'a recent recorded delivery was overlooked';
  end if;
  update public.webhook_deliveries set delivered_at = now() - interval '7 hours' where id = delivered_id;
  if not public.api_record_webhook_delivery_outcome(first_endpoint, false, 1, 20) then
    raise exception 'a persistent outage did not disable the endpoint';
  end if;
  if public.api_record_webhook_delivery_outcome(first_endpoint, false, 1, 20)
    or (select count(*) from public.audit_log where company_id = company and action = 'webhook.endpoint_disabled') <> 1 then
    raise exception 'the disable transition must be audited once';
  end if;

  insert into public.webhook_deliveries (company_id, endpoint_id, event_type, payload)
  select company, first_endpoint, 'message.sent', '{}' from generate_series(1, 13);
  insert into public.webhook_deliveries (company_id, endpoint_id, event_type, payload)
  select company, second_endpoint, 'message.sent', '{}' from generate_series(1, 3);

  select count(*) filter (where endpoint_id = first_endpoint), count(*) filter (where endpoint_id = second_endpoint)
    into first_claimed, second_claimed
    from public.api_claim_webhook_deliveries(100);
  if first_claimed <> 10 or second_claimed <> 3 then
    raise exception 'expected claims of 10 and 3, got % and %', first_claimed, second_claimed;
  end if;
end $$;

rollback;
