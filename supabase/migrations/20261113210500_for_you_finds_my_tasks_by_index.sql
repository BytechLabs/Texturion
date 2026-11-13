-- For You finds "my tasks" through task_assignees_user_idx.
--
-- D155 (20261111140000_task_assignees_readers.sql) made a task mine when I am
-- on its crew: `exists (select 1 from task_assignees tas where tas.task_id =
-- t.id and tas.user_id = p_user_id)`. Neither index on task_assignees serves
-- that from the member's side: the primary key (task_id, user_id) can only be
-- probed once per task, and task_assignees_user_idx (company_id, user_id,
-- task_id) needs company_id to start. So my_tasks either walked every live task
-- the workspace has or read every workspace's crew rows.
--
-- Both tests now also say `tas.company_id = p_company_id`, which is the exact
-- (company_id, user_id) range on task_assignees_user_idx. It changes no
-- answer: task_assignees.company_id is always the task's own. Every writer
-- copies it from the task (20261111130000_task_assignees.sql: the backfill at
-- :46, task_set_assignees at :119, tasks_mirror_assigned_user at :349 and
-- offboard_member at :1189, whose tasks are already filtered to p_company_id),
-- and t.company_id = p_company_id is already required beside each test.
--
-- Each function is copied from its latest definition with only that test
-- changed.

-- api_for_you, from 20261111140000_task_assignees_readers.sql.
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
      and exists (select 1 from public.task_assignees tas where tas.task_id = t.id and tas.user_id = p_user_id and tas.company_id = p_company_id)
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

-- api_member_holdings, from 20261111140000_task_assignees_readers.sql.
create or replace function public.api_member_holdings(
  p_company_id uuid,
  p_user_id    uuid
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'conversations', (
      select count(*) from public.conversations c
       where c.company_id = p_company_id
         and c.assigned_user_id = p_user_id
         and c.closed_at is null
    ),
    'tasks', (
      select count(*) from public.tasks t
        left join public.messages m on m.id = t.message_id
       where t.company_id = p_company_id
         and exists (select 1 from public.task_assignees tas where tas.task_id = t.id and tas.user_id = p_user_id and tas.company_id = p_company_id)
         and t.deleted_at is null
         and coalesce(m.done_at, t.done_at) is null
    )
  );
$$;

revoke execute on function public.api_member_holdings(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.api_member_holdings(uuid, uuid)
  to service_role;
