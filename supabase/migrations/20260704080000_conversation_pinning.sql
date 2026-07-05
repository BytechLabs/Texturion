-- #3 Pinning — conversation-level pin state (pin a whole thread so it stays at
-- the top of the inbox). Mirrors the message-pin storage; shared / team-wide.
--
--   conversations.pinned_at          when pinned (NULL = not pinned)
--   conversations.pinned_by_user_id  who pinned it (FK profiles, ON DELETE RESTRICT)
--
-- Deliberately NO api_list_conversations change: that function carries the
-- inbox keyset pagination and has been re-created several times (snippets,
-- unread-excludes-own-sends), so reworking its ORDER BY / cursor to sort pinned
-- first is a delicate change best made where it can be verified. Instead the
-- new columns ride the existing `to_jsonb(c.*)` list payload for free, the
-- conversation PATCH sets them via a direct UPDATE (exactly like status / spam
-- / assign), and the inbox groups pinned threads into a top section client-side
-- from the loaded pages. A server-side pinned-first ordering is a clean
-- follow-up once it can be checked in the browser.

alter table public.conversations
  add column pinned_at timestamptz,
  add column pinned_by_user_id uuid references public.profiles(user_id) on delete restrict;

-- Pinning never happens without an actor; unpinning clears both (mirrors
-- conversations' other both-or-neither checks and messages_pinned_consistency).
alter table public.conversations
  add constraint conversations_pinned_consistency
  check ((pinned_at is null) = (pinned_by_user_id is null));
