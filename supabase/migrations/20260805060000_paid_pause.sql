-- #277 — a paid pause: keep the number, stop the texting, no 30-day fuse.
--
-- A trades crew goes quiet for the winter. Today their only option is to
-- cancel, which starts an irreversible 30-day clock on the number printed on
-- their van. A pause is the same state the grace window already produces —
-- number held, inbound still arriving, history intact, outbound blocked —
-- priced, and with the deadline removed.
--
-- WHAT THE PAUSE IS, MECHANICALLY. A licensed-price swap on the SAME Stripe
-- subscription. The subscription stays genuinely `active`, so the status
-- mirror stays truthful and change-plan, reconcile and usage all keep working
-- on real data. Three cheaper-looking mechanisms were rejected, each because
-- it fails SILENTLY:
--
--   * `pause_collection` leaves the Stripe status unchanged (the vendored SDK
--     says so in as many words), so our mirror would copy 'active', every
--     gate below would pass, and the workspace would get full service for no
--     revenue.
--   * A third `plan_id` value walks straight into
--     20260701001100_messaging_functions.sql's
--     `case plan when 'starter' ... when 'pro' ... end` — no ELSE, so a third
--     value yields NULL, so `v_cap` is NULL, so `> v_cap` is NULL, so the
--     overage SPENDING CAP never fires. A cost ceiling failing OPEN.
--   * Deactivating the 10DLC campaign to save its fee costs the customer 3-7
--     business days of US texting on their return, out of a lifetime budget of
--     four reactivations. The campaign stays live; its fee is an input to the
--     price.
--
-- WHY THE FACT NEEDS A COLUMN. Precisely because the subscription stays
-- 'active', every SQL gate that keys on `subscription_status` passes for a
-- paused workspace. Those gates were written as belt-and-braces behind the
-- TypeScript ones; if the pause fact lived only in TypeScript they would stop
-- being that, and the pause would be one forgotten `await` from being a
-- discount on the full product.

alter table public.companies
  add column if not exists paused_at timestamptz;

comment on column public.companies.paused_at is
  '#277: when this workspace''s plan was paused. NOT a subscription_status and '
  'NOT a plan — the Stripe subscription stays genuinely active on a pause '
  'PRICE, and companies.plan keeps holding the plan to resume onto. Mirrored '
  'from the subscription''s licensed item on every sync, so a swap made in the '
  'Stripe dashboard converges here within a day. Null means not paused.';

-- The pause FEE, mirrored beside the fact. Not decoration: the #85
-- cost-vs-revenue projection reads a plan's LIST price to decide whether a
-- tenant is underwater, and a paused workspace pays a holding fee instead. Left
-- unfixed, the projection would credit a paused tenant with $29 or $79 a month
-- it is not paying and mute the one alert that catches a tenant costing more
-- than it pays — for the cohort whose revenue just fell by ~90%. This codebase
-- has now fixed that same class of defect three times (grandfathered modules,
-- phantom extra numbers, the prepaid year), which is why the number is stored
-- rather than assumed.
--
-- In the price's BASE currency (USD), matching PLAN_MONTHLY_REVENUE_CENTS and
-- the rest of the cost model. A CAD figure here would silently skew the margin
-- comparison by a third, which is worse than the display inconsistency #522
-- already tracks for every other billing card.
alter table public.companies
  add column if not exists paused_price_cents integer;

comment on column public.companies.paused_price_cents is
  '#277: what the pause price bills per month, in USD cents, mirrored from the '
  'Stripe subscription item alongside paused_at. Feeds the #85 cost-vs-revenue '
  'projection so a pause cannot mute the underwater alert. Null when not '
  'paused, or when the item carried no unit_amount (a tiered pause price, '
  'which nothing sells).';

-- No index on either column. Every read is for ONE company by primary key, on
-- a path that already holds the row. An index here would be write cost for a
-- lookup that never happens.

