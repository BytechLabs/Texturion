-- #106 (#80): the DERIVED read-models (for-you D23, notifications D24) must
-- honor per-number access — a restricted member's focus queue, notification
-- feed, and bell badge must never surface a conversation (or a task on a
-- conversation) whose number is hidden from them.
--
-- A NEW migration (never edits a shipped one, D7/D14). Each function gains a
-- trailing p_hidden_number_ids uuid[] (null = unrestricted → every filter is a
-- no-op, so owners/admins and no-rules companies are byte-for-byte unchanged).
-- The Worker resolves the caller's HIDDEN numbers (auth/number-access.ts —
-- resolveNumberAccess, a DENY list) and passes them. Un-ruled / released / NULL
-- numbers are never in the list, so they stay visible (matches the list RPC in
-- 20260709001100). The signatures change, so the old overloads are dropped
-- first (PostgREST must never see two candidates).

-- ===========================================================================
-- 1. api_for_you — gains p_hidden_number_ids. The conv CTE filter covers every
--    conversation section (waiting_on_you / unread / triage_convs derive from
--    it); the task sections (my_tasks / triage_tasks) filter via NOT EXISTS on
--    the owning conversation's number. Body otherwise identical to
--    20260702070000.
-- ===========================================================================
drop function if exists public.api_for_you(uuid, uuid, boolean, timestamptz, int);

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
      -- #106: drop conversations on a number hidden from the caller.
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
      -- #106: hide a task whose conversation is on a hidden number.
      and (p_hidden_number_ids is null or not exists (
            select 1 from public.conversations cc
             where cc.id = t.conversation_id
               and cc.phone_number_id = any(p_hidden_number_ids)))
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
      and (p_hidden_number_ids is null or not exists (
            select 1 from public.conversations cc
             where cc.id = t.conversation_id
               and cc.phone_number_id = any(p_hidden_number_ids)))
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

-- ===========================================================================
-- 2. api_notifications — gains p_hidden_number_ids. Every union arm already
--    joins conversations c, so the deny filter drops in per arm. Body otherwise
--    identical to 20260702070000.
-- ===========================================================================
drop function if exists public.api_notifications(uuid, uuid, int, timestamptz, uuid);

create or replace function public.api_notifications(
  p_company_id        uuid,
  p_user_id           uuid,
  p_limit             int,
  p_before_ts         timestamptz default null,
  p_before_id         uuid        default null,
  p_hidden_number_ids uuid[]      default null
) returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with seen as (
    select coalesce(
             (select nr.last_seen_at from public.notification_reads nr
               where nr.user_id = p_user_id and nr.company_id = p_company_id),
             '-infinity'::timestamptz) as last_seen_at
  ),
  feed as (
    select m.id,
           'inbound_message'::text as type,
           m.created_at,
           m.conversation_id,
           m.id     as message_id,
           null::uuid as task_id,
           c.contact_id
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.company_id = p_company_id
      and m.direction = 'inbound'
      and c.assigned_user_id = p_user_id
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
    union all
    select e.id, 'assigned', e.created_at, e.conversation_id,
           null::uuid, null::uuid, c.contact_id
    from public.conversation_events e
    join public.conversations c on c.id = e.conversation_id
    where e.company_id = p_company_id
      and e.type = 'assigned'
      and e.payload->>'to' = p_user_id::text
      and coalesce(e.actor_user_id, '00000000-0000-0000-0000-000000000000') <> p_user_id
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
    union all
    select e.id, 'task_assigned', e.created_at, e.conversation_id,
           null::uuid, (e.payload->>'task_id')::uuid, c.contact_id
    from public.conversation_events e
    join public.conversations c on c.id = e.conversation_id
    where e.company_id = p_company_id
      and e.type = 'task_assigned'
      and e.payload->>'to_user_id' = p_user_id::text
      and coalesce(e.actor_user_id, '00000000-0000-0000-0000-000000000000') <> p_user_id
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
  )
  select jsonb_build_object(
           'id', f.id,
           'type', f.type,
           'conversation_id', f.conversation_id,
           'message_id', f.message_id,
           'task_id', f.task_id,
           'contact', jsonb_build_object('id', ct.id, 'name', ct.name,
                                         'phone_e164', ct.phone_e164),
           'created_at', f.created_at,
           'unread', (f.created_at > s.last_seen_at))
  from feed f
  cross join seen s
  left join public.contacts ct on ct.id = f.contact_id
  where (p_before_ts is null or (f.created_at, f.id) < (p_before_ts, p_before_id))
  order by f.created_at desc, f.id desc
  limit greatest(p_limit, 0)
$$;

-- ===========================================================================
-- 3. api_notifications_unread_count — gains p_hidden_number_ids. The two
--    conversation_events arms did not previously need the conversations row;
--    they now join it purely for the number filter (kept consistent with the
--    list feed so the badge and the popover never disagree).
-- ===========================================================================
drop function if exists public.api_notifications_unread_count(uuid, uuid);

create or replace function public.api_notifications_unread_count(
  p_company_id        uuid,
  p_user_id           uuid,
  p_hidden_number_ids uuid[] default null
) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  with seen as (
    select coalesce(
             (select nr.last_seen_at from public.notification_reads nr
               where nr.user_id = p_user_id and nr.company_id = p_company_id),
             '-infinity'::timestamptz) as last_seen_at
  )
  select count(*)::bigint from (
    select m.created_at
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.company_id = p_company_id and m.direction = 'inbound'
      and c.assigned_user_id = p_user_id
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
    union all
    select e.created_at
    from public.conversation_events e
    join public.conversations c on c.id = e.conversation_id
    where e.company_id = p_company_id and e.type = 'assigned'
      and e.payload->>'to' = p_user_id::text
      and coalesce(e.actor_user_id, '00000000-0000-0000-0000-000000000000') <> p_user_id
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
    union all
    select e.created_at
    from public.conversation_events e
    join public.conversations c on c.id = e.conversation_id
    where e.company_id = p_company_id and e.type = 'task_assigned'
      and e.payload->>'to_user_id' = p_user_id::text
      and coalesce(e.actor_user_id, '00000000-0000-0000-0000-000000000000') <> p_user_id
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
  ) f, seen s
  where f.created_at > s.last_seen_at
$$;

-- ---------------------------------------------------------------------------
-- Privileges: deny-by-default (SPEC §6). Strip PUBLIC EXECUTE on the new
-- signatures, grant only service_role (the Worker).
-- ---------------------------------------------------------------------------
revoke execute on function public.api_for_you(uuid, uuid, boolean, timestamptz, int, uuid[])
  from public, anon, authenticated;
revoke execute on function public.api_notifications(uuid, uuid, int, timestamptz, uuid, uuid[])
  from public, anon, authenticated;
revoke execute on function public.api_notifications_unread_count(uuid, uuid, uuid[])
  from public, anon, authenticated;

grant execute on function public.api_for_you(uuid, uuid, boolean, timestamptz, int, uuid[])
  to service_role;
grant execute on function public.api_notifications(uuid, uuid, int, timestamptz, uuid, uuid[])
  to service_role;
grant execute on function public.api_notifications_unread_count(uuid, uuid, uuid[])
  to service_role;
