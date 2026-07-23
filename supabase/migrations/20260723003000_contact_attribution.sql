-- #191: contact attribution — who created / edited / deleted a contact.
--
--   Adds the three actor columns the contact GET/detail response projects
--   (created_by_user_id, updated_by_user_id) plus the delete audit column
--   (deleted_by_user_id, stamped alongside deleted_at). Each is a nullable
--   auth.users FK cleared to null if that user is later deleted.
--
--   Existing rows stay null: the actor was never recorded before, and there
--   is no honest value to backfill — a null attribution reads as "unknown",
--   and the UI simply omits the attribution line when the name does not
--   resolve. No backfill lie.
--
--   Names resolve the SAME way message-sender / assignment-actor names do: a
--   profiles(user_id -> display_name) lookup performed in the route (contacts
--   read via a direct PostgREST select, so there is no view or RPC to change).

alter table public.contacts
  add column created_by_user_id uuid references auth.users(id) on delete set null,
  add column updated_by_user_id uuid references auth.users(id) on delete set null,
  add column deleted_by_user_id uuid references auth.users(id) on delete set null;
