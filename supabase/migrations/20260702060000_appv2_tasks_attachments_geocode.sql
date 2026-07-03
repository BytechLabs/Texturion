-- App-v2 backend schema: Tasks (D17/TASKS.md T1), generic Attachments (D19),
-- Contacts geocode columns (D25). A NEW migration — never edits a shipped one
-- (D7/D14). All SPEC §6 conventions: uuid PKs via gen_random_uuid(); FKs
-- explicit, ON DELETE RESTRICT by default (noted exceptions: SET NULL where a
-- convention calls for it); moddatetime updated_at on the one mutable table
-- (tasks) — the append-only attachments table deliberately has none; deny-by-
-- default RLS (enabled, NO anon/authenticated grants/policies — the Worker uses
-- the sb_secret_ / service_role key, D8); soft-delete via deleted_at.
--
-- The conversation_event_type additions this feature writes are in the SEPARATE
-- earlier migration 20260702050000_appv2_event_types.sql (a new enum value
-- cannot be used in the txn that adds it). Nothing here references those values.

-- ===========================================================================
-- 1. tasks (D17 / TASKS.md T1.1) — the DERIVED-completion model.
--
-- A task promotes a real message (message_id NOT NULL) and carries only
-- metadata (assignee / due / title / notes). It has NO status, NO done_at, NO
-- done_by column and there is NO task_status enum: completion is a JOIN read of
-- messages.done_at (open when NULL, done otherwise). One live task per message
-- (partial-unique below). Deleting a task never touches messages.done_at.
-- ===========================================================================
create table public.tasks (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id)     on delete restrict,
  -- NOT NULL: every task promotes a real message (D17; standalone tasks are cut
  -- from MVP, TASKS.md T0.1). RESTRICT: a task is meaningless without its source
  -- message. Completion DERIVES from this message's done_at (join read).
  message_id         uuid not null references public.messages(id)      on delete restrict,
  -- Denormalized from the source message for cheap per-conversation listing
  -- (the checklist) and the gallery union (D17/T1.2).
  conversation_id    uuid not null references public.conversations(id) on delete restrict,
  -- Seeded from the message body, editable; never a copy of the live body.
  title              text not null check (length(title) between 1 and 500),
  description        text not null default '',
  -- Independent of conversations.assigned_user_id (a task may go to a different
  -- crew member than the thread). SET NULL mirrors the conversations convention
  -- (20260701000200_tables.sql). References auth.users like the other assignee FKs.
  assigned_user_id   uuid          references auth.users(id) on delete set null,
  due_at             timestamptz,                 -- nullable; timeline = created_at + due_at + join done_at
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz                  -- soft-delete (D7/D17); RESTRICT FKs above
);

-- At most ONE live task per source message (D17). Partial on deleted_at so a
-- deleted-then-re-promoted message can get a fresh task. A second live promotion
-- of the same message → unique violation the route maps to 409 conflict (T4).
create unique index tasks_message_uq on public.tasks (message_id)
  where deleted_at is null;

-- Read paths (TASKS.md T1.1):
--   checklist: all live tasks for a thread in created order
create index tasks_conversation_idx on public.tasks (conversation_id, created_at)
  where deleted_at is null;
--   /tasks list + "Mine": company-scoped by assignee
create index tasks_company_assignee_idx on public.tasks (company_id, assigned_user_id)
  where deleted_at is null;
--   due-sorted list
create index tasks_company_due_idx on public.tasks (company_id, due_at)
  where deleted_at is null;

-- moddatetime updated_at (SPEC §6) — same signature the shipped tables use.
create trigger set_updated_at before update on public.tasks
  for each row execute function extensions.moddatetime(updated_at);

-- Deny-by-default RLS (SPEC §6 / D8): enabled, no policies, no anon/authenticated
-- grants. service_role DML is covered by the ALTER DEFAULT PRIVILEGES in
-- 20260701030000_service_role_grants.sql (this table is postgres-created).
alter table public.tasks enable row level security;

-- ---------------------------------------------------------------------------
-- task.changed metadata broadcast (TASKS.md T1.3). ONE ID-only metadata-only
-- broadcast — NOT a created/updated/deleted trio, and NOT a done signal (done
-- rides the existing message.status broadcast, D9/D14, because it writes
-- messages, not tasks). Fires on task create / metadata update / soft-delete so
-- the /tasks page + the conversation checklist live-refetch via the API.
-- Payload carries ONLY conversation_id (D9 minimal). Topic authorization is the
-- existing realtime.messages membership policy — no new RLS policy (§8).
-- Mirrors the shape/security of the shipped broadcast_* triggers (…000400).
-- ---------------------------------------------------------------------------
create or replace function public.broadcast_task_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  cid uuid := coalesce(new.conversation_id, old.conversation_id);
  co  uuid := coalesce(new.company_id, old.company_id);
