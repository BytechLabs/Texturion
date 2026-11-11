import { capabilityActions, defineMachine } from "./define-machine";

/**
 * A payment link sent in a thread. paid is written by
 * api_mark_payment_request_paid (Stripe webhook), expired by
 * expire_payment_requests, cancelled by two routes in
 * apps/api/src/routes/payments.ts (direct updates, not an RPC). Refund and
 * dispute are thread events (conversation_event_type), not statuses.
 *
 * Phase 1 of #722: definition only, no runtime behaviour. See docs/STATE-MACHINES.md.
 */
export type PaymentRequestState = "requested" | "paid" | "cancelled" | "expired";

/** A payment link sent in a thread. */
export const paymentRequestMachine = defineMachine<PaymentRequestState>({
  id: "payment_request",
  authority: "internal",
  db: {
    kind: "check",
    columns: [{ table: "payment_requests", column: "status" }],
  },
  states: ["requested", "paid", "cancelled", "expired"],
  initial: ["requested"],
  transitions: {
    requested: ["paid", "cancelled", "expired"],
    paid: [],
    // The money is real: a payment that lands after a cancel or expiry is
    // recorded (api_mark_payment_request_paid keeps the cancellation stamp).
    cancelled: ["paid"],
    expired: ["paid"],
  },
  entryEffects: {
    paid: ["thread_event_payment_paid"],
    cancelled: ["thread_event_payment_cancelled"],
  },
  actions: capabilityActions<PaymentRequestState>({
    requested: [{ action: "cancel", capability: "conversations.send" }],
  }),
});
