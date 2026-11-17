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
    'public.claim_message_retry(uuid, uuid, integer)'::regprocedure
  );
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
