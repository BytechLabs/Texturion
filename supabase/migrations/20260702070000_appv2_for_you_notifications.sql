-- App-v2 read-models: /for-you home (D23) + notifications read-model (D24).
-- HOME-AND-VIEWS.md. A NEW migration — never edits a shipped one (D7/D14).
--
-- Both are "mostly queries over existing tables" (HOME-AND-VIEWS "Build fit"):
-- conversations / conversation_reads / tasks (…060000) / messages / the
-- conversation_events audit log. Everything is DERIVED — no notifications
-- "feed" table (D24: prefer deriving over a new heavy table). The single piece
-- of state deriving cannot avoid is a per-user *last-seen* watermark for the
-- read/unread dot + "Mark all read"; that is the one minimal table below
-- (D24: "…or derive from conversation_events + assignments + a per-user
-- last-seen" — this is the last-seen).
--
-- SPEC §7/§10 conventions: SECURITY DEFINER, empty search_path (fully-qualified
-- references), EXECUTE revoked from anon/authenticated — only service_role (the
-- Worker's sb_secret_ key) may call. The Worker passes an explicit p_company_id
-- and p_user_id everywhere (tenant + user isolation, §10). Deny-by-default RLS
-- on the new table (enabled, no anon/authenticated policies/grants — the Worker
-- uses service_role; DML covered by the ALTER DEFAULT PRIVILEGES in
-- 20260701030000_service_role_grants.sql, D8).

-- ===========================================================================
-- 0. notification_reads — the per-user, per-company last-seen watermark (D24).
--
-- The ONLY state the derived notifications read-model needs. A notification is
-- "unread" iff its created_at is strictly greater than the caller's last_seen_at
-- for the active company (missing row ⇒ everything unread, the safe default).
-- "Mark all read" upserts last_seen_at = now(). PK (user_id, company_id) mirrors
-- notification_prefs. Append-friendly single row per (user, company).
-- ===========================================================================
create table public.notification_reads (
  user_id      uuid not null references auth.users(id)      on delete cascade,
  company_id   uuid not null references public.companies(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, company_id)
);

create trigger set_updated_at before update on public.notification_reads
  for each row execute function extensions.moddatetime(updated_at);

-- Deny-by-default RLS (SPEC §6 / D8): enabled, no policies, no anon/authenticated
-- grants. service_role DML via the shipped ALTER DEFAULT PRIVILEGES.
alter table public.notification_reads enable row level security;

-- ===========================================================================
-- 1. api_for_you — the crew member's focus queue (D23). ONE jsonb object with
--    four sections, each urgency-sorted and bounded (a working queue, not a
--    paginated list — HOME-AND-VIEWS D23 "calm card list"). Everything derived
--    over conversations / conversation_reads / tasks / messages.
--
--    Sections:
--      waiting_on_you — conversations assigned to me, status open|waiting, not
--                       spam, not closed; urgency-sorted (overdue-linked-task >
--                       waiting > unread > new), then most-recent activity.
--      my_tasks       — my live OPEN tasks (joined messages.done_at IS NULL);
--                       OVERDUE pinned first, then due_at NULLS LAST.
--      unread         — my conversations (assigned to me OR unassigned/open)
--                       with unread inbound, most-recent first.
--      triage         — owner/admin ONLY (p_is_lead): unassigned open/waiting
--                       conversations + unassigned open tasks — the "needs an
--                       owner" hand-out strip; empty [] for a plain member.
--
--    p_now is injected by the Worker (testable clock); overdue = due_at < p_now.
--    p_limit bounds every section identically (default applied by the Worker).
-- ===========================================================================
create or replace function public.api_for_you(
  p_company_id uuid,
  p_user_id    uuid,
  p_is_lead    boolean,
  p_now        timestamptz,
  p_limit      int default 20
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with
  -- Per-caller unread predicate reused across the conversation sections.
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
  ),
  -- Does a conversation carry a live, still-open, OVERDUE task? (urgency boost).
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
           -- urgency rank (lower = more urgent): overdue-linked > waiting >
           -- unread-new > new (HOME-AND-VIEWS D23 "overdue > waiting > new").
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
      and m.done_at is null                         -- derived "open" (D17)
    -- OVERDUE pinned to the top (D23), then soonest-due, nulls last, then age.
    order by (t.due_at is not null and t.due_at < p_now) desc,
             t.due_at asc nulls last,
             t.created_at asc, t.id asc
    limit greatest(p_limit, 0)
  ),
  -- "My conversations with unread inbound" (D23 §3): assigned to me, any
  -- non-closed status, unread. Unassigned threads are NOT here — they belong to
  -- the owner/admin triage strip (§4), never a member's unread cross-cut.
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
    order by (t.due_at is not null and t.due_at < p_now) desc,
             t.due_at asc nulls last,
             t.created_at asc, t.id asc
    limit greatest(p_limit, 0)
  ),
  -- Contact summaries for every conversation surfaced above, in one pass.
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
-- 2. api_notifications — the DERIVED recent-notifications feed (D24). No feed
--    table: a UNION over existing sources, each tagged with a type, deep-link
--    ids, created_at, and an `unread` dot derived from the caller's last-seen
--    watermark (notification_reads). Sources (D24's trigger list, minus
--    @mention which does not ship yet):
--      inbound_message — inbound messages in a conversation ASSIGNED TO ME
--                        ("new inbound in a thread you're assigned to")
--      assigned        — conversation_events type 'assigned' with payload.to = me
--                        ("assigned-to-you")
--      task_assigned   — conversation_events type 'task_assigned' with
--                        payload.to_user_id = me ("task-assigned")
--    Keyset-paginated on (created_at, id) DESC (§7 cursor convention); the
--    Worker builds the opaque cursor. p_before_ts/p_before_id page the union.
-- ===========================================================================
create or replace function public.api_notifications(
  p_company_id uuid,
  p_user_id    uuid,
  p_limit      int,
  p_before_ts  timestamptz default null,
  p_before_id  uuid        default null
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
    -- inbound in a thread assigned to me
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
    union all
    -- conversation assigned to me
    select e.id, 'assigned', e.created_at, e.conversation_id,
           null::uuid, null::uuid, c.contact_id
    from public.conversation_events e
    join public.conversations c on c.id = e.conversation_id
    where e.company_id = p_company_id
      and e.type = 'assigned'
      and e.payload->>'to' = p_user_id::text
      -- a self-assign is not a notification to yourself
      and coalesce(e.actor_user_id, '00000000-0000-0000-0000-000000000000') <> p_user_id
    union all
    -- task assigned to me
    select e.id, 'task_assigned', e.created_at, e.conversation_id,
           null::uuid, (e.payload->>'task_id')::uuid, c.contact_id
    from public.conversation_events e
    join public.conversations c on c.id = e.conversation_id
    where e.company_id = p_company_id
      and e.type = 'task_assigned'
      and e.payload->>'to_user_id' = p_user_id::text
      and coalesce(e.actor_user_id, '00000000-0000-0000-0000-000000000000') <> p_user_id
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
-- 3. api_notifications_unread_count — the bell badge (D24). Count of feed items
--    strictly newer than the caller's last-seen watermark. Same union as above,
--    unfiltered by cursor. Cheap: the bell shows a count, the popover lists.
-- ===========================================================================
create or replace function public.api_notifications_unread_count(
  p_company_id uuid,
  p_user_id    uuid
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
    union all
    select e.created_at
    from public.conversation_events e
    where e.company_id = p_company_id and e.type = 'assigned'
      and e.payload->>'to' = p_user_id::text
      and coalesce(e.actor_user_id, '00000000-0000-0000-0000-000000000000') <> p_user_id
    union all
    select e.created_at
    from public.conversation_events e
    where e.company_id = p_company_id and e.type = 'task_assigned'
      and e.payload->>'to_user_id' = p_user_id::text
      and coalesce(e.actor_user_id, '00000000-0000-0000-0000-000000000000') <> p_user_id
  ) f, seen s
  where f.created_at > s.last_seen_at
$$;

-- ===========================================================================
-- 4. api_mark_notifications_read — "Mark all read" (D24). Upserts the caller's
--    last-seen watermark to p_now, so every current feed item becomes read.
--    (Per-notification mark-read is expressed the same way: the client stamps
--    the watermark forward; a derived feed has no per-row read flag to write.)
--    Returns the stamped watermark.
-- ===========================================================================
create or replace function public.api_mark_notifications_read(
  p_company_id uuid,
  p_user_id    uuid,
  p_now        timestamptz
) returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen timestamptz;
begin
  insert into public.notification_reads (user_id, company_id, last_seen_at)
  values (p_user_id, p_company_id, p_now)
  on conflict (user_id, company_id) do update
    set last_seen_at = greatest(public.notification_reads.last_seen_at, excluded.last_seen_at)
  returning last_seen_at into v_seen;
  return v_seen;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges: deny-by-default (SPEC §6). Strip PUBLIC EXECUTE, grant only
-- service_role (the Worker). No end-user role can reach these even with a valid
-- Supabase Auth JWT.
-- ---------------------------------------------------------------------------
revoke execute on function public.api_for_you(uuid, uuid, boolean, timestamptz, int)
  from public, anon, authenticated;
revoke execute on function public.api_notifications(uuid, uuid, int, timestamptz, uuid)
  from public, anon, authenticated;
revoke execute on function public.api_notifications_unread_count(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.api_mark_notifications_read(uuid, uuid, timestamptz)
  from public, anon, authenticated;

grant execute on function public.api_for_you(uuid, uuid, boolean, timestamptz, int)
  to service_role;
grant execute on function public.api_notifications(uuid, uuid, int, timestamptz, uuid)
  to service_role;
grant execute on function public.api_notifications_unread_count(uuid, uuid)
  to service_role;
grant execute on function public.api_mark_notifications_read(uuid, uuid, timestamptz)
  to service_role;
