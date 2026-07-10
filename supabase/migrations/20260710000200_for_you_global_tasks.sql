-- #107 (#80): tasks are GLOBAL. The #106 read-model migration
-- (20260710000000) filtered EVERY for-you section by hidden numbers, including
-- the TASK sections (my_tasks, triage_tasks). But #107's decision keeps tasks
-- company-global — a member assigned a task still sees it on /for-you, gated
-- only at the point of opening the conversation (GET /v1/tasks/:id redacts
-- content at level 'none'). The task cards carry a title (globally visible by
-- design) + opaque ids, never a contact name or message snippet, so surfacing
-- them leaks nothing.
--
-- So this recreates api_for_you dropping the hidden-number filter from the two
-- TASK sections while KEEPING it on the three CONVERSATION sections
-- (waiting_on_you / unread / triage — those carry contact identity + snippets,
-- which #106 must still hide). A NEW migration (never edits the shipped
-- 20260710000000, D7/D14). Signature is unchanged.

create or replace function public.api_for_you(
  p_company_id        uuid,
  p_user_id           uuid,
  p_is_lead           boolean,
  p_now               timestamptz,
  p_limit             int      default 20,
  p_hidden_number_ids uuid[]   default null
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with
  conv as (
    select c.*,
           (c.last_message_at > coalesce(
              (select r.last_read_at from public.conversation_reads r
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
  my_tasks as (
    select t.id, t.title, t.conversation_id, t.message_id,
           t.assigned_user_id, t.due_at, t.created_at,
           (t.due_at is not null and t.due_at < p_now) as overdue
    from public.tasks t
    join public.messages m on m.id = t.message_id
    where t.company_id = p_company_id
      and t.deleted_at is null
      and t.assigned_user_id = p_user_id
      and m.done_at is null
    order by (t.due_at is not null and t.due_at < p_now) desc,
             t.due_at asc nulls last,
             t.created_at asc, t.id asc
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
  triage_tasks as (
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
    order by (t.due_at is not null and t.due_at < p_now) desc,
             t.due_at asc nulls last,
             t.created_at asc, t.id asc
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
    ) else null end
  )
$$;
