-- [#275] Bulk conversation actions — assertion suite for
-- supabase/migrations/20260730004500_bulk_conversations.sql.
--
-- This function WRITES IN BULK, which makes it the one place in the product where
-- a missing predicate is a mistake multiplied by three hundred. The assertions
-- are ordered by what they protect:
--
--   BC-1  the action enum, and specifically that there is no send
--   BC-2  the #106 deny list, on select-all AND on an explicit id list
--   BC-3  tenant isolation
--   BC-4  prior values, so a bulk undo reverts exactly what changed
--   BC-5  ids the caller named but the selection could not reach
--   BC-6  the filter means the same thing it means in the list
--   BC-7  the cap, reported rather than silently truncating
--   BC-8  argument coherence (an assign with no target must not unassign 300)
--   BC-9  a target tag or assignee from another workspace is refused (#572)
--
-- One transaction, rolled back. Fixtures use a 'bc' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                        created_at, updated_at, aud, role)
values ('bc000000-0000-4000-8000-000000000001', 'bulk@test.local', '', now(),
        now(), now(), 'authenticated', 'authenticated'),
       ('bc000000-0000-4000-8000-00000000000a', 'bulk2@test.local', '', now(),
        now(), now(), 'authenticated', 'authenticated'),
       -- #572 BC-9: a real auth user who is a member of NO workspace. Needed
       -- because the assign target must now be an active member, so the test for
       -- "a non-member is refused" needs somebody who genuinely is not one.
       ('bc000000-0000-4000-8000-00000000000c', 'bulk-stranger@test.local', '',
        now(), now(), now(), 'authenticated', 'authenticated')
on conflict (id) do nothing;

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, plan)
values ('bc000000-0000-4000-8000-000000000002', 'Bulk Test Co',
        'bc000000-0000-4000-8000-000000000001', 'US', '212', now(), 'active', 'pro'),
       ('bc000000-0000-4000-8000-00000000000b', 'Other Co',
        'bc000000-0000-4000-8000-000000000001', 'US', '213', now(), 'active', 'pro');

insert into public.company_members (company_id, user_id, role)
values ('bc000000-0000-4000-8000-000000000002',
        'bc000000-0000-4000-8000-000000000001', 'owner'),
       ('bc000000-0000-4000-8000-00000000000b',
        'bc000000-0000-4000-8000-000000000001', 'owner'),
       -- #572: BC-4 assigns a conversation to this user to check that the prior
       -- assignee is recorded for an undo. It never made them a member, and
       -- nothing required it — so the fixture was quietly relying on the missing
       -- check. Assigning to a non-member is now refused, which is the point.
       ('bc000000-0000-4000-8000-000000000002',
        'bc000000-0000-4000-8000-00000000000a', 'member');

