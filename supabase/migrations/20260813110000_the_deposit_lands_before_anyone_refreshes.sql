-- #607 — being paid reaches the crew the moment the card clears.
--
-- `webhooks/stripe-connect.ts` writes a `payment_paid` row into
-- `conversation_events` and nothing announced it. That table has never had a
-- broadcast trigger, so "Paid" appeared on the NEXT FETCH — opening the thread,
-- a client mutation, or coming back to the app. Somebody standing in a driveway
-- waiting to know whether they can start work was pulling to refresh.
--
-- ===========================================================================
-- THE CONTRACT. Three clients key off this, so it is stated before the code.
-- ===========================================================================
--
--   event    payment.updated
--   topic    company:{company_id}:number:{phone_number_id}   (see below)
--   payload  { conversation_id, payment_request_id, type }
--
--     conversation_id      the thread to refetch. Always present — a payment
--                          request belongs to the thread it was sent into.
--     payment_request_id   the row that changed, read out of the event payload.
--                          Lets a client patch ONE card instead of a list. Null
--                          if the writer omitted it; the conversation is the
--                          load-bearing key and a client can always fall back
--                          to refetching the thread.
--     type                 'payment_paid' | 'payment_refunded' |
--                          'payment_disputed' — the `conversation_event_type`
--                          value VERBATIM.
--
-- ID-ONLY (SPEC §8): two ids and a discriminator. No amount, no currency, no
-- description, no customer. The clients refetch through the API so authorization
-- stays in one place.
--
-- ---------------------------------------------------------------------------
-- WHY THE DISCRIMINATOR IS `type` AND NOT `status`.
--
-- Every other event names its discriminator `status` (`number.updated`,
-- `port.updated`, `registration.updated`), and copying that here would have been
-- the wrong kind of consistency. `payment_requests.status` is
-- 'requested'|'paid'|'cancelled'|'expired' and DELIBERATELY never says refunded
-- or disputed — 20260813060000 spells out why: both happen to a request that is
-- and stays PAID, and collapsing them into the status would lose the fact that
-- money changed hands. A key called `status` carrying 'payment_refunded' would
-- contradict the column of the same name that the client reads two lines later.
--
-- So the key is the COLUMN it comes from — `conversation_events.type` — carried
-- under its own name, exactly as `registration.updated` carries `kind`.
--
-- ---------------------------------------------------------------------------
-- WHY THE VALUE IS THE ENUM LABEL AND NOT A TRIMMED 'paid'/'refunded'.
--
-- Because the trimmed form would be a SECOND vocabulary. `payment_paid` and its
-- two siblings are already shipped constants in two places that
-- `scripts/check-conversation-events.mjs` holds equal in both directions: the
-- `conversation_event_type` enum and `ConversationEventType` in
-- `apps/api/src/routes/core/events.ts`. Every client already renders timeline
-- rows keyed on exactly these strings. Stripping the prefix in SQL would invent
-- a third list of three words that three clients would each map back — and a
-- list written three times is the one that drifts.
--
-- ===========================================================================
-- THE TOPIC IS PER-NUMBER, WHICH IS NOT WHAT #607 SAID.
-- ===========================================================================
--
-- #607 describes the topic as `company:{company_id}` and points at
-- `is_company_topic_member`. That was true when the five original triggers were
-- written and it is not true now: #484 (20260730070000) deleted the company-topic
-- send from `broadcast_number_scoped`, and every conversation-scoped event now
-- goes to `company:{id}:number:{n}` alone. That WAS the closing of D85's
-- exposure — a member denied a number could otherwise watch its traffic.
--
-- A payment event is conversation-scoped: it names a thread, and a thread belongs
-- to a number. Sending it to the company topic would hand a member who is denied
-- a line the fact that money just arrived on it, which is precisely the leak
-- #484 closed. So it goes through the same helper as `message.created`, and
-- inherits the same boundary and the same eventual contract step.
--
-- The clients are unaffected by the correction: they already subscribe per
-- number and receive every conversation event that way.
--
-- ===========================================================================
-- SCOPED TO THREE TYPES, IN THE TRIGGER'S `WHEN`.
-- ===========================================================================
--
-- `conversation_events` takes a row for every tag, assignment, done-mark, task
-- change, opt-out and attachment. A blanket trigger would publish all of it, no
-- client is written to receive any of it, and Realtime bills per message. The
-- `WHEN` clause means the function is not even entered for those rows.
--
-- The two OTHER payment types are deliberately not here:
--
--   payment_requested   the request is delivered as an ordinary outbound
--                       message, and `message.created` already fires for it —
--                       a second event would be the same news twice.
--   payment_cancelled   written by a crew member through the API, in the app,
--                       on purpose. A live signal for it is defensible and it
--                       is not what #607 asked for; adding it here would put a
--                       decision nobody made into a contract three clients are
--                       about to build against.
--
-- `supabase/tests/payment_requests.test.sql` PR-10 derives the payment family
-- from the enum itself and asserts exactly which members broadcast, in BOTH
-- directions — so a sixth `payment_*` type fails the suite until somebody
-- decides which side of this line it belongs on, rather than silently landing
-- on the quiet side.
--
-- ===========================================================================
-- AFTER INSERT ONLY.
-- ===========================================================================
--
-- `conversation_events` is an append-only audit timeline: no migration and no
-- route issues an UPDATE against it (the erasure work reaches it by DELETE).
-- `or update` would therefore add a branch with no writer — and if one ever
-- appears, an event re-announced by a backfill or a scrub would put "Paid" back
-- on a screen for a payment that landed months ago.

