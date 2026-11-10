-- #691: messages, conversations, calls and voicemails can be deleted, sit in a
-- 30-day Trash, and are purged with their storage objects.
--
-- WHY COLUMNS AND NOT A TRASH TABLE. A message is referenced by usage_events,
-- tasks, mentions, summaries and payment requests; a conversation by quotes and
-- payment requests. Moving rows out would break every one of those edges, and
-- restore would have to put them back. A `deleted_at` on the row keeps every
-- foreign key true and makes restore one UPDATE.
--
-- WHAT "DELETE FOREVER" LEAVES. The CONTENT goes: the body, the media, the
-- voicemail audio, the transcript, the intake and the summaries made from them.
-- The row stays as a content-free tombstone (`purged_at`) because the billing
-- meter reads it: api_period_inbound_segments and api_period_outbound_mms count
-- messages, usage_events point at them, and call_records carry the voice
-- minutes. Deleting those would change an invoice, and the issue forbids that.
-- opt_outs is keyed on (company, phone) and is never touched here.
--
-- A trashed conversation is CLOSED as well as hidden. Four inbound threaders pick
-- "the open conversation" or "the latest closed one" for a number, and closing it
-- is what stops a new text from landing in a thread nobody can see. The three
-- that read closed rows are patched below to skip a trashed one.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.messages
  add column if not exists deleted_at         timestamptz,
  add column if not exists deleted_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists purged_at          timestamptz;

alter table public.conversations
  add column if not exists deleted_at         timestamptz,
  add column if not exists deleted_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists deleted_prior_status public.conversation_status,
  add column if not exists purged_at          timestamptz;

alter table public.calls
  add column if not exists deleted_at                  timestamptz,
  add column if not exists deleted_by_user_id          uuid references auth.users(id) on delete set null,
  add column if not exists voicemail_deleted_at        timestamptz,
  add column if not exists voicemail_deleted_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists purged_at                   timestamptz;

comment on column public.messages.deleted_at is
  '#691: in the Trash since. Every read path filters on it; purge scrubs the content after 30 days.';
comment on column public.messages.purged_at is
  '#691: content permanently erased. The row stays as a tombstone because the billing meter counts it.';
comment on column public.conversations.deleted_prior_status is
  '#691: the status to give back on restore. A trashed conversation is stored closed.';
comment on column public.calls.voicemail_deleted_at is
  '#691: the voicemail alone is in the Trash. The call stays in the log.';

create index if not exists messages_trash_idx
  on public.messages (company_id, deleted_at desc)
  where deleted_at is not null and purged_at is null;
create index if not exists conversations_trash_idx
  on public.conversations (company_id, deleted_at desc)
  where deleted_at is not null and purged_at is null;
create index if not exists calls_trash_idx
  on public.calls (company_id, deleted_at desc)
  where deleted_at is not null and purged_at is null;
create index if not exists calls_voicemail_trash_idx
  on public.calls (company_id, voicemail_deleted_at desc)
  where voicemail_deleted_at is not null;

