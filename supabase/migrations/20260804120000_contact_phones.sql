-- #291 — a customer has more than one number.
--
-- "Customers have a mobile and a landline; households have two people; a
-- business has a main line and a cell. Today those are separate contacts,
-- which is a duplicate we then need #246 to merge."
--
-- THE DECISION THAT SHAPES THIS FILE: a thread is with a NUMBER, not with a
-- person. Two numbers for one customer are two conversations, both showing the
-- same name — because the alternative is a single thread whose replies go to
-- whichever number we happened to store first, and a text sent to the wrong
-- line looks exactly like a text that vanished.
--
-- So `conversations` records which of the contact's numbers it is with, and
-- the threading invariant grows to include it. Every existing row is
-- backfilled from its contact's number, which is what it has always meant.

-- ---------------------------------------------------------------------------
-- The other numbers.
-- ---------------------------------------------------------------------------
create table public.contact_phones (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  contact_id   uuid not null references public.contacts(id) on delete cascade,
  -- E.164, like every other number in the schema. The API normalises before
  -- it gets here; the check is the backstop that keeps a raw "(416) 555-0199"
  -- from ever being compared against a webhook's `from`.
  phone_e164   text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  -- Free text, and optional. A fixed vocabulary is wrong for the second trade
  -- that uses it: a property manager labels by unit, a household by person.
  label        text check (label is null or length(btrim(label)) between 1 and 80),
  created_at   timestamptz not null default now(),
  constraint contact_phones_label_trimmed check (label is null or label = btrim(label))
);

-- ONE contact per number per workspace, matching what `contacts` already
-- guarantees for primaries. Without it, two contacts could both claim the same
-- landline and an inbound text would resolve to whichever the planner reached
-- first — a routing decision made by a query plan.
create unique index contact_phones_number_uq
  on public.contact_phones (company_id, phone_e164);
create index contact_phones_contact_idx on public.contact_phones (contact_id);

alter table public.contact_phones enable row level security;

-- ---------------------------------------------------------------------------
-- Which of the contact's numbers this thread is with.
-- ---------------------------------------------------------------------------
alter table public.conversations
  add column contact_phone_e164 text;

-- Backfill: every existing conversation is with its contact's number, which is
-- the only number that existed. Done before the NOT NULL so the constraint is
-- true the moment it is declared rather than aspirational.
update public.conversations c
   set contact_phone_e164 = ct.phone_e164
  from public.contacts ct
 where ct.id = c.contact_id
   and c.contact_phone_e164 is null;

-- Left NULLABLE at the column level, and filled by a trigger instead.
--
-- The argument for NOT NULL was that a writer which forgot the column would
-- fail loudly. But a writer that omits it is not WRONG — it is saying "the
-- contact's primary number", which is what every conversation meant before
-- this migration and what the backfill above just wrote. Making that reading
-- explicit costs one trigger; making it fatal would mean an inbound text
-- raising a 500 on any path nobody thought to update, which is the one failure
-- this product cannot afford.
--
-- So: omit it and get the primary. Pass it and get what you passed.
create or replace function public.conversations_default_contact_phone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.contact_phone_e164 is null then
    select ct.phone_e164 into new.contact_phone_e164
      from public.contacts ct
     where ct.id = new.contact_id;
  end if;
  return new;
end $$;

create trigger conversations_default_contact_phone
  before insert on public.conversations
  for each row execute function public.conversations_default_contact_phone();

-- THE THREADING INVARIANT, grown by one column: at most one open conversation
-- per (company, our number, contact, THEIR number). Replacing the old index
-- rather than adding to it — leaving both would make a customer's landline
-- thread collide with their mobile thread on the narrower one.
drop index if exists public.conversations_open_uq;
create unique index conversations_open_uq on public.conversations
  (company_id, phone_number_id, contact_id, contact_phone_e164)
  where closed_at is null;

