import { defineMachine } from "./define-machine";

/**
 * A provider push channel for a calendar connection. The table is named
 * webhook_subscriptions and has nothing to do with our outbound webhooks
 * (webhook_delivery). renewing and expired are in the constraint but no
 * function writes them: renewal is tracked with renewal_lease_owner and
 * renewal_attempts and a failure writes error. The edges list them so the
 * vocabulary matches the database; phase 2 either starts writing them or drops
 * them from the constraint.
 *
 * Phase 1 of #722: definition only, no runtime behaviour. See docs/STATE-MACHINES.md.
 */
export type CalendarPushSubscriptionState = "active" | "renewing" | "error" | "expired" | "revoking" | "revoked";

/** A provider push channel for a calendar connection. */
export const calendarPushSubscriptionMachine = defineMachine<CalendarPushSubscriptionState>({
  id: "calendar_push_subscription",
  authority: "internal",
  db: {
    kind: "check",
    columns: [{ table: "webhook_subscriptions", column: "status" }],
  },
  states: ["active", "renewing", "error", "expired", "revoking", "revoked"],
  initial: ["active"],
  transitions: {
    active: ["error", "revoking", "revoked"],
    renewing: ["active", "error", "revoking", "revoked"],
    error: ["active", "revoking", "revoked"],
    expired: ["revoking", "revoked"],
    revoking: ["revoked"],
    revoked: [],
  },
  entryEffects: {
    revoking: ["revoke_at_provider"],
    revoked: ["stamp_revoked_at"],
  },
  unwritten: ["renewing", "expired"],
});
