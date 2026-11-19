alter table public.scheduled_messages drop constraint scheduled_messages_body_check;
alter table public.scheduled_messages add constraint scheduled_messages_body_check
  check (char_length(btrim(body)) between 1 and 1600
         or (body = '' and status in ('canceled', 'expired', 'failed', 'sent')));

create function public.erase_purged_conversation_content(p_company_id uuid, p_conversation_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.scheduled_messages
     set status = 'canceled', claimed_at = null, canceled_at = coalesce(canceled_at, now()), updated_at = now()
   where company_id = p_company_id and conversation_id = p_conversation_id and status in ('pending', 'held');

  update public.scheduled_messages
     set body = '', updated_at = now()
   where company_id = p_company_id and conversation_id = p_conversation_id and body <> '';

  delete from public.conversation_snoozes
   where company_id = p_company_id and conversation_id = p_conversation_id;

  update public.quotes set description = 'Removed'
   where company_id = p_company_id and conversation_id = p_conversation_id and description <> 'Removed';

  update public.payment_requests set description = 'Removed'
   where company_id = p_company_id and conversation_id = p_conversation_id and description <> 'Removed';
end $$;

revoke execute on function public.erase_purged_conversation_content(uuid, uuid)
  from public, anon, authenticated, service_role;

do $migration$
declare
  v_anchor constant text := '    update public.conversations set purged_at = now() where id = v_conv;';
  v_erase constant text := $sql$
    perform public.erase_purged_conversation_content(v_company, v_conv);$sql$;
  v_definition text := pg_get_functiondef('public.api_purge_trash_item(text, uuid, uuid, uuid, uuid[])'::regprocedure);
begin
  if strpos(v_definition, v_anchor) = 0 then
    raise exception 'api_purge_trash_item: the conversation purge was not found';
  end if;
  execute replace(v_definition, v_anchor, v_anchor || v_erase);

  perform public.erase_purged_conversation_content(c.company_id, c.id)
    from public.conversations c
   where c.purged_at is not null and not public.is_on_legal_hold(c.company_id);
end $migration$;
