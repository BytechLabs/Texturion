-- [#698] The stored unread state stays equal to the computed answer, and the
-- For You and inbox readers that use it return what they returned before.
-- Assertion suite for supabase/migrations/20261110220000_for_you_reads_stored_unread.sql.
--
--   UB-1  a randomised sequence of inserts (some backdated, some tied), reads,
--         trashes, restores, hard deletes, sender changes, time changes and
--         moves between conversations; after EVERY step the stored state gives
--         the same unread answer as the old computed definition, for every
--         member and every conversation, and the stored timestamps equal the
--         ones recomputed from `messages`
--   UB-2  the backfill statement rebuilds exactly the maintained state
--   UB-3  the old api_for_you and api_list_conversations (copied below, from
--         20261110170000_deletion_and_trash.sql) and the new ones return the
--         same JSON, for every member, with and without a hidden number
--   UB-4  the table is not reachable by anon or authenticated
--
-- One transaction, rolled back. Fixtures use an 'ub' id prefix. Numbers are in
-- the fictional 555-01xx range.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                        created_at, updated_at, aud, role)
values ('b6980000-0000-4000-8000-000000000001', 'ub-a@test.local', '', now(), now(), now(), 'authenticated', 'authenticated'),
       ('b6980000-0000-4000-8000-000000000002', 'ub-b@test.local', '', now(), now(), now(), 'authenticated', 'authenticated'),
       ('b6980000-0000-4000-8000-000000000003', 'ub-c@test.local', '', now(), now(), now(), 'authenticated', 'authenticated'),
       -- a member who never sends anything
       ('b6980000-0000-4000-8000-000000000004', 'ub-z@test.local', '', now(), now(), now(), 'authenticated', 'authenticated');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, plan)
values ('b6980000-0000-4000-8000-000000000010', 'UB Co',
        'b6980000-0000-4000-8000-000000000001', 'US', '212', now(), 'active', 'pro'),
       ('b6980000-0000-4000-8000-000000000011', 'UB Other Co',
        'b6980000-0000-4000-8000-000000000001', 'US', '213', now(), 'active', 'pro');

insert into public.company_members (company_id, user_id, role)
values ('b6980000-0000-4000-8000-000000000010', 'b6980000-0000-4000-8000-000000000001', 'owner'),
       ('b6980000-0000-4000-8000-000000000010', 'b6980000-0000-4000-8000-000000000002', 'member'),
       ('b6980000-0000-4000-8000-000000000010', 'b6980000-0000-4000-8000-000000000003', 'member'),
       ('b6980000-0000-4000-8000-000000000010', 'b6980000-0000-4000-8000-000000000004', 'member');

insert into public.phone_numbers (id, company_id, number_e164, status, provisioning_key, country)
values ('b6980000-0000-4000-8000-000000000020', 'b6980000-0000-4000-8000-000000000010', '+12125550130', 'active', 'ub-key-20', 'US'),
       ('b6980000-0000-4000-8000-000000000021', 'b6980000-0000-4000-8000-000000000010', '+12125550131', 'active', 'ub-key-21', 'US'),
       ('b6980000-0000-4000-8000-000000000022', 'b6980000-0000-4000-8000-000000000011', '+12135550130', 'active', 'ub-key-22', 'US');

-- Seven conversations in UB Co: assigned to A (two), to B, unassigned (four),
-- two of them on the number a restricted member is denied; one in UB Other Co.
insert into public.contacts (id, company_id, phone_e164, name)
select ('b6980000-0000-4000-8000-0000000003' || lpad(i::text, 2, '0'))::uuid,
       case when i = 8 then 'b6980000-0000-4000-8000-000000000011'::uuid
            else 'b6980000-0000-4000-8000-000000000010'::uuid end,
       '+1415555' || lpad((140 + i)::text, 4, '0'), 'Contact ' || i
from generate_series(1, 8) i;

insert into public.conversations
  (id, company_id, contact_id, phone_number_id, status, assigned_user_id, last_message_at)
select ('b6980000-0000-4000-8000-0000000004' || lpad(i::text, 2, '0'))::uuid,
       case when i = 8 then 'b6980000-0000-4000-8000-000000000011'::uuid
            else 'b6980000-0000-4000-8000-000000000010'::uuid end,
       ('b6980000-0000-4000-8000-0000000003' || lpad(i::text, 2, '0'))::uuid,
       case when i = 8 then 'b6980000-0000-4000-8000-000000000022'::uuid
            when i in (3, 6) then 'b6980000-0000-4000-8000-000000000021'::uuid
            else 'b6980000-0000-4000-8000-000000000020'::uuid end,
       (array['open','waiting','new','open','waiting','open','new','open'])[i]::public.conversation_status,
       case when i in (1, 2) then 'b6980000-0000-4000-8000-000000000001'::uuid
            when i = 3 then 'b6980000-0000-4000-8000-000000000002'::uuid
            else null end,
       timestamptz '2026-01-01 00:00:00+00'
from generate_series(1, 8) i;

-- ===========================================================================
-- The oracle: the unread definition as it stood before this migration.
-- ===========================================================================
create function pg_temp.ub_old_unread(p_conv uuid, p_user uuid)
returns boolean language sql stable as $$
  select exists (
    select 1
      from public.messages m
     where m.deleted_at is null and m.conversation_id = p_conv
       and (m.sent_by_user_id is null or m.sent_by_user_id <> p_user)
       and m.created_at > coalesce(
         (select r.last_read_at
            from public.conversation_reads r
           where r.conversation_id = p_conv and r.user_id = p_user),
         '-infinity'::timestamptz));
$$;

