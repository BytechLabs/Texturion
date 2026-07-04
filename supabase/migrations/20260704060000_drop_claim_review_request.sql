-- The one-tap "Ask for a review" endpoint (POST /v1/conversations/:id/
-- review-request) was removed from the product: owners send review asks from a
-- saved template instead ({review_link} still merges from
-- companies.google_review_link on every send — that column stays).
--
-- This drops the endpoint's only DB artifact, the atomic claim function
-- (defined in 20260703040000, revised in 20260703080000). The
-- 'review_requested' conversation_event_type enum VALUE stays — Postgres
-- cannot drop enum values, and historical conversation_events rows of that
-- type remain readable audit history.
drop function if exists public.claim_review_request(
  uuid, uuid, uuid, text, int, int
);
