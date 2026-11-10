-- #691 follow-up: a purged task also loses its job address and map position.
--
-- The address on a job is the customer's address, copied from the thread or the
-- contact. Blanking it takes the task off the map as well (no address, no pin).
-- The address history lines are already scrubbed by the same statement that
-- scrubs title and description.

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
           title = 'Removed', description = '',
           addr_street = null, addr_unit = null, addr_city = null,
           addr_state = null, addr_postal_code = null, addr_country = null,
           addr_provenance = null, lat = null, lng = null, geocoded_at = null,
           geocode_status = 'no_address'
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