-- ---------------------------------------------------------------------------
-- 2. Trash: one message
-- ---------------------------------------------------------------------------
create or replace function public.api_trash_message(
  p_company_id         uuid,
  p_user_id            uuid,
  p_message_id         uuid,
  p_hidden_number_ids  uuid[] default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  select m.id, m.conversation_id, m.direction::text as direction
    into v_row
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
   where m.id = p_message_id
     and m.company_id = p_company_id
     and m.deleted_at is null
     and c.deleted_at is null
     and (p_hidden_number_ids is null
          or not (c.phone_number_id = any (p_hidden_number_ids)))
   for update of m;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  update public.messages
     set deleted_at = now(), deleted_by_user_id = p_user_id
   where id = v_row.id;

  return jsonb_build_object(
    'outcome', 'trashed',
    'message_id', v_row.id,
    'conversation_id', v_row.conversation_id,
    'direction', v_row.direction);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Trash: conversations (one or many)
-- ---------------------------------------------------------------------------
create or replace function public.api_trash_conversations(
  p_company_id         uuid,
  p_user_id            uuid,
  p_ids                uuid[],
  p_hidden_number_ids  uuid[] default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now     timestamptz := now();
  v_ids     uuid[];
  v_calls   int := 0;
begin
  select coalesce(array_agg(c.id order by c.id), '{}')
    into v_ids
    from (
      select c0.id
        from public.conversations c0
       where c0.company_id = p_company_id
         and c0.id = any (p_ids)
         and c0.deleted_at is null
         and (p_hidden_number_ids is null
              or not (c0.phone_number_id = any (p_hidden_number_ids)))
       order by c0.id
         for update
    ) c;

  if cardinality(v_ids) = 0 then
    return jsonb_build_object('outcome', 'ok', 'trashed', '[]'::jsonb, 'calls', 0);
  end if;

  update public.conversations c
     set deleted_prior_status = c.status,
         status = 'closed',
         closed_at = coalesce(c.closed_at, v_now),
         deleted_at = v_now,
         deleted_by_user_id = p_user_id
   where c.id = any (v_ids);

  -- The calls threaded into it go with it, on the same stamp, so restore can
  -- tell them from a call somebody trashed on its own.
  update public.calls k
     set deleted_at = v_now, deleted_by_user_id = p_user_id
   where k.conversation_id = any (v_ids)
     and k.deleted_at is null;
  get diagnostics v_calls = row_count;

  -- A follow-up queued into a thread nobody can see would still go out.
  update public.scheduled_messages s
     set status = 'canceled', canceled_at = v_now, canceled_by = p_user_id
   where s.conversation_id = any (v_ids)
     and s.status in ('pending', 'held');

  return jsonb_build_object(
    'outcome', 'ok',
    'trashed', to_jsonb(v_ids),
    'calls', v_calls);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Trash: a call, or just its voicemail
-- ---------------------------------------------------------------------------
create or replace function public.api_trash_call(
  p_company_id         uuid,
  p_user_id            uuid,
  p_call_id            uuid,
  p_voicemail_only     boolean default false,
  p_hidden_number_ids  uuid[] default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_call record;
begin
  select k.id, k.conversation_id, k.call_session_id,
         (k.voicemail_path is not null or k.voicemail_transcript is not null) as has_voicemail
    into v_call
    from public.calls k
   where k.id = p_call_id
     and k.company_id = p_company_id
     and k.deleted_at is null
     and (p_hidden_number_ids is null
          or k.phone_number_id is null
          or not (k.phone_number_id = any (p_hidden_number_ids)))
   for update of k;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if coalesce(p_voicemail_only, false) then
    if not v_call.has_voicemail or exists (
         select 1 from public.calls k2
          where k2.id = v_call.id and k2.voicemail_deleted_at is not null) then
      return jsonb_build_object('outcome', 'not_found');
    end if;
    update public.calls
       set voicemail_deleted_at = now(), voicemail_deleted_by_user_id = p_user_id
     where id = v_call.id;
    return jsonb_build_object(
      'outcome', 'trashed', 'kind', 'voicemail', 'call_id', v_call.id,
      'conversation_id', v_call.conversation_id);
  end if;

  update public.calls
     set deleted_at = now(), deleted_by_user_id = p_user_id
   where id = v_call.id;
  return jsonb_build_object(
    'outcome', 'trashed', 'kind', 'call', 'call_id', v_call.id,
    'conversation_id', v_call.conversation_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Restore
-- ---------------------------------------------------------------------------
create or replace function public.api_restore_trash(
  p_company_id         uuid,
  p_user_id            uuid,
  p_kind               text,
  p_id                 uuid,
  p_hidden_number_ids  uuid[] default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_conv   record;
  v_stamp  timestamptz;
  v_open   boolean;
  v_status public.conversation_status;
begin
  if p_kind = 'message' then
    perform 1
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
     where m.id = p_id and m.company_id = p_company_id
       and m.deleted_at is not null and m.purged_at is null
       and (p_hidden_number_ids is null
            or not (c.phone_number_id = any (p_hidden_number_ids)));
    if not found then return jsonb_build_object('outcome', 'not_found'); end if;
    if exists (select 1 from public.messages m
                 join public.conversations c on c.id = m.conversation_id
                where m.id = p_id and c.deleted_at is not null) then
      return jsonb_build_object('outcome', 'conversation_trashed');
    end if;
    update public.messages set deleted_at = null, deleted_by_user_id = null
     where id = p_id;
    return jsonb_build_object('outcome', 'restored', 'kind', 'message', 'id', p_id);

  elsif p_kind = 'conversation' then
    select c.* into v_conv
      from public.conversations c
     where c.id = p_id and c.company_id = p_company_id
       and c.deleted_at is not null and c.purged_at is null
       and (p_hidden_number_ids is null
            or not (c.phone_number_id = any (p_hidden_number_ids)))
       for update;
    if not found then return jsonb_build_object('outcome', 'not_found'); end if;
    v_stamp := v_conv.deleted_at;
    v_status := coalesce(v_conv.deleted_prior_status, 'closed');

    -- One open conversation per (number, contact, phone). If a newer thread has
    -- taken that place while this one was in the Trash, this comes back CLOSED
    -- instead of breaking the threading invariant.
    v_open := v_status <> 'closed' and not exists (
      select 1 from public.conversations o
       where o.company_id = v_conv.company_id
         and o.phone_number_id = v_conv.phone_number_id
         and o.contact_id = v_conv.contact_id
         and o.contact_phone_e164 is not distinct from v_conv.contact_phone_e164
         and o.closed_at is null
         and o.id <> v_conv.id);

    update public.conversations
       set deleted_at = null, deleted_by_user_id = null, deleted_prior_status = null,
           status = case when v_open then v_status else 'closed' end,
           closed_at = case when v_open then null else coalesce(closed_at, now()) end
     where id = v_conv.id;

    update public.calls
       set deleted_at = null, deleted_by_user_id = null
     where conversation_id = v_conv.id and deleted_at = v_stamp and purged_at is null;

    return jsonb_build_object(
      'outcome', 'restored', 'kind', 'conversation', 'id', v_conv.id,
      'status', case when v_open then v_status::text else 'closed' end);

  elsif p_kind = 'call' then
    select k.* into v_conv
      from public.calls k
     where k.id = p_id and k.company_id = p_company_id
       and k.deleted_at is not null and k.purged_at is null
       and (p_hidden_number_ids is null or k.phone_number_id is null
            or not (k.phone_number_id = any (p_hidden_number_ids)))
       for update;
    if not found then return jsonb_build_object('outcome', 'not_found'); end if;
    if exists (select 1 from public.conversations c
                where c.id = v_conv.conversation_id and c.deleted_at is not null) then
      return jsonb_build_object('outcome', 'conversation_trashed');
    end if;
    update public.calls set deleted_at = null, deleted_by_user_id = null
     where id = p_id;
    return jsonb_build_object('outcome', 'restored', 'kind', 'call', 'id', p_id);

  elsif p_kind = 'voicemail' then
    update public.calls k
       set voicemail_deleted_at = null, voicemail_deleted_by_user_id = null
     where k.id = p_id and k.company_id = p_company_id
       and k.voicemail_deleted_at is not null and k.purged_at is null
       and (p_hidden_number_ids is null or k.phone_number_id is null
            or not (k.phone_number_id = any (p_hidden_number_ids)));
    if not found then return jsonb_build_object('outcome', 'not_found'); end if;
    return jsonb_build_object('outcome', 'restored', 'kind', 'voicemail', 'id', p_id);
  end if;

  return jsonb_build_object('outcome', 'not_found');
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. The Trash list: one keyset-paginated read across the four kinds
-- ---------------------------------------------------------------------------
create or replace function public.api_list_trash(
  p_company_id         uuid,
  p_limit              int,
  p_cursor_ts          timestamptz default null,
  p_cursor_id          uuid default null,
  p_hidden_number_ids  uuid[] default null
) returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with items as (
    select 'conversation'::text as kind, c.id, c.deleted_at,
           c.deleted_by_user_id as deleted_by,
           jsonb_build_object(
             'contact_name', ct.name,
             'contact_phone', ct.phone_e164,
             'message_count', (select count(*) from public.messages m
                                where m.conversation_id = c.id and m.deleted_at is null
                                  and m.purged_at is null)
           ) as detail
      from public.conversations c
      join public.contacts ct on ct.id = c.contact_id
     where c.company_id = p_company_id and c.deleted_at is not null
       and c.purged_at is null
       and (p_hidden_number_ids is null
            or not (c.phone_number_id = any (p_hidden_number_ids)))
    union all
    select 'message', m.id, m.deleted_at, m.deleted_by_user_id,
           jsonb_build_object(
             'contact_name', ct.name,
             'contact_phone', ct.phone_e164,
             'conversation_id', m.conversation_id,
             'direction', m.direction,
             'snippet', left(m.body, 120))
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
      join public.contacts ct on ct.id = c.contact_id
     where m.company_id = p_company_id and m.deleted_at is not null
       and m.purged_at is null and c.deleted_at is null
       and (p_hidden_number_ids is null
            or not (c.phone_number_id = any (p_hidden_number_ids)))
    union all
    select 'call', k.id, k.deleted_at, k.deleted_by_user_id,
           jsonb_build_object(
             'contact_name', coalesce(ct.name, k.caller_name),
             'contact_phone', coalesce(ct.phone_e164, k.caller_e164),
             'outcome', k.outcome,
             'started_at', k.started_at,
             'has_voicemail', (k.voicemail_path is not null))
      from public.calls k
      left join public.contacts ct on ct.id = k.contact_id
     where k.company_id = p_company_id and k.deleted_at is not null
       and k.purged_at is null
       and not exists (select 1 from public.conversations cv
                        where cv.id = k.conversation_id
                          and cv.deleted_at is not distinct from k.deleted_at)
       and (p_hidden_number_ids is null or k.phone_number_id is null
            or not (k.phone_number_id = any (p_hidden_number_ids)))
    union all
    select 'voicemail', k.id, k.voicemail_deleted_at, k.voicemail_deleted_by_user_id,
           jsonb_build_object(
             'contact_name', coalesce(ct.name, k.caller_name),
             'contact_phone', coalesce(ct.phone_e164, k.caller_e164),
             'started_at', k.started_at,
             'voicemail_seconds', k.voicemail_seconds)
      from public.calls k
      left join public.contacts ct on ct.id = k.contact_id
     where k.company_id = p_company_id and k.voicemail_deleted_at is not null
       and k.deleted_at is null and k.purged_at is null
       and (k.voicemail_path is not null or k.voicemail_transcript is not null
            or k.voicemail_intake is not null)
       and (p_hidden_number_ids is null or k.phone_number_id is null
            or not (k.phone_number_id = any (p_hidden_number_ids)))
  )
  select jsonb_build_object(
           'kind', i.kind,
           'id', i.id,
           'deleted_at', i.deleted_at,
           'deleted_by_user_id', i.deleted_by,
           'purge_after', i.deleted_at + interval '30 days') || i.detail
    from items i
   where p_cursor_ts is null or (i.deleted_at, i.id) < (p_cursor_ts, p_cursor_id)
   order by i.deleted_at desc, i.id desc
   limit greatest(p_limit, 0)
$$;

-- ---------------------------------------------------------------------------
-- 7. Purge: which storage objects belong to an item
--
-- Reads only. The Worker removes the objects FIRST and then calls the row purge,
-- because the rows are where the paths live (the retention job's rule). A path
-- another surviving attachment still points at is NOT returned: note files are
-- stored once per company (attachment_dedup), so removing a shared object would
-- break a live file.
-- ---------------------------------------------------------------------------
create or replace function public.trash_item_number(p_kind text, p_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case p_kind
    when 'message' then (select c.phone_number_id from public.messages m
                           join public.conversations c on c.id = m.conversation_id
                          where m.id = p_id)
    when 'conversation' then (select c.phone_number_id from public.conversations c
                               where c.id = p_id)
    else (select k.phone_number_id from public.calls k where k.id = p_id)
  end
$$;

create or replace function public.api_trash_object_paths(
  p_kind               text,
  p_id                 uuid,
  p_company_id         uuid default null,
  p_hidden_number_ids  uuid[] default null
) returns table (bucket text, path text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_conv    uuid;
  v_msgs    uuid[] := '{}';
  v_calls   uuid[] := '{}';
  v_att     uuid[] := '{}';
  v_stamp   timestamptz;
begin
  if p_kind = 'message' then
    select m.company_id, m.conversation_id into v_company, v_conv
      from public.messages m where m.id = p_id;
    v_msgs := array[p_id];
  elsif p_kind = 'conversation' then
    select c.company_id, c.deleted_at into v_company, v_stamp
      from public.conversations c where c.id = p_id;
    v_conv := p_id;
    select coalesce(array_agg(m.id), '{}') into v_msgs
      from public.messages m where m.conversation_id = p_id;
    select coalesce(array_agg(k.id), '{}') into v_calls
      from public.calls k where k.conversation_id = p_id and k.deleted_at = v_stamp;
  elsif p_kind in ('call', 'voicemail') then
    select k.company_id into v_company from public.calls k where k.id = p_id;
    v_calls := array[p_id];
  else
    return;
  end if;
  if v_company is null or public.is_on_legal_hold(v_company) then return; end if;
  -- A caller naming a workspace and a deny-list gets nothing for another
  -- workspace's item or one on a number it cannot see (#106).
  if p_company_id is not null and v_company is distinct from p_company_id then
    return;
  end if;
  if p_hidden_number_ids is not null
     and public.trash_item_number(p_kind, p_id) = any (p_hidden_number_ids) then
    return;
  end if;

  -- MMS media
  return query
    select 'mms-media'::text, regexp_replace(a.storage_path, '^mms-media/', '')
      from public.message_attachments a
     where a.message_id = any (v_msgs);

  if p_kind <> 'voicemail' then
    -- Files on a note, on a task made from it, and (for a conversation) every file
    -- the thread's tasks carry. Rows are selected once, then paths are filtered
    -- against rows that survive.
    select coalesce(array_agg(x.id), '{}') into v_att
      from (
        select a.id
          from public.attachments a
         where a.company_id = v_company
           and ((a.owner_type = 'note' and a.owner_id = any (v_msgs))
                or (a.owner_type = 'task' and a.owner_id in (
                      select t.id from public.tasks t
                       where t.message_id = any (v_msgs)
                          or t.source_call_id = any (v_calls)
                          or (v_conv is not null and p_kind = 'conversation'
                              and t.conversation_id = v_conv)))
                or (p_kind = 'conversation' and a.conversation_id = v_conv))
      ) x;

    return query
      select distinct 'attachments'::text, p.p
        from (
          select a.storage_path as p from public.attachments a where a.id = any (v_att)
          union
          select a.preview_path from public.attachments a
           where a.id = any (v_att) and a.preview_path is not null
        ) p
       where not exists (
         select 1 from public.attachments o
          where o.company_id = v_company
            and not (o.id = any (v_att))
            and (o.storage_path = p.p or o.preview_path = p.p));
  end if;

  -- Voicemail audio
  return query
    select 'voicemails'::text, k.voicemail_path
      from public.calls k
     where k.id = any (v_calls) and k.voicemail_path is not null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Purge: due items (30 days in the Trash, workspace not on legal hold)
-- ---------------------------------------------------------------------------
create or replace function public.api_trash_due(
  p_limit int default 100
) returns table (kind text, id uuid, company_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with due as (
    select 'conversation'::text as kind, c.id, c.company_id, c.deleted_at as at
      from public.conversations c
     where c.deleted_at < now() - interval '30 days' and c.purged_at is null
    union all
    select 'message', m.id, m.company_id, m.deleted_at
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
     where m.deleted_at < now() - interval '30 days' and m.purged_at is null
       and c.deleted_at is null
    union all
    select 'call', k.id, k.company_id, k.deleted_at
      from public.calls k
     where k.deleted_at < now() - interval '30 days' and k.purged_at is null
       and not exists (select 1 from public.conversations cv
                        where cv.id = k.conversation_id
                          and cv.deleted_at is not distinct from k.deleted_at
                          and cv.purged_at is null)
    union all
    select 'voicemail', k.id, k.company_id, k.voicemail_deleted_at
      from public.calls k
     where k.voicemail_deleted_at < now() - interval '30 days'
       and k.deleted_at is null and k.purged_at is null
       and (k.voicemail_path is not null or k.voicemail_transcript is not null
            or k.voicemail_intake is not null)
  )
  select d.kind, d.id, d.company_id
    from due d
    join public.companies co on co.id = d.company_id
   where co.deleted_at is null
     and not public.is_on_legal_hold(d.company_id)
   order by d.at
   limit greatest(p_limit, 1)
$$;

-- ---------------------------------------------------------------------------
-- 9. Purge: the rows. Content-free audit event written in the same transaction.
-- ---------------------------------------------------------------------------
create or replace function public.api_purge_trash_item(
  p_kind               text,
  p_id                 uuid,
  p_actor              uuid default null,
  p_company_id         uuid default null,
  p_hidden_number_ids  uuid[] default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_conv    uuid;
  v_stamp   timestamptz;
  v_msgs    uuid[] := '{}';
  v_calls   uuid[] := '{}';
  v_sessions text[] := '{}';
  v_tasks   uuid[] := '{}';
  v_att     uuid[] := '{}';
  v_vm_only boolean := false;
begin
  if p_kind = 'message' then
    select m.company_id, m.conversation_id into v_company, v_conv
      from public.messages m
     where m.id = p_id and m.deleted_at is not null and m.purged_at is null
       for update;
    v_msgs := array[p_id];
  elsif p_kind = 'conversation' then
    select c.company_id, c.deleted_at into v_company, v_stamp
      from public.conversations c
     where c.id = p_id and c.deleted_at is not null and c.purged_at is null
       for update;
    v_conv := p_id;
    select coalesce(array_agg(m.id), '{}') into v_msgs
      from public.messages m where m.conversation_id = p_id;
    select coalesce(array_agg(k.id), '{}') into v_calls
      from public.calls k where k.conversation_id = p_id and k.deleted_at = v_stamp
       and k.purged_at is null;
  elsif p_kind = 'call' then
    select k.company_id, k.conversation_id into v_company, v_conv
      from public.calls k
     where k.id = p_id and k.deleted_at is not null and k.purged_at is null
       for update;
    v_calls := array[p_id];
  elsif p_kind = 'voicemail' then
    select k.company_id into v_company
      from public.calls k
     where k.id = p_id and k.voicemail_deleted_at is not null and k.deleted_at is null
       for update;
    v_calls := array[p_id];
    v_vm_only := true;
  else
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_company is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if p_company_id is not null and v_company is distinct from p_company_id then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if p_hidden_number_ids is not null
     and public.trash_item_number(p_kind, p_id) = any (p_hidden_number_ids) then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if public.is_on_legal_hold(v_company) then
    return jsonb_build_object('outcome', 'legal_hold');
  end if;

  select coalesce(array_agg(k.call_session_id), '{}') into v_sessions
    from public.calls k where k.id = any (v_calls);

  -- Files made from the content. Same selection as api_trash_object_paths.
  select coalesce(array_agg(t.id), '{}') into v_tasks
    from public.tasks t
   where t.company_id = v_company
     and (t.message_id = any (v_msgs)
          or t.source_call_id = any (v_calls)
          or (p_kind = 'conversation' and t.conversation_id = v_conv));
  select coalesce(array_agg(a.id), '{}') into v_att
    from public.attachments a
   where a.company_id = v_company
     and ((a.owner_type = 'note' and a.owner_id = any (v_msgs))
          or (a.owner_type = 'task' and a.owner_id = any (v_tasks))
          or (p_kind = 'conversation' and a.conversation_id = v_conv));

  if not v_vm_only then
    delete from public.message_attachments where message_id = any (v_msgs);
    delete from public.message_mentions where message_id = any (v_msgs);
    delete from public.attachments where id = any (v_att);
    update public.messages
       set body = '', error_detail = null, purged_at = now(),
           pinned_at = null, pinned_by_user_id = null
     where id = any (v_msgs);
  end if;

  -- The summaries made from the words. They quote the customer.
  if v_conv is not null and p_kind in ('message', 'conversation') then
    delete from public.conversation_summaries where conversation_id = v_conv;
  end if;

  -- A task made from deleted content is removed the way a person would remove
  -- it (soft delete, which unlinks its calendar event), and its title, which
  -- was copied from the words, is blanked.
  if cardinality(v_tasks) > 0 and not v_vm_only then
    update public.tasks
       set deleted_at = coalesce(deleted_at, now()),
           title = 'Removed', description = ''
     where id = any (v_tasks);
  end if;

  if p_kind = 'conversation' then
    -- Everything on the timeline but the consent evidence.
    delete from public.conversation_events
     where conversation_id = v_conv
       and type::text not in ('opted_out', 'opt_out_revoked', 'consent_attested');
    delete from public.conversation_tags where conversation_id = v_conv;
    delete from public.conversation_reads where conversation_id = v_conv;
    update public.conversations set purged_at = now() where id = v_conv;
  elsif p_kind in ('call', 'voicemail') and cardinality(v_sessions) > 0 then
    -- The thread line for the voicemail carries its transcript.
    if v_vm_only then
      update public.conversation_events
         set payload = payload - 'transcript'
       where company_id = v_company and type::text = 'call_completed'
         and payload->>'call_session_id' = any (v_sessions);
    else
      delete from public.conversation_events
       where company_id = v_company and type::text = 'call_completed'
         and payload->>'call_session_id' = any (v_sessions);
    end if;
  end if;

  if cardinality(v_calls) > 0 then
    update public.calls
       set voicemail_path = null, voicemail_seconds = null,
           voicemail_transcript = null, voicemail_intake = null,
           voicemail_intake_at = null,
           voicemail_transcript_attempted_at =
             coalesce(voicemail_transcript_attempted_at, now())
     where id = any (v_calls);
    if not v_vm_only then
      -- The call row stays as a tombstone: call_records (the voice meter) is
      -- keyed on the session, and a late carrier event must find its call.
      delete from public.call_member_legs where call_session_id = any (v_sessions);
      update public.calls
         set caller_e164 = null, caller_name = null, contact_id = null,
             conversation_id = null, purged_at = now()
       where id = any (v_calls);
    end if;
  end if;

  insert into public.audit_log
    (company_id, actor_user_id, action, target_type, target_id, before, after)
  values
    (v_company, p_actor, 'record.purged', p_kind, p_id::text, '{}'::jsonb,
     jsonb_build_object(
       'by', case when p_actor is null then 'trash_expiry' else 'delete_forever' end,
       'messages', cardinality(v_msgs),
       'calls', cardinality(v_calls)));

  return jsonb_build_object(
    'outcome', 'purged', 'kind', p_kind, 'id', p_id, 'company_id', v_company);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Calendar: a trashed thread's jobs leave the calendar like a thread the
-- member lost access to (the 'scrub' action), and come back on restore.
-- ---------------------------------------------------------------------------
create or replace function public.calendar_conversation_trash_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks%rowtype;
begin
  for v_task in
    select * from public.tasks where conversation_id = new.id
  loop
    perform public.calendar_enqueue_task_sync(v_task);
  end loop;
  return null;
end $$;

drop trigger if exists conversations_calendar_trash on public.conversations;
create trigger conversations_calendar_trash
after update of deleted_at on public.conversations
for each row when (old.deleted_at is distinct from new.deleted_at)
execute function public.calendar_conversation_trash_changed();

-- ---------------------------------------------------------------------------
-- Grants: hosted Supabase grants EXECUTE by name, so a function made here is
-- callable by anon until it is revoked.
-- ---------------------------------------------------------------------------
revoke execute on function public.api_trash_message(uuid, uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.api_trash_message(uuid, uuid, uuid, uuid[]) to service_role;
revoke execute on function public.api_trash_conversations(uuid, uuid, uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.api_trash_conversations(uuid, uuid, uuid[], uuid[]) to service_role;
revoke execute on function public.api_trash_call(uuid, uuid, uuid, boolean, uuid[]) from public, anon, authenticated;
grant execute on function public.api_trash_call(uuid, uuid, uuid, boolean, uuid[]) to service_role;
revoke execute on function public.api_restore_trash(uuid, uuid, text, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.api_restore_trash(uuid, uuid, text, uuid, uuid[]) to service_role;
revoke execute on function public.api_list_trash(uuid, int, timestamptz, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.api_list_trash(uuid, int, timestamptz, uuid, uuid[]) to service_role;
revoke execute on function public.api_trash_object_paths(text, uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.api_trash_object_paths(text, uuid, uuid, uuid[]) to service_role;
revoke execute on function public.api_trash_due(int) from public, anon, authenticated;
grant execute on function public.api_trash_due(int) to service_role;
revoke execute on function public.api_purge_trash_item(text, uuid, uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.api_purge_trash_item(text, uuid, uuid, uuid, uuid[]) to service_role;
revoke execute on function public.trash_item_number(text, uuid) from public, anon, authenticated;
grant execute on function public.trash_item_number(text, uuid) to service_role;
revoke execute on function public.calendar_conversation_trash_changed() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Read paths: a trashed row is invisible. Each function below is the latest
-- definition with only the filter added (create or replace keeps its grants).
-- ---------------------------------------------------------------------------

-- api_list_conversations (was 20260807150000_inbox_page_takes_an_index.sql)
create or replace function public.api_list_conversations(
  p_company_id uuid,
  p_user_id uuid,
  p_limit integer,
  p_status text default null,
  p_assigned_user_id uuid default null,
  p_tag_id uuid default null,
  p_is_spam boolean default false,
  p_unread boolean default false,
  p_q text default null,
  p_cursor_ts timestamptz default null,
  p_cursor_id uuid default null,
  p_pinned text default null,
  p_hidden_number_ids uuid[] default null,
  p_snoozed text default 'exclude',
  p_awaiting text default null
)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $fn$

  -- THE PAGE, chosen with nothing hanging off it. Only the id is carried out:
  -- the decoration below re-reads the row by primary key, which keeps
  -- to_jsonb(c.*) exactly the shape it has always been rather than one carrying
  -- whatever this query needed in order to sort.
  --
  -- contacts is joined here only because the search filter reads the contact's
  -- name and number, and conversation_snoozes only because the deferral filter
  -- reads it. Both are needed to CHOOSE the page, so both stay.
  with page as (
    select c.id, c.last_message_at, c.pinned_at
    from public.conversations c
    -- The deferral is THIS member's. A colleague's snooze must not appear on
    -- their row, and must not hide the thread from them.
    left join public.conversation_snoozes sz
      on sz.conversation_id = c.id
     and sz.user_id = p_user_id
     and sz.until > now()
    where c.company_id = p_company_id
      and c.deleted_at is null
      and c.is_spam = coalesce(p_is_spam, false)
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
      and (p_status is null or c.status = p_status::public.conversation_status)
      and (p_assigned_user_id is null or c.assigned_user_id = p_assigned_user_id)
      and (p_tag_id is null or exists (
            select 1 from public.conversation_tags cx
             where cx.conversation_id = c.id and cx.tag_id = p_tag_id))
      and (not coalesce(p_unread, false) or exists (
            select 1
              from public.messages m
             where m.deleted_at is null and m.conversation_id = c.id
               and (m.sent_by_user_id is null or m.sent_by_user_id <> p_user_id)
               and m.created_at > coalesce(
                 (select r.last_read_at
                    from public.conversation_reads r
                   where r.conversation_id = c.id and r.user_id = p_user_id),
                 '-infinity'::timestamptz)))
      -- A SEMI-JOIN, not a join plus a disjunct over its columns. Written the
      -- other way this clause mentioned `contacts`, so the planner could not
      -- separate the join from the filter: it had to build the join for the whole
      -- workspace and then take the top thirty by sorting all of it. Measured at
      -- 50k conversations, that one difference is 156ms against 0.65ms, because
      -- this shape lets the ordered index below do the work instead.
      and (p_q is null
           or c.contact_id in (
                select ct.id
                  from public.contacts ct
                 where ct.name ilike ('%' || p_q || '%')
                    or ct.phone_e164 ilike ('%' || p_q || '%')))
      -- #13 pinned filter: 'only' keeps pinned, 'exclude' drops them, null = all.
      and (p_pinned is null
           or (p_pinned = 'only'    and c.pinned_at is not null)
           or (p_pinned = 'exclude' and c.pinned_at is null))
      -- #508: threads still waiting on a first reply. awaiting_reply_since is the
      -- #388 lead clock, trigger-maintained on every message: set on the first
      -- inbound of a new or reopened thread, cleared by a human outbound. Reading
      -- it here rather than deriving a second "needs a reply" predicate is what
      -- makes the three clients agree by construction — and it is the LIVE twin
      -- of the number the response-time card reports, which counts leads with no
      -- response. status='new' was neither: nothing moves a conversation off it
      -- when the crew replies, so it means "nobody re-filed this" rather than
      -- "nobody answered this".
      and (p_awaiting is null
           or p_awaiting not in ('only', 'exclude')
           or (p_awaiting = 'only'    and c.awaiting_reply_since is not null)
           or (p_awaiting = 'exclude' and c.awaiting_reply_since is null))
      -- #293 deferral: 'exclude' (the DEFAULT) hides what this member deferred,
      -- 'only' is the "what did I defer" view, 'all' opts out entirely. An
      -- unrecognised value falls through to showing everything rather than hiding
      -- a thread on a typo — the failure that costs a customer is the one where a
      -- thread disappears.
      and (p_snoozed is null
           or p_snoozed not in ('exclude', 'only')
           or (p_snoozed = 'exclude' and sz.conversation_id is null)
           or (p_snoozed = 'only'    and sz.conversation_id is not null))
      -- The keyset cursor rides (last_message_at, id) — untouched by pinning, so
      -- the 'exclude' main list paginates exactly as before.
      and (p_cursor_ts is null
           or (c.last_message_at, c.id) < (p_cursor_ts, p_cursor_id))
    -- 'only' sorts most-recently-pinned first; every other mode falls straight
    -- through to the legacy (last_message_at, id) order.
    order by (case when p_pinned = 'only' then c.pinned_at end) desc nulls last,
             c.last_message_at desc, c.id desc
    limit greatest(p_limit, 0)
  )
  -- THE DECORATION, thirty times rather than fifty thousand. The ORDER BY is
  -- restated because the order inside a CTE is not something the outer query
  -- inherits, and this list's order is the product.
  select (to_jsonb(c.*) - 'last_notified_at')
    || jsonb_build_object(
         'contact', jsonb_build_object(
           'id', ct.id, 'name', ct.name, 'phone_e164', ct.phone_e164),
         'tags', coalesce(
           (select jsonb_agg(
                     jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color)
                     order by t.name)
              from public.conversation_tags cx
              join public.tags t on t.id = cx.tag_id
             where cx.conversation_id = c.id),
           '[]'::jsonb),
         -- #293: when THIS member has deferred it, when it comes back and why.
         -- Carried on every row rather than only in the snoozed view, so a thread
         -- that returns mid-session can be labelled without a second read, and so
         -- the snoozed list needs no join of its own.
         'snoozed_until', sz.until,
         'snooze_note', sz.note,
         'unread', exists (
           select 1
             from public.messages m
            where m.deleted_at is null and m.conversation_id = c.id
              and (m.sent_by_user_id is null or m.sent_by_user_id <> p_user_id)
              and m.created_at > coalesce(
                (select r.last_read_at
                   from public.conversation_reads r
                  where r.conversation_id = c.id and r.user_id = p_user_id),
                '-infinity'::timestamptz)),
         'last_message', case when lm.id is null then null else
           jsonb_build_object(
             'id', lm.id,
             'direction', lm.direction,
             'body', left(lm.body, 160),
             'created_at', lm.created_at,
             'has_attachments', lm.attachment_count > 0,
             'attachment_count', lm.attachment_count,
             'attachment_kind', lm.attachment_kind)
         end)
  from page
  join public.conversations c on c.id = page.id
  join public.contacts ct on ct.id = c.contact_id
  left join public.conversation_snoozes sz
    on sz.conversation_id = c.id
   and sz.user_id = p_user_id
   and sz.until > now()
  left join lateral (
    select m.id, m.direction, m.body, m.created_at,
           att.attachment_count, att.attachment_kind
    from public.messages m
    left join lateral (
      select count(*)::int as attachment_count,
             case
               when count(*) filter (where a.content_type like 'image/%') > 0
                 then 'image'
               when count(*) filter (where a.content_type like 'audio/%') > 0
                 then 'audio'
               when count(*) filter (where a.content_type like 'video/%') > 0
                 then 'video'
               when count(*) > 0 then 'file'
               else null
             end as attachment_kind
        from public.message_attachments a
       where a.message_id = m.id
    ) att on true
    where m.conversation_id = c.id
      and m.deleted_at is null
    order by m.created_at desc, m.id desc
    limit 1
  ) lm on true
  order by (case when p_pinned = 'only' then c.pinned_at end) desc nulls last,
           c.last_message_at desc, c.id desc
$fn$;

-- api_search_v2 (was 20261110100000_call_anchored_tasks.sql)
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
            and m0.deleted_at is null
            and m0.body_tsv @@ websearch_to_tsquery('english', p_q)
          order by m0.conversation_id, m0.created_at desc, m0.id desc
        ) m
        join public.conversations c on c.id = m.conversation_id and c.deleted_at is null
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
          and not exists (select 1 from public.conversations tc
                           where tc.id = a.conversation_id and tc.deleted_at is not null)
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
          and c.deleted_at is null
          and c.voicemail_deleted_at is null
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

-- api_list_calls (was 20260730090000_voicemail_intake.sql)
create or replace function public.api_list_calls(
  p_company_id         uuid,
  p_limit              int,
  p_outcome            text default null,
  p_cursor_ts          timestamptz default null,
  p_cursor_id          uuid default null,
  p_hidden_number_ids  uuid[] default null,
  p_contact_id         uuid default null
) returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'call_session_id', c.call_session_id,
    'caller_e164', c.caller_e164,
    'contact_id', c.contact_id,
    'contact_name', ct.name,
    'caller_name', c.caller_name,
    'phone_number_id', c.phone_number_id,
    'conversation_id', c.conversation_id,
    'outcome', c.outcome,
    'state', c.state,
    'direction', c.direction,
    'forward_seconds', c.forward_seconds,
    'screening_result', c.screening_result,
    'stir_attestation', c.stir_attestation,
    'voicemail_seconds', case when c.voicemail_deleted_at is null then c.voicemail_seconds end,
    'voicemail_transcript', case when c.voicemail_deleted_at is null then c.voicemail_transcript end,
    'voicemail_intake', case when c.voicemail_deleted_at is null then c.voicemail_intake end,
    'answered_by_user_id', c.answered_by_user_id,
    'answered_at', c.answered_at,
    'started_at', c.started_at
  )
  from public.calls c
  left join public.contacts ct on ct.id = c.contact_id
  where c.company_id = p_company_id
    and c.deleted_at is null
    and (p_contact_id is null or c.contact_id = p_contact_id)
    and (p_outcome is null or c.outcome = p_outcome)
    and (p_hidden_number_ids is null
         or c.phone_number_id is null
         or not (c.phone_number_id = any (p_hidden_number_ids)))
    and (p_cursor_ts is null
         or (c.started_at, c.id) < (p_cursor_ts, p_cursor_id))
  order by c.started_at desc, c.id desc
  limit greatest(p_limit, 0)
$$;

-- api_contact_timeline (was 20261110150000_standalone_tasks.sql)
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
      and c.deleted_at is null
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
      and k.deleted_at is null
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

-- api_for_you (was 20261110130000_for_you_reads_its_own_workspace.sql)
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
    select c.id, c.status, c.contact_id, c.assigned_user_id, c.last_message_at,
           -- CASE, not AND: for an UNASSIGNED row "assigned_user_id = p_user_id" is
           -- NULL rather than false, and "NULL and x" must still evaluate x to
           -- learn whether the answer is NULL or false. An AND here reads as a
           -- short circuit and measured as none. CASE short-circuits by
           -- definition; the ELSE covers somebody else's row and an unassigned one.
           case when c.assigned_user_id = p_user_id then exists (
             select 1
               from public.messages m
              where m.deleted_at is null and m.conversation_id = c.id
                and (m.sent_by_user_id is null or m.sent_by_user_id <> p_user_id)
                and m.created_at > coalesce(
                  (select r.last_read_at
                     from public.conversation_reads r
                    where r.conversation_id = c.id and r.user_id = p_user_id),
                  '-infinity'::timestamptz)) else false end as unread_mine
    -- #306: every consumer below wants mine, or unassigned. Anything else was
    -- computed and thrown away.
    -- #416: "or unassigned" used to be "or, if you are a lead, unassigned" —
    -- the deepest of the four gates, and the one that made a member's triage
    -- section come back empty rather than absent.
    -- #698: two branches, so each is an exact index condition.
    from (
      select k.id, k.status, k.contact_id, k.assigned_user_id,
             k.last_message_at, k.phone_number_id
        from public.conversations k
       where k.company_id = p_company_id
         and k.is_spam = false
         and k.closed_at is null
         and k.assigned_user_id = p_user_id
      union all
      select k.id, k.status, k.contact_id, k.assigned_user_id,
             k.last_message_at, k.phone_number_id
        from public.conversations k
       where k.company_id = p_company_id
         and k.is_spam = false
         and k.closed_at is null
         and k.assigned_user_id is null
    ) c
    where
      -- #106: conversation sections still hide conversations on hidden numbers.
      (p_hidden_number_ids is null
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
              where m.deleted_at is null and m.conversation_id = p.conversation_id
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
           coalesce(c.id in (select conversation_id from conv_overdue_task), false)
             as has_overdue_task,
           case
             when c.id in (select conversation_id from conv_overdue_task) then 0
             when c.status = 'waiting'            then 1
             when c.unread_mine                   then 2
             else 3
           end as urgency
    from conv c
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
              where m.deleted_at is null and m.conversation_id = p.id
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

-- notification_feed (was 20260730003100_one_notification_definition.sql)
create or replace function public.notification_feed(
  p_company_id        uuid,
  p_user_id           uuid,
  p_hidden_number_ids uuid[] default null
) returns table (
  id              uuid,
  type            text,
  created_at      timestamptz,
  conversation_id uuid,
  message_id      uuid,
  task_id         uuid,
  contact_id      uuid
)
language sql
stable
security definer
set search_path = ''
as $$
    select m.id,
           'inbound_message'::text as type,
           m.created_at,
           m.conversation_id,
           m.id     as message_id,
           null::uuid as task_id,
           c.contact_id
    from public.messages m
    join public.conversations c on c.id = m.conversation_id and c.deleted_at is null
    where m.company_id = p_company_id
      and m.direction = 'inbound'
      and m.deleted_at is null
      and c.assigned_user_id = p_user_id
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
    union all
    select e.id, 'assigned', e.created_at, e.conversation_id,
           null::uuid, null::uuid, c.contact_id
    from public.conversation_events e
    join public.conversations c on c.id = e.conversation_id and c.deleted_at is null
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
    join public.conversations c on c.id = e.conversation_id and c.deleted_at is null
    where e.company_id = p_company_id
      and e.type = 'task_assigned'
      and e.payload->>'to_user_id' = p_user_id::text
      and coalesce(e.actor_user_id, '00000000-0000-0000-0000-000000000000') <> p_user_id
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
    union all
    -- #129: an INBOUND missed call — assignee-else-everyone, like the push.
    select e.id, 'missed_call', e.created_at, e.conversation_id,
           null::uuid, null::uuid, c.contact_id
    from public.conversation_events e
    join public.conversations c on c.id = e.conversation_id and c.deleted_at is null
    where e.company_id = p_company_id
      and e.type = 'call_completed'
      and e.payload->>'outcome' = 'missed'
      and coalesce(e.payload->>'direction', 'inbound') = 'inbound'
      and (c.assigned_user_id is null or c.assigned_user_id = p_user_id)
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
    union all
    -- Named on an internal note. The feed row id is the NOTE's message id, so
    -- notification_read_items (keyed on that id) needs no change. A note body
    -- quotes customer text, so this arm carries the same hidden-number filter
    -- as every other conversation arm, and an author who mentions themselves
    -- is never told about it.
    select m.id, 'mention', m.created_at, m.conversation_id,
           m.id, null::uuid, c.contact_id
    from public.message_mentions mn
    join public.messages m      on m.id = mn.message_id and m.deleted_at is null
    join public.conversations c on c.id = m.conversation_id and c.deleted_at is null
    where mn.company_id = p_company_id
      and mn.user_id = p_user_id
      and m.direction = 'note'
      and m.sent_by_user_id is distinct from p_user_id
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
$$;

-- api_spam_review (was 20260727000400_spam_review.sql)
create or replace function public.api_spam_review(
  p_company_id        uuid,
  p_limit             int default 20,
  p_hidden_number_ids uuid[] default null,
  -- Thresholds as parameters so the tests can pin the behaviour without
  -- waiting three days or sending ten texts.
  p_sustained_days    int default 3,
  p_volume            int default 10
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with marked as (
    select c.id, c.contact_id, c.phone_number_id, c.spam_reviewed_at,
           (select max(e.created_at)
              from public.conversation_events e
             where e.conversation_id = c.id
               and e.type = 'spam_marked') as marked_at,
           (select e.actor_user_id
              from public.conversation_events e
             where e.conversation_id = c.id
               and e.type = 'spam_marked'
             order by e.created_at desc
             limit 1) as marked_by
      from public.conversations c
     where c.company_id = p_company_id
        and c.deleted_at is null
        and c.is_spam
       -- #106: a restricted member must not learn that a hidden number's
       -- conversations exist, review strip included.
       and (p_hidden_number_ids is null
            or c.phone_number_id is null
            or not (c.phone_number_id = any(p_hidden_number_ids)))
  ),
  watermarked as (
    -- Count from the LATER of "when it was marked" and "when someone last
    -- confirmed the mark" — answering the prompt has to mean something.
    select m.*, greatest(m.marked_at, coalesce(m.spam_reviewed_at, m.marked_at)) as since
      from marked m
     where m.marked_at is not null
  ),
  activity as (
    select w.id, w.contact_id, w.marked_at, w.marked_by, w.since,
           count(*) as inbound_since,
           min(msg.created_at) as first_inbound_at,
           max(msg.created_at) as last_inbound_at
      from watermarked w
      join public.messages msg
        on msg.conversation_id = w.id
       and msg.direction = 'inbound'
       and msg.created_at > w.since
     group by w.id, w.contact_id, w.marked_at, w.marked_by, w.since
  ),
  judged as (
    select a.*,
           -- Any outbound to this contact, in any thread, before the mark.
           exists (
             select 1
               from public.messages om
               join public.conversations oc on oc.id = om.conversation_id
              where oc.company_id = p_company_id
                and oc.contact_id = a.contact_id
                and om.direction = 'outbound'
                and om.created_at < a.marked_at
           ) as we_texted_them,
           (a.inbound_since >= 2
            and a.last_inbound_at - a.first_inbound_at
                >= make_interval(days => p_sustained_days)) as sustained,
           (a.inbound_since >= p_volume) as high_volume
      from activity a
  )
  select coalesce(jsonb_agg(row order by rank, last_inbound_at desc), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'conversation_id', j.id,
               'contact', (select jsonb_build_object('id', ct.id, 'name', ct.name,
                                                     'phone_e164', ct.phone_e164)
                             from public.contacts ct where ct.id = j.contact_id),
               'marked_at', j.marked_at,
               'marked_by_user_id', j.marked_by,
               'inbound_since', j.inbound_since,
               -- The REAL latest message time, not the frozen sort key — the
               -- whole reason this thread is invisible is that the two differ.
               'last_inbound_at', j.last_inbound_at,
               'we_texted_them', j.we_texted_them,
               'sustained', j.sustained,
               'high_volume', j.high_volume
             ) as row,
             -- Strongest signal first, so the most-likely mistake is the first
             -- thing read rather than the busiest robotexter.
             case when j.we_texted_them then 0
                  when j.sustained then 1
                  else 2 end as rank,
             j.last_inbound_at
        from judged j
       where j.we_texted_them or j.sustained or j.high_volume
       order by rank, j.last_inbound_at desc
       limit p_limit
    ) ranked
$$;

-- api_bulk_conversations (was 20260810140000_a_bulk_action_cannot_borrow_another_workspaces_ids.sql)
create or replace function public.api_bulk_conversations(
  p_company_id        uuid,
  p_user_id           uuid,
  p_action            text,
  -- Explicit selection. NULL means "use the filter" (select-all-matching).
  p_ids               uuid[]      default null,
  -- The list filter: same names and semantics as api_list_conversations, so
  -- "everything I am looking at" cannot mean something different here.
  p_status            text        default null,
  p_assigned_user_id  uuid        default null,
  p_tag_id            uuid        default null,
  p_is_spam           boolean     default false,
  p_unread            boolean     default false,
  p_q                 text        default null,
  -- Action targets, never reusing a filter parameter.
  p_target_user_id    uuid        default null,
  p_target_tag_id     uuid        default null,
  p_target_status     text        default null,
  p_target_spam       boolean     default null,
  p_hidden_number_ids uuid[]      default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap      int := public.api_bulk_conversation_cap();
  v_matched  int  := 0;
  v_selected uuid[];
  v_applied  jsonb := '[]'::jsonb;
  v_now      timestamptz := now();
begin
  if p_action is null or p_action not in (
    'mark_read', 'set_status', 'assign', 'set_spam', 'add_tag', 'remove_tag'
  ) then
    return jsonb_build_object('error', 'validation_failed');
  end if;

  -- Argument coherence BEFORE anything is selected. An assign with no target
  -- would unassign every matching conversation, and a set_status with no target
  -- would write null — both are plausible client bugs with a large blast radius,
  -- so they fail rather than proceed.
  if p_action = 'set_status'
     and (p_target_status is null
          or p_target_status not in ('new', 'open', 'waiting', 'closed')) then
    return jsonb_build_object('error', 'validation_failed');
  end if;
  if p_action in ('add_tag', 'remove_tag') and p_target_tag_id is null then
    return jsonb_build_object('error', 'validation_failed');
  end if;
  if p_action = 'set_spam' and p_target_spam is null then
    return jsonb_build_object('error', 'validation_failed');
  end if;
  -- `assign` with a null target is legitimate: it means unassign. But it must be
  -- said deliberately, so an explicit selection is required for it — an
  -- unassign-everything-matching-the-filter is not something a UI should be able
  -- to fire by omitting a field.
  if p_action = 'assign' and p_target_user_id is null and p_ids is null then
    return jsonb_build_object('error', 'validation_failed');
  end if;

  -- #572: the tag must be THIS workspace's. Without it, another workspace's tag id
  -- attached that tag to the caller's own conversations and moved its OWNER's tag
  -- counts — and, because #354 derives the pipeline from tags, that workspace's win
  -- rate with them. `tags.company_id` is NOT NULL, so this can only narrow.
  if p_action in ('add_tag', 'remove_tag') then
    perform 1 from public.tags t
     where t.id = p_target_tag_id
       and t.company_id = p_company_id;
    if not found then
      return jsonb_build_object('error', 'validation_failed');
    end if;
  end if;

  -- #572: the assignee must be an active member, which api_bulk_tasks and the
  -- single-row assign already require — this was the one path of three that did
  -- not, so it was a gap rather than a decision. A deactivated ex-teammate's real
  -- user id is visible in timeline `assigned` events, so no guessing was involved.
  --
  -- Refused for the whole call rather than per row, quoting the tasks twin's own
  -- reasoning: applying it to some rows and not others would leave a half-assigned
  -- list nobody asked for.
  if p_action = 'assign' and p_target_user_id is not null then
    perform 1 from public.company_members cm
     where cm.company_id = p_company_id
       and cm.user_id = p_target_user_id
       and cm.deactivated_at is null;
    if not found then
      return jsonb_build_object('error', 'not_member');
    end if;
  end if;

  -- Resolve the selection ONCE, so the access predicate cannot be skipped for one
  -- action. An explicit id list is INTERSECTED with what the actor may see rather
  -- than trusted: an id for a hidden number comes back as failed, not applied.
  select count(*)::int,
         (array_agg(v.id order by v.last_message_at desc nulls last, v.id))[1:v_cap]
    into v_matched, v_selected
    from (
      select c.id, c.last_message_at
      from public.conversations c
      join public.contacts ct on ct.id = c.contact_id
      -- Conversations are not soft-deleted (no deleted_at column) — closing is
      -- the archive, and a closed row is still a row a bulk action may touch.
      where c.company_id = p_company_id
        and c.deleted_at is null
        -- conversations.phone_number_id is NOT NULL, so there is no
        -- "unassigned number" case to let through here — unlike calls, where the
        -- column is nullable and the deny-list check has to allow for it.
        and (
          p_hidden_number_ids is null
          or not (c.phone_number_id = any(p_hidden_number_ids))
        )
        and (p_ids is null or c.id = any(p_ids))
        and (
          -- Filter mode only. With an explicit id list the filter is ignored:
          -- the user pointed at specific rows.
          p_ids is not null
          or (
            (p_status is null or c.status = p_status::public.conversation_status)
            and (p_assigned_user_id is null
                 or c.assigned_user_id = p_assigned_user_id)
            and (coalesce(p_is_spam, false) = coalesce(c.is_spam, false))
            and (
              p_tag_id is null
              or exists (
                select 1 from public.conversation_tags cg
                where cg.conversation_id = c.id and cg.tag_id = p_tag_id
              )
            )
            and (
              not coalesce(p_unread, false)
              or not exists (
                select 1 from public.conversation_reads r
                where r.conversation_id = c.id
                  and r.user_id = p_user_id
                  and r.last_read_at >= c.last_message_at
              )
            )
            and (
              p_q is null
              or ct.name ilike ('%' || p_q || '%')
              or ct.phone_e164 ilike ('%' || p_q || '%')
            )
          )
        )
    ) v;

  v_selected := coalesce(v_selected, '{}'::uuid[]);

  if array_length(v_selected, 1) is null then
    return jsonb_build_object(
      'action', p_action,
      'matched', 0,
      'applied', '[]'::jsonb,
      'failed', public.api_bulk_unreached(p_ids, '{}'::uuid[]),
      'capped', false
    );
  end if;

  -- Apply. Each branch captures the prior value of exactly the field it changes,
  -- BEFORE writing it.
  if p_action = 'mark_read' then
    -- Per-user, so this writes conversation_reads rather than the conversation.
    -- `previous` is empty: the prior state is "unread", which the absence of a
    -- row already expresses, and un-reading a thread in bulk is not a thing
    -- anybody asks for. greatest() keeps a newer read from being walked back.
    insert into public.conversation_reads (conversation_id, user_id, last_read_at)
    select sel.id, p_user_id, v_now from unnest(v_selected) as sel(id)
    on conflict (conversation_id, user_id) do update
      set last_read_at = greatest(
            public.conversation_reads.last_read_at, excluded.last_read_at);

    select coalesce(jsonb_agg(jsonb_build_object(
             'id', sel.id, 'previous', '{}'::jsonb)), '[]'::jsonb)
      into v_applied from unnest(v_selected) as sel(id);

  elsif p_action = 'set_status' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', c.id,
             'previous', jsonb_build_object('status', c.status::text))), '[]'::jsonb)
      into v_applied
      from public.conversations c
      join unnest(v_selected) as sel(id) on sel.id = c.id;

    update public.conversations c
       set status = p_target_status::public.conversation_status,
           updated_at = v_now,
           -- conversations_closed_consistency: status and closed_at move
           -- together, so a bulk close has to stamp it and a bulk reopen has to
           -- clear it. Getting this wrong is a constraint violation that rolls
           -- back the whole batch, which is at least loud.
           closed_at = case when p_target_status = 'closed'
                            then coalesce(c.closed_at, v_now) else null end
      from unnest(v_selected) as sel(id)
     where c.id = sel.id
       and c.status is distinct from p_target_status::public.conversation_status;

  elsif p_action = 'assign' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', c.id,
             'previous', jsonb_build_object(
               'assigned_user_id', c.assigned_user_id))), '[]'::jsonb)
      into v_applied
      from public.conversations c
      join unnest(v_selected) as sel(id) on sel.id = c.id;

    update public.conversations c
       set assigned_user_id = p_target_user_id, updated_at = v_now
      from unnest(v_selected) as sel(id)
     where c.id = sel.id
       and c.assigned_user_id is distinct from p_target_user_id;

  elsif p_action = 'set_spam' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', c.id,
             'previous', jsonb_build_object('is_spam', coalesce(c.is_spam, false))
           )), '[]'::jsonb)
      into v_applied
      from public.conversations c
      join unnest(v_selected) as sel(id) on sel.id = c.id;

    update public.conversations c
       set is_spam = p_target_spam, updated_at = v_now
      from unnest(v_selected) as sel(id)
     where c.id = sel.id
       and coalesce(c.is_spam, false) is distinct from p_target_spam;

  elsif p_action = 'add_tag' then
    -- `previous.had_tag` records whether the tag was ALREADY on the row, so an
    -- undo removes only the ones this operation actually added.
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', sel.id,
             'previous', jsonb_build_object('had_tag', exists (
               select 1 from public.conversation_tags cg
               where cg.conversation_id = sel.id
                 and cg.tag_id = p_target_tag_id
             )))), '[]'::jsonb)
      into v_applied
      from unnest(v_selected) as sel(id);

    insert into public.conversation_tags (conversation_id, tag_id)
    select sel.id, p_target_tag_id from unnest(v_selected) as sel(id)
    on conflict do nothing;

  elsif p_action = 'remove_tag' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', sel.id,
             'previous', jsonb_build_object('had_tag', exists (
               select 1 from public.conversation_tags cg
               where cg.conversation_id = sel.id
                 and cg.tag_id = p_target_tag_id
             )))), '[]'::jsonb)
      into v_applied
      from unnest(v_selected) as sel(id);

    delete from public.conversation_tags cg
     where cg.tag_id = p_target_tag_id
       and cg.conversation_id = any(v_selected);
  end if;

  return jsonb_build_object(
    'action', p_action,
    'matched', v_matched,
    'applied', v_applied,
    'failed', public.api_bulk_unreached(p_ids, v_selected),
    'capped', v_matched > v_cap
  );
