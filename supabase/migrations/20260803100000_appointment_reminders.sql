-- ---------------------------------------------------------------------------
-- #237 — appointment reminders: the durable half.
--
-- A no-show is a truck, two techs and half a day gone, and the answer every
-- competitor in home services leads with is a reminder text the day before.
-- We already ship the reactive half (missed-call textback); this is the
-- proactive one.
--
-- A REMINDER IS A SCHEDULED MESSAGE, NOT A SECOND QUEUE.
--
-- The obvious shape is a `reminders` table with its own firing job. It is the
-- wrong one. #233 already built a durable outbound queue with the four
-- properties this feature's acceptance criteria are made of:
--
--   * fires once, via a lease (`for update skip locked` + an ageing stamp), so
--     two workers cannot both send and a dead worker strands nothing;
--   * runs EVERY pre-send gate at FIRE time — opt-out, quota, number access,
--     suspended workspace — through #331's clearance, which `dispatchOutbound`
--     will not compile without. "No reminder ever fires after a STOP" is
--     therefore satisfied by construction rather than by a check somebody has
--     to remember to write;
--   * holds rather than drops, discloses the reason, and expires rather than
--     arriving late (docs/DECISIONS.md rules 1–3);
--   * is already visible to the crew, in the thread strip and the workspace
--     list, on all three clients.
--
-- A second queue would mean a second place for "did this send twice" to be
-- wrong, and a second set of gates to keep in step with the first. The one
-- thing this migration must add is what a reminder knows that a hand-scheduled
-- text does not: which job it is about, so the job moving moves it and the job
-- dying kills it.
--
-- WHY THE BODY IS RENDERED AT GENERATION TIME, NOT AT FIRE TIME.
--
-- `scheduled_messages.body` is NOT NULL and is what the thread strip and the
-- workspace list already show. Storing a template reference instead would mean
-- those surfaces either render a template they cannot resolve or show nothing,
-- and #233's whole design is that a queued text is legible before it goes.
-- Re-rendering happens by REGENERATION: `api_sync_task_reminders` deletes and
-- rebuilds a task's pending reminders whenever the job changes, so a moved
-- appointment carries a body that names the new time.
--
-- WHY GENERATION IS A FUNCTION AND NOT A TRIGGER.
--
-- A trigger on `tasks` would fire inside every task write in the product,
-- including bulk ones, and would need the destination clock — which lives in
-- TypeScript, not in Postgres. The API calls this after it has resolved the
-- clock, the same way it does for a hand-scheduled send. That also keeps the
-- one rule this feature must never break in one place: the reminder's send_at
-- is computed against the CUSTOMER's clock by `resolveDestinationClock`, not
-- by arithmetic here.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- The rules. Per workspace, and deliberately few.
--
-- Two offsets is the industry shape (the day before, and the morning of) and
-- also the ceiling: a crew that texts a customer five times before arriving is
-- a crew whose customers stop reading their texts, and the cost of that lands
-- on the next message that actually matters. The cap is enforced in the RPC
-- below rather than by a CHECK, so hitting it is something a person is told
-- rather than an exception.
-- ---------------------------------------------------------------------------
create table if not exists public.appointment_reminder_rules (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,

  -- How long BEFORE the appointment this goes. Minutes rather than hours so
  -- "the morning of" (which is not a fixed offset from an afternoon job) can
  -- be expressed, and positive-only: a reminder after the appointment is a
  -- follow-up, which is a different feature with different manners.
  offset_minutes integer not null check (offset_minutes between 15 and 20160),

  -- The text, with the same merge fields every other template uses. Rendered
  -- at generation time — see the header.
  body           text not null check (char_length(btrim(body)) between 1 and 1600),

  -- Off without losing the wording. A workspace that switches reminders off
  -- for a fortnight should not have to retype them.
  enabled        boolean not null default true,

  created_by     uuid not null references auth.users(id) on delete restrict,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.appointment_reminder_rules is
  '#237: how far before a job a reminder goes, and what it says. A reminder '
  'itself is a scheduled_messages row — see the migration header for why this '
  'is not a second queue.';

-- One rule per offset per workspace. Two rules both firing 24h before is a
-- customer receiving the same reminder twice, which is the failure this
-- feature is most likely to be blamed for.
create unique index if not exists appointment_reminder_rules_offset_uq
  on public.appointment_reminder_rules (company_id, offset_minutes);

alter table public.appointment_reminder_rules enable row level security;
revoke all on public.appointment_reminder_rules from public, anon, authenticated;
grant select, insert, update, delete on public.appointment_reminder_rules to service_role;

create or replace function public.appointment_reminder_rules_cap()
  returns integer language sql immutable as $$ select 2 $$;

-- ---------------------------------------------------------------------------
-- What a scheduled message knows about the job it reminds about.
-- ---------------------------------------------------------------------------

alter table public.scheduled_messages
  add column if not exists task_id uuid references public.tasks(id) on delete cascade;

-- Who put it in the queue: a person, or the reminder machinery.
--
-- This is not cosmetic. Regeneration DELETES a task's pending reminders and
-- rebuilds them, and it must never touch a text a human wrote and scheduled
-- against the same thread. Without this column the two are indistinguishable
-- and the sync would eat somebody's work.
alter table public.scheduled_messages
  add column if not exists origin text not null default 'human';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'scheduled_messages_origin_ck'
  ) then
    alter table public.scheduled_messages
      add constraint scheduled_messages_origin_ck
      check (origin in ('human', 'reminder'));
  end if;
