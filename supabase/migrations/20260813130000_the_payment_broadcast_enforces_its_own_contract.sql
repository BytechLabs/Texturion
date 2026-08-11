-- #607 round two — the payment broadcast stops trusting and starts enforcing.
--
-- `20260813110000_the_deposit_lands_before_anyone_refreshes.sql` shipped the
-- feature and it works: a `payment_paid` row reaches the crew's screen on the
-- thread's per-number topic, and the other thirty conversation-event types stay
-- quiet. An adversarial pass then broke twenty-one guards on purpose and found
-- seven that survived. Two of those seven are in this function, and both are
-- the same mistake in different clothes: THE MIGRATION ARGUED FOR A PROPERTY IN
-- PROSE AND ENFORCED IT NOWHERE.
--
-- This is a second `create or replace` rather than an edit of that file. A
-- shipped migration is never rewritten (D7/D14) — `schema_migrations` records
-- the statements that actually ran, so editing the first one would put the
-- recorded history and the tree out of step.
--
-- ===========================================================================
-- ONE. A ONE-WORD MISTAKE DESTROYED THE AUDIT TRAIL, SILENTLY.
-- ===========================================================================
--
-- `return null` is correct and REQUIRED in an AFTER trigger: the return value is
-- discarded, and returning `new` there would be noise. In a BEFORE trigger the
-- same statement means SKIP THIS ROW. Changing the one word `after` to `before`
-- in the trigger below therefore produced, measured rather than reasoned:
--
--   psql                      INSERT 0 0
--   realtime.messages         one payment.updated broadcast
--   conversation_events       ZERO ROWS
--
-- The customer paid, "Paid" flashed live on the crew's screen, and nothing was
-- ever recorded. The whole suite stayed green, because every assertion was about
-- the BROADCAST and none of them read the row the broadcast was about.
--
-- The suite now reads that row back everywhere (PR-8 through PR-13). This
-- function additionally refuses to be wired that way at all: `tg_when` is a
-- fact plpgsql already has, and a mistake that costs a payment record should be
-- a loud failure on the first insert rather than a screen that lies.
--
-- ===========================================================================
-- TWO. `->>` ON AN OBJECT PUT A CUSTOMER'S WORDS ON THE WIRE.
-- ===========================================================================
--
-- `conversation_events.payload` is an untyped `jsonb` column with no shape
-- check, and `new.payload->>'payment_request_id'` does not mean "the id". It
-- means "whatever is under that key, rendered as text" — and for an OBJECT or an
-- ARRAY that is the whole thing, serialised. Proved live with
--
--   {"payment_request_id": {"note": "customer said the tile was cracked"}}
--
-- which broadcast those words to every subscriber on the number's topic.
--
-- SPEC §8 says ID-ONLY. The first version rested that guarantee on the WRITERS —
-- today `webhooks/stripe-connect.ts`, which does pass a uuid. A guarantee that
-- holds because of who calls you is not a guarantee; it is a coincidence with
-- good manners, and `conversation_events` is written from many places.
--
-- So the trigger takes the value only when it is a JSON STRING that the uuid
-- parser accepts, and sends null otherwise. Not a hand-written pattern:
-- `pg_input_is_valid(…, 'pg_catalog.uuid')` asks the type's own input function,
-- so it cannot drift from what a uuid is. Null costs the client nothing —
-- `conversation_id` is the load-bearing key and every client already treats the
-- request id as optional, exactly because the first version could send null.
--
-- ===========================================================================
-- THREE. "AFTER INSERT ONLY" WAS ARGUED AT LENGTH AND HELD BY NOTHING.
-- ===========================================================================
--
-- The first migration spends a paragraph on why the trigger is `after insert`
-- and not `after insert or update`: `conversation_events` is an append-only
-- audit timeline, and an event re-announced by a backfill or a scrub would put
-- "Paid" back on a screen for a payment that landed months ago. Widening it
-- passed every test. That is worse than having written nothing, because the next
-- reader takes the paragraph for a constraint.
--
-- `tg_op` makes it one. There are no UPDATE writers against this table today
-- (erasure reaches it by DELETE), so nothing legitimate can hit this; if one
-- ever appears, whoever widens the trigger gets an error naming the reason
-- instead of a re-announced payment.

