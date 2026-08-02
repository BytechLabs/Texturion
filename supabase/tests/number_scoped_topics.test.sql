-- [#480] Number-scoped realtime topics — assertion suite for
-- supabase/migrations/20260730040000_number_scoped_topics.sql.
--
-- WHY THIS SUITE IS THE ONLY THING THAT WOULD NOTICE. A wrong topic is invisible
-- everywhere else. The write succeeds, the trigger returns null, no error
-- reaches any log, and the only symptom is that somebody's screen does not
-- update — or, in the direction that matters, that somebody's screen updates
-- when it should not have. Nobody files a bug about seeing too much.
--
-- `realtime.send` writes into `realtime.messages`, so the topics ARE observable
-- from SQL. Each test writes a row, then reads back which topics the trigger
-- published to.
--
-- What this pins, in order of how easily it breaks:
--   NT-1  every number-scoped event reaches BOTH topics (the expand contract)
--   NT-2  the per-number topic carries the right number, derived by join
--   NT-3  the two genuinely company-wide events are NOT number-scoped
--   NT-4  a null number falls back to the company topic alone, deliberately
--   NT-5  the access-changed signal fires, and says nothing it should not
--
-- One transaction, rolled back. Fixtures use a '7c' id prefix.

\set ON_ERROR_STOP on

begin;

-- `topics_for` below promises "in this transaction" and cannot deliver it on its
-- own: realtime.messages is a committed table, so every row any earlier work
-- published is still there. Clearing it here is what makes the docstring true,
-- and it keeps NT-1's real teeth — the assertion is set EQUALITY, so it still
-- catches an event reaching a topic it should not, including another tenant's.
-- Scoping the helper to this company would have silently dropped that (#474).
delete from realtime.messages;

insert into auth.users (id, email) values
  ('7c000000-0000-4000-8000-00000000000a'::uuid, 'nt-owner@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status)
values
  ('7c000000-0000-4000-8000-0000000000c1'::uuid, 'Topic Co',
   '7c000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(), 'active');

insert into public.company_members (company_id, user_id, role, deactivated_at)
values
  ('7c000000-0000-4000-8000-0000000000c1'::uuid,
   '7c000000-0000-4000-8000-00000000000a'::uuid, 'owner', null);

insert into public.phone_numbers
  (id, company_id, number_e164, status, country, provisioning_key)
values
  ('7c000000-0000-4000-8000-0000000000f1'::uuid,
   '7c000000-0000-4000-8000-0000000000c1'::uuid, '+14155550401', 'active', 'US', 'nt-1');

insert into public.contacts (id, company_id, phone_e164)
values
  ('7c000000-0000-4000-8000-0000000000a1'::uuid,
   '7c000000-0000-4000-8000-0000000000c1'::uuid, '+14155550501');

insert into public.conversations
  (id, company_id, contact_id, phone_number_id, status)
values
  ('7c000000-0000-4000-8000-0000000000e1'::uuid,
   '7c000000-0000-4000-8000-0000000000c1'::uuid,
   '7c000000-0000-4000-8000-0000000000a1'::uuid,
   '7c000000-0000-4000-8000-0000000000f1'::uuid, 'open');

/** The topics one event was published to, in this transaction, sorted. */
create or replace function pg_temp.topics_for(p_event text)
returns text[] language sql as $$
  select coalesce(array_agg(distinct m.topic order by m.topic), array[]::text[])
  from realtime.messages m
  where m.event = p_event;
$$;

create or replace function pg_temp.company_topic() returns text language sql as $$
  select 'company:7c000000-0000-4000-8000-0000000000c1';
$$;

create or replace function pg_temp.number_topic() returns text language sql as $$
  select 'company:7c000000-0000-4000-8000-0000000000c1:number:'
         || '7c000000-0000-4000-8000-0000000000f1';
$$;

-- ===========================================================================
-- NT-1 / NT-2. Every number-scoped event reaches BOTH topics, and the
--              per-number one carries the number the event actually belongs to.
--
-- The company send is the transition (old clients still receive everything); the
-- per-number send is the boundary. Losing either is a regression, in opposite
-- directions: losing the company one breaks realtime for a store-distributed
-- client that has not updated, and losing the per-number one means the boundary
-- was never built.
-- ===========================================================================
do $$
declare
  v_topics text[];
  -- #484 contract step: the per-number topic ALONE. Until that migration these
  -- five also went to the company topic for clients that had not adopted the
  -- per-number one, which is precisely the D85 exposure — a member denied a
  -- number could still watch its traffic. The company topic appearing here again
  -- would be that leak returning.
  v_want text[] := array[pg_temp.number_topic()];
  v_event text;
begin
  -- conversation.updated — number on NEW.
  update public.conversations set status = 'waiting'
   where id = '7c000000-0000-4000-8000-0000000000e1'::uuid;

  -- message.created + message.status — number by join (messages has no number).
  insert into public.messages
    (id, company_id, conversation_id, direction, body, status, sent_by_user_id,
     created_at)
  values
    ('7c000000-0000-4000-8000-0000000000d1'::uuid,
     '7c000000-0000-4000-8000-0000000000c1'::uuid,
     '7c000000-0000-4000-8000-0000000000e1'::uuid,
     'outbound', 'x', 'queued',
     -- messages_outbound_actor requires an actor on every outbound row.
     '7c000000-0000-4000-8000-00000000000a'::uuid,
     now());
  update public.messages set status = 'delivered'
   where id = '7c000000-0000-4000-8000-0000000000d1'::uuid;

  -- number.updated — NEW is the number itself.
  update public.phone_numbers set status = 'active'
   where id = '7c000000-0000-4000-8000-0000000000f1'::uuid;

  -- read.conversation — number rides the join the trigger already did.
  insert into public.conversation_reads (conversation_id, user_id, last_read_at)
  values ('7c000000-0000-4000-8000-0000000000e1'::uuid,
          '7c000000-0000-4000-8000-00000000000a'::uuid, now());

  foreach v_event in array array[
    'conversation.updated', 'message.created', 'message.status',
    'number.updated', 'read.conversation']
  loop
    v_topics := pg_temp.topics_for(v_event);
    if v_topics <> v_want then
      raise exception 'NT-1 FAILED: % published to % (want %)',
        v_event, v_topics, v_want;
    end if;
  end loop;

  raise notice 'NT-1/NT-2 PASSED: five number-scoped events reach the per-number '
    'topic and nothing else, with the number resolved on NEW and by join';
end $$;

-- ===========================================================================
-- NT-3. The two genuinely company-wide events are NOT number-scoped.
--
-- Scoping either would be scoping the wrong object, and it would break them
-- quietly: a 10DLC registration authorizes EVERY number, and the notifications
-- watermark is one per person across all of them. A per-number topic would
-- deliver the registration to whichever number happened to be picked and hide it
-- from the rest.
-- ===========================================================================
do $$
declare v_topics text[];
begin
  insert into public.messaging_registrations (company_id, kind, status)
  values ('7c000000-0000-4000-8000-0000000000c1'::uuid, 'brand', 'pending');

  v_topics := pg_temp.topics_for('registration.updated');
  if v_topics <> array[pg_temp.company_topic()] then
    raise exception 'NT-3 FAILED: registration.updated published to % (want the '
      'company topic only)', v_topics;
  end if;

  insert into public.notification_reads (user_id, company_id, last_seen_at)
  values ('7c000000-0000-4000-8000-00000000000a'::uuid,
          '7c000000-0000-4000-8000-0000000000c1'::uuid, now());

  v_topics := pg_temp.topics_for('read.notifications');
  if v_topics <> array[pg_temp.company_topic()] then
    raise exception 'NT-3 FAILED: read.notifications published to % (want the '
      'company topic only)', v_topics;
  end if;

  raise notice 'NT-3 PASSED: the company-wide events stayed company-wide';
end $$;

-- ===========================================================================
-- NT-4. A NULL number falls back to the company topic ALONE — deliberately.
--
-- `calls.phone_number_id` is `on delete set null`, so a call whose number was
-- deleted still fires. #480 warned that a company-topic fallback "quietly
-- reopens the leak for exactly the rows most likely to be interesting". Two
-- foreign keys answer it: `number_access.phone_number_id` is `on delete
-- CASCADE`, so when the number goes its access rules go with it. A call with a
-- null number is a call whose restriction no longer exists — there is nothing
-- left to leak, and dropping the event would lose a state update to protect
-- nothing.
--
-- This test exists so that reasoning is a decision on the record rather than an
-- accident somebody later "fixes" in the wrong direction.
-- ===========================================================================
do $$
declare v_topics text[];
begin
  insert into public.calls
    (id, company_id, phone_number_id, call_session_id, direction, state)
  values
    ('7c000000-0000-4000-8000-0000000000b1'::uuid,
     '7c000000-0000-4000-8000-0000000000c1'::uuid,
     null,                                    -- the number is gone
     'nt-session-1', 'inbound', 'ringing');

  v_topics := pg_temp.topics_for('call.updated');
  if v_topics <> array[pg_temp.company_topic()] then
    raise exception 'NT-4 FAILED: a call with no number published to % (want the '
      'company topic alone)', v_topics;
  end if;

  -- `topics_for` reports every row for an event in the whole transaction, so the
  -- null-number send above is still sitting there. Clear it, or the next
  -- assertion reads two inserts as one and cannot tell the company topic it is
  -- looking at from the one it just legitimately produced. Before the #484
  -- contract step this happened to pass — {company} then {company, number}
  -- accumulated to exactly the answer being asserted — which is how a test can
  -- be right about the product and wrong about itself. Same idiom as NT-6.
  delete from realtime.messages where event = 'call.updated';

  -- And with a number present it scopes like everything else.
  insert into public.calls
    (id, company_id, phone_number_id, call_session_id, direction, state)
  values
    ('7c000000-0000-4000-8000-0000000000b2'::uuid,
     '7c000000-0000-4000-8000-0000000000c1'::uuid,
     '7c000000-0000-4000-8000-0000000000f1'::uuid,
     'nt-session-2', 'inbound', 'ringing');

  v_topics := pg_temp.topics_for('call.updated');
  if v_topics <> array[pg_temp.number_topic()] then
    raise exception 'NT-4 FAILED: a call WITH a number published to % (want the '
      'per-number topic alone)', v_topics;
  end if;

  raise notice 'NT-4 PASSED: a null number falls back to the company topic, a '
    'real one scopes to it alone';
end $$;

-- ===========================================================================
-- NT-5. The revocation signal fires — and says nothing it should not.
--
-- Realtime authorization is a join-time handshake, re-run on a live channel only
-- when a refreshed JWT is pushed. Without this signal a revoked member keeps
-- receiving a number's events for up to an hour, which is a boundary the product
-- would believe it was enforcing and would not be.
--
-- The payload is the company id and NOTHING else. Naming the number or the
-- member would announce the shape of the restriction to everyone on the topic —
-- the opposite of the point. A client cannot tell whether it was the subject; it
-- just asks again.
-- ===========================================================================
do $$
declare
  v_topics text[];
  v_payload jsonb;
  v_keys text[];
  v_count int;
begin
  insert into public.number_access
    (company_id, phone_number_id, principal_kind, principal, level)
  values
    ('7c000000-0000-4000-8000-0000000000c1'::uuid,
     '7c000000-0000-4000-8000-0000000000f1'::uuid, 'role', 'member', 'note');

  v_topics := pg_temp.topics_for('access.changed');
  if v_topics <> array[pg_temp.company_topic()] then
    raise exception 'NT-5 FAILED: access.changed published to % (want the '
      'company topic — every member may already join it, so the announcement '
      'needs no new authorization)', v_topics;
  end if;

  select m.payload into v_payload
  from realtime.messages m where m.event = 'access.changed' limit 1;
  -- `realtime.send` injects its own 'id' into every payload, so the assertion is
  -- about what the TRIGGER put there: the company, and nothing that describes
  -- the restriction.
  select array_agg(k order by k) into v_keys
  from jsonb_object_keys(v_payload) k
  where k <> 'id';
  if v_keys <> array['company_id'] then
    raise exception 'NT-5 FAILED: the payload carries % — naming the number or '
      'the member leaks the restriction to everyone on the topic', v_keys;
  end if;
  -- Said twice on purpose: the key list could change name and still leak. These
  -- two ids are the ones that must never appear.
  if v_payload::text like '%7c000000-0000-4000-8000-0000000000f1%' then
    raise exception 'NT-5 FAILED: the payload names the number';
  end if;
  if v_payload::text like '%7c000000-0000-4000-8000-00000000000a%' then
    raise exception 'NT-5 FAILED: the payload names a member';
  end if;

  -- A revoke fires it too, not only a grant. The revoke is the case that
  -- matters: a grant that arrives late is an inconvenience, a revoke that
  -- arrives late is the boundary not holding.
  delete from public.number_access
   where company_id = '7c000000-0000-4000-8000-0000000000c1'::uuid;
  select count(*) into v_count
  from realtime.messages m where m.event = 'access.changed';
  if v_count < 2 then
    raise exception 'NT-5 FAILED: a revoke did not announce itself (% event(s))',
      v_count;
  end if;

  raise notice 'NT-5 PASSED: grant and revoke both announce, payload names only '
    'the company';
end $$;

-- ===========================================================================
-- NT-6. A NEW number is discoverable.
--
-- The hole an adversarial review found in NT-1: `number.updated` is
-- number-scoped, so after the contract step it publishes only to the topic of the
-- number it is about — which is unhearable for a number no client has joined,
-- i.e. every number that has just appeared. And `access.changed` does not fire
-- for it, because a new number has no `number_access` rows (no rules = open).
--
-- Post-contract that would mean a company's second number had realtime for
-- nobody until every client restarted, with the socket looking healthy. So a
-- phone_numbers change ALSO emits the company-wide "ask again".
-- ===========================================================================
do $$
declare v_topics text[]; v_payload jsonb; v_keys text[];
begin
  delete from realtime.messages;

  update public.phone_numbers set status = 'active'
   where id = '7c000000-0000-4000-8000-0000000000f1'::uuid;

  -- The scoped event, now on its own topic alone — which is the very thing this
  -- test exists to compensate for, and the reason the discovery signal below is
  -- not optional.
  v_topics := pg_temp.topics_for('number.updated');
  if v_topics <> array[pg_temp.number_topic()] then
    raise exception 'NT-6 FAILED: number.updated published to %', v_topics;
  end if;

  -- And the discovery signal, on the topic every member is already joined to.
  v_topics := pg_temp.topics_for('access.changed');
  if v_topics <> array[pg_temp.company_topic()] then
    raise exception 'NT-6 FAILED: a number change did not announce itself '
      'company-wide (topics %) — a new number would be unhearable', v_topics;
  end if;

  -- Same discipline as NT-5: the company id and nothing else. Naming the number
  -- would tell every member that a number they may be denied exists, which is
  -- exactly what the access-filtered list withholds.
  select m.payload into v_payload
  from realtime.messages m where m.event = 'access.changed' limit 1;
  select array_agg(k order by k) into v_keys
  from jsonb_object_keys(v_payload) k where k <> 'id';
  if v_keys <> array['company_id'] then
    raise exception 'NT-6 FAILED: the discovery payload carries %', v_keys;
  end if;
  if v_payload::text like '%7c000000-0000-4000-8000-0000000000f1%' then
    raise exception 'NT-6 FAILED: the discovery payload names the number';
  end if;

  raise notice 'NT-6 PASSED: a number change announces itself company-wide, '
    'naming only the company';
end $$;

rollback;
