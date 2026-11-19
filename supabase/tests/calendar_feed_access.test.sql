\set ON_ERROR_STOP on

begin;

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_reader uuid := gen_random_uuid();
  v_company uuid := gen_random_uuid();
  v_other_company uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_line uuid := gen_random_uuid();
  v_denied_line uuid := gen_random_uuid();
  v_contact uuid := gen_random_uuid();
  v_thread uuid := gen_random_uuid();
  v_denied_thread uuid := gen_random_uuid();
  v_trashed_thread uuid := gen_random_uuid();
  v_token text := repeat('1', 64);
  v_other_token text := repeat('2', 64);
  v_titles text[];
begin
  insert into auth.users (id, email) values
    (v_owner, 'ics-owner@test.local'), (v_reader, 'ics-reader@test.local');
  insert into public.companies (id, name, owner_user_id, country, requested_area_code, aup_accepted_at) values
    (v_company, 'Schedule access', v_owner, 'CA', '780', now()),
    (v_other_company, 'Another workspace', v_owner, 'CA', '780', now());
  insert into public.company_members (id, company_id, user_id, role) values
    (gen_random_uuid(), v_company, v_owner, 'owner'),
    (v_member, v_company, v_reader, 'member'),
    (gen_random_uuid(), v_other_company, v_owner, 'owner'),
    (gen_random_uuid(), v_other_company, v_reader, 'read_only');
  insert into public.phone_numbers (id, company_id, provisioning_key, country, number_e164, status) values
    (v_line, v_company, 'ics-allowed', 'CA', '+17805557011', 'active'),
    (v_denied_line, v_company, 'ics-denied', 'CA', '+17805557012', 'active');
  insert into public.number_access (company_id, phone_number_id, principal_kind, principal, level)
  values (v_company, v_denied_line, 'user', v_owner::text, 'text');
  insert into public.contacts (id, company_id, phone_e164, name)
  values (v_contact, v_company, '+17805558012', 'Calendar Customer');
  insert into public.conversations (id, company_id, contact_id, phone_number_id, status, closed_at, deleted_at) values
    (v_thread, v_company, v_contact, v_line, 'open', null, null),
    (v_denied_thread, v_company, v_contact, v_denied_line, 'open', null, null),
    (v_trashed_thread, v_company, v_contact, v_line, 'closed', now(), now());
  insert into public.tasks (company_id, conversation_id, title, created_by_user_id, assigned_user_id, due_at, deleted_at) values
    (v_company, v_thread, 'Allowed', v_owner, v_reader, now(), null),
    (v_company, v_denied_thread, 'Denied', v_owner, v_reader, now(), null),
    (v_company, v_trashed_thread, 'Trashed thread', v_owner, v_reader, now(), null),
    (v_company, null, 'Standalone', v_owner, v_reader, now(), null),
    (v_company, null, 'Unassigned', v_owner, null, now(), null),
    (v_company, null, 'Trashed task', v_owner, v_reader, now(), now()),
    (v_company, null, 'Out of window', v_owner, v_reader, now() - interval '100 days', null),
    (v_other_company, null, 'Other workspace', v_owner, v_reader, now(), null);

  select array_agg(t.title order by t.title) into v_titles
    from public.api_calendar_feed_tasks(v_company, v_reader, now() - interval '90 days') t;
  if v_titles is distinct from array['Allowed', 'Standalone'] then
    raise exception 'Unexpected feed task titles: %', v_titles;
  end if;

  perform public.api_mint_calendar_feed_token(v_company, v_reader, v_token);
  perform public.api_mint_calendar_feed_token(v_other_company, v_reader, v_other_token);
  if (select role from public.api_resolve_calendar_feed_token(v_token)) is distinct from 'member'
     or (select role from public.api_resolve_calendar_feed_token(v_other_token)) is distinct from 'read_only' then
    raise exception 'An active calendar feed did not return the membership role';
  end if;

  perform public.offboard_member(v_company, v_member);
  if not exists (select 1 from public.calendar_feed_tokens where token_hash = v_token and revoked_at is not null)
     or exists (select 1 from public.api_resolve_calendar_feed_token(v_token))
     or not exists (select 1 from public.api_resolve_calendar_feed_token(v_other_token))
     or public.api_mint_calendar_feed_token(v_company, v_reader, repeat('3', 64)) is not null then
    raise exception 'Offboarding failed to revoke only the departing membership calendar feed';
  end if;

  update public.company_members set deactivated_at = null where id = v_member;
  if exists (select 1 from public.api_resolve_calendar_feed_token(v_token)) then
    raise exception 'Reactivating the membership revived a revoked link';
  end if;

  perform public.close_workspace(v_other_company);
  if not exists (select 1 from public.calendar_feed_tokens where token_hash = v_other_token and revoked_at is not null)
     or exists (select 1 from public.api_resolve_calendar_feed_token(v_other_token))
     or exists (select 1 from public.api_calendar_feed_tasks(v_other_company, v_reader, '-infinity'))
     or public.api_mint_calendar_feed_token(v_other_company, v_reader, repeat('4', 64)) is not null then
    raise exception 'Workspace closure failed to revoke calendar access';
  end if;
end $$;

rollback;
