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
  v_disable_audit_id uuid;
  owner_id uuid := '8d000000-0000-4000-8000-00000000000e';
  admin_id uuid := '8d000000-0000-4000-8000-00000000000f';
  member_id uuid := '8d000000-0000-4000-8000-000000000010';
  first_claimed integer;
  second_claimed integer;
begin
  insert into auth.users (id, email) values (admin_id,'outage-admin@test.local'),(member_id,'outage-member@test.local');
  insert into public.company_members (company_id, user_id, role)
  values (company, owner_id, 'owner'), (company, admin_id, 'admin'), (company, member_id, 'member');

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
    or (select count(*) from public.audit_log where company_id = company and action = 'webhook.endpoint_disabled') is distinct from 1 then
    raise exception 'the disable transition must be audited once';
  end if;

  select id into v_disable_audit_id
  from public.audit_log where company_id = company and action = 'webhook.endpoint_disabled';
  if (select count(*) from public.webhook_disable_emails d where d.audit_id = v_disable_audit_id and d.company_id = company) is distinct from 1 then
    raise exception 'the disable transition did not enqueue one email';
  end if;

  if (select count(*) from public.notification_feed(company, owner_id) f where f.type = 'webhook_disabled' and f.id = v_disable_audit_id) is distinct from 1
     or (select count(*) from public.notification_feed(company, admin_id) f where f.type = 'webhook_disabled' and f.id = v_disable_audit_id) is distinct from 1
     or exists (select 1 from public.notification_feed(company, member_id) f where f.type = 'webhook_disabled')
     or exists (select 1 from public.notification_feed(company, owner_id, null, now()) f where f.type = 'webhook_disabled') then
    raise exception 'only active settings managers should see one unread disable notice';
  end if;

  if (select count(*) from public.api_claim_webhook_disable_emails() d where d.audit_id = v_disable_audit_id) is distinct from 1
     or exists (select 1 from public.api_claim_webhook_disable_emails() d where d.audit_id = v_disable_audit_id) then
    raise exception 'only one worker should claim the email during its lease';
  end if;

  insert into public.webhook_deliveries (company_id, endpoint_id, event_type, payload)
  select company, first_endpoint, 'message.sent', '{}' from generate_series(1, 13);
  insert into public.webhook_deliveries (company_id, endpoint_id, event_type, payload)
  select company, second_endpoint, 'message.sent', '{}' from generate_series(1, 3);

  select count(*) filter (where endpoint_id = first_endpoint), count(*) filter (where endpoint_id = second_endpoint)
    into first_claimed, second_claimed
    from public.api_claim_webhook_deliveries(100);
  if first_claimed is distinct from 10 or second_claimed is distinct from 3 then
    raise exception 'expected claims of 10 and 3, got % and %', first_claimed, second_claimed;
  end if;
end $$;

rollback;
