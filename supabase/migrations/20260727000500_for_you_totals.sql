-- ===========================================================================
-- [#306] The focus queue's headline count, told the truth.
--
-- `api_for_you` caps every section at p_limit (20) and returns nothing about
-- what it cut. Every client then counts the rows it was handed, so the number
-- is bounded by the page size rather than by the work:
--
--   a member with 60 conversations waiting on them is told "20 things need
--   you", and the queue looks finished after twenty items.
--
-- It inverts exactly when it matters. A quiet workspace gets an accurate
-- count. A crew that is genuinely drowning — the one most at risk of losing a
-- customer to whoever answered first — is reassured at the moment it should be
-- alarmed.
--
-- THE 20-ROW CAP STAYS (D23: a calm card list, not a paginated inbox). What is
-- added is `totals`, an additive key carrying what each section actually holds.
-- Existing keys are untouched, so a client that has not shipped yet keeps
-- working on the rows exactly as before.
--
-- COUNTING IS NEARLY FREE HERE, which is the part worth knowing before
-- objecting on cost. `conv` was already unbounded: it evaluates the correlated
-- unread EXISTS for every candidate conversation and only then does each
-- section trim to 20. A member with 60 waiting conversations already paid for
-- all 60; the cap was buying JSON size, not work. `conv_totals` is one
-- aggregate pass over a relation that is already materialized (it is
-- referenced four times, so PG12+ will not inline it).
--
-- `conv` IS ALSO NARROWED, and that is output-equivalent rather than a change
-- of behaviour: all three conversation sections require
-- `assigned_user_id = p_user_id` or, for a lead, `assigned_user_id is null`,
-- and `contact_map` draws only from those three. Rows outside that set were
-- computed — unread EXISTS and all — purely to be discarded. On a workspace
-- with one busy member and thousands of live conversations that is the
-- difference between scanning the company and scanning your own work.
--
-- distinct_work is DEDUPLICATED SERVER-SIDE, and it has to be. A conversation
-- can appear in both `waiting_on_you` and `unread`; the shipped web helper
-- counts it once (76209c5). A client cannot do that arithmetic on the new
-- per-section totals — it only ever holds 20 of the N ids — so summing them
-- would silently re-introduce the double count that fix removed.
-- ===========================================================================

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
    select t.id, t.title, t.conversation_id, t.message_id,
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
