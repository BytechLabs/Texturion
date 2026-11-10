-- [#689 C] The readers and the calendar learn that a task has a crew.
--
-- tasks.assigned_user_id is still the first assignee (see 20261111130000), so a
-- reader that only wants "the" assignee, or "nobody", needs no change. What
-- changes is every test that asked "is this member THE assignee": it now asks
-- whether the member is ON the task.
--
--   * the calendar outbox: each assignee's connection gets the event, and a
--     person taken off loses theirs (unlink), per connection as before;
--   * For You: a task is mine when I am on it, and unassigned when nobody is;
--   * a departing member's open-task count;
--   * the connect-time seed of a new calendar connection.
--
-- Each function is copied from its latest definition with only those tests
-- changed.

-- api_for_you, from 20261110220000_for_you_reads_stored_unread.sql: the assignee tests read task_assignees.
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
      and exists (select 1 from public.task_assignees tas where tas.task_id = t.id and tas.user_id = p_user_id)
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

-- api_member_holdings, from 20261110100000_call_anchored_tasks.sql: the assignee tests read task_assignees.
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
         and exists (select 1 from public.task_assignees tas where tas.task_id = t.id and tas.user_id = p_user_id)
         and t.deleted_at is null
         and coalesce(m.done_at, t.done_at) is null
    )
  );
$$;

-- api_fire_scheduled_message, from 20261110100000_call_anchored_tasks.sql: the assignee tests read task_assignees.
create or replace function public.api_fire_scheduled_message(
  p_id                uuid,
  p_segments_estimate integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_probe           public.scheduled_messages%rowtype;
  v_scheduled       public.scheduled_messages%rowtype;
  v_message         public.messages%rowtype;
  v_task            public.tasks%rowtype;
  v_source_done_at  timestamptz;
  v_calendar_backed boolean := false;
  v_calendar_safe   boolean := true;
  v_now             timestamptz := now();
begin
  -- Identity probe only.  The authoritative row is locked after the calendar
  -- serialization rows so provider apply keeps connection->link->outbox->send
  -- ordering and cannot deadlock this transaction.
  select * into v_probe
    from public.scheduled_messages s
   where s.id = p_id and s.status in ('pending', 'held');
  if not found then
    return jsonb_build_object('outcome', 'gone');
  end if;

  if v_probe.origin = 'reminder' and v_probe.task_id is not null then
    -- Serializes OAuth completion/workspace closure with the no-link case.
    perform 1 from public.companies co
     where co.id = v_probe.company_id
     for update;

    -- Include the assigned member's connection even before its first link,
    -- plus every connection named by a mapping or live outbox intent.
    perform 1
      from public.calendar_connections c
     where c.company_id = v_probe.company_id
       and (
         c.user_id in (
           select a.user_id from public.task_assignees a
            where a.task_id = v_probe.task_id and a.company_id = v_probe.company_id
         )
         or exists (
           select 1 from public.task_calendar_links l
            where l.company_id = v_probe.company_id
              and l.task_id = v_probe.task_id
              and l.connection_id = c.id
              and l.link_state <> 'unlinked'
         )
         or exists (
           select 1 from public.calendar_outbox o
            where o.company_id = v_probe.company_id
              and o.task_id = v_probe.task_id
              and o.connection_id = c.id
              and o.state in ('queued', 'leased')
         )
       )
     order by c.id
     for update;
    perform 1
      from public.task_calendar_links l
     where l.company_id = v_probe.company_id
       and l.task_id = v_probe.task_id
       and l.link_state <> 'unlinked'
     order by l.id
     for update;
    select * into v_task
      from public.tasks t
     where t.id = v_probe.task_id and t.company_id = v_probe.company_id
     for update;
    if found then
      select m.done_at into v_source_done_at
        from public.messages m
       where m.id = v_task.message_id and m.company_id = v_probe.company_id
       for update;
    end if;
    perform 1
      from public.calendar_outbox o
     where o.company_id = v_probe.company_id
       and o.task_id = v_probe.task_id
       and o.state in ('queued', 'leased')
     order by o.id
     for update;
  end if;

  select * into v_scheduled
    from public.scheduled_messages s
   where s.id = p_id
     and s.status in ('pending', 'held')
   for update;
  if not found then
    return jsonb_build_object('outcome', 'gone');
  end if;

  if v_scheduled.origin = 'reminder' and v_scheduled.task_id is not null then
    if v_task.id is null
       or v_task.deleted_at is not null
       or v_task.reminders_off
       or v_task.due_at is null
       or coalesce(v_source_done_at, v_task.done_at) is not null then
      update public.scheduled_messages s
         set status = 'failed',
             held_reason = 'The job is no longer scheduled.',
             held_reason_key = 'job_no_longer_scheduled',
             claimed_at = null,
             updated_at = v_now
       where s.id = p_id
      returning * into v_scheduled;
      return jsonb_build_object(
        'outcome', 'failed',
        'reason_key', 'job_no_longer_scheduled',
        'scheduled_message', to_jsonb(v_scheduled)
      );
    end if;

    v_calendar_backed := exists (
      select 1 from public.calendar_outbox o
       where o.company_id = v_scheduled.company_id
         and o.task_id = v_scheduled.task_id
         and o.state in ('queued', 'leased')
    ) or exists (
      select 1 from public.task_calendar_links l
       where l.company_id = v_scheduled.company_id
         and l.task_id = v_scheduled.task_id
         and l.link_state <> 'unlinked'
    );

    if v_calendar_backed then
      v_calendar_safe := exists (
        select 1 from public.companies co
         where co.id = v_scheduled.company_id and co.deleted_at is null
      )
      and not exists (
        select 1 from public.calendar_outbox o
         where o.company_id = v_scheduled.company_id
           and o.task_id = v_scheduled.task_id
           and o.state in ('queued', 'leased')
      )
      and not exists (
        select 1
          from public.task_calendar_links l
          left join public.calendar_connections c
            on c.id = l.connection_id and c.company_id = l.company_id
         where l.company_id = v_scheduled.company_id
           and l.task_id = v_scheduled.task_id
           and l.link_state <> 'unlinked'
           and (
             l.link_state <> 'active'
             or c.id is null
             or c.status <> 'active'
             or c.revoked_at is not null
             or c.last_verified_at is null
             or c.last_verified_at < v_now - interval '15 minutes'
             or (c.sync_due_at is not null and c.sync_due_at <= v_now)
             or c.pull_lease_owner is not null
           )
      );
    end if;

    if v_calendar_backed and not v_calendar_safe then
      update public.scheduled_messages s
         set status = 'held',
             held_reason = 'Calendar verification is pending.',
             held_reason_key = 'calendar_unverified',
             held_at = coalesce(s.held_at, v_now),
             claimed_at = null,
             updated_at = v_now
       where s.id = p_id
      returning * into v_scheduled;
      return jsonb_build_object(
        'outcome', 'held',
        'reason_key', 'calendar_unverified',
        'scheduled_message', to_jsonb(v_scheduled)
      );
    end if;
  end if;

  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments,
     sent_by_user_id)
  values
    (v_scheduled.company_id, v_scheduled.conversation_id, 'outbound',
     v_scheduled.body, 'queued', p_segments_estimate, v_scheduled.created_by)
  returning * into v_message;

  update public.scheduled_messages s
     set status = 'sent',
         sent_message_id = v_message.id,
         held_reason = null,
         held_reason_key = null,
         updated_at = v_now
   where s.id = p_id;

  return jsonb_build_object(
    'outcome', 'fired', 'message', to_jsonb(v_message)
  );
end $$;