create or replace function public.broadcast_payment_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_number  uuid;
  v_request uuid;
  v_raw     text;
begin
  -- THE WIRING, checked before anything else. Both of these are constants of the
  -- trigger definition rather than of the row, so this is a deploy-time mistake
  -- caught on the first write rather than a per-row condition.
  --
  -- BEFORE: `return null` below would skip the row — the payment would be
  -- announced and never recorded. AFTER an UPDATE: an audit row is not news the
  -- second time, and re-announcing one is how a months-old payment reappears as
  -- if it had just landed.
  if tg_when is distinct from 'AFTER' or tg_op is distinct from 'INSERT' then
    raise exception
      'broadcast_payment_change is wired % % and must be AFTER INSERT: '
      'its `return null` SKIPS THE ROW in a BEFORE trigger (the payment is '
      'broadcast and never recorded), and conversation_events is an '
      'append-only audit timeline with no UPDATE writer to re-announce',
      tg_when, tg_op;
  end if;

  -- `conversation_events` carries `company_id` directly, so only the NUMBER has
  -- to be resolved. One primary-key read: `conversations.phone_number_id` is
  -- NOT NULL and `on delete restrict`, so for a non-null conversation_id this
  -- join is total and single-row.
  --
  -- From the CONVERSATION, never from the company. A workspace can hold many
  -- numbers, a thread belongs to exactly one, and a payment announced on the
  -- wrong one reaches members who were denied the line it actually arrived on.
  -- PR-11 is a company with two numbers and a thread on each, which is the only
  -- fixture shape that can tell these two resolutions apart.
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

  -- ID-ONLY, enforced here rather than trusted from the writer. See the header:
  -- `->>` on an object serialises the object, and this column takes any jsonb
  -- anyone hands it.
  if jsonb_typeof(new.payload -> 'payment_request_id') = 'string' then
    v_raw := new.payload ->> 'payment_request_id';
    -- The uuid type's own input function, asked whether it would accept this.
    -- Schema-qualified because this function runs with an empty `search_path`,
    -- and a type name is resolved through it.
    if pg_input_is_valid(v_raw, 'pg_catalog.uuid') then
      v_request := v_raw::uuid;
    end if;
  end if;

  perform public.broadcast_number_scoped(
    jsonb_build_object(
      'conversation_id', new.conversation_id,
      -- Still a JSON string on the wire and still null when the writer omitted
      -- it — `jsonb_build_object` keeps a key whose value is null, so the
      -- payload's shape does not change with its contents.
      'payment_request_id', v_request,
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
  'for every tag and assignment, and none of those has a listener. Round two: '
  'the AFTER-INSERT wiring and the ID-only payload are enforced here rather '
  'than argued in prose — a BEFORE wiring would skip the audit row, and ->> on '
  'a jsonb object would broadcast the object.';

-- `create or replace` PRESERVES existing privileges, so the round-one revoke
-- still stands and this is not repairing it. It is repeated because the failure
-- it prevents is silent and the repetition is one line: a function that is ever
-- dropped and recreated comes back holding the default PUBLIC execute grant that
-- `anon` and `authenticated` inherit. PR-7 now asserts this function's grants
-- alongside the three money writers, so the claim is checked rather than stated.
revoke all on function public.broadcast_payment_change()
  from public, anon, authenticated;

-- The trigger itself is unchanged and is deliberately NOT recreated here:
-- `create or replace function` swaps the body under the existing trigger, and
-- dropping and recreating a trigger to change nothing is the drop-and-create
-- idiom this repository refuses (rule 5). Its timing and event are now asserted
-- from inside the function above, and from `pg_trigger` in PR-12.
