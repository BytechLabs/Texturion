create function public.enqueue_workspace_webhook(p_company uuid, p_event text, p_data jsonb)
returns void
language sql security definer set search_path = ''
as $$
  with endpoints as materialized (
    select id, gen_random_uuid() as delivery_id from public.webhook_endpoints
    where company_id = p_company and active and events @> array[p_event]
    order by created_at, id limit 10
    for key share
  )
  insert into public.webhook_deliveries (id, company_id, endpoint_id, event_type, payload)
  select delivery_id, p_company, id, p_event,
    jsonb_build_object(
      'id', delivery_id, 'company_id', p_company, 'type', p_event,
      'created_at', now(), 'data', p_data
    )
  from endpoints
  on conflict do nothing;
$$;

create function public.enqueue_payment_webhook()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  event_data jsonb;
begin
  event_data := jsonb_build_object(
    'payment_request_id', new.id, 'conversation_id', new.conversation_id,
    'contact_id', new.contact_id, 'currency', new.currency,
    'amount_cents', new.amount_cents, 'amount_received_cents', new.amount_received_cents,
    'amount_refunded_cents', new.amount_refunded_cents
  );
  if new.status = 'paid' and old.status is distinct from new.status then
    perform public.enqueue_workspace_webhook(new.company_id, 'payment.paid', event_data);
  end if;
  if coalesce(new.amount_refunded_cents, 0) > coalesce(old.amount_refunded_cents, 0) then
    perform public.enqueue_workspace_webhook(new.company_id, 'payment.refunded', event_data);
  end if;
  return new;
end;
$$;

create trigger enqueue_payment_webhook
  after update of status, amount_refunded_cents on public.payment_requests
  for each row when (old.status is distinct from new.status
    or old.amount_refunded_cents is distinct from new.amount_refunded_cents)
  execute function public.enqueue_payment_webhook();

create function public.enqueue_quote_webhook()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.enqueue_workspace_webhook(new.company_id, 'quote.accepted', jsonb_build_object(
    'quote_id', new.id, 'conversation_id', new.conversation_id, 'contact_id', new.contact_id,
    'amount_cents', new.amount_cents, 'currency', new.currency, 'decided_at', new.decided_at
  ));
  return new;
end;
$$;

create trigger enqueue_quote_webhook
  after update of status on public.quotes
  for each row when (new.status = 'accepted' and old.status is distinct from new.status)
  execute function public.enqueue_quote_webhook();

revoke execute on function public.enqueue_workspace_webhook(uuid, text, jsonb),
  public.enqueue_payment_webhook(), public.enqueue_quote_webhook()
  from public, anon, authenticated, service_role;
