create function public.api_change_manual_opt_out(
  p_company_id uuid,
  p_user_id uuid,
  p_contact_id uuid,
  p_conversation_id uuid,
  p_enabled boolean
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_contact_id uuid;
  v_primary text;
  v_phones text[];
  v_phone text;
  v_row public.opt_outs%rowtype;
  v_event_thread uuid;
  v_changed boolean := false;
begin
  if (p_contact_id is null) = (p_conversation_id is null) then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  perform 1 from public.companies where id = p_company_id for update;

  if p_conversation_id is not null then
    select c.contact_phone_e164 into v_primary
      from public.conversations c
     where c.id = p_conversation_id and c.company_id = p_company_id and c.deleted_at is null;
  else
    select c.id, c.phone_e164 into v_contact_id, v_primary from public.contacts c
     where c.id = p_contact_id and c.company_id = p_company_id and c.deleted_at is null;
  end if;
  if v_primary is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if p_contact_id is not null and p_enabled then
    v_phones := array(
      select v_primary
      union
      select p.phone_e164 from public.contact_phones p
       where p.contact_id = v_contact_id and p.company_id = p_company_id
      order by 1
    );
  else
    v_phones := array[v_primary];
  end if;

  if not p_enabled then
    select * into v_row from public.opt_outs
     where company_id = p_company_id and phone_e164 = v_primary and revoked_at is null
     for update;
    if not found then
      return jsonb_build_object('outcome', 'not_opted_out');
    end if;
    if v_row.source in ('carrier', 'stop_keyword') then
      return jsonb_build_object('outcome', 'carrier');
    end if;
  end if;

  foreach v_phone in array v_phones loop
    if p_enabled then
      insert into public.opt_outs (company_id, phone_e164, source, created_by)
      values (p_company_id, v_phone, 'manual', p_user_id)
      on conflict (company_id, phone_e164) do update
        set source = 'manual', created_by = p_user_id, revoked_at = null
      where opt_outs.revoked_at is not null;
    else
      update public.opt_outs set revoked_at = now()
       where company_id = p_company_id and phone_e164 = v_phone and revoked_at is null
         and source in ('manual', 'import');
    end if;

    if found then
      v_changed := true;
      v_event_thread := p_conversation_id;
      if v_event_thread is null then
        select c.id into v_event_thread from public.conversations c
         where c.company_id = p_company_id and c.contact_id = v_contact_id
           and c.contact_phone_e164 = v_phone and c.deleted_at is null
         order by c.last_message_at desc nulls last, c.id
         limit 1;
      end if;
      insert into public.conversation_events
        (company_id, conversation_id, actor_user_id, type, payload)
      values (p_company_id, v_event_thread, p_user_id,
        case when p_enabled then 'opted_out'::public.conversation_event_type
             else 'opt_out_revoked'::public.conversation_event_type end,
        jsonb_build_object('source', 'manual', 'phone_e164', v_phone));
    end if;
  end loop;

  select * into v_row from public.opt_outs
   where company_id = p_company_id and phone_e164 = v_primary;
  return jsonb_build_object('outcome', case when v_changed then 'changed' else 'unchanged' end,
    'opt_out', jsonb_build_object('id', v_row.id, 'phone_e164', v_row.phone_e164,
      'source', v_row.source, 'created_at', v_row.created_at, 'revoked_at', v_row.revoked_at));
end;
$$;

revoke execute on function public.api_change_manual_opt_out(uuid, uuid, uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.api_change_manual_opt_out(uuid, uuid, uuid, uuid, boolean)
  to service_role;
