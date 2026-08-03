-- ---------------------------------------------------------------------------
-- #244 — who is holding the phone tonight, and what happens if nobody answers.
--
-- Today every after-hours alert goes to every member who can see the number.
-- That produces two opposite failures, and the issue names both:
--
--   ALERT FATIGUE. A tech woken for a call that was not theirs turns off
--   notifications, and then misses the ones that WERE theirs. The workspace
--   stays "active" in our metrics while the humans have checked out — which is
--   why this failure leaves no trace and kills communication tools quietly.
--
--   DIFFUSION OF RESPONSIBILITY. Four people see a 2am emergency and each
--   assumes another is handling it.
--
-- For the trades this is margin, not comfort: a 2am plumbing emergency is the
-- highest-paid job there is, and a crew that answers reliably charges for it.
-- A crew that answers by accident, sometimes, cannot.
--
-- ---------------------------------------------------------------------------
-- THIS IS A DIFFERENT AXIS FROM #225, AND CONFLATING THEM WOULD BE A LEGAL BUG
--
-- #225's quiet hours govern OUTBOUND messages to customers: a legal send window
-- enforced by regulators. Everything here governs alerts to OUR OWN USERS, who
-- have an employment relationship with the workspace and can be woken for an
-- emergency by agreement. They share the word "hours" and nothing else. Nothing
-- in this migration may ever be read by the send path, and nothing in #225's
-- may narrow who gets paged — a crew that silenced its own 2am alerts must not
-- thereby become allowed to text customers at 2am.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Who is on call, and when.
--
-- A SHIFT WITH AN OWNER, not a flag on a member. "Sam is on call" with no end
-- is the state every small crew ends up stuck in — nobody remembers to turn it
-- off, Sam stops answering, and the product is silently back to waking
-- everybody. An interval expires on its own.
--
-- The issue asks for "at minimum 'this member is on call tonight', ideally a
-- repeating rotation". This is the minimum done properly: a rotation generates
-- rows of exactly this shape, so adding one later writes a generator rather
-- than a migration that reinterprets what is already here.
-- ---------------------------------------------------------------------------
create table if not exists public.on_call_shifts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,

  -- WHO is holding it. A member, and their access is checked when the alert is
  -- routed rather than here: a member can be put on call for a workspace and
  -- still be denied a specific number under #106, and the alert must respect
  -- that at the moment it fires.
  user_id     uuid not null references auth.users(id) on delete cascade,

  -- WHICH line, when a workspace runs more than one. NULL = the whole
  -- workspace, which is what a one-number crew always means.
  phone_number_id uuid references public.phone_numbers(id) on delete cascade,

  starts_at   timestamptz not null,
  ends_at     timestamptz not null,

  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),

  constraint on_call_shifts_window_ck check (ends_at > starts_at)
);

comment on table public.on_call_shifts is
  '#244: who is holding the phone for a window. Alerts to OUR USERS only — '
  'never consulted by the outbound send path, which answers to #225.';

-- The routing read, run on every after-hours alert: "who is on call for this
-- number, right now?"
create index if not exists on_call_shifts_window_idx
  on public.on_call_shifts (company_id, starts_at, ends_at);

alter table public.on_call_shifts enable row level security;
revoke all on public.on_call_shifts from public, anon, authenticated;
grant select, insert, update, delete on public.on_call_shifts to service_role;

-- ---------------------------------------------------------------------------
-- An alert that is waiting to be acknowledged.
--
-- WHY THE ROW EXISTS AT ALL. Without it "unacknowledged" is not a state
-- anything can observe, so an alert that nobody answers simply evaporates —
-- which is the failure the issue calls out by name. This row is what lets a
-- sweep widen it.
--
-- It is deliberately NOT a notification. The push is best-effort and already
-- sent; this records the RESPONSIBILITY, which outlives any particular device.
-- ---------------------------------------------------------------------------
create table if not exists public.alert_escalations (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,

  -- What happened. Free-form by design: every fan-out that can wake somebody
  -- after hours writes one, and a CHECK here would mean a migration every time
  -- a new alert learns to escalate.
  kind            text not null,

  -- WHO it went to first. Null when there was no on-call member and it went
  -- wide immediately — a real state, and the one an owner should see in order
  -- to notice nobody is holding the phone.
  on_call_user_id uuid references auth.users(id) on delete set null,

  -- When this widens to everyone. Null once acknowledged or already widened.
  escalate_at     timestamptz,

  -- Who claimed it, and when. THE fix for diffusion of responsibility: one
  -- person's name on it, visible to the rest.
  acknowledged_at    timestamptz,
  acknowledged_by    uuid references auth.users(id) on delete set null,

  escalated_at    timestamptz,

  created_at      timestamptz not null default now()
);

comment on table public.alert_escalations is
  '#244: an after-hours alert waiting for a human. Exists so an unanswered '
  'alert can WIDEN rather than evaporate, and so acknowledging can clear it '
  'from everyone else''s phone.';

-- The sweep's only read: what is due to widen. Partial, because the answer is
-- almost always nothing and this runs on a schedule.
create index if not exists alert_escalations_due_idx
  on public.alert_escalations (escalate_at)
  where escalate_at is not null and acknowledged_at is null;

