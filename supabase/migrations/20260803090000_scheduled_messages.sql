-- #233 — send later: the text written at 9:40pm that should land Monday 8am.
--
-- ---------------------------------------------------------------------------
-- WHY A SEPARATE TABLE AND NOT A `messages` STATUS
--
-- The obvious shape is a `messages` row in a new 'scheduled' state, and #233's
-- scope asks for "real rows in a pending state". It is the wrong shape here,
-- and the reason is blast radius rather than taste: every existing read model,
-- every client list, every unread count and every test that asserts on message
-- status would have to learn to exclude one new value. Miss one and a thread
-- shows an unsent message as sent — which is the single worst bug this feature
-- can have, because the sender believes the customer has been told something
-- they have not.
--
-- A scheduled message is also not the same KIND of thing as a message. It has
-- no delivery status, no segments billed, no carrier id, and it may never
-- become a message at all. Modelling it as one means every one of those columns
-- is meaningless-but-present on a scheduled row.
--
-- So: its own table, and NOTHING reads it by accident. It becomes a `messages`
-- row at fire time, through the same insert every other outbound send uses.
--
-- ---------------------------------------------------------------------------
-- EXACTLY ONCE, BY REUSING MACHINERY THAT ALREADY EXISTS
--
-- #233 asks for "exactly once, with no duplicate on retry". Firing is therefore
-- split in two:
--
--   1. `api_claim_due_scheduled_messages` LEASES due rows (`for update skip
--      locked` + a claim stamp). Two workers in the same minute cannot both
--      take one, and a worker that dies mid-flight releases its rows when the
--      lease ages out rather than stranding them forever.
--   2. `api_fire_scheduled_message` inserts the outbound `messages` row in
--      state 'queued' and marks the scheduled row 'sent' IN ONE STATEMENT.
--
-- The gap that remains — crash after (2) but before Telnyx — is a 'queued' row
-- with no `telnyx_message_id`, which is precisely what `job:retry-interrupted-
-- sends` already looks for and re-dispatches (#411). So the crash window is
-- covered by a job that has existed since before this feature, and there is no
-- second retry mechanism to keep correct.
--
-- ---------------------------------------------------------------------------
-- HELD, NOT DROPPED — AND THE HOLD HAS A HORIZON
--
-- `docs/DECISIONS.md` fixed the rule for queued work BEFORE this feature
-- existed, against #325, and it is binding:
--
--   1. a scheduled send that fires while outbound is blocked is HELD, not
--      dropped, and resumes on reinstatement if it is still meaningful;
--   2. anything held or cancelled is DISCLOSED to the owner when it happens —
--      "silent disappearance is the one unacceptable option";
--   3. time-sensitive work EXPIRES rather than arriving late.
--
-- Hence `status`, `held_reason` and `expires_at` are all NOT optional extras:
-- (1) is the 'held' state, (2) is why every terminal state carries a reason a
-- human can read, and (3) is why `expires_at` is NOT NULL. A held message with
-- no horizon is how a follow-up arrives a fortnight late.
--
-- ---------------------------------------------------------------------------
-- WHOSE 8AM?
--
-- `apps/api/src/messaging/destination-clock.ts` resolves a destination's clock
-- on three rungs — the contact's own timezone, one derived from their area
-- code, or the workspace's — and says so honestly on the weakest rung. A
-- scheduled send stores the rung it was picked against, because "Monday 8am"
-- against a non-geographic number with no contact override is the SHOP's 8am
-- wearing a label, and the UI must be able to say that rather than imply a
-- precision we do not have.
--
-- Stored, not re-derived at fire time, deliberately: the sender chose a wall
-- clock, and a contact edited in between must not silently move a send they
-- already scheduled.

create table if not exists public.scheduled_messages (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,

  body            text not null check (char_length(btrim(body)) between 1 and 1600),

  -- The instant it should go. Absolute, so a timezone edit cannot move it.
  send_at         timestamptz not null,

  -- Which rung of the destination-clock ladder `send_at` was chosen against,
  -- so the UI can be honest about whose clock it is. See the header.
  clock_timezone  text not null,
  clock_source    text not null
                    check (clock_source in ('contact', 'area_code', 'company')),

  status          text not null default 'pending'
                    check (status in ('pending', 'held', 'sent',
                                      'canceled', 'expired', 'failed')),

  -- Why it is not going, in a form a person can read. Non-null for every
  -- non-terminal-success state, because rule (2) above makes silence the one
  -- unacceptable outcome.
  held_reason     text,
  held_at         timestamptz,

  -- Rule (3): the hold has a horizon. A follow-up that arrives a fortnight
  -- late is worse than one that never arrives, and the expiry is disclosed.
  expires_at      timestamptz not null,

  -- #233: "if the customer replies before the scheduled message fires, flag it
  -- rather than firing a now-stale text". This is the conversation's newest
  -- inbound at scheduling time; a newer one at fire time means the thread moved
  -- on and "still thinking about that quote?" would read as a bot talking over
  -- someone who already answered.
  inbound_watermark timestamptz,

  sent_message_id uuid references public.messages(id) on delete set null,

  -- The firing lease. See the header: `for update skip locked` picks the row,
  -- this stamp keeps a second worker off it, and an aged stamp releases a row
  -- whose worker died rather than stranding it.
  claimed_at      timestamptz,

  canceled_at     timestamptz,
  canceled_by     uuid references auth.users(id) on delete set null,

  created_by      uuid not null references auth.users(id) on delete restrict,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.scheduled_messages is
  '#233: an outbound text not yet sent. Deliberately NOT a messages row — see '
  'the migration header. Becomes one at fire time via api_fire_scheduled_'
  'message, which runs the same insert every other outbound send uses.';

comment on column public.scheduled_messages.clock_source is
  '#233: which rung of the destination-clock ladder send_at was picked '
  'against. On the weakest rung (company) this is the shop''s clock, not the '
  'customer''s, and the UI must say so rather than imply we know theirs.';

comment on column public.scheduled_messages.expires_at is
  '#325 rule 3, binding before this feature existed: time-sensitive work '
  'expires rather than arriving late. NOT NULL because a held message with no '
  'horizon is how a follow-up lands a fortnight after it meant anything.';

comment on column public.scheduled_messages.inbound_watermark is
  '#233: the newest inbound at scheduling time. A newer one at fire time means '
  'the customer already answered, and the scheduled text would talk over them.';

-- The firing scan, and the only hot read this table has: due, unclaimed, one
-- indexed lookup that returns nothing in a quiet minute. Partial so its size
-- tracks pending work rather than history.
create index if not exists scheduled_messages_due_idx
  on public.scheduled_messages (send_at)
  where status = 'pending';

-- Held rows waiting on either reinstatement or their horizon.
create index if not exists scheduled_messages_held_idx
  on public.scheduled_messages (expires_at)
  where status = 'held';

-- "What is scheduled in this thread" and "what is scheduled at all", which are
-- the two reads the clients make.
create index if not exists scheduled_messages_thread_idx
  on public.scheduled_messages (company_id, conversation_id, send_at);

create index if not exists scheduled_messages_workspace_idx
  on public.scheduled_messages (company_id, status, send_at);

alter table public.scheduled_messages enable row level security;
revoke all on public.scheduled_messages from public, anon, authenticated;
grant select, insert, update, delete on public.scheduled_messages to service_role;

-- ---------------------------------------------------------------------------
-- Caps, set before anybody asks rather than after a bill.
--
-- Every pending row is future work the firing job must consider, and the scan
-- is per minute forever. Two hundred pending per workspace is far above any
-- crew using this as intended; twenty per thread stops one conversation
-- becoming a drip campaign nobody remembers arming.
--
-- The horizon cap is a different argument: a send scheduled two years out will
-- almost certainly be wrong by the time it fires (the customer, the price, the
-- business), and it holds a promise this product has no way to keep. Ninety
-- days is past any seasonal follow-up a trade actually makes.
-- ---------------------------------------------------------------------------
create or replace function public.scheduled_messages_per_company_cap()
  returns integer language sql immutable as $$ select 200 $$;

create or replace function public.scheduled_messages_per_thread_cap()
  returns integer language sql immutable as $$ select 20 $$;

create or replace function public.scheduled_messages_horizon_days()
  returns integer language sql immutable as $$ select 90 $$;

-- ---------------------------------------------------------------------------
-- Schedule one.
--
-- Returns a `{ outcome }` sentinel rather than raising, matching
-- api_create_saved_view: a cap or a time in the past is something to tell
-- somebody, not an exception.
--
-- The caps are counted INSIDE the function so the check and the insert cannot
-- straddle a concurrent create.
-- ---------------------------------------------------------------------------
create or replace function public.api_schedule_message(
  p_company_id      uuid,
  p_conversation_id uuid,
  p_user_id         uuid,
  p_body            text,
  p_send_at         timestamptz,
  p_clock_timezone  text,
  p_clock_source    text,
  p_expires_at      timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_count integer;
  v_thread_count  integer;
  v_watermark     timestamptz;
  v_row           public.scheduled_messages;
begin
  -- The conversation must belong to the caller's workspace. Checked here and
  -- not only in the route because this function is SECURITY DEFINER: a bug in
  -- one caller must not be able to schedule into another tenant's thread.
  if not exists (
    select 1 from public.conversations c
     where c.id = p_conversation_id and c.company_id = p_company_id
  ) then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if p_send_at <= now() then
    return jsonb_build_object('outcome', 'in_the_past');
  end if;

  if p_send_at > now() + make_interval(
       days => public.scheduled_messages_horizon_days()) then
    return jsonb_build_object(
      'outcome', 'too_far_out',
      'limit_days', public.scheduled_messages_horizon_days());
  end if;

  select count(*) into v_company_count
    from public.scheduled_messages s
   where s.company_id = p_company_id
     and s.status in ('pending', 'held');

  if v_company_count >= public.scheduled_messages_per_company_cap() then
    return jsonb_build_object(
      'outcome', 'company_cap',
      'limit', public.scheduled_messages_per_company_cap());
  end if;

  select count(*) into v_thread_count
    from public.scheduled_messages s
   where s.conversation_id = p_conversation_id
     and s.status in ('pending', 'held');

  if v_thread_count >= public.scheduled_messages_per_thread_cap() then
    return jsonb_build_object(
      'outcome', 'thread_cap',
      'limit', public.scheduled_messages_per_thread_cap());
  end if;

  -- The newest inbound right now. Compared at fire time to notice that the
  -- customer answered in the meantime.
  select max(m.created_at) into v_watermark
    from public.messages m
   where m.conversation_id = p_conversation_id
     and m.direction = 'inbound';

  insert into public.scheduled_messages (
    company_id, conversation_id, body, send_at,
    clock_timezone, clock_source, expires_at, inbound_watermark, created_by)
  values (
    p_company_id, p_conversation_id, btrim(p_body), p_send_at,
    p_clock_timezone, p_clock_source, p_expires_at, v_watermark, p_user_id)
  returning * into v_row;

  return jsonb_build_object('outcome', 'scheduled',
                            'scheduled_message', to_jsonb(v_row));
end;
$$;

revoke execute on function public.api_schedule_message(
  uuid, uuid, uuid, text, timestamptz, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_schedule_message(
  uuid, uuid, uuid, text, timestamptz, text, text, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- Lease the due ones.
--
-- `for update skip locked` so two workers in the same minute take disjoint
-- sets rather than blocking on each other. The claim stamp is a LEASE, not a
-- state change: a worker that dies between claiming and firing leaves rows that
-- become due again once the stamp ages past p_lease_seconds, instead of
-- stranding a customer's message forever in a state nothing scans.
--
-- Held rows are included once they are due again, which is what "resumes on
-- reinstatement" means in practice — the hold reason is re-evaluated at the
-- next fire attempt rather than by a separate reinstatement hook that would
-- have to be wired into every subsystem that can block a send.
-- ---------------------------------------------------------------------------
create or replace function public.api_claim_due_scheduled_messages(
  p_now           timestamptz,
  p_limit         integer,
  p_lease_seconds integer default 300
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  with due as (
    select s.id
      from public.scheduled_messages s
     where s.status in ('pending', 'held')
       and s.send_at <= p_now
       and (s.claimed_at is null
            or s.claimed_at < p_now - make_interval(secs => p_lease_seconds))
     order by s.send_at
     limit p_limit
     for update skip locked
  ),
  claimed as (
    update public.scheduled_messages s
       set claimed_at = p_now,
           updated_at = now()
      from due
     where s.id = due.id
    returning s.*
  )
  select coalesce(jsonb_agg(to_jsonb(claimed)), '[]'::jsonb)
    into v_rows
    from claimed;

  return v_rows;
end;
$$;

revoke execute on function public.api_claim_due_scheduled_messages(
  timestamptz, integer, integer) from public, anon, authenticated;
grant execute on function public.api_claim_due_scheduled_messages(
  timestamptz, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Fire one: the outbound row and the state change, in one statement.
--
-- This is the half that makes "exactly once" true. The caller has already run
-- the pre-send gates for THIS destination at THIS moment; this function turns
-- the intent into a real queued message and closes the scheduled row so no
-- later scan can pick it up again.
--
-- Guarded on `status in ('pending','held')` so a concurrent cancel wins: if the
-- row moved on while the gates were running, this updates nothing and returns
-- `{ outcome: 'gone' }` rather than sending a message somebody just cancelled.
-- ---------------------------------------------------------------------------
create or replace function public.api_fire_scheduled_message(
  p_id                 uuid,
  p_segments_estimate  integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scheduled public.scheduled_messages;
  v_message   public.messages;
begin
  select * into v_scheduled
    from public.scheduled_messages s
   where s.id = p_id
     and s.status in ('pending', 'held')
   for update;

  if not found then
    return jsonb_build_object('outcome', 'gone');
  end if;

  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments,
     sent_by_user_id)
  values
    (v_scheduled.company_id, v_scheduled.conversation_id, 'outbound',
     v_scheduled.body, 'queued', p_segments_estimate, v_scheduled.created_by)
  returning * into v_message;

  update public.scheduled_messages s
     set status = 'sent',
         sent_message_id = v_message.id,
         held_reason = null,
         updated_at = now()
   where s.id = p_id;

  return jsonb_build_object('outcome', 'fired',
                            'message', to_jsonb(v_message));
end;
$$;

revoke execute on function public.api_fire_scheduled_message(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.api_fire_scheduled_message(uuid, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- Hold one, with a reason somebody can read.
--
-- Rule (2) is why `p_reason` is not optional: a message that stops without a
-- stated cause is the silent disappearance #325 rules out. The reason travels
-- to the owner through the notification the caller raises; this stores it so
-- the workspace view and the thread can show the same words later.
-- ---------------------------------------------------------------------------
create or replace function public.api_hold_scheduled_message(
  p_id     uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.scheduled_messages;
begin
  update public.scheduled_messages s
     set status = 'held',
         held_reason = p_reason,
         held_at = coalesce(s.held_at, now()),
         claimed_at = null,
         updated_at = now()
   where s.id = p_id
     and s.status in ('pending', 'held')
  returning * into v_row;

  if not found then
    return jsonb_build_object('outcome', 'gone');
  end if;
  return jsonb_build_object('outcome', 'held',
                            'scheduled_message', to_jsonb(v_row));
end;
$$;

revoke execute on function public.api_hold_scheduled_message(uuid, text)
  from public, anon, authenticated;
grant execute on function public.api_hold_scheduled_message(uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Fail one that cannot be retried, with its reason.
-- ---------------------------------------------------------------------------
create or replace function public.api_fail_scheduled_message(
  p_id     uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.scheduled_messages;
begin
  update public.scheduled_messages s
     set status = 'failed',
         held_reason = p_reason,
         claimed_at = null,
         updated_at = now()
   where s.id = p_id
     and s.status in ('pending', 'held')
  returning * into v_row;

  if not found then
    return jsonb_build_object('outcome', 'gone');
  end if;
  return jsonb_build_object('outcome', 'failed',
                            'scheduled_message', to_jsonb(v_row));
end;
$$;

revoke execute on function public.api_fail_scheduled_message(uuid, text)
  from public, anon, authenticated;
grant execute on function public.api_fail_scheduled_message(uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Cancel one, by a person.
--
-- Distinct from 'expired' and 'failed' on purpose: those are things that
-- happened TO the message, and this is somebody deciding. The workspace view
-- shows them differently because "you cancelled this" and "we could not send
-- this" are not the same news.
-- ---------------------------------------------------------------------------
create or replace function public.api_cancel_scheduled_message(
  p_id         uuid,
  p_company_id uuid,
  p_user_id    uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.scheduled_messages;
begin
  update public.scheduled_messages s
     set status = 'canceled',
         canceled_at = now(),
         canceled_by = p_user_id,
         claimed_at = null,
         updated_at = now()
   where s.id = p_id
     and s.company_id = p_company_id
     and s.status in ('pending', 'held')
  returning * into v_row;

  if not found then
    return jsonb_build_object('outcome', 'gone');
  end if;
  return jsonb_build_object('outcome', 'canceled',
                            'scheduled_message', to_jsonb(v_row));
end;
$$;

revoke execute on function public.api_cancel_scheduled_message(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.api_cancel_scheduled_message(uuid, uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Expire whatever has run out of horizon.
--
-- Rule (3). Returns the expired rows rather than a count, because rule (2)
-- requires each one to be disclosed and the caller cannot disclose what it
-- cannot see.
-- ---------------------------------------------------------------------------
create or replace function public.api_expire_scheduled_messages(
  p_now   timestamptz,
  p_limit integer default 200
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  with stale as (
    select s.id
      from public.scheduled_messages s
     where s.status in ('pending', 'held')
       and s.expires_at <= p_now
     order by s.expires_at
     limit p_limit
     for update skip locked
  ),
  expired as (
    update public.scheduled_messages s
       set status = 'expired',
           held_reason = coalesce(s.held_reason,
                                  'the send window passed before it could go'),
           claimed_at = null,
           updated_at = now()
      from stale
     where s.id = stale.id
    returning s.*
  )
  select coalesce(jsonb_agg(to_jsonb(expired)), '[]'::jsonb)
    into v_rows
    from expired;

  return v_rows;
end;
$$;

revoke execute on function public.api_expire_scheduled_messages(
  timestamptz, integer) from public, anon, authenticated;
grant execute on function public.api_expire_scheduled_messages(
  timestamptz, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Closing a workspace cancels what it had queued, WITH NOTICE.
--
-- The degradation matrix in docs/DECISIONS.md says "cancelled with notice" for
-- queued/scheduled work at closure. Doing it here, in the same migration that
-- creates the table, so the row cannot outlive the workspace that owns it and
-- fire into a number that has been released.
-- ---------------------------------------------------------------------------
create or replace function public.api_cancel_scheduled_for_company(
  p_company_id uuid,
  p_reason     text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  with canceled as (
    update public.scheduled_messages s
       set status = 'canceled',
           held_reason = p_reason,
           canceled_at = now(),
           claimed_at = null,
           updated_at = now()
     where s.company_id = p_company_id
       and s.status in ('pending', 'held')
    returning s.*
  )
  select coalesce(jsonb_agg(to_jsonb(canceled)), '[]'::jsonb)
    into v_rows
    from canceled;

  return v_rows;
end;
$$;

revoke execute on function public.api_cancel_scheduled_for_company(uuid, text)
  from public, anon, authenticated;
grant execute on function public.api_cancel_scheduled_for_company(uuid, text)
  to service_role;
