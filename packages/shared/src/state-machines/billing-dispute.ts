import { defineMachine } from "./define-machine";

/**
 * A Stripe dispute, recorded by record_billing_dispute (billing/disputes.ts).
 * The status is Stripe's own and the column is free text with no constraint,
 * so the vocabulary is Stripe's documented set. Losing a dispute revokes any
 * prepaid year bought with the payment (once, on the closing event).
 *
 * Phase 1 of #722: definition only, no runtime behaviour. See docs/STATE-MACHINES.md.
 */
export type BillingDisputeState = "warning_needs_response" | "warning_under_review" | "warning_closed" | "needs_response" | "under_review" | "won" | "lost";

export const billingDisputeMachine = defineMachine<BillingDisputeState>({
  id: "billing_dispute",
  description: "A Stripe dispute, recorded by record_billing_dispute (billing/disputes.ts).",
  authority: "provider",
  db: {
    kind: "none",
    columns: [{ table: "billing_disputes", column: "status" }],
    note: "free text copied from Stripe; no check constraint and no enum",
  },
  states: ["warning_needs_response", "warning_under_review", "warning_closed", "needs_response", "under_review", "won", "lost"],
  initial: ["warning_needs_response", "needs_response"],
  transitions: {
    warning_needs_response: ["warning_under_review", "warning_closed", "needs_response"],
    warning_under_review: ["warning_closed", "needs_response"],
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
