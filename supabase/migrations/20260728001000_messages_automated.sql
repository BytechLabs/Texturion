-- #388 — the message ledger could not tell a robot from a person.
--
-- Found while building the unanswered-lead clock. Every outbound row carries
-- `sent_by_user_id` and a CHECK constraint requires it, so an automated send
-- cannot leave it null — the away reply, the missed-call text and the
-- emergency acknowledgment are all attributed to the COMPANY OWNER. Nothing
-- anywhere records that a machine wrote them.
--
-- That is wrong beyond #388. It means the owner appears to have personally
-- answered every after-hours text, and it means #239 — "response time,
-- measured", the metric the brand is named after — would clock the away
-- auto-reply as the first response and report a two-second average that no
-- human produced. A number like that is worse than no number.
--
-- So: `messages.automated`, defaulting FALSE, set TRUE by the three functions
-- that claim an automated send.
--
-- The default is false and NOT true, deliberately, and the asymmetry is the
-- point. A new send path that forgets to set it is recorded as human: the
-- lead clock stops and a chase is missed. Defaulting true would record a
-- forgotten HUMAN path as automated — the clock would never stop and the crew
-- would be escalated at about a thread they had already answered. A missed
-- nudge costs one lead; an alarm that fires after you have replied teaches the
-- whole crew to mute the app, and #244 is already open about that.
--
-- The three bodies below are the LIVE definitions read back out of the
-- database with pg_get_functiondef, not retyped from their source migrations,
-- so this cannot silently revert a later fix that a stale copy would miss.
-- The only edit is `automated` in the insert.

alter table public.messages
  add column if not exists automated boolean not null default false;

comment on column public.messages.automated is
  '#388: a machine wrote this, not the person in sent_by_user_id. Auto-replies are attributed to the owner because the outbound-actor CHECK requires an actor; this is how you tell them apart.';

-- An automated reply must not look like an answer to the #388 lead clock.
create index if not exists messages_human_outbound_idx
  on public.messages (conversation_id)
  where direction = 'outbound' and automated = false;


-- ---------------------------------------------------------------------------
-- claim_auto_reply
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_auto_reply(p_company_id uuid, p_conversation_id uuid, p_body text, p_segments_estimate integer, p_throttle_seconds integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_company     public.companies%rowtype;
  v_dest_phone  text;
  v_last_auto   timestamptz;
  v_message     public.messages%rowtype;
  v_now         timestamptz := now();
  v_spend_err   text;
begin
  if p_body is null or length(trim(p_body)) = 0
     or p_segments_estimate is null or p_segments_estimate < 1
     or p_throttle_seconds is null or p_throttle_seconds < 0 then
    return jsonb_build_object('skipped', 'not_found');
  end if;

  -- Serialize this company's sends (same lock discipline as gate_outbound_send).
  select c.* into v_company
    from public.companies c
   where c.id = p_company_id
   for update;
  if not found then
    return jsonb_build_object('skipped', 'not_found');
  end if;

  -- Lock the conversation row so the throttle read-check-stamp is atomic
  -- against a concurrent inbound webhook for the same thread.
  select conv.last_auto_reply_at, ct.phone_e164
    into v_last_auto, v_dest_phone
    from public.conversations conv
    join public.contacts ct on ct.id = conv.contact_id
   where conv.id = p_conversation_id
     and conv.company_id = p_company_id
   for update of conv;
  if not found then
    return jsonb_build_object('skipped', 'not_found');
  end if;

  -- Backstop subscription check (caller pre-checks; belt-and-braces).
  if v_company.subscription_status <> 'active' or v_company.plan is null then
    return jsonb_build_object('skipped', 'subscription_inactive');
  end if;

  -- (a) Opt-out mirror — never auto-send to an opted-out contact.
  if exists (select 1 from public.opt_outs o
              where o.company_id = p_company_id
                and o.phone_e164 = v_dest_phone
                and o.revoked_at is null) then
    return jsonb_build_object('skipped', 'recipient_opted_out');
  end if;

  -- (c) Throttle — one auto-reply per conversation per window.
  if v_last_auto is not null
     and v_last_auto > v_now - make_interval(secs => p_throttle_seconds) then
    return jsonb_build_object('skipped', 'throttled');
  end if;

  -- (d) #12 Phase 0: respect the same rate limit + overage cap as a manual
  -- send. An over-cap / rate-limited auto-reply is SKIPPED (no spend), reusing
  -- the caller's 'skipped' contract — the same codes gate_outbound_send returns.
  v_spend_err := public.outbound_spend_check(p_company_id, p_segments_estimate);
  if v_spend_err is not null then
    return jsonb_build_object('skipped', v_spend_err);
  end if;

  -- Insert the queued auto-reply BEFORE the Telnyx call (§8). No idempotency
  -- key: the conversation-level throttle stamp IS the anti-duplicate guard. The
  -- auto-reply is attributed to the company OWNER (the away message is
  -- owner-authored), so the shipped messages_outbound_actor CHECK (an outbound
  -- must carry a sent_by_user_id) holds without a system-user sentinel.
  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments,
     sent_by_user_id, automated)
  values
    (p_company_id, p_conversation_id, 'outbound', p_body, 'queued',
     p_segments_estimate, v_company.owner_user_id, true)
  returning * into v_message;

  -- Stamp the throttle and bump last_message_at in the same txn.
  update public.conversations
     set last_auto_reply_at = v_now,
         last_message_at     = greatest(last_message_at, v_message.created_at)
   where id = p_conversation_id;

  -- Audit — the crew sees the machine spoke in the thread (actor NULL).
  insert into public.conversation_events
    (company_id, conversation_id, actor_user_id, type, payload)
  values
    (p_company_id, p_conversation_id, null, 'auto_reply_sent',
     jsonb_build_object('kind', 'away', 'message_id', v_message.id));

  return jsonb_build_object('message', to_jsonb(v_message) - 'body_tsv');
