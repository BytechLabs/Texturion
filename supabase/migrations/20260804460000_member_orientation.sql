-- #286 — "An invited member sees a short, skippable, member-specific
-- orientation on first sign-in."
--
-- The one piece of first-run state that cannot be derived.
--
-- #405's card is derived from rows the member wrote, deliberately: derived
-- state cannot drift out of sync with reality, and a stored flag can. That
-- works because each of its items is a THING THEY DID. "Have they been shown
-- the orientation" is not a thing they did — it is a thing we did to them, and
-- nothing else in the database records it.
--
-- Per MEMBERSHIP, not per user: somebody who works for two companies through
-- this product joins each crew separately, with different numbers, a different
-- owner and a different set of people, and the second one is not a repeat.
--
-- Server-side rather than local storage on each device, for two reasons that
-- both bite the same person. A tech installs the phone app on the job and
-- opens the web app that evening; a flag on the device shows them the same
-- four screens twice. And SKIP is a decision — "I do not want this" answered
-- on a phone must not be re-asked on a laptop, or the skip button is a lie.
--
-- Nullable, and set once. `null` means "not yet", which is the correct answer
-- for every member who existed before this shipped: they have been in the
-- product for weeks and an orientation aimed at their first sign-in would be
-- an interruption, so the API stamps every EXISTING membership below and
-- leaves the column for the ones who arrive next.

alter table public.company_members
  add column if not exists oriented_at timestamptz;

comment on column public.company_members.oriented_at is
  '#286: when this member finished or skipped the joining orientation. Null '
  'means it has not been shown. Per membership, not per user — a second crew '
  'is a second joining.';

-- Everybody already here is already oriented. Not a default on the column: a
-- default would stamp the people this feature is FOR at the moment their
-- membership row is created, which is exactly when they have seen nothing.
update public.company_members
   set oriented_at = now()
 where oriented_at is null;

-- ---------------------------------------------------------------------------
-- Folded into the existing member-firsts read rather than given its own route.
--
-- It is the same question asked at the same moment by the same card — "what
-- does this person's first week still need" — and /v1/me/firsts is already
-- fetched exactly once, on the surface where the answer is used. A second
-- round trip on app start to carry one boolean would cost every member of
-- every workspace forever, for a screen each of them sees once.
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
    ),
    -- #286. Defaults to TRUE when no membership row matches, so a caller the
    -- company middleware has not vouched for is never shown a joining flow.
    -- Nothing reaches this function without that check today; the fallback is
    -- for the day something does.
    'oriented', coalesce(
      (select cm.oriented_at is not null
         from public.company_members cm
        where cm.company_id = p_company_id
          and cm.user_id = p_user_id),
      true
    )
  );
$$;

comment on function public.api_member_firsts(uuid, uuid) is
  '#405/#286: has THIS member replied, written a note, marked something done, '
  'and been through the joining orientation. One read for the whole of a '
  'member''s first-run state.';

revoke all on function public.api_member_firsts(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.api_member_firsts(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Finishing it, or skipping it, is the same write.
--
-- Skipping is not a lesser outcome to be re-asked later — it is the member
-- saying they do not want this, and #286 promises them a skippable flow. One
-- function for both so there is no path that records a completion and no path
-- that records a skip.
--
-- Idempotent by `is null`: a second call from a second device that raced the
-- first must not move the timestamp, because the timestamp is also the record
-- of WHEN somebody joined the product properly.
create or replace function public.api_mark_oriented(
  p_company_id uuid,
  p_user_id    uuid
) returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  with marked as (
    update public.company_members cm
       set oriented_at = now(),
           updated_at  = now()
     where cm.company_id = p_company_id
       and cm.user_id = p_user_id
       and cm.oriented_at is null
    returning cm.oriented_at
  )
  select jsonb_build_object(
    'oriented', true,
    -- False on the second call and on a caller with no membership. The route
    -- returns 200 either way — "you are oriented" is true in every one of
    -- those cases, and a client retrying after a dropped response must not be
    -- handed an error for succeeding twice.
    'marked', exists (select 1 from marked)
  );
$$;

comment on function public.api_mark_oriented(uuid, uuid) is
  '#286: the member finished or skipped the joining orientation. Idempotent — '
  'a second call leaves the original timestamp, which is also the record of '
  'when this person joined the product properly.';

revoke all on function public.api_mark_oriented(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.api_mark_oriented(uuid, uuid) to service_role;
