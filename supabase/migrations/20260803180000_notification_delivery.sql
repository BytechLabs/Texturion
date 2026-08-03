-- ---------------------------------------------------------------------------
-- #297 — a volume control, and somewhere for a batch to wait.
--
-- The push layer already solves DUPLICATION: one collapse key coalesces the
-- same subject across three platforms. It does nothing about VOLUME. A crew of
-- six on a busy Tuesday generates a continuous stream, and the only control a
-- member has is an on/off switch — so the outcome is the one that ends every
-- notification system. People turn them off, the emergency stops arriving too,
-- and the product silently stops working for that person while looking
-- perfectly healthy in our metrics.
--
-- ---------------------------------------------------------------------------
-- BATCHING MUST NEVER BECOME A WAY TO MISS THE CALL THAT MATTERED
--
-- That is the issue's own sentence and it is the reason the urgency check does
-- not live in this table. Urgency is a property of the EVENT, decided by the
-- code that raises it — an on-call page (#244), an escalation, an emergency
-- keyword — and it is checked before any preference here is read. Nothing an
-- owner or a member can set is capable of delaying one.
--
-- ---------------------------------------------------------------------------
-- WHY THE QUEUE IS ITS OWN TABLE AND NOT A COLUMN ON THE EVENT
--
-- Because a queued notification is not a notification yet. It has no delivery
-- attempt, no collapse identity of its own, and it may never become one — the
-- batch it joins might be flushed as a single digest that mentions it only as
-- a number. Marking a message row "pending push" would make every reader of
-- messages responsible for understanding notification state, which is the
-- mistake #233 avoided for scheduled sends and for the same reason.
-- ---------------------------------------------------------------------------

-- Per-category delivery, on the row that already holds this member's
-- preferences for this workspace.
--
-- JSONB rather than six columns: the category list is expected to grow (#297
-- names six, #247's urgency ranking will suggest more), and a migration per
-- category is a migration nobody will write — after which the new category
-- silently has no control, which is the state this issue is about.
alter table public.notification_prefs
  add column if not exists delivery jsonb not null default '{}'::jsonb,
  -- How long a batch waits. NULL means the default; a member who has never
  -- chosen batching has no opinion to store.
  add column if not exists batch_window_minutes integer,
  -- When the daily summary goes, in the member's own clock (quiet_timezone,
  -- falling back to the workspace's). NULL = no summary, which is everybody
  -- until they ask for one.
  add column if not exists summary_at time;

comment on column public.notification_prefs.delivery is
  '#297: category -> ''immediate''|''batched''|''summary''. An ABSENT key means '
  'immediate, which is what every existing member receives today — this '
  'feature is offered, never applied. Urgent events ignore all of it.';

alter table public.notification_prefs
  add constraint notification_prefs_batch_window_ck
  check (batch_window_minutes is null or batch_window_minutes between 5 and 60)
  not valid;

-- ---------------------------------------------------------------------------
-- One notification waiting for its batch.
--
-- Rows are per RECIPIENT, not per event: two members with different windows
-- get two rows for one message, because they are two different promises about
-- two different phones. Deduplicating them into one row keyed by event would
-- save a little storage and make the flush unable to answer the only question
-- it has ("what does THIS person not yet know about").
-- ---------------------------------------------------------------------------
create table if not exists public.pending_notifications (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,

  -- Which control this obeyed, so a flush can say what it is flushing and a
  -- member changing a setting can have the right rows re-evaluated.
  category        text not null,

  conversation_id uuid references public.conversations(id) on delete cascade,

  -- WHEN it is due to go. Set at queue time from the member's window, so a
  -- member who lengthens their window does not retroactively delay a batch
  -- that was already nearly due.
  deliver_at      timestamptz not null,

  created_at      timestamptz not null default now()
);

comment on table public.pending_notifications is
  '#297: notifications waiting for a batch window to close. NEVER holds an '
  'urgent event — those are sent before this table is consulted.';

-- The flush's only read: what is due, oldest first.
create index if not exists pending_notifications_due_idx
  on public.pending_notifications (deliver_at);

-- The per-member read a flush does once it has claimed a due row: everything
-- else waiting for the same person, so one digest covers all of it.
create index if not exists pending_notifications_member_idx
  on public.pending_notifications (company_id, user_id, created_at);

alter table public.pending_notifications enable row level security;
revoke all on public.pending_notifications from public, anon, authenticated;
grant select, insert, update, delete on public.pending_notifications to service_role;

-- ---------------------------------------------------------------------------
-- Claim one member's due batch, whole.
--
-- Claims by MEMBER rather than by row: the digest is "4 new messages across 3
-- conversations", so flushing a single row would send four notifications that
-- each say "1 new message" — the volume problem with extra steps and a worse
-- message.
--
-- Same lease shape as the scheduled-message queue (#233): the rows are deleted
-- as they are claimed, inside one statement, so two workers cannot both
-- describe the same batch.
-- ---------------------------------------------------------------------------
create or replace function public.api_claim_due_notifications(
  p_now   timestamptz default now(),
  p_limit integer default 20
) returns setof public.pending_notifications
language sql
security definer
set search_path = ''
as $$
  delete from public.pending_notifications
   where (company_id, user_id) in (
     select company_id, user_id
       from public.pending_notifications
      where deliver_at <= p_now
      group by company_id, user_id
      order by min(deliver_at)
      limit p_limit
   )
  returning *
$$;

revoke all on function public.api_claim_due_notifications(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.api_claim_due_notifications(timestamptz, integer)
  to service_role;
