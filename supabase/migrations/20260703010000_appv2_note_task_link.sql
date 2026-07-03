-- App-v2 backend: link an internal note to a task (TASKS-V2 / D17 D-D). A NEW
-- migration — never edits a shipped one (D7/D14).
--
-- The task discussion primitive is the internal note that ALREADY interweaves in
-- the conversation thread (a note is a messages row, direction='note'). Rather
-- than a separate task-comments silo that would then have to be re-plumbed into
-- the thread, a note composed from the task drawer is linked to BOTH the
-- conversation (so it appears interwoven in the thread) and the task (so it
-- collects in the drawer's activity timeline). This adds the nullable link.
--
-- messages.task_id → tasks.id, nullable, ON DELETE SET NULL: a task soft-delete
-- never hard-deletes a task, so this FK rarely fires, but if a task row is ever
-- hard-removed the note survives (it stays a real thread note) with its link
-- cleared, rather than cascading away a customer-visible discussion line. The
-- link is app-enforced to point at a task in the SAME conversation + company
-- (the note-create route validates this, 422 otherwise) — the FK guarantees
-- referential integrity; the same-conversation rule is a route-level invariant.
--
-- RLS / grants posture MIRRORS the existing messages columns exactly: messages
-- has RLS enabled deny-by-default with NO anon/authenticated grants
-- (20260701000300_rls.sql); the Worker uses the service_role sb_secret_ key whose
-- table-level DML grant (20260701030000_service_role_grants.sql) already covers
-- every column of messages, so a new column needs NO additional grant. Adding a
-- nullable column touches no policy and no grant.

alter table public.messages
  add column task_id uuid references public.tasks(id) on delete set null;

-- Index the link: the task drawer's activity feed fetches "notes where
-- messages.task_id = :task" (TASKS-V2 D-D). Partial on task_id IS NOT NULL so the
-- index stays tiny — the vast majority of messages are not task-linked notes.
create index messages_task_id_idx on public.messages (task_id)
  where task_id is not null;