-- The stored answer, written the way the readers write it.
create function pg_temp.ub_stored_unread(p_conv uuid, p_user uuid)
returns boolean language sql stable as $$
  select coalesce((
    select case when b.latest_by is distinct from p_user
                then b.latest_at else b.other_at end
           > coalesce(r.last_read_at, '-infinity'::timestamptz)
      from public.conversation_unread_basis b
      left join public.conversation_reads r
        on r.conversation_id = b.conversation_id and r.user_id = p_user
     where b.conversation_id = p_conv), false);
$$;

-- Everything the state must equal, for every conversation and member.
create function pg_temp.ub_check(p_step text)
returns void language plpgsql as $$
declare
  v record;
begin
  -- 1. The unread answer.
  for v in
    select c.id as conv, u.id as usr,
           pg_temp.ub_old_unread(c.id, u.id) as old_answer,
           pg_temp.ub_stored_unread(c.id, u.id) as stored_answer
      from public.conversations c
     cross join (select id from auth.users where email like 'ub-%@test.local') u
     where c.id::text like 'b6980000-%'
  loop
    if v.old_answer is distinct from v.stored_answer then
      raise exception 'UB FAILED at %: conversation % member %: computed %, stored %',
        p_step, v.conv, v.usr, v.old_answer, v.stored_answer;
    end if;
  end loop;

  -- 2. The timestamps themselves, per member, from `messages` directly. This is
  -- stronger than the answer: it catches a state that is wrong but happens to
  -- agree with every current read time.
  for v in
    select c.id as conv, u.id as usr,
           (select case when b.latest_by is distinct from u.id
                        then b.latest_at else b.other_at end
              from public.conversation_unread_basis b
             where b.conversation_id = c.id) as stored_at,
           (select max(m.created_at)
              from public.messages m
             where m.conversation_id = c.id and m.deleted_at is null
               and m.sent_by_user_id is distinct from u.id) as true_at
      from public.conversations c
     cross join (select id from auth.users where email like 'ub-%@test.local') u
     where c.id::text like 'b6980000-%'
  loop
    if v.stored_at is distinct from v.true_at then
      raise exception 'UB FAILED at %: conversation % member %: newest message by someone else is %, stored %',
        p_step, v.conv, v.usr, v.true_at, v.stored_at;
    end if;
  end loop;

  -- 3. A conversation with no undeleted message has no row.
  if exists (
    select 1 from public.conversation_unread_basis b
     where not exists (select 1 from public.messages m
                        where m.conversation_id = b.conversation_id
                          and m.deleted_at is null)) then
    raise exception 'UB FAILED at %: a state row outlived every message', p_step;
  end if;
  if exists (
    select 1 from public.conversation_unread_basis b
     where b.company_id is distinct from
           (select c.company_id from public.conversations c
             where c.id = b.conversation_id)) then
    raise exception 'UB FAILED at %: a state row carries the wrong workspace', p_step;
  end if;
end;
$$;

-- ===========================================================================
-- UB-1. The randomised sequence.
-- ===========================================================================
do $$
declare
  users uuid[] := array[
    'b6980000-0000-4000-8000-000000000001'::uuid,
    'b6980000-0000-4000-8000-000000000002'::uuid,
    'b6980000-0000-4000-8000-000000000003'::uuid];
  base timestamptz := timestamptz '2026-01-01 00:00:00+00';
  steps int := 700;
  s int;
  action int;
  conv uuid;
  usr uuid;
  msg uuid;
  kind int;
  at_ts timestamptz;
  counts int[] := array_fill(0, array[12]);
  v_rows int;
begin
  perform setseed(0.698);
  perform pg_temp.ub_check('start');

  for s in 1..steps loop
    action := floor(random() * 12)::int;
    conv := ('b6980000-0000-4000-8000-0000000004' ||
             lpad((1 + floor(random() * 8))::int::text, 2, '0'))::uuid;
    usr := users[1 + floor(random() * 3)::int];
    v_rows := 0;

    if action <= 3 then
      -- A new message: customer (inbound), a member (outbound), or a note.
      kind := floor(random() * 3)::int;
      at_ts := case
        when random() < 0.15 then base + (random() * s * 60) * interval '1 second'  -- backdated
        when random() < 0.10 then (select coalesce(max(created_at), base + s * interval '1 minute')
                                     from public.messages where conversation_id = conv)  -- a tie
        else base + s * interval '1 minute' end;
      insert into public.messages
        (company_id, conversation_id, direction, body, status, sent_by_user_id,
         segments, created_at)
      select c.company_id, conv,
             (array['inbound','outbound','note'])[kind + 1]::public.message_direction,
             'ub ' || s,
             case kind when 0 then 'received' when 1 then 'sent' else null end
               ::public.message_status,
             case kind when 0 then null else usr end,
             1, at_ts
        from public.conversations c where c.id = conv;
      v_rows := 1;
    elsif action = 4 or action = 5 then
      -- A member reads a conversation, at any time (forwards or back).
      insert into public.conversation_reads (conversation_id, user_id, last_read_at)
      values (conv, usr, base + (random() * s * 60) * interval '1 second')
      on conflict (conversation_id, user_id)
        do update set last_read_at = excluded.last_read_at;
      v_rows := 1;
    elsif action = 6 then
      update public.messages set deleted_at = now()
       where id = (select id from public.messages
                    where deleted_at is null and conversation_id::text like 'b6980000-%'
                    order by random() limit 1);
      get diagnostics v_rows = row_count;
    elsif action = 7 then
      update public.messages set deleted_at = null
       where id = (select id from public.messages
                    where deleted_at is not null and conversation_id::text like 'b6980000-%'
                    order by random() limit 1);
      get diagnostics v_rows = row_count;
    elsif action = 8 then
      delete from public.messages
       where id = (select id from public.messages
                    where conversation_id::text like 'b6980000-%'
                    order by random() limit 1);
      get diagnostics v_rows = row_count;
    elsif action = 9 then
      -- Somebody else becomes the sender. An outbound message always has one.
      update public.messages
         set sent_by_user_id = case when direction = 'outbound' or random() < 0.7
                                    then usr else null end
       where id = (select id from public.messages
                    where conversation_id::text like 'b6980000-%'
                    order by random() limit 1);
      get diagnostics v_rows = row_count;
    elsif action = 10 then
      update public.messages set created_at = base + (random() * s * 60) * interval '1 second'
       where id = (select id from public.messages
                    where conversation_id::text like 'b6980000-%'
                    order by random() limit 1);
      get diagnostics v_rows = row_count;
    else
      -- Moved to another conversation of the same workspace.
      update public.messages
         set conversation_id = ('b6980000-0000-4000-8000-0000000004' ||
                                lpad((1 + floor(random() * 7))::int::text, 2, '0'))::uuid
       where id = (select id from public.messages
                    where conversation_id::text like 'b6980000-%'
                      and conversation_id <> 'b6980000-0000-4000-8000-000000000408'
                    order by random() limit 1);
      get diagnostics v_rows = row_count;
    end if;

    if v_rows > 0 then
      counts[action + 1] := counts[action + 1] + 1;
    end if;
    perform pg_temp.ub_check('step ' || s || ' action ' || action);
  end loop;

  -- Report coverage and fail on an action that never did anything: a sequence
  -- that quietly skipped half its kinds would prove half as much.
  raise notice 'UB-1 coverage per action (insert x4 | read x2 | trash | restore | delete | sender | time | move): %', counts;
  for s in 1..12 loop
    if counts[s] = 0 then
      raise exception 'UB-1 FAILED: action % never changed a row in % steps', s - 1, steps;
    end if;
  end loop;
  raise notice 'UB-1 PASSED: stored unread equals computed after each of % steps, % messages left',
    steps, (select count(*) from public.messages where conversation_id::text like 'b6980000-%');
