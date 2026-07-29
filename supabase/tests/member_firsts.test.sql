-- [#405] Per-member firsts — assertion suite for
-- supabase/migrations/20260730002300_member_firsts.sql.
--
-- The getting-started card derives its state from real data, which is the
-- right instinct. A MEMBER's version needs signals about THEM, and every
-- existing one is company-wide.
--
-- One transaction, rolled back. Fixtures use a 'af' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('af000000-0000-4000-8000-00000000000a'::uuid, 'firsts-owner@test.local'),
  ('af000000-0000-4000-8000-00000000000b'::uuid, 'firsts-tech@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('af000000-0000-4000-8000-0000000000c1'::uuid, 'Firsts Co',
   'af000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());

insert into public.phone_numbers
  (id, company_id, status, provisioning_key, country, number_e164)
values
  ('af000000-0000-4000-8000-0000000000b1'::uuid,
   'af000000-0000-4000-8000-0000000000c1'::uuid, 'active', 'af-key-1', 'US',
   '+14155550601');

insert into public.contacts (id, company_id, phone_e164)
values ('af000000-0000-4000-8000-0000000000e1'::uuid,
        'af000000-0000-4000-8000-0000000000c1'::uuid, '+16135556001');

insert into public.conversations (id, company_id, contact_id, phone_number_id, status)
values ('af000000-0000-4000-8000-0000000000d1'::uuid,
        'af000000-0000-4000-8000-0000000000c1'::uuid,
        'af000000-0000-4000-8000-0000000000e1'::uuid,
        'af000000-0000-4000-8000-0000000000b1'::uuid, 'open');

do $$
declare
  v_tech  uuid := 'af000000-0000-4000-8000-00000000000b'::uuid;
  v_owner uuid := 'af000000-0000-4000-8000-00000000000a'::uuid;
  v_co    uuid := 'af000000-0000-4000-8000-0000000000c1'::uuid;
  v_conv  uuid := 'af000000-0000-4000-8000-0000000000d1'::uuid;
  v_msg   uuid;
  v       jsonb;
begin
  -- A member who has done nothing yet: all three false, so the card shows.
  v := public.api_member_firsts(v_co, v_tech);
  if (v ->> 'replied')::boolean or (v ->> 'noted')::boolean
     or (v ->> 'marked_done')::boolean then
    raise exception 'a brand new member has done nothing: %', v;
  end if;

  -- ==========================================================================
  -- SOMEBODY ELSE'S WORK IS NOT YOURS.
  --
  -- The whole point of a per-member card is that it tracks THIS person. If it
  -- counted the workspace's activity it would vanish on day one for every new
  -- hire, which is exactly the bug being fixed.
  -- ==========================================================================
  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments, sent_by_user_id)
  values (v_co, v_conv, 'outbound', 'The owner replied.', 'sent', 1, v_owner);

  v := public.api_member_firsts(v_co, v_tech);
  if (v ->> 'replied')::boolean then
    raise exception 'the owner''s reply must not count for the tech: %', v;
  end if;

  -- Their own reply does count.
  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments, sent_by_user_id)
  values (v_co, v_conv, 'outbound', 'On my way.', 'sent', 1, v_tech);

  v := public.api_member_firsts(v_co, v_tech);
  if not (v ->> 'replied')::boolean then
    raise exception 'their own reply must count: %', v;
  end if;
  -- …and a reply is not a note. Confusing the two is the mistake the note item
  -- exists to teach, so the signals must not blur either.
  if (v ->> 'noted')::boolean then
    raise exception 'an outbound text is not a note: %', v;
  end if;

  insert into public.messages
    (company_id, conversation_id, direction, body, status, sent_by_user_id)
  values (v_co, v_conv, 'note', 'Gate code is round the back.', null, v_tech);

  v := public.api_member_firsts(v_co, v_tech);
  if not (v ->> 'noted')::boolean then
    raise exception 'their note must count: %', v;
  end if;

  -- Marking done is its own signal: message-derived completion (D17) is
  -- unusual and not guessable, which is why it is on the list at all.
  insert into public.messages
    (company_id, conversation_id, direction, body, status)
  values (v_co, v_conv, 'inbound', 'Are you coming today?', 'received')
  returning id into v_msg;

  v := public.api_member_firsts(v_co, v_tech);
  if (v ->> 'marked_done')::boolean then
    raise exception 'nothing is done yet: %', v;
  end if;

  update public.messages
     set done_at = now(), done_by_user_id = v_tech
   where id = v_msg;

  v := public.api_member_firsts(v_co, v_tech);
  if not (v ->> 'marked_done')::boolean then
    raise exception 'marking done must count: %', v;
  end if;

  raise notice 'member firsts (#405): all assertions passed';
end $$;

-- Service-role only: it reads one person's activity inside a workspace.
do $$
begin
  if has_function_privilege('authenticated', 'public.api_member_firsts(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'public.api_member_firsts(uuid, uuid)', 'execute') then
    raise exception 'api_member_firsts must be service_role only';
  end if;
end $$;

rollback;
