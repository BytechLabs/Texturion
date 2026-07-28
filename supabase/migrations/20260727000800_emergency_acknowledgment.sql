-- ===========================================================================
-- [#414 ask 2 + ask 4] The inbox flag, and the one honest thing we can say.
--
-- ASK 4, verbatim: "Never auto-reply to the emergency keyword with
-- reassurance. 'We'll call you shortly' sent by a robot to someone with a gas
-- smell is worse than silence. If we cannot guarantee a human, the honest
-- response names the alternative — the utility's emergency line, or 911."
--
-- Silence alone was the first thing shipped for this, and it is only half the
-- ask. Someone who did exactly what the away message told them to do deserves
-- to know what just happened and what to do if it cannot wait for us. So the
-- emergency draws no away reply, and instead draws ONE message that promises
-- no human and names 911.
--
-- WHY THIS ONE IS NOT OWNER-AUTHORED, in a module whose stated principle is
-- that the owner controls what is promised. That principle is about not
-- speaking for the owner about their own availability. This message is the
-- PRODUCT speaking about its own limits — the exact thing an owner cannot be
-- asked to write, because #414 exists precisely because owner-facing copy
-- promised what no code delivered. An editable version re-opens the hole.
--
-- ASK 2's "visibly flagged in the inbox" is emergency_at: the clients badge a
-- thread whose emergency has not been closed out. It is stamped here rather
-- than by a best-effort insert from the API, so the flag and the message can
-- never disagree about whether an emergency happened.
-- ===========================================================================

alter table public.conversations
  add column if not exists emergency_at timestamptz,
  add column if not exists last_emergency_ack_at timestamptz;

comment on column public.conversations.emergency_at is
  '#414: when this thread last carried an emergency reply (URGENT/EMERGENCY/911/SOS). Clients badge the inbox row while the thread is open; closing the thread is the crew saying it was handled.';
comment on column public.conversations.last_emergency_ack_at is
  '#414: throttle stamp for the emergency acknowledgment SMS. Separate from last_auto_reply_at deliberately — an away reply sent ten minutes ago must never be the reason an emergency goes unanswered.';

-- The cap's index. Partial, so it costs almost nothing: only emergency events
-- are in it, and they are rare by construction.
create index if not exists conversation_events_emergency_idx
  on public.conversation_events (company_id, created_at)
  where type = 'emergency_flagged';

-- ===========================================================================
-- claim_emergency_ack — the atomic claim for the acknowledgment.
--
-- Deliberately NOT claim_auto_reply with different arguments. Three of that
-- function's rules are wrong here, and each difference is a decision:
--
--   * its throttle stamp is last_auto_reply_at, shared with the away reply. An
--     away reply that fired ten minutes ago would swallow the emergency
--     acknowledgment — the one message in this product that must not be lost
--     to a throttle meant for a different message.
--
--   * it skips on outbound_spend_check, so a workspace over its overage cap
--     would send nothing. Note what that state means: the crew cannot reply
--     either. The 911 line is then the ONLY thing that can still reach the
--     person, which makes the cap the argument FOR sending, not against.
--
--   * it has no ceiling of its own, which is only safe because the cap it
--     defers to is real. Exempting a send path from the cap without replacing
--     it would leave an uncapped cost centre, so this one carries its own:
--     EMERGENCY_ACK_DAILY_CAP acknowledgments per company per rolling 24h.
--     Fifty emergencies in a day from one workspace is an attack or a loop,
--     not a January cold snap. Past it the SMS stops and the crew escalation
--     in the API does NOT — the cap drops the cheaper half.
--
-- What it keeps: the opt-out mirror (a STOP is carrier truth and outranks
-- everything, including this) and the subscription check.
-- ===========================================================================

create or replace function public.claim_emergency_ack(
  p_company_id        uuid,
  p_conversation_id   uuid,
  p_body              text,
  p_segments_estimate int,
  p_throttle_seconds  int,
  p_daily_cap         int
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company     public.companies%rowtype;
  v_dest_phone  text;
  v_last_ack    timestamptz;
  v_message     public.messages%rowtype;
  v_now         timestamptz := now();
  v_today_count int;
begin
  if p_body is null or length(trim(p_body)) = 0
     or p_segments_estimate is null or p_segments_estimate < 1
     or p_throttle_seconds is null or p_throttle_seconds < 0
     or p_daily_cap is null or p_daily_cap < 0 then
    return jsonb_build_object('skipped', 'not_found');
  end if;

  select c.* into v_company
    from public.companies c
   where c.id = p_company_id
   for update;
  if not found then
    return jsonb_build_object('skipped', 'not_found');
  end if;

  -- The owner's switch. Checked here as well as in the API so the flag and the
  -- send can never disagree — a workspace with this off writes no event and
  -- sends no acknowledgment, whatever any caller believes.
  if not coalesce(v_company.emergency_keyword_enabled, true) then
    return jsonb_build_object('skipped', 'emergency_disabled');
  end if;

  -- Lock the conversation so the throttle read-check-stamp is atomic against
  -- a concurrent inbound webhook for the same thread.
  select conv.last_emergency_ack_at, ct.phone_e164
    into v_last_ack, v_dest_phone
    from public.conversations conv
    join public.contacts ct on ct.id = conv.contact_id
   where conv.id = p_conversation_id
     and conv.company_id = p_company_id
   for update of conv;
  if not found then
    return jsonb_build_object('skipped', 'not_found');
  end if;

  -- The inbox flag is stamped for EVERY emergency, before any reason we might
  -- decline to send. A throttled or capped acknowledgment still means an
  -- emergency arrived, and that is exactly when the crew most needs to see it
  -- on the thread.
  update public.conversations
     set emergency_at = v_now
   where id = p_conversation_id;

  insert into public.conversation_events
    (company_id, conversation_id, actor_user_id, type, payload)
  values
    (p_company_id, p_conversation_id, null, 'emergency_flagged',
     jsonb_build_object('source', 'inbound_keyword'));

  if v_company.subscription_status <> 'active' or v_company.plan is null then
    return jsonb_build_object('skipped', 'subscription_inactive');
  end if;

  -- Carrier truth outranks everything. A contact who sent STOP does not get
  -- a message from us, and no emergency changes that.
  if exists (select 1 from public.opt_outs o
              where o.company_id = p_company_id
                and o.phone_e164 = v_dest_phone
                and o.revoked_at is null) then
    return jsonb_build_object('skipped', 'recipient_opted_out');
  end if;

  if v_last_ack is not null
     and v_last_ack > v_now - make_interval(secs => p_throttle_seconds) then
    return jsonb_build_object('skipped', 'throttled');
  end if;

  select count(*) into v_today_count
    from public.conversation_events e
   where e.company_id = p_company_id
     and e.type = 'emergency_flagged'
     and e.created_at > v_now - interval '24 hours';
  -- > rather than >=: the row for THIS emergency was inserted above, so the
  -- count already includes it. The cap is the number of emergencies allowed
  -- in the window, and the p_daily_cap'th one still gets its acknowledgment.
  if v_today_count > p_daily_cap then
    return jsonb_build_object('skipped', 'daily_cap');
  end if;

  -- Attributed to the owner, like the away reply: the shipped
  -- messages_outbound_actor CHECK requires an actor on every outbound, and a
  -- system-user sentinel would be a second kind of actor for one message.
  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments,
     sent_by_user_id)
  values
    (p_company_id, p_conversation_id, 'outbound', p_body, 'queued',
     p_segments_estimate, v_company.owner_user_id)
  returning * into v_message;

  update public.conversations
     set last_emergency_ack_at = v_now,
         last_message_at       = greatest(last_message_at, v_message.created_at)
   where id = p_conversation_id;

  insert into public.conversation_events
    (company_id, conversation_id, actor_user_id, type, payload)
  values
    (p_company_id, p_conversation_id, null, 'auto_reply_sent',
     jsonb_build_object('kind', 'emergency_ack', 'message_id', v_message.id));

  return jsonb_build_object('message', to_jsonb(v_message) - 'body_tsv');
end $$;

revoke execute on function
  public.claim_emergency_ack(uuid, uuid, text, int, int, int)
  from public, anon, authenticated;
grant execute on function
  public.claim_emergency_ack(uuid, uuid, text, int, int, int)
  to service_role;
