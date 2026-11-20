do $migration$
declare
  definition text := pg_get_functiondef(
    'public.claim_auto_reply(uuid, uuid, text, integer, integer, text)'::regprocedure);
  updated text;
begin
  -- An away reply or an English HELP must leave room for a French AIDE.
  updated := replace(definition,
$old$  if v_last_auto is not null
     and v_last_auto > v_now - make_interval(secs => p_throttle_seconds) then$old$,
$new$  if p_automation = 'help_reply' then
    select max(m.created_at) into v_last_auto
      from public.messages m
     where m.company_id = p_company_id
       and m.conversation_id = p_conversation_id
       and m.created_at > v_now - make_interval(secs => p_throttle_seconds)
       and m.automation = 'help_reply'
       and m.body = p_body
       and m.status <> 'failed';
  end if;
  if v_last_auto is not null
     and v_last_auto > v_now - make_interval(secs => p_throttle_seconds) then$new$);
  if updated = definition then
    raise exception 'claim_auto_reply cooldown anchor missing';
  end if;

  definition := updated;
  updated := replace(definition,
    'set last_auto_reply_at = v_now,',
    'set last_auto_reply_at = case when p_automation = ''help_reply'' then last_auto_reply_at else v_now end,');
  if updated = definition then
    raise exception 'claim_auto_reply timestamp anchor missing';
  end if;

  definition := updated;
  updated := replace(definition, 'conv.last_auto_reply_at, ct.phone_e164',
    'conv.last_auto_reply_at, coalesce(conv.contact_phone_e164, ct.phone_e164)');
  if updated = definition then
    raise exception 'claim_auto_reply phone anchor missing';
  end if;
  execute updated;
end
$migration$;
