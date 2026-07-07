-- #49 + #54 thread/billing edge hardening.
--
-- Part 1 (#49): spam-absorbed inbound must not resurface the spam thread.
--   Threading rule 3 (D7) absorbs inbound into a closed spam conversation
--   "silently" — but the unconditional last_message_at bump after the message
--   insert still ran for spam appends, jumping the thread to the top of the
--   closed/spam lists (which sort AND keyset-paginate on last_message_at) on
--   every message a spammer sends. DECISION: last_message_at stays FROZEN
--   entirely while a conversation is spam — it is the surfacing/sort key, and
--   a silent append must not move the thread. The message rows themselves are
--   still stored (inbound is never dropped, D6) and order the thread by their
--   own created_at; if the conversation is later un-marked, the next non-spam
--   message bumps last_message_at again (greatest() keeps it monotonic).
--   thread_inbound_message is re-created below — identical to the
--   20260707150000 definition except the bump is now guarded by NOT is_spam,
--   checked on the live row under the FOR UPDATE lock the function already
--   holds.
--
-- Part 2 (#54): the day-30 "number released" email joins the grace_notices
--   insert-first ledger. releaseExpiredCompany's email was gated only by a
--   check-then-act on live release state, so two overlapping cron runs could
--   both email, and a run that crashed after releasing (or a Resend blip)
--   meant the email was NEVER sent — the next run returned at the state check.
--   The ledger's threshold_day CHECK gains the synthetic value 30, and every
--   company already in the fully-released state is backfilled with its day-30
--   row so the first post-deploy cron run does not re-email tenants that were
--   already processed (including canceled tenants that never had a number —
--   they must not receive a "your number has been released" email either).

-- ---------------------------------------------------------------------------
-- Part 1: thread_inbound_message — spam appends never bump last_message_at.
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
  v_notify     boolean := false;
  -- #39 per-company daily notification allowance. 200 claims/day is far above
  -- any legitimate 1–10-person shop (each claim is a NEW conversation or a
  -- first-inbound-after-15-min); the warn threshold is 80% of it, matching
  -- the usage-alerts 80/100 ladder.
  v_notify_limit constant int := 200;
  v_notify_warn  constant int := 160;
  v_notify_day   date;
  v_notify_count int;
  v_warned_at    timestamptz;
  v_capped_at    timestamptz;
  v_alert        int; -- null | 80 | 100
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

  -- Duplicate-webhook fast path (Telnyx retries up to 6 times, §7): the first
  -- delivery owns every side effect, including the notification claim.
  select m.* into v_message
    from public.messages m
   where m.telnyx_message_id = p_telnyx_message_id;
  if found then
    return jsonb_build_object(
      'message_id', v_message.id,
      'conversation_id', v_message.conversation_id,
      'created', false,
      'notify', false,
      'notification_alert', null,
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
    -- §8 gate on an append: first inbound after ≥15 min, by last_notified_at.
    v_notify := not v_conv.is_spam
      and (v_conv.last_notified_at is null
           or v_conv.last_notified_at < now() - interval '15 minutes');
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
      -- Rule 3: spam absorb — append silently; stays closed, stays spam,
      -- NEVER notifies (§8).
      v_notify := false;
    elsif found and v_conv.closed_at >= now() - interval '30 days' then
      -- Rule 4: reopen within the 30-day window — "reopened by inbound" is a
      -- §8 trigger in its own right.
      update public.conversations
         set status = 'new', closed_at = null
       where id = v_conv.id
      returning * into v_conv;
      v_notify := true;
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
        -- Lost the creation race: the winner notified for the "new
        -- conversation" trigger; this delivery is an append under the gate.
        v_notify := not v_conv.is_spam
          and (v_conv.last_notified_at is null
               or v_conv.last_notified_at < now() - interval '15 minutes');
      else
        -- A new conversation is a §8 trigger.
        v_notify := true;
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
    -- A concurrent duplicate committed first: report its row, bump nothing,
    -- claim nothing — the winner owns the side effects.
    v_created := false;
    v_notify := false;
    select m.* into v_message
      from public.messages m
     where m.telnyx_message_id = p_telnyx_message_id;
  else
    -- #49: last_message_at is the list surfacing/sort key, so a spam append
    -- (rule 3 "append silently") must NEVER bump it — the spam thread stays
    -- where it was in the closed/spam list, and keyset pages don't shift under
    -- a paginating client. Checked on the live row (held FOR UPDATE above),
    -- so an open-but-spam conversation is frozen too.
    update public.conversations
       set last_message_at = greatest(last_message_at, v_message.created_at)
     where id = v_conv.id
       and not is_spam;
  end if;

  -- #39 budget spend: a won claim consumes one unit of the company's daily
  -- notification allowance. The upsert's row lock serializes concurrent
  -- claims, so the count, the drop, and the one-shot 80%/100% stamps can
  -- never race. Past the ceiling the claim is DROPPED (never queued) — the
  -- message above is already durable; only the alert fan-out is shed.
  if v_notify then
    v_notify_day := (now() at time zone 'utc')::date;
    insert into public.inbound_notification_days as d (company_id, day, notify_count)
    values (p_company_id, v_notify_day, 1)
    on conflict (company_id, day) do update
      set notify_count = d.notify_count + 1
    returning d.notify_count, d.warned_at, d.capped_at
      into v_notify_count, v_warned_at, v_capped_at;

    if v_notify_count >= v_notify_limit and v_capped_at is null then
      update public.inbound_notification_days
         set capped_at = now()
       where company_id = p_company_id and day = v_notify_day;
      v_alert := 100;
    elsif v_notify_count >= v_notify_warn and v_warned_at is null then
      update public.inbound_notification_days
         set warned_at = now()
       where company_id = p_company_id and day = v_notify_day;
      v_alert := 80;
    end if;

    -- The ceiling-th claim itself still delivers (and carries the 100 alert);
    -- everything past it drops. last_notified_at is deliberately NOT stamped
    -- for a dropped claim, so dropped claims keep being counted.
    if v_notify_count > v_notify_limit then
      v_notify := false;
    end if;
  end if;

  -- §8: "notify only if …, THEN STAMP IT" — the stamp commits with the
  -- threading transaction, so the claim is exactly-once per debounce window.
  if v_notify then
    update public.conversations
       set last_notified_at = now()
     where id = v_conv.id;
  end if;

  return jsonb_build_object(
    'message_id', v_message.id,
    'conversation_id', v_message.conversation_id,
    'created', v_created,
    'notify', v_notify,
    'notification_alert', v_alert,
    'opted_out', exists (
      select 1 from public.opt_outs o
       where o.company_id = p_company_id
         and o.phone_e164 = p_from_e164
         and o.revoked_at is null));
end $$;

-- CREATE OR REPLACE preserves ACLs, but restate the SPEC §6 posture so this
-- migration stands alone: service-role-only, like every messaging function.
revoke execute on function
  public.thread_inbound_message(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function
  public.thread_inbound_message(uuid, uuid, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Part 2 (#54): grace_notices learns the synthetic day-30 "released" notice.
-- ---------------------------------------------------------------------------
alter table public.grace_notices
  drop constraint grace_notices_threshold_day_check;
alter table public.grace_notices
  add constraint grace_notices_threshold_day_check
  check (threshold_day in (1, 15, 27, 30));

-- Backfill: every canceled company already in the fully-released state (no
-- non-released number, no active campaign) is stamped as day-30-notified so
-- the first post-deploy cron run cannot re-email an already-processed tenant.
-- This deliberately includes canceled tenants that never provisioned a number:
-- under the old code they never received (and must never receive) a "your
-- number has been released" email. Mid-grace tenants that still hold numbers
-- are NOT stamped — their release + email happen normally at day 30.
insert into public.grace_notices (company_id, canceled_at, threshold_day)
select c.id, c.canceled_at, 30
  from public.companies c
 where c.subscription_status = 'canceled'
   and c.canceled_at is not null
   and not exists (
     select 1 from public.phone_numbers n
      where n.company_id = c.id
        and n.status <> 'released')
   and not exists (
     select 1 from public.messaging_registrations r
      where r.company_id = c.id
        and r.kind = 'campaign'
        and r.telnyx_id is not null
        and r.deactivated_at is null)
on conflict (company_id, canceled_at, threshold_day) do nothing;