end $function$;

-- ---------------------------------------------------------------------------
-- claim_missed_call_text
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_missed_call_text(p_company_id uuid, p_phone_number_id uuid, p_caller_e164 text, p_call_id text, p_body text, p_segments_estimate integer, p_throttle_seconds integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_company     public.companies%rowtype;
  v_contact_id  uuid;
  v_conv        public.conversations%rowtype;
  v_created_conv boolean := false;
  v_last_auto   timestamptz;
  v_message     public.messages%rowtype;
  v_now         timestamptz := now();
  v_prior_payload jsonb;
  v_prior_conv    uuid;
  v_spend_err   text;
begin
  if p_caller_e164 is null or length(trim(p_caller_e164)) = 0
     or p_call_id is null or length(trim(p_call_id)) = 0
     or p_body is null or length(trim(p_body)) = 0
     or p_segments_estimate is null or p_segments_estimate < 1
     or p_throttle_seconds is null or p_throttle_seconds < 0 then
    return jsonb_build_object('skipped', 'not_found');
  end if;

  -- Serialize this company's sends (same lock discipline as gate_outbound_send /
  -- claim_auto_reply) — the per-call idempotency read-check-insert and the
  -- throttle read-check-stamp are atomic against a concurrent retried webhook.
  select c.* into v_company
    from public.companies c
   where c.id = p_company_id
   for update;
  if not found then
    return jsonb_build_object('skipped', 'not_found');
  end if;

  -- The receiving number must belong to the company (caller resolved it from
  -- the webhook's "to" number; guard against a mismatched pair).
  perform 1 from public.phone_numbers n
   where n.id = p_phone_number_id and n.company_id = p_company_id;
  if not found then
    return jsonb_build_object('skipped', 'not_found');
  end if;

  -- (3) subscription backstop (caller pre-checks; belt-and-braces).
  if v_company.subscription_status <> 'active' or v_company.plan is null then
    return jsonb_build_object('skipped', 'subscription_inactive');
  end if;

  -- (0) Per-call idempotency FIRST — before any threading write, so a replayed
  -- webhook has ZERO side effects (no contact un-delete, no waiting→open flip,
  -- no resurrection of a conversation the crew closed since). Company-wide by
  -- call_id (the conversation is not resolved yet). Checked under the company
  -- lock, so concurrent retries serialize and exactly one wins.
  --
  -- Replay-heal: when the prior claim's text NEVER reached Telnyx (a crash or
  -- a rate-limit throw landed between claim and dispatch — the row is still
  -- 'queued', or 'failed' with no telnyx_message_id, i.e. §7-retryable), hand
  -- the SAME row back (replayed=true) so the sweeper's replay re-dispatches it
  -- instead of stranding it. A row Telnyx already accepted returns 'duplicate'
  -- — the double-text guard is the telnyx_message_id, not the event alone.
  select e.payload, e.conversation_id into v_prior_payload, v_prior_conv
    from public.conversation_events e
   where e.company_id = p_company_id
     and e.type = 'missed_call'
     and e.payload->>'call_id' = p_call_id
   limit 1;
  if found then
    select m.* into v_message
      from public.messages m
     where m.id = (v_prior_payload->>'message_id')::uuid
       and m.company_id = p_company_id;
    if found
       and v_message.telnyx_message_id is null
       and v_message.status in ('queued', 'failed') then
      return jsonb_build_object(
        'message', to_jsonb(v_message) - 'body_tsv',
        'conversation_id', v_prior_conv,
        'created_conversation', false,
        'replayed', true);
    end if;
    return jsonb_build_object('skipped', 'duplicate');
  end if;

  -- (1) Thread the caller: contact upsert (clears deleted_at, stamps inbound
  -- consent once — a missed call is inbound contact, §5), then find-or-reopen-
  -- or-create the conversation for the triple (D7 threading rules 2/4/5; a
  -- missed call never lands in a spam-absorb thread — it just texts back).
  insert into public.contacts as ct (company_id, phone_e164, consent_source, consent_at)
  values (p_company_id, p_caller_e164, 'inbound_sms', v_now)
  on conflict (company_id, phone_e164) do update
    set deleted_at     = null,
        consent_source = coalesce(ct.consent_source, excluded.consent_source),
        consent_at     = coalesce(ct.consent_at, excluded.consent_at)
  returning ct.id into v_contact_id;

  -- Rule 2: open conversation for the triple → use it (waiting → open flip).
  select conv.* into v_conv
    from public.conversations conv
   where conv.company_id = p_company_id
     and conv.phone_number_id = p_phone_number_id
     and conv.contact_id = v_contact_id
     and conv.closed_at is null
   for update;

  if found then
    if v_conv.status = 'waiting' then
      update public.conversations set status = 'open' where id = v_conv.id;
    end if;
  else
    -- Rule 4: reopen the most recent closed (non-spam) conversation within 30d,
    -- else Rule 5: create a fresh one. (A spam thread is left alone; the missed
    -- call opens a new conversation rather than resurrecting a spam thread.)
    select conv.* into v_conv
      from public.conversations conv
     where conv.company_id = p_company_id
       and conv.phone_number_id = p_phone_number_id
       and conv.contact_id = v_contact_id
       and conv.closed_at is not null
       and not conv.is_spam
     order by conv.closed_at desc
     limit 1
     for update;

    if found and v_conv.closed_at >= v_now - interval '30 days' then
      update public.conversations
         set status = 'new', closed_at = null
       where id = v_conv.id
      returning * into v_conv;
    else
      insert into public.conversations (company_id, contact_id, phone_number_id, status)
      values (p_company_id, v_contact_id, p_phone_number_id, 'new')
      on conflict (company_id, phone_number_id, contact_id) where closed_at is null
      do nothing
      returning * into v_conv;

      if v_conv.id is null then
        -- Lost the create race: re-select the open row a concurrent thread made.
        select conv.* into v_conv
          from public.conversations conv
         where conv.company_id = p_company_id
           and conv.phone_number_id = p_phone_number_id
           and conv.contact_id = v_contact_id
           and conv.closed_at is null
         for update;
        if not found then
          raise exception 'claim_missed_call_text: lost conversation race for company %', p_company_id;
        end if;
      else
        v_created_conv := true;
      end if;
    end if;
  end if;

  -- (2) Opt-out mirror — never text an opted-out caller.
  if exists (select 1 from public.opt_outs o
              where o.company_id = p_company_id
                and o.phone_e164 = p_caller_e164
                and o.revoked_at is null) then
    return jsonb_build_object('skipped', 'recipient_opted_out');
  end if;

  -- (4) Throttle — one auto-text per conversation per window (shared with the
  -- away-reply guard via conversations.last_auto_reply_at).
  select conv.last_auto_reply_at into v_last_auto
    from public.conversations conv where conv.id = v_conv.id;
  if v_last_auto is not null
     and v_last_auto > v_now - make_interval(secs => p_throttle_seconds) then
    return jsonb_build_object('skipped', 'throttled');
  end if;

  -- (5) #12 Phase 0: respect the same rate limit + overage cap as a manual send
  -- (mirrors claim_auto_reply). An over-cap / rate-limited booking text is
  -- SKIPPED (no spend) — same 'skipped' codes gate_outbound_send returns. The
  -- threading above already ran, but no OUTBOUND row / dispatch / throttle stamp
  -- / audit happens, so nothing is billed.
  v_spend_err := public.outbound_spend_check(p_company_id, p_segments_estimate);
  if v_spend_err is not null then
    return jsonb_build_object('skipped', v_spend_err);
  end if;

  -- Insert the queued booking-forward SMS BEFORE the Telnyx call (§8). No
  -- idempotency key: the per-call event + the conversation throttle stamp ARE
  -- the anti-duplicate guard. Attributed to the OWNER (owner-authored message),
  -- so the messages_outbound_actor CHECK (outbound must carry a sent_by) holds.
  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments,
     sent_by_user_id, automated)
  values
    (p_company_id, v_conv.id, 'outbound', p_body, 'queued',
     p_segments_estimate, v_company.owner_user_id, true)
  returning * into v_message;

  update public.conversations
     set last_auto_reply_at = v_now,
         last_message_at     = greatest(last_message_at, v_message.created_at)
   where id = v_conv.id;

  -- Audit — the crew sees the missed call + the machine's booking text. The
  -- call_id in the payload is the idempotency key checked above.
  insert into public.conversation_events
    (company_id, conversation_id, actor_user_id, type, payload)
  values
    (p_company_id, v_conv.id, null, 'missed_call',
     jsonb_build_object('call_id', p_call_id, 'message_id', v_message.id,
                        'caller', p_caller_e164));

  return jsonb_build_object(
    'message', to_jsonb(v_message) - 'body_tsv',
    'conversation_id', v_conv.id,
    'created_conversation', v_created_conv);
end $function$;

-- ---------------------------------------------------------------------------
-- claim_emergency_ack
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_emergency_ack(p_company_id uuid, p_conversation_id uuid, p_body text, p_segments_estimate integer, p_throttle_seconds integer, p_daily_cap integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
     sent_by_user_id, automated)
  values
    (p_company_id, p_conversation_id, 'outbound', p_body, 'queued',
     p_segments_estimate, v_company.owner_user_id, true)
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
end $function$;
