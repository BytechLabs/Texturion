-- FEATURE-GAPS BUILD-NOW — atomic send-path functions for the shared auto-send
-- guard (Step 0b) and the one-tap review-request action (Step 2). A NEW
-- migration (never edits a shipped one, D7/D14).
--
-- Both are SECURITY DEFINER, service-role-only RPCs (SPEC §6 RLS posture): the
-- Worker calls them with the sb_secret_ / service_role key; end-user roles never
-- reach PostgREST. Each does its compliance checks AND the insert-before-Telnyx
-- queued-message insert AND its audit event in ONE transaction, so a burst of
-- concurrent inbound webhooks (away-reply) or a double-tap (review) can never
-- produce two auto-sends. They mirror gate_outbound_send's idempotent-insert
-- shape (20260701001100) but for the reply-exempt / manual paths.
--
-- The 'auto_reply_sent' and 'review_requested' enum values were added in
-- 20260703030000_send_features_event_types.sql, so referencing them here is safe
-- (separate transaction). The p_body passed in is ALREADY merge-field-applied
-- and footer-free (reply-exempt sends carry no §5 identification footer — the
-- customer started the thread).

-- ===========================================================================
-- claim_auto_reply — the shared auto-send guard's atomic claim (Step 0b).
--
-- Called by the after-hours away-reply branch (and any future auto/assisted
-- send). It sends an auto-message into a conversation ONLY IF, checked
-- atomically under a row lock so a burst yields exactly one reply:
--   (a) the destination contact is NOT on the opt-out mirror (any active
--       opt_outs row for the company+phone) — never send to an opted-out
--       contact, even reply-exempt;
--   (b) the subscription is active and the destination is registration-clear
--       for its country (the CALLER pre-checks these via runPreSendGates, but
--       we re-check subscription as a backstop, matching gate_outbound_send);
--   (c) no auto-reply has been sent into THIS conversation within
--       p_throttle_seconds (conversations.last_auto_reply_at) — the throttle
--       is keyed on the conversation, not wall-clock, so repeated inbound in a
--       short window collapses to one reply.
-- The STOP/HELP/START keyword check and the "is this the FIRST inbound outside
-- business hours" decision are made by the caller BEFORE this RPC (they need the
-- inbound body + business-hours math); this function owns opt-out + throttle +
-- the atomic insert, which are the parts that must not race.
--
-- On success it inserts a 'queued' outbound message (segments estimate carried
-- in), stamps conversations.last_auto_reply_at = now(), and logs an
-- 'auto_reply_sent' conversation_event (actor NULL = system). The caller then
-- runs dispatchOutbound on the returned row exactly like a normal send.
--
-- Returns jsonb:
--   { "skipped": "recipient_opted_out" | "throttled" | "subscription_inactive"
--                | "not_found" }
--   or { "message": <messages row, body_tsv stripped> }.
-- ===========================================================================
create or replace function public.claim_auto_reply(
  p_company_id        uuid,
  p_conversation_id   uuid,
  p_body              text,
  p_segments_estimate int,
  p_throttle_seconds  int
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company     public.companies%rowtype;
  v_dest_phone  text;
  v_last_auto   timestamptz;
  v_message     public.messages%rowtype;
  v_now         timestamptz := now();
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

  -- Insert the queued auto-reply BEFORE the Telnyx call (§8). No idempotency
  -- key: the conversation-level throttle stamp IS the anti-duplicate guard. The
  -- auto-reply is attributed to the company OWNER (the away message is
  -- owner-authored), so the shipped messages_outbound_actor CHECK (an outbound
  -- must carry a sent_by_user_id) holds without a system-user sentinel.
  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments,
     sent_by_user_id)
  values
    (p_company_id, p_conversation_id, 'outbound', p_body, 'queued',
     p_segments_estimate, v_company.owner_user_id)
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
end $$;

revoke execute on function
  public.claim_auto_reply(uuid, uuid, text, int, int)
  from public, anon, authenticated;
grant execute on function
  public.claim_auto_reply(uuid, uuid, text, int, int)
  to service_role;