-- ---------------------------------------------------------------------------
-- company_send_block — the one place SQL decides a workspace may not send.
--
-- Five claim functions carried the same inline two-clause test. That was
-- survivable while there was one reason; a second reason means five edits, and
-- the failure mode of missing one is not a broken build but a send path that
-- quietly still works. So the reasons move here and the gates ask.
--
-- ORDER IS DELIBERATE: subscription first, pause second.
--
-- A workspace that paused and then CANCELLED has both facts true at once, and
-- the one that matters is the cancellation — an irreversible clock is running
-- on their number, and 'subscription_inactive' is the answer that says so. It
-- is also what keeps the #481 off-ramp working: that exemption is expressed
-- against the subscription gate, and a pause fact outranking it would silence
-- the one message a departing workspace is allowed to send.
--
-- Returns NULL when the workspace may send, which is the common answer and the
-- cheap one.
-- ---------------------------------------------------------------------------
create or replace function public.company_send_block(p_company public.companies)
returns text
language sql
immutable
as $$
  select case
    when p_company.subscription_status <> 'active' or p_company.plan is null
      then 'subscription_inactive'
    when p_company.paused_at is not null
      then 'workspace_paused'
  end
$$;

comment on function public.company_send_block(public.companies) is
  '#277: why this workspace may not send an outbound message, or NULL when it '
  'may. The single SQL statement of the send preconditions — a new gate calls '
  'this rather than restating them, and a new reason is added once.';

revoke execute on function public.company_send_block(public.companies)
  from public, anon, authenticated;
grant execute on function public.company_send_block(public.companies)
  to service_role;


-- ---------------------------------------------------------------------------
-- gate_outbound_send — the atomic send gate every manual outbound passes
-- through. Gate 1 is the one that changes.
--
-- Recreated verbatim from 20260701001100_messaging_functions.sql,
-- with the inline subscription test replaced by company_send_block.
-- ---------------------------------------------------------------------------
create or replace function public.gate_outbound_send(
  p_company_id        uuid,
  p_conversation_id   uuid,
  p_sender_user_id    uuid,
  p_body              text,
  p_idempotency_key   text,
  p_segments_estimate int
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_block          text;
  v_company        public.companies%rowtype;
  v_dest_phone     text;
  v_existing       public.messages%rowtype;
  v_message        public.messages%rowtype;
  v_quota          int;
  v_cap            numeric;
  v_hour_segments  bigint;
  v_period_used    bigint;
  v_period_pending bigint;
  v_period_start   timestamptz;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0
     or p_sender_user_id is null
     or p_segments_estimate is null or p_segments_estimate < 1 then
    return jsonb_build_object('error', 'validation_failed');
  end if;

  -- Idempotency fast path (D10): duplicate request → existing row, no gates.
  select m.* into v_existing
    from public.messages m
   where m.company_id = p_company_id
     and m.idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'message', to_jsonb(v_existing) - 'body_tsv', 'existing', true);
  end if;

  -- Serialize this company's sends through the rate/cap arithmetic.
  select c.* into v_company
    from public.companies c
   where c.id = p_company_id
   for update;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;

  select ct.phone_e164 into v_dest_phone
    from public.conversations conv
    join public.contacts ct on ct.id = conv.contact_id
   where conv.id = p_conversation_id
     and conv.company_id = p_company_id;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;

  -- #277 pause: the reasons this workspace may not send, asked ONCE.
  --
  -- This was `subscription_status <> 'active' or plan is null`, inline. A
  -- paused workspace is genuinely `active` in Stripe — the pause is a
  -- licensed-PRICE swap, so the status mirror stays truthful — which means
  -- that test passed for a workspace that is paying us a holding fee, and
  -- this backstop quietly stopped being one.
  v_block := public.company_send_block(v_company);
  if v_block is not null then
    return jsonb_build_object('error', v_block);
  end if;

  -- Gate 2: hard-reject sends to opted-out destinations (§5, D3).
  if exists (select 1 from public.opt_outs o
              where o.company_id = p_company_id
                and o.phone_e164 = v_dest_phone
                and o.revoked_at is null) then
    return jsonb_build_object('error', 'recipient_opted_out');
  end if;

  -- Gate 3: 250 segments per trailing hour (§10 layer 3): at ≥250 already
  -- sent/queued in the window the send is rejected.
  select coalesce(sum(coalesce(m.segments, 1)), 0) into v_hour_segments
    from public.messages m
   where m.company_id = p_company_id
     and m.direction = 'outbound'
     and m.created_at > now() - interval '1 hour';
  if v_hour_segments >= 250 then
    return jsonb_build_object('error', 'rate_limited');
  end if;

  -- Gate 4: overage cap (§2, §9): finalized usage_events for the period plus
  -- estimates of queued-but-unfinalized outbound messages plus this send.
  if v_company.overage_cap_multiplier is not null then
    v_quota := case v_company.plan when 'starter' then 500 when 'pro' then 2500 end;
    v_cap := v_company.overage_cap_multiplier * v_quota;
    -- Defensive fallback: an active company always has period dates (§9);
    -- if ever unset, count all history (fails toward blocking, never leaking).
    v_period_start := coalesce(v_company.current_period_start, '-infinity');

    select coalesce(sum(u.quantity), 0) into v_period_used
      from public.usage_events u
     where u.company_id = p_company_id
       and u.created_at >= v_period_start;

    select coalesce(sum(coalesce(m.segments, 1)), 0) into v_period_pending
      from public.messages m
      left join public.usage_events u2 on u2.message_id = m.id
     where m.company_id = p_company_id
       and m.direction = 'outbound'
       and m.status in ('queued', 'sent')
       and m.created_at >= v_period_start
       and u2.id is null;

    if v_period_used + v_period_pending + p_segments_estimate > v_cap then
      return jsonb_build_object('error', 'usage_cap_reached');
    end if;
  end if;

  -- Insert the queued row BEFORE the Telnyx call (§7, §8). segments holds the
  -- shared-estimator value until message.finalized overwrites it with
  -- Telnyx's authoritative parts (§9).
  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments,
     sent_by_user_id, idempotency_key)
  values
    (p_company_id, p_conversation_id, 'outbound', coalesce(p_body, ''), 'queued',
     p_segments_estimate, p_sender_user_id, p_idempotency_key)
  on conflict (company_id, idempotency_key) where idempotency_key is not null
  do nothing
  returning * into v_message;

  if v_message.id is null then
    -- Concurrent duplicate won the insert: return its row.
    select m.* into v_message
      from public.messages m
     where m.company_id = p_company_id
       and m.idempotency_key = p_idempotency_key;
    return jsonb_build_object(
      'message', to_jsonb(v_message) - 'body_tsv', 'existing', true);
  end if;

  update public.conversations
     set last_message_at = greatest(last_message_at, v_message.created_at)
   where id = p_conversation_id;

  return jsonb_build_object(
    'message', to_jsonb(v_message) - 'body_tsv', 'existing', false);