end $$;

-- thread_inbound_message (was 20260814020000_an_inbound_message_says_where_it_came_from.sql)
create or replace function public.thread_inbound_message(
  p_company_id        uuid,
  p_phone_number_id   uuid,
  p_from_e164         text,
  p_body              text,
  p_telnyx_message_id text,
  -- #343. All three come from the Worker, which already reads the company row
  -- on this path: the timezone so the day ends when the business's day does,
  -- and the ceilings so they can vary by plan and be overridden per company
  -- without a migration. Defaulted so an older Worker mid-deploy still works —
  -- UTC and the shipped 200 are exactly today's behaviour.
  p_timezone          text default null,
  p_email_limit       int  default 200,
  p_push_limit        int  default 200,
  -- #232: where this message came from. Defaulted, so an older Worker
  -- mid-deploy behaves exactly as it does today.
  p_source            text default 'carrier',
  -- #232: OUR idempotency key, for a message no carrier gave an id to. Ignored
  -- on the carrier path, where the carrier's own id is the key.
  p_idempotency_key   text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact_id uuid;
  v_conv       public.conversations%rowtype;
  v_message    public.messages%rowtype;
  v_created    boolean := true;
  v_notify     boolean := false;
  -- #391: WHICH §8 trigger fired, not just whether one did.
  v_notify_reason text := 'append';
  -- #39/#343 per-company daily notification allowance, now per CHANNEL. The
  -- metered unit is still the CLAIM — one shared counter — because both
  -- channels fire off the same won claim, and two counters could drift apart
  -- in ways nobody could reason about. Each channel compares that count
  -- against its own ceiling and owns its own 80/100 stamps.
  v_notify_day    date;
  v_notify_count  int;
  v_email_warned  timestamptz;
  v_email_capped  timestamptz;
  v_push_warned   timestamptz;
  v_push_capped   timestamptz;
  v_notify_email  boolean := false;
  v_notify_push   boolean := false;
  v_alerts        jsonb := '[]'::jsonb;
  v_alert         int; -- legacy scalar: the EMAIL crossing, for back-compat
begin
  if p_company_id is null or p_phone_number_id is null then
    raise exception 'thread_inbound_message: company and phone number are required';
  end if;
  if p_source not in ('carrier', 'widget') then
    raise exception 'thread_inbound_message: unknown source %', p_source;
  end if;
  -- The carrier id is required OF THE CARRIER. It was never a schema rule —
  -- `telnyx_message_id` is nullable and a note has none — it was an assumption
  -- inside this function about the only caller it had ever had.
  if p_source = 'carrier'
     and (p_telnyx_message_id is null or length(trim(p_telnyx_message_id)) = 0) then
    raise exception 'thread_inbound_message: telnyx_message_id is required';
  end if;
  -- A message with no carrier id still needs ONE key that makes a replay a
  -- no-op, or a visitor pressing submit twice opens two threads.
  if p_source = 'widget'
     and (p_idempotency_key is null or length(trim(p_idempotency_key)) = 0) then
    raise exception 'thread_inbound_message: a widget message needs an idempotency key';
  end if;
  if p_from_e164 is null or length(trim(p_from_e164)) = 0 then
    raise exception 'thread_inbound_message: from number is required';
  end if;

  -- Duplicate-webhook fast path (Telnyx retries up to 6 times, §7): the first
  -- delivery owns every side effect, including the notification claim.
  select m.* into v_message
    from public.messages m
   where (p_source = 'carrier' and m.telnyx_message_id = p_telnyx_message_id)
      or (p_source = 'widget'  and m.idempotency_key   = p_idempotency_key);
  if found then
    return jsonb_build_object(
      'message_id', v_message.id,
      'conversation_id', v_message.conversation_id,
      'created', false,
      'notify', false,
      'notification_alert', null,
      'opted_out', exists (
        select 1 from public.opt_outs o
         where o.company_id = p_company_id
           and o.phone_e164 = p_from_e164
           and o.revoked_at is null));
  end if;

  -- The receiving number must belong to the company (caller resolved it from
  -- the webhook's "to" number; this guards against a mismatched pair).
  perform 1 from public.phone_numbers n
   where n.id = p_phone_number_id and n.company_id = p_company_id;
  if not found then
    raise exception 'thread_inbound_message: phone number % does not belong to company %',
      p_phone_number_id, p_company_id;
  end if;

  -- #291: is this one of an EXISTING contact's other numbers?
  --
  -- Checked before the upsert, because the upsert would otherwise create a
  -- second contact for the same customer — which is precisely the duplicate
  -- #246 then has to merge. A crew that recorded "Dave's landline" and then
  -- got a text from it would watch the app fail to recognise a number they
  -- had just told it about.
  select cp.contact_id into v_contact_id
    from public.contact_phones cp
   where cp.company_id = p_company_id
     and cp.phone_e164 = p_from_e164;

  if v_contact_id is not null then
    -- The same two facts the upsert stamps, because an inbound text is
    -- consent and a resurrection whichever of their numbers it came from.
    update public.contacts
       set deleted_at     = null,
           -- `coalesce`, so an existing consent record is never overwritten: a
           -- customer who already gave express consent does not lose it by
           -- texting later, and one who texted first does not have it upgraded
           -- by a form somebody else filled in.
           consent_source = coalesce(
             consent_source,
             case when p_source = 'widget' then 'widget_form' else 'inbound_sms' end::public.consent_source_t),
           consent_at     = coalesce(consent_at, now())
     where id = v_contact_id;
  else
    -- Rule 1: contact upsert — clears deleted_at, stamps inbound consent once.
    -- #232: the consent source has to match how consent was actually given.
    -- A widget visitor did not text us — recording `inbound_sms` would file an
    -- EXPRESS web-form opt-in as the weakest kind the rules recognise, in the
    -- one record that exists to answer that question.
    insert into public.contacts as ct (company_id, phone_e164, consent_source, consent_at)
    values (
      p_company_id, p_from_e164,
      case when p_source = 'widget' then 'widget_form' else 'inbound_sms' end::public.consent_source_t,
      now())
    on conflict (company_id, phone_e164) do update
      set deleted_at     = null,
          consent_source = coalesce(ct.consent_source, excluded.consent_source),
          consent_at     = coalesce(ct.consent_at, excluded.consent_at)
    returning ct.id into v_contact_id;
  end if;

  -- Rule 2: open conversation for the triple → append (waiting → open).
  select c.* into v_conv
    from public.conversations c
   where c.company_id = p_company_id
     and c.phone_number_id = p_phone_number_id
     and c.contact_id = v_contact_id
     and c.contact_phone_e164 = p_from_e164
     and c.closed_at is null
   for update;

  if found then
    if v_conv.status = 'waiting' then
      update public.conversations set status = 'open' where id = v_conv.id;
    end if;
    -- §8 gate on an append: first inbound after ≥15 min, by last_notified_at.
    v_notify := not v_conv.is_spam
      and (v_conv.last_notified_at is null
           or v_conv.last_notified_at < now() - interval '15 minutes');
  else
    -- Rules 3/4: most recent closed conversation for the triple.
    select c.* into v_conv
      from public.conversations c
     where c.company_id = p_company_id
       and c.phone_number_id = p_phone_number_id
       and c.contact_id = v_contact_id
     and c.contact_phone_e164 = p_from_e164
       and c.closed_at is not null
       and c.deleted_at is null
     order by c.closed_at desc
     limit 1
     for update;

    if found and v_conv.is_spam then
      -- Rule 3: spam absorb — append silently; stays closed, stays spam,
      -- NEVER notifies (§8).
      v_notify := false;
    elsif found and v_conv.closed_at >= now() - interval '30 days' then
      -- Rule 4: reopen within the 30-day window — "reopened by inbound" is a
      -- §8 trigger in its own right.
      update public.conversations
         set status = 'new', closed_at = null
       where id = v_conv.id
      returning * into v_conv;
      v_notify := true;
      v_notify_reason := 'reopened';
    else
      -- Rule 5: create a new conversation; on a concurrent create the partial
      -- unique index wins the race and the open row is re-selected.
      insert into public.conversations
        (company_id, contact_id, phone_number_id, contact_phone_e164, status,
         -- #232: FIRST TOUCH, set here and nowhere else. A website visitor who
         -- later replies by text is still a website lead, so this is written
         -- when the conversation is created and never updated.
         first_source)
      values (p_company_id, v_contact_id, p_phone_number_id, p_from_e164, 'new',
              p_source)
      -- The arbiter has to name the index EXACTLY. Left at the old three
      -- columns it would match no index and raise, turning every first inbound
      -- from a customer into a 500.
      on conflict (company_id, phone_number_id, contact_id, contact_phone_e164)
        where closed_at is null
      do nothing
      returning * into v_conv;

      if v_conv.id is null then
        select c.* into v_conv
          from public.conversations c
         where c.company_id = p_company_id
           and c.phone_number_id = p_phone_number_id
           and c.contact_id = v_contact_id
     and c.contact_phone_e164 = p_from_e164
           and c.closed_at is null
         for update;
        if not found then
          raise exception 'thread_inbound_message: lost conversation race for company %', p_company_id;
        end if;
        -- Lost the creation race: the winner notified for the "new
        -- conversation" trigger; this delivery is an append under the gate.
        v_notify := not v_conv.is_spam
          and (v_conv.last_notified_at is null
               or v_conv.last_notified_at < now() - interval '15 minutes');
      else
        -- A new conversation is a §8 trigger.
        v_notify := true;
        v_notify_reason := 'new';
      end if;
    end if;
  end if;

  -- Message insert, idempotent on messages_telnyx_id_uq (D7).
  insert into public.messages
    (company_id, conversation_id, direction, body, status, telnyx_message_id,
     source, idempotency_key)
  values
    (p_company_id, v_conv.id, 'inbound', coalesce(p_body, ''), 'received',
     case when p_source = 'carrier' then p_telnyx_message_id end,
     p_source,
     case when p_source = 'widget' then p_idempotency_key end)
  on conflict (telnyx_message_id) where telnyx_message_id is not null
  do nothing
  returning * into v_message;

  if v_message.id is null then
    -- A concurrent duplicate committed first: report its row, bump nothing,
    -- claim nothing — the winner owns the side effects.
    v_created := false;
    v_notify := false;
    select m.* into v_message
      from public.messages m
     where (p_source = 'carrier' and m.telnyx_message_id = p_telnyx_message_id)
      or (p_source = 'widget'  and m.idempotency_key   = p_idempotency_key);
  else
    -- #49: last_message_at is the list surfacing/sort key, so a spam append
    -- (rule 3 "append silently") must NEVER bump it — the spam thread stays
    -- where it was in the closed/spam list, and keyset pages don't shift under
    -- a paginating client. Checked on the live row (held FOR UPDATE above),
    -- so an open-but-spam conversation is frozen too.
    update public.conversations
       set last_message_at = greatest(last_message_at, v_message.created_at)
     where id = v_conv.id
       and not is_spam;
  end if;

  -- #39/#343 budget spend: a won claim consumes one unit of the company's
  -- daily allowance. The upsert's row lock serializes concurrent claims, so
  -- the count, the drops, and the one-shot stamps can never race. Past a
  -- channel's ceiling that channel is DROPPED (never queued) — the message
  -- above is already durable; only the alert fan-out is shed.
  if v_notify then
    -- #343: the business's day, not UTC's. Keying on a UTC date meant the
    -- counter reset at 5pm in Vancouver and 9pm in Halifax — mid-afternoon in
    -- the busiest stretch of a trades day, and never at an hour that matched
    -- anyone's working day. An unknown zone falls back to UTC rather than
    -- raising: this runs inside the inbound webhook, and a bad timezone must
    -- not wedge threading for every message the company receives.
    begin
      v_notify_day := (now() at time zone coalesce(p_timezone, 'utc'))::date;
    exception when invalid_parameter_value or undefined_object then
      v_notify_day := (now() at time zone 'utc')::date;
    end;

    insert into public.inbound_notification_days as d
      (company_id, day, notify_count, email_limit, push_limit)
    values (p_company_id, v_notify_day, 1, p_email_limit, p_push_limit)
    on conflict (company_id, day) do update
      -- Re-stamped every claim: a limit changed mid-day takes effect at once,
      -- which is the whole point of making it runtime-configurable.
      set notify_count = d.notify_count + 1,
          email_limit  = excluded.email_limit,
          push_limit   = excluded.push_limit
    returning d.notify_count, d.email_warned_at, d.email_capped_at,
              d.push_warned_at, d.push_capped_at
      into v_notify_count, v_email_warned, v_email_capped,
           v_push_warned, v_push_capped;

    -- EMAIL ladder.
    if v_notify_count >= p_email_limit and v_email_capped is null then
      update public.inbound_notification_days set email_capped_at = now()
       where company_id = p_company_id and day = v_notify_day;
      v_alerts := v_alerts || jsonb_build_object('channel', 'email', 'threshold', 100);
      v_alert := 100;
    elsif v_notify_count >= (p_email_limit * 8 / 10) and v_email_warned is null then
      update public.inbound_notification_days set email_warned_at = now()
       where company_id = p_company_id and day = v_notify_day;
      v_alerts := v_alerts || jsonb_build_object('channel', 'email', 'threshold', 80);
      v_alert := 80;
    end if;

    -- PUSH ladder, against its own much higher ceiling. Push is free at both
    -- ends (Web Push and FCM charge nothing); its cap is a runaway guard, not
    -- a budget, so a workspace that exhausts email keeps getting notified.
    if v_notify_count >= p_push_limit and v_push_capped is null then
      update public.inbound_notification_days set push_capped_at = now()
       where company_id = p_company_id and day = v_notify_day;
      v_alerts := v_alerts || jsonb_build_object('channel', 'push', 'threshold', 100);
    elsif v_notify_count >= (p_push_limit * 8 / 10) and v_push_warned is null then
      update public.inbound_notification_days set push_warned_at = now()
       where company_id = p_company_id and day = v_notify_day;
      v_alerts := v_alerts || jsonb_build_object('channel', 'push', 'threshold', 80);
    end if;

    -- The ceiling-th claim itself still delivers (and carries the 100 alert);
    -- everything past it drops. last_notified_at is deliberately NOT stamped
    -- for a fully dropped claim, so dropped claims keep being counted.
    v_notify_email := v_notify_count <= p_email_limit;
    v_notify_push  := v_notify_count <= p_push_limit;
    v_notify := v_notify_email or v_notify_push;
  end if;

  -- §8: "notify only if …, THEN STAMP IT" — the stamp commits with the
  -- threading transaction, so the claim is exactly-once per debounce window.
  if v_notify then
    update public.conversations
       set last_notified_at = now()
     where id = v_conv.id;
  end if;

  return jsonb_build_object(
    'message_id', v_message.id,
    'conversation_id', v_message.conversation_id,
    'created', v_created,
    -- Legacy scalar = the EMAIL verdict, deliberately. A Worker still running
    -- mid-deploy reads only `notify`; making it the email answer means it can
    -- under-deliver free push, and can never over-spend metered email.
    'notify', v_notify_email,
    'notify_email', v_notify_email,
    'notify_push', v_notify_push,
    -- #391: 'new' | 'reopened' | 'append'. A first inbound on a new or
    -- reopened thread is a LEAD and the push must wake a phone in Doze; an
    -- append to a thread somebody is already working is not worth the battery.
    'notify_reason', v_notify_reason,
    'notification_alert', v_alert,
    'notification_alerts', v_alerts,
    'opted_out', exists (
      select 1 from public.opt_outs o
       where o.company_id = p_company_id
         and o.phone_e164 = p_from_e164
         and o.revoked_at is null));
end $$;

-- claim_missed_call_text (was 20260805060000_paid_pause.sql)
create or replace function public.claim_missed_call_text(
  p_company_id        uuid,
  p_phone_number_id   uuid,
  p_caller_e164       text,
  p_call_id           text,
  p_body              text,
  p_segments_estimate int,
  p_throttle_seconds  int
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_block       text;
  v_company     public.companies%rowtype;
  v_contact_id  uuid;
  v_conv        public.conversations%rowtype;
  v_created_conv boolean := false;
  v_last_auto   timestamptz;
  v_message     public.messages%rowtype;
  v_now         timestamptz := now();
  v_prior_payload jsonb;
  v_prior_conv    uuid;
  v_spend_err   text;
begin
  if p_caller_e164 is null or length(trim(p_caller_e164)) = 0
     or p_call_id is null or length(trim(p_call_id)) = 0
     or p_body is null or length(trim(p_body)) = 0
     or p_segments_estimate is null or p_segments_estimate < 1
     or p_throttle_seconds is null or p_throttle_seconds < 0 then
    return jsonb_build_object('skipped', 'not_found');
  end if;

  -- Serialize this company's sends (same lock discipline as gate_outbound_send /
  -- claim_auto_reply) — the per-call idempotency read-check-insert and the
  -- throttle read-check-stamp are atomic against a concurrent retried webhook.
  select c.* into v_company
    from public.companies c
   where c.id = p_company_id
   for update;
  if not found then
    return jsonb_build_object('skipped', 'not_found');
  end if;

  -- The receiving number must belong to the company (caller resolved it from
  -- the webhook's "to" number; guard against a mismatched pair).
  perform 1 from public.phone_numbers n
   where n.id = p_phone_number_id and n.company_id = p_company_id;
  if not found then
    return jsonb_build_object('skipped', 'not_found');
  end if;

  -- (3) #277 pause: the reasons this workspace may not send, asked ONCE.
  --
  -- This was `subscription_status <> 'active' or plan is null`, inline. A
  -- paused workspace is genuinely `active` in Stripe — the pause is a
  -- licensed-PRICE swap, so the status mirror stays truthful — which means
  -- that test passed for a workspace that is paying us a holding fee, and
  -- this backstop quietly stopped being one.
  v_block := public.company_send_block(v_company);
  if v_block is not null then
    return jsonb_build_object('skipped', v_block);
  end if;

  -- (0) Per-call idempotency FIRST — before any threading write, so a replayed
  -- webhook has ZERO side effects (no contact un-delete, no waiting→open flip,
  -- no resurrection of a conversation the crew closed since). Company-wide by
  -- call_id (the conversation is not resolved yet). Checked under the company
  -- lock, so concurrent retries serialize and exactly one wins.
  --
  -- Replay-heal: when the prior claim's text NEVER reached Telnyx (a crash or
  -- a rate-limit throw landed between claim and dispatch — the row is still
  -- 'queued', or 'failed' with no telnyx_message_id, i.e. §7-retryable), hand
  -- the SAME row back (replayed=true) so the sweeper's replay re-dispatches it
  -- instead of stranding it. A row Telnyx already accepted returns 'duplicate'
  -- — the double-text guard is the telnyx_message_id, not the event alone.
  select e.payload, e.conversation_id into v_prior_payload, v_prior_conv
    from public.conversation_events e
   where e.company_id = p_company_id
     and e.type = 'missed_call'
     and e.payload->>'call_id' = p_call_id
   limit 1;
  if found then
    select m.* into v_message
      from public.messages m
     where m.id = (v_prior_payload->>'message_id')::uuid
       and m.company_id = p_company_id;
    if found
       and v_message.telnyx_message_id is null
       and v_message.status in ('queued', 'failed') then
      return jsonb_build_object(
        'message', to_jsonb(v_message) - 'body_tsv',
        'conversation_id', v_prior_conv,
        'created_conversation', false,
        'replayed', true);
    end if;
    return jsonb_build_object('skipped', 'duplicate');
  end if;

  -- (1) Thread the caller: contact upsert (clears deleted_at, stamps inbound
  -- consent once — a missed call is inbound contact, §5), then find-or-reopen-
  -- or-create the conversation for the triple (D7 threading rules 2/4/5; a
  -- missed call never lands in a spam-absorb thread — it just texts back).
  -- #291: one of an EXISTING contact's other numbers?
  select cp.contact_id into v_contact_id
    from public.contact_phones cp
   where cp.company_id = p_company_id
     and cp.phone_e164 = p_caller_e164;

  if v_contact_id is not null then
    update public.contacts
       set deleted_at     = null,
           consent_source = coalesce(consent_source, 'inbound_sms'),
           consent_at     = coalesce(consent_at, v_now)
     where id = v_contact_id;
  else
    insert into public.contacts as ct (company_id, phone_e164, consent_source, consent_at)
    values (p_company_id, p_caller_e164, 'inbound_sms', v_now)
    on conflict (company_id, phone_e164) do update
      set deleted_at     = null,
          consent_source = coalesce(ct.consent_source, excluded.consent_source),
          consent_at     = coalesce(ct.consent_at, excluded.consent_at)
    returning ct.id into v_contact_id;
  end if;

  -- Rule 2: open conversation for the triple → use it (waiting → open flip).
  select conv.* into v_conv
    from public.conversations conv
   where conv.company_id = p_company_id
     and conv.phone_number_id = p_phone_number_id
     and conv.contact_id = v_contact_id
     and conv.contact_phone_e164 = p_caller_e164
     and conv.closed_at is null
   for update;

  if found then
    if v_conv.status = 'waiting' then
      update public.conversations set status = 'open' where id = v_conv.id;
    end if;
  else
    -- Rule 4: reopen the most recent closed (non-spam) conversation within 30d,
    -- else Rule 5: create a fresh one. (A spam thread is left alone; the missed
    -- call opens a new conversation rather than resurrecting a spam thread.)
    select conv.* into v_conv
      from public.conversations conv
     where conv.company_id = p_company_id
       and conv.phone_number_id = p_phone_number_id
       and conv.contact_id = v_contact_id
     and conv.contact_phone_e164 = p_caller_e164
       and conv.closed_at is not null
       and conv.deleted_at is null
       and not conv.is_spam
     order by conv.closed_at desc
     limit 1
     for update;

    if found and v_conv.closed_at >= v_now - interval '30 days' then
      update public.conversations
         set status = 'new', closed_at = null
       where id = v_conv.id
      returning * into v_conv;
    else
      insert into public.conversations
        (company_id, contact_id, phone_number_id, contact_phone_e164, status)
      values (p_company_id, v_contact_id, p_phone_number_id, p_caller_e164, 'new')
      on conflict (company_id, phone_number_id, contact_id, contact_phone_e164)
        where closed_at is null
      do nothing
      returning * into v_conv;

      if v_conv.id is null then
        -- Lost the create race: re-select the open row a concurrent thread made.
        select conv.* into v_conv
          from public.conversations conv
         where conv.company_id = p_company_id
           and conv.phone_number_id = p_phone_number_id
           and conv.contact_id = v_contact_id
     and conv.contact_phone_e164 = p_caller_e164
           and conv.closed_at is null
         for update;
        if not found then
          raise exception 'claim_missed_call_text: lost conversation race for company %', p_company_id;
        end if;
      else
        v_created_conv := true;
      end if;
    end if;
  end if;

  -- (2) Opt-out mirror — never text an opted-out caller.
  if exists (select 1 from public.opt_outs o
              where o.company_id = p_company_id
                and o.phone_e164 = p_caller_e164
                and o.revoked_at is null) then
    return jsonb_build_object('skipped', 'recipient_opted_out');
  end if;

  -- (4) Throttle — one auto-text per conversation per window (shared with the
  -- away-reply guard via conversations.last_auto_reply_at).
  select conv.last_auto_reply_at into v_last_auto
    from public.conversations conv where conv.id = v_conv.id;
  if v_last_auto is not null
     and v_last_auto > v_now - make_interval(secs => p_throttle_seconds) then
    return jsonb_build_object('skipped', 'throttled');
  end if;

  -- (5) #12 Phase 0: respect the same rate limit + overage cap as a manual send
  -- (mirrors claim_auto_reply). An over-cap / rate-limited booking text is
  -- SKIPPED (no spend) — same 'skipped' codes gate_outbound_send returns. The
  -- threading above already ran, but no OUTBOUND row / dispatch / throttle stamp
  -- / audit happens, so nothing is billed.
  v_spend_err := public.outbound_spend_check(p_company_id, p_segments_estimate);
  if v_spend_err is not null then
    return jsonb_build_object('skipped', v_spend_err);
  end if;

  -- Insert the queued booking-forward SMS BEFORE the Telnyx call (§8). No
  -- idempotency key: the per-call event + the conversation throttle stamp ARE
  -- the anti-duplicate guard. Attributed to the OWNER (owner-authored message),
  -- so the messages_outbound_actor CHECK (outbound must carry a sent_by) holds.
  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments,
     sent_by_user_id)
  values
    (p_company_id, v_conv.id, 'outbound', p_body, 'queued',
     p_segments_estimate, v_company.owner_user_id)
  returning * into v_message;

  update public.conversations
     set last_auto_reply_at = v_now,
         last_message_at     = greatest(last_message_at, v_message.created_at)
   where id = v_conv.id;

  -- Audit — the crew sees the missed call + the machine's booking text. The
  -- call_id in the payload is the idempotency key checked above.
  insert into public.conversation_events
    (company_id, conversation_id, actor_user_id, type, payload)
  values
    (p_company_id, v_conv.id, null, 'missed_call',
     jsonb_build_object('call_id', p_call_id, 'message_id', v_message.id,
                        'caller', p_caller_e164));

  return jsonb_build_object(
    'message', to_jsonb(v_message) - 'body_tsv',
    'conversation_id', v_conv.id,
    'created_conversation', v_created_conv);
end $$;

-- api_thread_call (was 20260804120000_contact_phones.sql)
create or replace function public.api_thread_call(
  p_company_id       uuid,
  p_phone_number_id  uuid,
  p_caller_e164      text,
  p_call_session_id  text,
  p_outcome          text,
  p_forward_seconds  int,
  p_create_if_missing boolean,
  p_direction        text default 'inbound'
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now        timestamptz := now();
  v_contact_id uuid;
  v_conv       public.conversations%rowtype;
  v_inserted   boolean := false;
begin
  if p_caller_e164 is null or length(p_caller_e164) = 0 then
    return '{}'::jsonb;
  end if;

  -- #291: one of an EXISTING contact's other numbers? Asked BEFORE the
  -- create branch, so a call from a landline the crew recorded resolves to the
  -- customer it belongs to even on the paths that may not create a contact.
  select cp.contact_id into v_contact_id
    from public.contact_phones cp
   where cp.company_id = p_company_id
     and cp.phone_e164 = p_caller_e164;

  if v_contact_id is not null then
    -- A call is inbound contact, the same as a text: clear the soft delete and
    -- stamp consent once, whichever of their numbers it came from.
    update public.contacts
       set deleted_at     = null,
           consent_source = coalesce(consent_source, 'inbound_sms'),
           consent_at     = coalesce(consent_at, v_now)
     where id = v_contact_id;
  elsif p_create_if_missing then
    insert into public.contacts as ct (company_id, phone_e164, consent_source, consent_at)
    values (p_company_id, p_caller_e164, 'inbound_sms', v_now)
    on conflict (company_id, phone_e164) do update
      set deleted_at     = null,
          consent_source = coalesce(ct.consent_source, excluded.consent_source),
          consent_at     = coalesce(ct.consent_at, excluded.consent_at)
    returning ct.id into v_contact_id;
  else
    select ct.id into v_contact_id
      from public.contacts ct
     where ct.company_id = p_company_id
       and ct.phone_e164 = p_caller_e164
       and ct.deleted_at is null;
    if not found then
      return '{}'::jsonb;
    end if;
  end if;

  select conv.* into v_conv
    from public.conversations conv
   where conv.company_id = p_company_id
     and conv.phone_number_id = p_phone_number_id
     and conv.contact_id = v_contact_id
     and conv.closed_at is null
   for update;

  if not found then
    if not p_create_if_missing then
      return '{}'::jsonb;
    end if;

    select conv.* into v_conv
      from public.conversations conv
     where conv.company_id = p_company_id
       and conv.phone_number_id = p_phone_number_id
       and conv.contact_id = v_contact_id
       and conv.contact_phone_e164 = p_caller_e164
       and conv.closed_at is not null
       and conv.deleted_at is null
       and not conv.is_spam
     order by conv.closed_at desc
     limit 1
     for update;

    if found and v_conv.closed_at >= v_now - interval '30 days' then
      update public.conversations
         set status = 'new', closed_at = null
       where id = v_conv.id
      returning * into v_conv;
    else
      insert into public.conversations
        (company_id, contact_id, phone_number_id, contact_phone_e164, status)
      values (p_company_id, v_contact_id, p_phone_number_id, p_caller_e164, 'new')
      -- The arbiter names the index exactly; the old three columns match no
      -- index now and would raise on every first call from a customer.
      on conflict (company_id, phone_number_id, contact_id, contact_phone_e164)
        where closed_at is null
      do nothing
      returning * into v_conv;

      if v_conv.id is null then
        select conv.* into v_conv
          from public.conversations conv
         where conv.company_id = p_company_id
           and conv.phone_number_id = p_phone_number_id
           and conv.contact_id = v_contact_id
       and conv.contact_phone_e164 = p_caller_e164
           and conv.closed_at is null
         for update;
        if not found then
          raise exception 'api_thread_call: lost conversation race for company %', p_company_id;
        end if;
      end if;
    end if;
  end if;

  if not exists (
    select 1 from public.conversation_events e
     where e.company_id = p_company_id
       and e.conversation_id = v_conv.id
       and e.type = 'call_completed'
       and e.payload->>'call_session_id' = p_call_session_id
  ) then
    insert into public.conversation_events
      (company_id, conversation_id, actor_user_id, type, payload)
    values
      (p_company_id, v_conv.id, null, 'call_completed',
       jsonb_build_object(
         'call_session_id', p_call_session_id,
         'outcome', p_outcome,
         'forward_seconds', coalesce(p_forward_seconds, 0),
         'caller', p_caller_e164,
         'direction', coalesce(nullif(p_direction, ''), 'inbound')));
    update public.conversations
       set last_message_at = greatest(coalesce(last_message_at, v_now), v_now)
     where id = v_conv.id;
    v_inserted := true;
  end if;

  return jsonb_build_object(
    'contact_id', v_contact_id,
    'conversation_id', v_conv.id,
    'event_inserted', v_inserted);
end;
$$;

-- calendar_task_access_allowed (was 20261110150000_standalone_tasks.sql)
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
              and c.deleted_at is null
              and public.member_number_level(p_user_id, c.phone_number_id)
                  is distinct from 'none'))
  );
$$;
