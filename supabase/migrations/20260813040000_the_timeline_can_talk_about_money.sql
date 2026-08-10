-- #224 — the five timeline types text-to-pay writes.
--
-- In their OWN migration, following 20260702050000: a new enum value cannot be
-- USED in the transaction that adds it, and each migration file runs in one
-- transaction. The values are first used by application code, never inside a
-- migration.
--
-- #554 is the reason this file is not an afterthought at the bottom of the
-- table migration. A type the code writes and the enum does not have raises
-- `invalid input value for enum` inside a handler that catches and logs — so
-- the payment lands, the money is real, and the thread never mentions it.
-- `scripts/check-conversation-events.mjs` fails the build if these five and
-- `ConversationEventType` ever disagree, in either direction.
--
-- The `conversation_events_conv_required` CHECK (20260701000200_tables.sql) is
-- NOT altered: a payment request belongs to the thread it was sent into, so
-- every one of these always carries a non-null conversation_id and the shipped
-- constraint is satisfied as-is. Editing a shipped constraint is forbidden
-- (D7/D14).
--
--   'payment_requested'  the crew asked for money, and for how much
--   'payment_paid'       the customer paid it
--   'payment_cancelled'  the crew killed the request before it was paid
--   'payment_refunded'   the business refunded it from their own dashboard
--   'payment_disputed'   the customer's bank pulled it back
--
-- Refunded and disputed are here, and not merely statuses, because they are the
-- two events a crew most needs to see WHERE THE JOB IS — a refund discussed in
-- Stripe and invisible in the thread is how two people end up telling a
-- customer different things.

alter type public.conversation_event_type add value if not exists 'payment_requested';
alter type public.conversation_event_type add value if not exists 'payment_paid';
alter type public.conversation_event_type add value if not exists 'payment_cancelled';
alter type public.conversation_event_type add value if not exists 'payment_refunded';
alter type public.conversation_event_type add value if not exists 'payment_disputed';
