-- FEATURE-GAPS BUILD-NOW voice wave — atomic missed-call text-back claim
-- (Step 1) and the hosted text-enablement slot claim (keep-your-number). A NEW
-- migration (never edits a shipped one, D7/D14). Both are SECURITY DEFINER,
-- service-role-only RPCs (SPEC §6 RLS posture): the Worker calls them with the
-- sb_secret_ / service_role key; end-user roles never reach PostgREST.

-- ===========================================================================
-- claim_missed_call_text — the missed-call text-back's atomic claim (Step 1).
--
-- A caller who DIALS our number initiated contact, so the text-back is a REPLY
-- (reply-exempt, D4) — no consent, no quiet-hours. This one RPC does, under the
-- company row lock so a retried Call-Control webhook can NEVER double-text:
--   0. per-call idempotency — checked FIRST (before any threading write, so a
--      replayed webhook has zero side effects): a 'missed_call' event whose
--      payload->>'call_id' equals p_call_id already exists → if its claimed
--      text is still §7-retryable (queued, or failed with no telnyx id), hand
--      the SAME row back ({..., replayed:true}) so the sweeper's replay
--      re-dispatches it; a Telnyx-accepted row returns { skipped:'duplicate' }.
--   1. thread the CALLER into a conversation exactly like an inbound text
--      (contact upsert on UNIQUE(company,phone) clearing deleted_at + stamping
--      inbound consent; find-or-reopen-or-create the conversation for the
--      (company, number, contact) triple — the same D7 threading rules as
--      thread_inbound_message, minus the message insert). A missed CALL is an
--      inbound contact event, so it threads the same way a text does.
--   2. opt-out mirror — never text an opted-out caller (even reply-exempt).
--   3. subscription active backstop (the caller pre-checks send gates).
--   4. throttle — reuse conversations.last_auto_reply_at (the shared guard's
--      per-conversation throttle): one auto-text per conversation per window, so
--      a caller who calls repeatedly (or calls then texts) is texted once.
-- On success it inserts the queued booking-forward SMS (body already merge-
-- applied + footer-free), stamps last_auto_reply_at, logs 'missed_call' (actor
-- NULL, payload carries call_id for idempotency + the text message_id), and
-- returns the row for dispatchOutbound.
--
-- The p_body is ALREADY merge-field-applied and footer-free (reply-exempt).
-- p_call_id is the Telnyx call_session_id (or call_control_id) — the stable
-- per-call key the webhook passes for idempotency.
--
-- Returns jsonb:
--   { "skipped": "duplicate" | "recipient_opted_out" | "throttled"
--                | "subscription_inactive" | "not_found" }
--   or { "message": <messages row, body_tsv stripped>,
--        "conversation_id": <uuid>, "created_conversation": <bool> }.
-- ===========================================================================
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
  v_company     public.companies%rowtype;
  v_contact_id  uuid;
  v_conv        public.conversations%rowtype;
  v_created_conv boolean := false;
  v_last_auto   timestamptz;
  v_message     public.messages%rowtype;
  v_now         timestamptz := now();
  v_prior_payload jsonb;
  v_prior_conv    uuid;
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

revoke execute on function
  public.claim_missed_call_text(uuid, uuid, text, text, text, int, int)
  from public, anon, authenticated;
grant execute on function
  public.claim_missed_call_text(uuid, uuid, text, text, text, int, int)
  to service_role;