create or replace function public.broadcast_payment_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_number uuid;
begin
  -- `conversation_events` carries `company_id` directly, so only the NUMBER has
  -- to be resolved. One primary-key read: `conversations.phone_number_id` is
  -- NOT NULL and `on delete restrict`, so for a non-null conversation_id this
  -- join is total and single-row.
  --
  -- Per-row cost is worth stating because a blanket trigger would have paid it
  -- on every tag and assignment. It is paid here only for the three types the
  -- WHEN clause admits, which in a working month is a handful of rows.
  select c.phone_number_id into v_number
    from public.conversations c
   where c.id = new.conversation_id;

  if v_number is null then
    -- No conversation, therefore no thread to update and no number to scope to.
    -- Unreachable for these three types — the schema CHECK
    -- `conversation_events_conv_required` permits a null conversation_id only
    -- for the three contact-level opt-out types — but returning is the honest
    -- answer rather than falling back to the company topic, which is the one
    -- route that would publish past the number boundary.
    return null;
  end if;

  perform public.broadcast_number_scoped(
    jsonb_build_object(
      'conversation_id', new.conversation_id,
      -- text, not jsonb: `->>` yields the id as a string like every other id in
      -- every other payload. Null when the writer omitted it.
      'payment_request_id', new.payload->>'payment_request_id',
      -- The enum label verbatim. `::text` is explicit rather than relying on
      -- to_jsonb's fallback for a user-defined type.
      'type', new.type::text),
    'payment.updated', new.company_id, v_number);
  return null;
end $$;

comment on function public.broadcast_payment_change() is
  '#607: publishes payment.updated {conversation_id, payment_request_id, type} '
  'when a payment_paid / payment_refunded / payment_disputed row lands in '
  'conversation_events, so a deposit reaches the crew''s screen without a '
  'refetch. Scoped by the trigger WHEN clause — conversation_events takes a row '
  'for every tag and assignment, and none of those has a listener.';

-- The trigger mechanism does not re-check EXECUTE when it fires (the check is
-- at CREATE TRIGGER, below, where the owner holds it implicitly), so this costs
-- the trigger nothing. It is here because a freshly created function carries the
-- default PUBLIC execute grant that `anon` and `authenticated` inherit, and a
-- SECURITY DEFINER function is not something a client role should be able to
-- name at all.
revoke all on function public.broadcast_payment_change()
  from public, anon, authenticated;

create trigger conversation_events_payment_broadcast
  after insert on public.conversation_events
  for each row
  -- The scope. `conversation_events.type` is NOT NULL, so the three-valued
  -- outcome that would make a `= any(...)` silently never fire cannot arise
  -- here; the array is cast to the enum so this resolves against the type
  -- rather than against whatever `search_path` happens to be at create time.
  when (new.type = any (array[
          'payment_paid', 'payment_refunded', 'payment_disputed'
        ]::public.conversation_event_type[]))
  execute function public.broadcast_payment_change();
