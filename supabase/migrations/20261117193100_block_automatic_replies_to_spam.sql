do $migration$
declare
  v_function regprocedure;
  v_definition text;
  v_updated text;
begin
  foreach v_function in array array[
    'public.claim_auto_reply(uuid, uuid, text, integer, integer, text)'::regprocedure,
    'public.claim_emergency_ack(uuid, uuid, text, integer, integer, integer, boolean)'::regprocedure
  ] loop
    v_definition := pg_get_functiondef(v_function);
    v_updated := replace(
      v_definition,
      '     and conv.company_id = p_company_id
   for update of conv;',
      '     and conv.company_id = p_company_id
     and not conv.is_spam
   for update of conv;'
    );
    if v_function = 'public.claim_auto_reply(uuid, uuid, text, integer, integer, text)'::regprocedure then
      v_updated := replace(
        v_updated,
        '     and not conv.is_spam',
        '     and not conv.is_spam
     and (p_automation <> ''away_reply'' or conv.opt_out_hint_at is null)'
      );
    end if;
    if v_updated = v_definition then
      raise exception '%: conversation lock was not found', v_function;
    end if;
    execute v_updated;
  end loop;

  v_definition := pg_get_functiondef(
    'public.claim_missed_call_text(uuid, uuid, text, text, text, integer, integer)'::regprocedure
  );
  v_updated := replace(
    v_definition,
    '  select e.payload, e.conversation_id into v_prior_payload, v_prior_conv',
    '  perform 1 from public.conversations
   where company_id = p_company_id
     and contact_phone_e164 = p_caller_e164
     and deleted_at is null
     and opt_out_hint_at is not null
   limit 1
   for update;
  if found then
    return jsonb_build_object(''skipped'', ''opt_out_unresolved'');
  end if;

  select e.payload, e.conversation_id into v_prior_payload, v_prior_conv'
  );
  if v_updated = v_definition then
    raise exception 'claim_missed_call_text: prior claim lookup was not found';
  end if;
  execute v_updated;

  v_definition := pg_get_functiondef(
    'public.claim_message_retry(uuid, uuid, integer)'::regprocedure
  );
  v_updated := replace(
    v_definition,
    '  select ct.phone_e164 into v_dest_phone
    from public.conversations conv
    join public.contacts ct on ct.id = conv.contact_id',
    '  select conv.contact_phone_e164 into v_dest_phone
    from public.conversations conv'
  );
  if v_updated = v_definition then
    raise exception 'claim_message_retry: destination lookup was not found';
  end if;
  v_definition := v_updated;
  v_updated := replace(
    v_definition,
    '  if v_message.status = ''queued'' then',
    '  if v_message.automated and exists (
    select 1 from public.conversations c
     where c.company_id = p_company_id
       and c.contact_phone_e164 = v_dest_phone
       and c.deleted_at is null
       and c.opt_out_hint_at is not null
  ) then
    return jsonb_build_object(''error'', ''opt_out_unresolved'');
  end if;

  if v_message.status = ''queued'' then'
  );
  if v_updated = v_definition then
    raise exception 'claim_message_retry: queued status check was not found';
  end if;
  v_definition := v_updated;
  v_updated := replace(
    v_definition,
    'error_code = null, error_detail = null',
    'error_code = null, error_detail = null, error_reason = null'
  );
  if v_updated = v_definition then
    raise exception 'claim_message_retry: retry status update was not found';
  end if;
  execute v_updated;
end $migration$;