-- ===========================================================================
-- claim_text_enablement_slot — atomic slot claim for keep-your-number
-- text-enablement (the landline hosted-SMS path). Mirrors provision_number_slot
-- / claim_port_slot: locks the company row, counts non-released numbers (a
-- hosted number holds the same one slot as a provisioned/ported one), applies
-- the §4.2 sole-prop cap and the plan limit, and — on 'created' — inserts the
-- source='hosted', status='provisioning' phone_numbers row PLUS the
-- text_enablement_orders row. Idempotent on the provisioning_key (Idempotency-
-- Key replay → 'exists').
--
-- Outcomes (jsonb { outcome, number, order }):
--   created       — phone_numbers + text_enablement_orders rows inserted.
--   exists        — this provisioning key already claimed a slot (idempotent).
--   plan_limit    — non-released numbers >= the plan allowance (409).
--   sole_prop_cap — §4.2: sole-prop brand and a non-released number exists (409).
-- ===========================================================================
create or replace function public.claim_text_enablement_slot(
  p_company_id       uuid,
  p_provisioning_key text,
  p_phone_e164       text,
  p_country          text,
  p_max_numbers      int
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_order public.text_enablement_orders%rowtype;
  v_number         public.phone_numbers%rowtype;
  v_order          public.text_enablement_orders%rowtype;
  v_count          int;
  v_sole_prop      boolean;
begin
  if p_provisioning_key is null or length(trim(p_provisioning_key)) = 0 then
    raise exception 'claim_text_enablement_slot: provisioning key is required';
  end if;
  if p_phone_e164 is null or length(trim(p_phone_e164)) = 0 then
    raise exception 'claim_text_enablement_slot: phone_e164 is required';
  end if;
  if p_max_numbers is null or p_max_numbers < 1 then
    raise exception 'claim_text_enablement_slot: p_max_numbers must be >= 1';
  end if;
  if p_country not in ('US', 'CA') then
    raise exception 'claim_text_enablement_slot: country must be US or CA';
  end if;

  -- Serialize per company: concurrent claims queue here (count is authoritative).
  perform 1 from public.companies where id = p_company_id for update;
  if not found then
    raise exception 'claim_text_enablement_slot: company % not found', p_company_id;
  end if;

  -- Idempotent replay: same Idempotency-Key returns the same rows.
  select * into v_existing_order
    from public.text_enablement_orders
   where provisioning_key = p_provisioning_key;
  if found then
    if v_existing_order.company_id <> p_company_id then
      raise exception 'claim_text_enablement_slot: provisioning key belongs to another company';
    end if;
    select * into v_number from public.phone_numbers
     where id = v_existing_order.phone_number_id;
    return jsonb_build_object('outcome', 'exists',
      'number', to_jsonb(v_number), 'order', to_jsonb(v_existing_order));
  end if;

  select count(*) into v_count
    from public.phone_numbers
   where company_id = p_company_id and status <> 'released';

  select exists (
    select 1 from public.messaging_registrations mr
     where mr.company_id = p_company_id and mr.kind = 'brand' and mr.sole_proprietor
  ) into v_sole_prop;

  if v_sole_prop and v_count >= 1 then
    return jsonb_build_object('outcome', 'sole_prop_cap', 'number', null, 'order', null);
  end if;
  if v_count >= p_max_numbers then
    return jsonb_build_object('outcome', 'plan_limit', 'number', null, 'order', null);
  end if;

  -- The phone_numbers row: source='hosted', number known already (the owner's
  -- existing number), status='provisioning' until enablement completes. The
  -- provisioning_key backstops idempotency on the phone_numbers unique too.
  -- phone_numbers_e164_uq (global, partial on status <> 'released') rejects a
  -- number already live on JobText — for ANY tenant (own active number, a
  -- mid-port number, another company's number). Surface that as a first-class
  -- outcome (§7 conflict), never a raw 500. Race-safe: the company row lock
  -- above serializes same-company claims, and the unique index itself is the
  -- cross-company arbiter.
  begin
    insert into public.phone_numbers
      (company_id, status, source, provisioning_key, country, number_e164)
    values
      (p_company_id, 'provisioning', 'hosted', p_provisioning_key, p_country, p_phone_e164)
    returning * into v_number;
  exception when unique_violation then
    return jsonb_build_object('outcome', 'number_taken', 'number', null, 'order', null);
  end;

  insert into public.text_enablement_orders
    (company_id, phone_number_id, phone_e164, country, provisioning_key, status)
  values
    (p_company_id, v_number.id, p_phone_e164, p_country, p_provisioning_key, 'pending')
  returning * into v_order;

  return jsonb_build_object('outcome', 'created',
    'number', to_jsonb(v_number), 'order', to_jsonb(v_order));
end $$;

revoke execute on function
  public.claim_text_enablement_slot(uuid, text, text, text, int)
  from public, anon, authenticated;
grant execute on function
  public.claim_text_enablement_slot(uuid, text, text, text, int)
  to service_role;
