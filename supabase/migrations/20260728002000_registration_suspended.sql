-- ===========================================================================
-- [#423] The 10DLC state machine has no word for "the carrier took it away".
--
-- The vocabulary was draft → submitted → pending → approved | rejected, plus a
-- `deactivated_at` stamp. Every one of those is a transition WE initiated or
-- were waiting for. There was no state for a campaign that was approved and
-- later suspended or revoked by the carrier — which is an ordinary operational
-- event in A2P messaging, not an exotic one: content that trips a policy
-- filter, a complaint rate, a brand or TCR issue, or a change in the
-- aggregator's own standing.
--
-- WHY IT MATTERED MORE THAN IT LOOKED. `getSendGates` computes
-- `usApproved` from `status === 'approved'`, so a revoked campaign kept
-- reading as approved and `runPreSendGates` let every send through. Messages
-- would leave, be accepted, and not arrive — the silent-failure shape of #379,
-- and the customer could not report it from inside the product (#382).
--
-- DISTINCT FROM `deactivated_at`, deliberately, and the two must never be
-- collapsed: `deactivated_at` means WE stopped paying for the campaign (D2, on
-- cancellation), `suspended` means WE ARE NOT ALLOWED TO SEND. One is a
-- billing state we chose, the other is a carrier decision imposed on us, and
-- only one of them is recoverable by re-subscribing.
--
-- ITS OWN MIGRATION because `alter type ... add value` cannot be used by
-- statements in the same transaction that adds it. Nothing else belongs here.
-- ===========================================================================

alter type public.registration_status add value if not exists 'suspended';

comment on type public.registration_status is
  '#423: draft/submitted/pending/approved/rejected are OUR side of the review. `suspended` is the carrier taking an approved campaign away — distinct from companies.deactivated_at, which is us stopping the recurring fee.';
