-- Calls v3 (#170, docs/CALLS-V3.md §12.1 step 5) — drop the now-dead pre-DO
-- ring RPCs. The kill switch and the whole pre-DO ring engine
-- (apps/api/src/messaging/inbound-ring.ts) are gone, so nothing in the app
-- calls these anymore. The v3 state migration (20260717000000) deliberately
-- left them in place until this point; this is that point.
--
-- Both are the (text, text) overload (p_call_session_id, p_call_control_id).
-- IF EXISTS keeps the drop idempotent across environments where an earlier
-- teardown already removed them. Additive-only: no shipped migration is edited.

drop function if exists public.api_claim_ring_answer(text, text);
drop function if exists public.api_ring_leg_failed(text, text);
