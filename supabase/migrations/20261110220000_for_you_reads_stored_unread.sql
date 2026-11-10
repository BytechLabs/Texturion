-- #698: "is this conversation unread for this member" is stored, not scanned.
--
-- The For You read decided unread by probing `messages` once for every open
-- conversation the member owns: 5.5 ms of its 8 ms base at 1,250 conversations,
-- and the one part that grows with the workspace. The answer is cheap to keep:
--
--   unread(member, conversation) =
--     the newest undeleted message NOT sent by that member is newer than the
--     member's last_read_at (or they have never read it).
--
-- "The newest message not sent by that member" only ever has two possible
-- values for a conversation: the newest message overall, or, when that one was
-- the member's own, the newest message from anyone else. So the state is ONE
-- row PER CONVERSATION holding those two timestamps and who wrote the newest:
--
--   latest_at / latest_by  newest undeleted message and its sender (null for a
--                          customer or the system, which is "not this member"
--                          for everyone)
--   other_at               newest undeleted message whose sender is not
--                          latest_by (null if there is none)
--
-- A reader asks `case when latest_by is distinct from me then latest_at else
-- other_at end > my last_read_at`. Read state stays where it was
-- (conversation_reads), so a read costs nothing new and nothing here is written
-- when somebody reads.
--
-- WHY NOT A ROW PER MEMBER. That shape writes one row per member who can see the
-- thread on every inbound message, and a per-member unread counter is one row
-- that EVERY inbound message in the workspace updates. At the 40 inbound
-- messages a second CAPACITY.md 2e measured, a five-member crew is 200 writes a
-- second, and each member's counter row is a lock that all 40 inserts a second
-- queue on until their commits. Here an inbound message writes one row, its
-- own conversation's, in the transaction that already updates that
-- conversation's last_message_at, so the only writers that ever wait on each
-- other are two messages in the same thread, which already wait on the
-- conversation row. The write does not grow with crew size either. The row is
-- updated without touching an indexed column (HOT) and the fillfactor leaves
-- room on the page for it.
--
-- WHAT KEEPS IT EQUAL TO THE COMPUTED ANSWER. Triggers on `messages`:
--   insert of an undeleted message   folded in, no read of other rows
--   a message restored (deleted_at -> null)   folded in the same way
--   a message trashed or deleted     recomputed from `messages`, but only when
--                                    the message is old enough to be one of the
--                                    two tracked ones (older than other_at, or
--                                    than latest_at when there is no other_at,
--                                    it cannot be)
--   sender, created_at or conversation changed   recomputed (both conversations)
-- A recompute takes the state row's lock BEFORE it reads `messages`, so an
-- insert committing meanwhile is either seen by the read or applied after it;
-- neither can be lost. Nothing else feeds the answer: assignment, closing,
-- spam, snoozing and number access are read from the conversation when it is
-- read, never stored here, and reads are conversation_reads, untouched.
-- supabase/tests/for_you_unread.test.sql compares the stored answer with the
-- old computed definition after every step of a randomised sequence.
--
-- The backfill runs in this transaction, after the triggers exist, and the
-- trigger DDL holds a lock that stops an insert slipping between the two.
--
-- TWO MORE CHANGES TO api_for_you, because measuring showed the stored unread
-- alone moves little (a probe of a short thread costs what a primary key lookup
-- costs) and the rest of the time was elsewhere:
--   * It is plpgsql, so its plan is kept between calls. As a SQL function it was
--     planned on every call: 6.7 ms of 25 on Micro.
--   * "Is this job done" reads the linked message by primary key for each
--     candidate task, instead of joining `messages`. Where the planner chose a
--     hash join it read the whole table twice per call.

create table public.conversation_unread_basis (
  conversation_id uuid primary key
    references public.conversations(id) on delete cascade,
  company_id      uuid not null references public.companies(id) on delete restrict,
  latest_at       timestamptz not null,
  latest_by       uuid,
  other_at        timestamptz
) with (fillfactor = 70);

alter table public.conversation_unread_basis enable row level security;
revoke all on public.conversation_unread_basis from public, anon, authenticated;
grant select, insert, update, delete on public.conversation_unread_basis to service_role;

comment on table public.conversation_unread_basis is
  '#698: per conversation, the newest undeleted message and the newest one by '
  'somebody other than its sender, which is all it takes to answer "is this '
  'unread for member M" against conversation_reads. Maintained by triggers on '
  'messages; never written by a route. Cascades with the conversation, so the '
  'workspace purge reaches it.';