-- ---------------------------------------------------------------------------
-- Threading, taught about the other numbers.
-- ---------------------------------------------------------------------------
create or replace function public.thread_inbound_message(
  p_company_id        uuid,
  p_phone_number_id   uuid,
  p_from_e164         text,
  p_body              text,
  p_telnyx_message_id text,
  -- #343. All three come from the Worker, which already reads the company row
  -- on this path: the timezone so the day ends when the business's day does,
  -- and the ceilings so they can vary by plan and be overridden per company
  -- without a migration. Defaulted so an older Worker mid-deploy still works —
  -- UTC and the shipped 200 are exactly today's behaviour.
  p_timezone          text default null,
  p_email_limit       int  default 200,
  p_push_limit        int  default 200
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
  -- #391: WHICH §8 trigger fired, not just whether one did.
  v_notify_reason text := 'append';
  -- #39/#343 per-company daily notification allowance, now per CHANNEL. The
  -- metered unit is still the CLAIM — one shared counter — because both
  -- channels fire off the same won claim, and two counters could drift apart
  -- in ways nobody could reason about. Each channel compares that count
  -- against its own ceiling and owns its own 80/100 stamps.
  v_notify_day    date;
  v_notify_count  int;
  v_email_warned  timestamptz;
  v_email_capped  timestamptz;
  v_push_warned   timestamptz;
  v_push_capped   timestamptz;
  v_notify_email  boolean := false;
  v_notify_push   boolean := false;
  v_alerts        jsonb := '[]'::jsonb;
  v_alert         int; -- legacy scalar: the EMAIL crossing, for back-compat
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

  -- #291: is this one of an EXISTING contact's other numbers?
  --
  -- Checked before the upsert, because the upsert would otherwise create a
  -- second contact for the same customer — which is precisely the duplicate
  -- #246 then has to merge. A crew that recorded "Dave's landline" and then
  -- got a text from it would watch the app fail to recognise a number they
  -- had just told it about.
  select cp.contact_id into v_contact_id
    from public.contact_phones cp
   where cp.company_id = p_company_id
     and cp.phone_e164 = p_from_e164;

  if v_contact_id is not null then
    -- The same two facts the upsert stamps, because an inbound text is
    -- consent and a resurrection whichever of their numbers it came from.
    update public.contacts
       set deleted_at     = null,
           consent_source = coalesce(consent_source, 'inbound_sms'),
           consent_at     = coalesce(consent_at, now())
     where id = v_contact_id;
  else
    -- Rule 1: contact upsert — clears deleted_at, stamps inbound consent once.
    insert into public.contacts as ct (company_id, phone_e164, consent_source, consent_at)
    values (p_company_id, p_from_e164, 'inbound_sms', now())
    on conflict (company_id, phone_e164) do update
      set deleted_at     = null,
          consent_source = coalesce(ct.consent_source, excluded.consent_source),
          consent_at     = coalesce(ct.consent_at, excluded.consent_at)
    returning ct.id into v_contact_id;
  end if;

  -- Rule 2: open conversation for the triple → append (waiting → open).
  select c.* into v_conv
    from public.conversations c
   where c.company_id = p_company_id
     and c.phone_number_id = p_phone_number_id
     and c.contact_id = v_contact_id
     and c.contact_phone_e164 = p_from_e164
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
     and c.contact_phone_e164 = p_from_e164
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
      v_notify_reason := 'reopened';
    else
      -- Rule 5: create a new conversation; on a concurrent create the partial
      -- unique index wins the race and the open row is re-selected.
      insert into public.conversations
        (company_id, contact_id, phone_number_id, contact_phone_e164, status)
      values (p_company_id, v_contact_id, p_phone_number_id, p_from_e164, 'new')
      -- The arbiter has to name the index EXACTLY. Left at the old three
      -- columns it would match no index and raise, turning every first inbound
      -- from a customer into a 500.
      on conflict (company_id, phone_number_id, contact_id, contact_phone_e164)
        where closed_at is null
      do nothing
      returning * into v_conv;

      if v_conv.id is null then
        select c.* into v_conv
          from public.conversations c
         where c.company_id = p_company_id
           and c.phone_number_id = p_phone_number_id
           and c.contact_id = v_contact_id
     and c.contact_phone_e164 = p_from_e164
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
        v_notify_reason := 'new';
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

  -- #39/#343 budget spend: a won claim consumes one unit of the company's
  -- daily allowance. The upsert's row lock serializes concurrent claims, so
  -- the count, the drops, and the one-shot stamps can never race. Past a
  -- channel's ceiling that channel is DROPPED (never queued) — the message
  -- above is already durable; only the alert fan-out is shed.
  if v_notify then
    -- #343: the business's day, not UTC's. Keying on a UTC date meant the
    -- counter reset at 5pm in Vancouver and 9pm in Halifax — mid-afternoon in
    -- the busiest stretch of a trades day, and never at an hour that matched
    -- anyone's working day. An unknown zone falls back to UTC rather than
    -- raising: this runs inside the inbound webhook, and a bad timezone must
    -- not wedge threading for every message the company receives.
    begin
      v_notify_day := (now() at time zone coalesce(p_timezone, 'utc'))::date;
    exception when invalid_parameter_value or undefined_object then
      v_notify_day := (now() at time zone 'utc')::date;
    end;

    insert into public.inbound_notification_days as d
      (company_id, day, notify_count, email_limit, push_limit)
    values (p_company_id, v_notify_day, 1, p_email_limit, p_push_limit)
    on conflict (company_id, day) do update
      -- Re-stamped every claim: a limit changed mid-day takes effect at once,
      -- which is the whole point of making it runtime-configurable.
      set notify_count = d.notify_count + 1,
          email_limit  = excluded.email_limit,
          push_limit   = excluded.push_limit
    returning d.notify_count, d.email_warned_at, d.email_capped_at,
              d.push_warned_at, d.push_capped_at
      into v_notify_count, v_email_warned, v_email_capped,
           v_push_warned, v_push_capped;

    -- EMAIL ladder.
    if v_notify_count >= p_email_limit and v_email_capped is null then
      update public.inbound_notification_days set email_capped_at = now()
       where company_id = p_company_id and day = v_notify_day;
      v_alerts := v_alerts || jsonb_build_object('channel', 'email', 'threshold', 100);
      v_alert := 100;
    elsif v_notify_count >= (p_email_limit * 8 / 10) and v_email_warned is null then
      update public.inbound_notification_days set email_warned_at = now()
       where company_id = p_company_id and day = v_notify_day;
      v_alerts := v_alerts || jsonb_build_object('channel', 'email', 'threshold', 80);
      v_alert := 80;
    end if;

    -- PUSH ladder, against its own much higher ceiling. Push is free at both
    -- ends (Web Push and FCM charge nothing); its cap is a runaway guard, not
    -- a budget, so a workspace that exhausts email keeps getting notified.
    if v_notify_count >= p_push_limit and v_push_capped is null then
      update public.inbound_notification_days set push_capped_at = now()
       where company_id = p_company_id and day = v_notify_day;
      v_alerts := v_alerts || jsonb_build_object('channel', 'push', 'threshold', 100);
    elsif v_notify_count >= (p_push_limit * 8 / 10) and v_push_warned is null then
      update public.inbound_notification_days set push_warned_at = now()
       where company_id = p_company_id and day = v_notify_day;
      v_alerts := v_alerts || jsonb_build_object('channel', 'push', 'threshold', 80);
    end if;

    -- The ceiling-th claim itself still delivers (and carries the 100 alert);
    -- everything past it drops. last_notified_at is deliberately NOT stamped
    -- for a fully dropped claim, so dropped claims keep being counted.
    v_notify_email := v_notify_count <= p_email_limit;
    v_notify_push  := v_notify_count <= p_push_limit;
    v_notify := v_notify_email or v_notify_push;
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
    -- Legacy scalar = the EMAIL verdict, deliberately. A Worker still running
    -- mid-deploy reads only `notify`; making it the email answer means it can
    -- under-deliver free push, and can never over-spend metered email.
    'notify', v_notify_email,
    'notify_email', v_notify_email,
    'notify_push', v_notify_push,
    -- #391: 'new' | 'reopened' | 'append'. A first inbound on a new or
    -- reopened thread is a LEAD and the push must wake a phone in Doze; an
    -- append to a thread somebody is already working is not worth the battery.
    'notify_reason', v_notify_reason,
    'notification_alert', v_alert,
    'notification_alerts', v_alerts,
    'opted_out', exists (
      select 1 from public.opt_outs o
       where o.company_id = p_company_id
         and o.phone_e164 = p_from_e164
         and o.revoked_at is null));
