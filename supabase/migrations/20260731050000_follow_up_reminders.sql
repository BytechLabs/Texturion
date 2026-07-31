-- #293 — the outbound-shaped twin: "remind me to chase this in three days
-- if they haven't replied".
--
-- A follow-up reminder is not a second feature. It is a deferral with a
-- different reason and a different way of coming back, so it is the SAME row
-- with a `kind` rather than a second table with its own trigger, its own RLS
-- posture, and its own way of drifting away from this one.
--
-- WHAT IS IDENTICAL, and why sharing the row is the honest model:
--
--   * It hides the thread while pending. A quote you are waiting on is not
--     actionable today; leaving it in the queue is the clutter this issue
--     exists to remove.
--   * A customer reply cancels it, instantly, whatever the timer said. Which
--     means "IF THEY HAVEN'T REPLIED" needs no clause anywhere: the trigger
--     already deletes the row when a customer texts, so a reminder that
--     survives to its due time is by construction one they never answered.
--   * It is per member, and it expires by computation rather than by sweep.
--
-- WHAT DIFFERS is only what happens at `until`:
--
--   * `snooze`    — the thread is simply back in the list. Nothing announces
--                   it.
--   * `follow_up` — the thread is back AND the focus queue says "you asked to
--                   chase this", with the reason you gave, until you dismiss
--                   it or they reply.
--
-- So every existing read stays correct untouched: they all test `until >
-- now()` and neither kind should be visible while pending. The new read tests
-- `until <= now()`, and only for `follow_up`.
--
-- ONE PER (conversation, member), enforced by the primary key that was already
-- there. You are either deferring your own next action or waiting on theirs;
-- holding both at once would be two answers to "when does this come back".

alter table public.conversation_snoozes
  add column if not exists kind text not null default 'snooze'
    check (kind in ('snooze', 'follow_up'));