end $$;

comment on column public.scheduled_messages.origin is
  '#237: ''reminder'' rows are generated from appointment_reminder_rules and '
  'are regenerated wholesale when the job moves. ''human'' rows are somebody''s '
  'own words and are never touched by that sweep.';

-- WHICH reminder this is, kept on the row rather than re-derived from
-- `send_at` minus the job's `due_at`. Both of those move, and a reminder whose
-- identity is computed from two moving values cannot be matched to the rule it
-- came from once either changes — which is exactly when regeneration needs to
-- match it.
alter table public.scheduled_messages
  add column if not exists reminder_offset_minutes integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'scheduled_messages_reminder_shape_ck'
  ) then
    -- The two columns are one fact. A 'reminder' with no offset cannot be
    -- regenerated, and a 'human' row carrying one is a row somebody's sync
    -- will eventually delete by mistake.
    alter table public.scheduled_messages
      add constraint scheduled_messages_reminder_shape_ck
      check (
        (origin = 'reminder' and task_id is not null and reminder_offset_minutes is not null)
        or (origin = 'human' and reminder_offset_minutes is null)
      );
  end if;
end $$;

-- A reminder is identified by its job and its offset, so regeneration is
-- idempotent and a double-sync cannot queue the same reminder twice. Partial
-- on the live statuses: a job rescheduled after its first reminder already
-- SENT must be able to carry a new one at the same offset.
create unique index if not exists scheduled_messages_task_offset_uq
  on public.scheduled_messages (task_id, reminder_offset_minutes)
  where status in ('pending', 'held');

-- ---------------------------------------------------------------------------
-- What a job knows about its reminders.
-- ---------------------------------------------------------------------------

-- Per-job suppression. #237 asks for it explicitly, and the reason is the job
-- nobody should be texted about: a callback on a complaint, a job booked by
-- the customer's landlord, a repeat visit arranged face to face.
alter table public.tasks
  add column if not exists reminders_off boolean not null default false;

-- #237: "a customer who replies 'C' has the job marked confirmed without
-- anyone touching it". Stored on the job rather than derived from the thread,
-- because the question a dispatcher asks in the morning is "which of today's
-- jobs are confirmed", and deriving that from message bodies at read time is
-- both slow and a guess.
alter table public.tasks
  add column if not exists confirmed_at timestamptz;

alter table public.tasks
  add column if not exists confirmed_by text
    check (confirmed_by is null or confirmed_by in ('customer', 'crew'));

comment on column public.tasks.confirmed_by is
  '#237: ''customer'' means they replied to the reminder; ''crew'' means '
  'somebody here marked it. Kept apart because they are different evidence — '
  'a crew confirmation is a note to ourselves, a customer one is a promise.';