end $$;

-- ===========================================================================
-- UB-2. The backfill rebuilds exactly what the triggers maintained.
-- ===========================================================================
do $$
declare
  before_rows jsonb;
  after_rows jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(b) - 'latest_by' order by b.conversation_id), '[]')
    into before_rows
    from public.conversation_unread_basis b where b.conversation_id::text like 'b6980000-%';

  delete from public.conversation_unread_basis where conversation_id::text like 'b6980000-%';

  -- The statement in the migration, restricted to this test's rows.
  insert into public.conversation_unread_basis
    (conversation_id, company_id, latest_at, latest_by, other_at)
  select l.conversation_id, l.company_id, l.created_at, l.sent_by_user_id,
         (select max(m.created_at)
            from public.messages m
           where m.conversation_id = l.conversation_id
             and m.deleted_at is null
             and m.sent_by_user_id is distinct from l.sent_by_user_id)
    from (
      select distinct on (m.conversation_id)
             m.conversation_id, m.company_id, m.created_at, m.sent_by_user_id
        from public.messages m
       where m.deleted_at is null and m.conversation_id::text like 'b6980000-%'
       order by m.conversation_id, m.created_at desc
    ) l;

  -- Ties can pick a different latest_by, so compare what a reader sees.
  perform pg_temp.ub_check('after backfill');

  select coalesce(jsonb_agg(to_jsonb(b) - 'latest_by' order by b.conversation_id), '[]')
    into after_rows
    from public.conversation_unread_basis b where b.conversation_id::text like 'b6980000-%';
  if jsonb_array_length(before_rows) is distinct from jsonb_array_length(after_rows) then
    raise exception 'UB-2 FAILED: backfill made % rows, triggers had kept %',
      jsonb_array_length(after_rows), jsonb_array_length(before_rows);
  end if;
  raise notice 'UB-2 PASSED: the backfill agrees with the maintained state on % conversations',
    jsonb_array_length(after_rows);
end $$;

-- ===========================================================================
-- UB-3. The readers return what they returned before.
-- ===========================================================================
-- Jobs (some tied to a message, one done through its message), a snooze and a
-- follow-up, so every section of the For You read has something in it.
update public.messages set done_at = now(), done_by_user_id = 'b6980000-0000-4000-8000-000000000001'
 where id = (select id from public.messages
              where conversation_id = 'b6980000-0000-4000-8000-000000000401' and deleted_at is null
              order by created_at limit 1);

insert into public.tasks
  (company_id, conversation_id, message_id, title, assigned_user_id, due_at,
   created_by_user_id, done_at)
select 'b6980000-0000-4000-8000-000000000010', m.conversation_id,
       case when n % 2 = 0 then m.id else null end,
       'Job ' || n,
       case n % 3 when 0 then 'b6980000-0000-4000-8000-000000000001'::uuid
                  when 1 then 'b6980000-0000-4000-8000-000000000002'::uuid
                  else null end,
       now() + ((n % 5 - 2) || ' days')::interval,
       'b6980000-0000-4000-8000-000000000001',
       case when n % 7 = 0 and n % 2 = 1 then now() else null end
  from (select m.*, row_number() over (order by m.id) as n
          from public.messages m
         where m.deleted_at is null and m.conversation_id::text like 'b6980000-%'
           and m.conversation_id <> 'b6980000-0000-4000-8000-000000000408'
           and m.direction in ('inbound', 'note')
         limit 24) m;

-- Some of the jobs are done through their message instead.
update public.messages set done_at = now(), done_by_user_id = 'b6980000-0000-4000-8000-000000000001'
 where id in (select message_id from public.tasks
               where message_id is not null and title in ('Job 4', 'Job 10', 'Job 16'));

