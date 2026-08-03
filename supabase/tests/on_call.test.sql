-- [#244] On-call routing and escalation — assertion suite for
-- supabase/migrations/20260803140000_on_call.sql.
--
-- What is pinned here is the set of rules whose failure mode is a person
-- ASLEEP. None of these produce an error anybody sees: the wrong phone rings,
-- or no phone rings, and the first anyone knows is a customer who called a
-- competitor. That is why the overlap rule (OC-3) and the acknowledgement race
-- (OC-8) get tests rather than comments — both are silent, and both are the
-- kind of thing that looks obviously correct while being backwards.
--
-- OC-9 is the one worth reading twice: an acknowledged alert must never widen
-- afterwards. Getting that wrong wakes an entire crew about a job somebody is
-- already driving to, which is precisely the alert fatigue this feature exists
-- to stop — the feature would then be causing its own disease.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/on_call.test.sql
--
-- One transaction, rolled back. Fixtures use a '6a' id prefix so the file runs
-- standalone OR after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('6a000000-0000-4000-8000-00000000000a'::uuid, 'oncall-a@test.local'),
  ('6a000000-0000-4000-8000-00000000000b'::uuid, 'oncall-b@test.local'),
  ('6a000000-0000-4000-8000-00000000000c'::uuid, 'oncall-c@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('6a000000-0000-4000-8000-0000000000c1'::uuid, 'Night Plumbing',
   '6a000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());

-- A second workspace, so OC-5 tests the tenant boundary rather than the FK.
insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('6a000000-0000-4000-8000-0000000000c2'::uuid, 'Other Plumbing',
   '6a000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());

insert into public.company_members (company_id, user_id, role) values
  ('6a000000-0000-4000-8000-0000000000c1'::uuid,
   '6a000000-0000-4000-8000-00000000000a'::uuid, 'owner'),
  ('6a000000-0000-4000-8000-0000000000c1'::uuid,
   '6a000000-0000-4000-8000-00000000000b'::uuid, 'member'),
  ('6a000000-0000-4000-8000-0000000000c1'::uuid,
   '6a000000-0000-4000-8000-00000000000c'::uuid, 'member');

-- TWO numbers, because the whole overlap rule is about a crew that runs an
-- emergency line and an everything-else line.
insert into public.phone_numbers
  (id, company_id, provisioning_key, country, number_e164, status)
values ('6a000000-0000-4000-8000-0000000000f1'::uuid,
        '6a000000-0000-4000-8000-0000000000c1'::uuid,
        'oncall-1', 'US', '+12125557301', 'active'),
       ('6a000000-0000-4000-8000-0000000000f2'::uuid,
        '6a000000-0000-4000-8000-0000000000c1'::uuid,
        'oncall-2', 'US', '+12125557302', 'active');

insert into public.contacts (id, company_id, phone_e164, name)
values ('6a000000-0000-4000-8000-0000000000d1'::uuid,
        '6a000000-0000-4000-8000-0000000000c1'::uuid,
        '+12125559801', 'Burst Pipe');

insert into public.conversations
  (id, company_id, contact_id, phone_number_id, status, last_message_at)
values ('6a000000-0000-4000-8000-0000000000e1'::uuid,
        '6a000000-0000-4000-8000-0000000000c1'::uuid,
        '6a000000-0000-4000-8000-0000000000d1'::uuid,
        '6a000000-0000-4000-8000-0000000000f1'::uuid, 'open', now());

-- ---------------------------------------------------------------------------
-- OC-1: nobody on call is a real answer, not an error.
--
-- The commonest state by far — most crews will never set a shift — and the
-- routing code has to be able to tell it apart from a lookup failure, because
-- it is the case where the alert must go WIDE rather than nowhere.
-- ---------------------------------------------------------------------------
do $$
begin
  if public.api_on_call_now(
       '6a000000-0000-4000-8000-0000000000c1'::uuid,
       '6a000000-0000-4000-8000-0000000000f1'::uuid,
       now()
     ) is not null then
    raise exception 'OC-1: somebody is on call for a workspace with no shifts';
  end if;
end $$;

-- A workspace-wide shift covering "tonight", and a number-specific one that
-- overlaps it. This is the exact configuration the overlap rule exists for.
insert into public.on_call_shifts
  (id, company_id, user_id, phone_number_id, starts_at, ends_at)
values
  -- A: the whole workspace, all week.
  ('6a000000-0000-4000-8000-00000000a001'::uuid,
   '6a000000-0000-4000-8000-0000000000c1'::uuid,
   '6a000000-0000-4000-8000-00000000000a'::uuid,
   null, now() - interval '1 day', now() + interval '6 days'),
  -- B: the emergency line only, tonight.
  ('6a000000-0000-4000-8000-00000000a002'::uuid,
   '6a000000-0000-4000-8000-0000000000c1'::uuid,
   '6a000000-0000-4000-8000-00000000000b'::uuid,
   '6a000000-0000-4000-8000-0000000000f1'::uuid,
   now() - interval '1 hour', now() + interval '8 hours');

-- ---------------------------------------------------------------------------
-- OC-2: the workspace-wide shift answers for a number nobody was assigned.
-- ---------------------------------------------------------------------------
do $$
declare v uuid;
begin
  v := public.api_on_call_now(
    '6a000000-0000-4000-8000-0000000000c1'::uuid,
    '6a000000-0000-4000-8000-0000000000f2'::uuid,
    now()
  );
  if v is distinct from '6a000000-0000-4000-8000-00000000000a'::uuid then
    raise exception 'OC-2: expected the workspace-wide holder, got %', v;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- OC-3: the SPECIFIC shift beats the workspace-wide one.
--
-- The silent one. A crew that puts one person on the emergency line and another
-- on everything else means exactly that, and a query that took the wrong row
-- would page the wrong person at 2am while looking entirely reasonable in a
-- code review — both rows are true, both cover the instant.
-- ---------------------------------------------------------------------------
do $$
declare v uuid;
begin
  v := public.api_on_call_now(
    '6a000000-0000-4000-8000-0000000000c1'::uuid,
    '6a000000-0000-4000-8000-0000000000f1'::uuid,
    now()
  );
  if v is distinct from '6a000000-0000-4000-8000-00000000000b'::uuid then
    raise exception 'OC-3: the number-specific shift did not win, got %', v;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- OC-4: a shift that has ended does not still hold the phone.
--
-- The reason shifts are intervals rather than a flag. A flag nobody remembers
-- to clear leaves one person permanently on call, they stop answering, and the
-- workspace is silently back to waking everybody.
-- ---------------------------------------------------------------------------
do $$
declare v uuid;
begin
  v := public.api_on_call_now(
    '6a000000-0000-4000-8000-0000000000c1'::uuid,
    '6a000000-0000-4000-8000-0000000000f1'::uuid,
    now() + interval '30 days'
  );
  if v is not null then
    raise exception 'OC-4: an expired shift is still on call (%)', v;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- OC-5: one workspace's rota never answers for another's.
--
-- Against a REAL second workspace, so this tests the tenant filter rather than
-- the foreign key — a made-up company_id is refused before any logic runs and
-- proves nothing.
-- ---------------------------------------------------------------------------
do $$
declare v uuid;
begin
  v := public.api_on_call_now(
    '6a000000-0000-4000-8000-0000000000c2'::uuid,
    '6a000000-0000-4000-8000-0000000000f1'::uuid,
    now()
  );
  if v is not null then
    raise exception 'OC-5: another workspace''s shift answered (%)', v;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- OC-6: the window is half-open — a shift's end instant is not still it.
--
-- Back-to-back shifts are the normal way a rotation is expressed. If both
-- endpoints were inclusive, the handover minute would page two people, and the
-- outgoing one would be woken for a night they had finished.
-- ---------------------------------------------------------------------------
do $$
declare v uuid;
begin
  insert into public.on_call_shifts
    (id, company_id, user_id, phone_number_id, starts_at, ends_at)
  values
    ('6a000000-0000-4000-8000-00000000a003'::uuid,
     '6a000000-0000-4000-8000-0000000000c1'::uuid,
     '6a000000-0000-4000-8000-00000000000c'::uuid,
     '6a000000-0000-4000-8000-0000000000f2'::uuid,
     '2026-09-01T00:00:00Z', '2026-09-02T00:00:00Z');

  v := public.api_on_call_now(
    '6a000000-0000-4000-8000-0000000000c1'::uuid,
    '6a000000-0000-4000-8000-0000000000f2'::uuid,
    '2026-09-02T00:00:00Z'
  );
  if v = '6a000000-0000-4000-8000-00000000000c'::uuid then
    raise exception 'OC-6: a finished shift still held the phone at its end instant';
  end if;

  v := public.api_on_call_now(
    '6a000000-0000-4000-8000-0000000000c1'::uuid,
    '6a000000-0000-4000-8000-0000000000f2'::uuid,
    '2026-09-01T00:00:00Z'
  );
  if v is distinct from '6a000000-0000-4000-8000-00000000000c'::uuid then
    raise exception 'OC-6: a shift did not hold the phone at its start instant (%)', v;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- OC-7: an alert with a deadline is claimed exactly once.
-- ---------------------------------------------------------------------------
insert into public.alert_escalations
  (id, company_id, conversation_id, kind, on_call_user_id, escalate_at)
values
  ('6a000000-0000-4000-8000-00000000b001'::uuid,
   '6a000000-0000-4000-8000-0000000000c1'::uuid,
   '6a000000-0000-4000-8000-0000000000e1'::uuid,
   'missed_call',
   '6a000000-0000-4000-8000-00000000000b'::uuid,
   now() - interval '1 minute');

do $$
declare first_batch int; second_batch int;
begin
  select count(*) into first_batch
    from public.api_claim_due_alerts(now(), 50);
  if first_batch <> 1 then
    raise exception 'OC-7: expected one due alert, claimed %', first_batch;
  end if;

  -- The second sweep, one second later, must find nothing: the claim cleared
  -- the deadline. Without that, a slow widen and the next tick both page the
  -- crew about one unanswered call.
  select count(*) into second_batch
    from public.api_claim_due_alerts(now(), 50);
  if second_batch <> 0 then
    raise exception 'OC-7: a claimed alert was claimed again (%)', second_batch;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- OC-8: two people tapping at once — one claims it, the other is told whose.
--
-- The fix for diffusion of responsibility only works if the second tapper
-- learns a NAME. Telling them "acknowledged" as well leaves two people each
-- believing they own it, which is the original failure with extra steps.
-- ---------------------------------------------------------------------------
insert into public.alert_escalations
  (id, company_id, conversation_id, kind, on_call_user_id, escalate_at)
values
  ('6a000000-0000-4000-8000-00000000b002'::uuid,
   '6a000000-0000-4000-8000-0000000000c1'::uuid,
   '6a000000-0000-4000-8000-0000000000e1'::uuid,
   'missed_call',
   '6a000000-0000-4000-8000-00000000000b'::uuid,
   now() + interval '10 minutes');

do $$
declare first_result jsonb; second_result jsonb;
begin
  first_result := public.api_acknowledge_alert(
    '6a000000-0000-4000-8000-0000000000c1'::uuid,
    '6a000000-0000-4000-8000-00000000b002'::uuid,
    '6a000000-0000-4000-8000-00000000000b'::uuid
  );
  if first_result->>'outcome' <> 'acknowledged' then
    raise exception 'OC-8: the first acknowledgement failed (%)', first_result;
  end if;

  second_result := public.api_acknowledge_alert(
    '6a000000-0000-4000-8000-0000000000c1'::uuid,
    '6a000000-0000-4000-8000-00000000b002'::uuid,
    '6a000000-0000-4000-8000-00000000000c'::uuid
  );
  if second_result->>'outcome' <> 'already_acknowledged' then
    raise exception 'OC-8: a second tap also claimed it (%)', second_result;
  end if;
  if (second_result->>'acknowledged_by')::uuid
     is distinct from '6a000000-0000-4000-8000-00000000000b'::uuid then
    raise exception 'OC-8: the second tapper was not told who holds it (%)',
      second_result;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- OC-9: an acknowledged alert never widens — by BOTH of the two mechanisms.
--
-- THE ONE THAT MATTERS MOST. If an acknowledged alert still widens, the sweep
-- wakes a whole crew about a job somebody is already driving to: the feature
-- causing the exact alert fatigue it was built to prevent.
--
-- Two independent protections stop it — acknowledging clears `escalate_at`,
-- AND the sweep skips anything acknowledged — and that redundancy is
-- deliberate. It also means the end-to-end assertion alone proves nothing about
-- either one: remove the clearing and the sweep still returns nothing, so a
-- test that only counted the sweep would stay green while half the protection
-- was gone. Found by breaking it. So both are asserted separately.
-- ---------------------------------------------------------------------------
do $$
declare due int; deadline timestamptz;
begin
  -- (a) the clearing itself.
  select escalate_at into deadline
    from public.alert_escalations
   where id = '6a000000-0000-4000-8000-00000000b002'::uuid;
  if deadline is not null then
    raise exception
      'OC-9a: acknowledging left the widen deadline set (%)', deadline;
  end if;

  -- (b) and the sweep's own refusal, which must hold independently.
  select count(*) into due
    from public.api_claim_due_alerts(now() + interval '1 hour', 50);
  if due <> 0 then
    raise exception 'OC-9b: an acknowledged alert was still due to widen (%)', due;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- OC-10: acknowledging something from another workspace is not found.
-- ---------------------------------------------------------------------------
do $$
declare result jsonb;
begin
  result := public.api_acknowledge_alert(
    '6a000000-0000-4000-8000-0000000000c2'::uuid,
    '6a000000-0000-4000-8000-00000000b001'::uuid,
    '6a000000-0000-4000-8000-00000000000a'::uuid
  );
  if result->>'outcome' <> 'not_found' then
    raise exception 'OC-10: acknowledged across a tenant boundary (%)', result;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- OC-11: the sweep's own refusal, proven against a row the RPC would never
-- write.
--
-- This is the SECOND of OC-9's two protections, and it is unprovable through
-- the front door: acknowledging clears the deadline, so a properly acknowledged
-- row never reaches the filter at all. Removing the filter entirely changes
-- nothing anybody can observe — which is how a redundant guard rots without a
-- single test going red.
--
-- So the fixture builds the inconsistent state directly: acknowledged AND still
-- carrying a deadline. That is precisely what this filter defends against — a
-- future path that marks an alert handled without going through
-- api_acknowledge_alert, or a partial write. If the filter is doing nothing,
-- this widens an alert somebody already claimed.
-- ---------------------------------------------------------------------------
insert into public.alert_escalations
  (id, company_id, conversation_id, kind, on_call_user_id,
   escalate_at, acknowledged_at, acknowledged_by)
values
  ('6a000000-0000-4000-8000-00000000b003'::uuid,
   '6a000000-0000-4000-8000-0000000000c1'::uuid,
   '6a000000-0000-4000-8000-0000000000e1'::uuid,
   'missed_call',
   '6a000000-0000-4000-8000-00000000000b'::uuid,
   now() - interval '5 minutes',
   now() - interval '4 minutes',
   '6a000000-0000-4000-8000-00000000000b'::uuid);

do $$
declare due int;
begin
  select count(*) into due
    from public.api_claim_due_alerts(now(), 50);
  if due <> 0 then
    raise exception
      'OC-11: the sweep widened an alert that was already acknowledged (%)', due;
  end if;
end $$;

rollback;
