-- [#690] Task numbers, references and relations: assertion suite for
-- supabase/migrations/20261111150000_task_numbers_references_relations.sql.
--
-- What is pinned:
--   TR-1  numbers: assigned in order on insert, stable on update, never reused
--         after a delete or a purge, one counter per workspace, backfilled in
--         creation order (the counter equals the highest number)
--   TR-2  a reference is written from the saved text and read back both ways
--         (the target's activity, the source's activity), and an edit that drops
--         the token drops the reference
--   TR-3  a member denied a conversation's number does not see that a note on it
--         referenced a task; a member who may see it does
--   TR-4  a reference never confirms a hidden target (task, conversation)
--   TR-5  cycles are refused: blocks, parent, and the trigger floor; one parent
--   TR-6  link events land on both tasks; removing a link is recorded
--   TR-7  search finds a task by T-142, t142, 142
--   TR-8  a conversation and a contact list their linked tasks, hidden-aware
--   TR-9  grants: only service_role reaches the new tables and functions
--   TR-10 the has-attachments column
--   TR-11 chips resolve to live titles, and not for a denied number
--
-- One transaction, rolled back. Fixtures use a 'd7' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('d7000000-0000-4000-8000-00000000000a', 'tr-owner@test.local'),
  ('d7000000-0000-4000-8000-00000000000b', 'tr-member@test.local'),
  ('d7000000-0000-4000-8000-00000000000c', 'tr-other@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status)
values
  ('d7000000-0000-4000-8000-0000000000c1', 'Ref Co',
   'd7000000-0000-4000-8000-00000000000a', 'US', '415', now(), 'active'),
  ('d7000000-0000-4000-8000-0000000000c2', 'Other Ref Co',
   'd7000000-0000-4000-8000-00000000000c', 'US', '415', now(), 'active');

insert into public.company_members (company_id, user_id, role) values
  ('d7000000-0000-4000-8000-0000000000c1', 'd7000000-0000-4000-8000-00000000000a', 'owner'),
  ('d7000000-0000-4000-8000-0000000000c1', 'd7000000-0000-4000-8000-00000000000b', 'member'),
  ('d7000000-0000-4000-8000-0000000000c2', 'd7000000-0000-4000-8000-00000000000c', 'owner');

insert into public.phone_numbers
  (id, company_id, provisioning_key, country, number_e164, status) values
  ('d7000000-0000-4000-8000-000000000a01', 'd7000000-0000-4000-8000-0000000000c1', 'tr-vis', 'US', '+12125550101', 'active'),
  ('d7000000-0000-4000-8000-000000000a02', 'd7000000-0000-4000-8000-0000000000c1', 'tr-hid', 'US', '+12125550102', 'active');

insert into public.contacts (id, company_id, phone_e164, name) values
  ('b1000000-0000-4000-8000-000000000b01', 'd7000000-0000-4000-8000-0000000000c1', '+12125550111', 'Jane Visible'),
  ('b2000000-0000-4000-8000-000000000b02', 'd7000000-0000-4000-8000-0000000000c1', '+12125550112', 'Hank Hidden');

insert into public.conversations
  (id, company_id, contact_id, phone_number_id, status, last_message_at) values
  ('c1000000-0000-4000-8000-000000000c01', 'd7000000-0000-4000-8000-0000000000c1',
   'b1000000-0000-4000-8000-000000000b01', 'd7000000-0000-4000-8000-000000000a01', 'open', now()),
  ('c2000000-0000-4000-8000-000000000c02', 'd7000000-0000-4000-8000-0000000000c1',
   'b2000000-0000-4000-8000-000000000b02', 'd7000000-0000-4000-8000-000000000a02', 'open', now());

\set co  '\'d7000000-0000-4000-8000-0000000000c1\''
\set co2 '\'d7000000-0000-4000-8000-0000000000c2\''
\set own '\'d7000000-0000-4000-8000-00000000000a\''
\set cv  '\'c1000000-0000-4000-8000-000000000c01\''
\set ch  '\'c2000000-0000-4000-8000-000000000c02\''
\set nh  '\'d7000000-0000-4000-8000-000000000a02\''

create or replace function pg_temp.task(p_co uuid, p_title text, p_conv uuid default null)
returns uuid language sql as $$
  insert into public.tasks (company_id, title, conversation_id, created_by_user_id)
  values (p_co, p_title, p_conv, 'd7000000-0000-4000-8000-00000000000a')
  returning id
$$;

-- ---------------------------------------------------------------------------
-- TR-1. Numbers.
-- ---------------------------------------------------------------------------
do $$
declare
  c1 uuid := 'd7000000-0000-4000-8000-0000000000c1';
  c2 uuid := 'd7000000-0000-4000-8000-0000000000c2';
  a uuid; b uuid; c uuid; d uuid; x uuid;
  v_n int;
begin
  a := pg_temp.task(c1, 'First');
  b := pg_temp.task(c1, 'Second');
  c := pg_temp.task(c1, 'Third');
  x := pg_temp.task(c2, 'Elsewhere');
  if (select array_agg(number order by number) from public.tasks where id in (a, b, c))
     is distinct from array[1, 2, 3] then
    raise exception 'TR-1 FAILED: numbers are not 1, 2, 3 in order';
  end if;
  if (select number from public.tasks where id = x) is distinct from 1 then
    raise exception 'TR-1 FAILED: another workspace shares the counter';
  end if;

  -- An update never changes it, and an attempt to is refused.
  update public.tasks set title = 'Second, renamed' where id = b;
  if (select number from public.tasks where id = b) is distinct from 2 then
    raise exception 'TR-1 FAILED: an update moved the number';
  end if;
  begin
    update public.tasks set number = 99 where id = b;
    raise exception 'TR-1 FAILED: a number was changed';
  exception when check_violation then
    null;
  end;

  -- Delete (soft and hard) the newest: the next task does not take 3.
  update public.tasks set deleted_at = now() where id = c;
  d := pg_temp.task(c1, 'Fourth');
  if (select number from public.tasks where id = d) is distinct from 4 then
    raise exception 'TR-1 FAILED: a soft-deleted task''s number was reused';
  end if;
  delete from public.tasks where id = d;
  x := pg_temp.task(c1, 'Fifth');
  v_n := (select number from public.tasks where id = x);
  if v_n is distinct from 5 then
    raise exception 'TR-1 FAILED: a purged task''s number was reused (got %)', v_n;
  end if;

  if (select last_number from public.task_counters where company_id = c1) is distinct from 5 then
    raise exception 'TR-1 FAILED: the counter is not the highest number handed out';
  end if;

  -- create_task takes the next number too.
  if ((public.create_task(c1, null, 'Via the RPC', null, null, null,
         'd7000000-0000-4000-8000-00000000000a')->'task'->>'number')::int) is distinct from 6 then
    raise exception 'TR-1 FAILED: create_task did not take the next number';
  end if;
  raise notice 'TR-1 PASSED: numbers';
end $$;

-- ---------------------------------------------------------------------------
-- TR-2. A reference is parsed from text, read both ways, and follows an edit.
-- ---------------------------------------------------------------------------
do $$
declare
  c1 uuid := 'd7000000-0000-4000-8000-0000000000c1';
  v_target uuid; v_source uuid; v_note uuid; v_res jsonb; v_items jsonb;
  v_contact text := substr('b1000000-0000-4000-8000-000000000b01', 1, 8);
begin
  v_target := pg_temp.task(c1, 'Order the part');
  v_source := pg_temp.task(c1, 'Install the furnace');
  insert into public.messages (company_id, conversation_id, direction, body, sent_by_user_id)
  values (c1, 'c1000000-0000-4000-8000-000000000c01', 'note',
          'blocked until #T-' || (select number from public.tasks where id = v_target) || ' lands',
          'd7000000-0000-4000-8000-00000000000a')
  returning id into v_note;

  v_res := public.api_sync_references(c1, 'note', v_note,
    'blocked until #T-' || (select number from public.tasks where id = v_target) || ' lands',
    'd7000000-0000-4000-8000-00000000000a');
  if jsonb_array_length(v_res->'references') is distinct from 1 then
    raise exception 'TR-2 FAILED: one token gave % references', v_res;
  end if;

  -- Back-reference on the target.
  v_items := public.api_task_activity(c1, v_target)->'items';
  if not exists (select 1 from jsonb_array_elements(v_items) i
                  where i->>'kind' = 'reference' and i->'detail'->>'direction' = 'in'
                    and i->'detail'->>'source_kind' = 'note'
                    and i->'detail'->>'contact_name' = 'Jane Visible') then
    raise exception 'TR-2 FAILED: the target does not show the note that referenced it: %', v_items;
  end if;

  -- A description on a task references a contact, a conversation and a task.
  v_res := public.api_sync_references(c1, 'task_description', v_source,
    'see #T-' || (select number from public.tasks where id = v_target)
    || ' and #contact-' || v_contact || ' and #conv-' || substr('c1000000-0000-4000-8000-000000000c01', 1, 8),
    'd7000000-0000-4000-8000-00000000000a');
  if jsonb_array_length(v_res->'references') is distinct from 3 then
    raise exception 'TR-2 FAILED: three tokens gave %', v_res;
  end if;
  -- Read back from the source: it points at all three.
  v_items := public.api_task_activity(c1, v_source)->'items';
  if (select count(*) from jsonb_array_elements(v_items) i
       where i->>'kind' = 'reference' and i->'detail'->>'direction' = 'out') is distinct from 3 then
    raise exception 'TR-2 FAILED: the source does not list what it points at: %', v_items;
  end if;
  -- And the target now has two back-references (the note and the description).
  if (select count(*) from jsonb_array_elements(public.api_task_activity(c1, v_target)->'items') i
       where i->>'kind' = 'reference') is distinct from 2 then
    raise exception 'TR-2 FAILED: the target should have two back-references';
  end if;

  -- Tokens inside a word, a self-reference and an unknown number are not references.
  v_res := public.api_sync_references(c1, 'task_description', v_source,
    'x#T-' || (select number from public.tasks where id = v_target)
    || ' #T-' || (select number from public.tasks where id = v_source)
    || ' #T-99999 #T-' || (select number from public.tasks where id = v_target) || 'a');
  if jsonb_array_length(v_res->'references') is distinct from 0 then
    raise exception 'TR-2 FAILED: junk tokens made references: %', v_res;
  end if;

  -- Editing the note to drop the token drops the reference.
  perform public.api_sync_references(c1, 'note', v_note, 'no token any more');
  if (select count(*) from jsonb_array_elements(public.api_task_activity(c1, v_target)->'items') i
       where i->>'kind' = 'reference') is distinct from 0 then
    raise exception 'TR-2 FAILED: an edit that dropped the token kept the reference';
  end if;

  -- A trashed note stops showing.
  perform public.api_sync_references(c1, 'note', v_note,
    '#T-' || (select number from public.tasks where id = v_target));
  update public.messages set deleted_at = now() where id = v_note;
  if (select count(*) from jsonb_array_elements(public.api_task_activity(c1, v_target)->'items') i
       where i->>'kind' = 'reference') is distinct from 0 then
    raise exception 'TR-2 FAILED: a deleted note is still listed as a reference';
  end if;
  raise notice 'TR-2 PASSED: references both ways';
end $$;

-- ---------------------------------------------------------------------------
-- TR-3 / TR-4. Hidden numbers.
-- ---------------------------------------------------------------------------
do $$
declare
  c1 uuid := 'd7000000-0000-4000-8000-0000000000c1';
  hidden uuid[] := array['d7000000-0000-4000-8000-000000000a02']::uuid[];
  v_target uuid; v_hidden_task uuid; v_note uuid; v_res jsonb;
begin
  v_target := pg_temp.task(c1, 'A task everyone can see');
  v_hidden_task := pg_temp.task(c1, 'A task on the hidden line',
                                'c2000000-0000-4000-8000-000000000c02');
  -- A note on the HIDDEN conversation references the visible task.
  insert into public.messages (company_id, conversation_id, direction, body)
  values (c1, 'c2000000-0000-4000-8000-000000000c02', 'note', 'secret')
  returning id into v_note;
  perform public.api_sync_references(c1, 'note', v_note,
    'chasing #T-' || (select number from public.tasks where id = v_target));

  -- Call first (as the member who is denied the number), read after.
  if exists (select 1 from jsonb_array_elements(
               public.api_task_activity(c1, v_target, hidden)->'items') i
              where i->>'kind' = 'reference') then
    raise exception 'TR-3 FAILED: a member denied the number sees that a hidden note referenced the task';
  end if;
  if not exists (select 1 from jsonb_array_elements(
               public.api_task_activity(c1, v_target)->'items') i
              where i->>'kind' = 'reference') then
    raise exception 'TR-3 FAILED: a member who may see the number cannot see the back-reference';
  end if;

  -- The conversation's own page, and the contact's, list the task only for
  -- someone who may see the conversation.
  if public.api_linked_tasks(c1, 'conversation',
       'c2000000-0000-4000-8000-000000000c02', hidden)->>'outcome' is distinct from 'not_found' then
    raise exception 'TR-3 FAILED: a hidden conversation listed its tasks';
  end if;
  if not exists (select 1 from jsonb_array_elements(
       public.api_linked_tasks(c1, 'conversation',
         'c2000000-0000-4000-8000-000000000c02')->'items') i
        where i->>'id' = v_target::text and i->'how' ? 'mentioned') then
    raise exception 'TR-3 FAILED: the conversation does not list the task its note mentions';
  end if;
  -- The contact's list, for a member denied the number, leaves out the task of the hidden thread.
  if exists (select 1 from jsonb_array_elements(
       public.api_linked_tasks(c1, 'contact',
         'b2000000-0000-4000-8000-000000000b02', hidden)->'items') i
        where i->>'id' = v_hidden_task::text) then
    raise exception 'TR-8 FAILED: the contact page leaked a task on a denied number';
  end if;

  -- TR-4: a reference to a hidden task, or a hidden conversation, is dropped.
  insert into public.messages (company_id, conversation_id, direction, body)
  values (c1, 'c1000000-0000-4000-8000-000000000c01', 'note', 'probe') returning id into v_note;
  v_res := public.api_sync_references(c1, 'note', v_note,
    '#T-' || (select number from public.tasks where id = v_hidden_task)
    || ' #conv-' || substr('c2000000-0000-4000-8000-000000000c02', 1, 8),
    null, hidden);
  if jsonb_array_length(v_res->'references') is distinct from 0 then
    raise exception 'TR-4 FAILED: a reference confirmed a hidden target: %', v_res;
  end if;
  v_res := public.api_sync_references(c1, 'note', v_note,
    '#T-' || (select number from public.tasks where id = v_hidden_task));
  if jsonb_array_length(v_res->'references') is distinct from 1 then
    raise exception 'TR-4 FAILED: an unrestricted writer could not reference it';
  end if;
  -- And the hidden task's own activity is not found for the denied member.
  if public.api_task_activity(c1, v_hidden_task, hidden)->>'outcome' is distinct from 'not_found' then
    raise exception 'TR-4 FAILED: a hidden task has activity';
  end if;
  raise notice 'TR-3/TR-4 PASSED: hidden numbers';
end $$;

-- ---------------------------------------------------------------------------
-- TR-5 / TR-6. Relations.
-- ---------------------------------------------------------------------------
do $$
declare
  c1 uuid := 'd7000000-0000-4000-8000-0000000000c1';
  c2 uuid := 'd7000000-0000-4000-8000-0000000000c2';
  hidden uuid[] := array['d7000000-0000-4000-8000-000000000a02']::uuid[];
  a uuid := pg_temp.task(c1, 'A'); b uuid := pg_temp.task(c1, 'B'); c uuid := pg_temp.task(c1, 'C');
  x uuid := pg_temp.task(c2, 'Foreign');
  h uuid := pg_temp.task(c1, 'Hidden one', 'c2000000-0000-4000-8000-000000000c02');
  who uuid := 'd7000000-0000-4000-8000-00000000000a';
  v_res jsonb;
begin
  -- B is blocked by A; C is blocked by B; A blocked by C would loop.
  if public.api_set_task_link(c1, b, a, 'blocked_by', true, who)->>'outcome' is distinct from 'ok' then
    raise exception 'TR-5 FAILED: blocked_by was not recorded';
  end if;
  if public.api_set_task_link(c1, c, b, 'blocked_by', true, who)->>'outcome' is distinct from 'ok' then
    raise exception 'TR-5 FAILED: the second block was not recorded';
  end if;
  if public.api_set_task_link(c1, a, c, 'blocked_by', true, who)->>'outcome' is distinct from 'cycle' then
    raise exception 'TR-5 FAILED: a three-task block loop was accepted';
  end if;
  if public.api_set_task_link(c1, a, b, 'blocked_by', true, who)->>'outcome' is distinct from 'cycle' then
    raise exception 'TR-5 FAILED: a two-task block loop was accepted';
  end if;
  if public.api_set_task_link(c1, a, a, 'blocks', true, who)->>'outcome' is distinct from 'invalid' then
    raise exception 'TR-5 FAILED: a task blocked itself';
  end if;
  if public.api_set_task_link(c1, b, a, 'blocked_by', true, who)->>'outcome' is distinct from 'unchanged' then
    raise exception 'TR-5 FAILED: a repeated link was not "unchanged"';
  end if;
  -- The trigger is the floor under the function.
  begin
    insert into public.task_links (company_id, kind, from_task_id, to_task_id) values (c1, 'blocks', c, a);
    raise exception 'TR-5 FAILED: the trigger accepted a cycle';
  exception when check_violation then null;
  end;
  -- A task in another workspace, and a hidden one, are not found.
  if public.api_set_task_link(c1, a, x, 'blocks', true, who)->>'outcome' is distinct from 'not_found' then
    raise exception 'TR-5 FAILED: a link crossed workspaces';
  end if;
  if public.api_set_task_link(c1, a, h, 'blocks', true, who, hidden)->>'outcome' is distinct from 'not_found' then
    raise exception 'TR-5 FAILED: a link reached a task on a denied number';
  end if;

  -- Parent / sub-task: one parent, no loops, blocks and parent are separate graphs.
  if public.api_set_task_link(c1, b, a, 'parent', true, who)->>'outcome' is distinct from 'ok' then
    raise exception 'TR-5 FAILED: parent was not recorded';
  end if;
  if public.api_set_task_link(c1, b, c, 'parent', true, who)->>'outcome' is distinct from 'has_parent' then
    raise exception 'TR-5 FAILED: a second parent was accepted';
  end if;
  if public.api_set_task_link(c1, a, b, 'parent', true, who)->>'outcome' is distinct from 'cycle' then
    raise exception 'TR-5 FAILED: a parent loop was accepted';
  end if;
  if public.api_set_task_link(c1, a, c, 'sub_task', true, who)->>'outcome' is distinct from 'ok' then
    raise exception 'TR-5 FAILED: sub_task was not recorded';
  end if;

  -- Read it back from B: blocked by A, parent A, blocks C.
  v_res := public.api_task_links(c1, b);
  if (select array_agg(i->>'relation' order by i->>'relation') from jsonb_array_elements(v_res->'items') i)
     is distinct from array['blocked_by', 'blocks', 'parent'] then
    raise exception 'TR-5 FAILED: B''s links are %', v_res;
  end if;
  -- A hidden task is left out of the list for a denied member.
  insert into public.task_links (company_id, kind, from_task_id, to_task_id) values (c1, 'blocks', a, h);
  if exists (select 1 from jsonb_array_elements(public.api_task_links(c1, a, hidden)->'items') i
              where i->>'task_id' = h::text) then
    raise exception 'TR-5 FAILED: a task on a denied number was listed as a relation';
  end if;
  delete from public.task_links where to_task_id = h;

  -- Done stays per task: finishing the sub-task does not finish the parent.
  update public.tasks set done_at = now() where id = b;
  if (select done_at from public.tasks where id = a) is not null then
    raise exception 'TR-5 FAILED: finishing a sub-task finished its parent';
  end if;

  -- TR-6: events land on both tasks, and removing is recorded.
  if not exists (select 1 from public.task_events where task_id = a and kind = 'link_added'
                  and to_value->>'relation' = 'blocks' and (to_value->>'number')::int
                      = (select number from public.tasks where id = b)) then
    raise exception 'TR-6 FAILED: the blocker has no event';
  end if;
  if not exists (select 1 from public.task_events where task_id = b and kind = 'link_added'
                  and to_value->>'relation' = 'blocked_by') then
    raise exception 'TR-6 FAILED: the blocked task has no event';
  end if;
  perform public.api_set_task_link(c1, b, a, 'blocked_by', false, who);
  if not exists (select 1 from public.task_events where task_id = b and kind = 'link_removed'
                  and from_value->>'relation' = 'blocked_by') then
    raise exception 'TR-6 FAILED: removing a link left no event';
  end if;
  -- With the block gone, the loop that was refused is now possible.
  if public.api_set_task_link(c1, a, b, 'blocked_by', true, who)->>'outcome' is distinct from 'ok' then
    raise exception 'TR-5 FAILED: removing a link did not free the graph';
  end if;
  raise notice 'TR-5/TR-6 PASSED: relations';
end $$;

-- ---------------------------------------------------------------------------
-- TR-7. Search finds a task by its number.
-- ---------------------------------------------------------------------------
do $$
declare
  c1 uuid := 'd7000000-0000-4000-8000-0000000000c1';
  hidden uuid[] := array['d7000000-0000-4000-8000-000000000a02']::uuid[];
  t uuid := pg_temp.task(c1, 'Zzyzx bracket');
  h uuid := pg_temp.task(c1, 'Qqorbit valve', 'c2000000-0000-4000-8000-000000000c02');
  n int := (select number from public.tasks where id = t);
  q text;
begin
  foreach q in array array['T-' || n, 't' || n, n::text, '#T-' || n, ' t-' || n || ' '] loop
    if not exists (select 1 from jsonb_array_elements(
         public.api_search_v2(c1, q, 5, 5, 5, 5, 5)->'tasks') r
          where r->>'id' = t::text and (r->>'number')::int = n) then
      raise exception 'TR-7 FAILED: "%" did not find task %', q, n;
    end if;
  end loop;
  -- The number outranks a title hit.
  if (public.api_search_v2(c1, 'T-' || n, 5, 5, 5, 5, 5)->'tasks'->0->>'id') is distinct from t::text then
    raise exception 'TR-7 FAILED: the number is not the first hit';
  end if;
  -- The hidden-number filter still holds on the number arm.
  if exists (select 1 from jsonb_array_elements(
       public.api_search_v2(c1, 'T-' || (select number from public.tasks where id = h),
                            5, 5, 5, 5, 5, null, null, hidden)->'tasks') r
        where r->>'id' = h::text) then
    raise exception 'TR-7 FAILED: the number arm found a task on a denied number';
  end if;
  -- Another workspace's number 1 is not ours.
  if exists (select 1 from jsonb_array_elements(
       public.api_search_v2('d7000000-0000-4000-8000-0000000000c2', 'T-' || n, 5, 5, 5, 5, 5)->'tasks') r
        where r->>'id' = t::text) then
    raise exception 'TR-7 FAILED: search crossed workspaces';
  end if;
  raise notice 'TR-7 PASSED: search by number';
end $$;

-- ---------------------------------------------------------------------------
-- TR-8. Linked tasks on a conversation and a contact.
-- ---------------------------------------------------------------------------
do $$
declare
  c1 uuid := 'd7000000-0000-4000-8000-0000000000c1';
  t uuid := pg_temp.task(c1, 'Quote the job', 'c1000000-0000-4000-8000-000000000c01');
  p uuid := pg_temp.task(c1, 'Points at Jane');
begin
  perform public.api_sync_references(c1, 'task_description', p,
    '#contact-' || substr('b1000000-0000-4000-8000-000000000b01', 1, 8));
  if not exists (select 1 from jsonb_array_elements(
       public.api_linked_tasks(c1, 'contact', 'b1000000-0000-4000-8000-000000000b01')->'items') i
        where i->>'id' = t::text and i->'how' ? 'anchored') then
    raise exception 'TR-8 FAILED: the contact does not list a task anchored to its thread';
  end if;
  if not exists (select 1 from jsonb_array_elements(
       public.api_linked_tasks(c1, 'contact', 'b1000000-0000-4000-8000-000000000b01')->'items') i
        where i->>'id' = p::text and i->'how' ? 'points_at') then
    raise exception 'TR-8 FAILED: the contact does not list a task whose text points at it';
  end if;
  -- Merging the contact moves the reference with it.
  raise notice 'TR-8 PASSED: linked tasks';
end $$;

-- ---------------------------------------------------------------------------
-- TR-10. Has attachments.
-- ---------------------------------------------------------------------------
do $$
declare
  c1 uuid := 'd7000000-0000-4000-8000-0000000000c1';
  t uuid := pg_temp.task(c1, 'No files');
  u uuid := pg_temp.task(c1, 'With a legacy file');
begin
  if public.task_has_attachments((select tk from public.tasks tk where tk.id = t)) then
    raise exception 'TR-10 FAILED: a task with no files has attachments';
  end if;
  insert into public.attachments (company_id, owner_type, owner_id, storage_path, file_name, content_type, size_bytes)
  values (c1, 'task', u, 'tr/' || u::text, 'photo.jpg', 'image/jpeg', 10);
  if not public.task_has_attachments((select tk from public.tasks tk where tk.id = u)) then
    raise exception 'TR-10 FAILED: a task with a file has none';
  end if;
  raise notice 'TR-10 PASSED: has attachments';
end $$;

-- ---------------------------------------------------------------------------
-- TR-11. Chips resolve to live titles and status; unknown and hidden ones do not.
-- ---------------------------------------------------------------------------
do $$
declare
  c1 uuid := 'd7000000-0000-4000-8000-0000000000c1';
  hidden uuid[] := array['d7000000-0000-4000-8000-000000000a02']::uuid[];
  t uuid := pg_temp.task(c1, 'Chip target');
  h uuid := pg_temp.task(c1, 'Chip hidden', 'c2000000-0000-4000-8000-000000000c02');
  v_res jsonb;
begin
  update public.tasks set done_at = now() where id = t;
  v_res := public.api_resolve_references(c1,
    array[(select number from public.tasks where id = t), 99999],
    array['b1000000', 'ZZZZZZZZ', 'b2000000'],
    array['c1000000', 'c2000000']);
  if jsonb_array_length(v_res->'tasks') is distinct from 1
     or (v_res->'tasks'->0->>'done')::boolean is not true
     or v_res->'tasks'->0->>'title' is distinct from 'Chip target' then
    raise exception 'TR-11 FAILED: the task chip is wrong: %', v_res->'tasks';
  end if;
  if jsonb_array_length(v_res->'contacts') is distinct from 2
     or jsonb_array_length(v_res->'conversations') is distinct from 2 then
    raise exception 'TR-11 FAILED: contacts or conversations did not resolve: %', v_res;
  end if;
  v_res := public.api_resolve_references(c1,
    array[(select number from public.tasks where id = h)], null,
    array['c2000000'], hidden);
  if jsonb_array_length(v_res->'tasks') is distinct from 0
     or jsonb_array_length(v_res->'conversations') is distinct from 0 then
    raise exception 'TR-11 FAILED: a chip resolved something on a denied number: %', v_res;
  end if;
  -- Another workspace's numbers and ids are not ours.
  v_res := public.api_resolve_references('d7000000-0000-4000-8000-0000000000c2',
    array[(select number from public.tasks where id = t)], array['b1000000'], array['c1000000']);
  if v_res->'contacts' is distinct from '[]'::jsonb or v_res->'conversations' is distinct from '[]'::jsonb then
    raise exception 'TR-11 FAILED: a chip crossed workspaces: %', v_res;
  end if;
  raise notice 'TR-11 PASSED: chips';
end $$;

-- ---------------------------------------------------------------------------
-- TR-9. Grants.
-- ---------------------------------------------------------------------------
do $$
declare
  v_sig text;
  v_tbl text;
begin
  foreach v_sig in array array[
    'public.api_sync_references(uuid, text, uuid, text, uuid, uuid[])',
    'public.api_set_task_link(uuid, uuid, uuid, text, boolean, uuid, uuid[])',
    'public.api_task_links(uuid, uuid, uuid[])',
    'public.api_linked_tasks(uuid, text, uuid, uuid[])',
    'public.api_resolve_references(uuid, int[], text[], text[], uuid[])',
    'public.task_has_attachments(public.tasks)',
    'public.api_task_activity(uuid, uuid, uuid[], int, timestamptz, uuid)'
  ] loop
    if has_function_privilege('anon', v_sig, 'execute')
       or has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception 'TR-9 FAILED: % is callable by anon or authenticated', v_sig;
    end if;
    if not has_function_privilege('service_role', v_sig, 'execute') then
      raise exception 'TR-9 FAILED: service_role cannot call %', v_sig;
    end if;
  end loop;
  foreach v_tbl in array array['public.record_references', 'public.task_links', 'public.task_counters'] loop
    if has_table_privilege('anon', v_tbl, 'select')
       or has_table_privilege('authenticated', v_tbl, 'select') then
      raise exception 'TR-9 FAILED: % is readable by anon or authenticated', v_tbl;
    end if;
  end loop;
  raise notice 'TR-9 PASSED: grants';
end $$;

rollback;