insert into public.conversation_snoozes (company_id, conversation_id, user_id, until, kind)
values ('b6980000-0000-4000-8000-000000000010', 'b6980000-0000-4000-8000-000000000402',
        'b6980000-0000-4000-8000-000000000001', now() + interval '1 day', 'snooze'),
       ('b6980000-0000-4000-8000-000000000010', 'b6980000-0000-4000-8000-000000000404',
        'b6980000-0000-4000-8000-000000000002', now() + interval '1 day', 'snooze');
insert into public.conversation_snoozes (company_id, conversation_id, user_id, until, kind)
values ('b6980000-0000-4000-8000-000000000010', 'b6980000-0000-4000-8000-000000000401',
        'b6980000-0000-4000-8000-000000000001', now() - interval '1 minute', 'follow_up'),
       ('b6980000-0000-4000-8000-000000000010', 'b6980000-0000-4000-8000-000000000405',
        'b6980000-0000-4000-8000-000000000003', now() - interval '1 minute', 'follow_up');

-- The old definitions, renamed. Generated from 20261110170000_deletion_and_trash.sql.
create function pg_temp.old_for_you(
  p_company_id uuid,
  p_user_id uuid,
  p_now timestamptz,
  p_limit integer default 20,
  p_hidden_number_ids uuid[] default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$

  with
  conv as (
    select c.id, c.status, c.contact_id, c.assigned_user_id, c.last_message_at,
           -- CASE, not AND: for an UNASSIGNED row "assigned_user_id = p_user_id" is
           -- NULL rather than false, and "NULL and x" must still evaluate x to
           -- learn whether the answer is NULL or false. An AND here reads as a
           -- short circuit and measured as none. CASE short-circuits by
           -- definition; the ELSE covers somebody else's row and an unassigned one.
           case when c.assigned_user_id = p_user_id then exists (
             select 1
               from public.messages m
              where m.deleted_at is null and m.conversation_id = c.id
                and (m.sent_by_user_id is null or m.sent_by_user_id <> p_user_id)
                and m.created_at > coalesce(
                  (select r.last_read_at
                     from public.conversation_reads r
                    where r.conversation_id = c.id and r.user_id = p_user_id),
                  '-infinity'::timestamptz)) else false end as unread_mine
    -- #306: every consumer below wants mine, or unassigned. Anything else was
    -- computed and thrown away.
    -- #416: "or unassigned" used to be "or, if you are a lead, unassigned" —
    -- the deepest of the four gates, and the one that made a member's triage
    -- section come back empty rather than absent.
    -- #698: two branches, so each is an exact index condition.
    from (
      select k.id, k.status, k.contact_id, k.assigned_user_id,
             k.last_message_at, k.phone_number_id
        from public.conversations k
       where k.company_id = p_company_id
         and k.is_spam = false
         and k.closed_at is null
         and k.assigned_user_id = p_user_id
      union all
      select k.id, k.status, k.contact_id, k.assigned_user_id,
             k.last_message_at, k.phone_number_id
        from public.conversations k
       where k.company_id = p_company_id
         and k.is_spam = false
         and k.closed_at is null
         and k.assigned_user_id is null
    ) c
    where
      -- #106: conversation sections still hide conversations on hidden numbers.
      (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
      -- #293: a thread I deferred is not work waiting on me TODAY. The focus
      -- queue is the surface that tells a crew what needs them, and a queue
      -- where half the items are not actionable today trains people to stop
      -- trusting the count — alert fatigue (#244) arriving through a different
      -- door. One anti-join in the CTE every section reads from, so
      -- waiting_on_you, unread and triage cannot disagree about it.
      --
      -- Scoped to p_user_id, so a colleague's deferral neither hides the thread
      -- from me nor lands on my queue. Computed from `until`, so a thread whose
      -- moment has passed is back with nothing needing to run first.
      and not exists (
        select 1
          from public.conversation_snoozes s
         where s.conversation_id = c.id
           and s.user_id = p_user_id
           and s.until > now())
  ),
  -- #293: follow-up reminders that have COME DUE. `until <= now()` is the
  -- whole mechanism — the same computed expiry the deferral uses, read from
  -- the other side. Nothing runs to fire one, so nothing can run late.
  --
  -- "If they haven't replied" needs no clause here at all: the inbound trigger
  -- deletes the row the moment a customer texts, so a reminder that survives to
  -- its due time is BY CONSTRUCTION one they never answered.
  due_follow_ups as (
    select s.conversation_id, s.until, s.note
    from public.conversation_snoozes s
    where s.company_id = p_company_id
      and s.user_id = p_user_id
      and s.kind = 'follow_up'
      and s.until <= now()
  ),
  follow_ups as (
    -- Unread is read for the rows that survive. It is shown here and never
    -- filtered or sorted on, so it belongs after the limit.
    select p.*, exists (
             select 1
               from public.messages m
              where m.deleted_at is null and m.conversation_id = p.conversation_id
                and (m.sent_by_user_id is null or m.sent_by_user_id <> p_user_id)
                and m.created_at > coalesce(
                  (select r.last_read_at
                     from public.conversation_reads r
                    where r.conversation_id = p.conversation_id and r.user_id = p_user_id),
                  '-infinity'::timestamptz)) as unread
    from (
      select f.conversation_id, f.until, f.note,
             c.status, c.contact_id, c.last_message_at
      from due_follow_ups f
      join conv c on c.id = f.conversation_id
      order by f.until asc, f.conversation_id asc
      limit greatest(p_limit, 0)
    ) p
  ),
  conv_overdue_task as (
    select distinct t.conversation_id
    from public.tasks t
    left join public.messages m on m.id = t.message_id
    where t.company_id = p_company_id
      and t.deleted_at is null
      and coalesce(m.done_at, t.done_at) is null
      and t.due_at is not null
      and t.due_at < p_now
  ),
  -- #306: the three conversation totals plus the deduplicated one, in a single
  -- pass. Each filter is its section's predicate copied VERBATIM — including
  -- the redundant status list on triage — so a total can never quietly mean
  -- something different from the rows beside it.
  conv_totals as (
    select
      count(*) filter (
        where c.assigned_user_id = p_user_id
          and c.status in ('open','waiting'))                as waiting_on_you,
      count(*) filter (
        where c.unread_mine)                                 as unread,
      count(*) filter (
        where c.assigned_user_id is null
          and c.status in ('new','open','waiting'))          as triage_conversations,
      -- One conversation, counted once, however many lenses it shows up in.
      count(*) filter (
        where (c.assigned_user_id = p_user_id
               and (c.status in ('open','waiting') or c.unread_mine))
           or (c.assigned_user_id is null
               and c.status in ('new','open','waiting')))     as distinct_conversations
    from conv c
  ),
  waiting_on_you as (
    select c.id, c.status, c.contact_id, c.assigned_user_id,
           c.last_message_at, c.unread_mine as unread,
           coalesce(c.id in (select conversation_id from conv_overdue_task), false)
             as has_overdue_task,
           case
             when c.id in (select conversation_id from conv_overdue_task) then 0
             when c.status = 'waiting'            then 1
             when c.unread_mine                   then 2
             else 3
           end as urgency
    from conv c
    where c.assigned_user_id = p_user_id
      and c.status in ('open','waiting')
    order by urgency asc, c.last_message_at desc, c.id desc
    limit greatest(p_limit, 0)
  ),
  -- #107: my_tasks is GLOBAL — no hidden-number filter (title + ids only).
  -- #306: split into an unlimited base and a limited presentation slice, so
  -- the total and the rows are the same query answered twice rather than two
  -- predicates that can drift.
  my_tasks_all as (
    -- #417: the task stays (it is this member's own work, and #107 keeps tasks
    -- global), but the TITLE is redacted when its conversation sits on a number
    -- this member is denied — the default title is the customer's message.
    select t.id,
           case
             when p_hidden_number_ids is not null
              and exists (
                    select 1 from public.conversations hc
                     where hc.id = t.conversation_id
                       and hc.phone_number_id = any(p_hidden_number_ids))
             then 'Task on a number you don''t have access to'
             else t.title
           end as title,
           t.conversation_id, t.message_id,
           t.assigned_user_id, t.due_at, t.created_at,
           (t.due_at is not null and t.due_at < p_now) as overdue
    from public.tasks t
    left join public.messages m on m.id = t.message_id
    where t.company_id = p_company_id
      and t.deleted_at is null
      and t.assigned_user_id = p_user_id
      and coalesce(m.done_at, t.done_at) is null
      -- #245/D137: a removed/refused provider occurrence is unresolved
      -- attention, not an ordinary unscheduled job in the member queue.
      -- Conflicts remain visible because they retain a usable local date.
      and not exists (
        select 1
          from public.task_calendar_links cal_hold
         where cal_hold.company_id = t.company_id
           and cal_hold.task_id = t.id
           and cal_hold.link_state in ('event_removed', 'refused'))
  ),
  my_tasks as (
    select * from my_tasks_all
    order by overdue desc, due_at asc nulls last, created_at asc, id asc
    limit greatest(p_limit, 0)
  ),
  unread as (
    select c.id, c.status, c.contact_id, c.assigned_user_id, c.last_message_at
    from conv c
    where c.unread_mine
    order by c.last_message_at desc, c.id desc
    limit greatest(p_limit, 0)
  ),
  triage_convs as (
    -- THE ONE THAT MATTERED: unclaimed work is the whole workspace, and its
    -- unread flag is shown rather than filtered on, so it waits for the limit.
    select p.*, exists (
             select 1
               from public.messages m
              where m.deleted_at is null and m.conversation_id = p.id
                and (m.sent_by_user_id is null or m.sent_by_user_id <> p_user_id)
                and m.created_at > coalesce(
                  (select r.last_read_at
                     from public.conversation_reads r
                    where r.conversation_id = p.id and r.user_id = p_user_id),
                  '-infinity'::timestamptz)) as unread
    from (
    select c.id, c.status, c.contact_id, c.last_message_at
    from conv c
    -- #416: no longer owner/admin-only. Reads from `conv`, which already
    -- carries the #106 hidden-number filter, so a restricted member sees
    -- unclaimed work only on numbers they can access.
    where c.assigned_user_id is null
      and c.status in ('new','open','waiting')
    order by c.last_message_at desc, c.id desc
    limit greatest(p_limit, 0)
    ) p
  ),
  -- #416: the old comment here said "triage is owner/admin-only, and leads are
  -- always unrestricted, so triage_tasks needs no number filter". The first
  -- clause is what made the second true, and it is no longer the first clause.
  -- A member CAN be restricted, so the filter below is now load-bearing — the
  -- same premise-shaped hole as #417, caught before shipping rather than after.
  triage_tasks_all as (
    select t.id, t.title, t.conversation_id, t.message_id,
           t.due_at, t.created_at,
           (t.due_at is not null and t.due_at < p_now) as overdue
    from public.tasks t
    left join public.messages m on m.id = t.message_id
    where t.company_id = p_company_id
      and t.deleted_at is null
      and t.assigned_user_id is null
      and coalesce(m.done_at, t.done_at) is null
      -- #106: unclaimed work on a number this member is denied is not theirs
      -- to claim, so it is hidden outright. (Their OWN assigned task keeps its
      -- row with a redacted title — #417 — because hiding somebody's own job
      -- from them helps nobody. Unclaimed work they cannot act on is noise.)
      and (p_hidden_number_ids is null or not exists (
             select 1 from public.conversations hc
              where hc.id = t.conversation_id
                and hc.phone_number_id = any(p_hidden_number_ids)))
  ),
  triage_tasks as (
    select * from triage_tasks_all
    order by overdue desc, due_at asc nulls last, created_at asc, id asc
    limit greatest(p_limit, 0)
  ),
  contact_map as (
    select ct.id,
           jsonb_build_object('id', ct.id, 'name', ct.name,
                              'phone_e164', ct.phone_e164) as j
    from public.contacts ct
    where ct.company_id = p_company_id
      and ct.id in (
        select contact_id from follow_ups
        union
        select contact_id from waiting_on_you
        union select contact_id from unread
        union select contact_id from triage_convs)
  )
  select jsonb_build_object(
    'waiting_on_you', coalesce((
      select jsonb_agg(jsonb_build_object(
               'conversation_id', w.id, 'status', w.status,
               'contact', cm.j, 'assigned_user_id', w.assigned_user_id,
               'last_message_at', w.last_message_at, 'unread', w.unread,
               'has_overdue_task', w.has_overdue_task, 'urgency', w.urgency)
               order by w.urgency asc, w.last_message_at desc, w.id desc)
      from waiting_on_you w left join contact_map cm on cm.id = w.contact_id),
      '[]'::jsonb),
    'my_tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'task_id', t.id, 'title', t.title,
               'conversation_id', t.conversation_id, 'message_id', t.message_id,
               'assigned_user_id', t.assigned_user_id, 'due_at', t.due_at,
               'overdue', t.overdue)
               order by t.overdue desc, t.due_at asc nulls last, t.created_at asc, t.id asc)
      from my_tasks t), '[]'::jsonb),
    'unread', coalesce((
      select jsonb_agg(jsonb_build_object(
               'conversation_id', u.id, 'status', u.status, 'contact', cm.j,
               'assigned_user_id', u.assigned_user_id,
               'last_message_at', u.last_message_at)
               order by u.last_message_at desc, u.id desc)
      from unread u left join contact_map cm on cm.id = u.contact_id),
      '[]'::jsonb),
    -- #416: present for EVERY member now, not only leads.
    -- #293: "a quote with no answer is the most valuable thing in the business
    -- to be reminded about". Its own section rather than folded into
    -- waiting_on_you, because the reason differs and the reason is the point —
    -- this is not "you have not answered them", it is "they have not answered
    -- you, and you asked to be told".
    'follow_ups', coalesce((
      select jsonb_agg(jsonb_build_object(
               'conversation_id', f.conversation_id, 'status', f.status,
               'contact', cm.j, 'last_message_at', f.last_message_at,
               'unread', f.unread, 'due_at', f.until, 'note', f.note)
               order by f.until asc, f.conversation_id asc)
      from follow_ups f left join contact_map cm on cm.id = f.contact_id),
      '[]'::jsonb),
    'triage', jsonb_build_object(
      'conversations', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'conversation_id', tc.id, 'status', tc.status, 'contact', cm.j,
                 'last_message_at', tc.last_message_at, 'unread', tc.unread)
                 order by tc.last_message_at desc, tc.id desc)
        from triage_convs tc left join contact_map cm on cm.id = tc.contact_id),
        '[]'::jsonb),
      'tasks', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'task_id', t.id, 'title', t.title,
                 'conversation_id', t.conversation_id, 'message_id', t.message_id,
                 'due_at', t.due_at, 'overdue', t.overdue)
                 order by t.overdue desc, t.due_at asc nulls last, t.created_at asc, t.id asc)
        from triage_tasks t), '[]'::jsonb)
    ),
    -- #306: what each section ACTUALLY holds, independent of the 20 returned.
    -- `distinct_work` is the headline number and is the only one a client
    -- should render as "N things need you" — the per-section totals overlap.
    'totals', (
      select jsonb_build_object(
        'waiting_on_you', ct.waiting_on_you,
        'my_tasks', (select count(*) from my_tasks_all),
        'unread', ct.unread,
        'triage_conversations', ct.triage_conversations,
        'triage_tasks', (select count(*) from triage_tasks_all),
        'follow_ups', (select count(*) from due_follow_ups),
        'distinct_work',
          ct.distinct_conversations
          + (select count(*) from my_tasks_all)
          + (select count(*) from triage_tasks_all)
          -- Only the ones no other lens already counted: a due follow-up on a
          -- thread that is also unread and assigned to me is ONE thing needing
          -- me, and `distinct_work` is the number a client renders as "N things
          -- need you".
          + (select count(*) from due_follow_ups f
              where not exists (
                select 1 from conv c
                 where c.id = f.conversation_id
                   and ((c.assigned_user_id = p_user_id
                         and (c.status in ('open','waiting') or c.unread_mine))
                     or (c.assigned_user_id is null
                         and c.status in ('new','open','waiting'))))))
      from conv_totals ct)
  )
