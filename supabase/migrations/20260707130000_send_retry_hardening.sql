-- Launch-audit send/retry hardening (#19, #20, #22, #47):
--
--   #22  webhook_events gains claimed_at — a per-row sweep lease so two
--        overlapping cron runs can never dispatch the same event twice
--        (check-then-act handlers downstream would double-submit a 10DLC
--        campaign = a duplicated recurring carrier fee). The claim itself is
--        an atomic CAS UPDATE issued by the sweeper (attempts is the token);
--        the lease expires so a crashed claimer's row is retried.
--
--   #19/#20/#47  claim_message_retry — the ONE atomic arbiter for
--        POST /v1/messages/:id/retry. It re-checks eligibility, re-runs the
--        rate/cap arithmetic (outbound_spend_check, #47), and performs the
--        failed→queued flip under the company + message row locks, so exactly
--        one of two concurrent retries wins (#19; the loser gets 'conflict').
--        It also accepts a QUEUED outbound stuck without a telnyx_message_id
--        beyond a safety window (#20a): a send that crashed between the gate
--        insert and the Telnyx call is undeliverable AND — before this — was
--        unretryable.
--
--   #20b fail_stuck_outbound_sends — the sweeper primitive: fail out stale
--        queued outbound rows (status 'failed' + error_code) so they surface
--        in the thread with the existing retry affordance and stop consuming
--        the period usage cap's pending sum.

-- ---------------------------------------------------------------------------
-- #22: the sweep claim lease.
-- ---------------------------------------------------------------------------
alter table public.webhook_events
  add column claimed_at timestamptz;

comment on column public.webhook_events.claimed_at is
  'Sweep claim lease (#22): stamped (with an attempts bump, CAS on attempts) '
  'by the ONE sweeper run that owns this row. Overlapping runs skip a live '
  'claim; an expired lease (crashed claimer) is re-claimable.';

-- ---------------------------------------------------------------------------
-- #20b: the stuck-queued sweep scans a tiny population — index it so the
-- 5-minute cadence never seq-scans the messages table.
-- ---------------------------------------------------------------------------
create index messages_stuck_queued_idx on public.messages (updated_at)
  where direction = 'outbound' and status = 'queued'
    and telnyx_message_id is null;

-- ---------------------------------------------------------------------------
-- claim_message_retry — the atomic retry arbiter (#19, #20a, #47).
--
-- The route has already run the friendly pre-checks (membership, active
-- sending number, pre-send gates, opt-out, mms module). This function owns
-- everything that must be atomic:
--   1. Locks the company row FOR UPDATE — the SAME serialization point
--      gate_outbound_send and the claim_* auto-send RPCs use, so the rate/cap
--      arithmetic below never races another send.
--   2. Locks the message row FOR UPDATE — two concurrent retries serialize
--      here; the loser re-reads the winner's freshly-requeued row and fails
--      eligibility (#19: one Telnyx call, ever).
--   3. Eligibility (§7 retry rules + the #20a extension): an outbound with
--      telnyx_message_id IS NULL that is 'failed', OR 'queued' and untouched
--      for p_stuck_after_seconds (updated_at is moddatetime-maintained: the
--      requeue below refreshes it, so a just-requeued row is never "stuck").
--   4. A stuck-queued row is failed out FIRST ('send_interrupted') so the
--      Gate-4 pending sum no longer counts it, and so a rejected retry leaves
--      it visible + retryable instead of stuck forever.
--   5. #47: outbound_spend_check re-runs the SAME rate-limit + overage-cap
--      arithmetic a fresh send gets (failed rows sit outside the pending sum,
--      so the row's own estimate never double-counts itself).
--   6. The failed→queued flip, error columns cleared.
--
-- Returns jsonb:
--   { "error": 'not_found' | 'conflict' | 'validation_failed' |
--              'subscription_inactive' | 'recipient_opted_out' |
--              'rate_limited' | 'usage_cap_reached' }
--   or
--   { "message": <requeued messages row, body_tsv stripped> }.
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

  -- Backstop subscription check (the route pre-checks; belt-and-braces —
  -- matches gate_outbound_send Gate 1).
  if v_company.subscription_status <> 'active' or v_company.plan is null then
    return jsonb_build_object('error', 'subscription_inactive');
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

revoke execute on function
  public.claim_message_retry(uuid, uuid, int)
  from public, anon, authenticated;
grant execute on function
  public.claim_message_retry(uuid, uuid, int)
  to service_role;

-- ---------------------------------------------------------------------------
-- fail_stuck_outbound_sends — the #20b sweeper primitive.
--
-- Fails out every outbound row still 'queued' with no telnyx_message_id whose
-- updated_at is older than p_stuck_after_seconds: the send crashed between
-- the gate insert and the Telnyx call (Storage failure, event-insert failure,
-- Worker eviction), so the message will never go out on its own. Flipping to
-- 'failed' + 'send_interrupted' (a) surfaces it in the thread with the
-- existing retry affordance and (b) stops it consuming the period cap's
-- pending sum. The threshold is far beyond any Worker request's wall clock,
-- so an in-flight dispatch is never clobbered. Returns the flipped count.
-- ---------------------------------------------------------------------------
create or replace function public.fail_stuck_outbound_sends(
  p_stuck_after_seconds int
) returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if p_stuck_after_seconds is null or p_stuck_after_seconds < 1 then
    raise exception 'fail_stuck_outbound_sends: p_stuck_after_seconds must be a positive integer';
  end if;

  update public.messages
     set status       = 'failed',
         error_code   = 'send_interrupted',
         error_detail = 'The send was interrupted before reaching the carrier.'
   where direction = 'outbound'
     and status = 'queued'
     and telnyx_message_id is null
     and updated_at < now() - make_interval(secs => p_stuck_after_seconds);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke execute on function
  public.fail_stuck_outbound_sends(int)
  from public, anon, authenticated;
grant execute on function
  public.fail_stuck_outbound_sends(int)
  to service_role;