-- ===========================================================================
-- claim_review_request — the one-tap "Ask for a review" atomic claim (Step 2).
--
-- MANUAL one-tap ONLY (FEATURE-GAPS §3 non-goal — never an automated sequence).
-- Called by POST /v1/conversations/:id/review-request with the member's user id.
-- Atomically, under a conversation row lock:
--   (a) opt-out mirror — never send to an opted-out contact;
--   (b) one-per-job suppression — refuse if a 'review_requested' event exists
--       on this conversation within p_suppress_seconds, OR the customer has
--       replied/opened since the last review ask (an inbound message newer than
--       the last review_requested event). Both are the FEATURE-GAPS §3 rule:
--       "auto-suppress if a review was already requested recently OR the
--       customer replied/opened since."
--   (c) subscription active (backstop; caller pre-checks send gates).
-- On success inserts the queued outbound message (body already merge-applied
-- with {review_link}), logs 'review_requested' (actor = the member), and
-- returns the row for dispatchOutbound.
--
-- Returns jsonb:
--   { "skipped": "recipient_opted_out" | "already_requested"
--                | "subscription_inactive" | "not_found" }
--   or { "message": <messages row, body_tsv stripped> }.
-- ===========================================================================
create or replace function public.claim_review_request(
  p_company_id        uuid,
  p_conversation_id   uuid,
  p_actor_user_id     uuid,
  p_body              text,
  p_segments_estimate int,
  p_suppress_seconds  int
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company        public.companies%rowtype;
  v_dest_phone     text;
  v_message        public.messages%rowtype;
  v_last_review    timestamptz;
  v_reply_since    boolean;
  v_now            timestamptz := now();
begin
  if p_actor_user_id is null
     or p_body is null or length(trim(p_body)) = 0
     or p_segments_estimate is null or p_segments_estimate < 1
     or p_suppress_seconds is null or p_suppress_seconds < 0 then
    return jsonb_build_object('skipped', 'not_found');
  end if;

  select c.* into v_company
    from public.companies c
   where c.id = p_company_id
   for update;
  if not found then
    return jsonb_build_object('skipped', 'not_found');
  end if;

  -- Lock the conversation row (FOR UPDATE OF conv) and read the destination
  -- phone in one query, so the suppression read-check-insert is atomic against
  -- a concurrent double-tap.
  select ct.phone_e164 into v_dest_phone
    from public.conversations conv
    join public.contacts ct on ct.id = conv.contact_id
   where conv.id = p_conversation_id
     and conv.company_id = p_company_id
   for update of conv;
  if not found then
    return jsonb_build_object('skipped', 'not_found');
  end if;

  if v_company.subscription_status <> 'active' or v_company.plan is null then
    return jsonb_build_object('skipped', 'subscription_inactive');
  end if;

  -- (a) Opt-out mirror.
  if exists (select 1 from public.opt_outs o
              where o.company_id = p_company_id
                and o.phone_e164 = v_dest_phone
                and o.revoked_at is null) then
    return jsonb_build_object('skipped', 'recipient_opted_out');
  end if;

  -- (b) One-per-job suppression, part 1: a recent review ask on this thread.
  select max(e.created_at) into v_last_review
    from public.conversation_events e
   where e.company_id = p_company_id
     and e.conversation_id = p_conversation_id
     and e.type = 'review_requested';

  if v_last_review is not null
     and v_last_review > v_now - make_interval(secs => p_suppress_seconds) then
    return jsonb_build_object('skipped', 'already_requested');
  end if;

  -- (b) part 2: the customer replied/opened SINCE the last review ask — an
  -- inbound message newer than the most recent review_requested event. (If no
  -- ask has ever been sent, v_last_review is NULL and this is not a suppressor
  -- — a fresh thread is askable.)
  if v_last_review is not null then
    select exists (
      select 1 from public.messages m
       where m.company_id = p_company_id
         and m.conversation_id = p_conversation_id
         and m.direction = 'inbound'
         and m.created_at > v_last_review
    ) into v_reply_since;
    if v_reply_since then
      return jsonb_build_object('skipped', 'already_requested');
    end if;
  end if;

  -- Insert the queued review message BEFORE the Telnyx call (§8).
  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments,
     sent_by_user_id)
  values
    (p_company_id, p_conversation_id, 'outbound', p_body, 'queued',
     p_segments_estimate, p_actor_user_id)
  returning * into v_message;

  update public.conversations
     set last_message_at = greatest(last_message_at, v_message.created_at)
   where id = p_conversation_id;

  -- Audit — actor = the member who tapped "Ask for a review".
  insert into public.conversation_events
    (company_id, conversation_id, actor_user_id, type, payload)
  values
    (p_company_id, p_conversation_id, p_actor_user_id, 'review_requested',
     jsonb_build_object('message_id', v_message.id));

  return jsonb_build_object('message', to_jsonb(v_message) - 'body_tsv');
end $$;

revoke execute on function
  public.claim_review_request(uuid, uuid, uuid, text, int, int)
  from public, anon, authenticated;
grant execute on function
  public.claim_review_request(uuid, uuid, uuid, text, int, int)
  to service_role;
