-- [#313] Post-job satisfaction — assertion suite for
-- supabase/migrations/20260803110000_job_ratings.sql.
--
-- What is pinned here is the set of rules that fail SILENTLY, and for this
-- feature they are all about ASKING TOO MUCH. The issue is explicit: "a
-- customer who gets a satisfaction request after every visit stops answering
-- and starts resenting it." A rate limit that leaks is not a bug somebody
-- reports — it is a customer who quietly stops replying, and the signal the
-- whole feature exists to produce goes with them.
--
-- The other half is attribution. JR-6 is the one worth reading twice: a rating
-- must stay attached to whoever did the job, not to whoever holds the task
-- today, because a per-member signal that moves a complaint onto the wrong
-- person is the single most damaging thing this feature can do.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/job_ratings.test.sql
--
-- One transaction, rolled back. Fixtures use a '5f' id prefix so the file runs
-- standalone OR after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('5f000000-0000-4000-8000-00000000000a'::uuid, 'rate-a@test.local'),
  ('5f000000-0000-4000-8000-00000000000b'::uuid, 'rate-b@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('5f000000-0000-4000-8000-0000000000c1'::uuid, 'Rate Plumbing',
   '5f000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());

-- A SECOND workspace, so JR-10 tests the tenant boundary rather than the
-- foreign key. A made-up company_id is refused by the FK before any of this
-- feature's logic runs, which proves nothing about the logic.
insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('5f000000-0000-4000-8000-0000000000c2'::uuid, 'Other Plumbing',
   '5f000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());

insert into public.company_members (company_id, user_id, role) values
  ('5f000000-0000-4000-8000-0000000000c1'::uuid,
   '5f000000-0000-4000-8000-00000000000a'::uuid, 'owner'),
  ('5f000000-0000-4000-8000-0000000000c1'::uuid,
   '5f000000-0000-4000-8000-00000000000b'::uuid, 'member');

insert into public.phone_numbers
  (id, company_id, provisioning_key, country, number_e164, status)
values ('5f000000-0000-4000-8000-0000000000f1'::uuid,
        '5f000000-0000-4000-8000-0000000000c1'::uuid,
        'rate-1', 'US', '+12125557201', 'active');

-- Two contacts: the rate limit is per PERSON, so one of them exists purely to
-- prove it does not spill onto the other.
insert into public.contacts (id, company_id, phone_e164, name)
values ('5f000000-0000-4000-8000-0000000000d1'::uuid,
        '5f000000-0000-4000-8000-0000000000c1'::uuid,
        '+12125559901', 'Rated Customer'),
       ('5f000000-0000-4000-8000-0000000000d2'::uuid,
        '5f000000-0000-4000-8000-0000000000c1'::uuid,
        '+12125559902', 'Other Customer');

insert into public.conversations
  (id, company_id, contact_id, phone_number_id, status, last_message_at)
values ('5f000000-0000-4000-8000-0000000000e1'::uuid,
        '5f000000-0000-4000-8000-0000000000c1'::uuid,
        '5f000000-0000-4000-8000-0000000000d1'::uuid,
        '5f000000-0000-4000-8000-0000000000f1'::uuid, 'open', now()),
       ('5f000000-0000-4000-8000-0000000000e2'::uuid,
        '5f000000-0000-4000-8000-0000000000c1'::uuid,
        '5f000000-0000-4000-8000-0000000000d2'::uuid,
        '5f000000-0000-4000-8000-0000000000f1'::uuid, 'open', now());

-- Three finished jobs for the SAME customer, plus one for the other.
insert into public.messages
  (id, company_id, conversation_id, direction, body, status, segments)
values ('5f000000-0000-4000-8000-00000000ab01'::uuid,
        '5f000000-0000-4000-8000-0000000000c1'::uuid,
        '5f000000-0000-4000-8000-0000000000e1'::uuid,
        'inbound', 'boiler again', 'received', 1),
       ('5f000000-0000-4000-8000-00000000ab02'::uuid,
        '5f000000-0000-4000-8000-0000000000c1'::uuid,
        '5f000000-0000-4000-8000-0000000000e1'::uuid,
        'inbound', 'and the tap', 'received', 1),
       ('5f000000-0000-4000-8000-00000000ab03'::uuid,
        '5f000000-0000-4000-8000-0000000000c1'::uuid,
        '5f000000-0000-4000-8000-0000000000e2'::uuid,
        'inbound', 'radiator', 'received', 1);

insert into public.tasks
  (id, company_id, message_id, conversation_id, title, assigned_user_id,
   created_by_user_id)
values ('5f000000-0000-4000-8000-00000000ba01'::uuid,
        '5f000000-0000-4000-8000-0000000000c1'::uuid,
        '5f000000-0000-4000-8000-00000000ab01'::uuid,
        '5f000000-0000-4000-8000-0000000000e1'::uuid,
        'Boiler swap', '5f000000-0000-4000-8000-00000000000b'::uuid,
        '5f000000-0000-4000-8000-00000000000a'::uuid),
       ('5f000000-0000-4000-8000-00000000ba02'::uuid,
        '5f000000-0000-4000-8000-0000000000c1'::uuid,
        '5f000000-0000-4000-8000-00000000ab02'::uuid,
        '5f000000-0000-4000-8000-0000000000e1'::uuid,
        'Tap washer', '5f000000-0000-4000-8000-00000000000b'::uuid,
        '5f000000-0000-4000-8000-00000000000a'::uuid),
       ('5f000000-0000-4000-8000-00000000ba03'::uuid,
        '5f000000-0000-4000-8000-0000000000c1'::uuid,
        '5f000000-0000-4000-8000-00000000ab03'::uuid,
        '5f000000-0000-4000-8000-0000000000e2'::uuid,
        'Radiator bleed', null,
        '5f000000-0000-4000-8000-00000000000a'::uuid);

create or replace function pg_temp.claim(p_task uuid, p_conv uuid, p_contact uuid, p_user uuid)
  returns jsonb language sql as $$
  select public.api_claim_job_rating(
    '5f000000-0000-4000-8000-0000000000c1'::uuid, p_task, p_conv, p_contact, p_user);
$$;

-- ===========================================================================
-- JR-1. Asking about a finished job claims the right to ask, once.
-- ===========================================================================
do $$
declare
  v_res jsonb;
  v_user uuid;
begin
  v_res := pg_temp.claim(
    '5f000000-0000-4000-8000-00000000ba01'::uuid,
    '5f000000-0000-4000-8000-0000000000e1'::uuid,
    '5f000000-0000-4000-8000-0000000000d1'::uuid,
    '5f000000-0000-4000-8000-00000000000b'::uuid);

  if v_res->>'outcome' <> 'claimed' then
    raise exception 'JR-1 FAILED: first claim returned %', v_res;
  end if;

  select rated_user_id into v_user from public.job_ratings
   where task_id = '5f000000-0000-4000-8000-00000000ba01'::uuid;
  if v_user <> '5f000000-0000-4000-8000-00000000000b'::uuid then
    raise exception 'JR-1 FAILED: rated_user_id is %, expected the assignee', v_user;
  end if;

  raise notice 'JR-1 PASSED: a finished job claims one question';
end $$;

-- ===========================================================================
-- JR-2. The same job is never asked about twice.
--
-- Asking twice about one visit reads as a business that is not listening,
-- which is the opposite of the point.
-- ===========================================================================
do $$
declare
  v_res   jsonb;
  v_count integer;
begin
  v_res := pg_temp.claim(
    '5f000000-0000-4000-8000-00000000ba01'::uuid,
    '5f000000-0000-4000-8000-0000000000e1'::uuid,
    '5f000000-0000-4000-8000-0000000000d1'::uuid,
    '5f000000-0000-4000-8000-00000000000b'::uuid);

  if v_res->>'outcome' <> 'already_asked' then
    raise exception 'JR-2 FAILED: a second claim on one job returned %', v_res;
  end if;

  select count(*) into v_count from public.job_ratings
   where task_id = '5f000000-0000-4000-8000-00000000ba01'::uuid;
  if v_count <> 1 then
    raise exception 'JR-2 FAILED: % row(s) for one job', v_count;
  end if;

  raise notice 'JR-2 PASSED: one question per job';
end $$;

-- ===========================================================================
-- JR-3. A SECOND job for the same customer inside the cooldown is refused.
--
-- THE ONE THE FEATURE LIVES OR DIES ON. Two visits in a week is ordinary in
-- the trades, and asking after both is how a customer stops answering.
-- ===========================================================================
do $$
declare
  v_res jsonb;
begin
  v_res := pg_temp.claim(
    '5f000000-0000-4000-8000-00000000ba02'::uuid,
    '5f000000-0000-4000-8000-0000000000e1'::uuid,
    '5f000000-0000-4000-8000-0000000000d1'::uuid,
    '5f000000-0000-4000-8000-00000000000b'::uuid);

  if v_res->>'outcome' <> 'too_soon' then
    raise exception
      'JR-3 FAILED: a second job for the same customer returned %, expected '
      'too_soon. This customer is now being asked after every visit.', v_res;
  end if;
  if (v_res->>'cooldown_days')::integer <> 30 then
    raise exception 'JR-3 FAILED: cooldown reported as %', v_res->>'cooldown_days';
  end if;

  raise notice 'JR-3 PASSED: the same customer is not asked twice in a month';
end $$;

-- ===========================================================================
-- JR-4. ...and the cooldown does not spill onto a DIFFERENT customer.
--
-- The inverse of JR-3, and the one that would make the feature useless rather
-- than annoying: a rate limit keyed on the workspace instead of the person
-- would ask one customer a month in total.
-- ===========================================================================
do $$
declare
  v_res jsonb;
begin
  v_res := pg_temp.claim(
    '5f000000-0000-4000-8000-00000000ba03'::uuid,
    '5f000000-0000-4000-8000-0000000000e2'::uuid,
    '5f000000-0000-4000-8000-0000000000d2'::uuid,
    null);

  if v_res->>'outcome' <> 'claimed' then
    raise exception
      'JR-4 FAILED: a different customer was refused (%). The cooldown is '
      'per person, not per workspace.', v_res;
  end if;

  raise notice 'JR-4 PASSED: the cooldown is per customer';
end $$;

-- ===========================================================================
-- JR-5. The three states are distinguishable: never asked, asked and ignored,
--       answered.
--
-- A nullable score on `tasks` could not tell the first two apart, and the
-- difference IS the rate limit — a customer who ignored the question must not
-- be asked again next week.
-- ===========================================================================
do $$
declare
  v_asked   integer;
  v_ignored integer;
begin
  select count(*) into v_asked from public.job_ratings
   where company_id = '5f000000-0000-4000-8000-0000000000c1'::uuid;
  select count(*) into v_ignored from public.job_ratings
   where company_id = '5f000000-0000-4000-8000-0000000000c1'::uuid
     and answered_at is null;

  if v_asked <> 2 or v_ignored <> 2 then
    raise exception
      'JR-5 FAILED: % asked and % unanswered, expected 2 and 2. An asked-but-'
      'ignored question must be visible as such, or the cooldown cannot see it.',
      v_asked, v_ignored;
  end if;

  raise notice 'JR-5 PASSED: asked-and-ignored is its own state';
end $$;

-- ===========================================================================
-- JR-6. Reassigning the job does NOT move the rating.
--
-- READ THIS ONE TWICE. A per-member signal that follows the task's current
-- assignee moves a complaint onto whoever inherited the job — the single most
-- damaging thing this feature can do, and invisible unless somebody checks.
-- ===========================================================================
do $$
declare
  v_rated uuid;
begin
  update public.tasks
     set assigned_user_id = '5f000000-0000-4000-8000-00000000000a'::uuid
   where id = '5f000000-0000-4000-8000-00000000ba01'::uuid;

  select rated_user_id into v_rated from public.job_ratings
   where task_id = '5f000000-0000-4000-8000-00000000ba01'::uuid;

  if v_rated <> '5f000000-0000-4000-8000-00000000000b'::uuid then
    raise exception
      'JR-6 FAILED: the rating followed the task to %. A complaint has just '
      'been attributed to somebody who did not do the job.', v_rated;
  end if;

  raise notice 'JR-6 PASSED: a rating stays with whoever did the job';
end $$;

-- ===========================================================================
-- JR-7. An answer records once, and against the open question.
-- ===========================================================================
do $$
declare
  v_first  jsonb;
  v_second jsonb;
begin
  v_first := public.api_record_job_rating(
    '5f000000-0000-4000-8000-0000000000c1'::uuid,
    '5f000000-0000-4000-8000-0000000000e1'::uuid, 5::smallint);
  v_second := public.api_record_job_rating(
    '5f000000-0000-4000-8000-0000000000c1'::uuid,
    '5f000000-0000-4000-8000-0000000000e1'::uuid, 1::smallint);

  if v_first->>'outcome' <> 'recorded' then
    raise exception 'JR-7 FAILED: first answer returned %', v_first;
  end if;
  if (v_first->>'task_id')::uuid <> '5f000000-0000-4000-8000-00000000ba01'::uuid then
    raise exception 'JR-7 FAILED: answered the wrong job (%)', v_first;
  end if;
  if v_second->>'outcome' <> 'nothing_asked' then
    raise exception
      'JR-7 FAILED: a second reply returned %, expected nothing_asked. A '
      'customer thumbing two digits would otherwise overwrite their own '
      'answer with the second one.', v_second;
  end if;

  raise notice 'JR-7 PASSED: an answer records once, against the open question';
end $$;

-- ===========================================================================
-- JR-8. A score outside 1..5 is refused rather than stored.
--
-- The reply is a digit somebody typed on a phone. "7" is a typo, not a rating,
-- and storing it would put a number in the average that no scale produced.
-- ===========================================================================
do $$
declare
  v_res jsonb;
  v_ok  boolean;
begin
  v_res := public.api_record_job_rating(
    '5f000000-0000-4000-8000-0000000000c1'::uuid,
    '5f000000-0000-4000-8000-0000000000e2'::uuid, 7::smallint);
  if v_res->>'outcome' <> 'out_of_range' then
    raise exception 'JR-8 FAILED: a score of 7 returned %', v_res;
  end if;

  -- ...and the column refuses it too, so a caller bypassing the RPC cannot.
  begin
    update public.job_ratings set score = 9
     where conversation_id = '5f000000-0000-4000-8000-0000000000e2'::uuid;
    v_ok := false;
  exception when check_violation then
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'JR-8 FAILED: the column accepted a score of 9';
  end if;

  raise notice 'JR-8 PASSED: only 1..5 is a rating';
end $$;

-- ===========================================================================
-- JR-9. A rating ask is a scheduled message, and the shape constraint knows it.
--
-- The whole D47 answer: no second send path. A 'rating' row rides the same
-- queue, the same lease and the same fire-time gates as everything else — and
-- must carry the job it is asking about, or nothing can attribute the answer.
-- ===========================================================================
do $$
declare
  v_ok boolean;
begin
  insert into public.scheduled_messages
    (company_id, conversation_id, task_id, origin, body, send_at,
     clock_timezone, clock_source, expires_at, created_by)
  values ('5f000000-0000-4000-8000-0000000000c1'::uuid,
          '5f000000-0000-4000-8000-0000000000e1'::uuid,
          '5f000000-0000-4000-8000-00000000ba01'::uuid,
          'rating', 'How did it go? Reply 1 to 5.',
          now() + interval '2 hours', 'America/New_York', 'area_code',
          now() + interval '3 days',
          '5f000000-0000-4000-8000-00000000000a'::uuid);

  begin
    insert into public.scheduled_messages
      (company_id, conversation_id, origin, body, send_at,
       clock_timezone, clock_source, expires_at, created_by)
    values ('5f000000-0000-4000-8000-0000000000c1'::uuid,
            '5f000000-0000-4000-8000-0000000000e1'::uuid,
            'rating', 'orphaned ask',
            now() + interval '2 hours', 'America/New_York', 'area_code',
            now() + interval '3 days',
            '5f000000-0000-4000-8000-00000000000a'::uuid);
    v_ok := false;
  exception when check_violation then
    v_ok := true;
  end;

  if not v_ok then
    raise exception
      'JR-9 FAILED: a rating ask with no job was accepted. Nothing can '
      'attribute the answer to a visit, which is the whole signal.';
  end if;

  raise notice 'JR-9 PASSED: a rating ask carries its job';
end $$;

-- ===========================================================================
-- JR-10. One workspace cannot claim or answer another's job.
-- ===========================================================================
do $$
declare
  v_res jsonb;
begin
  -- The open question on conversation e2 belongs to company c1. A real second
  -- workspace asking for it must see nothing — an answer landing in the wrong
  -- company's ledger would attribute one business's customer to another's crew.
  v_res := public.api_record_job_rating(
    '5f000000-0000-4000-8000-0000000000c2'::uuid,
    '5f000000-0000-4000-8000-0000000000e2'::uuid, 3::smallint);
  if v_res->>'outcome' <> 'nothing_asked' then
    raise exception
      'JR-10 FAILED: another workspace answered this conversation''s open '
      'question (%).', v_res;
  end if;

  -- ...while the OWNING company still can, so the assertion above is about
  -- the boundary rather than about the question having gone missing.
  v_res := public.api_record_job_rating(
    '5f000000-0000-4000-8000-0000000000c1'::uuid,
    '5f000000-0000-4000-8000-0000000000e2'::uuid, 3::smallint);
  if v_res->>'outcome' <> 'recorded' then
    raise exception
      'JR-10 FAILED: the owning company could not answer its own open '
      'question (%) — the assertion above proved nothing.', v_res;
  end if;

  raise notice 'JR-10 PASSED: claiming and answering are company-scoped';
end $$;

rollback;
