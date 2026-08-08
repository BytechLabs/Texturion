-- #553 — being told about an emergency and texting the customer back are two
-- different decisions, and there was one switch for both.
--
-- ## What the founder said
--
-- "Why do we have urgent message reply enforced? This should be configurable like
-- they want it in or off.. don't enforce things like these with our own replies or
-- messages."
--
-- ## The premise is half right, and the half that is wrong matters
--
-- It is NOT enforced: `emergency_keyword_enabled` exists and is reachable on all
-- three clients. Reporting it as enforced was wrong and is worth saying so.
--
-- But that one boolean gates FOUR things — whether an emergency word is recognised
-- at all, whether the crew is escalated to and pushed, whether the thread is
-- flagged URGENT in the inbox, and whether we text the customer back. So the only
-- way to stop us sending a message on the crew's behalf was to stop the product
-- noticing emergencies. That is not a configuration, it is a trade nobody should
-- have to make.
--
-- ## The split
--
-- `emergency_keyword_enabled` keeps its meaning: notice, escalate, push, flag.
-- The new column decides only whether a message goes out.
--
-- DEFAULT TRUE, deliberately. Every workspace behaves tomorrow exactly as it does
-- today; a silent behaviour change on a shipped safety surface needs a stronger
-- argument than tidiness. What changes is that the choice now exists.
--
-- ## What no setting will ever turn off
--
-- `EMERGENCY_SAFETY_LINE` still rides on every reply that DOES go out (#414 ask 4,
-- narrowed by #460). The owner writes the message; they do not decide whether the
-- alternative is named, because the person reading it may be in danger and did not
-- choose this vendor. Turning the reply off entirely is honest — silence makes no
-- promise. Sending reassurance with the alternative stripped out is not.
--
-- ## Why the function below is a verbatim copy plus one block
--
-- It was EXTRACTED from 20260805060000_paid_pause.sql, which holds the current
-- definition, and one gate was inserted. The first attempt at this migration
-- retyped the body from reading it and produced a DIFFERENT SIGNATURE — which in
-- Postgres would have created a second overload, left the real function untouched,
-- and shipped as a silent no-op. A `create or replace` written from memory is a
-- rewrite whether or not it is meant as one.

alter table public.companies
  add column if not exists emergency_reply_enabled boolean not null default true;

comment on column public.companies.emergency_reply_enabled is
  '#553: whether we text the customer back when an emergency word arrives. '
  'SEPARATE from emergency_keyword_enabled, which decides whether we notice at '
  'all - the crew escalation, the push and the inbox flag. One boolean used to '
  'gate both, so the only way to stop us messaging on the crew''s behalf was to '
  'stop the product noticing emergencies. Default true: existing workspaces are '
  'unchanged, and the choice now exists.';

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

  -- #553: whether we TEXT THE CUSTOMER BACK is now its own choice, and it is
  -- decided here — after the inbox flag and the timeline event, before every send
  -- gate below.
  --
  -- One boolean used to gate four things: noticing the emergency, escalating to
  -- the crew, flagging the thread, and messaging the customer. So the only way to
  -- stop us sending a message on somebody's behalf was to stop the product
  -- noticing emergencies at all. The founder objected to that and was right.
  --
  -- Placed after the flag on purpose: a workspace with the reply off still gets
  -- everything that TELLS the crew, and loses only the message it did not want us
  -- to send.
  --
  -- Its own outcome string rather than reusing 'emergency_disabled', because a log
  -- has to distinguish "told not to notice" from "noticed, told not to reply".
  if not coalesce(v_company.emergency_reply_enabled, true) then
    return jsonb_build_object('skipped', 'reply_disabled', 'flagged', true);
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
