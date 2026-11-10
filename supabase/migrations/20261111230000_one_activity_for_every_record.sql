-- #714: one activity model for every record.
--
-- A task had a history (task_events, #689), a conversation had conversation_events,
-- a contact had a list of its conversations and a separate call history, a call
-- had nothing. Four shapes, and no way to ask "what happened to this customer".
--
-- This migration adds ONE table, record_activity, and one read, and makes the
-- database write it, so no writer can forget an event.
--
-- WHY A TABLE AND NOT A VIEW OVER THE EXISTING ROWS. The audit log (#231) is the
-- privileged surface on purpose (it refuses to hold customer content and is
-- append-only), so it cannot carry a text, a call or a contact edit. The sources
-- that do (messages, calls, task_events, conversation_events) each have their own
-- columns, grants and purge rules, and one event belongs on SEVERAL records (a
-- text is on the conversation and on the contact). A view would need a union per
-- record type, a cursor over the union, and every new kind of event would be a
-- new arm in a function nobody is made to edit. A table with triggers means the
-- rule is "an event is a row"; the arms are written once, where the data is
-- written, and the read is one indexed scan.
--
-- HOW IT IS FILLED.
--   - Triggers on messages, calls, contacts, task_events, conversation_events,
--     record_references, scheduled_messages and blocked_senders. Whoever writes
--     those (a route, a cron, a webhook, the importer) records the event.
--   - The actor is the column the writer already fills (sent_by_user_id,
--     updated_by_user_id, created_by, blocked_by, canceled_by, the event's
--     actor_user_id), else the customer where the customer acted, else the system.
--   - Writes that carry nothing a trigger could read (tagging a contact, lifting
--     a block, naming a teammate in a comment) are recorded by the route, through
--     apps/api/src/activity/record.ts. A guard test lists every mutating route of
--     the four record types and fails when one records nothing.
--
-- WHAT IS NOT STORED. No message body, no note, no comment: a row says that a
-- text happened and links to it. Field edits carry the before and after of the
-- field (as task_events does), so the table is personal data and is classified,
-- tenant-scoped and purged like task_events.
--
-- Every function created here is revoked from public, anon and authenticated
-- before the service_role grant, because hosted Supabase grants EXECUTE on a
-- recreated function by name.

-- ---------------------------------------------------------------------------
-- 1. record_activity
-- ---------------------------------------------------------------------------
create table public.record_activity (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete restrict,
  record_type     text not null
    check (record_type in ('contact', 'task', 'conversation', 'call')),
  record_id       uuid not null,
  kind            text not null check (kind in (
    'text_in', 'text_out', 'scheduled_queued', 'scheduled_sent', 'scheduled_cancelled',
    'call', 'voicemail',
    'created', 'edited', 'tagged', 'untagged', 'merged', 'unmerged', 'deleted',
    'restored', 'assigned', 'unassigned', 'mentioned', 'referenced', 'opted_out',
    'opted_in', 'blocked', 'unblocked', 'task_created', 'task_completed',
    'completed', 'reopened')),
  -- The filter row: All · Messages · Calls · Changes. Derived, so a client can
  -- never disagree with the server about which a kind is.
  category        text generated always as (
    case
      when kind in ('text_in', 'text_out', 'scheduled_queued', 'scheduled_sent',
                    'scheduled_cancelled') then 'message'
      when kind in ('call', 'voicemail') then 'call'
      else 'change'
    end) stored,
  actor_type      text not null
    check (actor_type in ('member', 'customer', 'automation', 'system')),
  -- The member's user id when actor_type is 'member'; null otherwise.
  actor_id        uuid references auth.users(id) on delete set null,
  -- Kind-specific: { field, from, to } for an edit, { direction, outcome,
  -- ended_reason } for a call, { name } for a tag. Never message content.
  payload         jsonb not null default '{}'::jsonb,
  -- Where it came from, so the timeline can link to it.
  source_type     text check (source_type in (
    'message', 'call', 'task', 'task_comment', 'conversation_event',
    'scheduled_message', 'contact', 'conversation')),
  source_id       uuid,
  -- The thread a message or call line lives in, for the link.
  conversation_id uuid,
  -- The number the event happened on. A member denied that number (#106) does
  -- not see the event on ANY record.
  phone_number_id uuid,
  occurred_at     timestamptz not null default now(),
  -- One event, however many times its writer runs (a backfill, a retry).
  dedupe_key      text,
  constraint record_activity_member_has_actor
    check ((actor_type = 'member') = (actor_id is not null))
);

create index record_activity_record_idx
  on public.record_activity (company_id, record_type, record_id, occurred_at desc, id desc);
create unique index record_activity_dedupe_uq
  on public.record_activity (company_id, record_type, record_id, dedupe_key)
  where dedupe_key is not null;
create index record_activity_source_idx
  on public.record_activity (source_type, source_id)
  where source_id is not null;

alter table public.record_activity enable row level security;
revoke all on public.record_activity from public, anon, authenticated;
grant select, insert, update, delete on public.record_activity to service_role;

comment on table public.record_activity is
  '#714: one row per event on a contact, task, conversation or call, newest first by occurred_at. Written by triggers on the source tables and by apps/api/src/activity/record.ts. Holds no message content; field edits hold the field before and after. Purged with the workspace.';

-- ---------------------------------------------------------------------------
-- 2. The one writer
-- ---------------------------------------------------------------------------
create or replace function public.record_activity_add(
  p_company_id      uuid,
  p_record_type     text,
  p_record_id       uuid,
  p_kind            text,
  p_actor_user_id   uuid,
  p_actor_type      text,
  p_payload         jsonb,
  p_source_type     text,
  p_source_id       uuid,
  p_conversation_id uuid,
  p_phone_number_id uuid,
  p_at              timestamptz,
  p_dedupe          text,
  p_refresh         boolean default false
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_record_id is null then
    return;
  end if;
  insert into public.record_activity
    (company_id, record_type, record_id, kind, actor_type, actor_id, payload,
     source_type, source_id, conversation_id, phone_number_id, occurred_at,
     dedupe_key)
  values
    (p_company_id, p_record_type, p_record_id, p_kind,
     case when p_actor_user_id is not null then 'member' else p_actor_type end,
     p_actor_user_id, coalesce(p_payload, '{}'::jsonb), p_source_type, p_source_id,
     p_conversation_id, p_phone_number_id, coalesce(p_at, now()), p_dedupe)
  on conflict (company_id, record_type, record_id, dedupe_key)
    where dedupe_key is not null
  do update set payload = excluded.payload, kind = excluded.kind
    where p_refresh;
end $$;

revoke execute on function public.record_activity_add(
  uuid, text, uuid, text, uuid, text, jsonb, text, uuid, uuid, uuid, timestamptz, text, boolean)
  from public, anon, authenticated;
grant execute on function public.record_activity_add(
  uuid, text, uuid, text, uuid, text, jsonb, text, uuid, uuid, uuid, timestamptz, text, boolean)
  to service_role;

-- The contacts a phone number belongs to in one workspace.
create or replace function public.record_activity_contacts_of_phone(
  p_company_id uuid,
  p_phone      text
) returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.contacts c
   where c.company_id = p_company_id and c.phone_e164 = p_phone
     and c.merged_into is null and c.deleted_at is null
  union
  select cp.contact_id from public.contact_phones cp
    join public.contacts c on c.id = cp.contact_id
   where cp.company_id = p_company_id and cp.phone_e164 = p_phone
     and c.merged_into is null and c.deleted_at is null;
$$;

revoke execute on function public.record_activity_contacts_of_phone(uuid, text)
  from public, anon, authenticated;
grant execute on function public.record_activity_contacts_of_phone(uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. Texts: one row on the conversation and one on the contact
-- ---------------------------------------------------------------------------
create or replace function public.record_activity_message(m public.messages)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact uuid;
  v_number  uuid;
  v_kind    text;
  v_type    text;
  v_payload jsonb;
begin
  if m.direction::text not in ('inbound', 'outbound') then
    return;
  end if;
  select c.contact_id, c.phone_number_id into v_contact, v_number
    from public.conversations c where c.id = m.conversation_id;
  v_kind := case when m.direction::text = 'inbound' then 'text_in' else 'text_out' end;
  v_type := case
    when m.direction::text = 'inbound' then 'customer'
    when m.sent_by_user_id is null and m.automated then 'automation'
    else 'system' end;
  v_payload := jsonb_build_object('media_count', m.media_count,
                                  'automated', coalesce(m.automated, false));
  perform public.record_activity_add(m.company_id, 'conversation', m.conversation_id,
    v_kind, case when m.direction::text = 'outbound' then m.sent_by_user_id end,
    v_type, v_payload, 'message', m.id, m.conversation_id, v_number,
    m.created_at, 'message:' || m.id);
  perform public.record_activity_add(m.company_id, 'contact', v_contact,
    v_kind, case when m.direction::text = 'outbound' then m.sent_by_user_id end,
    v_type, v_payload, 'message', m.id, m.conversation_id, v_number,
    m.created_at, 'message:' || m.id);
end $$;

create or replace function public.record_activity_on_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.record_activity_message(new);
  return null;
end $$;

create trigger record_activity_from_messages
  after insert on public.messages
  for each row execute function public.record_activity_on_message();

-- ---------------------------------------------------------------------------
-- 4. Calls: one row once the call has an outcome, refreshed when its reason lands
-- ---------------------------------------------------------------------------
create or replace function public.record_activity_call(k public.calls)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind    text;
  v_member  uuid;
  v_type    text;
  v_payload jsonb;
begin
  if k.outcome is null then
    return;
  end if;
  v_kind := case when k.outcome = 'voicemail' then 'voicemail' else 'call' end;
  v_member := case when k.direction = 'outbound' then k.answered_by_user_id end;
  v_type := case
    when k.direction = 'inbound' then 'customer'
    when v_member is null then 'system'
    else 'member' end;
  v_payload := jsonb_build_object(
    'direction', k.direction,
    'outcome', k.outcome,
    'ended_reason', k.ended_reason,
    'talk_seconds', k.forward_seconds,
    'voicemail_seconds', k.voicemail_seconds,
    'answered_by_user_id', k.answered_by_user_id);
  perform public.record_activity_add(k.company_id, 'call', k.id, v_kind, v_member,
    v_type, v_payload, 'call', k.id, k.conversation_id, k.phone_number_id,
    coalesce(k.started_at, k.created_at), 'call:' || k.id, true);
  perform public.record_activity_add(k.company_id, 'conversation', k.conversation_id,
    v_kind, v_member, v_type, v_payload, 'call', k.id, k.conversation_id,
    k.phone_number_id, coalesce(k.started_at, k.created_at), 'call:' || k.id, true);
  perform public.record_activity_add(k.company_id, 'contact', k.contact_id, v_kind,
    v_member, v_type, v_payload, 'call', k.id, k.conversation_id,
    k.phone_number_id, coalesce(k.started_at, k.created_at), 'call:' || k.id, true);
end $$;

create or replace function public.record_activity_on_call()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.record_activity_call(new);
  return null;
end $$;

create trigger record_activity_from_calls
  after insert or update of outcome, ended_reason, direction, forward_seconds,
    voicemail_seconds, answered_by_user_id, contact_id, conversation_id
  on public.calls
  for each row execute function public.record_activity_on_call();

-- ---------------------------------------------------------------------------
-- 5. Contacts: created, edited (field, before, after), deleted, restored,
--    merged. Skipped while a merge copies fields onto the survivor, which is
--    one event ("merged"), not four edits nobody made.
-- ---------------------------------------------------------------------------
create or replace function public.record_activity_contact_created(k public.contacts)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.record_activity_add(k.company_id, 'contact', k.id, 'created',
    k.created_by_user_id, 'system', '{}'::jsonb, 'contact', k.id, null, null,
    k.created_at, 'contact:' || k.id || ':created');
end $$;

create or replace function public.record_activity_on_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  f record;
begin
  if tg_op = 'INSERT' then
    perform public.record_activity_contact_created(new);
    return null;
  end if;

  if current_setting('loonext.activity_quiet', true) is distinct from 'on' then
    for f in
      select * from (values
        ('name', old.name, new.name),
        ('email', old.email, new.email),
        ('business_name', old.business_name, new.business_name),
        ('address', old.address, new.address),
        ('notes', old.notes, new.notes),
        ('timezone', old.timezone, new.timezone),
        ('locale', old.locale, new.locale),
        ('phone', old.phone_e164, new.phone_e164)
      ) as v(field, before_value, after_value)
      where v.before_value is distinct from v.after_value
    loop
      perform public.record_activity_add(new.company_id, 'contact', new.id, 'edited',
        new.updated_by_user_id, 'system',
        jsonb_build_object('field', f.field,
                           'from', left(f.before_value, 500),
                           'to', left(f.after_value, 500)),
        'contact', new.id, null, null, null, null);
    end loop;
    if new.custom_fields is distinct from old.custom_fields
       or new.custom_values is distinct from old.custom_values then
      perform public.record_activity_add(new.company_id, 'contact', new.id, 'edited',
        new.updated_by_user_id, 'system', jsonb_build_object('field', 'custom_fields'),
        'contact', new.id, null, null, null, null);
    end if;
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    perform public.record_activity_add(new.company_id, 'contact', new.id, 'deleted',
      new.deleted_by_user_id, 'system', '{}'::jsonb, 'contact', new.id, null, null,
      null, null);
  elsif old.deleted_at is not null and new.deleted_at is null then
    perform public.record_activity_add(new.company_id, 'contact', new.id, 'restored',
      new.updated_by_user_id, 'system', '{}'::jsonb, 'contact', new.id, null, null,
      null, null);
  end if;

  if old.merged_into is null and new.merged_into is not null then
    perform public.record_activity_add(new.company_id, 'contact', new.id, 'merged',
      new.merged_by, 'system',
      jsonb_build_object('role', 'merged_away', 'other_id', new.merged_into,
        'other_name', (select k.name from public.contacts k where k.id = new.merged_into)),
      'contact', new.merged_into, null, null, null, null);
    perform public.record_activity_add(new.company_id, 'contact', new.merged_into,
      'merged', new.merged_by, 'system',
      jsonb_build_object('role', 'survivor', 'other_id', new.id,
        'other_name', new.name),
      'contact', new.id, null, null, null, null);
  elsif old.merged_into is not null and new.merged_into is null then
    perform public.record_activity_add(new.company_id, 'contact', new.id, 'unmerged',
      new.updated_by_user_id, 'system', jsonb_build_object('other_id', old.merged_into),
      'contact', old.merged_into, null, null, null, null);
    perform public.record_activity_add(new.company_id, 'contact', old.merged_into,
      'unmerged', new.updated_by_user_id, 'system',
      jsonb_build_object('other_id', new.id, 'other_name', new.name),
      'contact', new.id, null, null, null, null);
  end if;
  return null;
end $$;

create trigger record_activity_from_contacts
  after insert or update on public.contacts
  for each row execute function public.record_activity_on_contact();

-- ---------------------------------------------------------------------------
-- 5b. A conversation or a call moved to the Trash (#691) and back. The member
--     who trashed it is on the row; a restore carries no actor column.
-- ---------------------------------------------------------------------------
create or replace function public.record_activity_on_trash()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text := case tg_table_name when 'calls' then 'call' else 'conversation' end;
  v_kind text;
begin
  if old.deleted_at is null and new.deleted_at is not null then
    v_kind := 'deleted';
  elsif old.deleted_at is not null and new.deleted_at is null then
    v_kind := 'restored';
  else
    return null;
  end if;
  perform public.record_activity_add(new.company_id, v_type, new.id, v_kind,
    case when v_kind = 'deleted' then new.deleted_by_user_id end, 'system',
    '{}'::jsonb, null, null, case when v_type = 'conversation' then new.id
                                      else (to_jsonb(new)->>'conversation_id')::uuid end,
    new.phone_number_id, null, null);
  return null;
end $$;

create trigger record_activity_from_conversations_trash
  after update of deleted_at on public.conversations
  for each row execute function public.record_activity_on_trash();
create trigger record_activity_from_calls_trash
  after update of deleted_at on public.calls
  for each row execute function public.record_activity_on_trash();

-- ---------------------------------------------------------------------------
-- 6. Tasks: every task_events row is also one activity row, so the task's own
--    history and the shared timeline can never disagree. A creation and a
--    completion also land on the task's contact and conversation.
-- ---------------------------------------------------------------------------
create or replace function public.record_activity_task_event(e public.task_events)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv     uuid;
  v_contact  uuid;
  v_number   uuid;
  v_title    text;
  v_kind     text;
  v_payload  jsonb;
begin
  select t.conversation_id, coalesce(t.contact_id, c.contact_id), c.phone_number_id,
         t.title
    into v_conv, v_contact, v_number, v_title
    from public.tasks t
    left join public.conversations c on c.id = t.conversation_id
   where t.id = e.task_id;
  if not found then
    return;
  end if;

  v_kind := case e.kind
    when 'created' then 'created'
    when 'assignee' then case when e.to_value is null or e.to_value = 'null'::jsonb
                              then 'unassigned' else 'assigned' end
    when 'assignee_added' then 'assigned'
    when 'assignee_removed' then 'unassigned'
    when 'label_added' then 'tagged'
    when 'label_removed' then 'untagged'
    when 'done' then 'completed'
    when 'reopened' then 'reopened'
    when 'deleted' then 'deleted'
    else 'edited' end;
  v_payload := case v_kind
    when 'created' then jsonb_build_object('title', e.to_value)
    when 'assigned' then jsonb_build_object('to_user_id', e.to_value,
                                            'from_user_id', e.from_value)
    when 'unassigned' then jsonb_build_object('from_user_id', e.from_value)
    when 'tagged' then jsonb_build_object('name', e.to_value)
    when 'untagged' then jsonb_build_object('name', e.from_value)
    when 'edited' then jsonb_build_object('field', e.kind, 'from', e.from_value,
                                          'to', e.to_value)
    else '{}'::jsonb end;

  perform public.record_activity_add(e.company_id, 'task', e.task_id, v_kind,
    e.actor_user_id, 'system', v_payload, 'task', e.task_id, v_conv, v_number,
    e.created_at, 'task_event:' || e.id);

  if e.kind in ('created', 'done') then
    perform public.record_activity_add(e.company_id, 'contact', v_contact,
      case e.kind when 'created' then 'task_created' else 'task_completed' end,
      e.actor_user_id, 'system', jsonb_build_object('task_id', e.task_id, 'title', v_title),
      'task', e.task_id, v_conv, v_number, e.created_at, 'task_event:' || e.id);
    perform public.record_activity_add(e.company_id, 'conversation', v_conv,
      case e.kind when 'created' then 'task_created' else 'task_completed' end,
      e.actor_user_id, 'system', jsonb_build_object('task_id', e.task_id, 'title', v_title),
      'task', e.task_id, v_conv, v_number, e.created_at, 'task_event:' || e.id);
  end if;
end $$;

create or replace function public.record_activity_on_task_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.record_activity_task_event(new);
  return null;
end $$;

create trigger record_activity_from_task_events
  after insert on public.task_events
  for each row execute function public.record_activity_on_task_event();

-- ---------------------------------------------------------------------------
-- 7. Conversation events: assigned, tagged, opted out and in, status, spam
-- ---------------------------------------------------------------------------
create or replace function public.record_activity_conversation_event(
  e public.conversation_events
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact uuid;
  v_number  uuid;
  v_kind    text;
  v_type    text;
  v_payload jsonb;
  v_to      text;
  v_phone   text;
  v_row     uuid;
begin
  v_type := case
    when e.payload->>'source' = 'stop_keyword' then 'customer'
    else 'system' end;
  v_kind := case e.type::text
    when 'assigned' then case when nullif(e.payload->>'to', '') is null
                              then 'unassigned' else 'assigned' end
    when 'tag_added' then 'tagged'
    when 'tag_removed' then 'untagged'
    when 'opted_out' then 'opted_out'
    when 'opt_out_revoked' then 'opted_in'
    when 'status_changed' then 'edited'
    when 'spam_marked' then 'edited'
    when 'spam_unmarked' then 'edited'
    else null end;
  if v_kind is null then
    return;
  end if;

  select c.contact_id, c.phone_number_id into v_contact, v_number
    from public.conversations c where c.id = e.conversation_id;

  v_payload := case e.type::text
    when 'assigned' then jsonb_build_object('from_user_id', e.payload->'from',
                                            'to_user_id', e.payload->'to')
    when 'tag_added' then jsonb_build_object('tag_id', e.payload->'tag_id',
                                             'name', e.payload->'name')
    when 'tag_removed' then jsonb_build_object('tag_id', e.payload->'tag_id',
                                               'name', e.payload->'name')
    when 'opted_out' then jsonb_build_object('source', e.payload->'source')
    when 'opt_out_revoked' then jsonb_build_object('source',
                                  coalesce(e.payload->'source', '"manual"'::jsonb))
    when 'status_changed' then jsonb_build_object('field', 'status',
                                  'from', e.payload->'from', 'to', e.payload->'to')
    when 'spam_marked' then jsonb_build_object('field', 'spam', 'to', true)
    when 'spam_unmarked' then jsonb_build_object('field', 'spam', 'to', false)
    else '{}'::jsonb end;

  perform public.record_activity_add(e.company_id, 'conversation', e.conversation_id,
    v_kind, e.actor_user_id, v_type, v_payload, 'conversation_event', e.id,
    e.conversation_id, v_number, e.created_at, 'cev:' || e.id);

  -- Who may be contacted is a fact about the person, so it is on the contact too.
  if v_kind in ('opted_out', 'opted_in') then
    if v_contact is not null then
      perform public.record_activity_add(e.company_id, 'contact', v_contact, v_kind,
        e.actor_user_id, v_type, v_payload, 'conversation_event', e.id,
        e.conversation_id, v_number, e.created_at, 'cev:' || e.id);
    else
      v_phone := e.payload->>'phone_e164';
      for v_row in select * from public.record_activity_contacts_of_phone(e.company_id, v_phone)
      loop
        perform public.record_activity_add(e.company_id, 'contact', v_row, v_kind,
          e.actor_user_id, v_type, v_payload, 'conversation_event', e.id,
          null, null, e.created_at, 'cev:' || e.id);
      end loop;
    end if;
  end if;
end $$;

create or replace function public.record_activity_on_conversation_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.record_activity_conversation_event(new);
  return null;
end $$;

create trigger record_activity_from_conversation_events
  after insert on public.conversation_events
  for each row execute function public.record_activity_on_conversation_event();

-- ---------------------------------------------------------------------------
-- 8. References: "referenced by a task, note or message" on the target
-- ---------------------------------------------------------------------------
create or replace function public.record_activity_reference(r public.record_references)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type   text;
  v_target uuid;
  v_conv   uuid;
  v_stype  text;
  v_sid    uuid;
begin
  v_type := r.target_kind;
  v_target := case r.target_kind
    when 'task' then r.target_task_id
    when 'contact' then r.target_contact_id
    when 'conversation' then r.target_conversation_id end;
  if r.source_message_id is not null then
    select m.conversation_id into v_conv from public.messages m
     where m.id = r.source_message_id;
    v_stype := 'message';
    v_sid := r.source_message_id;
  elsif r.source_task_id is not null then
    v_stype := 'task';
    v_sid := r.source_task_id;
  else
    v_stype := 'task_comment';
    v_sid := r.source_id;
  end if;
  perform public.record_activity_add(r.company_id, v_type, v_target, 'referenced',
    r.created_by, 'system',
    jsonb_build_object('source_kind', r.source_kind, 'source_task_id', r.source_task_id),
    v_stype, v_sid, v_conv, r.source_number_id, r.created_at,
    'ref:' || r.source_kind || ':' || r.source_id || ':' || coalesce(v_target::text, ''));
end $$;

create or replace function public.record_activity_on_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.record_activity_reference(new);
  return null;
end $$;

create trigger record_activity_from_record_references
  after insert on public.record_references
  for each row execute function public.record_activity_on_reference();

-- ---------------------------------------------------------------------------
-- 9. Scheduled texts: queued, sent, cancelled
-- ---------------------------------------------------------------------------
create or replace function public.record_activity_scheduled(
  s public.scheduled_messages,
  o public.scheduled_messages
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact uuid;
  v_number  uuid;
  v_payload jsonb;
  v_row     record;
begin
  select c.contact_id, c.phone_number_id into v_contact, v_number
    from public.conversations c where c.id = s.conversation_id;
  v_payload := jsonb_build_object('scheduled_id', s.id, 'send_at', s.send_at);

  for v_row in
    select kind, actor, at, stype, sid from (
      select 'scheduled_queued'::text as kind, s.created_by as actor,
             s.created_at as at, 'scheduled_message'::text as stype, s.id as sid,
             (o.id is null) as due
      union all
      select 'scheduled_sent', null::uuid, coalesce(s.updated_at, now()),
             case when s.sent_message_id is not null then 'message' else 'scheduled_message' end,
             coalesce(s.sent_message_id, s.id),
             (s.status = 'sent' and (o.id is null or o.status is distinct from 'sent'))
      union all
      select 'scheduled_cancelled', s.canceled_by, coalesce(s.canceled_at, now()),
             'scheduled_message', s.id,
             (s.canceled_at is not null and (o.id is null or o.canceled_at is null))
    ) k where due
  loop
    perform public.record_activity_add(s.company_id, 'conversation', s.conversation_id,
      v_row.kind, v_row.actor,
      case when s.origin = 'human' then 'system' else 'automation' end,
      v_payload, v_row.stype, v_row.sid, s.conversation_id, v_number, v_row.at,
      'sched:' || s.id || ':' || v_row.kind);
    perform public.record_activity_add(s.company_id, 'contact', v_contact,
      v_row.kind, v_row.actor,
      case when s.origin = 'human' then 'system' else 'automation' end,
      v_payload, v_row.stype, v_row.sid, s.conversation_id, v_number, v_row.at,
      'sched:' || s.id || ':' || v_row.kind);
  end loop;
end $$;

create or replace function public.record_activity_on_scheduled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_activity_scheduled(new, null::public.scheduled_messages);
  else
    perform public.record_activity_scheduled(new, old);
  end if;
  return null;
end $$;

create trigger record_activity_from_scheduled_messages
  after insert or update of status, canceled_at on public.scheduled_messages
  for each row execute function public.record_activity_on_scheduled();

-- ---------------------------------------------------------------------------
-- 10. Blocks: the person who blocks is on the block. Lifting one carries no
--     actor a trigger can read, so that route records it.
-- ---------------------------------------------------------------------------
create or replace function public.record_activity_on_blocked_sender()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row uuid;
begin
  for v_row in select * from public.record_activity_contacts_of_phone(new.company_id, new.phone_e164)
  loop
    perform public.record_activity_add(new.company_id, 'contact', v_row, 'blocked',
      new.blocked_by, 'system', '{}'::jsonb, 'contact', v_row, null, null,
      new.created_at, 'block:' || new.id);
  end loop;
  return null;
end $$;

create trigger record_activity_from_blocked_senders
  after insert on public.blocked_senders
  for each row execute function public.record_activity_on_blocked_sender();

-- ---------------------------------------------------------------------------
-- 11. The read: one record's activity, newest first, keyset-paginated, gated
--     exactly like reading the record. A record the caller cannot see is
--     `not_found`, indistinguishable from absent. Rows on a number the caller is
--     denied (#106) are dropped on every record type.
-- ---------------------------------------------------------------------------
create or replace function public.api_record_activity(
  p_company_id        uuid,
  p_record_type       text,
  p_record_id         uuid,
  p_hidden_number_ids uuid[] default null,
  p_category          text default null,
  p_limit             int default 50,
  p_before_ts         timestamptz default null,
  p_before_id         uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_visible boolean;
  v_items   jsonb;
  v_hidden  uuid[] := coalesce(p_hidden_number_ids, '{}'::uuid[]);
begin
  if p_record_type = 'contact' then
    select true into v_visible from public.contacts k
     where k.company_id = p_company_id and k.id = p_record_id and k.deleted_at is null;
  elsif p_record_type = 'conversation' then
    select true into v_visible from public.conversations c
     where c.company_id = p_company_id and c.id = p_record_id
       and c.deleted_at is null and not (c.phone_number_id = any(v_hidden));
  elsif p_record_type = 'call' then
    select true into v_visible from public.calls k
     where k.company_id = p_company_id and k.id = p_record_id
       and k.deleted_at is null and not (k.phone_number_id = any(v_hidden));
  elsif p_record_type = 'task' then
    select true into v_visible
      from public.tasks t
      left join public.conversations c on c.id = t.conversation_id
     where t.company_id = p_company_id and t.id = p_record_id
       and t.deleted_at is null
       and (c.phone_number_id is null or not (c.phone_number_id = any(v_hidden)));
  end if;
  if v_visible is not true then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'kind', a.kind, 'category', a.category,
           'occurred_at', a.occurred_at, 'actor_type', a.actor_type,
           'actor_id', a.actor_id, 'payload', a.payload,
           'source_type', a.source_type, 'source_id', a.source_id,
           'conversation_id', a.conversation_id)
         order by a.occurred_at desc, a.id desc), '[]'::jsonb)
    into v_items
    from (
      select a.*
        from public.record_activity a
       where a.company_id = p_company_id
         and a.record_type = p_record_type
         and a.record_id = p_record_id
         and (p_category is null or a.category = p_category)
         and (a.phone_number_id is null or not (a.phone_number_id = any(v_hidden)))
         -- A trashed or spam thread is not part of the relationship.
         and (a.conversation_id is null or p_record_type = 'conversation'
              or not exists (select 1 from public.conversations c
                              where c.id = a.conversation_id
                                and (c.deleted_at is not null or coalesce(c.is_spam, false))))
         -- A text moved to the Trash is gone from the timeline until it is restored.
         and not (a.source_type = 'message' and exists (
               select 1 from public.messages m
               where m.id = a.source_id and m.deleted_at is not null))
         and (p_before_ts is null
              or (a.occurred_at, a.id) < (p_before_ts, p_before_id))
       order by a.occurred_at desc, a.id desc
       limit greatest(1, least(coalesce(p_limit, 50), 201))
    ) a;

  return jsonb_build_object('outcome', 'ok', 'items', v_items);
end $$;

revoke execute on function public.api_record_activity(
  uuid, text, uuid, uuid[], text, int, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.api_record_activity(
  uuid, text, uuid, uuid[], text, int, timestamptz, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 12. History that already exists moves onto the table (idempotent: every row
--     carries its dedupe key, so running this twice adds nothing).
-- ---------------------------------------------------------------------------
do $$
declare
  k public.contacts;
  m public.messages;
  c public.calls;
  e public.task_events;
  v public.conversation_events;
  f public.record_references;
  s public.scheduled_messages;
begin
  for k in select * from public.contacts loop
    perform public.record_activity_contact_created(k);
  end loop;
  for m in select * from public.messages
            where direction::text in ('inbound', 'outbound') and deleted_at is null loop
    perform public.record_activity_message(m);
  end loop;
  for c in select * from public.calls where outcome is not null and deleted_at is null loop
    perform public.record_activity_call(c);
  end loop;
  for e in select * from public.task_events loop
    perform public.record_activity_task_event(e);
  end loop;
  for v in select * from public.conversation_events loop
    perform public.record_activity_conversation_event(v);
  end loop;
  for f in select * from public.record_references loop
    perform public.record_activity_reference(f);
  end loop;
  for s in select * from public.scheduled_messages loop
    perform public.record_activity_scheduled(s, null::public.scheduled_messages);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 13. The erasure and merge paths learn the new table, rewritten from the live
--     definitions.
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_def text;
  v_new text;
begin
  -- The workspace purge names the table.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'purge_workspace_step';
  v_new := replace(v_def, $$'task_series', 'task_counters',$$,
                          $$'task_series', 'task_counters', 'record_activity',$$);
  if v_new = v_def then
    raise exception 'purge_workspace_step: the roster anchor was not found';
  end if;
  execute v_new;

  -- A task purged from the trash loses the words its history carried, on every
  -- record the history landed on.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'api_purge_trash_item';
  v_new := replace(v_def,
    $$and kind in ('created', 'title', 'description', 'address');$$,
    $$and kind in ('created', 'title', 'description', 'address');
    update public.record_activity
       set payload = '{}'::jsonb
     where source_type = 'task' and source_id = any (v_tasks);$$);
  if v_new = v_def then
    raise exception 'api_purge_trash_item: the task_events anchor was not found';
  end if;
  execute v_new;

  -- A merge copies fields onto the survivor. That is one event, not edits.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'api_merge_contacts';
  v_new := replace(v_def,
    $$-- The survivor inherits anything it was missing.$$,
    $$perform set_config('loonext.activity_quiet', 'on', true);
  -- The survivor inherits anything it was missing.$$);
  if v_new = v_def then
    raise exception 'api_merge_contacts: the survivor anchor was not found';
  end if;
  execute v_new;
end $mig$;

revoke execute on function public.purge_workspace_step(uuid, int)
  from public, anon, authenticated;
grant execute on function public.purge_workspace_step(uuid, int) to service_role;
revoke execute on function public.api_purge_trash_item(text, uuid, uuid, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.api_purge_trash_item(text, uuid, uuid, uuid, uuid[]) to service_role;
revoke execute on function public.api_merge_contacts(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.api_merge_contacts(uuid, uuid, uuid, uuid) to service_role;

revoke execute on function public.record_activity_message(public.messages),
  public.record_activity_on_message(),
  public.record_activity_call(public.calls),
  public.record_activity_on_call(),
  public.record_activity_contact_created(public.contacts),
  public.record_activity_on_contact(),
  public.record_activity_task_event(public.task_events),
  public.record_activity_on_task_event(),
  public.record_activity_conversation_event(public.conversation_events),
  public.record_activity_on_conversation_event(),
  public.record_activity_reference(public.record_references),
  public.record_activity_on_reference(),
  public.record_activity_scheduled(public.scheduled_messages, public.scheduled_messages),
  public.record_activity_on_scheduled(),
  public.record_activity_on_blocked_sender(),
  public.record_activity_on_trash()
  from public, anon, authenticated;