end $$;


-- ---------------------------------------------------------------------------
-- claim_message_retry — retrying a failed send is a send. A pause that
-- blocked new messages but not retries would leak an unbounded number of
-- them, because every failed row in the workspace's history stays retryable.
--
-- Recreated verbatim from 20260707130000_send_retry_hardening.sql,
-- with the inline subscription test replaced by company_send_block.
-- ---------------------------------------------------------------------------
create or replace function public.claim_message_retry(
  p_company_id          uuid,
  p_message_id          uuid,
  p_stuck_after_seconds int
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_block      text;
  v_company    public.companies%rowtype;
  v_message    public.messages%rowtype;
  v_dest_phone text;
  v_spend_err  text;
begin
  if p_company_id is null or p_message_id is null
     or p_stuck_after_seconds is null or p_stuck_after_seconds < 1 then
    return jsonb_build_object('error', 'validation_failed');
  end if;

  -- Serialize this company's sends through the rate/cap arithmetic (same
  -- lock discipline as gate_outbound_send).
  select c.* into v_company
    from public.companies c
   where c.id = p_company_id
   for update;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;

  -- Lock the row: concurrent retries queue up HERE, and the loser re-reads
  -- the winner's requeued (fresh updated_at) row.
  select m.* into v_message
    from public.messages m
   where m.id = p_message_id
     and m.company_id = p_company_id
   for update;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;

  -- §7 retry rules + #20a: failed with no carrier id, or queued and stale.
  if v_message.direction <> 'outbound'
     or v_message.telnyx_message_id is not null
     or not (
       v_message.status = 'failed'
       or (v_message.status = 'queued'
           and v_message.updated_at
               < now() - make_interval(secs => p_stuck_after_seconds))
     ) then
    return jsonb_build_object('error', 'conflict');
  end if;

  -- #277 pause: the reasons this workspace may not send, asked ONCE.
  --
  -- This was `subscription_status <> 'active' or plan is null`, inline. A
  -- paused workspace is genuinely `active` in Stripe — the pause is a
  -- licensed-PRICE swap, so the status mirror stays truthful — which means
  -- that test passed for a workspace that is paying us a holding fee, and
  -- this backstop quietly stopped being one.
  v_block := public.company_send_block(v_company);
  if v_block is not null then
    return jsonb_build_object('error', v_block);
  end if;

  -- Backstop opt-out mirror (the route pre-checks; matches Gate 2).
  select ct.phone_e164 into v_dest_phone
    from public.conversations conv
    join public.contacts ct on ct.id = conv.contact_id
   where conv.id = v_message.conversation_id
     and conv.company_id = p_company_id;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  if exists (select 1 from public.opt_outs o
              where o.company_id = p_company_id
                and o.phone_e164 = v_dest_phone
                and o.revoked_at is null) then
    return jsonb_build_object('error', 'recipient_opted_out');
  end if;

  -- #20a: fail a stuck-queued row out BEFORE the spend check so its own
  -- estimate leaves the Gate-4 pending sum, and so a rejected retry leaves
  -- the row failed + error-coded (retryable later) instead of stuck queued.
  if v_message.status = 'queued' then
    update public.messages
       set status       = 'failed',
           error_code   = 'send_interrupted',
           error_detail = 'The send was interrupted before reaching the carrier.'
     where id = v_message.id
    returning * into v_message;
  end if;

  -- #47: the SAME rate/cap gates as a fresh send (shared helper,
  -- 20260704090000_auto_reply_respects_send_cap.sql).
  v_spend_err := public.outbound_spend_check(
    p_company_id, coalesce(v_message.segments, 1));
  if v_spend_err is not null then
    return jsonb_build_object('error', v_spend_err);
  end if;

  -- The requeue IS the claim (#19): back to queued, error columns cleared;
  -- moddatetime refreshes updated_at so the row is never immediately "stuck".
  update public.messages
     set status = 'queued', error_code = null, error_detail = null
   where id = v_message.id
  returning * into v_message;

  return jsonb_build_object('message', to_jsonb(v_message) - 'body_tsv');
end $$;


-- ---------------------------------------------------------------------------
-- claim_auto_reply — the away message. Inbound still arrives during a
-- pause, so without this every inbound text answers itself, on our dime,
-- with an away message from a business that is not there.
--
-- Recreated verbatim from 20260728001000_messages_automated.sql,
-- with the inline subscription test replaced by company_send_block.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_auto_reply(p_company_id uuid, p_conversation_id uuid, p_body text, p_segments_estimate integer, p_throttle_seconds integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_block       text;
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

  -- #277 pause: the reasons this workspace may not send, asked ONCE.
  --
  -- This was `subscription_status <> 'active' or plan is null`, inline. A
  -- paused workspace is genuinely `active` in Stripe — the pause is a
  -- licensed-PRICE swap, so the status mirror stays truthful — which means
  -- that test passed for a workspace that is paying us a holding fee, and
  -- this backstop quietly stopped being one.
  v_block := public.company_send_block(v_company);
  if v_block is not null then
    return jsonb_build_object('skipped', v_block);
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
-- claim_emergency_ack — the emergency acknowledgment. The inbox flag is
-- stamped BEFORE this gate and stays that way: a paused workspace still
-- SEES that an emergency arrived, it just does not answer it automatically.
--
-- Recreated verbatim from 20260728001000_messages_automated.sql,
-- with the inline subscription test replaced by company_send_block.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_emergency_ack(p_company_id uuid, p_conversation_id uuid, p_body text, p_segments_estimate integer, p_throttle_seconds integer, p_daily_cap integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_block       text;
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

  -- #277 pause: the reasons this workspace may not send, asked ONCE.
  --
  -- This was `subscription_status <> 'active' or plan is null`, inline. A
  -- paused workspace is genuinely `active` in Stripe — the pause is a
  -- licensed-PRICE swap, so the status mirror stays truthful — which means
  -- that test passed for a workspace that is paying us a holding fee, and
  -- this backstop quietly stopped being one.
  v_block := public.company_send_block(v_company);
  if v_block is not null then
    return jsonb_build_object('skipped', v_block);
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


-- ---------------------------------------------------------------------------
-- claim_missed_call_text — the missed-call text-back.
--
-- The gate is placed BEFORE this function's threading, not after it, so a
-- refused missed-call text writes nothing here at all: no contact, no
-- conversation, no missed_call event. The away-reply comparison does NOT carry
-- over — there the conversation already exists and only the reply is dropped.
--
-- That placement does not cost the crew the call, because this function was
-- never the thing that told them about it. The calls pipeline records an inbound
-- call itself (api_upsert_call) and threads a missed one itself (api_thread_call,
-- create-if-missing for inbound); neither is gated on the pause, so the missed
-- call reaches the inbox by the path that has always owned it. Threading again
-- from here would add rows for a text we are not sending — and re-opening a
-- closed conversation is not free: it pulls a thread the crew deliberately closed
-- back into an inbox nobody is reading this winter.
--
-- Recreated verbatim from 20260804120000_contact_phones.sql,
-- with the inline subscription test replaced by company_send_block.
-- ---------------------------------------------------------------------------
create or replace function public.claim_missed_call_text(
  p_company_id        uuid,
  p_phone_number_id   uuid,
  p_caller_e164       text,
  p_call_id           text,
  p_body              text,
  p_segments_estimate int,
  p_throttle_seconds  int
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_block       text;
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

  -- (3) #277 pause: the reasons this workspace may not send, asked ONCE.
  --
  -- This was `subscription_status <> 'active' or plan is null`, inline. A
  -- paused workspace is genuinely `active` in Stripe — the pause is a
  -- licensed-PRICE swap, so the status mirror stays truthful — which means
  -- that test passed for a workspace that is paying us a holding fee, and
  -- this backstop quietly stopped being one.
  v_block := public.company_send_block(v_company);
  if v_block is not null then
    return jsonb_build_object('skipped', v_block);
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
  -- #291: one of an EXISTING contact's other numbers?
  select cp.contact_id into v_contact_id
    from public.contact_phones cp
   where cp.company_id = p_company_id
     and cp.phone_e164 = p_caller_e164;

  if v_contact_id is not null then
    update public.contacts
       set deleted_at     = null,
           consent_source = coalesce(consent_source, 'inbound_sms'),
           consent_at     = coalesce(consent_at, v_now)
     where id = v_contact_id;
  else
    insert into public.contacts as ct (company_id, phone_e164, consent_source, consent_at)
    values (p_company_id, p_caller_e164, 'inbound_sms', v_now)
    on conflict (company_id, phone_e164) do update
      set deleted_at     = null,
          consent_source = coalesce(ct.consent_source, excluded.consent_source),
          consent_at     = coalesce(ct.consent_at, excluded.consent_at)
    returning ct.id into v_contact_id;
  end if;

  -- Rule 2: open conversation for the triple → use it (waiting → open flip).
  select conv.* into v_conv
    from public.conversations conv
   where conv.company_id = p_company_id
     and conv.phone_number_id = p_phone_number_id
     and conv.contact_id = v_contact_id
     and conv.contact_phone_e164 = p_caller_e164
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
     and conv.contact_phone_e164 = p_caller_e164
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
      insert into public.conversations
        (company_id, contact_id, phone_number_id, contact_phone_e164, status)
      values (p_company_id, v_contact_id, p_phone_number_id, p_caller_e164, 'new')
      on conflict (company_id, phone_number_id, contact_id, contact_phone_e164)
        where closed_at is null
      do nothing
      returning * into v_conv;

      if v_conv.id is null then
        -- Lost the create race: re-select the open row a concurrent thread made.
        select conv.* into v_conv
          from public.conversations conv
         where conv.company_id = p_company_id
           and conv.phone_number_id = p_phone_number_id
           and conv.contact_id = v_contact_id
     and conv.contact_phone_e164 = p_caller_e164
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
     sent_by_user_id)
  values
    (p_company_id, v_conv.id, 'outbound', p_body, 'queued',
     p_segments_estimate, v_company.owner_user_id)
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
end $$;
