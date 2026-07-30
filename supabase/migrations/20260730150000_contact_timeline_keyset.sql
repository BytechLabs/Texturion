-- [#324] The contact timeline paginates on the FULL sort key, opaquely.
--
-- The first cut (20260730140000) took a bare `p_before timestamptz` and filtered
-- `e.occurred_at < p_before`. Two things were wrong with that, and the second
-- one is a data-loss-in-view bug rather than a style point.
--
-- ---------------------------------------------------------------------------
-- 1. IT SKIPPED ROWS AT A PAGE BOUNDARY.
--
-- The ordering is `(occurred_at desc, id desc)` but the predicate compared only
-- `occurred_at`. When two entries share a timestamp and the page boundary falls
-- between them, the next page starts strictly BELOW that timestamp, so the
-- second row is never returned by anything.
--
-- Its own comment claimed the opposite — "id breaks ties so a page boundary
-- cannot repeat or skip a row when two records share a timestamp, which they do
-- whenever a call threads a message". The ORDER BY did break ties; the WHERE
-- did not. A call threading a message is exactly the case that produces
-- identical timestamps, so this was reachable rather than theoretical.
--
-- The fix is the row-wise comparison, which is what a keyset cursor is for:
--   (e.occurred_at, e.id) < (p_before_ts, p_before_id)
--
-- ---------------------------------------------------------------------------
-- 2. A RAW TIMESTAMP CURSOR IS NOT WHAT THIS CODEBASE USES.
--
-- SPEC §7 / D10: "lists are cursor-based only — an opaque base64url encoding of
-- the composite sort key (timestamptz, id)". `apps/api/src/http/pagination.ts`
-- has encodeCursor/decodeCursor and has since the beginning.
--
-- Ignoring it cost a real iOS-only defect. A Postgres timestamptz renders as
-- `2026-07-30T12:34:56.789012+00:00`; `URLComponents.queryItems` does not
-- percent-encode `+` (it is in `CharacterSet.urlQueryAllowed`), and Hono's query
-- decoder turns a raw `+` into a space — so the route saw `...789012 00:00`,
-- `Date.parse` returned NaN, and every "Show earlier" tap on iOS came back 422
-- while the empty catch swallowed it. base64url exists precisely because it
-- replaces `+` with `-`.
--
-- So the transport is now the shared opaque cursor, and this function takes the
-- decoded halves like every other list.

-- The 4-arg version is replaced, not kept: leaving it would make an unqualified
-- call ambiguous, and nothing outside this repo can hold a reference to it.
-- destructive-ok: dropping a function added hours earlier in the same release,
-- before any client shipped against it; the replacement below is the only
-- caller-visible form.
drop function if exists public.api_contact_timeline(uuid, uuid, int, timestamptz);

create or replace function public.api_contact_timeline(
  p_company_id uuid,
  p_contact_id uuid,
  p_limit      int default 50,
  -- The decoded halves of the opaque cursor. Both null on the first page; the
  -- API layer never passes one without the other.
  p_before_ts  timestamptz default null,
  p_before_id  uuid default null
) returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with entries as (
    -- CONVERSATIONS, ordered by last activity rather than creation: a thread
    -- reopened last week belongs beside last week.
    select
      'conversation'::text as kind,
      c.id                 as id,
      coalesce(c.last_message_at, c.created_at) as occurred_at,
      c.id                 as conversation_id,
      c.status::text       as status,
      null::text           as detail,
      c.created_at         as started_at,
      null::int            as talk_seconds,
      null::timestamptz    as due_at,
      null::boolean        as done
    from public.conversations c
    where c.company_id = p_company_id
      and c.contact_id = p_contact_id
      -- A spam thread is not part of the relationship. It stays reachable in
      -- the inbox's spam view; here it would be the one entry that makes the
      -- rest untrustworthy.
      and coalesce(c.is_spam, false) = false

    union all

    select
      'call'::text,
      k.id,
      k.started_at,
      k.conversation_id,
      k.outcome::text,
      k.caller_name,
      k.started_at,
      -- Talk time: the forward leg's billable seconds, never ring time.
      k.forward_seconds,
      null::timestamptz,
      null::boolean
    from public.calls k
    where k.company_id = p_company_id
      and k.contact_id = p_contact_id

    union all

    -- TASKS, via their conversation. `done` derives from the source message's
    -- done_at exactly as the checklist reads it (D17), rather than a second
    -- flag that could disagree with the thread it came from.
    select
      'task'::text,
      t.id,
      t.created_at,
      t.conversation_id,
      null::text,
      t.title,
      t.created_at,
      null::int,
      t.due_at,
      m.done_at is not null
    from public.tasks t
    join public.conversations tc on tc.id = t.conversation_id
    join public.messages m on m.id = t.message_id
    where t.company_id = p_company_id
      and tc.contact_id = p_contact_id
      and t.deleted_at is null
  )
  select jsonb_build_object(
    'kind', e.kind,
    'id', e.id,
    'occurred_at', e.occurred_at,
    'conversation_id', e.conversation_id,
    'status', e.status,
    'detail', e.detail,
    'started_at', e.started_at,
    'talk_seconds', e.talk_seconds,
    'due_at', e.due_at,
    'done', e.done
  )
  from entries e
  where p_before_ts is null
     -- ROW-WISE, matching the ORDER BY exactly. Comparing only the timestamp
     -- skips the second of any two entries that share one.
     or (e.occurred_at, e.id) < (p_before_ts, p_before_id)
  order by e.occurred_at desc, e.id desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

comment on function public.api_contact_timeline is
  'One chronology of a contact''s conversations, calls and tasks (#324). Keyset-paginated on the full (occurred_at, id) sort key, so a page boundary between two entries sharing a timestamp cannot skip one — which the timestamp-only first cut did, reachably, since a call threading a message produces identical timestamps. The API layer carries the key as the shared opaque base64url cursor (SPEC §7/D10). Spam conversations are excluded. Tasks reach the contact through their conversation (D17); when D64''s call-anchored tasks land this needs a fourth arm.';

revoke all on function public.api_contact_timeline(uuid, uuid, int, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.api_contact_timeline(uuid, uuid, int, timestamptz, uuid)
  to service_role;