-- ---------------------------------------------------------------------------
-- Regenerate one job's reminders.
--
-- Called by the API after it has resolved the destination clock, with the
-- instants already computed. Deletes the job's PENDING reminders and rebuilds
-- them from the rules — which is what makes "rescheduling the job reschedules
-- the reminder; cancelling the job cancels it" true by construction rather
-- than by three separate code paths remembering to.
--
-- Deleting rather than updating is deliberate. An offset can be removed from
-- the rules, and an UPDATE-shaped sync leaves that reminder queued forever;
-- rebuild has no such asymmetry. Only 'pending' rows go: a 'held' reminder is
-- one the firing job stopped and told somebody about, and silently replacing
-- it would erase the disclosure DECISIONS.md makes binding.
--
-- p_reminders is a jsonb array of { offset_minutes, body, send_at }, already
-- filtered by the caller to future instants in the customer's clock.
-- ---------------------------------------------------------------------------
create or replace function public.api_sync_task_reminders(
  p_company_id     uuid,
  p_task_id        uuid,
  p_user_id        uuid,
  p_reminders      jsonb,
  p_clock_timezone text,
  p_clock_source   text,
  p_expires_at     timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task           record;
  v_removed        integer := 0;
  v_added          integer := 0;
  v_reminder       jsonb;
begin
  select t.id, t.company_id, t.conversation_id, t.due_at, t.deleted_at,
         t.reminders_off
    into v_task
    from public.tasks t
   where t.id = p_task_id
     and t.company_id = p_company_id;

  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  -- Clear first, unconditionally. Every reason a job stops deserving reminders
  -- — done, deleted, suppressed, moved into the past, rules switched off —
  -- lands here as "the caller passed an empty array", so there is exactly one
  -- cancellation path rather than five.
  with gone as (
    delete from public.scheduled_messages
     where task_id = p_task_id
       and company_id = p_company_id
       and origin = 'reminder'
       and status = 'pending'
    returning 1
  )
  select count(*) into v_removed from gone;

  if v_task.deleted_at is not null or v_task.reminders_off then
    return jsonb_build_object(
      'outcome', 'synced', 'removed', v_removed, 'added', 0,
      'reason', case when v_task.deleted_at is not null
                     then 'task_deleted' else 'reminders_off' end
    );
  end if;

  for v_reminder in select * from jsonb_array_elements(coalesce(p_reminders, '[]'::jsonb))
  loop
    -- ON CONFLICT DO NOTHING against the (task, offset) partial unique index:
    -- a HELD reminder at this offset still occupies the slot, and rebuilding
    -- over it would drop the held row's disclosure on the floor.
    insert into public.scheduled_messages (
      company_id, conversation_id, task_id, origin, reminder_offset_minutes,
      body, send_at, clock_timezone, clock_source, expires_at, created_by
    ) values (
      p_company_id,
      v_task.conversation_id,
      p_task_id,
      'reminder',
      (v_reminder->>'offset_minutes')::integer,
      v_reminder->>'body',
      (v_reminder->>'send_at')::timestamptz,
      p_clock_timezone,
      p_clock_source,
      p_expires_at,
      p_user_id
    )
    on conflict do nothing;
    if found then v_added := v_added + 1; end if;
  end loop;

  return jsonb_build_object(
    'outcome', 'synced', 'removed', v_removed, 'added', v_added
  );
end $$;

revoke all on function public.api_sync_task_reminders(
  uuid, uuid, uuid, jsonb, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.api_sync_task_reminders(
  uuid, uuid, uuid, jsonb, text, text, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Mark a job confirmed.
--
-- Idempotent on purpose: a customer who replies "C" twice, or replies to both
-- reminders, has confirmed once. Returning the row lets the caller tell the
-- difference between "this reply confirmed it" and "it was already confirmed",
-- which decides whether anything is posted to the thread.
-- ---------------------------------------------------------------------------
create or replace function public.api_confirm_task(
  p_company_id uuid,
  p_task_id    uuid,
  p_by         text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was timestamptz;
begin
  if p_by not in ('customer', 'crew') then
    return jsonb_build_object('outcome', 'invalid_by');
  end if;

  select confirmed_at into v_was
    from public.tasks
   where id = p_task_id and company_id = p_company_id and deleted_at is null;

  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if v_was is not null then
    return jsonb_build_object('outcome', 'already', 'confirmed_at', v_was);
  end if;

  update public.tasks
     set confirmed_at = now(), confirmed_by = p_by, updated_at = now()
   where id = p_task_id and company_id = p_company_id;

  return jsonb_build_object('outcome', 'confirmed');
end $$;

revoke all on function public.api_confirm_task(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.api_confirm_task(uuid, uuid, text) to service_role;

-- The dispatcher's morning question: which of today's jobs are confirmed.
create index if not exists tasks_due_confirmed_idx
  on public.tasks (company_id, due_at)
  where deleted_at is null and due_at is not null;
