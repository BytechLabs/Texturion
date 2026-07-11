-- #129 Calls feature: the `call_completed` conversation-event type. Lives in
-- its own migration because an enum value cannot be USED in the transaction
-- that adds it (same two-file pattern as 20260703060000).
--
-- Written by api_thread_call (next migration) whenever a call threads into a
-- conversation, payload {call_session_id, outcome, forward_seconds, caller}.
-- The existing 'missed_call' event is UNTOUCHED — it is the text-back claim's
-- idempotency key and renders its own "we texted them back" line; a missed
-- call with text-back therefore shows two honest lines (the call, the text).
alter type public.conversation_event_type add value if not exists 'call_completed';