end $$;

grant execute on function public.thread_inbound_message(uuid, uuid, text, text, text, text, int, int)
  to service_role;

-- ---------------------------------------------------------------------------
-- api_thread_call, taught the same lesson.
-- ---------------------------------------------------------------------------
create or replace function public.api_thread_call(
  p_company_id       uuid,
  p_phone_number_id  uuid,
  p_caller_e164      text,
  p_call_session_id  text,
  p_outcome          text,
  p_forward_seconds  int,
  p_create_if_missing boolean,
  p_direction        text default 'inbound'
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now        timestamptz := now();
  v_contact_id uuid;
  v_conv       public.conversations%rowtype;
  v_inserted   boolean := false;
begin
  if p_caller_e164 is null or length(p_caller_e164) = 0 then
    return '{}'::jsonb;
  end if;

  -- #291: one of an EXISTING contact's other numbers? Asked BEFORE the
  -- create branch, so a call from a landline the crew recorded resolves to the
  -- customer it belongs to even on the paths that may not create a contact.
  select cp.contact_id into v_contact_id
    from public.contact_phones cp
   where cp.company_id = p_company_id
     and cp.phone_e164 = p_caller_e164;

  if v_contact_id is not null then
    -- A call is inbound contact, the same as a text: clear the soft delete and
    -- stamp consent once, whichever of their numbers it came from.
    update public.contacts
       set deleted_at     = null,
           consent_source = coalesce(consent_source, 'inbound_sms'),
           consent_at     = coalesce(consent_at, v_now)
     where id = v_contact_id;
  elsif p_create_if_missing then
    insert into public.contacts as ct (company_id, phone_e164, consent_source, consent_at)
    values (p_company_id, p_caller_e164, 'inbound_sms', v_now)
    on conflict (company_id, phone_e164) do update
      set deleted_at     = null,
          consent_source = coalesce(ct.consent_source, excluded.consent_source),
          consent_at     = coalesce(ct.consent_at, excluded.consent_at)
    returning ct.id into v_contact_id;
  else
    select ct.id into v_contact_id
      from public.contacts ct
     where ct.company_id = p_company_id
       and ct.phone_e164 = p_caller_e164
       and ct.deleted_at is null;
    if not found then
      return '{}'::jsonb;
    end if;
  end if;

  select conv.* into v_conv
    from public.conversations conv
   where conv.company_id = p_company_id
     and conv.phone_number_id = p_phone_number_id
     and conv.contact_id = v_contact_id
     and conv.closed_at is null
   for update;

  if not found then
    if not p_create_if_missing then
      return '{}'::jsonb;
    end if;

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
      -- The arbiter names the index exactly; the old three columns match no
      -- index now and would raise on every first call from a customer.
      on conflict (company_id, phone_number_id, contact_id, contact_phone_e164)
        where closed_at is null
      do nothing
      returning * into v_conv;

      if v_conv.id is null then
        select conv.* into v_conv
          from public.conversations conv
         where conv.company_id = p_company_id
           and conv.phone_number_id = p_phone_number_id
           and conv.contact_id = v_contact_id
       and conv.contact_phone_e164 = p_caller_e164
           and conv.closed_at is null
         for update;
        if not found then
          raise exception 'api_thread_call: lost conversation race for company %', p_company_id;
        end if;
      end if;
    end if;
  end if;

  if not exists (
    select 1 from public.conversation_events e
     where e.company_id = p_company_id
       and e.conversation_id = v_conv.id
       and e.type = 'call_completed'
       and e.payload->>'call_session_id' = p_call_session_id
  ) then
    insert into public.conversation_events
      (company_id, conversation_id, actor_user_id, type, payload)
    values
      (p_company_id, v_conv.id, null, 'call_completed',
       jsonb_build_object(
         'call_session_id', p_call_session_id,
         'outcome', p_outcome,
         'forward_seconds', coalesce(p_forward_seconds, 0),
         'caller', p_caller_e164,
         'direction', coalesce(nullif(p_direction, ''), 'inbound')));
    update public.conversations
       set last_message_at = greatest(coalesce(last_message_at, v_now), v_now)
     where id = v_conv.id;
    v_inserted := true;
  end if;

  return jsonb_build_object(
    'contact_id', v_contact_id,
    'conversation_id', v_conv.id,
    'event_inserted', v_inserted);
end;
$$;

-- ---------------------------------------------------------------------------
-- claim_missed_call_text, taught the same lesson.
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