begin
  perform realtime.send(
    jsonb_build_object('conversation_id', cid),
    'task.changed', 'company:' || co::text, true);
  return null;
end $$;

create trigger tasks_broadcast after insert or update or delete on public.tasks
  for each row execute function public.broadcast_task_changed();

-- ===========================================================================
-- 2. attachments (D19 / APP-FEATURES-V2 §2) — ONE generic table for note AND
--    task attachments, deliberately parallel to (not merged with) the MMS
--    message_attachments table. Append-only + soft-delete: NO updated_at, NO
--    moddatetime (APP-FEATURES-V2 §2.1 — stated once, no drift).
--
-- owner_type discriminates: 'note' → owner_id is a messages row (direction
-- 'note'); 'task' → owner_id is a tasks row. The owner_id FK is app-enforced,
-- NOT a polymorphic DB FK (D19 sidesteps D7's explicit-FK rule for polymorphism).
-- conversation_id is denormalized so the gallery union (D21/T7.2) queries the
-- generic arm with no join.
-- ===========================================================================
create table public.attachments (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id) on delete restrict,
  owner_type           text not null check (owner_type in ('note','task')),
  owner_id             uuid not null,               -- messages.id (note) | tasks.id (task); app-enforced
  conversation_id      uuid references public.conversations(id) on delete cascade,  -- denormalized (D19)
  storage_path         text not null,               -- attachments/{company}/{owner_type}/{owner_id}/{uuid}-{name}
  file_name            text,
  content_type         text,
  size_bytes           bigint,                       -- bigint: 25 MB ceiling fits, matches D19
  uploaded_by_user_id  uuid references public.profiles(user_id) on delete restrict,
  created_at           timestamptz not null default now(),
  deleted_at           timestamptz                   -- soft-delete (D19 sweep-cron removes the object)
);

-- Gallery query (D21/T7.2 generic arm): conversation-scoped, live rows.
create index attachments_company_conversation_idx
  on public.attachments (company_id, conversation_id)
  where deleted_at is null;
-- Owner fetch (a note's / task's attachment list, and the soft-delete sweep).
create index attachments_owner_idx
  on public.attachments (owner_type, owner_id)
  where deleted_at is null;

-- Deny-by-default RLS (SPEC §6 / D8): enabled, no policies, no anon/authenticated
-- grants. No moddatetime trigger (append-only, D19). service_role DML via the
-- ALTER DEFAULT PRIVILEGES in 20260701030000_service_role_grants.sql.
alter table public.attachments enable row level security;

-- ===========================================================================
-- 3. contacts geocode columns (D25 / HOME-AND-VIEWS.md). Geocode a contact's
--    address to lat/lng ONCE, cached on the row (Nominatim/OSM, rate-limited,
--    server-side, on address create/update; a backfill cron fills existing
--    rows). The Map view reads these; a contact without a geocodable address
--    simply doesn't appear. Nullable/defaulted so existing rows migrate safely
--    (every existing contact starts geocode_status='pending', un-geocoded).
-- ===========================================================================
alter table public.contacts
  add column lat            double precision,
  add column lng            double precision,
  add column geocoded_at    timestamptz,
  -- pending (needs geocoding) → ok (lat/lng set) | failed (no result) |
  -- no_address (nothing to geocode). Constrained so the geocode job can key off
  -- a known vocabulary; default 'pending' queues every contact for backfill.
  add column geocode_status text not null default 'pending'
    check (geocode_status in ('pending','ok','failed','no_address'));

-- Backfill/queue work-set for the geocode cron (D25): contacts still needing a
-- geocode attempt, newest first. Partial so the index stays tiny as most rows
-- settle to 'ok'/'failed'/'no_address'. deleted_at excluded — soft-deleted
-- contacts are never geocoded.
create index contacts_geocode_pending_idx on public.contacts (company_id, created_at)
  where geocode_status = 'pending' and deleted_at is null;

-- ===========================================================================
-- 4. message_attachments(message_id) index (D21/TASKS.md T7.2). The gallery's
--    MMS arm joins message_attachments → messages on message_id for the
--    conversation scope. An index on the FK column is required; the shipped
--    composite UNIQUE (message_id, source_url) already LEADS with message_id, so
--    FK-style lookups on message_id alone are already served by it. This adds an
--    explicit single-column index to satisfy the spec's literal "add one if
--    absent" and document the gallery-join intent. IF NOT EXISTS keeps it
--    idempotent and harmless if a future migration adds the same.
-- ===========================================================================
create index if not exists message_attachments_message_id_idx
  on public.message_attachments (message_id);
