import { defineMachine } from "./define-machine";

/**
 * A Stripe dispute, recorded by record_billing_dispute (billing/disputes.ts).
 * The status is Stripe's own and the column is free text with no constraint,
 * so the vocabulary is Stripe's documented set. Losing a dispute revokes any
 * prepaid year bought with the payment (once, on the closing event).
 *
 * An inquiry may reach any later status in one step: an escalation to
 * needs_response whose event was missed still arrives as under_review, won or
 * lost. The edges rule out only going backwards (#722).
 */
export type BillingDisputeState = "warning_needs_response" | "warning_under_review" | "warning_closed" | "needs_response" | "under_review" | "won" | "lost";

/** A Stripe dispute, recorded by record_billing_dispute (billing/disputes.ts). */
export const billingDisputeMachine = defineMachine<BillingDisputeState>({
  id: "billing_dispute",
  authority: "provider",
  db: {
    kind: "none",
    columns: [{ table: "billing_disputes", column: "status" }],
    note: "free text copied from Stripe; no check constraint and no enum",
  },
  states: ["warning_needs_response", "warning_under_review", "warning_closed", "needs_response", "under_review", "won", "lost"],
  initial: ["warning_needs_response", "needs_response"],
  transitions: {
    warning_needs_response: ["warning_under_review", "warning_closed", "needs_response", "under_review", "won", "lost"],
    warning_under_review: ["warning_closed", "needs_response", "under_review", "won", "lost"],
    warning_closed: [],
    needs_response: ["under_review", "won", "lost"],
    under_review: ["won", "lost"],
    won: [],
    lost: [],
  },
  entryEffects: {
    lost: ["revoke_prepaid_year"],
  },
});
