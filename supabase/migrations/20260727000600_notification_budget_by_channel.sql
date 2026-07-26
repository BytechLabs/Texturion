-- ===========================================================================
-- [#343] The inbound notification budget: the business's day, per channel,
-- and a number that is not welded into a migration.
--
-- The alerting shape is preserved exactly — ledger-first, exactly-once,
-- warn-then-cap, alert raised before the member fan-out. That design is right
-- and none of it changes. What changes is the three things around it.
--
-- 1. THE DAY WAS UTC. D15 established `companies.timezone` precisely so
--    business-facing daily framing uses the shop's clock. This ledger ignored
--    it, so for a Vancouver business the notification day rolled over at 5pm
--    local: a busy morning could exhaust the budget, notifications went silent
--    through the afternoon — the busiest stretch of a trades day — and the
--    counter reset as the crew packed up. Halifax rolled at 9pm. Every
--    timezone got a different arbitrary hour and none matched a working day.
--    It also makes the 100% alert's "paused until tomorrow" true for the first
--    time.
--
-- 2. 200 WAS A CONSTANT IN A MIGRATION, identical for a sole proprietor and a
--    ten-tech crew, unraisable for a customer who needed more, unlowerable
--    during an abuse event. The ceilings are parameters now, resolved per plan
--    in apps/api/src/billing/plans.ts and overridable per company.
--
-- 3. ONE NUMBER GOVERNED TWO VERY DIFFERENT COSTS. The 200 was sized to bound
--    a Resend bill; D45 then retired missed-call emails as noise and the mix
--    moved to push, which is free at both ends. A limit sized for email was
--    throttling notifications that cost essentially nothing.
--
-- THE METERED UNIT IS STILL THE CLAIM. One counter, two ceilings, two stamp
-- pairs. Both channels fire off the same won claim, so a shared counter is the
-- only shape in which the two ladders cannot drift apart.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- companies.timezone had no constraint, which is what tempted the day-key
-- computation below into swallowing errors silently. Give it the same shape
-- check contacts.timezone got (#292), so rubbish cannot reach the column in
-- the first place and the exception handler is a genuine backstop rather than
-- the only line of defence.
--
-- Deliberately loose: Postgres cannot see the runtime's tzdata, and a strict
-- list here would go stale every time IANA renames a zone. The API validates
-- against Intl.DateTimeFormat.
-- ---------------------------------------------------------------------------
alter table public.companies
  drop constraint if exists companies_timezone_shape;
alter table public.companies
  add constraint companies_timezone_shape
  check (
    timezone = 'UTC'
    or timezone ~ '^[A-Za-z][A-Za-z_+-]*/[A-Za-z0-9_+/-]+$'
  );

-- ---------------------------------------------------------------------------
-- Per-company ceiling overrides. OPS-ONLY, and deliberately NOT on
-- PATCH /v1/company: a spending ceiling the customer can raise is not a
-- ceiling (the #12 un-defeatable-cap posture). NULL means "use the plan's".
-- ---------------------------------------------------------------------------
alter table public.companies
  add column if not exists notify_email_limit int
    check (notify_email_limit is null or notify_email_limit between 0 and 100000);
alter table public.companies
  add column if not exists notify_push_limit int
    check (notify_push_limit is null or notify_push_limit between 0 and 100000);

comment on column public.companies.notify_email_limit is
  '#343: ops-only override of the plan daily inbound-notification EMAIL ceiling. NULL = use the plan default.';
comment on column public.companies.notify_push_limit is
  '#343: ops-only override of the plan daily inbound-notification PUSH ceiling. NULL = use the plan default.';

-- ---------------------------------------------------------------------------
-- The ledger grows a stamp pair per channel, and records which ceilings were
-- in force — so a row read weeks later says what the limit WAS, not what it is
-- now.
--
-- warned_at/capped_at are RENAMED rather than kept and shadowed: leaving a
-- bare `capped_at` beside `push_capped_at` invites exactly one misreading, and
-- the only readers are this function and its tests.
-- ---------------------------------------------------------------------------
alter table public.inbound_notification_days
  rename column warned_at to email_warned_at;
alter table public.inbound_notification_days
  rename column capped_at to email_capped_at;
alter table public.inbound_notification_days
  add column if not exists push_warned_at timestamptz;
alter table public.inbound_notification_days
  add column if not exists push_capped_at timestamptz;
alter table public.inbound_notification_days
  add column if not exists email_limit int;
alter table public.inbound_notification_days
  add column if not exists push_limit int;

-- The day key changes meaning for a company west of UTC: their local date is
-- BEHIND the UTC one, so the first post-deploy claim lands on a row that
-- already holds a full day's count under the old keying, and would read as
-- instantly capped. Clear the counts and stamps for the two days that can
-- collide, so the first local day starts clean.
--
-- destructive-ok: zeroes at most two days of a rate-limit counter, whose only
-- effect is to give every workspace a fresh notification allowance on the day
-- this deploys. No customer-visible record is touched.
update public.inbound_notification_days
   set notify_count = 0, email_warned_at = null, email_capped_at = null
 where day >= (now() at time zone 'utc')::date - 1;

-- ---------------------------------------------------------------------------
-- The 5-argument form has to GO, not merely be superseded.
--
-- The new signature adds three defaulted parameters, so a 5-argument call
-- matches both and Postgres refuses it outright:
--
--   ERROR: function public.thread_inbound_message(uuid, uuid, unknown, unknown,
--          unknown) is not unique
--
-- That is every inbound text failing, not a deprecation warning. Dropping and
-- recreating a routine to change its signature is the normal idiom here and
-- changes no rows.
-- ---------------------------------------------------------------------------
drop function if exists public.thread_inbound_message(uuid, uuid, text, text, text);

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
    'notification_alert', v_alert,
    'notification_alerts', v_alerts,
    'opted_out', exists (
      select 1 from public.opt_outs o
       where o.company_id = p_company_id
         and o.phone_e164 = p_from_e164
         and o.revoked_at is null));
end $$;;

-- ---------------------------------------------------------------------------
-- [#343] What a member sees when their notifications have been suppressed.
--
-- At the cap, notifications stop reaching EVERY member and only the owner is
-- emailed. A tech's phone simply goes quiet, and from their side the business
-- had a slow afternoon — the same shape as #342 (a spam thread absorbing
-- messages) and #306 (a count that stopped at the page size): the product
-- stops reporting work without saying so, and the reasonable inference is
-- "nothing is happening".
--
-- `resets_at` is the company's next LOCAL midnight — the number the alert copy
-- has been implying and getting wrong in every timezone.
--
-- One statement, `language sql`: this rides an endpoint every client polls on
-- a timer, so it gets neither a plpgsql frame nor a second table read.
-- ---------------------------------------------------------------------------
create or replace function public.api_notification_pause(p_company_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'email_paused', coalesce(d.notify_count >= d.email_limit, false),
    'push_paused',  coalesce(d.notify_count >= d.push_limit, false),
    'resets_at',
      ((date_trunc('day', now() at time zone c.timezone) + interval '1 day')
         at time zone c.timezone))
  from public.companies c
  left join public.inbound_notification_days d
    on d.company_id = c.id
   and d.day = (now() at time zone c.timezone)::date
  where c.id = p_company_id
$$;

revoke execute on function public.api_notification_pause(uuid)
  from public, anon, authenticated;
grant execute on function public.api_notification_pause(uuid) to service_role;

revoke execute on function public.thread_inbound_message(uuid, uuid, text, text, text, text, int, int)
  from public, anon, authenticated;
grant execute on function public.thread_inbound_message(uuid, uuid, text, text, text, text, int, int)
  to service_role;