-- "Is this thread already somebody's problem?" — read when a second alert on
-- the same conversation is about to wake the same people again.
create index if not exists alert_escalations_open_idx
  on public.alert_escalations (company_id, conversation_id, created_at desc);

alter table public.alert_escalations enable row level security;
revoke all on public.alert_escalations from public, anon, authenticated;
grant select, insert, update, delete on public.alert_escalations to service_role;

-- ---------------------------------------------------------------------------
-- How long a page waits before it widens.
--
-- Ten minutes. Long enough that somebody genuinely asleep can wake, find the
-- phone and tap; short enough that a customer with a burst pipe has not given
-- up and called a competitor. It is a column rather than a constant because
-- the right number differs by trade — a locksmith's ten minutes is an HVAC
-- shop's half hour — and because an owner who cannot change it will solve the
-- problem by turning the whole feature off.
-- ---------------------------------------------------------------------------
alter table public.companies
  add column if not exists on_call_escalate_after_minutes integer not null default 10;

comment on column public.companies.on_call_escalate_after_minutes is
  '#244: minutes an after-hours alert waits for the on-call member before it '
  'widens to everyone who can see the thread. Zero means widen immediately, '
  'which is the pre-#244 behaviour and a legitimate choice for a crew of two.';

alter table public.companies
  add constraint companies_on_call_escalate_ck
  check (on_call_escalate_after_minutes between 0 and 120)
  not valid;

-- ---------------------------------------------------------------------------
-- Who is on call for this number, right now.
--
-- A FUNCTION rather than three clients' worth of interval arithmetic, and the
-- overlap rule is the reason: when a workspace-wide shift and a number-specific
-- shift both cover the instant, the SPECIFIC one wins. A crew that puts one
-- person on the emergency line and another on everything else means exactly
-- that, and getting it wrong pages the wrong person at 2am.
--
-- Returns at most one row. Where two shifts of equal specificity overlap — two
-- people put on call for the same window, which is a mistake somebody made in
-- the UI rather than a rotation — the one that STARTED LATEST wins, because
-- the later edit is the more recent intent.
-- ---------------------------------------------------------------------------
create or replace function public.api_on_call_now(
  p_company_id      uuid,
  p_phone_number_id uuid,
  p_at              timestamptz default now()
) returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.user_id
    from public.on_call_shifts s
   where s.company_id = p_company_id
     and p_at >= s.starts_at
     and p_at <  s.ends_at
     and (s.phone_number_id is null or s.phone_number_id = p_phone_number_id)
   order by (s.phone_number_id is not null) desc, s.starts_at desc
   limit 1
$$;

revoke all on function public.api_on_call_now(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_on_call_now(uuid, uuid, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- Claim an alert.
--
-- Idempotent on the FIRST acknowledgement, like api_confirm_task: two members
-- tapping at once means one of them claimed it, and the other needs to be told
-- whose name is on it rather than being told they claimed it too.
--
-- Clearing `escalate_at` in the same statement is the point: an acknowledged
-- alert must never widen afterwards, and leaving that to a second write is a
-- window in which the whole crew gets woken about a job somebody is already
-- driving to.
-- ---------------------------------------------------------------------------
create or replace function public.api_acknowledge_alert(
  p_company_id uuid,
  p_alert_id   uuid,
  p_user_id    uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.alert_escalations;
begin
  select * into v_row
    from public.alert_escalations
   where id = p_alert_id and company_id = p_company_id
   for update;

  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if v_row.acknowledged_at is not null then
    return jsonb_build_object(
      'outcome', 'already_acknowledged',
      'acknowledged_by', v_row.acknowledged_by,
      'acknowledged_at', v_row.acknowledged_at
    );
  end if;

  update public.alert_escalations
     set acknowledged_at = now(),
         acknowledged_by = p_user_id,
         escalate_at = null
   where id = p_alert_id;

  return jsonb_build_object(
    'outcome', 'acknowledged',
    'conversation_id', v_row.conversation_id,
    'kind', v_row.kind
  );
end $$;

revoke all on function public.api_acknowledge_alert(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.api_acknowledge_alert(uuid, uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Claim the right to widen a batch of alerts.
--
-- Same lease shape as the scheduled-message queue (#233): claim by UPDATE with
-- the deadline still set, so two workers cannot both widen one alert and wake
-- the crew twice. `escalate_at` is cleared by the claim itself.
-- ---------------------------------------------------------------------------
create or replace function public.api_claim_due_alerts(
  p_now   timestamptz default now(),
  p_limit integer default 50
) returns setof public.alert_escalations
language sql
security definer
set search_path = ''
as $$
  update public.alert_escalations
     set escalated_at = p_now, escalate_at = null
   where id in (
     select id
       from public.alert_escalations
      where escalate_at is not null
        and escalate_at <= p_now
        and acknowledged_at is null
      order by escalate_at
      limit p_limit
      for update skip locked
   )
  returning *
$$;

revoke all on function public.api_claim_due_alerts(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.api_claim_due_alerts(timestamptz, integer)
  to service_role;
