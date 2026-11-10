-- D64 / #356: a task promotes a source, and the source is a message OR an
-- answered call. Until now `tasks.message_id` was NOT NULL, so a job agreed on
-- the phone could not be recorded, while the public tasks page said it could.
--
-- The rule that keeps D17 intact: exactly one row owns the done state of a task.
--   message-anchored -> messages.done_at (unchanged; tasks.done_at stays null)
--   no message       -> tasks.done_at
-- The CHECK makes the two-flags state unreachable. It deliberately also admits a
-- task with no anchor at all (#689, standalone); nothing here builds that, it is
-- only not forbidden in SQL.
--
-- tasks.conversation_id stays NOT NULL: every reader that gates a task by the
-- number it belongs to goes through the conversation. A call that never got a
-- conversation (anonymous caller, or the conversation was removed) is refused at
-- promotion with `call_no_conversation` instead of becoming an ungated task.
--
-- Only an ANSWERED call can be promoted. A voicemail is already a message in the
-- thread (with its recording and transcript), so it promotes as a message.
--
-- Every function below is restated from its newest definition with the one
-- change that a call-anchored task needs: the inner join to messages becomes a
-- left join, and completion reads coalesce(m.done_at, t.done_at). Each is
-- revoked from public/anon/authenticated before the service_role grant, because
-- a recreated function regains the hosted default grants.

-- ---------------------------------------------------------------------------
-- 1. The columns, the anchor rule, one live task per call
-- ---------------------------------------------------------------------------
alter table public.tasks alter column message_id drop not null;

alter table public.tasks
  add column source_call_id uuid references public.calls(id) on delete restrict,
  add column done_at timestamptz,
  add column done_by_user_id uuid references auth.users(id) on delete set null;

alter table public.tasks add constraint tasks_one_done_owner check (
  (message_id is not null and source_call_id is null
     and done_at is null and done_by_user_id is null)
  or message_id is null
);

create unique index tasks_source_call_uq on public.tasks (source_call_id)
  where source_call_id is not null and deleted_at is null;

comment on column public.tasks.message_id is
  'D17/D64: the message this task promotes; null for a call-anchored (or standalone) task. When set, messages.done_at owns the done state.';
comment on column public.tasks.source_call_id is
  'D64: the answered call this task promotes. At most one live task per call (tasks_source_call_uq).';
comment on column public.tasks.done_at is
  'D64: the done state of a task that has no message. Always null while message_id is set (tasks_one_done_owner); read as coalesce(messages.done_at, tasks.done_at).';

-- ---------------------------------------------------------------------------
-- 2. The map view reads the same done state, and carries the call
-- ---------------------------------------------------------------------------
create or replace view public.task_map_rows
  with (security_invoker = true) as
select
  t.id, t.company_id, t.message_id, t.conversation_id, t.title, t.description,
  t.assigned_user_id, t.due_at, t.created_by_user_id, t.created_at, t.updated_at,
  t.addr_street, t.addr_unit, t.addr_city, t.addr_state, t.addr_postal_code,
  t.addr_country, t.addr_provenance, t.lat, t.lng, t.deleted_at,
  coalesce(m.done_at, t.done_at) as done_at,
  cv.phone_number_id,
  c.id   as contact_id,
  c.name as contact_name,
  c.lat  as contact_lat,
  c.lng  as contact_lng,
  coalesce(t.lat, c.lat) as map_lat,
  coalesce(t.lng, c.lng) as map_lng,
  t.reminders_off,
  t.confirmed_at,
  t.confirmed_by,
  t.source_call_id
from public.tasks t
join public.conversations cv on cv.id = t.conversation_id
join public.contacts     c  on c.id  = cv.contact_id
left join public.messages m on m.id  = t.message_id;

-- ---------------------------------------------------------------------------
-- 3. create_task takes a message or a call; set_task_done writes the owner
-- ---------------------------------------------------------------------------
drop function if exists public.create_task(
  uuid, uuid, text, text, uuid, timestamptz, uuid,
  text, text, text, text, text, text, text);

create or replace function public.create_task(
  p_company_id       uuid,
  p_message_id       uuid,
  p_title            text,
  p_description      text,
  p_assigned_user_id uuid,
  p_due_at           timestamptz,
  p_actor_user_id    uuid,
  p_addr_street      text default null,
  p_addr_unit        text default null,
  p_addr_city        text default null,
  p_addr_state       text default null,
  p_addr_postal_code text default null,
  p_addr_country     text default null,
  p_addr_provenance  text default null,
  p_call_id          uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation_id uuid;
  v_body            text;
  v_direction       text;
  v_title           text;
  v_has_address     boolean;
  v_provenance      text;
  v_task            public.tasks%rowtype;
  v_call            record;
begin
  -- Exactly one source: a message or a call.
  if (p_message_id is null) = (p_call_id is null) then
    return jsonb_build_object('outcome', 'no_source', 'task', null);
  end if;

  if p_message_id is not null then
    select m.conversation_id, m.body, m.direction
      into v_conversation_id, v_body, v_direction
      from public.messages m
     where m.company_id = p_company_id
       and m.id = p_message_id;
    if not found then
      return jsonb_build_object('outcome', 'no_message', 'task', null);
    end if;
  else
    select k.conversation_id, k.outcome,
           coalesce(nullif(k.caller_name, ''), nullif(ct.name, ''), k.caller_e164) as who
      into v_call
      from public.calls k
      left join public.contacts ct on ct.id = k.contact_id
     where k.company_id = p_company_id
       and k.id = p_call_id;
    if not found then
      return jsonb_build_object('outcome', 'no_call', 'task', null);
    end if;
    if v_call.outcome is distinct from 'answered' then
      return jsonb_build_object('outcome', 'call_not_answered', 'task', null);
    end if;
    if v_call.conversation_id is null then
      return jsonb_build_object('outcome', 'call_no_conversation', 'task', null);
    end if;
    v_conversation_id := v_call.conversation_id;
    v_body := 'Call from ' || coalesce(v_call.who, 'unknown caller');
  end if;

  -- Assignee must be an active member of the company (validation_failed).
  if p_assigned_user_id is not null then
    perform 1
      from public.company_members cm
     where cm.company_id = p_company_id
       and cm.user_id = p_assigned_user_id
       and cm.deactivated_at is null;
    if not found then
      return jsonb_build_object('outcome', 'not_member', 'task', null);
    end if;
  end if;

  v_title := coalesce(
    nullif(p_title, ''),
    left(nullif(trim(regexp_replace(coalesce(v_body, ''), '\s+', ' ', 'g')), ''), 500),
    'Task');

  v_has_address := coalesce(
    p_addr_street, p_addr_unit, p_addr_city, p_addr_state,
    p_addr_postal_code, p_addr_country) is not null;
  v_provenance := case when v_has_address then p_addr_provenance else null end;

  begin
    insert into public.tasks
      (company_id, message_id, source_call_id, conversation_id, title,
       description, assigned_user_id, due_at, created_by_user_id,
       addr_street, addr_unit, addr_city, addr_state, addr_postal_code,
       addr_country, addr_provenance)
    values
      (p_company_id, p_message_id, p_call_id, v_conversation_id, v_title,
       coalesce(p_description, ''), p_assigned_user_id, p_due_at,
       p_actor_user_id,
       p_addr_street, p_addr_unit, p_addr_city, p_addr_state,
       p_addr_postal_code, p_addr_country, v_provenance)
    returning * into v_task;
  exception when unique_violation then
    -- A second live promotion of the same message or call.
    return jsonb_build_object('outcome', 'conflict', 'task', null);
  end;

  -- attach_fixes [#2]: link the SOURCE note back to the new task.
  if v_direction = 'note' then
    update public.messages
       set task_id = v_task.id
     where id = p_message_id
       and task_id is null;
  end if;

  -- T2.1 audit: one task_created row on the source conversation, same txn.
  insert into public.conversation_events
    (company_id, conversation_id, actor_user_id, type, payload)
  values
    (p_company_id, v_conversation_id, p_actor_user_id, 'task_created',
     case when p_message_id is not null
          then jsonb_build_object('task_id', v_task.id, 'message_id', p_message_id)
          else jsonb_build_object('task_id', v_task.id, 'call_id', p_call_id)
     end);

  return jsonb_build_object('outcome', 'created', 'task', to_jsonb(v_task));
end $$;

revoke execute on function public.create_task(
  uuid, uuid, text, text, uuid, timestamptz, uuid,
  text, text, text, text, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.create_task(
  uuid, uuid, text, text, uuid, timestamptz, uuid,
  text, text, text, text, text, text, text, uuid) to service_role;

-- The one place a task's done state is written. A message-anchored task goes
-- through set_message_done (D17, with its D22 event); a task without a message
-- writes its own done_at. Idempotent: a redundant toggle writes nothing.
create or replace function public.set_task_done(
  p_company_id    uuid,
  p_task_id       uuid,
  p_done          boolean,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task   public.tasks%rowtype;
  v_result jsonb;
begin
  select * into v_task
    from public.tasks t
   where t.company_id = p_company_id
     and t.id = p_task_id
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found', 'task', null);
  end if;

  if v_task.message_id is not null then
    v_result := public.set_message_done(
      p_company_id, v_task.message_id, p_done, p_actor_user_id);
    return jsonb_build_object(
      'outcome', v_result->>'outcome',
      'task', to_jsonb(v_task),
      'done_at', v_result->'message'->'done_at');
  end if;

  if p_done = (v_task.done_at is not null) then
    return jsonb_build_object(
      'outcome', 'unchanged', 'task', to_jsonb(v_task),
      'done_at', to_jsonb(v_task.done_at));
  end if;

  update public.tasks
     set done_at = case when p_done then now() end,
         done_by_user_id = case when p_done then p_actor_user_id end
   where id = v_task.id
  returning * into v_task;

  return jsonb_build_object(
    'outcome', 'updated', 'task', to_jsonb(v_task),
    'done_at', to_jsonb(v_task.done_at));
end $$;

revoke execute on function public.set_task_done(uuid, uuid, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.set_task_done(uuid, uuid, boolean, uuid)
  to service_role;

-- A task's effective done state as a PostgREST computed column, so the list can
-- select it and filter open/done on it whichever row owns it. An inner embed of
-- messages cannot do that: it would drop every task that has no message.
create or replace function public.task_done_at(public.tasks)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select m.done_at from public.messages m where m.id = $1.message_id),
    $1.done_at);
$$;

create or replace function public.task_done_by(public.tasks)
returns uuid
language sql
stable
set search_path = ''
as $$
  select case when $1.message_id is not null
    then (select m.done_by_user_id from public.messages m where m.id = $1.message_id)
    else $1.done_by_user_id end;
$$;

revoke execute on function public.task_done_at(public.tasks)
  from public, anon, authenticated;
grant execute on function public.task_done_at(public.tasks) to service_role;
revoke execute on function public.task_done_by(public.tasks)
  from public, anon, authenticated;
grant execute on function public.task_done_by(public.tasks) to service_role;

-- ---------------------------------------------------------------------------
-- 4. api_for_you: a call-anchored task is still this member's work
-- ---------------------------------------------------------------------------

create or replace function public.api_for_you(
  p_company_id uuid,
  p_user_id uuid,
  p_now timestamptz,
  p_limit integer default 20,
  p_hidden_number_ids uuid[] default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$

  with
  conv as (
    select c.*,
           -- CASE, not AND: for an UNASSIGNED row "assigned_user_id = p_user_id" is
           -- NULL rather than false, and "NULL and x" must still evaluate x to
           -- learn whether the answer is NULL or false. An AND here reads as a
           -- short circuit and measured as none. CASE short-circuits by
           -- definition; the ELSE covers somebody else's row and an unassigned one.
           case when c.assigned_user_id = p_user_id then exists (
             select 1
               from public.messages m
              where m.conversation_id = c.id
                and (m.sent_by_user_id is null or m.sent_by_user_id <> p_user_id)
                and m.created_at > coalesce(
                  (select r.last_read_at
                     from public.conversation_reads r
                    where r.conversation_id = c.id and r.user_id = p_user_id),
                  '-infinity'::timestamptz)) else false end as unread_mine
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
    -- Unread is read for the rows that survive. It is shown here and never
    -- filtered or sorted on, so it belongs after the limit.
    select p.*, exists (
             select 1
               from public.messages m
              where m.conversation_id = p.conversation_id
                and (m.sent_by_user_id is null or m.sent_by_user_id <> p_user_id)
                and m.created_at > coalesce(
                  (select r.last_read_at
                     from public.conversation_reads r
                    where r.conversation_id = p.conversation_id and r.user_id = p_user_id),
                  '-infinity'::timestamptz)) as unread
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
    left join public.messages m on m.id = t.message_id
    where t.company_id = p_company_id
      and t.deleted_at is null
      and coalesce(m.done_at, t.done_at) is null
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
           (ot.conversation_id is not null) as has_overdue_task,
           case
             when ot.conversation_id is not null then 0
             when c.status = 'waiting'            then 1
             when c.unread_mine                   then 2
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
    left join public.messages m on m.id = t.message_id
    where t.company_id = p_company_id
      and t.deleted_at is null
      and t.assigned_user_id = p_user_id
      and coalesce(m.done_at, t.done_at) is null
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
    select p.*, exists (
             select 1
               from public.messages m
              where m.conversation_id = p.id
                and (m.sent_by_user_id is null or m.sent_by_user_id <> p_user_id)
                and m.created_at > coalesce(
                  (select r.last_read_at
                     from public.conversation_reads r
                    where r.conversation_id = p.id and r.user_id = p_user_id),
                  '-infinity'::timestamptz)) as unread
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
    left join public.messages m on m.id = t.message_id
    where t.company_id = p_company_id
      and t.deleted_at is null
      and t.assigned_user_id is null
      and coalesce(m.done_at, t.done_at) is null
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
$fn$;

revoke execute on function public.api_for_you(uuid, uuid, timestamptz, integer, uuid[])
  from public, anon, authenticated;
grant execute on function public.api_for_you(uuid, uuid, timestamptz, integer, uuid[])
  to service_role;


-- ---------------------------------------------------------------------------
-- 5. api_search_v2: search finds a call-anchored task
-- ---------------------------------------------------------------------------

create or replace function public.api_search_v2(p_company_id uuid, p_q text, p_conversation_limit integer, p_contact_limit integer, p_task_limit integer, p_attachment_limit integer, p_template_limit integer, p_cursor_ts timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_hidden_number_ids uuid[] DEFAULT NULL::uuid[], p_voicemail_limit integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'conversations',
    coalesce((
      select jsonb_agg(hit.row_json order by hit.matched_at desc, hit.cid desc)
      from (
        select c.id as cid, m.created_at as matched_at,
               jsonb_build_object(
                 'id', c.id,
                 'status', c.status,
                 'is_spam', c.is_spam,
                 'last_message_at', c.last_message_at,
                 'contact', jsonb_build_object(
                   'id', ct.id, 'name', ct.name, 'phone_e164', ct.phone_e164),
                 'matched_message_id', m.id,
                 'matched_at', m.created_at,
                 'direction', m.direction,
                 'snippet', ts_headline('english', m.body,
                                        websearch_to_tsquery('english', p_q))
               ) as row_json
        from (
          select distinct on (m0.conversation_id)
                 m0.id, m0.conversation_id, m0.created_at, m0.body, m0.direction
          from public.messages m0
          where m0.company_id = p_company_id
            and m0.body_tsv @@ websearch_to_tsquery('english', p_q)
          order by m0.conversation_id, m0.created_at desc, m0.id desc
        ) m
        join public.conversations c on c.id = m.conversation_id
        join public.contacts ct on ct.id = c.contact_id
        where (p_cursor_ts is null
               or (m.created_at, c.id) < (p_cursor_ts, p_cursor_id))
          -- #106: never surface a conversation on a number hidden from the caller.
          and (p_hidden_number_ids is null
               or c.phone_number_id is null
               or not (c.phone_number_id = any(p_hidden_number_ids)))
        order by m.created_at desc, c.id desc
        limit greatest(p_conversation_limit, 0)
      ) hit
    ), '[]'::jsonb),
    'contacts',
    coalesce((
      select jsonb_agg(
               jsonb_build_object('id', k.id, 'name', k.name,
                                  'phone_e164', k.phone_e164)
               order by k.sim desc, k.id)
      from (
        select ct.id, ct.name, ct.phone_e164,
               greatest(extensions.similarity(coalesce(ct.name, ''), p_q),
                        extensions.similarity(ct.phone_e164, p_q)) as sim
        from public.contacts ct
        where ct.company_id = p_company_id
          and ct.deleted_at is null
          and (ct.name ilike ('%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
               or ct.phone_e164 ilike ('%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
               -- Digits against digits, so a number typed or pasted the way
               -- it is READ finds the contact. Substring matching on the
               -- stored value cannot: it holds +16478923862, and every
               -- human spelling carries punctuation the pattern fails on.
               or (length(regexp_replace(p_q, '[^0-9]', '', 'g')) >= 3
                   and regexp_replace(ct.phone_e164, '[^0-9]', '', 'g')
                       like ('%' || regexp_replace(p_q, '[^0-9]', '', 'g') || '%'))
               or coalesce(ct.name, '') operator(extensions.%) p_q)
        order by sim desc, ct.id
        limit greatest(p_contact_limit, 0)
      ) k
    ), '[]'::jsonb),
    'tasks',
    coalesce((
      select jsonb_agg(k.row_json order by k.sim desc, k.created_at desc, k.id)
      from (
        select t.id, t.created_at,
               greatest(extensions.word_similarity(p_q, t.title),
                        extensions.word_similarity(p_q, t.description)) as sim,
               jsonb_build_object(
                 'id', t.id,
                 'title', t.title,
                 'conversation_id', t.conversation_id,
                 'done', (coalesce(m.done_at, t.done_at) is not null),
                 'matched_at', t.created_at
               ) as row_json
        from public.tasks t
        left join public.messages m on m.id = t.message_id
        where t.company_id = p_company_id
          and t.deleted_at is null
          and (t.title ilike ('%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
               or t.description ilike ('%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
               or p_q operator(extensions.<%) t.title
               or p_q operator(extensions.<%) t.description)
          -- #106: hide a task whose conversation is on a hidden number.
          and (p_hidden_number_ids is null or not exists (
                select 1 from public.conversations cc
                 where cc.id = t.conversation_id
                   and cc.phone_number_id = any(p_hidden_number_ids)))
        order by sim desc, t.created_at desc, t.id
        limit greatest(p_task_limit, 0)
      ) k
    ), '[]'::jsonb),
    'attachments',
    coalesce((
      select jsonb_agg(k.row_json order by k.sim desc, k.created_at desc, k.id)
      from (
        select a.id, a.created_at,
               extensions.similarity(coalesce(a.file_name, ''), p_q) as sim,
               jsonb_build_object(
                 'id', a.id,
                 'file_name', a.file_name,
                 'owner_type', a.owner_type,
                 'conversation_id', a.conversation_id,
                 'content_type', a.content_type,
                 'created_at', a.created_at
               ) as row_json
        from public.attachments a
        where a.company_id = p_company_id
          and a.deleted_at is null
          and (a.file_name ilike ('%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
               or a.file_name operator(extensions.%) p_q)
          -- #106: hide an attachment whose conversation is on a hidden number.
          and (p_hidden_number_ids is null or not exists (
                select 1 from public.conversations cc
                 where cc.id = a.conversation_id
                   and cc.phone_number_id = any(p_hidden_number_ids)))
        order by sim desc, a.created_at desc, a.id
        limit greatest(p_attachment_limit, 0)
      ) k
    ), '[]'::jsonb),
    'templates',
    coalesce((
      select jsonb_agg(k.row_json order by k.sim desc, k.id)
      from (
        select t.id,
               greatest(extensions.similarity(t.name, p_q),
                        extensions.word_similarity(p_q, t.body)) as sim,
               jsonb_build_object(
                 'id', t.id,
                 'name', t.name,
                 'snippet', left(t.body, 160)
               ) as row_json
        from public.templates t
        where t.company_id = p_company_id
          -- #419: a soft-deleted saved reply must not resurface here.
          -- Search was the one reader outside the route, and it would
          -- have kept offering a template nobody could open.
          and t.deleted_at is null
          and (t.name ilike ('%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
               or t.body ilike ('%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
               or t.name operator(extensions.%) p_q
               or p_q operator(extensions.<%) t.body)
        order by sim desc, t.id
        limit greatest(p_template_limit, 0)
      ) k
    ), '[]'::jsonb),
    -- #409: the words we paid to write down.
    --
    -- Transcription exists because somebody on a roof or next to a running
    -- compressor cannot play a voicemail, and one nobody listens to is a
    -- missed customer. We spend Workers AI money per audio-minute, store the
    -- words, cap and alert on the spend, and render them on three clients —
    -- and then the one thing text is uniquely good for, finding it again
    -- later, did not work. "What did that guy say about the boiler on Elm
    -- Street?" three weeks on is a real daily question.
    --
    -- #106 IS ENFORCED HERE, directly. A call carries `phone_number_id`, so
    -- the deny-list filter is a plain predicate rather than the subquery the
    -- attachment arm needs — but it is not optional: a transcript is customer
    -- speech, and an arm that forgot this would be a way to read around the
    -- deny list. That is exactly the trap #368 describes, a rule enforced by
    -- N independent implementations where the newest one forgets.
    'voicemails',
    coalesce((
      select jsonb_agg(k.row_json order by k.sim desc, k.id)
      from (
        select c.id,
               extensions.word_similarity(p_q, c.voicemail_transcript) as sim,
               jsonb_build_object(
                 'id', c.id,
                 'call_session_id', c.call_session_id,
                 'contact_id', c.contact_id,
                 'caller_e164', c.caller_e164,
                 'started_at', c.started_at,
                 'snippet', left(c.voicemail_transcript, 160)
               ) as row_json
        from public.calls c
        where c.company_id = p_company_id
          and c.voicemail_transcript is not null
          and (c.voicemail_transcript ilike ('%' || replace(replace(replace(p_q, '', '\'), '%', '\%'), '_', '\_') || '%')
               or p_q operator(extensions.<%) c.voicemail_transcript)
          and (p_hidden_number_ids is null
               or c.phone_number_id is null
               or not (c.phone_number_id = any(p_hidden_number_ids)))
        order by sim desc, c.started_at desc, c.id
        limit greatest(p_voicemail_limit, 0)
      ) k
    ), '[]'::jsonb)
  )
$function$;

revoke execute on function public.api_search_v2(uuid, text, int, int, int, int, int, timestamptz, uuid, uuid[], int)
  from public, anon, authenticated;
grant execute on function public.api_search_v2(uuid, text, int, int, int, int, int, timestamptz, uuid, uuid[], int)
  to service_role;


-- ---------------------------------------------------------------------------
-- 6. api_member_holdings / offboard_member: a departing member's open call tasks move too
-- ---------------------------------------------------------------------------

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
         and t.assigned_user_id = p_user_id
         and t.deleted_at is null
         and coalesce(m.done_at, t.done_at) is null
    )
  );
$$;

revoke execute on function public.api_member_holdings(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.api_member_holdings(uuid, uuid)
  to service_role;

create or replace function public.offboard_member(
  p_company_id  uuid,
  p_member_id   uuid,
  p_reassign_to uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_role    text;
  v_deactivated timestamptz;
  v_conversations int := 0;
  v_tasks int := 0;
begin
  select m.user_id, m.role::text, m.deactivated_at
    into v_user_id, v_role, v_deactivated
    from public.company_members m
   where m.company_id = p_company_id and m.id = p_member_id
   for update;

  if v_user_id is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_role = 'owner' then
    return jsonb_build_object('outcome', 'owner');
  end if;

  -- A destination must be someone who will actually see the work: an ACTIVE
  -- member of this company, and not the person being removed.
  if p_reassign_to is not null then
    if p_reassign_to = v_user_id then
      return jsonb_build_object('outcome', 'bad_destination');
    end if;
    if not exists (
      select 1 from public.company_members m
       where m.company_id = p_company_id
         and m.user_id = p_reassign_to
         and m.deactivated_at is null
    ) then
      return jsonb_build_object('outcome', 'bad_destination');
    end if;
  end if;

  if v_deactivated is null then
    update public.company_members
       set deactivated_at = now()
     where company_id = p_company_id and id = p_member_id;
  end if;

  -- Open conversations. `closed_at is null` is the same "still live" test the
  -- inbox uses, so what moves is exactly what someone would still be working.
  update public.conversations
     set assigned_user_id = p_reassign_to
   where company_id = p_company_id
     and assigned_user_id = v_user_id
     and closed_at is null;
  get diagnostics v_conversations = row_count;

  -- Open tasks. Completion is the source message's done_at, or the task's own
  -- done_at when it has no message (D64), so a finished task is left exactly as
  -- it was.
  update public.tasks t
     set assigned_user_id = p_reassign_to,
         updated_at = now()
   where t.company_id = p_company_id
     and t.assigned_user_id = v_user_id
     and t.deleted_at is null
     and coalesce(
       (select m.done_at from public.messages m where m.id = t.message_id),
       t.done_at
     ) is null;
  get diagnostics v_tasks = row_count;

  return jsonb_build_object(
    'outcome', case when v_deactivated is null then 'deactivated' else 'already' end,
    'user_id', v_user_id,
    'conversations', v_conversations,
    'tasks', v_tasks
  );
end $$;

revoke execute on function public.offboard_member(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.offboard_member(uuid, uuid, uuid)
  to service_role;


-- ---------------------------------------------------------------------------
-- 7. api_contact_timeline: a call-anchored task reaches the contact through its conversation
-- ---------------------------------------------------------------------------

create or replace function public.api_contact_timeline(
  p_company_id uuid,
  p_contact_id uuid,
  p_limit      int default 50,
  -- The decoded halves of the opaque cursor. Both null on the first page; the
  -- API layer never passes one without the other.
  p_before_ts  timestamptz default null,
  p_before_id  uuid default null
) returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with entries as (
    -- CONVERSATIONS, ordered by last activity rather than creation: a thread
    -- reopened last week belongs beside last week.
    select
      'conversation'::text as kind,
      c.id                 as id,
      coalesce(c.last_message_at, c.created_at) as occurred_at,
      c.id                 as conversation_id,
      c.status::text       as status,
      null::text           as detail,
      c.created_at         as started_at,
      null::int            as talk_seconds,
      null::timestamptz    as due_at,
      null::boolean        as done
    from public.conversations c
    where c.company_id = p_company_id
      and c.contact_id = p_contact_id
      -- A spam thread is not part of the relationship. It stays reachable in
      -- the inbox's spam view; here it would be the one entry that makes the
      -- rest untrustworthy.
      and coalesce(c.is_spam, false) = false

    union all

    select
      'call'::text,
      k.id,
      k.started_at,
      k.conversation_id,
      k.outcome::text,
      k.caller_name,
      k.started_at,
      -- Talk time: the forward leg's billable seconds, never ring time.
      k.forward_seconds,
      null::timestamptz,
      null::boolean
    from public.calls k
    where k.company_id = p_company_id
      and k.contact_id = p_contact_id

    union all

    -- TASKS, via their conversation. `done` is the source message's done_at exactly as the
    -- checklist reads it (D17), or the task's own done_at when it was promoted
    -- from a call (D64); never both.
    select
      'task'::text,
      t.id,
      t.created_at,
      t.conversation_id,
      null::text,
      t.title,
      t.created_at,
      null::int,
      t.due_at,
      coalesce(m.done_at, t.done_at) is not null
    from public.tasks t
    join public.conversations tc on tc.id = t.conversation_id
    left join public.messages m on m.id = t.message_id
    where t.company_id = p_company_id
      and tc.contact_id = p_contact_id
      and t.deleted_at is null
  )
  select jsonb_build_object(
    'kind', e.kind,
    'id', e.id,
    'occurred_at', e.occurred_at,
    'conversation_id', e.conversation_id,
    'status', e.status,
    'detail', e.detail,
    'started_at', e.started_at,
    'talk_seconds', e.talk_seconds,
    'due_at', e.due_at,
    'done', e.done
  )
  from entries e
  where p_before_ts is null
     -- ROW-WISE, matching the ORDER BY exactly. Comparing only the timestamp
     -- skips the second of any two entries that share one.
     or (e.occurred_at, e.id) < (p_before_ts, p_before_id)
  order by e.occurred_at desc, e.id desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

revoke execute on function public.api_contact_timeline(uuid, uuid, int, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.api_contact_timeline(uuid, uuid, int, timestamptz, uuid)
  to service_role;


-- ---------------------------------------------------------------------------
-- 8. api_bulk_tasks: done writes the owner of the task's done state
-- ---------------------------------------------------------------------------

create or replace function public.api_bulk_tasks(
  p_company_id     uuid,
  p_user_id        uuid,
  p_action         text,
  p_ids            uuid[],
  -- The assign target. NULL is legitimate (unassign) and is why the action has
  -- to be named separately from the value.
  p_target_user_id uuid    default null,
  -- #106: numbers this actor may not see. Their tasks are refused by id rather
  -- than silently skipped — a caller that asked about a task it cannot see gets
  -- told, and the count it renders stays true.
  p_hidden_number_ids uuid[] default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap      int := public.api_bulk_task_cap();
  v_matched  int := 0;
  v_selected uuid[];
  v_applied  jsonb := '[]'::jsonb;
  v_failed   jsonb := '[]'::jsonb;
  v_now      timestamptz := now();
  v_row      record;
  v_result   jsonb;
begin
  if p_action is null or p_action not in ('mark_done', 'mark_undone', 'assign', 'delete') then
    return jsonb_build_object('error', 'validation_failed');
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    return jsonb_build_object('error', 'validation_failed');
  end if;

  -- NOTHING HERE CAN SEND A MESSAGE, and the enum above is what guarantees it.
  -- #275 established that rule at the route AND in SQL; a new bulk surface that
  -- only enforced it in TypeScript would be one route handler away from
  -- texting a customer list.

  -- Resolve ONCE, and intersect the caller's ids with what they may actually
  -- see. An id the caller was not entitled to comes back as `failed`, never
  -- silently applied and never silently dropped.
  select count(*)::int,
         (array_agg(t.id order by t.id))[1:v_cap]
    into v_matched, v_selected
    from public.tasks t
    left join public.conversations c on c.id = t.conversation_id
   where t.company_id = p_company_id
     and t.deleted_at is null
     and t.id = any(p_ids)
     and (
       p_hidden_number_ids is null
       or array_length(p_hidden_number_ids, 1) is null
       -- A task whose conversation has no number cannot be hidden BY number,
       -- so it stays visible. `tasks.conversation_id` is nullable.
       or c.phone_number_id is null
       or not (c.phone_number_id = any(p_hidden_number_ids))
     );

  -- Everything asked for that did not survive the intersection. Reported rather
  -- than omitted: a caller that selected 40 and sees 38 applied deserves to
  -- know which two and why, and "not_found" covers deleted, wrong-company and
  -- hidden-number alike — telling them apart would leak which of the three it
  -- was.
  select coalesce(jsonb_agg(jsonb_build_object('id', missing, 'reason', 'not_found')), '[]'::jsonb)
    into v_failed
    from unnest(p_ids) as missing
   where not (missing = any(coalesce(v_selected, '{}'::uuid[])));

  if v_selected is null or array_length(v_selected, 1) is null then
    return jsonb_build_object(
      'action', p_action, 'matched', v_matched, 'applied', '[]'::jsonb,
      'failed', v_failed, 'capped', false);
  end if;

  if p_action in ('mark_done', 'mark_undone') then
    -- The flip and its event, per task, in this transaction. `previous` carries
    -- the prior done_at so an undo restores the exact timestamp rather than
    -- guessing at "not done".
    for v_row in
      select t.id as task_id, t.message_id, t.conversation_id,
             coalesce(m.done_at, t.done_at) as done_at
        from public.tasks t
        left join public.messages m on m.id = t.message_id
       where t.id = any(v_selected)
         and ((p_action = 'mark_done' and coalesce(m.done_at, t.done_at) is null)
              or (p_action = 'mark_undone' and coalesce(m.done_at, t.done_at) is not null))
       for update of t
    loop
      if v_row.message_id is not null then
        -- D17: the message owns done. set_message_done locks the message, is
        -- idempotent, and writes the D22 event in this same transaction, so a
        -- concurrent toggle that already flipped it applies nothing here.
        v_result := public.set_message_done(
          p_company_id, v_row.message_id, p_action = 'mark_done', p_user_id);
        if v_result->>'outcome' is distinct from 'updated' then
          continue;
        end if;
      else
        -- D64: a call-anchored task owns its own done state. No conversation
        -- event: message_done is about a message, and this task has none.
        update public.tasks
           set done_at = case when p_action = 'mark_done' then v_now end,
               done_by_user_id = case when p_action = 'mark_done' then p_user_id end
         where id = v_row.task_id;
      end if;

      v_applied := v_applied || jsonb_build_object(
        'id', v_row.task_id,
        'previous', jsonb_build_object('done_at', v_row.done_at));
    end loop;

  elsif p_action = 'assign' then
    -- A target who is not an active member is refused for the whole call
    -- rather than per row: it is one wrong id in the request, and applying it
    -- to some tasks and not others would leave a half-assigned list nobody
    -- asked for.
    if p_target_user_id is not null then
      perform 1 from public.company_members cm
       where cm.company_id = p_company_id
         and cm.user_id = p_target_user_id
         and cm.deactivated_at is null;
      if not found then
        return jsonb_build_object('error', 'not_member');
      end if;
    end if;

    for v_row in
      select t.id, t.assigned_user_id, t.conversation_id
        from public.tasks t
       where t.id = any(v_selected)
         and t.assigned_user_id is distinct from p_target_user_id
       for update
    loop
      update public.tasks
         set assigned_user_id = p_target_user_id
       where id = v_row.id;

      insert into public.conversation_events
        (company_id, conversation_id, actor_user_id, type, payload)
      values
        (p_company_id, v_row.conversation_id, p_user_id, 'task_assigned',
         jsonb_build_object(
           'task_id', v_row.id,
           'from_user_id', v_row.assigned_user_id,
           'to_user_id', p_target_user_id));

      v_applied := v_applied || jsonb_build_object(
        'id', v_row.id,
        'previous', jsonb_build_object('assigned_user_id', v_row.assigned_user_id));
    end loop;

  else -- delete
    -- Soft, and deliberately NOT touching messages.done_at — the same rule the
    -- single-row delete follows (T4). Deleting the task does not un-finish the
    -- work somebody did.
    for v_row in
      select t.id, t.conversation_id
        from public.tasks t
       where t.id = any(v_selected)
       for update
    loop
      update public.tasks set deleted_at = v_now where id = v_row.id;

      insert into public.conversation_events
        (company_id, conversation_id, actor_user_id, type, payload)
      values
        (p_company_id, v_row.conversation_id, p_user_id, 'task_deleted',
         jsonb_build_object('task_id', v_row.id));

      v_applied := v_applied || jsonb_build_object(
        'id', v_row.id, 'previous', jsonb_build_object('deleted_at', null));
    end loop;
  end if;

  return jsonb_build_object(
    'action',  p_action,
    'matched', v_matched,
    'applied', v_applied,
    'failed',  v_failed,
    'capped',  v_matched > v_cap);
end $$;

revoke execute on function public.api_bulk_tasks(uuid, uuid, text, uuid[], uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.api_bulk_tasks(uuid, uuid, text, uuid[], uuid, uuid[])
  to service_role;

comment on function public.api_bulk_tasks(uuid, uuid, text, uuid[], uuid, uuid[]) is
  '#478/#356: apply one action to a set of tasks, atomically. Completion flips messages.done_at (through set_message_done, with its D22 event) for a message-anchored task and tasks.done_at for a call-anchored one, in the same transaction as the rest of the batch. Never sends a message.';


-- ---------------------------------------------------------------------------
-- 9. api_fire_scheduled_message: a finished call task suppresses its reminder too
-- ---------------------------------------------------------------------------

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
         c.user_id = (
           select t.assigned_user_id from public.tasks t
            where t.id = v_probe.task_id and t.company_id = v_probe.company_id
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

revoke execute on function public.api_fire_scheduled_message(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.api_fire_scheduled_message(uuid, integer)
  to service_role;


-- ---------------------------------------------------------------------------
-- 10. api_resolve_calendar_event_removed: "it was cancelled" completes a call task as well
-- ---------------------------------------------------------------------------

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
     or v_task.assigned_user_id is distinct from p_user_id
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

revoke execute on function public.api_resolve_calendar_event_removed(uuid, uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_resolve_calendar_event_removed(uuid, uuid, uuid, text, timestamptz)
  to service_role;
