-- claim_review_request v2 — a rate-limited (never-dispatched) review ask must
-- not burn the one-per-job claim. A NEW migration (20260703040000 is shipped;
-- never edit a shipped one, D7/D14) re-creating the function with ONE change.
--
-- The hole (found in review, FEATURE-GAPS §3 + SPEC §10 layer-3 interplay):
-- the claim inserts the queued message AND the 'review_requested' event before
-- Telnyx is called; when dispatchOutbound is then DENIED by the per-company
-- SEND_RATE_LIMITER it persists status='failed' + telnyx_message_id NULL (the
-- §7-retryable shape) and throws 429 "try again in a moment" — but the next
-- tap matched the event and 409'd 'already_requested' for the full 30-day
-- suppression window. The 429 copy directly contradicted the behavior.
--
-- The fix: the suppression scan ignores review_requested events whose claimed
-- message NEVER reached Telnyx (status='failed' AND telnyx_message_id IS NULL)
-- — the ask demonstrably never went out, so re-asking is the intended path.
-- ONLY the failed shape is excluded: a 'queued' row is mid-dispatch (the
-- seconds between claim commit and the Telnyx accept), and excluding it would
-- let a double-tap race in a second ask. A later successful manual retry of
-- the failed row stamps telnyx_message_id, making its event suppress again —
-- one-per-job holds for everything that actually reached the customer.
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

  -- (b) One-per-job suppression, part 1: a recent review ask on this thread —
  -- ignoring asks whose text never reached Telnyx (failed, no telnyx id): a
  -- rate-limiter denial must not burn the claim (see header).
  select max(e.created_at) into v_last_review
    from public.conversation_events e
   where e.company_id = p_company_id
     and e.conversation_id = p_conversation_id
     and e.type = 'review_requested'
     and not exists (
       select 1 from public.messages m
        where m.id = (e.payload->>'message_id')::uuid
          and m.company_id = p_company_id
          and m.status = 'failed'
          and m.telnyx_message_id is null
     );

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

-- Same grants posture as the original (service-role-only; SPEC §6).
revoke execute on function
  public.claim_review_request(uuid, uuid, uuid, text, int, int)
  from public, anon, authenticated;
grant execute on function
  public.claim_review_request(uuid, uuid, uuid, text, int, int)
  to service_role;