$fn$;
create function pg_temp.old_list_conversations(
  p_company_id uuid,
  p_user_id uuid,
  p_limit integer,
  p_status text default null,
  p_assigned_user_id uuid default null,
  p_tag_id uuid default null,
  p_is_spam boolean default false,
  p_unread boolean default false,
  p_q text default null,
  p_cursor_ts timestamptz default null,
  p_cursor_id uuid default null,
  p_pinned text default null,
  p_hidden_number_ids uuid[] default null,
  p_snoozed text default 'exclude',
  p_awaiting text default null
)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $fn$

  -- THE PAGE, chosen with nothing hanging off it. Only the id is carried out:
  -- the decoration below re-reads the row by primary key, which keeps
  -- to_jsonb(c.*) exactly the shape it has always been rather than one carrying
  -- whatever this query needed in order to sort.
  --
  -- contacts is joined here only because the search filter reads the contact's
  -- name and number, and conversation_snoozes only because the deferral filter
  -- reads it. Both are needed to CHOOSE the page, so both stay.
  with page as (
    select c.id, c.last_message_at, c.pinned_at
    from public.conversations c
    -- The deferral is THIS member's. A colleague's snooze must not appear on
    -- their row, and must not hide the thread from them.
    left join public.conversation_snoozes sz
      on sz.conversation_id = c.id
     and sz.user_id = p_user_id
     and sz.until > now()
    where c.company_id = p_company_id
      and c.deleted_at is null
      and c.is_spam = coalesce(p_is_spam, false)
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
      and (p_status is null or c.status = p_status::public.conversation_status)
      and (p_assigned_user_id is null or c.assigned_user_id = p_assigned_user_id)
      and (p_tag_id is null or exists (
            select 1 from public.conversation_tags cx
             where cx.conversation_id = c.id and cx.tag_id = p_tag_id))
      and (not coalesce(p_unread, false) or exists (
            select 1
              from public.messages m
             where m.deleted_at is null and m.conversation_id = c.id
               and (m.sent_by_user_id is null or m.sent_by_user_id <> p_user_id)
               and m.created_at > coalesce(
                 (select r.last_read_at
                    from public.conversation_reads r
                   where r.conversation_id = c.id and r.user_id = p_user_id),
                 '-infinity'::timestamptz)))
      -- A SEMI-JOIN, not a join plus a disjunct over its columns. Written the
      -- other way this clause mentioned `contacts`, so the planner could not
      -- separate the join from the filter: it had to build the join for the whole
      -- workspace and then take the top thirty by sorting all of it. Measured at
      -- 50k conversations, that one difference is 156ms against 0.65ms, because
      -- this shape lets the ordered index below do the work instead.
      and (p_q is null
           or c.contact_id in (
                select ct.id
                  from public.contacts ct
                 where ct.name ilike ('%' || p_q || '%')
                    or ct.phone_e164 ilike ('%' || p_q || '%')))
      -- #13 pinned filter: 'only' keeps pinned, 'exclude' drops them, null = all.
      and (p_pinned is null
           or (p_pinned = 'only'    and c.pinned_at is not null)
           or (p_pinned = 'exclude' and c.pinned_at is null))
      -- #508: threads still waiting on a first reply. awaiting_reply_since is the
      -- #388 lead clock, trigger-maintained on every message: set on the first
      -- inbound of a new or reopened thread, cleared by a human outbound. Reading
      -- it here rather than deriving a second "needs a reply" predicate is what
      -- makes the three clients agree by construction — and it is the LIVE twin
      -- of the number the response-time card reports, which counts leads with no
      -- response. status='new' was neither: nothing moves a conversation off it
      -- when the crew replies, so it means "nobody re-filed this" rather than
      -- "nobody answered this".
      and (p_awaiting is null
           or p_awaiting not in ('only', 'exclude')
           or (p_awaiting = 'only'    and c.awaiting_reply_since is not null)
           or (p_awaiting = 'exclude' and c.awaiting_reply_since is null))
      -- #293 deferral: 'exclude' (the DEFAULT) hides what this member deferred,
      -- 'only' is the "what did I defer" view, 'all' opts out entirely. An
      -- unrecognised value falls through to showing everything rather than hiding
      -- a thread on a typo — the failure that costs a customer is the one where a
      -- thread disappears.
      and (p_snoozed is null
           or p_snoozed not in ('exclude', 'only')
           or (p_snoozed = 'exclude' and sz.conversation_id is null)
           or (p_snoozed = 'only'    and sz.conversation_id is not null))
      -- The keyset cursor rides (last_message_at, id) — untouched by pinning, so
      -- the 'exclude' main list paginates exactly as before.
      and (p_cursor_ts is null
           or (c.last_message_at, c.id) < (p_cursor_ts, p_cursor_id))
    -- 'only' sorts most-recently-pinned first; every other mode falls straight
    -- through to the legacy (last_message_at, id) order.
    order by (case when p_pinned = 'only' then c.pinned_at end) desc nulls last,
             c.last_message_at desc, c.id desc
    limit greatest(p_limit, 0)
  )
  -- THE DECORATION, thirty times rather than fifty thousand. The ORDER BY is
  -- restated because the order inside a CTE is not something the outer query
  -- inherits, and this list's order is the product.
  select (to_jsonb(c.*) - 'last_notified_at')
    || jsonb_build_object(
         'contact', jsonb_build_object(
           'id', ct.id, 'name', ct.name, 'phone_e164', ct.phone_e164),
         'tags', coalesce(
           (select jsonb_agg(
                     jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color)
                     order by t.name)
              from public.conversation_tags cx
              join public.tags t on t.id = cx.tag_id
             where cx.conversation_id = c.id),
           '[]'::jsonb),
         -- #293: when THIS member has deferred it, when it comes back and why.
         -- Carried on every row rather than only in the snoozed view, so a thread
         -- that returns mid-session can be labelled without a second read, and so
         -- the snoozed list needs no join of its own.
         'snoozed_until', sz.until,
         'snooze_note', sz.note,
         'unread', exists (
           select 1
             from public.messages m
            where m.deleted_at is null and m.conversation_id = c.id
              and (m.sent_by_user_id is null or m.sent_by_user_id <> p_user_id)
              and m.created_at > coalesce(
                (select r.last_read_at
                   from public.conversation_reads r
                  where r.conversation_id = c.id and r.user_id = p_user_id),
                '-infinity'::timestamptz)),
         'last_message', case when lm.id is null then null else
           jsonb_build_object(
             'id', lm.id,
             'direction', lm.direction,
             'body', left(lm.body, 160),
             'created_at', lm.created_at,
             'has_attachments', lm.attachment_count > 0,
             'attachment_count', lm.attachment_count,
             'attachment_kind', lm.attachment_kind)
         end)
  from page
  join public.conversations c on c.id = page.id
  join public.contacts ct on ct.id = c.contact_id
  left join public.conversation_snoozes sz
    on sz.conversation_id = c.id
   and sz.user_id = p_user_id
   and sz.until > now()
  left join lateral (
    select m.id, m.direction, m.body, m.created_at,
           att.attachment_count, att.attachment_kind
    from public.messages m
    left join lateral (
      select count(*)::int as attachment_count,
             case
               when count(*) filter (where a.content_type like 'image/%') > 0
                 then 'image'
               when count(*) filter (where a.content_type like 'audio/%') > 0
                 then 'audio'
               when count(*) filter (where a.content_type like 'video/%') > 0
                 then 'video'
               when count(*) > 0 then 'file'
               else null
             end as attachment_kind
        from public.message_attachments a
       where a.message_id = m.id
    ) att on true
    where m.conversation_id = c.id
      and m.deleted_at is null
    order by m.created_at desc, m.id desc
    limit 1
  ) lm on true
  order by (case when p_pinned = 'only' then c.pinned_at end) desc nulls last,
           c.last_message_at desc, c.id desc
