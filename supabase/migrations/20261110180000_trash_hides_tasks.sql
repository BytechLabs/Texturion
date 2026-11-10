-- #691 follow-up: a trashed conversation's tasks leave with it, and a purge also
-- erases what hangs off those tasks (comments, comment files, history text).
--
-- A soft delete on the task rather than a new filter on each task read: every
-- task view (list, detail, search, For You, map, contact timeline) and the
-- calendar already treat a deleted task as gone, so the thread's jobs disappear
-- everywhere at once, and the existing task triggers pull them off the calendar.
-- `trashed_with_conversation_at` is the stamp restore matches on, so a task the
-- crew deleted on its own is never brought back by restoring the thread.
--
-- The purge keeps task_events rows and nulls the text they carry. task_events and
-- task_comments cascade from tasks and the tasks stay (tombstoned), so no restrict
-- foreign key is involved.

alter table public.tasks
  add column if not exists trashed_with_conversation_at timestamptz;

comment on column public.tasks.trashed_with_conversation_at is
  '#691: deleted_at was set because its conversation went to the Trash, at this instant. Restore of that conversation brings back exactly these.';

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

  -- The thread's jobs leave every task view and the calendar with it: a soft
  -- delete, stamped so restore can tell them from a task somebody deleted.
  perform set_config('loonext.task_actor', coalesce(p_user_id::text, ''), true);
  update public.tasks t
     set deleted_at = v_now, trashed_with_conversation_at = v_now
   where t.conversation_id = any (v_ids)
     and t.deleted_at is null;

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

    -- Its jobs come back, and the history line saying they were deleted goes: they
    -- were hidden, not deleted.
    delete from public.task_events e
     using public.tasks t
     where e.task_id = t.id
       and t.conversation_id = v_conv.id
       and t.trashed_with_conversation_at = v_stamp
       and e.kind = 'deleted'
       and e.created_at = v_stamp;
    update public.tasks
       set deleted_at = null, trashed_with_conversation_at = null
     where conversation_id = v_conv.id
       and trashed_with_conversation_at = v_stamp;

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
                or (a.owner_type = 'task_comment' and a.owner_id in (
                    select k.id from public.task_comments k
                     where k.task_id in (
                       select t.id from public.tasks t
                        where t.message_id = any (v_msgs)
                           or t.source_call_id = any (v_calls)
                           or (v_conv is not null and p_kind = 'conversation'
                               and t.conversation_id = v_conv))))
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
          or (a.owner_type = 'task_comment' and a.owner_id in (
                select k.id from public.task_comments k
                 where k.task_id = any (v_tasks)))
          or (p_kind = 'conversation' and a.conversation_id = v_conv));

  if not v_vm_only then
    delete from public.message_attachments where message_id = any (v_msgs);
    delete from public.message_mentions where message_id = any (v_msgs);
    delete from public.attachments where id = any (v_att);
    delete from public.task_comments where task_id = any (v_tasks);
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
    -- The history keeps its rows and loses the words: a title, a description or an
    -- address change carries the text that was copied from the content (and the
    -- two lines above just wrote one more).
    update public.task_events
       set from_value = null, to_value = null
     where task_id = any (v_tasks)
       and kind in ('created', 'title', 'description', 'address');
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
