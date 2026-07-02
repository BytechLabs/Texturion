-- SPEC §8 — notification debounce claim inside the threading transaction.
--
-- The §8 trigger ("debounced — never one email per message") is:
--   * the conversation is NEW or REOPENED BY INBOUND, or
--   * a first inbound after ≥15 minutes of thread inactivity — the
--     conversations.last_notified_at gate: notify only if
--     `last_notified_at IS NULL OR last_notified_at < now() - interval
--     '15 minutes'`, then stamp it.
--   * Spam-thread appends (threading rule 3) never notify.
--
-- The decision + stamp MUST be atomic with threading (two concurrent
-- deliveries would otherwise both read a stale last_notified_at and both
-- notify), so thread_inbound_message is re-created here to decide the claim
-- under its existing FOR UPDATE conversation lock, stamp last_notified_at,
-- and report the outcome as a new `notify` key. Duplicate deliveries
-- (created=false) never claim. All prior behavior is unchanged; the return
-- object gains only the additive key:
--   { message_id, conversation_id, created, opted_out, notify }.
create or replace function public.thread_inbound_message(
  p_company_id        uuid,
  p_phone_number_id   uuid,
  p_from_e164         text,
  p_body              text,
  p_telnyx_message_id text
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
begin
  if p_company_id is null or p_phone_number_id is null then
    raise exception 'thread_inbound_message: company and phone number are required';
  end if;
  if p_telnyx_message_id is null or length(trim(p_telnyx_message_id)) = 0 then
    raise exception 'thread_inbound_message: telnyx_message_id is required';
  end if;
  if p_from_e164 is null or length(trim(p_from_e164)) = 0 then
    raise exception 'thread_inbound_message: from number is required';
  end if;

  -- Duplicate-webhook fast path (Telnyx retries up to 6 times, §7): the first
  -- delivery owns every side effect, including the notification claim.
  select m.* into v_message
    from public.messages m
   where m.telnyx_message_id = p_telnyx_message_id;
  if found then
    return jsonb_build_object(
      'message_id', v_message.id,
      'conversation_id', v_message.conversation_id,
      'created', false,
      'notify', false,
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

  -- Rule 1: contact upsert — clears deleted_at, stamps inbound consent once.
  insert into public.contacts as ct (company_id, phone_e164, consent_source, consent_at)
  values (p_company_id, p_from_e164, 'inbound_sms', now())
  on conflict (company_id, phone_e164) do update
    set deleted_at     = null,
        consent_source = coalesce(ct.consent_source, excluded.consent_source),
        consent_at     = coalesce(ct.consent_at, excluded.consent_at)
  returning ct.id into v_contact_id;

  -- Rule 2: open conversation for the triple → append (waiting → open).
  select c.* into v_conv
    from public.conversations c
   where c.company_id = p_company_id
     and c.phone_number_id = p_phone_number_id
     and c.contact_id = v_contact_id
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
       and c.closed_at is not null
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
    else
      -- Rule 5: create a new conversation; on a concurrent create the partial
      -- unique index wins the race and the open row is re-selected.
      insert into public.conversations (company_id, contact_id, phone_number_id, status)
      values (p_company_id, v_contact_id, p_phone_number_id, 'new')
      on conflict (company_id, phone_number_id, contact_id) where closed_at is null
      do nothing
      returning * into v_conv;

      if v_conv.id is null then
        select c.* into v_conv
          from public.conversations c
         where c.company_id = p_company_id
           and c.phone_number_id = p_phone_number_id
           and c.contact_id = v_contact_id
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
      end if;
    end if;
  end if;

  -- Message insert, idempotent on messages_telnyx_id_uq (D7).
  insert into public.messages
    (company_id, conversation_id, direction, body, status, telnyx_message_id)
  values
    (p_company_id, v_conv.id, 'inbound', coalesce(p_body, ''), 'received', p_telnyx_message_id)
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
     where m.telnyx_message_id = p_telnyx_message_id;
  else
    update public.conversations
       set last_message_at = greatest(last_message_at, v_message.created_at)
     where id = v_conv.id;
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
    'notify', v_notify,
    'opted_out', exists (
      select 1 from public.opt_outs o
       where o.company_id = p_company_id
         and o.phone_e164 = p_from_e164
         and o.revoked_at is null));
end $$;

-- CREATE OR REPLACE preserves ACLs, but restate the SPEC §6 posture so this
-- migration stands alone: service-role-only, like every messaging function.
revoke execute on function
  public.thread_inbound_message(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function
  public.thread_inbound_message(uuid, uuid, text, text, text)
  to service_role;
