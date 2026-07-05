-- #12 Pricing Phase 0 — auto-sends must respect the SAME send cap + rate limit
-- as a manual send. Today claim_auto_reply (and claim_missed_call_text, handled
-- in a follow-up migration) insert + dispatch an outbound SMS WITHOUT running
-- gate_outbound_send's Gate 3 (250 segments / trailing hour) or Gate 4 (overage
-- cap). An away-reply is a billed outbound send; letting it bypass the cap the
-- customer's own manual sends obey is a plain bug and an abuse vector (a flood
-- of first-inbounds from distinct numbers → uncapped auto-replies on our dollar
-- when the card later fails). See docs/PRICING-AUDIT.md.
--
-- The fix is a SHARED read-only helper so the cap/rate logic has ONE source of
-- truth instead of being copied into each auto-send RPC.

-- ---------------------------------------------------------------------------
-- outbound_spend_check — the rate + overage-cap verdict for one prospective
-- outbound send of `p_segments_estimate` segments. Returns NULL when the send
-- is allowed, else the same error code gate_outbound_send returns
-- ('rate_limited' | 'usage_cap_reached' | 'not_found'). Read-only (no lock, no
-- insert) — callers already hold the company row lock. The arithmetic MIRRORS
-- gate_outbound_send Gates 3-4 (20260701001100_messaging_functions.sql); keep
-- the two in sync (a SQL test asserts they agree on the thresholds).
-- ---------------------------------------------------------------------------
create or replace function public.outbound_spend_check(
  p_company_id        uuid,
  p_segments_estimate int
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company        public.companies%rowtype;
  v_quota          int;
  v_cap            numeric;
  v_hour_segments  bigint;
  v_period_used    bigint;
  v_period_pending bigint;
  v_period_start   timestamptz;
begin
  if p_segments_estimate is null or p_segments_estimate < 1 then
    return 'validation_failed';
  end if;

  select c.* into v_company
    from public.companies c
   where c.id = p_company_id;
  if not found then
    return 'not_found';
  end if;

  -- Gate 3: 250 segments per trailing hour.
  select coalesce(sum(coalesce(m.segments, 1)), 0) into v_hour_segments
    from public.messages m
   where m.company_id = p_company_id
     and m.direction = 'outbound'
     and m.created_at > now() - interval '1 hour';
  if v_hour_segments >= 250 then
    return 'rate_limited';
  end if;

  -- Gate 4: overage cap (finalized usage this period + queued-but-unfinalized
  -- estimates + this send). A NULL multiplier still means "no soft cap" here —
  -- the un-defeatable system ceiling is a separate Phase 0 item.
  if v_company.overage_cap_multiplier is not null then
    v_quota := case v_company.plan when 'starter' then 500 when 'pro' then 2500 end;
    v_cap := v_company.overage_cap_multiplier * v_quota;
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
      return 'usage_cap_reached';
    end if;
  end if;

  return null;
end $$;
revoke execute on function public.outbound_spend_check(uuid, int)
  from public, anon, authenticated;
grant execute on function public.outbound_spend_check(uuid, int)
  to service_role;

-- ---------------------------------------------------------------------------
-- claim_auto_reply — re-created verbatim from 20260703040000_send_features_
-- functions.sql with ONE change: after the per-conversation throttle and before
-- the insert, it now runs outbound_spend_check and skips (no insert, no
-- dispatch, no throttle stamp) when the send would breach the rate limit or the
-- overage cap — reusing the existing 'skipped' contract the caller already
-- handles. Everything else is unchanged.
-- ---------------------------------------------------------------------------
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
