-- #484 — the contract step. D85's leak closes here.
--
-- `broadcast_number_scoped` has been publishing every number-scoped event TWICE
-- since #480: once to `company:{id}` for clients that had not yet adopted the
-- per-number topic, and once to `company:{id}:number:{n}`, which is the actual
-- boundary. The first of those is what D85 recorded as an accepted exposure — a
-- member denied a number still received every id-only event for conversations on
-- it, and therefore the volume and rhythm of a line they cannot read.
--
-- This migration deletes the company send. Nothing else changes: the `else` below
-- is permanent and always was.
--
-- ---------------------------------------------------------------------------
-- WHY IT IS SAFE TO DO THIS NOW, since D88 said it could not be done "in the same
-- change" because "two of the three clients are store-distributed".
--
-- That constraint was real and it has been discharged, not waived. The expand
-- half shipped, all three clients adopted the per-number topic (#480), and the
-- three ways a client could silently lose a per-number channel — iOS never
-- re-joining a refused channel, Android dropping a reconnect edge, and a failed
-- bootstrap number-list read on web and iOS — were fixed first (#484). Those were
-- the gaps the dual publish was masking; contracting over them would have turned
-- each one into an inbox that stops updating behind a healthy-looking socket.
--
-- The adoption question then answers itself, from three facts rather than a hope:
--
--   1. NOTHING IS DISTRIBUTED. `.github/workflows/ship.yml` builds the Android and
--      iOS artifacts and attaches them to the run; store upload is a credentials
--      gap it names explicitly. No build of either app is in anybody's hands, so
--      there is no un-adopted population for the transition send to protect.
--   2. THE EXPAND HALF HAS NOT REACHED PRODUCTION EITHER. Ship runs only when the
--      release PR merges, and #480's migrations are still behind it. Expand and
--      contract will therefore land in the same release — there is no window in
--      which a client sees one without the other.
--   3. WEB IS NOT STORE-DISTRIBUTED. It is served fresh, and its bootstrap retry
--      (#484) now re-derives the topic key after a failed /v1/me rather than
--      leaving it empty for the life of the page.
--
-- If a mobile build ever DOES ship ahead of a schema change again, the gate is
-- `app_release_policy` and its floor (#339) — a mechanism that already exists and
-- tells old builds to update, rather than a second copy of one built here.
--
-- ---------------------------------------------------------------------------
-- WHAT WOULD CATCH THIS BEING DONE WRONG. `number_scoped_topics.test.sql` NT-4:
-- the per-number send is guarded by `if p_number is not null`, so deleting the
-- WRONG line — the `else` — would silently drop the one event that has no number
-- to be scoped to (`call.updated` for a call whose number was deleted;
-- `calls.phone_number_id` is `on delete set null`). NT-4 asserts that event still
-- reaches the company topic, and it fails if the `else` goes.

create or replace function public.broadcast_number_scoped(
  p_payload jsonb,
  p_event text,
  p_company uuid,
  p_number uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_company is null then
    -- No company means no topic to send on. Silently doing nothing is right
    -- here: every caller is a trigger, and raising would abort the write that
    -- the event is merely describing.
    return;
  end if;

  if p_number is not null then
    -- The boundary, and now the only route for an event that has a number.
    -- Authorized by `is_company_topic_member`, which admits this shape only when
    -- `member_number_level` is not 'none' (D88).
    perform realtime.send(
      p_payload,
      p_event,
      'company:' || p_company::text || ':number:' || p_number::text,
      true);
  else
    -- PERMANENT, not a transitional fallback. An event with no number cannot be
    -- scoped to one, and there is exactly one: `call.updated` for a call whose
    -- number was deleted. Its access rule was deleted along with the number
    -- (`number_access.phone_number_id` is `on delete cascade`), so there is no
    -- restriction left to honour — a leak requires a restriction. Dropping the
    -- event instead would lose a state update to protect nothing.
    perform realtime.send(p_payload, p_event, 'company:' || p_company::text, true);
  end if;
end;
$function$;

comment on function public.broadcast_number_scoped(jsonb, text, uuid, uuid) is
  '#484: publish a number-scoped event to the per-number topic, or to the company '
  'topic when it has no number (permanent — a null-number call.updated has no '
  'restriction left to honour). The transition send to the company topic was '
  'removed here; D85''s accepted exposure is closed.';

-- The company topic is now a delivery channel for genuinely company-wide events
-- only (`registration.updated`, `read.notifications`, `access.changed`,
-- `number_set.changed`) plus the null-number fallback above. It is no longer a
-- second copy of every conversation's traffic.
do $$
declare
  -- The company-topic send, spelled exactly as the function spells it.
  needle  constant text := '''company:'' || p_company::text, true)';
  v_body  text;
  v_sends int;
begin
  select pg_get_functiondef(p.oid) into v_body
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'broadcast_number_scoped';

  v_sends := (length(v_body) - length(replace(v_body, needle, ''))) / length(needle);

  -- Exactly one company send must remain: the `else`. TWO means this migration
  -- did not take and the transition is still live. ZERO means the wrong line
  -- went and a null-number `call.updated` now reaches nobody at all — the
  -- failure #480 wrote its own correction migration to prevent.
  if v_sends <> 1 then
    raise exception
      'contract step: expected exactly one company-topic send to remain, found %',
      v_sends;
  end if;
end $$;