$fn$;

do $$
declare
  users uuid[] := array[
    'b6980000-0000-4000-8000-000000000001'::uuid,
    'b6980000-0000-4000-8000-000000000002'::uuid,
    'b6980000-0000-4000-8000-000000000003'::uuid,
    'b6980000-0000-4000-8000-000000000004'::uuid];
  co uuid := 'b6980000-0000-4000-8000-000000000010';
  hidden uuid[];
  u uuid;
  h int;
  lim int;
  unr boolean;
  oldj jsonb;
  newj jsonb;
  olds jsonb[];
  news jsonb[];
  checked int := 0;
  nonempty int := 0;
  unread_seen int := 0;
begin
  foreach u in array users loop
    for h in 0..1 loop
      hidden := case h when 0 then null
                else array['b6980000-0000-4000-8000-000000000021'::uuid] end;
      foreach lim in array array[2, 20] loop
        oldj := pg_temp.old_for_you(co, u, now(), lim, hidden);
        newj := public.api_for_you(co, u, now(), lim, hidden);
        if oldj is distinct from newj then
          raise exception 'UB-3 FAILED: api_for_you differs for member % hidden % limit %:% old % new %',
            u, h, lim, E'\n', oldj, newj;
        end if;
        checked := checked + 1;
        if jsonb_array_length(newj->'waiting_on_you') + jsonb_array_length(newj->'unread')
           + jsonb_array_length(newj->'triage'->'conversations') > 0 then
          nonempty := nonempty + 1;
        end if;
        unread_seen := unread_seen + (newj->'totals'->>'unread')::int;
      end loop;

      foreach unr in array array[false, true] loop
        select coalesce(array_agg(j), '{}') into olds
          from pg_temp.old_list_conversations(co, u, 50, null, null, null, false,
                 unr, null, null, null, null, hidden, 'all', null) j;
        select coalesce(array_agg(j), '{}') into news
          from public.api_list_conversations(co, u, 50, null, null, null, false,
                 unr, null, null, null, null, hidden, 'all', null) j;
        if olds is distinct from news then
          raise exception 'UB-3 FAILED: api_list_conversations differs for member % hidden % unread %',
            u, h, unr;
        end if;
        checked := checked + 1;
      end loop;
    end loop;
  end loop;

  -- The comparison must have had something to compare.
  if nonempty < 8 or unread_seen < 4 then
    raise exception 'UB-3 FAILED: the fixture is too thin to prove anything (% non-empty reads, % unread in total)',
      nonempty, unread_seen;
  end if;
  raise notice 'UB-3 PASSED: % old/new comparisons identical (% with rows, % unread in totals)',
    checked, nonempty, unread_seen;
