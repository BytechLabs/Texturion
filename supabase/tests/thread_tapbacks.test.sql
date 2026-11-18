\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, raw_user_meta_data)
values ('79500000-0000-4000-8000-000000000001', 'owner@tapback.test', '{"display_name":"Tapback Owner"}');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at, subscription_status, plan)
values ('79500000-0000-4000-8000-000000000010', 'Tapback Shop',
        '79500000-0000-4000-8000-000000000001', 'CA', '416', now(), 'active', 'starter');

insert into public.company_members (company_id, user_id, role)
values ('79500000-0000-4000-8000-000000000010', '79500000-0000-4000-8000-000000000001', 'owner');

insert into public.phone_numbers (id, company_id, status, provisioning_key, country, number_e164)
values ('79500000-0000-4000-8000-000000000020', '79500000-0000-4000-8000-000000000010',
        'active', 'cs_test_tapback_1', 'CA', '+14165550790');

insert into public.contacts (id, company_id, phone_e164, name)
values ('79500000-0000-4000-8000-000000000030', '79500000-0000-4000-8000-000000000010',
        '+14165550791', 'Tapback Customer');

insert into public.conversations
  (id, company_id, contact_id, phone_number_id, contact_phone_e164, status, closed_at)
values ('79500000-0000-4000-8000-000000000040', '79500000-0000-4000-8000-000000000010',
        '79500000-0000-4000-8000-000000000030', '79500000-0000-4000-8000-000000000020',
        '+14165550791', 'closed', now() - interval '1 hour');

insert into public.messages
  (id, company_id, conversation_id, direction, status, body, sent_by_user_id, created_at)
values ('79500000-0000-4000-8000-000000000050', '79500000-0000-4000-8000-000000000010',
        '79500000-0000-4000-8000-000000000040', 'outbound', 'delivered',
        'We can come on Friday afternoon.', '79500000-0000-4000-8000-000000000001',
        now() - interval '2 hours');

create function pg_temp.tapback(p_from text, p_id text, p_quote text, p_removed boolean default false)
returns jsonb language sql as $$
  select public.thread_inbound_message(
    '79500000-0000-4000-8000-000000000010', '79500000-0000-4000-8000-000000000020',
    p_from, 'Loved "' || p_quote || '"', p_id, 'UTC', 200, 200,
    jsonb_build_object('emoji', '❤️', 'quote', p_quote, 'removed', p_removed)
  );
$$;

do $$
declare
  result jsonb;
  replay jsonb;
  target constant uuid := '79500000-0000-4000-8000-000000000050';
  thread constant uuid := '79500000-0000-4000-8000-000000000040';
begin
  result := pg_temp.tapback('+14165550791', 'telnyx-tapback-one', 'We can come on Friday…');
  if (result->>'notify_reason', result->>'notify', result->>'created')
     is distinct from ('reaction', 'false', 'true') then
    raise exception 'Expected a quiet reaction, got %', result;
  end if;
  if not exists (
    select from public.messages
     where id = (result->>'message_id')::uuid and reaction_to_message_id = target and reaction_emoji = '❤️'
  ) then raise exception 'The reaction was not linked to its outbound message'; end if;
  if not exists (
    select from public.conversations
     where id = thread and closed_at is not null and status = 'closed'
       and awaiting_reply_since is null and last_notified_at is null
  ) then raise exception 'The reaction reopened the thread or started its notification clock'; end if;

  replay := pg_temp.tapback('+14165550791', 'telnyx-tapback-one', 'We can come on Friday…');
  if replay->>'created' is distinct from 'false'
     or replay->>'message_id' is distinct from result->>'message_id' then
    raise exception 'Webhook replay did not reuse the existing reaction: %', replay;
  end if;

  result := pg_temp.tapback('+14165550791', 'telnyx-tapback-remove', 'We can come on Friday…', true);
  if not exists (
    select from public.messages
     where id = (result->>'message_id')::uuid and reaction_to_message_id = target and reaction_removed
  ) then raise exception 'A removal did not record its target and action'; end if;

  result := pg_temp.tapback('+14165550792', 'telnyx-tapback-stranger', 'We can come on Friday…');
  if result->>'notify_reason' is distinct from 'new' or result->>'notify' is distinct from 'true' then
    raise exception 'An unmatched sender did not retain the normal inbound behavior: %', result;
  end if;

  if has_function_privilege(
    'authenticated', 'public.thread_inbound_message(uuid,uuid,text,text,text,text,integer,integer,jsonb)', 'EXECUTE'
  ) then raise exception 'Users may not call the carrier threading RPC directly'; end if;
end;
$$;

rollback;
