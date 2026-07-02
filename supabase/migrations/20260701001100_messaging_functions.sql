-- SPEC §4, §6, §7, §9, §10 — messaging-track SQL functions (messaging track).
--
-- The Worker talks to Postgres through PostgREST only (SPEC §3): the two
-- multi-statement transactional paths — inbound threading and outbound send
-- gating — are `security definer` SQL functions invoked via RPC, so each runs
-- atomically inside PostgREST's per-request transaction.
--
-- Both functions are service-role-only: end-user roles never touch PostgREST
-- (SPEC §6 RLS posture), and EXECUTE is revoked from everyone else.

-- ---------------------------------------------------------------------------
-- thread_inbound_message — the §6/§4 threading invariant, atomically.
--
-- On inbound message from phone P to number N of company C:
--   1. Upsert contact on UNIQUE(company_id, phone_e164); the upsert clears
--      deleted_at (inbound resurrects a soft-deleted contact) and stamps
--      inbound-SMS consent when the contact has none (§5).
--   2. Open conversation for (C, N, contact) → append; waiting → open flip.
--   3. Else most recent closed conversation is spam → append silently
--      (stays closed, stays spam).
--   4. Else closed within 30 days → reopen (closed_at NULL, status 'new').
--   5. Else create a new conversation (status 'new').
--
-- Race safety (SPEC §6): conversation creation targets the partial unique
-- index conversations_open_uq with ON CONFLICT DO NOTHING + re-select; the
-- message insert is idempotent on messages_telnyx_id_uq the same way, so two
-- concurrent identical webhook deliveries produce exactly one message and the
-- loser reports created = false (its caller skips side effects).
--
-- Returns jsonb: { message_id, conversation_id, created, opted_out }.
--   created   — false when the telnyx_message_id had already been recorded
--               (duplicate webhook delivery).
--   opted_out — an active opt_outs row exists for (company, from-phone); the
--               caller's pipeline uses it (opted-out threads still store
--               inbound messages — inbound is never blocked, §5).
-- ---------------------------------------------------------------------------
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

  -- Duplicate-webhook fast path (Telnyx retries up to 6 times, §7).
  select m.* into v_message
    from public.messages m
   where m.telnyx_message_id = p_telnyx_message_id;
  if found then
    return jsonb_build_object(
      'message_id', v_message.id,
      'conversation_id', v_message.conversation_id,
      'created', false,
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
      -- Rule 3: spam absorb — append silently; stays closed, stays spam.
      null;
    elsif found and v_conv.closed_at >= now() - interval '30 days' then
      -- Rule 4: reopen within the 30-day window.
      update public.conversations
         set status = 'new', closed_at = null
       where id = v_conv.id
      returning * into v_conv;
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
    -- A concurrent duplicate committed first: report its row, bump nothing.
    v_created := false;
    select m.* into v_message
      from public.messages m
     where m.telnyx_message_id = p_telnyx_message_id;
  else
    update public.conversations
       set last_message_at = greatest(last_message_at, v_message.created_at)
     where id = v_conv.id;
  end if;

  return jsonb_build_object(
    'message_id', v_message.id,
    'conversation_id', v_message.conversation_id,
    'created', v_created,
    'opted_out', exists (
      select 1 from public.opt_outs o
       where o.company_id = p_company_id
         and o.phone_e164 = p_from_e164
         and o.revoked_at is null));
end $$;

revoke execute on function
  public.thread_inbound_message(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function
  public.thread_inbound_message(uuid, uuid, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- gate_outbound_send — the atomic DB-side send gates (SPEC §7, §9, §10) plus
-- the insert-before-Telnyx-call queued message row (§8, D10).
--
-- The route has already enforced (in §7 gate order): membership, subscription
-- `active`, US/CA destination, and the per-destination registration gate.
-- This function re-checks subscription as a backstop and then performs the
-- checks that must be atomic with the insert, in order:
--   1. subscription_inactive  — companies.subscription_status <> 'active'.
--   2. recipient_opted_out    — active opt_outs row for the destination (§5).
--   3. rate_limited           — trailing-hour outbound segment sum ≥ 250
--                               (§10 layer 3; estimates via messages.segments,
--                               which holds the shared-estimator value until
--                               Telnyx's finalized parts overwrite it).
--   4. usage_cap_reached      — period outbound segments (finalized
--                               usage_events + queued-but-unfinalized
--                               estimates, §9) + this send would exceed
--                               overage_cap_multiplier × plan quota (§2;
--                               NULL multiplier = no cap).
--
-- The company row is locked FOR UPDATE so concurrent sends for one company
-- serialize through the rate/cap arithmetic (no read-check-insert race).
--
-- Idempotency (D10): a (company_id, idempotency_key) hit — before or via the
-- partial unique index at insert — returns the existing row with
-- existing = true; the route then returns it with 200 and never calls Telnyx.
--
-- Returns jsonb:
--   { "error": "subscription_inactive" | "recipient_opted_out" |
--              "rate_limited" | "usage_cap_reached" | "not_found" |
--              "validation_failed" }
--   or
--   { "message": <messages row, body_tsv stripped>, "existing": boolean }.
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

  -- Gate 1: subscription must be active (§7; plan set at first checkout).
  if v_company.subscription_status <> 'active' or v_company.plan is null then
    return jsonb_build_object('error', 'subscription_inactive');
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

revoke execute on function
  public.gate_outbound_send(uuid, uuid, uuid, text, text, int)
  from public, anon, authenticated;
grant execute on function
  public.gate_outbound_send(uuid, uuid, uuid, text, text, int)
  to service_role;
