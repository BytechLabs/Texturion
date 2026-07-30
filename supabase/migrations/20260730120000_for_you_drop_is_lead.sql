-- #454 — the contract half of #416/D53's expand: `api_for_you` stops carrying a
-- boolean it ignores.
--
-- #416 removed every gate that read `p_is_lead`, and kept the parameter so the
-- migration and the Worker could deploy in either order. A boolean named
-- `p_is_lead` on a security-relevant RPC reads as though it still scopes
-- something, and the next person to touch this has to trace four call sites to
-- learn that it does not.
--
-- ---------------------------------------------------------------------------
-- THIS IS THE EXPAND STEP, NOT THE CONTRACT, AND THE ISSUE'S ORDERING IS WRONG.
--
-- #454 says: *"Deploy the Worker first, then the migration. The reverse drops
-- the 6-arg function while the running Worker is still calling it, and every
-- /v1/for-you request 500s until the deploy lands."*
--
-- The reasoning is exactly right and the instruction is not achievable.
-- `.github/workflows/ship.yml` runs `supabase db push` (line 92) BEFORE
-- `wrangler deploy` (line 99), and that order is correct in general — an
-- additive migration must land before the Worker that needs it. So a release
-- that drops the 6-arg function IS the reverse order the issue warns about, and
-- would 500 every `/v1/for-you` for the length of the Worker deploy.
--
-- So this migration adds the 5-arg function and KEEPS the 6-arg one, forwarding.
-- Both can coexist unambiguously: `p_is_lead` has no default, so a 5-argument
-- PostgREST call cannot match the 6-arg signature, and a 6-argument call cannot
-- match the 5-arg one.
--
-- The drop is a SECOND release, once no deployed Worker sends six arguments —
-- the same expand → adopt → contract sequence #484 used for the realtime topics,
-- and for the same reason: the safe moment to remove something is after nothing
-- is calling it, not in the same breath as the change that stops calling it.
--
-- There is ONE implementation throughout. The 6-arg is a shim that discards its
-- boolean and forwards, so the two signatures cannot answer differently while
-- both exist.

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
      -- #306: every consumer below wants mine, or unassigned. Anything else was
      -- computed and thrown away.
      -- #416: "or unassigned" used to be "or, if you are a lead, unassigned" —
      -- the deepest of the four gates, and the one that made a member's triage
      -- section come back empty rather than absent.
      and (c.assigned_user_id = p_user_id
           or c.assigned_user_id is null)
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
        'distinct_work',
          ct.distinct_conversations
          + (select count(*) from my_tasks_all)
          + (select count(*) from triage_tasks_all))
      from conv_totals ct)
  )
$function$;

-- The 6-arg signature, now a forwarding shim. Kept only for the deploy window;
-- dropped in a later release once no Worker sends the boolean.
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
  -- p_is_lead is accepted and discarded (#416/D53 removed every gate that read
  -- it). Named-argument call so a future parameter reorder cannot silently
  -- change what this forwards.
  select public.api_for_you(
    p_company_id        => p_company_id,
    p_user_id           => p_user_id,
    p_now               => p_now,
    p_limit             => p_limit,
    p_hidden_number_ids => p_hidden_number_ids
  )
$function$;

comment on function public.api_for_you(uuid, uuid, boolean, timestamptz, int, uuid[]) is
  '#454 DEPRECATED: forwards to the 5-arg signature and discards p_is_lead. '
  'Dropped once no deployed Worker sends six arguments.';

revoke all on function public.api_for_you(uuid, uuid, timestamptz, int, uuid[])
  from public, anon, authenticated;
grant execute on function public.api_for_you(uuid, uuid, timestamptz, int, uuid[])
  to service_role;

revoke all on function public.api_for_you(uuid, uuid, boolean, timestamptz, int, uuid[])
  from public, anon, authenticated;
grant execute on function public.api_for_you(uuid, uuid, boolean, timestamptz, int, uuid[])
  to service_role;