-- api_resolve_calendar_event_removed, from 20261110100000_call_anchored_tasks.sql: the assignee tests read task_assignees.
create or replace function public.api_resolve_calendar_event_removed(
  p_company_id uuid,
  p_user_id    uuid,
  p_link_id    uuid,
  p_answer     text,
  p_new_due_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link       public.task_calendar_links%rowtype;
  v_connection public.calendar_connections%rowtype;
  v_connection_id uuid;
  v_task       public.tasks%rowtype;
  v_snapshot   jsonb;
  v_outbox_id  uuid;
  v_generation bigint;
  v_prior_actor text := coalesce(current_setting('loonext.schedule_actor', true), '');
begin
  if p_answer not in ('cancelled', 'moved', 'not_sure') then
    raise exception 'calendar removed-event answer must be cancelled, moved or not_sure';
  end if;
  if not exists (
    select 1 from public.company_members m
     where m.company_id = p_company_id and m.user_id = p_user_id
       and m.deactivated_at is null
  ) then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  select c.id into v_connection_id
    from public.task_calendar_links l
    join public.calendar_connections c on c.id = l.connection_id
    join public.tasks t on t.id = l.task_id and t.company_id = l.company_id
   where l.id = p_link_id and l.company_id = p_company_id
     and c.user_id = p_user_id and l.link_state = 'event_removed'
     and public.calendar_task_access_allowed(
       p_user_id, t.company_id, t.conversation_id
     );
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  select * into v_connection
    from public.calendar_connections
   where id = v_connection_id and company_id = p_company_id
     and user_id = p_user_id
   for update;
  select * into v_link
    from public.task_calendar_links
   where id = p_link_id and company_id = p_company_id
     and connection_id = v_connection_id and link_state = 'event_removed'
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if p_answer = 'not_sure' then
    return jsonb_build_object('outcome', 'still_flagged');
  end if;
  select * into v_task
    from public.tasks
   where id = v_link.task_id and company_id = p_company_id
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if p_answer = 'cancelled' then
    perform public.set_task_done(p_company_id, v_task.id, true, p_user_id);
    delete from public.scheduled_messages
     where company_id = p_company_id and task_id = v_task.id
       and origin = 'reminder' and status = 'pending';
    update public.calendar_reminder_replans
       set state = 'cancelled', cancelled_at = now(),
           generation = generation + 1,
           lease_owner = null, lease_expires_at = null
     where company_id = p_company_id and task_id = v_task.id
       and state in ('queued', 'leased');
    update public.task_calendar_links
       set link_state = 'unlinked', unlinked_at = now()
     where id = v_link.id;
    update public.calendar_outbox
       set state = 'cancelled', cancelled_at = now(),
           lease_owner = null, lease_expires_at = null
     where connection_id = v_connection.id and task_id = v_task.id
       and state in ('queued', 'leased');
    return jsonb_build_object('outcome', 'cancelled');
  end if;

  if p_new_due_at is null then
    return jsonb_build_object('outcome', 'date_required');
  end if;
  if not public.calendar_task_in_sync_window(p_new_due_at) then
    return jsonb_build_object('outcome', 'outside_sync_window');
  end if;
  if v_connection.status <> 'active' or v_connection.revoked_at is not null then
    return jsonb_build_object('outcome', 'disconnected');
  end if;
  if v_task.deleted_at is not null
     or not exists (select 1 from public.task_assignees tas where tas.task_id = v_task.id and tas.user_id = p_user_id)
     or not public.calendar_task_access_allowed(
       p_user_id, v_task.company_id, v_task.conversation_id
     ) then
    return jsonb_build_object('outcome', 'task_ineligible');
  end if;
  perform set_config('loonext.schedule_actor', p_user_id::text, true);
  update public.tasks set due_at = p_new_due_at where id = v_task.id
  returning * into v_task;
  perform set_config('loonext.schedule_actor', v_prior_actor, true);
  perform public.calendar_enqueue_reminder_replan(
    p_company_id, v_task.id, p_user_id
  );
  v_snapshot := public.calendar_task_snapshot(
    v_task.due_at, v_task.title, v_task.description,
    v_link.base_snapshot, v_connection.selected_calendar_timezone
  );
  insert into public.calendar_outbox (
    company_id, connection_id, task_id, link_id, action,
    requested_snapshot, provider_precondition
  ) values (
    p_company_id, v_connection.id, v_task.id, v_link.id, 'create',
    v_snapshot, null
  )
  on conflict (connection_id, task_id)
    where state in ('queued', 'leased')
  do update set
    link_id = excluded.link_id, action = 'create',
    requested_snapshot = excluded.requested_snapshot,
    provider_precondition = null,
    generation = public.calendar_outbox.generation + 1,
    state = 'queued', attempts = 0, available_at = now(),
    lease_owner = null, lease_expires_at = null,
    last_error_code = null, last_error_detail = null,
    cancelled_at = null
  returning id, generation into v_outbox_id, v_generation;
  return jsonb_build_object(
    'outcome', 'moved', 'outbox_id', v_outbox_id,
    'generation', v_generation
  );
end $$;

-- calendar_enqueue_connection_horizon, from 20261110120000_a_finished_or_reassigned_job_leaves_the_calendar.sql: the assignee tests read task_assignees.
create or replace function public.calendar_enqueue_connection_horizon(
  p_connection_id uuid
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.calendar_outbox (
    company_id, connection_id, task_id, link_id, action,
    requested_snapshot, provider_precondition
  )
  select t.company_id, c.id, t.id, l_unlinked.id, 'create',
         public.calendar_task_snapshot(
           t.due_at, t.title, t.description, null,
           c.selected_calendar_timezone
         ),
         null
    from public.calendar_connections c
    join public.tasks t
      on t.company_id = c.company_id and exists (select 1 from public.task_assignees tas where tas.task_id = t.id and tas.user_id = c.user_id)
    left join public.task_calendar_links l_unlinked
      on l_unlinked.connection_id = c.id and l_unlinked.task_id = t.id
     and l_unlinked.link_state = 'unlinked'
   where c.id = p_connection_id and c.status = 'active'
     and c.revoked_at is null
     and t.deleted_at is null
     and public.task_done_at(t) is null
     and public.calendar_task_in_sync_window(t.due_at)
     and public.calendar_task_access_allowed(
       c.user_id, t.company_id, t.conversation_id
     )
     and not exists (
       select 1 from public.task_calendar_links l
        where l.connection_id = c.id and l.task_id = t.id
          and l.link_state <> 'unlinked'
     )
     and not exists (
       select 1 from public.calendar_outbox o
        where o.connection_id = c.id and o.task_id = t.id
          and o.state in ('queued', 'leased')
     )
  on conflict (connection_id, task_id)
    where state in ('queued', 'leased')
  do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- calendar_enqueue_task_sync, from 20261110120000_a_finished_or_reassigned_job_leaves_the_calendar.sql: the assignee tests read task_assignees.
create or replace function public.calendar_enqueue_task_sync(p_task public.tasks)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p     public.tasks := p_task;
  v_off boolean;
begin
  v_off := p.deleted_at is not null
        or public.task_done_at(p) is not null;

  -- A newly connected calendar has create intents before links exist.  They
  -- are still transactional task mirrors: a move rebuilds the one live body,
  -- and deletion/reassignment cancels creation instead of producing a ghost
  -- event from the stale queue row.
  update public.calendar_outbox o
     set state = 'cancelled', cancelled_at = now(),
         lease_owner = null, lease_expires_at = null,
         generation = o.generation + 1,
         updated_at = now()
    from public.calendar_connections c
   where o.connection_id = c.id
     and o.company_id = p.company_id
     and o.task_id = p.id
     and o.action = 'create'
     and o.state = 'queued'
     and not o.provider_effect_ambiguous
     and (
       v_off
       or p.due_at is null
       or not public.calendar_task_in_sync_window(p.due_at)
       or not exists (select 1 from public.task_assignees tas where tas.task_id = p.id and tas.user_id = c.user_id)
       or not public.calendar_task_access_allowed(
         c.user_id, p.company_id, p.conversation_id
       )
     );

  -- A leased create may already exist remotely.  Never cancel its DB record
  -- out from under the worker: bumping generation tells commit-create to map
  -- the returned event and immediately queue the now-current follow-up.
  update public.calendar_outbox o
     set generation = o.generation + 1,
         attempts = 0,
         updated_at = now()
    from public.calendar_connections c
   where o.connection_id = c.id
     and o.company_id = p.company_id
     and o.task_id = p.id
     and o.action = 'create'
     and o.state = 'leased'
     and (
       v_off
       or p.due_at is null
       or not public.calendar_task_in_sync_window(p.due_at)
       or not exists (select 1 from public.task_assignees tas where tas.task_id = p.id and tas.user_id = c.user_id)
       or not public.calendar_task_access_allowed(
         c.user_id, p.company_id, p.conversation_id
       )
     );

  update public.calendar_outbox o
     set requested_snapshot = public.calendar_task_snapshot(
           p.due_at, p.title, p.description, null, c.selected_calendar_timezone
         ),
         generation = o.generation + 1,
         attempts = 0,
         available_at = least(o.available_at, now()),
         last_error_code = null,
         last_error_detail = null,
         updated_at = now()
    from public.calendar_connections c
   where o.connection_id = c.id
     and o.company_id = p.company_id
     and o.task_id = p.id
     and o.action = 'create'
     and o.state in ('queued', 'leased')
     and not o.provider_effect_ambiguous
     and not v_off
     and p.due_at is not null
     and public.calendar_task_in_sync_window(p.due_at)
     and exists (select 1 from public.task_assignees tas where tas.task_id = p.id and tas.user_id = c.user_id)
     and public.calendar_task_access_allowed(
       c.user_id, p.company_id, p.conversation_id
     );

  insert into public.calendar_outbox (
    company_id, connection_id, task_id, link_id, action,
    requested_snapshot, provider_precondition
  )
  select
    p.company_id,
    l.connection_id,
    p.id,
    l.id,
    case
      when not public.calendar_task_access_allowed(
        c.user_id, p.company_id, p.conversation_id
      ) then 'scrub'
      when v_off
        or p.due_at is null
        or not public.calendar_task_in_sync_window(p.due_at)
        or not exists (select 1 from public.task_assignees tas where tas.task_id = p.id and tas.user_id = c.user_id)
      then 'unlink'
      else 'upsert'
    end,
    case
      when v_off
        or p.due_at is null
        or not public.calendar_task_in_sync_window(p.due_at)
        or not exists (select 1 from public.task_assignees tas where tas.task_id = p.id and tas.user_id = c.user_id)
        or not public.calendar_task_access_allowed(
          c.user_id, p.company_id, p.conversation_id
        )
      then null
      else public.calendar_task_snapshot(
        p.due_at, p.title, p.description, l.base_snapshot, co.timezone
      )
    end,
    l.provider_version
  from public.task_calendar_links l
  join public.calendar_connections c
    on c.id = l.connection_id and c.company_id = l.company_id
  join public.companies co on co.id = p.company_id
  where l.company_id = p.company_id
    and l.task_id = p.id
    and l.link_state <> 'unlinked'
    and (
      l.link_state = 'active'
      or v_off
      or p.due_at is null
      or not public.calendar_task_in_sync_window(p.due_at)
      or not exists (select 1 from public.task_assignees tas where tas.task_id = p.id and tas.user_id = c.user_id)
      or not public.calendar_task_access_allowed(
        c.user_id, p.company_id, p.conversation_id
      )
    )
    and c.revoked_at is null
  on conflict (connection_id, task_id)
    where state in ('queued', 'leased')
  do update set
    link_id = case when public.calendar_outbox.provider_effect_ambiguous
      then public.calendar_outbox.link_id else excluded.link_id end,
    action = case when public.calendar_outbox.provider_effect_ambiguous
      then public.calendar_outbox.action else excluded.action end,
    requested_snapshot = case when public.calendar_outbox.provider_effect_ambiguous
      then public.calendar_outbox.requested_snapshot else excluded.requested_snapshot end,
    provider_precondition = case when public.calendar_outbox.provider_effect_ambiguous
      then public.calendar_outbox.provider_precondition else excluded.provider_precondition end,
    generation = public.calendar_outbox.generation + 1,
    attempts = case when public.calendar_outbox.provider_effect_ambiguous
      then public.calendar_outbox.attempts else 0 end,
    available_at = least(public.calendar_outbox.available_at, now()),
    last_error_code = null,
    last_error_detail = null,
    updated_at = now();

  -- Tasks can become calendar-eligible after the connection exists: both a
  -- brand-new assigned/due task and a reassignment to this member need their
  -- first provider occurrence.  A non-unlinked mapping remains authoritative
  -- (including attention states), while an unlinked mapping is deliberately
  -- reused so the connection/task uniqueness and attention identity survive.
  insert into public.calendar_outbox (
    company_id, connection_id, task_id, link_id, action,
    requested_snapshot, provider_precondition
  )
  select
    p.company_id,
    c.id,
    p.id,
    l_unlinked.id,
    'create',
    public.calendar_task_snapshot(
      p.due_at, p.title, p.description, null,
      c.selected_calendar_timezone
    ),
    null
  from public.calendar_connections c
  left join public.task_calendar_links l_unlinked
    on l_unlinked.connection_id = c.id
   and l_unlinked.task_id = p.id
   and l_unlinked.link_state = 'unlinked'
  where not v_off
    and p.due_at is not null
    and public.calendar_task_in_sync_window(p.due_at)
    and exists (select 1 from public.task_assignees tas where tas.task_id = p.id and tas.user_id = c.user_id)
    and public.calendar_task_access_allowed(
      c.user_id, p.company_id, p.conversation_id
    )
    and c.company_id = p.company_id
    and c.status = 'active'
    and c.revoked_at is null
    and not exists (
      select 1
        from public.task_calendar_links l
       where l.connection_id = c.id
         and l.task_id = p.id
         and l.link_state <> 'unlinked'
    )
    and not exists (
      select 1
        from public.calendar_outbox o
       where o.connection_id = c.id
         and o.task_id = p.id
         and o.state in ('queued', 'leased')
    )
  on conflict (connection_id, task_id)
    where state in ('queued', 'leased')
  do nothing;
end $$;

-- api_complete_calendar_connection, from 20261110120000_a_finished_or_reassigned_job_leaves_the_calendar.sql: the assignee tests read task_assignees.
create or replace function public.api_complete_calendar_connection(
  p_company_id                  uuid,
  p_user_id                     uuid,
  p_provider                    text,
  p_provider_account_id         text,
  p_provider_account_label      text,
  p_selected_calendar_id        text,
  p_selected_calendar_name      text,
  p_selected_calendar_timezone  text,
  p_credential_ciphertext       text,
  p_credential_iv               text,
  p_credential_key_version      text,
  p_provider_subscription_id    text,
  p_provider_resource_id        text,
  p_client_state_hash           text,
  p_webhook_expires_at          timestamptz,
  p_sync_cursor                 text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection_id  uuid;
  v_existing       public.calendar_connections%rowtype;
  v_reauthorizing  boolean := false;
  v_webhook_id     uuid;
  v_ics_revoked    integer := 0;
  v_creates        integer := 0;
begin
  -- Serialize against workspace close before the member/connection locks.  A
  -- callback for OAuth state minted before closure must not recreate a live
  -- watch inside the retention window.
  perform 1
    from public.companies
   where id = p_company_id and deleted_at is null
   for key share;
  if not found then
    return jsonb_build_object('outcome', 'workspace_closed');
  end if;

  -- Serialises reconnect races for the same member and proves membership in
  -- the same lock that protects the partial-unique replacement.
  perform 1
    from public.company_members
   where company_id = p_company_id and user_id = p_user_id
     and deactivated_at is null
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_member');
  end if;

  -- The callback creates a provisional remote watch BEFORE entering this
  -- transaction.  Validate every watch field before touching the prior setup;
  -- any later exception rolls the whole replacement back as one unit.
  if nullif(btrim(p_provider_subscription_id), '') is null
     or length(p_provider_subscription_id) > 1000 then
    raise exception 'calendar provider subscription id is required (max 1000 chars)';
  end if;
  if p_provider_resource_id is not null
     and length(p_provider_resource_id) > 2000 then
    raise exception 'calendar provider resource id exceeds 2000 chars';
  end if;
  if p_provider = 'google' and nullif(p_provider_resource_id, '') is null then
    raise exception 'Google calendar watch requires a provider resource id';
  end if;
  if p_client_state_hash is null
     or lower(p_client_state_hash) !~ '^[0-9a-f]{64}$' then
    raise exception 'calendar client state hash must be 64 lowercase hex chars';
  end if;
  if p_webhook_expires_at is null or p_webhook_expires_at <= now() then
    raise exception 'calendar webhook subscription must expire in the future';
  end if;
  if exists (
    select 1
      from public.webhook_subscriptions s
      join public.calendar_connections c on c.id = s.connection_id
     where s.provider_subscription_id = p_provider_subscription_id
       and s.revoked_at is null
       and (c.company_id, c.user_id) is distinct from (p_company_id, p_user_id)
  ) then
    return jsonb_build_object('outcome', 'webhook_conflict');
  end if;

  select * into v_existing
    from public.calendar_connections
   where company_id = p_company_id
     and user_id = p_user_id
     and revoked_at is null
   for update;
  if found then
    if v_existing.status = 'disconnected' then
      return jsonb_build_object(
        'outcome', 'disconnect_in_progress',
        'connection_id', v_existing.id
      );
    end if;
    -- Reauthorization is an in-place credential/watch rotation only.  A
    -- different provider account or calendar is a product-level replacement:
    -- returning before the first write lets the caller stop its provisional
    -- watch and require an explicit disconnect without damaging mappings.
    if v_existing.provider is distinct from p_provider
       or v_existing.provider_account_id is distinct from p_provider_account_id
       or v_existing.selected_calendar_id is distinct from p_selected_calendar_id then
      return jsonb_build_object(
        'outcome', 'replacement_requires_disconnect',
        'connection_id', v_existing.id,
        'provider', v_existing.provider,
        'provider_account_id', v_existing.provider_account_id,
        'selected_calendar_id', v_existing.selected_calendar_id
      );
    end if;
    v_connection_id := v_existing.id;
    v_reauthorizing := true;
  end if;

  update public.webhook_subscriptions s
     set status = 'revoking', revoked_at = null,
         renewal_generation = renewal_generation + 1,
         renewal_available_at = now(),
         renewal_lease_owner = null, renewal_lease_expires_at = null
   where s.revoked_at is null
     and s.connection_id = v_connection_id;

  if v_reauthorizing then
    update public.calendar_connections
       set provider_account_label = p_provider_account_label,
           selected_calendar_name = p_selected_calendar_name,
           selected_calendar_timezone = p_selected_calendar_timezone,
           credential_ciphertext = p_credential_ciphertext,
           credential_iv = p_credential_iv,
           credential_key_version = p_credential_key_version,
           credential_generation = credential_generation + 1,
           credential_refresh_lease_owner = null,
           credential_refresh_lease_expires_at = null,
           status = 'active',
           sync_cursor = p_sync_cursor,
           cursor_updated_at = case when p_sync_cursor is null then null else now() end,
           sync_due_at = now(),
           full_sync_due_at = now(),
           pull_full_sync = false,
           pull_followup_requested = false,
           pull_generation = pull_generation + 1,
           pull_lease_owner = null,
           pull_lease_expires_at = null,
           last_error_code = null,
           last_error_detail = null,
           last_error_at = null
     where id = v_connection_id;
  else
    insert into public.calendar_connections (
      company_id, user_id, provider, provider_account_id, provider_account_label,
      selected_calendar_id, selected_calendar_name, selected_calendar_timezone,
      credential_ciphertext, credential_iv, credential_key_version,
      status, sync_cursor, cursor_updated_at,
      sync_due_at, full_sync_due_at, pull_full_sync, pull_generation
    ) values (
      p_company_id, p_user_id, p_provider, p_provider_account_id,
      p_provider_account_label, p_selected_calendar_id, p_selected_calendar_name,
      p_selected_calendar_timezone, p_credential_ciphertext, p_credential_iv,
      p_credential_key_version, 'active', p_sync_cursor,
      case when p_sync_cursor is null then null else now() end,
      now(), now(), false, 1
    ) returning id into v_connection_id;
  end if;

  insert into public.webhook_subscriptions (
    company_id, connection_id, provider_subscription_id,
    provider_resource_id, provider_calendar_id, client_state_hash,
    status, expires_at, last_renewed_at
  ) values (
    p_company_id, v_connection_id, p_provider_subscription_id,
    p_provider_resource_id, p_selected_calendar_id,
    lower(p_client_state_hash), 'active', p_webhook_expires_at, now()
  ) returning id into v_webhook_id;

  -- Seed the OUTBOUND half only: dated live tasks already assigned to this
  -- member become provider-create intents.  Inbound provider events with no
  -- mapping remain ignored; a calendar event is not authority to manufacture
  -- a Loonext task.
  insert into public.calendar_outbox (
    company_id, connection_id, task_id, link_id, action,
    requested_snapshot, provider_precondition
  )
  select
    t.company_id,
    v_connection_id,
    t.id,
    l_unlinked.id,
    'create',
    public.calendar_task_snapshot(
      t.due_at, t.title, t.description, null, p_selected_calendar_timezone
    ),
    null
  from public.tasks t
  left join public.task_calendar_links l_unlinked
    on l_unlinked.connection_id = v_connection_id
   and l_unlinked.task_id = t.id
   and l_unlinked.link_state = 'unlinked'
  where t.company_id = p_company_id
    and exists (select 1 from public.task_assignees tas where tas.task_id = t.id and tas.user_id = p_user_id)
    and t.due_at is not null
    and t.due_at >= now() - interval '90 days'
    and t.due_at <= now() + interval '365 days'
    and t.deleted_at is null
    and public.task_done_at(t) is null
    and public.calendar_task_access_allowed(
      p_user_id, p_company_id, t.conversation_id
    )
    and not exists (
      select 1
        from public.task_calendar_links l
       where l.connection_id = v_connection_id
         and l.task_id = t.id
         and l.link_state <> 'unlinked'
    )
    and not exists (
      select 1
        from public.calendar_outbox o
       where o.connection_id = v_connection_id
         and o.task_id = t.id
         and o.state in ('queued', 'leased')
    )
  on conflict (connection_id, task_id)
    where state in ('queued', 'leased')
  do nothing;
  get diagnostics v_creates = row_count;

  -- Rule 8: the read-only feed would show the same jobs a second time, and a
  -- user can drag that subscribed copy without any write reaching us.
  update public.calendar_feed_tokens
     set revoked_at = now()
   where company_id = p_company_id
     and user_id = p_user_id
     and revoked_at is null;
  get diagnostics v_ics_revoked = row_count;

  return jsonb_build_object(
    'outcome', 'connected',
    'connection_id', v_connection_id,
    'webhook_subscription_id', v_webhook_id,
    'reauthorized', v_reauthorizing,
    'ics_revoked', v_ics_revoked,
    'creates_queued', v_creates
  );
end $$;

-- api_commit_calendar_outbox_created, from 20261110120000_a_finished_or_reassigned_job_leaves_the_calendar.sql: the assignee tests read task_assignees.
create or replace function public.api_commit_calendar_outbox_created(
  p_outbox_id             uuid,
  p_worker_id             text,
  p_generation            bigint,
  p_provider_event_id     text,
  p_provider_instance_id  text,
  p_provider_series_id    text,
  p_provider_version      text,
  p_start_at              timestamptz,
  p_end_at                timestamptz,
  p_time_zone             text,
  p_title                 text,
  p_description           text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox       public.calendar_outbox%rowtype;
  v_task         public.tasks%rowtype;
  v_connection   public.calendar_connections%rowtype;
  v_sent         jsonb;
  v_requested    jsonb;
  v_current      jsonb;
  v_link_id      uuid;
  v_followup     text;
  v_finalized    boolean;
  v_observed_mismatch boolean;
  v_conflict     boolean;
begin
  select * into v_outbox
    from public.calendar_outbox
   where id = p_outbox_id
   for update;
  if not found
     or v_outbox.action <> 'create'
     or v_outbox.state <> 'leased'
     or v_outbox.lease_owner is distinct from p_worker_id
     or v_outbox.lease_expires_at is null
     or v_outbox.lease_expires_at <= now() then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;
  if nullif(p_provider_event_id, '') is null
     or nullif(p_provider_instance_id, '') is null
     or p_provider_series_id is not distinct from p_provider_instance_id then
    raise exception 'calendar create commit requires an instance id, never a series id';
  end if;

  select * into v_task from public.tasks where id = v_outbox.task_id for update;
  select * into v_connection
    from public.calendar_connections where id = v_outbox.connection_id for update;
  v_sent := public.calendar_snapshot_from_fields(
    p_start_at, p_end_at, p_time_zone, p_title, p_description
  );
  v_requested := public.calendar_normalize_snapshot(
    v_outbox.requested_snapshot
  );
  v_observed_mismatch := v_sent is distinct from v_requested;
  v_current := public.calendar_task_snapshot(
    v_task.due_at, v_task.title, v_task.description,
    v_requested, v_connection.selected_calendar_timezone
  );
  v_conflict := v_observed_mismatch
    and v_connection.status = 'active'
    and v_connection.revoked_at is null
    and v_task.deleted_at is null
    and public.task_done_at(v_task) is null
    and v_task.due_at is not null
    and public.calendar_task_in_sync_window(v_task.due_at)
    and exists (select 1 from public.task_assignees tas where tas.task_id = v_task.id and tas.user_id = v_connection.user_id)
    and public.calendar_task_access_allowed(
      v_connection.user_id, v_task.company_id, v_task.conversation_id
    );

  if v_outbox.link_id is null then
    insert into public.task_calendar_links (
      company_id, connection_id, task_id,
      provider_event_id, provider_instance_id, provider_series_id,
      provider_version, link_state, base_snapshot, last_sent_snapshot,
      last_sent_provider_version, last_sent_at,
      conflict_ours_snapshot, conflict_theirs_snapshot,
      conflict_detected_at, last_provider_seen_at
    ) values (
      v_outbox.company_id, v_outbox.connection_id, v_outbox.task_id,
      p_provider_event_id, p_provider_instance_id, p_provider_series_id,
      p_provider_version, case when v_conflict then 'conflict' else 'active' end,
      case when v_observed_mismatch then v_requested else v_sent end,
      case when v_observed_mismatch then null else v_sent end,
      case when v_observed_mismatch then null else p_provider_version end,
      case when v_observed_mismatch then null else now() end,
      case when v_conflict then v_current else null end,
      case when v_conflict then v_sent else null end,
      case when v_conflict then now() else null end,
      now()
    ) returning id into v_link_id;
  else
    -- "Moved" after a provider removal creates a new occurrence but keeps the
    -- same task/link identity used by the attention card.
    update public.task_calendar_links
       set provider_event_id = p_provider_event_id,
           provider_instance_id = p_provider_instance_id,
           provider_series_id = p_provider_series_id,
           provider_version = p_provider_version,
           link_state = case when v_conflict then 'conflict' else 'active' end,
           base_snapshot = case when v_observed_mismatch
             then v_requested else v_sent end,
           last_sent_snapshot = case when v_observed_mismatch
             then null else v_sent end,
           last_sent_provider_version = case when v_observed_mismatch
             then null else p_provider_version end,
           last_sent_at = case when v_observed_mismatch then null else now() end,
           last_provider_seen_at = now(),
           conflict_ours_snapshot = case when v_conflict then v_current else null end,
           conflict_theirs_snapshot = case when v_conflict then v_sent else null end,
           conflict_detected_at = case when v_conflict then now() else null end,
           event_removed_at = null,
           refusal_code = null, refusal_detail = null, refused_at = null,
           unlinked_at = null
     where id = v_outbox.link_id
       and company_id = v_outbox.company_id
       and connection_id = v_outbox.connection_id
       and task_id = v_outbox.task_id
    returning id into v_link_id;
    if not found then
      raise exception 'calendar recreate link disappeared after provider create';
    end if;
  end if;

  update public.calendar_outbox
     set state = 'completed', completed_at = now(), link_id = v_link_id,
         lease_owner = null, lease_expires_at = null,
         provider_effect_ambiguous = false,
         provider_effect_lease_generation = null
   where id = p_outbox_id;

  if v_conflict then
    perform public.calendar_record_connection_conflict(v_connection.id);
    return jsonb_build_object(
      'outcome', 'conflict',
      'reason', 'create_observed_mismatch',
      'link_id', v_link_id,
      'connection_finalized', false
    );
  end if;

  -- A task may move while the provider request is in flight.  The remote event
  -- now exists, so record it first, then queue the CURRENT truth; never retry
  -- create and duplicate the event.
  v_followup := case
    when v_connection.status = 'disconnected'
    then coalesce(v_connection.disconnect_cleanup_action, 'unlink')
    when not public.calendar_task_access_allowed(
      v_connection.user_id, v_task.company_id, v_task.conversation_id
    ) then 'scrub'
    when v_task.deleted_at is not null
      or public.task_done_at(v_task) is not null
      or v_task.due_at is null
      or not public.calendar_task_in_sync_window(v_task.due_at)
      or not exists (select 1 from public.task_assignees tas where tas.task_id = v_task.id and tas.user_id = v_connection.user_id)
    then 'unlink'
    -- A mismatched observation is never an agreed base.  If cleanup does not
    -- win above, the eligible case returned conflict before this expression.
    when not v_observed_mismatch and v_current is distinct from v_sent then 'upsert'
    else null
  end;
  if v_followup is not null then
    insert into public.calendar_outbox (
      company_id, connection_id, task_id, link_id, action,
      requested_snapshot, provider_precondition
    ) values (
      v_outbox.company_id, v_outbox.connection_id, v_outbox.task_id, v_link_id,
      v_followup,
      case when v_followup = 'upsert' then v_current else null end,
      p_provider_version
    );
  end if;

  v_finalized := public.calendar_finalize_disconnected_connection(
    v_connection.id
  );

  return jsonb_build_object(
    'outcome', case
      when v_outbox.generation is distinct from p_generation or v_followup is not null
      then 'followup_queued' else 'committed' end,
    'link_id', v_link_id,
    'connection_finalized', v_finalized
  );
end $$;

-- api_commit_calendar_outbox_sent, from 20261110120000_a_finished_or_reassigned_job_leaves_the_calendar.sql: the assignee tests read task_assignees.
create or replace function public.api_commit_calendar_outbox_sent(
  p_outbox_id        uuid,
  p_worker_id        text,
  p_generation       bigint,
  p_provider_version text,
  p_start_at         timestamptz,
  p_end_at           timestamptz,
  p_time_zone        text,
  p_title            text,
  p_description      text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox     public.calendar_outbox%rowtype;
  v_task       public.tasks%rowtype;
  v_connection public.calendar_connections%rowtype;
  v_link       public.task_calendar_links%rowtype;
  v_sent       jsonb;
  v_current    jsonb;
  v_followup   text;
  v_finalized  boolean;
begin
  select * into v_outbox
    from public.calendar_outbox where id = p_outbox_id for update;
  if not found
     or v_outbox.action = 'create'
     or v_outbox.state <> 'leased'
     or v_outbox.lease_owner is distinct from p_worker_id
     or v_outbox.lease_expires_at is null
     or v_outbox.lease_expires_at <= now() then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;

  select * into v_link
    from public.task_calendar_links where id = v_outbox.link_id for update;
  select * into v_task from public.tasks where id = v_outbox.task_id for update;
  select * into v_connection
    from public.calendar_connections where id = v_outbox.connection_id for update;

  if p_start_at is null then
    -- An unlink either deleted the provider event (no version left) or left
    -- it annotated; either way the mapping is unlinked.
    update public.task_calendar_links
       set link_state = 'unlinked', unlinked_at = now(),
           provider_version = p_provider_version,
           last_sent_snapshot = null,
           last_sent_provider_version = null,
           last_sent_at = null
     where id = v_link.id;
  else
    v_sent := public.calendar_snapshot_from_fields(
      p_start_at, p_end_at, p_time_zone, p_title, p_description
    );
    update public.task_calendar_links
       set link_state = 'active',
           base_snapshot = v_sent,
           last_sent_snapshot = v_sent,
           last_sent_provider_version = p_provider_version,
           provider_version = p_provider_version,
           last_sent_at = now(),
           conflict_ours_snapshot = null,
           conflict_theirs_snapshot = null,
           conflict_detected_at = null,
           event_removed_at = null,
           refusal_code = null,
           refusal_detail = null,
           refused_at = null,
           unlinked_at = null
     where id = v_link.id;
  end if;

  update public.calendar_outbox
     set state = 'completed', completed_at = now(),
         lease_owner = null, lease_expires_at = null,
         provider_effect_ambiguous = false,
         provider_effect_lease_generation = null
   where id = p_outbox_id;

  if v_connection.status = 'disconnected'
     and (
       v_connection.disconnect_cleanup_action = 'scrub'
       or not public.calendar_task_access_allowed(
         v_connection.user_id, v_task.company_id, v_task.conversation_id
       )
     )
     and v_outbox.action <> 'scrub' then
    v_followup := 'scrub';
  elsif v_connection.status = 'disconnected' then
    -- A successful phase-one unlink is terminal for ordinary disconnect.  It
    -- must never fall through to the active-task branch and resurrect an
    -- upsert merely because the task itself remains eligible in Loonext.
    if p_start_at is not null then
      v_followup := coalesce(v_connection.disconnect_cleanup_action, 'unlink');
    end if;
  elsif not public.calendar_task_access_allowed(
      v_connection.user_id, v_task.company_id, v_task.conversation_id
    ) and v_outbox.action <> 'scrub' then
    v_followup := 'scrub';
  elsif v_task.deleted_at is null
     and public.task_done_at(v_task) is null
     and v_task.due_at is not null
     and public.calendar_task_in_sync_window(v_task.due_at)
     and exists (select 1 from public.task_assignees tas where tas.task_id = v_task.id and tas.user_id = v_connection.user_id)
     and public.calendar_task_access_allowed(
       v_connection.user_id, v_task.company_id, v_task.conversation_id
     ) then
    v_current := public.calendar_task_snapshot(
      v_task.due_at, v_task.title, v_task.description,
      case when p_start_at is null then v_link.base_snapshot else v_sent end,
      v_connection.selected_calendar_timezone
    );
    if p_start_at is null or v_current is distinct from v_sent then
      -- An unlink with no version left deleted (or found gone) the provider
      -- event: the job is back, so it needs a new event, never a patch of one
      -- that no longer exists.
      v_followup := case
        when p_start_at is null and p_provider_version is null then 'create'
        else 'upsert' end;
    end if;
  elsif p_start_at is not null then
    v_followup := 'unlink';
  end if;

  if v_followup is not null then
    insert into public.calendar_outbox (
      company_id, connection_id, task_id, link_id, action,
      requested_snapshot, provider_precondition
    ) values (
      v_outbox.company_id, v_outbox.connection_id, v_outbox.task_id,
      v_link.id, v_followup,
      case when v_followup in ('upsert', 'create') then v_current else null end,
      case when v_followup = 'create' then null else p_provider_version end
    );
  end if;

  v_finalized := public.calendar_finalize_disconnected_connection(
    v_connection.id
  );

  return jsonb_build_object(
    'outcome', case
      when v_followup is not null then 'followup_queued'
      when v_outbox.generation is distinct from p_generation then 'followup_checked'
      else 'committed' end,
    'connection_finalized', v_finalized
  );
end $$;

-- api_commit_calendar_outbox_scrubbed, from 20261110120000_a_finished_or_reassigned_job_leaves_the_calendar.sql: the assignee tests read task_assignees.
create or replace function public.api_commit_calendar_outbox_scrubbed(
  p_outbox_id        uuid,
  p_worker_id        text,
  p_generation       bigint,
  p_provider_version text,
  p_provider_deleted boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox public.calendar_outbox%rowtype;
  v_link public.task_calendar_links%rowtype;
  v_task public.tasks%rowtype;
  v_connection public.calendar_connections%rowtype;
  v_current jsonb;
  v_followup_id uuid;
  v_finalized boolean;
begin
  select * into v_outbox from public.calendar_outbox
   where id = p_outbox_id for update;
  if not found or v_outbox.action <> 'scrub'
     or v_outbox.state <> 'leased'
     or v_outbox.lease_owner is distinct from p_worker_id
     or v_outbox.lease_expires_at is null
     or v_outbox.lease_expires_at <= now() then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;
  select * into v_link from public.task_calendar_links
   where id = v_outbox.link_id for update;
  select * into v_task from public.tasks
   where id = v_outbox.task_id for update;
  select * into v_connection from public.calendar_connections
   where id = v_outbox.connection_id for update;

  update public.task_calendar_links
     set link_state = 'unlinked', unlinked_at = now(),
         provider_version = case when p_provider_deleted then null
                                 else p_provider_version end,
         last_sent_snapshot = null,
         last_sent_provider_version = null,
         last_sent_at = null,
         conflict_ours_snapshot = null,
         conflict_theirs_snapshot = null,
         conflict_detected_at = null,
         event_removed_at = null,
         refusal_code = null,
         refusal_detail = null,
         refused_at = null
   where id = v_link.id;
  update public.calendar_outbox
     set state = 'completed', completed_at = now(),
         lease_owner = null, lease_expires_at = null,
         provider_effect_ambiguous = false,
         provider_effect_lease_generation = null
   where id = v_outbox.id;

  -- Access may be restored while the conditional delete/neutralising PATCH is
  -- in flight.  The scrubbed occurrence is never re-adopted; create a fresh
  -- occurrence from current truth so a deleted resource cannot be PATCHed.
  if v_connection.status = 'active'
     and v_connection.revoked_at is null
     and v_task.deleted_at is null
     and public.task_done_at(v_task) is null
     and v_task.due_at is not null
     and public.calendar_task_in_sync_window(v_task.due_at)
     and exists (select 1 from public.task_assignees tas where tas.task_id = v_task.id and tas.user_id = v_connection.user_id)
     and public.calendar_task_access_allowed(
       v_connection.user_id, v_task.company_id, v_task.conversation_id
     ) then
    v_current := public.calendar_task_snapshot(
      v_task.due_at, v_task.title, v_task.description, null,
      v_connection.selected_calendar_timezone
    );
    insert into public.calendar_outbox (
      company_id, connection_id, task_id, link_id, action,
      requested_snapshot, provider_precondition
    ) values (
      v_outbox.company_id, v_outbox.connection_id, v_outbox.task_id,
      v_link.id, 'create', v_current, null
    ) returning id into v_followup_id;
  end if;

  v_finalized := public.calendar_finalize_disconnected_connection(
    v_connection.id
  );
  return jsonb_build_object(
    'outcome', case when v_followup_id is null then 'committed'
                    else 'followup_queued' end,
    'provider_deleted', p_provider_deleted,
    'followup_outbox_id', v_followup_id,
    'connection_finalized', v_finalized
  );
end $$;

-- calendar_reconcile_number_access, from 20260825020000_two_way_calendar_sync_outbox.sql: the assignee tests read task_assignees.
create or replace function public.calendar_reconcile_number_access(
  p_company_id      uuid,
  p_phone_number_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  v_eligible boolean;
  v_access_allowed boolean;
  v_action text;
  v_snapshot jsonb;
begin
  -- A rule can change the default for EVERY ordinary member on a number (the
  -- first rule closes an otherwise-open number; deleting the last opens it),
  -- so reconcile all live personal connections, not merely a named principal.
  for v in
    select
      c.id as connection_id, c.user_id, c.selected_calendar_timezone,
      c.status as connection_status,
      t.id as task_id, t.company_id, t.conversation_id, t.assigned_user_id,
      t.due_at, t.title, t.description, t.deleted_at,
      l.id as link_id, l.link_state, l.provider_version, l.base_snapshot
    from public.calendar_connections c
    join public.tasks t on t.company_id = c.company_id
    join public.conversations cv
      on cv.id = t.conversation_id and cv.company_id = t.company_id
    left join public.task_calendar_links l
      on l.connection_id = c.id and l.task_id = t.id
    where c.company_id = p_company_id
      and c.status in ('active', 'reauth_required')
      and c.revoked_at is null
      and cv.phone_number_id = p_phone_number_id
      and (
        exists (select 1 from public.task_assignees tas where tas.task_id = t.id and tas.user_id = c.user_id)
        or l.id is not null
        or exists (
          select 1 from public.calendar_outbox live
           where live.connection_id = c.id and live.task_id = t.id
             and live.state in ('queued', 'leased')
        )
      )
  loop
    v_access_allowed := public.calendar_task_access_allowed(
      v.user_id, v.company_id, v.conversation_id
    );
    v_eligible := v.deleted_at is null
      and v.due_at is not null
      and public.calendar_task_in_sync_window(v.due_at)
      and exists (select 1 from public.task_assignees tas where tas.task_id = v.task_id and tas.user_id = v.user_id)
      and v_access_allowed;

    if not v_eligible then
      -- A create with no possible provider effect can disappear.  Once an
      -- effect is ambiguous its original request is recovery evidence and is
      -- preserved until commit-create maps it and queues the current unlink.
      update public.calendar_outbox o
         set state = 'cancelled', cancelled_at = now(),
             lease_owner = null, lease_expires_at = null,
             generation = o.generation + 1
       where o.connection_id = v.connection_id and o.task_id = v.task_id
         and o.action = 'create' and o.state = 'queued'
         and not o.provider_effect_ambiguous;
      update public.calendar_outbox o
         set generation = o.generation + 1, attempts = 0
       where o.connection_id = v.connection_id and o.task_id = v.task_id
         and o.action = 'create' and o.state = 'leased';

      if v.connection_status = 'reauth_required' then
        -- Access cannot wait for an OAuth repair.  The sealed credential is
        -- already known unusable, so there is no honest provider cleanup we
        -- can claim.  Release local holds, retain the occurrence identity as a
        -- tombstone, and disclose that remote cleanup is unconfirmed.
        update public.calendar_outbox o
           set state = 'cancelled', cancelled_at = now(),
               lease_owner = null, lease_expires_at = null,
               last_error_code = 'access_revoked_while_reauth_required',
               last_error_detail = 'Remote security scrub could not be confirmed.'
         where o.connection_id = v.connection_id
           and o.task_id = v.task_id
           and o.state in ('queued', 'leased');
        if v.link_id is not null and v.link_state <> 'unlinked' then
          update public.task_calendar_links
             set link_state = 'unlinked', unlinked_at = now(),
                 last_sent_snapshot = null,
                 last_sent_provider_version = null,
                 last_sent_at = null,
                 conflict_ours_snapshot = null,
                 conflict_theirs_snapshot = null,
                 conflict_detected_at = null,
                 event_removed_at = null,
                 refusal_code = null,
                 refusal_detail = null,
                 refused_at = null
           where id = v.link_id;
        end if;
        update public.calendar_connections
           set remote_cleanup_unconfirmed = true,
               last_error_code = 'access_revoked_while_reauth_required',
               last_error_detail = 'Remote security scrub could not be confirmed.',
               last_error_at = now()
         where id = v.connection_id;
        continue;
      end if;

      if v.link_id is null or v.link_state = 'unlinked' then
        continue;
      end if;
      v_action := case when v_access_allowed then 'unlink' else 'scrub' end;
      v_snapshot := null;
    else
      if v.link_id is not null and v.link_state <> 'unlinked' then
        -- A number rule changed, not the task.  Existing eligible mappings need
        -- no PATCH at all: cancel only a scrub that has definitely not crossed
        -- the provider boundary.  An ambiguous scrub remains recovery work and
        -- its commit will create current truth after neutralising the old copy.
        update public.calendar_outbox o
           set state = 'cancelled', cancelled_at = now(),
               lease_owner = null, lease_expires_at = null,
               generation = o.generation + 1
         where o.connection_id = v.connection_id and o.task_id = v.task_id
           and o.action = 'scrub' and o.state in ('queued', 'leased')
           and not o.provider_effect_ambiguous;
        continue;
      end if;
      v_action := 'create';
      v_snapshot := public.calendar_task_snapshot(
        v.due_at, v.title, v.description, null,
        v.selected_calendar_timezone
      );
    end if;

    insert into public.calendar_outbox (
      company_id, connection_id, task_id, link_id, action,
      requested_snapshot, provider_precondition
    ) values (
      v.company_id, v.connection_id, v.task_id, v.link_id, v_action,
      v_snapshot, case when v_action = 'create' then null else v.provider_version end
    )
    on conflict (connection_id, task_id)
      where state in ('queued', 'leased')
    do update set
      link_id = case when public.calendar_outbox.provider_effect_ambiguous
        then public.calendar_outbox.link_id else excluded.link_id end,
      action = case when public.calendar_outbox.provider_effect_ambiguous
        then public.calendar_outbox.action else excluded.action end,
      requested_snapshot = case when public.calendar_outbox.provider_effect_ambiguous
        then public.calendar_outbox.requested_snapshot else excluded.requested_snapshot end,
      provider_precondition = case when public.calendar_outbox.provider_effect_ambiguous
        then public.calendar_outbox.provider_precondition else excluded.provider_precondition end,
      generation = public.calendar_outbox.generation + 1,
      attempts = case when public.calendar_outbox.provider_effect_ambiguous
        then public.calendar_outbox.attempts else 0 end,
      available_at = least(public.calendar_outbox.available_at, now()),
      last_error_code = null,
      last_error_detail = null;
  end loop;
end $$;

-- api_cancel_calendar_outbox, from 20260825020000_two_way_calendar_sync_outbox.sql: the assignee tests read task_assignees.
create or replace function public.api_cancel_calendar_outbox(
  p_outbox_id  uuid,
  p_worker_id  text,
  p_generation bigint,
  p_reason     text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox     public.calendar_outbox%rowtype;
  v_task       public.tasks%rowtype;
  v_connection public.calendar_connections%rowtype;
  v_ineligible boolean := false;
begin
  select * into v_outbox
    from public.calendar_outbox where id = p_outbox_id for update;
  if not found
     or v_outbox.state <> 'leased'
     or v_outbox.lease_owner is distinct from p_worker_id
     or v_outbox.lease_expires_at is null
     or v_outbox.lease_expires_at <= now() then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;

  if v_outbox.provider_effect_ambiguous then
    update public.calendar_outbox
       set state = 'queued', available_at = now(),
           lease_owner = null, lease_expires_at = null
     where id = p_outbox_id;
    return jsonb_build_object('outcome', 'ambiguous_effect');
  end if;

  if v_outbox.action = 'create' then
    select * into v_task from public.tasks where id = v_outbox.task_id;
    select * into v_connection
      from public.calendar_connections where id = v_outbox.connection_id;
    v_ineligible := v_task.deleted_at is not null
      or v_task.due_at is null
      or not public.calendar_task_in_sync_window(v_task.due_at)
      or not exists (select 1 from public.task_assignees tas where tas.task_id = v_task.id and tas.user_id = v_connection.user_id)
      or not public.calendar_task_access_allowed(
        v_connection.user_id, v_task.company_id, v_task.conversation_id
      );
  end if;

  -- A newer desired write must survive a stale worker's cancellation.  The one
  -- exception is an ineligible pre-provider create: no remote event exists and
  -- the newer generation is precisely the cancellation signal.
  if v_outbox.generation is distinct from p_generation and not v_ineligible then
    update public.calendar_outbox
       set state = 'queued', available_at = now(),
           lease_owner = null, lease_expires_at = null
     where id = p_outbox_id;
    return jsonb_build_object('outcome', 'superseded');
  end if;

  update public.calendar_outbox
     set state = 'cancelled', cancelled_at = now(),
         lease_owner = null, lease_expires_at = null,
         last_error_code = 'cancelled',
         last_error_detail = left(p_reason, 1000)
   where id = p_outbox_id;
  return jsonb_build_object('outcome', 'cancelled');
end $$;

-- api_apply_calendar_provider_snapshot, from 20260825020000_two_way_calendar_sync_outbox.sql: the assignee tests read task_assignees.
create or replace function public.api_apply_calendar_provider_snapshot(
  p_company_id             uuid,
  p_connection_id          uuid,
  p_worker_id               text,
  p_pull_generation        bigint,
  p_task_id                uuid,
  p_provider_event_id      text,
  p_provider_instance_id   text,
  p_provider_series_id     text,
  p_provider_version       text,
  p_start_at               timestamptz,
  p_end_at                 timestamptz,
  p_time_zone              text,
  p_title                  text,
  p_description            text,
  p_outbox_id              uuid default null,
  p_outbox_generation      bigint default null,
  p_preserve_description   boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link         public.task_calendar_links%rowtype;
  v_task         public.tasks%rowtype;
  v_connection   public.calendar_connections%rowtype;
  v_reconcile_outbox public.calendar_outbox%rowtype;
  v_base         jsonb;
  v_last_sent    jsonb;
  v_ours         jsonb;
  v_theirs       jsonb;
  v_due_changed  boolean;
  v_lease        text;
  v_outbox_id    uuid;
  v_generation   bigint;
  v_cleanup_action text;
  v_prior_flag   text := coalesce(current_setting('loonext.calendar_provider_apply', true), '');
begin
  v_lease := public.calendar_sync_mutation_lease_outcome(
    p_company_id, p_connection_id, p_task_id, p_worker_id,
    p_pull_generation, p_outbox_id, p_outbox_generation
  );
  if v_lease <> 'current' then
    return jsonb_build_object('outcome', v_lease);
  end if;
  select * into v_link
    from public.task_calendar_links
   where company_id = p_company_id
     and connection_id = p_connection_id
     and task_id = p_task_id
     and provider_event_id = p_provider_event_id
     and provider_instance_id = p_provider_instance_id
     and provider_series_id is not distinct from p_provider_series_id
     and link_state in ('active', 'conflict', 'event_removed', 'refused')
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  select * into v_task from public.tasks where id = p_task_id for update;
  select * into v_connection
    from public.calendar_connections
   where id = p_connection_id and status = 'active' and revoked_at is null
   for update;
  if not found then
    return jsonb_build_object('outcome', 'disconnected');
  end if;

  -- Provider observations never make a deleted, locally unscheduled or
  -- reassigned task eligible again.  Preserve (or create) the unlink intent;
  -- in particular, do not let equality with the old base cancel a leased
  -- unlink during precondition reconciliation.
  if v_task.deleted_at is not null
     or not exists (select 1 from public.task_assignees tas where tas.task_id = v_task.id and tas.user_id = v_connection.user_id)
     or not public.calendar_task_access_allowed(
       v_connection.user_id, v_task.company_id, v_task.conversation_id
     )
     or (v_task.due_at is not null
         and not public.calendar_task_in_sync_window(v_task.due_at))
     or (v_task.due_at is null
         and v_link.link_state not in ('event_removed', 'refused')) then
    v_cleanup_action := case
      when not public.calendar_task_access_allowed(
        v_connection.user_id, v_task.company_id, v_task.conversation_id
      ) then 'scrub' else 'unlink' end;
    insert into public.calendar_outbox (
      company_id, connection_id, task_id, link_id, action,
      requested_snapshot, provider_precondition
    ) values (
      p_company_id, p_connection_id, p_task_id, v_link.id,
      v_cleanup_action, null, p_provider_version
    )
    on conflict (connection_id, task_id)
      where state in ('queued', 'leased')
    do update set
      link_id = case when public.calendar_outbox.provider_effect_ambiguous
        then public.calendar_outbox.link_id else excluded.link_id end,
      action = case when public.calendar_outbox.provider_effect_ambiguous
        then public.calendar_outbox.action else excluded.action end,
      requested_snapshot = case when public.calendar_outbox.provider_effect_ambiguous
        then public.calendar_outbox.requested_snapshot else null end,
      provider_precondition = case when public.calendar_outbox.provider_effect_ambiguous
        then public.calendar_outbox.provider_precondition else excluded.provider_precondition end,
      generation = public.calendar_outbox.generation + case
        when public.calendar_outbox.action = excluded.action
         and public.calendar_outbox.link_id = excluded.link_id
         and public.calendar_outbox.provider_precondition
             is not distinct from excluded.provider_precondition
        then 0 else 1 end,
      attempts = case
        when public.calendar_outbox.action = excluded.action
         and public.calendar_outbox.link_id = excluded.link_id
         and public.calendar_outbox.provider_precondition
             is not distinct from excluded.provider_precondition
        then public.calendar_outbox.attempts else 0 end,
      available_at = least(public.calendar_outbox.available_at, now()),
      last_error_code = null,
      last_error_detail = null,
      updated_at = now()
    returning id, generation into v_outbox_id, v_generation;
    return jsonb_build_object(
      'outcome', v_cleanup_action || '_queued',
      'outbox_id', v_outbox_id,
      'generation', v_generation
    );
  end if;

  v_base := public.calendar_normalize_snapshot(v_link.base_snapshot);

  -- The rolling provider window is a two-way contract, not merely an outbound
  -- seed filter.  A mapped occurrence dragged beyond -90/+365 cannot be
  -- applied to the task because no subsequent delta cursor can observe it.
  -- Likewise, provider text that cannot be stored losslessly is durable
  -- attention, never truncation and never a transaction-poisoning task write.
  if not public.calendar_task_in_sync_window(p_start_at) then
    return public.api_mark_calendar_refusal(
      p_company_id, p_connection_id, p_worker_id, p_pull_generation,
      p_task_id, p_provider_instance_id, p_provider_version,
      'outside_sync_window',
      'Provider occurrence is outside the supported sync window.',
      false, p_outbox_id, p_outbox_generation
    );
  end if;
  if not p_preserve_description
     and char_length(public.calendar_normalize_text(coalesce(p_description, '')))
       > 5000 then
    return public.api_mark_calendar_refusal(
      p_company_id, p_connection_id, p_worker_id, p_pull_generation,
      p_task_id, p_provider_instance_id, p_provider_version,
      'description_too_long',
      'Provider description exceeds 5000 characters.',
      false, p_outbox_id, p_outbox_generation
    );
  end if;
  if nullif(public.calendar_normalize_text(p_title), '') is null
     or char_length(public.calendar_normalize_text(p_title)) > 500 then
    return public.api_mark_calendar_refusal(
      p_company_id, p_connection_id, p_worker_id, p_pull_generation,
      p_task_id, p_provider_instance_id, p_provider_version,
      'invalid_title', 'Provider title is empty or exceeds 500 characters.',
      false, p_outbox_id, p_outbox_generation
    );
  end if;

  v_last_sent := case when v_link.last_sent_snapshot is null then null
                      else public.calendar_normalize_snapshot(v_link.last_sent_snapshot) end;
  v_ours := public.calendar_task_snapshot(
    v_task.due_at, v_task.title, v_task.description,
    v_base, v_connection.selected_calendar_timezone
  );
  v_theirs := public.calendar_snapshot_from_fields(
    p_start_at, p_end_at, p_time_zone, p_title,
    case when p_preserve_description then '' else p_description end
  );
  if p_preserve_description then
    -- Graph online-meeting bodies contain an opaque Teams blob.  Importing or
    -- hashing it would copy provider internals and a later PATCH could destroy
    -- join metadata.  Treat description as unchanged from the agreed base.
    v_theirs := jsonb_set(
      v_theirs, '{descriptionHash}',
      to_jsonb(coalesce(
        v_base->>'descriptionHash',
        public.calendar_snapshot_from_fields(
          p_start_at, p_end_at, p_time_zone, p_title, v_task.description
        )->>'descriptionHash'
      ))
    );
  end if;

  -- A PATCH may have been accepted even though its response was lost.  The
  -- retry then owns the same durable outbox intent, reads the provider state,
  -- and supplies that outbox lease as proof.  Equality with the exact
  -- requested snapshot is stronger evidence than the three-way base: retire
  -- the ambiguity as an observed echo, advance the base, and serialize any
  -- newer local truth as a fresh write.  Without this branch, O -> A (accepted
  -- remotely) -> local B would be misclassified as a human A-vs-B conflict.
  if p_outbox_id is not null then
    select * into v_reconcile_outbox
      from public.calendar_outbox
     where id = p_outbox_id
       and company_id = p_company_id
       and connection_id = p_connection_id
       and task_id = p_task_id
     for update;
  else
    -- A webhook pull can observe the accepted remote write before the outbox
    -- retry reclaims it.  The connection lock held by the pull proof
    -- serializes this lookup with claims/revoke, so matching the one live
    -- ambiguity is safe even without owning that outbox lease.
    select * into v_reconcile_outbox
      from public.calendar_outbox
     where company_id = p_company_id
       and connection_id = p_connection_id
       and task_id = p_task_id
       and state in ('queued', 'leased')
       and action = 'upsert'
       and provider_effect_ambiguous
       and requested_snapshot is not null
       and public.calendar_normalize_snapshot(requested_snapshot) = v_theirs
     for update;
  end if;
  if found then
    if found
       and v_reconcile_outbox.state = 'leased'
       and p_outbox_id is not null
       and (
         v_reconcile_outbox.lease_owner is distinct from p_worker_id
         or v_reconcile_outbox.lease_expires_at <= now()
         or v_reconcile_outbox.generation is distinct from p_outbox_generation
       ) then
      -- The helper normally returns before here; keep the row-level predicate
      -- explicit so future proof changes cannot turn a guessed id into echo
      -- authority.
      null;
    elsif v_reconcile_outbox.state in ('queued', 'leased')
       and v_reconcile_outbox.action = 'upsert'
       and v_reconcile_outbox.link_id = v_link.id
       and v_reconcile_outbox.provider_effect_ambiguous
       and public.calendar_normalize_snapshot(
             v_reconcile_outbox.requested_snapshot
           ) = v_theirs then
      update public.task_calendar_links
         set link_state = 'active',
             base_snapshot = v_theirs,
             provider_version = p_provider_version,
             last_sent_snapshot = null,
             last_sent_provider_version = null,
             last_sent_at = null,
             conflict_ours_snapshot = null,
             conflict_theirs_snapshot = null,
             conflict_detected_at = null,
             event_removed_at = null,
             refusal_code = null,
             refusal_detail = null,
             refused_at = null,
             unlinked_at = null,
             last_provider_seen_at = now()
       where id = v_link.id;
      update public.calendar_outbox
         set state = 'completed', completed_at = now(),
             lease_owner = null, lease_expires_at = null,
             provider_effect_ambiguous = false,
             provider_effect_lease_generation = null,
             last_error_code = null, last_error_detail = null
       where id = v_reconcile_outbox.id;

      if v_ours is distinct from v_theirs then
        insert into public.calendar_outbox (
          company_id, connection_id, task_id, link_id, action,
          requested_snapshot, provider_precondition
        ) values (
          p_company_id, p_connection_id, p_task_id, v_link.id, 'upsert',
          v_ours, p_provider_version
        ) returning id, generation into v_outbox_id, v_generation;
        return jsonb_build_object(
          'outcome', 'push_queued',
          'reason', 'ambiguous_effect_recovered',
          'outbox_id', v_outbox_id,
          'generation', v_generation
        );
      end if;
      return jsonb_build_object(
        'outcome', 'echo', 'reason', 'ambiguous_effect_recovered'
      );
    end if;
  end if;

  if v_ours is null then
    -- A removed/refused occurrence may later reappear as an ordinary timed
    -- provider event.  That new valid observation resolves the attention state
    -- unless the local task was independently deleted or reassigned.
    if v_link.link_state in ('event_removed', 'refused')
       and v_task.deleted_at is null
       and exists (select 1 from public.task_assignees tas where tas.task_id = v_task.id and tas.user_id = v_connection.user_id)
       and public.calendar_task_access_allowed(
         v_connection.user_id, v_task.company_id, v_task.conversation_id
       ) then
      v_due_changed := v_task.due_at is distinct from p_start_at;
      perform set_config('loonext.calendar_provider_apply', 'on', true);
      update public.tasks
         set due_at = p_start_at,
             title = p_title,
             description = case when p_preserve_description
               then v_task.description else coalesce(p_description, '') end
       where id = p_task_id;
      perform set_config('loonext.calendar_provider_apply', v_prior_flag, true);
      if v_due_changed then
        delete from public.scheduled_messages
         where company_id = p_company_id
           and task_id = p_task_id
           and origin = 'reminder'
           and status = 'pending';
      end if;
      update public.task_calendar_links
         set link_state = 'active',
             base_snapshot = v_theirs,
             provider_version = p_provider_version,
             last_sent_snapshot = null,
             last_sent_provider_version = null,
             last_sent_at = null,
             conflict_ours_snapshot = null,
             conflict_theirs_snapshot = null,
             conflict_detected_at = null,
             event_removed_at = null,
             refusal_code = null,
             refusal_detail = null,
             refused_at = null,
             unlinked_at = null,
             last_provider_seen_at = now()
       where id = v_link.id;
      update public.calendar_outbox
         set state = 'cancelled', cancelled_at = now(),
             lease_owner = null, lease_expires_at = null
       where connection_id = p_connection_id and task_id = p_task_id
         and state in ('queued', 'leased');
      return jsonb_build_object(
        'outcome', 'provider_applied', 'recovered_from', v_link.link_state
      );
    end if;
    return jsonb_build_object('outcome', 'local_unscheduled');
  end if;

  -- Exact field equality, not version equality, proves an echo.  Echo evidence
  -- is one-shot: once that exact provider state is observed it is retired so a
  -- later human change back to the same values remains a real provider edit.
  if v_last_sent is not null and v_theirs = v_last_sent then
    update public.task_calendar_links
       set link_state = 'active',
           base_snapshot = v_last_sent,
           provider_version = p_provider_version,
           last_sent_snapshot = null,
           last_sent_provider_version = null,
           last_sent_at = null,
           conflict_ours_snapshot = null,
           conflict_theirs_snapshot = null,
           conflict_detected_at = null,
           event_removed_at = null,
           refusal_code = null,
           refusal_detail = null,
           refused_at = null,
           unlinked_at = null,
           last_provider_seen_at = now()
     where id = v_link.id;
    if v_ours = v_last_sent then
      update public.calendar_outbox
         set state = 'cancelled', cancelled_at = now(),
             lease_owner = null, lease_expires_at = null
       where connection_id = p_connection_id and task_id = p_task_id
         and state in ('queued', 'leased');
      return jsonb_build_object('outcome', 'echo');
    end if;
    perform public.api_enqueue_calendar_push(
      p_company_id, p_connection_id, p_worker_id, p_pull_generation,
      p_task_id, v_link.id,
      p_provider_version, v_ours, p_outbox_id, p_outbox_generation
    );
    return jsonb_build_object('outcome', 'push_queued', 'reason', 'echo_superseded');
  end if;

  if v_ours = v_base and v_theirs <> v_base then
    v_due_changed := v_task.due_at is distinct from p_start_at;
    perform set_config('loonext.calendar_provider_apply', 'on', true);
    update public.tasks
       set due_at = p_start_at,
           title = p_title,
           description = case when p_preserve_description
             then v_task.description else coalesce(p_description, '') end
     where id = p_task_id;
    perform set_config('loonext.calendar_provider_apply', v_prior_flag, true);

    if v_due_changed then
      delete from public.scheduled_messages
       where company_id = p_company_id
         and task_id = p_task_id
         and origin = 'reminder'
         and status = 'pending';
    end if;
    update public.task_calendar_links
       set link_state = 'active',
           base_snapshot = v_theirs,
           provider_version = p_provider_version,
           last_sent_snapshot = null,
           last_sent_provider_version = null,
           last_sent_at = null,
           conflict_ours_snapshot = null,
           conflict_theirs_snapshot = null,
           conflict_detected_at = null,
           event_removed_at = null,
           refusal_code = null,
           refusal_detail = null,
           refused_at = null,
           unlinked_at = null,
           last_provider_seen_at = now()
     where id = v_link.id;
    update public.calendar_outbox
       set state = 'cancelled', cancelled_at = now(),
           lease_owner = null, lease_expires_at = null
     where connection_id = p_connection_id and task_id = p_task_id
       and state in ('queued', 'leased');
    return jsonb_build_object('outcome', 'provider_applied');
  end if;

  if v_theirs = v_base and v_ours <> v_base then
    update public.task_calendar_links
       set link_state = 'active',
           provider_version = p_provider_version,
           last_sent_snapshot = null,
           last_sent_provider_version = null,
           last_sent_at = null,
           conflict_ours_snapshot = null,
           conflict_theirs_snapshot = null,
           conflict_detected_at = null,
           event_removed_at = null,
           refusal_code = null,
           refusal_detail = null,
           refused_at = null,
           unlinked_at = null,
           last_provider_seen_at = now()
     where id = v_link.id;
    perform public.api_enqueue_calendar_push(
      p_company_id, p_connection_id, p_worker_id, p_pull_generation,
      p_task_id, v_link.id,
      p_provider_version, v_ours, p_outbox_id, p_outbox_generation
    );
    return jsonb_build_object('outcome', 'push_queued', 'reason', 'only_local_changed');
  end if;

  if v_ours = v_theirs then
    update public.task_calendar_links
       set link_state = 'active',
           base_snapshot = v_theirs,
           provider_version = p_provider_version,
           last_sent_snapshot = null,
           last_sent_provider_version = null,
           last_sent_at = null,
           conflict_ours_snapshot = null,
           conflict_theirs_snapshot = null,
           conflict_detected_at = null,
           event_removed_at = null,
           refusal_code = null,
           refusal_detail = null,
           refused_at = null,
           unlinked_at = null,
           last_provider_seen_at = now()
     where id = v_link.id;
    update public.calendar_outbox
       set state = 'cancelled', cancelled_at = now(),
           lease_owner = null, lease_expires_at = null
     where connection_id = p_connection_id and task_id = p_task_id
       and state in ('queued', 'leased');
    return jsonb_build_object('outcome', 'converged');
  end if;

  update public.task_calendar_links
     set link_state = 'conflict',
         provider_version = p_provider_version,
         last_sent_snapshot = null,
         last_sent_provider_version = null,
         last_sent_at = null,
         conflict_ours_snapshot = v_ours,
         conflict_theirs_snapshot = v_theirs,
         conflict_detected_at = now(),
         last_provider_seen_at = now()
   where id = v_link.id;
  if v_link.link_state <> 'conflict' then
    perform public.calendar_record_connection_conflict(p_connection_id);
  end if;
  update public.calendar_outbox
     set state = 'cancelled', cancelled_at = now(),
         lease_owner = null, lease_expires_at = null
   where connection_id = p_connection_id and task_id = p_task_id
     and state in ('queued', 'leased');
  return jsonb_build_object('outcome', 'conflict');
end $$;

-- api_mark_calendar_event_removed, from 20260825020000_two_way_calendar_sync_outbox.sql: the assignee tests read task_assignees.
create or replace function public.api_mark_calendar_event_removed(
  p_company_id            uuid,
  p_connection_id         uuid,
  p_worker_id             text,
  p_pull_generation      bigint,
  p_task_id               uuid,
  p_provider_instance_id  text,
  p_provider_version      text,
  p_outbox_id             uuid default null,
  p_outbox_generation     bigint default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease text;
  v_cleanup_outbox public.calendar_outbox%rowtype;
  v_link public.task_calendar_links%rowtype;
  v_task public.tasks%rowtype;
  v_connection public.calendar_connections%rowtype;
  v_current jsonb;
  v_followup_id uuid;
  v_prior_flag text := coalesce(current_setting('loonext.calendar_provider_apply', true), '');
begin
  v_lease := public.calendar_sync_mutation_lease_outcome(
    p_company_id, p_connection_id, p_task_id, p_worker_id,
    p_pull_generation, p_outbox_id, p_outbox_generation
  );
  if v_lease <> 'current' then
    return jsonb_build_object('outcome', v_lease);
  end if;
  -- A security scrub may have conditionally deleted our provider occurrence
  -- before its response was lost.  A webhook tombstone is then success
  -- evidence for that durable intent, not a human cancellation of the task.
  -- Pull proof holds the connection serialization row; lock and retire the
  -- exact one-live ambiguous scrub without clearing the app due/reminders.
  select * into v_cleanup_outbox
    from public.calendar_outbox o
   where o.company_id = p_company_id
     and o.connection_id = p_connection_id
     and o.task_id = p_task_id
     and o.action = 'scrub'
     and o.state in ('queued', 'leased')
     and o.provider_effect_ambiguous
   for update;
  if found then
    select * into v_link
      from public.task_calendar_links l
     where l.id = v_cleanup_outbox.link_id
       and l.company_id = p_company_id
       and l.connection_id = p_connection_id
       and l.task_id = p_task_id
       and l.provider_instance_id = p_provider_instance_id
     for update;
    if found then
      select * into v_task from public.tasks
       where id = p_task_id and company_id = p_company_id for update;
      select * into v_connection from public.calendar_connections
       where id = p_connection_id and company_id = p_company_id for update;
      update public.task_calendar_links
         set link_state = 'unlinked', unlinked_at = now(),
             provider_version = null,
             last_sent_snapshot = null,
             last_sent_provider_version = null,
             last_sent_at = null,
             conflict_ours_snapshot = null,
             conflict_theirs_snapshot = null,
             conflict_detected_at = null,
             event_removed_at = null,
             refusal_code = null,
             refusal_detail = null,
             refused_at = null,
             last_provider_seen_at = now()
       where id = v_link.id;
      update public.calendar_outbox
         set state = 'completed', completed_at = now(),
             lease_owner = null, lease_expires_at = null,
             provider_effect_ambiguous = false,
             provider_effect_lease_generation = null,
             last_error_code = null, last_error_detail = null
       where id = v_cleanup_outbox.id;

      -- Access may have been restored while the delete was in flight.  The
      -- deleted occurrence is never patched; current truth gets a fresh create.
      if v_connection.status = 'active'
         and v_connection.revoked_at is null
         and v_task.deleted_at is null
         and v_task.due_at is not null
         and public.calendar_task_in_sync_window(v_task.due_at)
         and exists (select 1 from public.task_assignees tas where tas.task_id = v_task.id and tas.user_id = v_connection.user_id)
         and public.calendar_task_access_allowed(
           v_connection.user_id, v_task.company_id, v_task.conversation_id
         ) then
        v_current := public.calendar_task_snapshot(
          v_task.due_at, v_task.title, v_task.description, null,
          v_connection.selected_calendar_timezone
        );
        insert into public.calendar_outbox (
          company_id, connection_id, task_id, link_id, action,
          requested_snapshot, provider_precondition
        ) values (
          p_company_id, p_connection_id, p_task_id, v_link.id,
          'create', v_current, null
        ) returning id into v_followup_id;
      end if;
      perform public.calendar_finalize_disconnected_connection(p_connection_id);
      return jsonb_build_object(
        'outcome', 'event_removed',
        'reason', 'scrub_effect_recovered',
        'followup_outbox_id', v_followup_id
      );
    end if;
  end if;
  update public.task_calendar_links
     set provider_version = p_provider_version,
         last_provider_seen_at = now()
   where company_id = p_company_id
     and connection_id = p_connection_id
     and task_id = p_task_id
     and provider_instance_id = p_provider_instance_id
     and link_state = 'event_removed';
  if found then
    return jsonb_build_object('outcome', 'event_removed');
  end if;
  -- A provider removal observed after a true three-way conflict is additional
  -- provider evidence, not permission to erase the still-unresolved app edit.
  -- Keep the conflict snapshots/task due intact so the human can still choose
  -- the app value; event_removed_at records the newer provider condition and
  -- makes replay idempotent while the pull cursor is allowed to advance.
  update public.task_calendar_links
     set provider_version = p_provider_version,
         event_removed_at = coalesce(event_removed_at, now()),
         refusal_code = null,
         refusal_detail = null,
         refused_at = null,
         last_provider_seen_at = now()
   where company_id = p_company_id
     and connection_id = p_connection_id
     and task_id = p_task_id
     and provider_instance_id = p_provider_instance_id
     and link_state = 'conflict';
  if found then
    return jsonb_build_object(
      'outcome', 'event_removed', 'attention_state', 'conflict'
    );
  end if;
  update public.task_calendar_links
     set link_state = 'event_removed', event_removed_at = now(),
         provider_version = p_provider_version,
         last_sent_snapshot = null,
         last_sent_provider_version = null,
         last_sent_at = null,
         conflict_ours_snapshot = null,
         conflict_theirs_snapshot = null,
         conflict_detected_at = null,
         refusal_code = null,
         refusal_detail = null,
         refused_at = null,
         last_provider_seen_at = now()
   where company_id = p_company_id
     and connection_id = p_connection_id
     and task_id = p_task_id
     and provider_instance_id = p_provider_instance_id
     and link_state in ('active', 'refused');
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;

  perform set_config('loonext.calendar_provider_apply', 'on', true);
  update public.tasks set due_at = null where id = p_task_id and company_id = p_company_id;
  perform set_config('loonext.calendar_provider_apply', v_prior_flag, true);
  delete from public.scheduled_messages
   where company_id = p_company_id and task_id = p_task_id
     and origin = 'reminder' and status = 'pending';
  update public.calendar_outbox
     set state = 'cancelled', cancelled_at = now(),
         lease_owner = null, lease_expires_at = null
   where connection_id = p_connection_id and task_id = p_task_id
     and state in ('queued', 'leased');
  return jsonb_build_object('outcome', 'event_removed');
end $$;

-- api_resolve_calendar_conflict, from 20260825020000_two_way_calendar_sync_outbox.sql: the assignee tests read task_assignees.
create or replace function public.api_resolve_calendar_conflict(
  p_company_id           uuid,
  p_user_id              uuid,
  p_link_id              uuid,
  p_resolution           text,
  p_provider_instance_id text default null,
  p_provider_version     text default null,
  p_start_at             timestamptz default null,
  p_end_at               timestamptz default null,
  p_time_zone            text default null,
  p_title                text default null,
  p_description          text default null,
  p_expected_app_snapshot jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link       public.task_calendar_links%rowtype;
  v_connection public.calendar_connections%rowtype;
  v_connection_id uuid;
  v_task       public.tasks%rowtype;
  v_snapshot   jsonb;
  v_current_app_snapshot jsonb;
  v_outbox_id  uuid;
  v_generation bigint;
  v_prior_flag text := coalesce(current_setting('loonext.calendar_provider_apply', true), '');
begin
  if p_resolution not in ('use_app', 'use_calendar', 'not_sure') then
    raise exception 'calendar conflict resolution must be use_app, use_calendar or not_sure';
  end if;
  if not exists (
    select 1 from public.company_members m
     where m.company_id = p_company_id and m.user_id = p_user_id
       and m.deactivated_at is null
  ) then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  select c.id into v_connection_id
    from public.task_calendar_links l
    join public.calendar_connections c on c.id = l.connection_id
    join public.tasks t on t.id = l.task_id and t.company_id = l.company_id
   where l.id = p_link_id and l.company_id = p_company_id
     and c.user_id = p_user_id and l.link_state = 'conflict'
     and public.calendar_task_access_allowed(
       p_user_id, t.company_id, t.conversation_id
     );
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  select * into v_connection
    from public.calendar_connections
   where id = v_connection_id and company_id = p_company_id
     and user_id = p_user_id
   for update;
  select * into v_link
    from public.task_calendar_links
   where id = p_link_id and company_id = p_company_id
     and connection_id = v_connection_id and link_state = 'conflict'
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if p_resolution = 'not_sure' then
    return jsonb_build_object('outcome', 'still_flagged');
  end if;
  if v_connection.status <> 'active' or v_connection.revoked_at is not null then
    return jsonb_build_object('outcome', 'disconnected');
  end if;
  select * into v_task
    from public.tasks
   where id = v_link.task_id and company_id = p_company_id
   for update;

  if p_expected_app_snapshot is null then
    return jsonb_build_object('outcome', 'app_snapshot_required');
  end if;
  v_current_app_snapshot := public.calendar_task_snapshot(
    v_task.due_at, v_task.title, v_task.description,
    v_link.base_snapshot, v_connection.selected_calendar_timezone
  );
  if v_current_app_snapshot is null
     or v_current_app_snapshot is distinct from
        public.calendar_normalize_snapshot(p_expected_app_snapshot) then
    return jsonb_build_object(
      'outcome', 'attention_stale',
      'current_app_snapshot', v_current_app_snapshot
    );
  end if;

  -- A removal/refusal observed after the card's original conflict makes the
  -- old provider choice inapplicable.  Do not ask the caller to manufacture a
  -- canonical instant from a 404/all-day/invalid occurrence; expose the
  -- durable condition so the card can refresh while preserving app evidence.
  if p_resolution = 'use_calendar' and v_link.event_removed_at is not null then
    return jsonb_build_object(
      'outcome', 'provider_condition_changed',
      'provider_condition', 'event_removed'
    );
  end if;
  if p_resolution = 'use_calendar' and v_link.refusal_code is not null then
    return jsonb_build_object(
      'outcome', 'provider_condition_changed',
      'provider_condition', 'refused',
      'refusal_code', v_link.refusal_code
    );
  end if;

  if p_resolution = 'use_app' then
    if not found or v_task.deleted_at is not null or v_task.due_at is null
       or not exists (select 1 from public.task_assignees tas where tas.task_id = v_task.id and tas.user_id = p_user_id)
       or not public.calendar_task_in_sync_window(v_task.due_at)
       or not public.calendar_task_access_allowed(
         p_user_id, v_task.company_id, v_task.conversation_id
       ) then
      return jsonb_build_object(
        'outcome', case
          when v_task.due_at is not null
           and not public.calendar_task_in_sync_window(v_task.due_at)
          then 'outside_sync_window' else 'task_ineligible' end
      );
    end if;
    if v_link.refusal_code is not null
       and nullif(v_link.provider_version, '') is null then
      return jsonb_build_object('outcome', 'provider_version_required');
    end if;
    v_snapshot := public.calendar_task_snapshot(
      v_task.due_at, v_task.title, v_task.description,
      v_link.base_snapshot, v_connection.selected_calendar_timezone
    );
    update public.task_calendar_links
       set link_state = 'active',
           last_sent_snapshot = null,
           last_sent_provider_version = null,
           last_sent_at = null,
           conflict_ours_snapshot = null, conflict_theirs_snapshot = null,
           conflict_detected_at = null,
           event_removed_at = null,
           refusal_code = null, refusal_detail = null, refused_at = null
     where id = v_link.id;
    insert into public.calendar_outbox (
      company_id, connection_id, task_id, link_id, action,
      requested_snapshot, provider_precondition
    ) values (
      p_company_id, v_connection.id, v_task.id, v_link.id,
      case when v_link.event_removed_at is not null then 'create' else 'upsert' end,
      v_snapshot,
      case when v_link.event_removed_at is not null
           then null else v_link.provider_version end
    )
    on conflict (connection_id, task_id)
      where state in ('queued', 'leased')
    do update set
      link_id = excluded.link_id, action = excluded.action,
      requested_snapshot = excluded.requested_snapshot,
      provider_precondition = excluded.provider_precondition,
      generation = public.calendar_outbox.generation + 1,
      state = 'queued', attempts = 0, available_at = now(),
      lease_owner = null, lease_expires_at = null,
      last_error_code = null, last_error_detail = null,
      cancelled_at = null
    returning id, generation into v_outbox_id, v_generation;
    return jsonb_build_object(
      'outcome', 'queued', 'outbox_id', v_outbox_id,
      'generation', v_generation
    );
  end if;

  -- `use_calendar` must be based on a fresh GET of this exact occurrence.  The
  -- plaintext provider description crosses this transaction but is not stored
  -- as a second attention copy; only its canonical hash enters the snapshot.
  if p_provider_instance_id is distinct from v_link.provider_instance_id then
    return jsonb_build_object('outcome', 'provider_instance_mismatch');
  end if;
  if nullif(p_provider_version, '') is null then
    return jsonb_build_object('outcome', 'provider_version_required');
  end if;
  if p_start_at is null
     or not public.calendar_task_in_sync_window(p_start_at) then
    update public.task_calendar_links
       set provider_version = p_provider_version,
           refusal_code = case when p_start_at is null
             then 'invalid_time' else 'outside_sync_window' end,
           refusal_detail = case when p_start_at is null
             then 'Fresh provider occurrence has no usable start instant.'
             else 'Fresh provider occurrence is outside the supported sync window.' end,
           refused_at = coalesce(refused_at, now()),
           event_removed_at = null,
           last_provider_seen_at = now()
     where id = v_link.id;
    return jsonb_build_object(
      'outcome', 'provider_condition_changed',
      'provider_condition', 'refused',
      'refusal_code', case when p_start_at is null
        then 'invalid_time' else 'outside_sync_window' end
    );
  end if;
  v_snapshot := public.calendar_snapshot_from_fields(
    p_start_at, p_end_at, p_time_zone, p_title, p_description
  );
  perform set_config('loonext.calendar_provider_apply', 'on', true);
  update public.tasks
     set due_at = p_start_at,
         title = public.calendar_normalize_text(p_title),
         description = public.calendar_normalize_text(p_description)
   where id = v_task.id;
  perform set_config('loonext.calendar_provider_apply', v_prior_flag, true);
  delete from public.scheduled_messages
   where company_id = p_company_id and task_id = v_task.id
     and origin = 'reminder' and status = 'pending';
  perform public.calendar_enqueue_reminder_replan(
    p_company_id, v_task.id, p_user_id
  );
  update public.task_calendar_links
     set link_state = 'active', base_snapshot = v_snapshot,
         provider_version = p_provider_version,
         last_sent_snapshot = null,
         last_sent_provider_version = null,
         last_sent_at = null,
         conflict_ours_snapshot = null, conflict_theirs_snapshot = null,
         conflict_detected_at = null,
         event_removed_at = null,
         refusal_code = null, refusal_detail = null, refused_at = null,
         last_provider_seen_at = now()
   where id = v_link.id;
  update public.calendar_outbox
     set state = 'cancelled', cancelled_at = now(),
         lease_owner = null, lease_expires_at = null
   where connection_id = v_connection.id and task_id = v_task.id
     and state in ('queued', 'leased');
  return jsonb_build_object('outcome', 'resolved', 'source', 'calendar');
end $$;