-- Two numbers on the test company: one the actor may see, one denied (#106).
insert into public.phone_numbers
  (id, company_id, number_e164, status, provisioning_key, country)
values ('bc000000-0000-4000-8000-000000000010',
        'bc000000-0000-4000-8000-000000000002', '+12125550010', 'active',
        'bc-key-10', 'US'),
       ('bc000000-0000-4000-8000-000000000011',
        'bc000000-0000-4000-8000-000000000002', '+12125550011', 'active',
        'bc-key-11', 'US'),
       -- The other tenant needs its own number: conversations.phone_number_id is
       -- NOT NULL.
       ('bc000000-0000-4000-8000-000000000012',
        'bc000000-0000-4000-8000-00000000000b', '+12135550012', 'active',
        'bc-key-12', 'US');

-- One contact per conversation: conversations_open_uq is unique on
-- (company, number, contact) WHERE closed_at IS NULL, so two open threads cannot
-- share a contact on the same number.
insert into public.contacts (id, company_id, phone_e164, name)
values ('bc000000-0000-4000-8000-000000000020',
        'bc000000-0000-4000-8000-000000000002', '+12125559001', 'Dana Visible'),
       ('bc000000-0000-4000-8000-000000000023',
        'bc000000-0000-4000-8000-000000000002', '+12125559004', 'Ari Visible'),
       ('bc000000-0000-4000-8000-000000000024',
        'bc000000-0000-4000-8000-000000000002', '+12125559005', 'Kim Closed'),
       ('bc000000-0000-4000-8000-000000000021',
        'bc000000-0000-4000-8000-000000000002', '+12125559002', 'Sam Hidden'),
       ('bc000000-0000-4000-8000-000000000022',
        'bc000000-0000-4000-8000-00000000000b', '+12135559003', 'Other Tenant');

-- Visible: two open, one closed. Hidden: one open on the denied number.
-- status='closed' and closed_at are set together (conversations_closed_consistency).
insert into public.conversations
  (id, company_id, contact_id, phone_number_id, status, last_message_at, closed_at)
values ('bc000000-0000-4000-8000-000000000030',
        'bc000000-0000-4000-8000-000000000002',
        'bc000000-0000-4000-8000-000000000020',
        'bc000000-0000-4000-8000-000000000010', 'open', now() - interval '1 hour', null),
       ('bc000000-0000-4000-8000-000000000031',
        'bc000000-0000-4000-8000-000000000002',
        'bc000000-0000-4000-8000-000000000023',
        'bc000000-0000-4000-8000-000000000010', 'open', now() - interval '2 hours', null),
       ('bc000000-0000-4000-8000-000000000032',
        'bc000000-0000-4000-8000-000000000002',
        'bc000000-0000-4000-8000-000000000024',
        'bc000000-0000-4000-8000-000000000010', 'closed', now() - interval '3 hours', now()),
       ('bc000000-0000-4000-8000-000000000033',
        'bc000000-0000-4000-8000-000000000002',
        'bc000000-0000-4000-8000-000000000021',
        'bc000000-0000-4000-8000-000000000011', 'open', now() - interval '4 hours', null),
       ('bc000000-0000-4000-8000-000000000034',
        'bc000000-0000-4000-8000-00000000000b',
        'bc000000-0000-4000-8000-000000000022',
        'bc000000-0000-4000-8000-000000000012', 'open',
        now() - interval '5 hours', null);

-- ===========================================================================
-- BC-1. The action enum, and the one that is missing on purpose.
--
--       Multi-select plus a compose box is a mass-texting tool. #275 says the
--       constraint must be explicit in the design rather than left to whoever
--       picks up the issue, so it is enforced in SQL: an unknown action is a
--       typed rejection, not a default branch that quietly does nothing.
-- ===========================================================================
do $$
declare
  co uuid := 'bc000000-0000-4000-8000-000000000002';
  us uuid := 'bc000000-0000-4000-8000-000000000001';
  r  jsonb;
begin
  foreach r in array array[
    to_jsonb('send'::text), to_jsonb('bulk_send'::text),
    to_jsonb('message'::text), to_jsonb('delete'::text),
    to_jsonb('nonsense'::text), to_jsonb(''::text)
  ]
  loop
    if (public.api_bulk_conversations(co, us, r #>> '{}') ->> 'error')
       is distinct from 'validation_failed' then
      raise exception 'BC-1 FAILED: action % was not rejected', r #>> '{}';
    end if;
  end loop;

  if (public.api_bulk_conversations(co, us, null) ->> 'error')
     is distinct from 'validation_failed' then
    raise exception 'BC-1 FAILED: a null action was not rejected';
  end if;

  raise notice 'BC-1 PASSED: unknown actions rejected; there is no send action';
end $$;

-- ===========================================================================
-- BC-2. #106: the deny list, on BOTH selection modes.
--
--       The filter mode is the dangerous one — "everything matching" must not
--       quietly mean "including the numbers you were denied". The explicit-id
--       mode matters too: a client that sends a hidden id must not have it
--       honoured just because it asked by name.
-- ===========================================================================
do $$
declare
  co     uuid := 'bc000000-0000-4000-8000-000000000002';
  us     uuid := 'bc000000-0000-4000-8000-000000000001';
  hidden uuid := 'bc000000-0000-4000-8000-000000000011';
  conv_h uuid := 'bc000000-0000-4000-8000-000000000033';
  res    jsonb;
  ids    text[];
begin
  -- Select-all-matching, with one number denied.
  res := public.api_bulk_conversations(
    co, us, 'set_status', null, 'open', null, null, false, false, null,
    null, null, 'closed', null, array[hidden]
  );
  select array_agg(a ->> 'id') into ids
    from jsonb_array_elements(res -> 'applied') a;
  if conv_h::text = any(ids) then
    raise exception 'BC-2 FAILED: select-all reached a conversation on a denied number';
  end if;
  if (select status from public.conversations where id = conv_h) is distinct from 'open' then
    raise exception 'BC-2 FAILED: the hidden conversation was modified';
  end if;

  -- Explicit id list naming the hidden conversation.
  res := public.api_bulk_conversations(
    co, us, 'set_status', array[conv_h], null, null, null, false, false, null,
    null, null, 'closed', null, array[hidden]
  );
  if jsonb_array_length(res -> 'applied') is distinct from 0 then
    raise exception 'BC-2 FAILED: a named hidden id was applied';
  end if;
  if (res -> 'failed' -> 0 ->> 'id') is distinct from conv_h::text then
    raise exception 'BC-2 FAILED: a named hidden id was not reported as failed';
  end if;
  -- The reason must not distinguish "hidden" from "absent": a restricted member
  -- who could tell them apart would learn the row exists.
  if (res -> 'failed' -> 0 ->> 'reason') is distinct from 'not_found' then
    raise exception 'BC-2 FAILED: the reason leaks that the row exists (%)',
      res -> 'failed' -> 0 ->> 'reason';
  end if;

  raise notice 'BC-2 PASSED: the deny list holds on select-all AND on named ids';
end $$;

-- ===========================================================================
-- BC-3. Tenant isolation: another company's conversation is unreachable by id.
-- ===========================================================================
do $$
declare
  co    uuid := 'bc000000-0000-4000-8000-000000000002';
  us    uuid := 'bc000000-0000-4000-8000-000000000001';
  other uuid := 'bc000000-0000-4000-8000-000000000034';
  res   jsonb;
begin
  res := public.api_bulk_conversations(
    co, us, 'set_status', array[other], null, null, null, false, false, null,
    null, null, 'closed', null, null
  );
  if jsonb_array_length(res -> 'applied') is distinct from 0 then
    raise exception 'BC-3 FAILED: reached another tenant''s conversation';
  end if;
  if (select status from public.conversations where id = other) is distinct from 'open' then
    raise exception 'BC-3 FAILED: another tenant''s row was modified';
  end if;
  raise notice 'BC-3 PASSED: tenant isolation';
end $$;

-- ===========================================================================
-- BC-4. Prior values, so a bulk undo reverts EXACTLY what changed.
--
--       docs/UNDO-AUDIT.md §4: the undo works from a list captured before the
--       operation ran. A `previous` that reported the NEW value would make the
--       undo a no-op that looks like it worked — the worst available outcome,
--       because the user believes they recovered.
-- ===========================================================================
do $$
declare
  co  uuid := 'bc000000-0000-4000-8000-000000000002';
  us  uuid := 'bc000000-0000-4000-8000-000000000001';
  c1  uuid := 'bc000000-0000-4000-8000-000000000030';
  c3  uuid := 'bc000000-0000-4000-8000-000000000032';
  res jsonb;
  prev text;
begin
  -- These blocks share one transaction, and BC-2's select-all already closed the
  -- open rows — so this block sets up the state it asserts on rather than
  -- inheriting the fixture's.
  update public.conversations set status = 'open', closed_at = null where id = c1;
  update public.conversations set status = 'closed', closed_at = now() where id = c3;

  -- c1 is open, c3 is closed. Closing both must record DIFFERENT prior values.
  res := public.api_bulk_conversations(
    co, us, 'set_status', array[c1, c3], null, null, null, false, false, null,
    null, null, 'closed', null, null
  );
  if jsonb_array_length(res -> 'applied') is distinct from 2 then
    raise exception 'BC-4 FAILED: expected 2 applied, got %',
      jsonb_array_length(res -> 'applied');
  end if;

  select a -> 'previous' ->> 'status' into prev
    from jsonb_array_elements(res -> 'applied') a where a ->> 'id' = c1::text;
  if prev is distinct from 'open' then
    raise exception 'BC-4 FAILED: c1 previous.status = % (want open)', prev;
  end if;
  select a -> 'previous' ->> 'status' into prev
    from jsonb_array_elements(res -> 'applied') a where a ->> 'id' = c3::text;
  if prev is distinct from 'closed' then
    raise exception 'BC-4 FAILED: c3 previous.status = % (want closed — it was already closed)', prev;
  end if;

  -- Both are closed now.
  if (select count(*) from public.conversations
       where id in (c1, c3) and status = 'closed') is distinct from 2 then
    raise exception 'BC-4 FAILED: the status was not applied';
  end if;

  -- And an assign records the prior assignee, including null.
  res := public.api_bulk_conversations(
    co, us, 'assign', array[c1], null, null, null, false, false, null,
    'bc000000-0000-4000-8000-00000000000a', null, null, null, null
  );
  if (res -> 'applied' -> 0 -> 'previous' ->> 'assigned_user_id') is not null then
    raise exception 'BC-4 FAILED: previous.assigned_user_id should be null';
  end if;
  if (select assigned_user_id from public.conversations where id = c1)
     is distinct from 'bc000000-0000-4000-8000-00000000000a' then
    raise exception 'BC-4 FAILED: assign did not apply';
  end if;

  raise notice 'BC-4 PASSED: prior values are the values from BEFORE the write';
end $$;

-- ===========================================================================
-- BC-5. A tag add records whether the tag was ALREADY there.
--
--       Without this an undo would strip a tag the user had applied by hand
--       earlier, which is a bulk action destroying data it never created.
-- ===========================================================================
do $$
declare
  co  uuid := 'bc000000-0000-4000-8000-000000000002';
  us  uuid := 'bc000000-0000-4000-8000-000000000001';
  c1  uuid := 'bc000000-0000-4000-8000-000000000030';
  c2  uuid := 'bc000000-0000-4000-8000-000000000031';
  tg  uuid;
  res jsonb;
  had boolean;
begin
  insert into public.tags (company_id, name) values (co, 'bc-tag')
  returning id into tg;
  -- c1 already carries it, c2 does not.
  insert into public.conversation_tags (conversation_id, tag_id) values (c1, tg);

  res := public.api_bulk_conversations(
    co, us, 'add_tag', array[c1, c2], null, null, null, false, false, null,
    null, tg, null, null, null
  );

  select (a -> 'previous' ->> 'had_tag')::boolean into had
    from jsonb_array_elements(res -> 'applied') a where a ->> 'id' = c1::text;
  if had is distinct from true then
    raise exception 'BC-5 FAILED: c1 already had the tag but had_tag was false';
  end if;
  select (a -> 'previous' ->> 'had_tag')::boolean into had
    from jsonb_array_elements(res -> 'applied') a where a ->> 'id' = c2::text;
  if had is distinct from false then
    raise exception 'BC-5 FAILED: c2 did not have the tag but had_tag was true';
  end if;
  if (select count(*) from public.conversation_tags
       where tag_id = tg and conversation_id in (c1, c2)) is distinct from 2 then
    raise exception 'BC-5 FAILED: the tag was not added to both';
  end if;

  raise notice 'BC-5 PASSED: add_tag records what was already tagged';
end $$;

-- ===========================================================================
-- BC-6. The filter means what it means in api_list_conversations.
--
--       "Everything I am looking at" has to be the same set in both functions,
--       or select-all acts on rows the user never saw. Asserted on status here,
--       which is the filter the archive-everything case uses.
-- ===========================================================================
do $$
declare
  co  uuid := 'bc000000-0000-4000-8000-000000000002';
  us  uuid := 'bc000000-0000-4000-8000-000000000001';
  res jsonb;
  listed int;
  acted  int;
begin
  -- Reset the two rows BC-4 closed so the counts are meaningful. closed_at has
  -- to be cleared with the status (conversations_closed_consistency) — the same
  -- pairing the RPC itself has to honour on a bulk reopen.
  update public.conversations set status = 'open', closed_at = null
   where id in ('bc000000-0000-4000-8000-000000000030',
                'bc000000-0000-4000-8000-000000000032');

  select count(*)::int into listed
    from public.api_list_conversations(co, us, 1000, 'open') as row;

  res := public.api_bulk_conversations(
    co, us, 'mark_read', null, 'open', null, null, false, false, null,
    null, null, null, null, null
  );
  acted := jsonb_array_length(res -> 'applied');

  if listed is distinct from acted then
    raise exception 'BC-6 FAILED: the list shows % open, bulk acted on %', listed, acted;
  end if;
  if (res ->> 'matched')::int is distinct from listed then
    raise exception 'BC-6 FAILED: matched = % but the list shows %',
      res ->> 'matched', listed;
  end if;

  raise notice 'BC-6 PASSED: the bulk filter selects the same set the list shows (% rows)', listed;
end $$;

-- ===========================================================================
-- BC-7. The cap is reported, never a silent truncation.
-- ===========================================================================
do $$
declare
  co  uuid := 'bc000000-0000-4000-8000-000000000002';
  us  uuid := 'bc000000-0000-4000-8000-000000000001';
  res jsonb;
  cap int := public.api_bulk_conversation_cap();
begin
  -- One more than the cap, all matching. A contact each, for the same reason the
  -- base fixtures have one each.
  with made as (
    insert into public.contacts (company_id, phone_e164, name)
    select co, '+1212666' || lpad(g::text, 4, '0'), 'Bulk ' || g
      from generate_series(1, cap + 1) g
    returning id, phone_e164
  )
  insert into public.conversations
    (company_id, contact_id, phone_number_id, status, last_message_at)
  select co, made.id, 'bc000000-0000-4000-8000-000000000010', 'waiting',
         now() - (row_number() over (order by made.phone_e164) || ' minutes')::interval
    from made;

  res := public.api_bulk_conversations(
    co, us, 'set_status', null, 'waiting', null, null, false, false, null,
    null, null, 'closed', null, null
  );

  if (res ->> 'capped')::boolean is not true then
    raise exception 'BC-7 FAILED: capped was not reported';
  end if;
  if (res ->> 'matched')::int is distinct from cap + 1 then
    raise exception 'BC-7 FAILED: matched = % (want %)', res ->> 'matched', cap + 1;
  end if;
  if jsonb_array_length(res -> 'applied') is distinct from cap then
    raise exception 'BC-7 FAILED: applied % rows (want the cap, %)',
      jsonb_array_length(res -> 'applied'), cap;
  end if;

  raise notice 'BC-7 PASSED: matched % capped at %, and said so', cap + 1, cap;
end $$;

-- ===========================================================================
-- BC-8. Argument coherence: the blast-radius bugs.
--
--       An assign with no target means unassign, which is legitimate — but
--       combined with select-all-matching it silently unassigns everything on the
--       screen, and a client that omits a field should not be able to fire that.
--       Same for a status action with no status.
-- ===========================================================================
do $$
declare
  co uuid := 'bc000000-0000-4000-8000-000000000002';
  us uuid := 'bc000000-0000-4000-8000-000000000001';
  c1 uuid := 'bc000000-0000-4000-8000-000000000030';
begin
  -- assign, no target, filter mode → refused.
  if (public.api_bulk_conversations(
        co, us, 'assign', null, 'open', null, null, false, false, null,
        null, null, null, null, null) ->> 'error') is distinct from 'validation_failed' then
    raise exception 'BC-8 FAILED: an unassign-everything-matching was allowed';
  end if;
  -- assign, no target, EXPLICIT ids → allowed (a deliberate unassign).
  if (public.api_bulk_conversations(
        co, us, 'assign', array[c1], null, null, null, false, false, null,
        null, null, null, null, null) ->> 'error') is not null then
    raise exception 'BC-8 FAILED: a deliberate unassign of named rows was refused';
  end if;
  if (select assigned_user_id from public.conversations where id = c1) is not null then
    raise exception 'BC-8 FAILED: the deliberate unassign did not apply';
  end if;

  -- set_status with no/invalid target → refused.
  for i in 1..2 loop
    if (public.api_bulk_conversations(
          co, us, 'set_status', array[c1], null, null, null, false, false, null,
          null, null, case i when 1 then null else 'archived' end, null, null
        ) ->> 'error') is distinct from 'validation_failed' then
      raise exception 'BC-8 FAILED: set_status accepted a bad target (case %)', i;
    end if;
  end loop;

  -- set_spam with no target → refused (the filter param must not stand in).
  if (public.api_bulk_conversations(
        co, us, 'set_spam', array[c1], null, null, null, false, false, null,
        null, null, null, null, null) ->> 'error') is distinct from 'validation_failed' then
    raise exception 'BC-8 FAILED: set_spam accepted a missing target';
  end if;

  -- tag actions with no tag → refused.
  if (public.api_bulk_conversations(
        co, us, 'add_tag', array[c1], null, null, null, false, false, null,
        null, null, null, null, null) ->> 'error') is distinct from 'validation_failed' then
    raise exception 'BC-8 FAILED: add_tag accepted a missing tag';
  end if;

  raise notice 'BC-8 PASSED: incoherent arguments are refused before anything is written';
end $$;

-- ===========================================================================
-- BC-9 (#572). A target id from ANOTHER workspace is refused.
--
-- Both were only checked for presence, never for belonging: the route validates
-- uuid SHAPE and forwards them raw. So a member of one workspace could attach
-- another workspace's tag to their own conversations — moving that workspace's tag
-- counts, and its pipeline win rate with them (#354) — or assign a conversation to
-- somebody who is not a member at all, including a deactivated ex-teammate whose
-- real user id is visible in timeline `assigned` events.
--
-- Two of the three sibling paths already refused both (api_bulk_tasks and the
-- single-row assign), which is what made this a gap rather than a decision.
-- ===========================================================================
do $$
declare
  co        uuid := 'bc000000-0000-4000-8000-000000000002';
  other_co  uuid := 'bc000000-0000-4000-8000-00000000000b';
  us        uuid := 'bc000000-0000-4000-8000-000000000001';
  stranger  uuid := 'bc000000-0000-4000-8000-00000000000c';
  c1        uuid;
  other_tag uuid;
  own_tag   uuid;
  before_n  int;
begin
  select id into c1 from public.conversations
   where company_id = co order by id limit 1;

  -- A tag that belongs to the OTHER workspace, and one that belongs to this one.
  insert into public.tags (company_id, name) values (other_co, 'bc-foreign-tag')
    returning id into other_tag;
  insert into public.tags (company_id, name) values (co, 'bc-own-tag')
    returning id into own_tag;

  -- 1. A foreign tag is refused, and nothing is written.
  select count(*) into before_n from public.conversation_tags where tag_id = other_tag;
  if (public.api_bulk_conversations(
        co, us, 'add_tag', array[c1], null, null, null, false, false, null,
        null, other_tag, null, null, null) ->> 'error')
     is distinct from 'validation_failed' then
    raise exception 'BC-9 FAILED: add_tag accepted another workspace''s tag';
  end if;
  if (select count(*) from public.conversation_tags where tag_id = other_tag)
     is distinct from before_n then
    raise exception 'BC-9 FAILED: another workspace''s tag was attached anyway';
  end if;

  -- remove_tag takes the same argument and so needs the same refusal.
  if (public.api_bulk_conversations(
        co, us, 'remove_tag', array[c1], null, null, null, false, false, null,
        null, other_tag, null, null, null) ->> 'error')
     is distinct from 'validation_failed' then
    raise exception 'BC-9 FAILED: remove_tag accepted another workspace''s tag';
  end if;

  -- 2. This workspace's own tag still works — the check must narrow, not break.
  if (public.api_bulk_conversations(
        co, us, 'add_tag', array[c1], null, null, null, false, false, null,
        null, own_tag, null, null, null) -> 'error') is not null then
    raise exception 'BC-9 FAILED: the workspace''s own tag was refused';
  end if;

  -- 3. A non-member assignee is refused for the WHOLE call, as api_bulk_tasks
  --    does. `stranger` is a real auth user with no membership in `co`.
  if (public.api_bulk_conversations(
        co, us, 'assign', array[c1], null, null, null, false, false, null,
        stranger, null, null, null, null) ->> 'error')
     is distinct from 'not_member' then
    raise exception 'BC-9 FAILED: assigned a conversation to a non-member';
  end if;
  if (select assigned_user_id from public.conversations where id = c1)
     is not distinct from stranger then
    raise exception 'BC-9 FAILED: a non-member was written to assigned_user_id';
  end if;

  -- 4. A deactivated member is a non-member for this purpose.
  insert into public.company_members (company_id, user_id, role)
  values (co, stranger, 'member')
  on conflict (company_id, user_id) do update set deactivated_at = null;
  update public.company_members set deactivated_at = now()
   where company_id = co and user_id = stranger;

  if (public.api_bulk_conversations(
        co, us, 'assign', array[c1], null, null, null, false, false, null,
        stranger, null, null, null, null) ->> 'error')
     is distinct from 'not_member' then
    raise exception 'BC-9 FAILED: assigned to a deactivated member';
  end if;

  -- 5. And an ACTIVE member is still assignable — the check must narrow only.
  update public.company_members set deactivated_at = null
   where company_id = co and user_id = stranger;
  if (public.api_bulk_conversations(
        co, us, 'assign', array[c1], null, null, null, false, false, null,
        stranger, null, null, null, null) -> 'error') is not null then
    raise exception 'BC-9 FAILED: an active member was refused';
  end if;

  raise notice 'BC-9 PASSED: a bulk action cannot borrow another workspace''s ids';
end $$;

select 'bulk_conversations.test.sql: BC-1..BC-9 PASSED' as result;

rollback;
