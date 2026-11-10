-- D64 amended / #689: a task may have NO source. The title is the only thing a
-- standalone task needs; it can optionally link to a contact and/or a
-- conversation.
--
-- The access rule, stated once:
--   * a standalone task WITH a conversation is gated exactly as that
--     conversation's own tasks are (a member denied the conversation's number
--     does not find it in search, in unclaimed work or on the map, and sees a
--     redacted title in their own queue; #106/#107/#417);
--   * a standalone task WITHOUT a conversation has no number to be denied by,
--     so every active member of the company sees it. Every reader of tasks
--     already tests "is the conversation on a hidden number" with NOT EXISTS,
--     which a null conversation passes, so For You, search and the bulk action
--     need no change; the readers below are the ones that did not.
--
-- What changes:
--   1. tasks.conversation_id is nullable; tasks.contact_id is the standalone
--      link to a contact. A task with a message or a call still has a
--      conversation (CHECK).
--   2. A task_* conversation event for a task with no conversation is dropped
--      instead of violating conversation_events_conv_required. Task history for
--      these tasks is a separate step (#689 E).
--   3. task_map_rows left-joins the conversation and takes the contact from the
--      conversation or from tasks.contact_id.
--   4. create_task accepts neither anchor (plus optional contact and
--      conversation); the anchored paths are unchanged.
--   5. calendar_task_access_allowed: a task with no conversation is allowed for
--      any active member (the old inner join denied it, so it never synced).
--   6. api_contact_timeline lists a task through its own contact too.
--   7. api_sync_task_reminders: no conversation, no customer thread, no reminder.
--   8. api_merge_contacts moves a standalone task linked to the merged contact.
--
-- Every recreated function is revoked from public/anon/authenticated before the
-- service_role grant, because a recreated function regains the hosted defaults.

-- ---------------------------------------------------------------------------
-- 1. Columns and the anchor rule
-- ---------------------------------------------------------------------------
alter table public.tasks alter column conversation_id drop not null;

alter table public.tasks
  add column contact_id uuid references public.contacts(id) on delete restrict;

alter table public.tasks add constraint tasks_anchored_has_conversation check (
  conversation_id is not null
  or (message_id is null and source_call_id is null));

create index tasks_contact_idx on public.tasks (contact_id, created_at)
  where deleted_at is null and contact_id is not null;

comment on column public.tasks.conversation_id is
  'The conversation a task belongs to. Null only for a standalone task (no message, no call) that was not linked to one; such a task is visible to every active member (#689).';
comment on column public.tasks.contact_id is
  '#689: the contact a standalone task is linked to. For a task with a conversation it equals that conversation''s contact; null for message and call tasks, which reach their contact through the conversation.';

-- ---------------------------------------------------------------------------
-- 2. A task event needs a thread; a task without one writes none
-- ---------------------------------------------------------------------------
create or replace function public.conversation_events_skip_threadless_task()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.conversation_id is null and new.type::text like 'task\_%' then
    return null;
  end if;
  return new;
end $$;

revoke execute on function public.conversation_events_skip_threadless_task()
  from public, anon, authenticated;

create trigger conversation_events_skip_threadless_task
  before insert on public.conversation_events
  for each row execute function public.conversation_events_skip_threadless_task();

-- ---------------------------------------------------------------------------
-- 3. The map view: a task without a conversation still has a place
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
left join public.conversations cv on cv.id = t.conversation_id
left join public.contacts      c  on c.id  = coalesce(cv.contact_id, t.contact_id)
left join public.messages      m  on m.id  = t.message_id;

-- ---------------------------------------------------------------------------
-- 4. create_task: a message, a call, or neither
-- ---------------------------------------------------------------------------
drop function if exists public.create_task(
  uuid, uuid, text, text, uuid, timestamptz, uuid,
  text, text, text, text, text, text, text, uuid);

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
  p_call_id          uuid default null,
  p_contact_id       uuid default null,
  p_conversation_id  uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation_id uuid;
  v_contact_id      uuid;
  v_body            text;
  v_direction       text;
  v_title           text;
  v_has_address     boolean;
  v_provenance      text;
  v_task            public.tasks%rowtype;
  v_call            record;
  v_standalone      boolean := p_message_id is null and p_call_id is null;
begin
  -- At most one source: a message, a call, or none (a standalone task).
  if p_message_id is not null and p_call_id is not null then
    return jsonb_build_object('outcome', 'no_source', 'task', null);
  end if;

  -- A contact or conversation link belongs to a standalone task only; a message
  -- or call task already has its conversation.
  if not v_standalone
     and (p_contact_id is not null or p_conversation_id is not null) then
    return jsonb_build_object('outcome', 'bad_link', 'task', null);
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
  elsif p_call_id is not null then
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
  else
    -- Standalone: only the title is required. A conversation, when given, must
    -- be this company's and fixes the contact; a contact alone must be live.
    if nullif(btrim(coalesce(p_title, '')), '') is null then
      return jsonb_build_object('outcome', 'title_required', 'task', null);
    end if;
    if p_conversation_id is not null then
      select c.id, c.contact_id
        into v_conversation_id, v_contact_id
        from public.conversations c
       where c.company_id = p_company_id
         and c.id = p_conversation_id;
      if not found then
        return jsonb_build_object('outcome', 'no_conversation', 'task', null);
      end if;
      if p_contact_id is not null and p_contact_id is distinct from v_contact_id then
        return jsonb_build_object('outcome', 'contact_mismatch', 'task', null);
      end if;
    elsif p_contact_id is not null then
      perform 1
        from public.contacts ct
       where ct.company_id = p_company_id
         and ct.id = p_contact_id
         and ct.deleted_at is null;
      if not found then
        return jsonb_build_object('outcome', 'no_contact', 'task', null);
      end if;
      v_contact_id := p_contact_id;
    end if;
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
    nullif(btrim(coalesce(p_title, '')), ''),
    left(nullif(trim(regexp_replace(coalesce(v_body, ''), '\s+', ' ', 'g')), ''), 500),
    'Task');

  v_has_address := coalesce(
    p_addr_street, p_addr_unit, p_addr_city, p_addr_state,
    p_addr_postal_code, p_addr_country) is not null;
  v_provenance := case when v_has_address then p_addr_provenance else null end;

  begin
    insert into public.tasks
      (company_id, message_id, source_call_id, conversation_id, contact_id,
       title, description, assigned_user_id, due_at, created_by_user_id,
       addr_street, addr_unit, addr_city, addr_state, addr_postal_code,
       addr_country, addr_provenance)
    values
      (p_company_id, p_message_id, p_call_id, v_conversation_id, v_contact_id,
       v_title, coalesce(p_description, ''), p_assigned_user_id, p_due_at,
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

  -- T2.1 audit: one task_created row on the task's conversation, same txn. A
  -- standalone task with no conversation has no thread to write to.
  if v_conversation_id is not null then
    insert into public.conversation_events
      (company_id, conversation_id, actor_user_id, type, payload)
    values
      (p_company_id, v_conversation_id, p_actor_user_id, 'task_created',
       case when p_message_id is not null
            then jsonb_build_object('task_id', v_task.id, 'message_id', p_message_id)
            when p_call_id is not null
            then jsonb_build_object('task_id', v_task.id, 'call_id', p_call_id)
            else jsonb_build_object('task_id', v_task.id)
       end);
  end if;

  return jsonb_build_object('outcome', 'created', 'task', to_jsonb(v_task));
end $$;

revoke execute on function public.create_task(
  uuid, uuid, text, text, uuid, timestamptz, uuid,
  text, text, text, text, text, text, text, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.create_task(
  uuid, uuid, text, text, uuid, timestamptz, uuid,
  text, text, text, text, text, text, text, uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Calendar access: a task with no conversation is not denied by a number
-- ---------------------------------------------------------------------------
create or replace function public.calendar_task_access_allowed(
  p_user_id         uuid,
  p_company_id      uuid,
  p_conversation_id uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.company_members m
     where m.company_id = p_company_id
       and m.user_id = p_user_id
       and m.deactivated_at is null
       and (
         p_conversation_id is null
         or exists (
           select 1
             from public.conversations c
            where c.id = p_conversation_id
              and c.company_id = m.company_id
              and public.member_number_level(p_user_id, c.phone_number_id)
                  is distinct from 'none'))
  );
$$;

revoke execute on function public.calendar_task_access_allowed(uuid, uuid, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. api_contact_timeline: a standalone task reaches its contact directly
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

    -- TASKS, via their conversation, or via their own contact (#689 standalone). `done` is the source message's done_at exactly as the
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
    left join public.conversations tc on tc.id = t.conversation_id
    left join public.messages m on m.id = t.message_id
    where t.company_id = p_company_id
      and coalesce(tc.contact_id, t.contact_id) = p_contact_id
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
-- 7. A task with no conversation owns no appointment reminder
-- ---------------------------------------------------------------------------

create or replace function public.api_sync_task_reminders(
  p_company_id     uuid,
  p_task_id        uuid,
  p_user_id        uuid,
  p_reminders      jsonb,
  p_clock_timezone text,
  p_clock_source   text,
  p_expires_at     timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task           public.tasks%rowtype;
  v_removed        integer := 0;
  v_added          integer := 0;
  v_updated_held   integer := 0;
  v_cancelled_held integer := 0;
  v_reminder       jsonb;
begin
  select * into v_task
    from public.tasks t
   where t.id = p_task_id and t.company_id = p_company_id
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  with gone as (
    delete from public.scheduled_messages
     where task_id = p_task_id
       and company_id = p_company_id
       and origin = 'reminder'
       and status = 'pending'
    returning 1
  ) select count(*) into v_removed from gone;

  if v_task.deleted_at is null and not (v_task.reminders_off or v_task.conversation_id is null) then
    with planned as (
      select
        (item->>'offset_minutes')::integer as offset_minutes,
        item->>'body' as body,
        (item->>'send_at')::timestamptz as send_at
      from jsonb_array_elements(coalesce(p_reminders, '[]'::jsonb)) item
    )
    update public.scheduled_messages s
       set body = p.body,
           send_at = p.send_at,
           clock_timezone = p_clock_timezone,
           clock_source = p_clock_source,
           expires_at = p_expires_at,
           claimed_at = null,
           updated_at = now()
      from planned p
     where s.company_id = p_company_id
       and s.task_id = p_task_id
       and s.origin = 'reminder'
       and s.status = 'held'
       and s.reminder_offset_minutes = p.offset_minutes;
    get diagnostics v_updated_held = row_count;
  end if;

  with planned as (
    select (item->>'offset_minutes')::integer as offset_minutes
      from jsonb_array_elements(coalesce(p_reminders, '[]'::jsonb)) item
  )
  update public.scheduled_messages s
     set status = 'canceled',
         canceled_at = now(),
         claimed_at = null,
         updated_at = now()
   where s.company_id = p_company_id
     and s.task_id = p_task_id
     and s.origin = 'reminder'
     and s.status = 'held'
     and (
       v_task.deleted_at is not null
       or (v_task.reminders_off or v_task.conversation_id is null)
       or not exists (
         select 1 from planned p
          where p.offset_minutes = s.reminder_offset_minutes
       )
     );
  get diagnostics v_cancelled_held = row_count;

  if v_task.deleted_at is not null or (v_task.reminders_off or v_task.conversation_id is null) then
    return jsonb_build_object(
      'outcome', 'synced',
      'removed', v_removed,
      'added', 0,
      'updated_held', v_updated_held,
      'cancelled_held', v_cancelled_held,
      'reason', case when v_task.deleted_at is not null
                     then 'task_deleted' else 'reminders_off' end
    );
  end if;

  for v_reminder in
    select * from jsonb_array_elements(coalesce(p_reminders, '[]'::jsonb))
  loop
    insert into public.scheduled_messages (
      company_id, conversation_id, task_id, origin, reminder_offset_minutes,
      body, send_at, clock_timezone, clock_source, expires_at, created_by
    ) values (
      p_company_id, v_task.conversation_id, p_task_id, 'reminder',
      (v_reminder->>'offset_minutes')::integer,
      v_reminder->>'body', (v_reminder->>'send_at')::timestamptz,
      p_clock_timezone, p_clock_source, p_expires_at, p_user_id
    ) on conflict do nothing;
    if found then v_added := v_added + 1; end if;
  end loop;

  return jsonb_build_object(
    'outcome', 'synced',
    'removed', v_removed,
    'added', v_added,
    'updated_held', v_updated_held,
    'cancelled_held', v_cancelled_held
  );
end $$;

revoke execute on function public.api_sync_task_reminders(
  uuid, uuid, uuid, jsonb, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_sync_task_reminders(
  uuid, uuid, uuid, jsonb, text, text, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 8. api_merge_contacts: a standalone task linked to the contact moves with it
-- ---------------------------------------------------------------------------

create or replace function public.api_merge_contacts(
  p_company_id uuid,
  p_from       uuid,
  p_into       uuid,
  p_actor      uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from      public.contacts;
  v_into      public.contacts;
  v_moved     int := 0;
  v_closed    int := 0;
  v_optout    boolean := false;
  v_conv      record;
begin
  if p_from = p_into then
    return jsonb_build_object('outcome', 'same_contact');
  end if;

  select * into v_from from public.contacts
   where id = p_from and company_id = p_company_id;
  select * into v_into from public.contacts
   where id = p_into and company_id = p_company_id;

  if v_from.id is null or v_into.id is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  -- Neither side may already be a tombstone. Merging into one would build a
  -- chain, and every reader would then need to follow it an unknown depth.
  if v_from.merged_into is not null or v_into.merged_into is not null then
    return jsonb_build_object('outcome', 'already_merged');
  end if;

  -- ---- Conversations -----------------------------------------------------
  -- Moved one at a time so a collision on the open-thread index is handled
  -- rather than aborting the whole merge. A bulk UPDATE would fail the first
  -- time a customer had an open thread under both records, which is exactly
  -- the case somebody is merging to fix.
  for v_conv in
    select id, phone_number_id, closed_at
      from public.conversations
     where company_id = p_company_id and contact_id = p_from
  loop
    if v_conv.closed_at is null and exists (
      select 1 from public.conversations c
       where c.company_id = p_company_id
         and c.contact_id = p_into
         and c.phone_number_id = v_conv.phone_number_id
         and c.closed_at is null
    ) then
      -- The survivor already has an open thread on this number. Close the
      -- one arriving: its history stays whole and readable, and the crew is
      -- left with one thread to answer rather than two.
      update public.conversations
         set contact_id = p_into,
             status = 'closed',
             closed_at = now(),
             updated_at = now()
       where id = v_conv.id;
      v_closed := v_closed + 1;
    else
      update public.conversations
         set contact_id = p_into, updated_at = now()
       where id = v_conv.id;
    end if;
    v_moved := v_moved + 1;
  end loop;

  -- Tasks, notes, tags, attachments and events all hang off the CONVERSATION,
  -- so they moved with it. Only calls, and a standalone task linked to the
  -- contact itself (#689), address a contact directly.
  update public.calls set contact_id = p_into
   where company_id = p_company_id and contact_id = p_from;

  -- #689: so does a standalone task linked straight to the contact.
  update public.tasks set contact_id = p_into
   where company_id = p_company_id and contact_id = p_from;

  -- ---- Opt-out union ------------------------------------------------------
  -- If either number is opted out, both are afterwards. Written as a manual
  -- opt-out attributed to the merge; see the header for why it is never
  -- recorded as a carrier STOP.
  if exists (
    select 1 from public.opt_outs
     where company_id = p_company_id
       and phone_e164 in (v_from.phone_e164, v_into.phone_e164)
       and revoked_at is null
  ) then
    v_optout := true;
    insert into public.opt_outs (company_id, phone_e164, source, created_by)
    select p_company_id, n.phone, 'manual'::public.opt_out_source, p_actor
      from (values (v_from.phone_e164), (v_into.phone_e164)) as n(phone)
    on conflict (company_id, phone_e164) do update
      set revoked_at = null, updated_at = now();
  end if;

  -- ---- The tombstone ------------------------------------------------------
  update public.contacts
     set merged_into = p_into,
         merged_at = now(),
         merged_by = p_actor,
         updated_at = now()
   where id = p_from;

  -- The survivor inherits anything it was missing. A merge should never lose a
  -- fact, and an empty field on the survivor is not a decision anybody made.
  update public.contacts
     set name = coalesce(nullif(btrim(coalesce(name, '')), ''), v_from.name),
         address = coalesce(nullif(btrim(coalesce(address, '')), ''), v_from.address),
         notes = case
           when coalesce(btrim(coalesce(notes, '')), '') = '' then v_from.notes
           when coalesce(btrim(coalesce(v_from.notes, '')), '') = '' then notes
           -- Both wrote something. Keeping one and discarding the other would
           -- silently lose what somebody typed about this customer.
           else notes || E'\n\n' || v_from.notes
         end,
         consent_source = coalesce(consent_source, v_from.consent_source),
         consent_at = coalesce(consent_at, v_from.consent_at),
         updated_at = now()
   where id = p_into;

  return jsonb_build_object(
    'outcome', 'merged',
    'moved', v_moved,
    'closed', v_closed,
    'opted_out', v_optout,
    'from_phone', v_from.phone_e164,
    'into_phone', v_into.phone_e164);
end;
$$;

revoke execute on function public.api_merge_contacts(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.api_merge_contacts(uuid, uuid, uuid, uuid)
  to service_role;