comment on column public.conversation_snoozes.kind is
  '#293: how this deferral comes back. ''snooze'' returns the thread quietly; '
  '''follow_up'' returns it AND raises it in the focus queue as something to '
  'chase. Both hide the thread while pending; both die on a customer reply.';

-- The focus queue asks "which of my follow-ups have come due" on every load.
create index if not exists conversation_snoozes_follow_up_due_idx
  on public.conversation_snoozes (company_id, user_id, until)
  where kind = 'follow_up';

comment on table public.conversation_snoozes is
  '#293: a per-member deferral of a conversation. A row means "hidden from MY '
  'default view until `until`"; `kind` decides whether it returns quietly '
  '(snooze) or as something to chase (follow_up). Deleted the moment the '
  'customer replies — see cancel_snoozes_on_inbound.';

create or replace function public.api_for_you(
  p_company_id        uuid,
  p_user_id           uuid,
  p_now               timestamptz,
  p_limit             int default 20,
  p_hidden_number_ids uuid[] default null
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with
  conv as (
    select c.*,
           exists (
             select 1
               from public.messages m
              where m.conversation_id = c.id
                and (m.sent_by_user_id is null or m.sent_by_user_id <> p_user_id)
                and m.created_at > coalesce(
                  (select r.last_read_at
                     from public.conversation_reads r
                    where r.conversation_id = c.id and r.user_id = p_user_id),
                  '-infinity'::timestamptz)) as unread
    from public.conversations c
    where c.company_id = p_company_id
      and c.is_spam = false
      and c.closed_at is null
      -- #106: conversation sections still hide conversations on hidden numbers.
      and (p_hidden_number_ids is null
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
      -- #306: every consumer below wants mine, or unassigned. Anything else was
      -- computed and thrown away.
      -- #416: "or unassigned" used to be "or, if you are a lead, unassigned" —
      -- the deepest of the four gates, and the one that made a member's triage
      -- section come back empty rather than absent.
      and (c.assigned_user_id = p_user_id
           or c.assigned_user_id is null)
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
    select f.conversation_id, f.until, f.note,
           c.status, c.contact_id, c.last_message_at, c.unread
    from due_follow_ups f
    join conv c on c.id = f.conversation_id
    order by f.until asc, f.conversation_id asc
    limit greatest(p_limit, 0)
  ),
  conv_overdue_task as (
    select distinct t.conversation_id
    from public.tasks t
    join public.messages m on m.id = t.message_id
    where t.company_id = p_company_id
      and t.deleted_at is null
      and m.done_at is null
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
        where c.unread
          and c.assigned_user_id = p_user_id)                as unread,
      count(*) filter (
        where c.assigned_user_id is null
          and c.status in ('new','open','waiting'))          as triage_conversations,
      -- One conversation, counted once, however many lenses it shows up in.
      count(*) filter (
        where (c.assigned_user_id = p_user_id
               and (c.status in ('open','waiting') or c.unread))
           or (c.assigned_user_id is null
               and c.status in ('new','open','waiting')))     as distinct_conversations
    from conv c
  ),
  waiting_on_you as (
    select c.id, c.status, c.contact_id, c.assigned_user_id,
           c.last_message_at, c.unread,
           (ot.conversation_id is not null) as has_overdue_task,
           case
             when ot.conversation_id is not null then 0
             when c.status = 'waiting'            then 1
             when c.unread                        then 2
             else 3
           end as urgency
    from conv c
    left join conv_overdue_task ot on ot.conversation_id = c.id
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
    join public.messages m on m.id = t.message_id
    where t.company_id = p_company_id
      and t.deleted_at is null
      and t.assigned_user_id = p_user_id
      and m.done_at is null
  ),
  my_tasks as (
    select * from my_tasks_all
    order by overdue desc, due_at asc nulls last, created_at asc, id asc
    limit greatest(p_limit, 0)
  ),
  unread as (
    select c.id, c.status, c.contact_id, c.assigned_user_id, c.last_message_at
    from conv c
    where c.unread
      and c.assigned_user_id = p_user_id
    order by c.last_message_at desc, c.id desc
    limit greatest(p_limit, 0)
  ),
  triage_convs as (
    select c.id, c.status, c.contact_id, c.last_message_at, c.unread
    from conv c
    -- #416: no longer owner/admin-only. Reads from `conv`, which already
    -- carries the #106 hidden-number filter, so a restricted member sees
    -- unclaimed work only on numbers they can access.
    where c.assigned_user_id is null
      and c.status in ('new','open','waiting')
    order by c.last_message_at desc, c.id desc
    limit greatest(p_limit, 0)
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
    join public.messages m on m.id = t.message_id
    where t.company_id = p_company_id
      and t.deleted_at is null
      and t.assigned_user_id is null
      and m.done_at is null
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
               'has_overdue_task', w.has_overdue_task, 'urgency', w.urgency))
      from waiting_on_you w left join contact_map cm on cm.id = w.contact_id),
      '[]'::jsonb),
    'my_tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'task_id', t.id, 'title', t.title,
               'conversation_id', t.conversation_id, 'message_id', t.message_id,
               'assigned_user_id', t.assigned_user_id, 'due_at', t.due_at,
               'overdue', t.overdue))
      from my_tasks t), '[]'::jsonb),
    'unread', coalesce((
      select jsonb_agg(jsonb_build_object(
               'conversation_id', u.id, 'status', u.status, 'contact', cm.j,
               'assigned_user_id', u.assigned_user_id,
               'last_message_at', u.last_message_at))
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
               'unread', f.unread, 'due_at', f.until, 'note', f.note))
      from follow_ups f left join contact_map cm on cm.id = f.contact_id),
      '[]'::jsonb),
    'triage', jsonb_build_object(
      'conversations', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'conversation_id', tc.id, 'status', tc.status, 'contact', cm.j,
                 'last_message_at', tc.last_message_at, 'unread', tc.unread))
        from triage_convs tc left join contact_map cm on cm.id = tc.contact_id),
        '[]'::jsonb),
      'tasks', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'task_id', t.id, 'title', t.title,
                 'conversation_id', t.conversation_id, 'message_id', t.message_id,
                 'due_at', t.due_at, 'overdue', t.overdue))
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
                         and (c.status in ('open','waiting') or c.unread))
                     or (c.assigned_user_id is null
                         and c.status in ('new','open','waiting'))))))
      from conv_totals ct)
  )
$function$;
