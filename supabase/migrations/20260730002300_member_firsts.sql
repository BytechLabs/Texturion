-- #405 — the three things a new crew member has actually done.
--
-- The getting-started card derives every item from real data rather than a
-- stored flag, which is the right instinct: derived state cannot drift out of
-- sync with reality. But every one of its signals is COMPANY-wide — a number
-- exists, a conversation exists, the workspace has metered a segment — and a
-- member's version needs signals about THEM.
--
-- ---------------------------------------------------------------------------
-- WHY A MEMBER NEEDS A DIFFERENT LIST, NOT A FILTERED ONE.
--
-- Two of the four existing items are things a non-admin cannot do: getting a
-- number is owner/admin, and inviting a teammate is owner/admin. So a
-- plumber's apprentice invited on Monday opened the app to a to-do list where
-- half the items were impossible for them and one was already done.
--
-- And the arithmetic is against us: plans allow 3 seats on Starter and 15 on
-- Pro, so MOST users of this product are members, not owners — up to fourteen
-- of them each. The only first-run guidance we shipped was written for the one
-- person who least needs it, because they just walked a five-step wizard and
-- chose the tool deliberately. The member did not choose it. They were told to
-- use it, and that is a different starting position.
--
-- ---------------------------------------------------------------------------
-- WHY THESE THREE.
--
-- They are the behaviours that change what a tech does versus their personal
-- cell, and each is derivable from a row this person wrote:
--
--   replied     — they have answered a customer from the shared number, which
--                 is the whole product working.
--   noted       — they have written an internal note. Confusing a note for a
--                 text is the single most consequential mistake available in
--                 this app, and doing it once deliberately is what teaches it.
--   marked_done — message-derived completion (D17) is unusual and not
--                 guessable from the interface.
--
-- Notification preferences are on the member's list too, but there is nothing
-- to derive: visiting a settings page is not a row. It stays a line of copy.

create or replace function public.api_member_firsts(
  p_company_id uuid,
  p_user_id    uuid
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'replied', exists (
      select 1 from public.messages m
       where m.company_id = p_company_id
         and m.sent_by_user_id = p_user_id
         and m.direction = 'outbound'
    ),
    'noted', exists (
      select 1 from public.messages m
       where m.company_id = p_company_id
         and m.sent_by_user_id = p_user_id
         and m.direction = 'note'
    ),
    'marked_done', exists (
      select 1 from public.messages m
       where m.company_id = p_company_id
         and m.done_by_user_id = p_user_id
    )
  );
$$;

comment on function public.api_member_firsts(uuid, uuid) is
  '#405: has THIS member replied, written a note, and marked something done. '
  'Three existence checks, so the member first-run card can derive its state '
  'the same way the owner card does.';

-- Each arm is an existence check with a LIMIT of one row behind it, but there
-- is no index on the actor columns and `messages` is the largest table in the
-- product. Partial, because a company's own outbound rows are the only ones
-- these predicates can ever match.
create index if not exists messages_sender_idx
  on public.messages (company_id, sent_by_user_id)
  where sent_by_user_id is not null;
create index if not exists messages_done_by_idx
  on public.messages (company_id, done_by_user_id)
  where done_by_user_id is not null;

revoke all on function public.api_member_firsts(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.api_member_firsts(uuid, uuid) to service_role;
