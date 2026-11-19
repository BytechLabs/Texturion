\set ON_ERROR_STOP on

begin;

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_company uuid := gen_random_uuid();
  v_line uuid := gen_random_uuid();
  v_contact uuid := gen_random_uuid();
  v_thread uuid := gen_random_uuid();
  v_session constant text := 'reply-suggestion-window-voicemail';
  v_result jsonb;
begin
  insert into auth.users (id, email) values (v_owner, 'reply-window@test.local');
  insert into public.companies (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
  values (v_company, 'Reply Window', v_owner, 'US', '415', now());
  insert into public.phone_numbers (id, company_id, number_e164, status, provisioning_key, country)
  values (v_line, v_company, '+14155550731', 'active', 'reply-window', 'US');
  insert into public.contacts (id, company_id, phone_e164) values (v_contact, v_company, '+14155550732');
  insert into public.conversations (id, company_id, phone_number_id, contact_id)
  values (v_thread, v_company, v_line, v_contact);

  insert into public.messages (company_id, conversation_id, direction, body, status, created_at)
  select v_company, v_thread, 'inbound', 'Text ' || i, 'received', now() - i * interval '1 minute'
  from generate_series(1, 13) as i;
  insert into public.messages (company_id, conversation_id, direction, body, sent_by_user_id)
  values (v_company, v_thread, 'note', 'Private crew note', v_owner);
  insert into public.calls (
    company_id, phone_number_id, contact_id, conversation_id, call_session_id,
    outcome, voicemail_path, voicemail_transcript
  ) values (
    v_company, v_line, v_contact, v_thread, v_session,
    'voicemail', v_company || '/voicemail/test.mp3', 'The water heater stopped working.'
  );
  perform public.api_insert_voicemail_event(
    v_company, v_thread, v_session, '+14155550732', 20, 'Stale transcript from the event'
  );

  select jsonb_agg(to_jsonb(turn) order by turn.created_at desc) into v_result
  from public.api_reply_suggestion_window(v_company, v_thread, 100) turn;
  if jsonb_array_length(v_result) is distinct from 12
     or v_result->0->>'direction' is distinct from 'inbound'
     or v_result->0->>'body' is distinct from 'The water heater stopped working.'
     or v_result->0->>'source' is distinct from 'voicemail'
     or v_result->11->>'body' is distinct from 'Text 11' then
    raise exception 'Reply window must contain one live voicemail and the eleven newest texts: %', v_result;
  end if;

  update public.calls set voicemail_deleted_at = now() where call_session_id = v_session;
  update public.messages set deleted_at = now() where company_id = v_company and body = 'Text 1';
  select jsonb_agg(to_jsonb(turn) order by turn.created_at desc) into v_result
  from public.api_reply_suggestion_window(v_company, v_thread, 12) turn;
  if jsonb_array_length(v_result) is distinct from 12
     or v_result->0->>'body' is distinct from 'Text 2' then
    raise exception 'Deleted voicemail, deleted text or internal note reached the window: %', v_result;
  end if;

  if (select count(*) from public.api_reply_suggestion_window(gen_random_uuid(), v_thread, 12)) is distinct from 0
     or has_function_privilege('anon', 'public.api_reply_suggestion_window(uuid,uuid,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.api_reply_suggestion_window(uuid,uuid,integer)', 'execute') then
    raise exception 'Reply window is restricted to the workspace and service role';
  end if;
end $$;

rollback;
