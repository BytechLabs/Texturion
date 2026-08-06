-- [#291] A customer has more than one number — assertion suite for
-- supabase/migrations/20260804120000_contact_phones.sql.
--
-- CP-3 and CP-4 are the pair that matter, and they pull in opposite
-- directions:
--
--   CP-3 — a text from a customer's landline must resolve to the customer,
--   not create a second contact. That is the duplicate #246 exists to clean
--   up, and it arrives silently: the crew sees an unknown number and a name
--   they typed yesterday, on two rows.
--
--   CP-4 — and yet it must be a SEPARATE THREAD, because a reply goes to the
--   number the thread is with. One merged thread would send the answer to
--   whichever number we stored first, and a text to the wrong line looks
--   exactly like a text that never sent.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/contact_phones.test.sql
--
-- One transaction, rolled back. Fixtures use a '9f' id prefix so the file runs
-- standalone OR after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('9f000000-0000-4000-8000-00000000000a'::uuid, 'phones-a@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('9f000000-0000-4000-8000-0000000000c1'::uuid, 'Two Line Plumbing',
   '9f000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());

insert into public.phone_numbers
  (id, company_id, provisioning_key, country, number_e164, status)
values
  ('9f000000-0000-4000-8000-0000000000f1'::uuid,
   '9f000000-0000-4000-8000-0000000000c1'::uuid,
   'phones-9f-1', 'US', '+14155550100', 'active');

-- Dave, reachable on a mobile (his contact record) and a landline.
insert into public.contacts (id, company_id, phone_e164, name)
values ('9f000000-0000-4000-8000-0000000000d1'::uuid,
        '9f000000-0000-4000-8000-0000000000c1'::uuid,
        '+12125559601', 'Dave Whitfield');

-- ---------------------------------------------------------------------------
-- CP-1: a second number, labelled, belongs to the contact.
-- ---------------------------------------------------------------------------
do $$
begin
  insert into public.contact_phones (company_id, contact_id, phone_e164, label)
  values ('9f000000-0000-4000-8000-0000000000c1'::uuid,
          '9f000000-0000-4000-8000-0000000000d1'::uuid,
          '+12125559602', 'Landline');

  if not exists (
    select 1 from public.contact_phones
     where contact_id = '9f000000-0000-4000-8000-0000000000d1'::uuid
       and phone_e164 = '+12125559602'
       and label = 'Landline'
  ) then
    raise exception 'CP-1: the second number did not round-trip';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CP-2: a number belongs to at most ONE contact per workspace.
--
-- Without this, two contacts could both claim the landline and an inbound text
-- would resolve to whichever the planner reached first — a routing decision
-- made by a query plan.
-- ---------------------------------------------------------------------------
do $$
begin
  insert into public.contacts (id, company_id, phone_e164, name)
  values ('9f000000-0000-4000-8000-0000000000d2'::uuid,
          '9f000000-0000-4000-8000-0000000000c1'::uuid,
          '+12125559603', 'Someone Else');
  begin
    insert into public.contact_phones (company_id, contact_id, phone_e164)
    values ('9f000000-0000-4000-8000-0000000000c1'::uuid,
            '9f000000-0000-4000-8000-0000000000d2'::uuid,
            '+12125559602');
    raise exception 'CP-2: two contacts both claimed the same number';
  exception
    when unique_violation then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- CP-3: a text from the landline resolves to Dave — no second contact.
--
-- THE SILENT ONE. Before this, the upsert created a fresh contact for the
-- number, and the crew saw an unknown caller next to the customer whose
-- landline they had just recorded.
-- ---------------------------------------------------------------------------
do $$
declare
  v_result jsonb;
  v_contacts int;
  v_conv_contact uuid;
begin
  v_result := public.thread_inbound_message(
    '9f000000-0000-4000-8000-0000000000c1'::uuid,
    '9f000000-0000-4000-8000-0000000000f1'::uuid,
    '+12125559602',
    'Calling about the boiler',
    'tmsg-9f-1'
  );

  select count(*) into v_contacts
    from public.contacts
   where company_id = '9f000000-0000-4000-8000-0000000000c1'::uuid
     and phone_e164 = '+12125559602';
  if v_contacts is distinct from 0 then
    raise exception 'CP-3: a second contact was created for the landline';
  end if;

  select c.contact_id into v_conv_contact
    from public.conversations c
   where c.id = (v_result->>'conversation_id')::uuid;
  if v_conv_contact is distinct from '9f000000-0000-4000-8000-0000000000d1'::uuid then
    raise exception 'CP-3: the landline text did not land on Dave (got %)', v_conv_contact;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CP-4: and it is its OWN thread, tagged with the number it is with.
--
-- A reply goes to `contact_phone_e164`. Merged into the mobile thread, the
-- answer would go to the mobile, and nobody would ever see an error.
-- ---------------------------------------------------------------------------
do $$
declare
  v_mobile jsonb;
  v_landline_conv uuid;
  v_mobile_conv uuid;
  v_with text;
begin
  -- Now the same customer texts from the MOBILE.
  v_mobile := public.thread_inbound_message(
    '9f000000-0000-4000-8000-0000000000c1'::uuid,
    '9f000000-0000-4000-8000-0000000000f1'::uuid,
    '+12125559601',
    'And the radiator',
    'tmsg-9f-2'
  );
  v_mobile_conv := (v_mobile->>'conversation_id')::uuid;

  select c.id, c.contact_phone_e164 into v_landline_conv, v_with
    from public.conversations c
   where c.company_id = '9f000000-0000-4000-8000-0000000000c1'::uuid
     and c.contact_id = '9f000000-0000-4000-8000-0000000000d1'::uuid
     and c.contact_phone_e164 = '+12125559602';

  if v_landline_conv is null then
    raise exception 'CP-4: the landline thread is not tagged with its number';
  end if;
  if v_landline_conv = v_mobile_conv then
    raise exception 'CP-4: both numbers were merged into one thread';
  end if;

  select c.contact_phone_e164 into v_with
    from public.conversations c where c.id = v_mobile_conv;
  if v_with is distinct from '+12125559601' then
    raise exception 'CP-4: the mobile thread says it is with % ', v_with;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CP-5: a second text from the landline appends to the SAME thread.
--
-- The other half of CP-4: distinct numbers are distinct threads, but one
-- number is one thread. A new conversation per message is the failure that
-- turns an inbox into a list of fragments.
-- ---------------------------------------------------------------------------
do $$
declare
  v_again jsonb;
  v_count int;
begin
  v_again := public.thread_inbound_message(
    '9f000000-0000-4000-8000-0000000000c1'::uuid,
    '9f000000-0000-4000-8000-0000000000f1'::uuid,
    '+12125559602',
    'Any update?',
    'tmsg-9f-3'
  );

  select count(*) into v_count
    from public.conversations c
   where c.company_id = '9f000000-0000-4000-8000-0000000000c1'::uuid
     and c.contact_id = '9f000000-0000-4000-8000-0000000000d1'::uuid
     and c.contact_phone_e164 = '+12125559602';
  if v_count is distinct from 1 then
    raise exception 'CP-5: % landline thread(s), expected exactly one', v_count;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CP-6: the threading invariant still holds, now including their number.
--
-- Two OPEN threads for the same four-tuple is the state the whole inbox
-- assumes cannot exist.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into public.conversations
      (company_id, contact_id, phone_number_id, contact_phone_e164, status)
    values ('9f000000-0000-4000-8000-0000000000c1'::uuid,
            '9f000000-0000-4000-8000-0000000000d1'::uuid,
            '9f000000-0000-4000-8000-0000000000f1'::uuid,
            '+12125559602', 'new');
    raise exception 'CP-6: a second open thread for the same number was allowed';
  exception
    when unique_violation then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- CP-7: an inbound text from a second number is consent, and undeletes.
--
-- A soft-deleted contact who texts from their landline is asking to be
-- talked to. Leaving `deleted_at` set would hide the thread they just started.
-- ---------------------------------------------------------------------------
do $$
declare
  v_deleted timestamptz;
  v_consent text;
begin
  update public.contacts
     set deleted_at = now(), consent_source = null, consent_at = null
   where id = '9f000000-0000-4000-8000-0000000000d1'::uuid;

  perform public.thread_inbound_message(
    '9f000000-0000-4000-8000-0000000000c1'::uuid,
    '9f000000-0000-4000-8000-0000000000f1'::uuid,
    '+12125559602',
    'Still there?',
    'tmsg-9f-4'
  );

  select deleted_at, consent_source into v_deleted, v_consent
    from public.contacts where id = '9f000000-0000-4000-8000-0000000000d1'::uuid;
  if v_deleted is not null then
    raise exception 'CP-7: a text from the landline left the contact deleted';
  end if;
  if v_consent is distinct from 'inbound_sms' then
    raise exception 'CP-7: consent was not stamped (got %)', v_consent;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CP-8: a CALL from a second number resolves to the same contact.
--
-- The SMS path is not the only door in. A migration that taught only
-- `thread_inbound_message` would leave every call from a landline creating the
-- duplicate this feature exists to prevent.
-- ---------------------------------------------------------------------------
do $$
declare
  v_result jsonb;
  v_contact uuid;
begin
  v_result := public.api_thread_call(
    '9f000000-0000-4000-8000-0000000000c1'::uuid,
    '9f000000-0000-4000-8000-0000000000f1'::uuid,
    '+12125559602',
    'call-9f-1',
    'inbound',
    0,
    true
  );

  select c.contact_id into v_contact
    from public.conversations c
   where c.id = (v_result->>'conversation_id')::uuid;
  if v_contact is distinct from '9f000000-0000-4000-8000-0000000000d1'::uuid then
    raise exception 'CP-8: a call from the landline did not land on Dave (got %)', v_contact;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CP-9: a number is stored in E.164 or not at all.
--
-- The backstop for the one comparison that matters: this column is matched
-- against a webhook's `from`, and a raw "(212) 555-9602" would never equal it.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into public.contact_phones (company_id, contact_id, phone_e164)
    values ('9f000000-0000-4000-8000-0000000000c1'::uuid,
            '9f000000-0000-4000-8000-0000000000d1'::uuid,
            '(212) 555-9604');
    raise exception 'CP-9: a non-E.164 number was accepted';
  exception
    when check_violation then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- CP-10: deleting the contact takes their other numbers with them.
-- ---------------------------------------------------------------------------
do $$
declare orphans int;
begin
  insert into public.contacts (id, company_id, phone_e164, name)
  values ('9f000000-0000-4000-8000-0000000000d3'::uuid,
          '9f000000-0000-4000-8000-0000000000c1'::uuid,
          '+12125559605', 'Gone Soon');
  insert into public.contact_phones (company_id, contact_id, phone_e164)
  values ('9f000000-0000-4000-8000-0000000000c1'::uuid,
          '9f000000-0000-4000-8000-0000000000d3'::uuid,
          '+12125559606');

  delete from public.contacts
   where id = '9f000000-0000-4000-8000-0000000000d3'::uuid;

  select count(*) into orphans
    from public.contact_phones
   where contact_id = '9f000000-0000-4000-8000-0000000000d3'::uuid;
  if orphans is distinct from 0 then
    raise exception 'CP-10: % number(s) outlived their contact', orphans;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CP-11: a conversation written without a number is with the PRIMARY one.
--
-- The column is nullable and filled by a trigger, deliberately. Every writer
-- that predates this feature — and every one nobody thought to update — means
-- "the contact's number", which is what conversations have always meant. Made
-- an assertion rather than left as a happy accident, because the alternative
-- reading (null, or the empty string) would silently route replies nowhere.
-- ---------------------------------------------------------------------------
do $$
declare v_with text;
begin
  insert into public.conversations
    (id, company_id, contact_id, phone_number_id, status)
  values ('9f000000-0000-4000-8000-0000000000e1'::uuid,
          '9f000000-0000-4000-8000-0000000000c1'::uuid,
          '9f000000-0000-4000-8000-0000000000d2'::uuid,
          '9f000000-0000-4000-8000-0000000000f1'::uuid,
          'new');

  select contact_phone_e164 into v_with
    from public.conversations
   where id = '9f000000-0000-4000-8000-0000000000e1'::uuid;
  if v_with is distinct from '+12125559603' then
    raise exception 'CP-11: a thread with no number given says % , not the primary', v_with;
  end if;
end $$;

rollback;
