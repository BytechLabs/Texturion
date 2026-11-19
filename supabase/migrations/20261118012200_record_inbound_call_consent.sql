create function public.record_inbound_call_consent(
  p_company_id uuid,
  p_contact_id uuid,
  p_caller_e164 text,
  p_call_id text
) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_primary text;
begin
  select phone_e164 into v_primary
    from public.contacts
   where company_id = p_company_id and id = p_contact_id
   for update;

  if v_primary = p_caller_e164 then
    update public.contacts
       set consent_source = 'inbound_call', consent_at = now()
     where company_id = p_company_id and id = p_contact_id
       and consent_at is null;
  elsif exists (
    select 1 from public.contact_phones
     where company_id = p_company_id and contact_id = p_contact_id
       and phone_e164 = p_caller_e164
  ) and not exists (
    select 1 from public.contact_consent_events
     where company_id = p_company_id and phone_e164 = p_caller_e164
  ) then
    insert into public.contact_consent_events
      (company_id, contact_id, phone_e164, state, source, captured_at, evidence)
    values (p_company_id, p_contact_id, p_caller_e164, 'implied', 'inbound_call',
            now(), jsonb_build_object('call_id', p_call_id));
  end if;
end $$;

revoke execute on function public.record_inbound_call_consent(uuid, uuid, text, text)
  from public, anon, authenticated;

do $$
declare
  v_rpc regprocedure;
  v_sql text;
  v_record text;
  v_select integer;
  v_existing text := $old$set deleted_at     = null,
           consent_source = coalesce(consent_source, 'inbound_sms'),
           consent_at     = coalesce(consent_at, v_now)
     where id = v_contact_id;$old$;
  v_upsert text := $old$insert into public.contacts as ct (company_id, phone_e164, consent_source, consent_at)
    values (p_company_id, p_caller_e164, 'inbound_sms', v_now)
    on conflict (company_id, phone_e164) do update
      set deleted_at     = null,
          consent_source = coalesce(ct.consent_source, excluded.consent_source),
          consent_at     = coalesce(ct.consent_at, excluded.consent_at)$old$;
  v_conversation text := E'\n  select conv.* into v_conv';
begin
  for v_rpc, v_record in values
    ('public.claim_missed_call_text(uuid, uuid, text, text, text, integer, integer)'::regprocedure,
     'perform public.record_inbound_call_consent(p_company_id, v_contact_id, p_caller_e164, p_call_id);'),
    ('public.api_thread_call(uuid, uuid, text, text, text, integer, boolean, text)'::regprocedure,
     $record$if coalesce(nullif(p_direction, ''), 'inbound') = 'inbound' then
    perform public.record_inbound_call_consent(p_company_id, v_contact_id, p_caller_e164, p_call_session_id);
  end if;$record$)
  loop
    v_sql := pg_get_functiondef(v_rpc);
    v_select := strpos(v_sql, v_conversation);
    if strpos(v_sql, v_existing) = 0 or strpos(v_sql, v_upsert) = 0
        or v_select = 0 then
      raise exception '%: expected caller threading statements', v_rpc;
    end if;
    v_sql := overlay(v_sql placing E'\n  ' || v_record || E'\n'
                     from v_select for 0);
    v_sql := replace(v_sql, v_existing,
      'set deleted_at = null where id = v_contact_id and company_id = p_company_id;');
    v_sql := replace(v_sql, v_upsert, $new$insert into public.contacts as ct (company_id, phone_e164)
    values (p_company_id, p_caller_e164)
    on conflict (company_id, phone_e164) do update
      set deleted_at = null$new$);
    execute v_sql;
  end loop;
end $$;

-- A call event at the original capture time identifies the old source.
-- Keep the original ledger entry and link its appended correction.
with proven_calls as (
  select distinct on (c.id) c.id as contact_id, c.company_id, c.phone_e164,
         c.consent_at, e.id as call_event_id
    from public.contacts c
    join public.conversations conv
      on conv.company_id = c.company_id and conv.contact_id = c.id
    join public.conversation_events e
      on e.company_id = c.company_id and e.conversation_id = conv.id
     and e.created_at = c.consent_at and e.payload->>'caller' = c.phone_e164
   where c.consent_source = 'inbound_sms'
     and (e.type = 'missed_call' or
          (e.type = 'call_completed' and e.payload->>'direction' = 'inbound'))
     and not exists (
       select 1
         from public.messages m
         join public.conversations sms
           on sms.company_id = m.company_id and sms.id = m.conversation_id
        where m.company_id = c.company_id and sms.contact_id = c.id
          and m.direction = 'inbound' and m.created_at <= c.consent_at
     )
     and exists (
       select 1 from public.contact_consent_events original
        where original.company_id = c.company_id and original.contact_id = c.id
          and original.phone_e164 = c.phone_e164 and original.captured_at = c.consent_at
          and original.source = 'inbound_sms' and original.state = 'implied'
     )
     and not exists (
       select 1 from public.contact_consent_events later
        where later.company_id = c.company_id and later.phone_e164 = c.phone_e164
          and later.state in ('express', 'revoked')
     )
   order by c.id, e.id
), appended as (
  insert into public.contact_consent_events
    (company_id, contact_id, phone_e164, state, source, captured_at, evidence)
  select company_id, contact_id, phone_e164, 'implied', 'inbound_call', consent_at,
         jsonb_build_object('corrects_source', 'inbound_sms', 'call_event_id', call_event_id)
    from proven_calls
  returning contact_id, company_id, captured_at
)
update public.contacts c
   set consent_source = 'inbound_call'
  from appended
 where c.id = appended.contact_id and c.company_id = appended.company_id
   and c.consent_source = 'inbound_sms' and c.consent_at = appended.captured_at;
