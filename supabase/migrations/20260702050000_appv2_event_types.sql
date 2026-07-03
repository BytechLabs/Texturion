-- D17/D19/D22 (TASKS.md T8) — conversation_event_type additions.
--
-- The single source of truth for the app-v2 event-type additions is TASKS.md T8;
-- every other doc (DECISIONS.md D17/D22, APP-FEATURES-V2 §5) cites this list
-- rather than restating it. Added here, in their OWN migration, because a new
-- enum value cannot be USED in the same transaction that adds it (Postgres
-- restriction). Each migration file runs in its own transaction, so isolating
-- the ADD VALUEs from any code that references them is the safe shape — the
-- values are first USED by application code (apps/api) and the SQL tests, never
-- inside this file.
--
-- Ten additions (TASKS.md T8, verbatim):
--   done audit (D22 — closes the D14 gap):
--     'message_done', 'message_undone'
--   task lifecycle (D17 — completion is NOT re-audited here; it rides the
--     message_done/undone events, so there is deliberately NO task_completed /
--     task_reopened):
--     'task_created', 'task_assigned', 'task_due_set', 'task_deleted'
--   attachment lifecycle (D19):
--     'note_attachment_added', 'note_attachment_removed',
--     'task_attachment_added', 'task_attachment_removed'
--
-- The conversation_events_conv_required CHECK (20260701000200_tables.sql) is
-- NOT altered: every new type always carries a non-null conversation_id (a
-- message, task, and note each belong to a conversation), so the shipped
-- constraint — which only PERMITS a null conversation_id for
-- ('opted_out','opt_out_revoked','consent_attested') — is satisfied as-is
-- (TASKS.md T8, D22). Editing a shipped constraint is forbidden (D7/D14).
--
-- IF NOT EXISTS makes each ADD VALUE idempotent (re-runnable on a partially
-- applied enum without error).

alter type public.conversation_event_type add value if not exists 'message_done';
alter type public.conversation_event_type add value if not exists 'message_undone';
alter type public.conversation_event_type add value if not exists 'task_created';
alter type public.conversation_event_type add value if not exists 'task_assigned';
alter type public.conversation_event_type add value if not exists 'task_due_set';
alter type public.conversation_event_type add value if not exists 'task_deleted';
alter type public.conversation_event_type add value if not exists 'note_attachment_added';
alter type public.conversation_event_type add value if not exists 'note_attachment_removed';
alter type public.conversation_event_type add value if not exists 'task_attachment_added';
alter type public.conversation_event_type add value if not exists 'task_attachment_removed';
