-- #294 — before and after belong to a NOTE, and the database is what says so.
--
-- The route validates the two values, and this is the other half: the constraint
-- that stops a customer's inbound photo being labelled. That distinction is not
-- bookkeeping. A crew marking somebody else's message as "before" is a claim about
-- what the customer meant when they sent it, and nobody can support that claim.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('4a5b6c7d-0000-4000-8000-000000000003', 'phase-owner@example.test')
  on conflict do nothing;

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values ('4a5b6c7d-0000-4000-8000-000000000001', 'Phase Plumbing',
        '4a5b6c7d-0000-4000-8000-000000000003', 'US', '212', now());

insert into public.phone_numbers
  (id, company_id, status, provisioning_key, country, number_e164)
values (
  '4a5b6c7d-0000-4000-8000-000000000004',
  '4a5b6c7d-0000-4000-8000-000000000001',
  'active', 'wp-key', 'US', '+12125550100'
);

insert into public.contacts (id, company_id, phone_e164)
values (
  '4a5b6c7d-0000-4000-8000-000000000005',
  '4a5b6c7d-0000-4000-8000-000000000001',
  '+12125550777'
);

insert into public.conversations
  (id, company_id, contact_id, phone_number_id, status, last_message_at)
values (
  '4a5b6c7d-0000-4000-8000-000000000002',
  '4a5b6c7d-0000-4000-8000-000000000001',
  '4a5b6c7d-0000-4000-8000-000000000005',
  '4a5b6c7d-0000-4000-8000-000000000004',
  'open', now()
);

-- 1. A note may be labelled either way.
do $$
declare v_phase text; begin
  foreach v_phase in array array['before', 'after']
  loop
    insert into public.messages
      (company_id, conversation_id, direction, body, status, work_phase)
    values (
      '4a5b6c7d-0000-4000-8000-000000000001',
      '4a5b6c7d-0000-4000-8000-000000000002',
      'note', 'looked like this', null, v_phase
    );
  end loop;
end $$;

-- 2. And a note may be neither, which is the common case. A note saying the part is
--    on order is not an unlabelled before.
insert into public.messages
  (company_id, conversation_id, direction, body, status, work_phase)
values (
  '4a5b6c7d-0000-4000-8000-000000000001',
  '4a5b6c7d-0000-4000-8000-000000000002',
  'note', 'part on order', null, null
);

-- 3. A value nobody defined is refused. Without this the column accepts a typo as a
--    third category that every client then has to decide how to draw.
do $$
begin
  begin
    insert into public.messages
      (company_id, conversation_id, direction, body, status, work_phase)
    values (
      '4a5b6c7d-0000-4000-8000-000000000001',
      '4a5b6c7d-0000-4000-8000-000000000002',
      'note', 'halfway', null, 'during'
    );
    raise exception 'an undefined work phase was stored';
  exception when check_violation then
    null;
  end;
end $$;

-- 4. THE ONE THAT MATTERS. A customer's inbound message cannot be labelled at all.
do $$
begin
  begin
    insert into public.messages
      (company_id, conversation_id, direction, body, status, work_phase)
    values (
      '4a5b6c7d-0000-4000-8000-000000000001',
      '4a5b6c7d-0000-4000-8000-000000000002',
      'inbound', 'here is my broken boiler', 'received', 'before'
    );
    raise exception 'a customer message was labelled as a before';
  exception when check_violation then
    null;
  end;
end $$;

-- 5. Nor an outbound one the crew sent. Same reason: a text is not a visit record,
--    and the derived view groups by note.
--
--    `sent_by_user_id` is supplied deliberately. Without it this insert also breaks
--    messages_outbound_actor, which raises the SAME check_violation — and the test
--    would pass while proving nothing about work_phase at all.
do $$
begin
  begin
    insert into public.messages
      (company_id, conversation_id, direction, body, status, sent_by_user_id,
       work_phase)
    values (
      '4a5b6c7d-0000-4000-8000-000000000001',
      '4a5b6c7d-0000-4000-8000-000000000002',
      'outbound', 'on our way', 'queued',
      '4a5b6c7d-0000-4000-8000-000000000003', 'after'
    );
    raise exception 'an outbound text was labelled as an after';
  exception when check_violation then
    null;
  end;
end $$;

-- 5b. And the same insert WITHOUT the label succeeds, which is what proves the
--     refusal above was about the label rather than about anything else on the row.
insert into public.messages
  (company_id, conversation_id, direction, body, status, sent_by_user_id, work_phase)
values (
  '4a5b6c7d-0000-4000-8000-000000000001',
  '4a5b6c7d-0000-4000-8000-000000000002',
  'outbound', 'on our way', 'queued',
  '4a5b6c7d-0000-4000-8000-000000000003', null
);

-- 6. And a labelled note cannot be turned into a text while keeping its label — the
--    constraint holds on UPDATE, not only on INSERT.
do $$
declare v_id uuid; begin
  select id into v_id from public.messages
   where company_id = '4a5b6c7d-0000-4000-8000-000000000001'
     and work_phase = 'before'
   limit 1;
  if v_id is null then
    raise exception 'the fixture never stored a labelled note';
  end if;
  begin
    update public.messages set direction = 'outbound' where id = v_id;
    raise exception 'a labelled note became an outbound text';
  exception when check_violation then
    null;
  end;
end $$;

do $$
begin
  raise notice 'WP OK: before and after belong to a note, and only to a note';
end $$;

rollback;