-- Fold one undeleted message into the state. A concurrent writer for the same
-- conversation waits on the row, and the update reads the committed row.
create function public.unread_basis_add(
  p_conversation_id uuid,
  p_company_id uuid,
  p_at timestamptz,
  p_by uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.conversation_unread_basis as b
    (conversation_id, company_id, latest_at, latest_by, other_at)
  values (p_conversation_id, p_company_id, p_at, p_by, null)
  on conflict (conversation_id) do update set
    latest_at = case when p_at >= b.latest_at then p_at else b.latest_at end,
    latest_by = case when p_at >= b.latest_at then p_by else b.latest_by end,
    other_at = case
      -- The new message is the newest: the old newest becomes "somebody else's"
      -- when the sender changed, and stays what it was when it did not.
      when p_at >= b.latest_at then
        case when p_by is distinct from b.latest_by
             then b.latest_at else b.other_at end
      -- An older message only matters if it is by someone other than the newest
      -- sender and newer than the other we already hold.
      when p_by is distinct from b.latest_by
           and p_at > coalesce(b.other_at, '-infinity'::timestamptz)
        then p_at
      else b.other_at
    end;
$$;

-- Rebuild one conversation's state from its messages.
create function public.unread_basis_refresh(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_at      timestamptz;
  v_by      uuid;
  v_other   timestamptz;
begin
  select c.company_id into v_company
    from public.conversations c where c.id = p_conversation_id;
  if not found then
    return;                  -- the conversation is going; the cascade has the row
  end if;

  -- The lock first. A message inserted by a transaction that has not committed
  -- holds this row, so we wait for it and the reads below see it; one that
  -- arrives after waits for us and folds itself in over what we write.
  insert into public.conversation_unread_basis as b
    (conversation_id, company_id, latest_at, latest_by, other_at)
  values (p_conversation_id, v_company, '-infinity'::timestamptz, null, null)
  on conflict (conversation_id) do update set company_id = excluded.company_id;

  select m.created_at, m.sent_by_user_id into v_at, v_by
    from public.messages m
   where m.conversation_id = p_conversation_id and m.deleted_at is null
   order by m.created_at desc
   limit 1;
  if not found then
    delete from public.conversation_unread_basis
     where conversation_id = p_conversation_id;
    return;
  end if;

  select m.created_at into v_other
    from public.messages m
   where m.conversation_id = p_conversation_id and m.deleted_at is null
     and m.sent_by_user_id is distinct from v_by
   order by m.created_at desc
   limit 1;

  update public.conversation_unread_basis
     set latest_at = v_at, latest_by = v_by, other_at = v_other
   where conversation_id = p_conversation_id;
end;
$$;

-- Could taking this message away change the state? Only if it is at least as new
-- as the older of the two tracked timestamps.
create function public.unread_basis_may_change(
  p_conversation_id uuid,
  p_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.conversation_unread_basis b
     where b.conversation_id = p_conversation_id
       and p_at >= coalesce(b.other_at, b.latest_at));
$$;

create function public.messages_unread_basis_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.unread_basis_add(
    new.conversation_id, new.company_id, new.created_at, new.sent_by_user_id);
  return null;
end;
$$;

create function public.messages_unread_basis_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.conversation_id is distinct from new.conversation_id then
    perform public.unread_basis_refresh(old.conversation_id);
    perform public.unread_basis_refresh(new.conversation_id);
  elsif old.deleted_at is not null and new.deleted_at is null then
    -- Restored: it is a message again, folded in like an arriving one.
    perform public.unread_basis_add(
      new.conversation_id, new.company_id, new.created_at, new.sent_by_user_id);
  elsif old.deleted_at is null and new.deleted_at is not null then
    if public.unread_basis_may_change(old.conversation_id, old.created_at) then
      perform public.unread_basis_refresh(old.conversation_id);
    end if;
  elsif new.deleted_at is null then
    -- Still undeleted, but its sender or its time moved.
    perform public.unread_basis_refresh(new.conversation_id);
  end if;
  return null;
end;
$$;

create function public.messages_unread_basis_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.unread_basis_may_change(old.conversation_id, old.created_at) then
    perform public.unread_basis_refresh(old.conversation_id);
  end if;
  return null;
end;
$$;

revoke all on function public.unread_basis_add(uuid, uuid, timestamptz, uuid),
  public.unread_basis_refresh(uuid),
  public.unread_basis_may_change(uuid, timestamptz),
  public.messages_unread_basis_insert(),
  public.messages_unread_basis_update(),
  public.messages_unread_basis_delete()
  from public, anon, authenticated;

create trigger messages_unread_basis_insert
  after insert on public.messages
  for each row when (new.deleted_at is null)
  execute function public.messages_unread_basis_insert();

create trigger messages_unread_basis_update
  after update on public.messages
  for each row when (
    old.deleted_at is distinct from new.deleted_at
    or old.conversation_id is distinct from new.conversation_id
    or old.sent_by_user_id is distinct from new.sent_by_user_id
    or old.created_at is distinct from new.created_at)
  execute function public.messages_unread_basis_update();

create trigger messages_unread_basis_delete
  after delete on public.messages
  for each row when (old.deleted_at is null)
  execute function public.messages_unread_basis_delete();

-- Backfill: the same two values, for every conversation that has a message.
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
     where m.deleted_at is null
     order by m.conversation_id, m.created_at desc
  ) l;

-- ---------------------------------------------------------------------------
-- The readers. Each is the latest definition with only the unread test changed.
-- ---------------------------------------------------------------------------

create or replace function public.api_for_you(
  p_company_id uuid,
  p_user_id uuid,
  p_now timestamptz,
  p_limit integer default 20,
  p_hidden_number_ids uuid[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
-- #698: plpgsql, not sql, so the plan is kept between calls. A SQL function is
-- planned again on every call, and this query's planning was a third of its time.
begin
  return (

  with
  conv as (
    select c.id, c.status, c.contact_id, c.assigned_user_id, c.last_message_at,
           c.unread_mine
    -- #306: every consumer below wants mine, or unassigned. Anything else was
    -- computed and thrown away.
    -- #416: "or unassigned" used to be "or, if you are a lead, unassigned" —
    -- the deepest of the four gates, and the one that made a member's triage
    -- section come back empty rather than absent.
    -- #698: two branches, so each is an exact index condition.
    from (
      -- #698: the stored unread state, looked up by primary key for each of the
      -- member's own rows (a correlated probe, so its cost follows the member's
      -- conversations and never the size of the table). A row somebody else owns
      -- never uses the answer, so it is not read.
      select k.id, k.status, k.contact_id, k.assigned_user_id,
             k.last_message_at, k.phone_number_id,
             coalesce((
             select case when b.latest_by is distinct from p_user_id
                         then b.latest_at else b.other_at end
                    > coalesce(r.last_read_at, '-infinity'::timestamptz)
               from public.conversation_unread_basis b
               left join public.conversation_reads r
                 on r.conversation_id = b.conversation_id and r.user_id = p_user_id
              where b.conversation_id = k.id), false) as unread_mine
        from public.conversations k
       where k.company_id = p_company_id
         and k.is_spam = false
         and k.closed_at is null
         and k.assigned_user_id = p_user_id
      union all
      select k.id, k.status, k.contact_id, k.assigned_user_id,
             k.last_message_at, k.phone_number_id,
             false as unread_mine
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
    select p.*, coalesce((
             select case when b.latest_by is distinct from p_user_id
                         then b.latest_at else b.other_at end
                    > coalesce(r.last_read_at, '-infinity'::timestamptz)
               from public.conversation_unread_basis b
               left join public.conversation_reads r
                 on r.conversation_id = b.conversation_id and r.user_id = p_user_id
              where b.conversation_id = p.conversation_id), false) as unread
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
    where t.company_id = p_company_id
      and t.deleted_at is null
      and coalesce((select m.done_at from public.messages m
                      where m.id = t.message_id), t.done_at) is null
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
    where t.company_id = p_company_id
      and t.deleted_at is null
      and t.assigned_user_id = p_user_id
      and coalesce((select m.done_at from public.messages m
                      where m.id = t.message_id), t.done_at) is null
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
    select p.*, coalesce((
             select case when b.latest_by is distinct from p_user_id
                         then b.latest_at else b.other_at end
                    > coalesce(r.last_read_at, '-infinity'::timestamptz)
               from public.conversation_unread_basis b
               left join public.conversation_reads r
                 on r.conversation_id = b.conversation_id and r.user_id = p_user_id
              where b.conversation_id = p.id), false) as unread
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
    where t.company_id = p_company_id
      and t.deleted_at is null
      and t.assigned_user_id is null
      and coalesce((select m.done_at from public.messages m
                      where m.id = t.message_id), t.done_at) is null
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
  );
end;
$fn$;

revoke execute on function public.api_for_you(uuid, uuid, timestamptz, integer, uuid[])
  from public, anon, authenticated;
grant execute on function public.api_for_you(uuid, uuid, timestamptz, integer, uuid[])
  to service_role;

create or replace function public.api_list_conversations(
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
      and (not coalesce(p_unread, false) or coalesce((
             select case when b.latest_by is distinct from p_user_id
                         then b.latest_at else b.other_at end
                    > coalesce(r.last_read_at, '-infinity'::timestamptz)
               from public.conversation_unread_basis b
               left join public.conversation_reads r
                 on r.conversation_id = b.conversation_id and r.user_id = p_user_id
              where b.conversation_id = c.id), false))
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
         'unread', coalesce((
             select case when b.latest_by is distinct from p_user_id
                         then b.latest_at else b.other_at end
                    > coalesce(r.last_read_at, '-infinity'::timestamptz)
               from public.conversation_unread_basis b
               left join public.conversation_reads r
                 on r.conversation_id = b.conversation_id and r.user_id = p_user_id
              where b.conversation_id = c.id), false),
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

revoke execute on function public.api_list_conversations(uuid, uuid, integer, text, uuid, uuid, boolean, boolean, text, timestamptz, uuid, text, uuid[], text, text)
  from public, anon, authenticated;
grant execute on function public.api_list_conversations(uuid, uuid, integer, text, uuid, uuid, boolean, boolean, text, timestamptz, uuid, text, uuid[], text, text)
  to service_role;
