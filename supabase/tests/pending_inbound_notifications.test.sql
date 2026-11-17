\set ON_ERROR_STOP on
begin;

do $$
declare
  v_user uuid := '8b000000-0000-4000-8000-000000000001';
  v_company uuid := '8b000000-0000-4000-8000-000000000002';
  v_number uuid := '8b000000-0000-4000-8000-000000000003';
  v_thread uuid;
  v_message uuid;
  v_result jsonb;
  v_count bigint;
begin
  insert into auth.users (id, email) values (v_user, 'pending-inbound@test.local');
  insert into public.companies
    (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
  values (v_company, 'Pending Inbound', v_user, 'CA', '613', now());
  insert into public.company_members (company_id, user_id, role)
  values (v_company, v_user, 'owner');
  insert into public.phone_numbers
    (id, company_id, provisioning_key, country, number_e164, status)
  values (v_number, v_company, 'pending-inbound-1', 'CA', '+16135559711', 'active');

  v_result := public.thread_inbound_message(v_company, v_number, '+16135559722',
    'First text', 'pending-inbound-start', 'UTC', 50, 50, false, 0);
  v_message := (v_result->>'message_id')::uuid;
  v_thread := (v_result->>'conversation_id')::uuid;
  if v_result->>'crew_notify_state' is distinct from 'pending' then
    raise exception 'Threading did not save the alert: %', v_result;
  end if;

  v_result := public.thread_inbound_message(v_company, v_number, '+16135559722',
    'First text', 'pending-inbound-start', 'UTC', 50, 50, false, 0);
  if (v_result->>'created')::boolean
     or v_result->>'crew_notify_state' is distinct from 'pending' then
    raise exception 'Replay did not recover the saved alert: %', v_result;
  end if;
  if not public.api_mark_inbound_notify_attempted(v_company, v_message, true)
     or public.api_mark_inbound_notify_attempted(v_company, v_message, true) then
    raise exception 'An inbound alert must be claimed once';
  end if;

  select notify_count into v_count from public.inbound_notification_days
   where company_id = v_company;
  update public.conversations set last_notified_at = now() - interval '5 minutes'
   where id = v_thread;
  insert into public.messages
    (company_id, conversation_id, direction, body, status, sent_by_user_id, automated, created_at)
  values (v_company, v_thread, 'outbound', 'Automatic reply', 'delivered',
    v_user, true, now() - interval '4 minutes');

  v_result := public.thread_inbound_message(v_company, v_number, '+16135559722',
    'Another text', 'pending-inbound-automatic', 'UTC', 50, 50, false, 0);
  if v_result->>'crew_notify_state' is distinct from 'none' then
    raise exception 'An automated reply re-armed the alert: %', v_result;
  end if;

  insert into public.messages
    (company_id, conversation_id, direction, body, status, sent_by_user_id, created_at)
  values (v_company, v_thread, 'outbound', 'Crew reply', 'delivered',
    v_user, now() - interval '2 minutes');
  v_result := public.thread_inbound_message(v_company, v_number, '+16135559722',
    'Thanks', 'pending-inbound-reply', 'UTC', 50, 50, false, 0);
  v_message := (v_result->>'message_id')::uuid;
  if v_result->>'crew_notify_state' is distinct from 'pending'
     or v_result->'crew_notify_verdict'->>'notify_reason' is distinct from 'reply'
     or v_result->'crew_notify_verdict'->>'allow_email' is distinct from 'false'
     or v_result->'crew_notify_verdict'->>'allow_push' is distinct from 'true' then
    raise exception 'A crew reply should re-arm push only: %', v_result;
  end if;
  if (select notify_count from public.inbound_notification_days where company_id = v_company)
       is distinct from v_count then
    raise exception 'A reply alert advanced the email ladder';
  end if;

  insert into public.conversation_reads (conversation_id, user_id, last_read_at)
  values (v_thread, v_user, now());
  if public.api_mark_inbound_notify_attempted(v_company, v_message, true) then
    raise exception 'A replay told a member about a text already read';
  end if;

  v_result := public.thread_inbound_message(v_company, v_number, '+16135559722',
    'Urgent', 'pending-inbound-emergency', 'UTC', 50, 50, true, 0);
  if v_result->'crew_notify_verdict'->>'emergency_claimed' is distinct from 'true' then
    raise exception 'The first emergency should bypass quiet hours: %', v_result;
  end if;
  v_result := public.thread_inbound_message(v_company, v_number, '+16135559722',
    'Urgent again', 'pending-inbound-emergency-repeat', 'UTC', 50, 50, true, 0);
  if v_result->'crew_notify_verdict'->>'emergency_claimed' is distinct from 'false' then
    raise exception 'A repeated emergency should respect quiet hours: %', v_result;
  end if;
end $$;

rollback;
