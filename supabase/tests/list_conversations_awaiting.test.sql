-- [#508] The inbox filter for threads nobody has answered.
--
-- The bug this replaces is subtle and worth stating: web linked "5 leads
-- nobody answered" to `/inbox?status=new`, and NOTHING moves a conversation
-- off `new` when the crew replies. So that filter meant "nobody re-filed this",
-- and a crew that answers every lead while never touching the status dropdown
-- saw all of them under it.
--
-- `awaiting_reply_since` is the #388 lead clock, trigger-maintained: set on the
-- first inbound of a new thread, cleared by a human outbound. These assertions
-- are all about the difference between the two.
--
-- One transaction, rolled back. Fixtures use a 'c8' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('c8000000-0000-4000-8000-00000000000a'::uuid, 'awaiting-owner@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('c8000000-0000-4000-8000-0000000000c1'::uuid, 'Awaiting Co',
   'c8000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());

insert into public.company_members (company_id, user_id, role)
values ('c8000000-0000-4000-8000-0000000000c1'::uuid,
        'c8000000-0000-4000-8000-00000000000a'::uuid, 'owner');

insert into public.phone_numbers
  (id, company_id, number_e164, status, provisioning_key, country)
values
  ('c8000000-0000-4000-8000-0000000000b1'::uuid,
   'c8000000-0000-4000-8000-0000000000c1'::uuid, '+14155550508', 'active',
   'awaiting-1', 'US');

-- Two contacts, two threads. Both END in status 'new', because nothing moves a
-- conversation off it when somebody replies — which is the entire point.
insert into public.contacts (id, company_id, phone_e164) values
  ('c8000000-0000-4000-8000-0000000000d1'::uuid,
   'c8000000-0000-4000-8000-0000000000c1'::uuid, '+14155559001'),
  ('c8000000-0000-4000-8000-0000000000d2'::uuid,
   'c8000000-0000-4000-8000-0000000000c1'::uuid, '+14155559002');

insert into public.conversations
  (id, company_id, contact_id, phone_number_id, status)
values
  ('c8000000-0000-4000-8000-0000000000e1'::uuid,
   'c8000000-0000-4000-8000-0000000000c1'::uuid,
   'c8000000-0000-4000-8000-0000000000d1'::uuid,
   'c8000000-0000-4000-8000-0000000000b1'::uuid, 'new'),
  ('c8000000-0000-4000-8000-0000000000e2'::uuid,
   'c8000000-0000-4000-8000-0000000000c1'::uuid,
   'c8000000-0000-4000-8000-0000000000d2'::uuid,
   'c8000000-0000-4000-8000-0000000000b1'::uuid, 'new');

-- Both customers text in. The trigger starts a clock on each.
insert into public.messages
  (company_id, conversation_id, direction, status, body)
values
  ('c8000000-0000-4000-8000-0000000000c1'::uuid,
   'c8000000-0000-4000-8000-0000000000e1'::uuid, 'inbound', 'received',
   'do you do emergency callouts'),
  ('c8000000-0000-4000-8000-0000000000c1'::uuid,
   'c8000000-0000-4000-8000-0000000000e2'::uuid, 'inbound', 'received',
   'quote for a new boiler please');

-- The crew answers ONE of them. That clears its clock and leaves its status
-- exactly where it was.
insert into public.messages
  (company_id, conversation_id, direction, status, body, sent_by_user_id)
values
  ('c8000000-0000-4000-8000-0000000000c1'::uuid,
   'c8000000-0000-4000-8000-0000000000e2'::uuid, 'outbound', 'delivered',
   'yes, can we come Thursday?',
   'c8000000-0000-4000-8000-00000000000a'::uuid);

do $$
declare
  v_ids uuid[];
begin
  -- THE PREMISE, asserted rather than assumed. Both threads are still 'new'
  -- after one of them was answered, so `status=new` cannot tell them apart and
  -- the old link sent the reader to a list containing both.
  if (select count(*) from public.conversations
       where company_id = 'c8000000-0000-4000-8000-0000000000c1'::uuid
         and status = 'new') is distinct from 2 then
    raise exception 'replying should not change status — that is the whole bug';
  end if;

  -- awaiting=only: the unanswered one, and only it.
  select array_agg((row->>'id')::uuid) into v_ids
    from public.api_list_conversations(
      'c8000000-0000-4000-8000-0000000000c1'::uuid,
      'c8000000-0000-4000-8000-00000000000a'::uuid,
      50, null, null, null, false, false, null, null, null, null, null,
      'all', 'only'
    ) row;

  if not ('c8000000-0000-4000-8000-0000000000e1'::uuid = any(v_ids)) then
    raise exception 'the unanswered thread must be in the awaiting list';
  end if;
  if 'c8000000-0000-4000-8000-0000000000e2'::uuid = any(v_ids) then
    raise exception
      'an answered thread must NOT be in the awaiting list, whatever its status';
  end if;

  -- awaiting=exclude: the mirror, so the vocabulary matches p_pinned/p_snoozed.
  select array_agg((row->>'id')::uuid) into v_ids
    from public.api_list_conversations(
      'c8000000-0000-4000-8000-0000000000c1'::uuid,
      'c8000000-0000-4000-8000-00000000000a'::uuid,
      50, null, null, null, false, false, null, null, null, null, null,
      'all', 'exclude'
    ) row;
  if 'c8000000-0000-4000-8000-0000000000e1'::uuid = any(v_ids) then
    raise exception 'exclude must drop the unanswered thread';
  end if;
  if not ('c8000000-0000-4000-8000-0000000000e2'::uuid = any(v_ids)) then
    raise exception 'exclude must keep the answered thread';
  end if;

  -- Unset means NO filter, unlike p_snoozed's 'exclude' default: the ordinary
  -- inbox shows answered and unanswered alike, and only a reader who came from
  -- the response-time card is asking the narrower question.
  select array_agg((row->>'id')::uuid) into v_ids
    from public.api_list_conversations(
      'c8000000-0000-4000-8000-0000000000c1'::uuid,
      'c8000000-0000-4000-8000-00000000000a'::uuid,
      50, null, null, null, false, false, null, null, null, null, null,
      'all', null
    ) row;
  if array_length(v_ids, 1) is distinct from 2 then
    raise exception 'an unset filter must not narrow the inbox, got %',
      array_length(v_ids, 1);
  end if;

  raise notice 'awaiting filter: all assertions passed';
end $$;

rollback;
