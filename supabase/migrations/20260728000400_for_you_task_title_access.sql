-- #417: the /for-you task sections were exempted from the #106 hidden-number
-- filter on a premise the task route contradicts in three places.
--
-- 20260710000200 dropped the filter from the TASK sections, reasoning that
-- "the task cards carry a title (globally visible by design) + opaque ids,
-- never a contact name or message snippet, so surfacing them leaks nothing."
--
-- The default task title IS the message snippet. `routes/tasks.ts` says so
-- three times, and `create_task` seeds it: up to 500 characters of the
-- customer's own words, whitespace-collapsed. So a member denied a number
-- could read a message sent to it, from a card on their own /for-you, while
-- the conversation sections correctly hid the same text.
--
-- The rest of the codebase had already settled this the other way. The search
-- RPC (20260710000100) hides a task whose conversation is on a hidden number,
-- and e181f9f fixed the due-notice push for the same reason, recording that
-- "task titles are seeded from the customer's message". Two SQL
-- implementations of one rule disagreed; this is the eighth place #106 was
-- reasoned about in isolation (#368), which is what #412 is about.
--
-- THE FIX KEEPS #107. Tasks stay company-global: the member still sees the
-- task, still knows it is theirs, still has its ids and due date. Only the
-- TITLE is replaced, because "global" should mean the task is visible, not
-- that its title may quote a message the member is forbidden to read.
--
-- WHY REDACT HERE AND EXCLUDE IN SEARCH, which is not an inconsistency:
-- my_tasks is the member's own assigned work, and hiding a task assigned TO
-- someone would hide their own job from them. Search is a lookup, and a thing
-- you cannot read should not be findable by its hidden contents.
--
-- triage_tasks needs no change and gets none: it is gated on p_is_lead, and
-- owners/admins resolve to hiddenNumberIds = null (auth/number-access.ts
-- short-circuits before any rule is read), so p_hidden_number_ids is always
-- null on that path. The original comment was right about that section.
--
-- Rebuilt from 20260727000500 (the totals version), NOT from 20260710000200 —
-- basing it on the older body silently dropped the `totals` key, which the
-- for-you suite caught immediately. A NEW migration (D7/D14), signature
-- unchanged.

create or replace function public.api_for_you(
  p_company_id        uuid,
  p_user_id           uuid,
  p_is_lead           boolean,
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
      -- #306: every consumer below wants mine, or (for a lead) unassigned.
      -- Anything else was computed and thrown away.
      and (c.assigned_user_id = p_user_id
           or (p_is_lead and c.assigned_user_id is null))
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
        where p_is_lead
          and c.assigned_user_id is null
          and c.status in ('new','open','waiting'))          as triage_conversations,
      -- One conversation, counted once, however many lenses it shows up in.
      count(*) filter (
        where (c.assigned_user_id = p_user_id
               and (c.status in ('open','waiting') or c.unread))
           or (p_is_lead
               and c.assigned_user_id is null
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
    where p_is_lead
      and c.assigned_user_id is null
      and c.status in ('new','open','waiting')
    order by c.last_message_at desc, c.id desc
    limit greatest(p_limit, 0)
  ),
  -- Triage is owner/admin-only, and leads are always unrestricted (their
  -- p_hidden_number_ids is null), so triage_tasks needs no number filter.
  triage_tasks_all as (
    select t.id, t.title, t.conversation_id, t.message_id,
           t.due_at, t.created_at,
           (t.due_at is not null and t.due_at < p_now) as overdue
    from public.tasks t
    join public.messages m on m.id = t.message_id
    where p_is_lead
      and t.company_id = p_company_id
      and t.deleted_at is null
      and t.assigned_user_id is null
      and m.done_at is null
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
    'triage', case when p_is_lead then jsonb_build_object(
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
    ) else null end,
    -- #306: what each section ACTUALLY holds, independent of the 20 returned.
    -- `distinct_work` is the headline number and is the only one a client
    -- should render as "N things need you" — the per-section totals overlap.
    'totals', (
      select jsonb_build_object(
        'waiting_on_you', ct.waiting_on_you,
        'my_tasks', (select count(*) from my_tasks_all),
        'unread', ct.unread,
        'triage_conversations', case when p_is_lead then ct.triage_conversations else 0 end,
        'triage_tasks', (select count(*) from triage_tasks_all),
        'distinct_work',
          ct.distinct_conversations
          + (select count(*) from my_tasks_all)
          + (select count(*) from triage_tasks_all))
      from conv_totals ct)
  )
$function$;

revoke execute on function public.api_for_you(uuid, uuid, boolean, timestamptz, int, uuid[])
  from public, anon, authenticated;
grant execute on function public.api_for_you(uuid, uuid, boolean, timestamptz, int, uuid[])
  to service_role;
