create function public.api_resolve_opt_out_hint(
  p_company_id uuid,
  p_conversation_id uuid,
  p_user_id uuid,
  p_hint_at timestamptz,
  p_verdict text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation public.conversations%rowtype;
begin
  if p_verdict is null or p_verdict not in ('opted_out', 'not_an_opt_out') or p_hint_at is null then
    return 'invalid';
  end if;

  perform 1 from public.companies where id = p_company_id for update;
  select * into v_conversation
    from public.conversations
   where id = p_conversation_id and company_id = p_company_id
     and deleted_at is null
   for update;
  if not found or v_conversation.contact_phone_e164 is null then
    return 'not_found';
  end if;
  if v_conversation.opt_out_hint_at is distinct from p_hint_at then
    return 'hint_changed';
  end if;

  if p_verdict = 'opted_out' then
    insert into public.opt_outs (company_id, phone_e164, source, created_by)
    values (p_company_id, v_conversation.contact_phone_e164, 'manual', p_user_id)
    on conflict (company_id, phone_e164) do update
      set source = 'manual', created_by = p_user_id, revoked_at = null
    where opt_outs.revoked_at is not null;

    if found then
      insert into public.conversation_events
        (company_id, conversation_id, actor_user_id, type, payload)
      values (p_company_id, p_conversation_id, p_user_id, 'opted_out',
        jsonb_build_object('source', 'manual', 'phone_e164', v_conversation.contact_phone_e164));
    end if;
  end if;

  update public.conversations set opt_out_hint_at = null
   where id = p_conversation_id and company_id = p_company_id;

  update public.scheduled_messages set next_attempt_at = null
   where company_id = p_company_id and conversation_id = p_conversation_id
     and status = 'held' and held_reason_key = 'domain.scheduledHoldOptOutUnresolved';
  return 'resolved';
end
$$;

revoke execute on function public.api_resolve_opt_out_hint(uuid, uuid, uuid, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.api_resolve_opt_out_hint(uuid, uuid, uuid, timestamptz, text)
  to service_role;