end $$;

-- ===========================================================================
-- UB-4. Not reachable by a client.
-- ===========================================================================
do $$
begin
  if has_table_privilege('anon', 'public.conversation_unread_basis', 'select')
     or has_table_privilege('authenticated', 'public.conversation_unread_basis', 'select')
     or has_table_privilege('authenticated', 'public.conversation_unread_basis', 'insert')
     or has_table_privilege('authenticated', 'public.conversation_unread_basis', 'update')
     or has_table_privilege('authenticated', 'public.conversation_unread_basis', 'delete') then
    raise exception 'UB-4 FAILED: a client role can reach conversation_unread_basis';
  end if;
  if not has_table_privilege('service_role', 'public.conversation_unread_basis', 'select') then
    raise exception 'UB-4 FAILED: service_role cannot read conversation_unread_basis';
  end if;
  if not (select relrowsecurity from pg_class
           where oid = 'public.conversation_unread_basis'::regclass) then
    raise exception 'UB-4 FAILED: row level security is off';
  end if;
  if exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('unread_basis_add', 'unread_basis_refresh',
                         'unread_basis_may_change', 'messages_unread_basis_insert',
                         'messages_unread_basis_update', 'messages_unread_basis_delete')
       and (has_function_privilege('anon', p.oid, 'execute')
         or has_function_privilege('authenticated', p.oid, 'execute'))) then
    raise exception 'UB-4 FAILED: a client role can execute a maintenance function';
  end if;
  raise notice 'UB-4 PASSED: clients cannot touch the table or its functions';
end $$;

rollback;
