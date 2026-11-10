import { capabilityActions, defineMachine } from "./define-machine";

/**
 * companies.subscription_status, a mirror of the Stripe subscription
 * (syncSubscription in apps/api/src/webhooks/stripe.ts, via
 * mirrorSubscriptionStatus). Stripe decides; the write is an unconditional
 * overwrite, so today every edge is accepted. The graph is Stripe's documented
 * lifecycle. A Stripe paused subscription is deliberately unmappable (the
 * mirror leaves the state alone); our own pause is the separate paused_at
 * column (see workspace).
 *
 * Phase 1 of #722: definition only, no runtime behaviour. See docs/STATE-MACHINES.md.
 */
export type SubscriptionState = "incomplete" | "incomplete_expired" | "active" | "past_due" | "unpaid" | "canceled";

/** companies.subscription_status, a mirror of the Stripe subscription (syncSubscription in apps/api/src/webhooks/stripe.ts, via mirrorSubscriptionStatus). */
export const subscriptionMachine = defineMachine<SubscriptionState>({
  id: "subscription",
  authority: "provider",
  db: {
    kind: "enum",
    enumType: "subscription_status",
    columns: [{ table: "companies", column: "subscription_status" }],
  },
  states: ["incomplete", "incomplete_expired", "active", "past_due", "unpaid", "canceled"],
  initial: ["incomplete"],
  transitions: {
    incomplete: ["active", "incomplete_expired", "canceled"],
    incomplete_expired: [],
    active: ["past_due", "unpaid", "canceled"],
    past_due: ["active", "unpaid", "canceled"],
    unpaid: ["active", "canceled"],
    canceled: ["incomplete", "active"],
  },
  actions: capabilityActions<SubscriptionState>({
    incomplete: [{ action: "subscribe", capability: "billing.manage" }],
    past_due: [{ action: "update_payment_method", capability: "billing.manage" }],
    unpaid: [{ action: "update_payment_method", capability: "billing.manage" }],
    canceled: [{ action: "resubscribe", capability: "billing.manage" }],
  }),
});
