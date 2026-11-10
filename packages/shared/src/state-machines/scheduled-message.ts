import { capabilityActions, defineMachine } from "./define-machine";

/**
 * A text scheduled for later, including appointment reminders (#325, #237). A
 * claim is a LEASE (claimed_at), not a state: a due row is claimed every
 * minute whether pending or held. Hold and failure notices are entry effects
 * and must not repeat. The 2026-11-10 push flood was this machine: the held
 * notice ran on every claim. The hold RPCs now report whether they entered
 * the state, and a trigger refuses any move outside these edges (#722 phase 2,
 * see docs/STATE-MACHINES.md).
 */
export type ScheduledMessageState = "pending" | "held" | "sent" | "canceled" | "expired" | "failed";

/** A text scheduled for later, including appointment reminders (#325, #237). */
export const scheduledMessageMachine = defineMachine<ScheduledMessageState>({
  id: "scheduled_message",
  authority: "internal",
  db: {
    kind: "check",
    columns: [{ table: "scheduled_messages", column: "status" }],
  },
  states: ["pending", "held", "sent", "canceled", "expired", "failed"],
  initial: ["pending"],
  transitions: {
    pending: ["pending", "held", "sent", "canceled", "expired", "failed"],
    held: ["held", "pending", "sent", "canceled", "expired", "failed"],
    sent: [],
    canceled: [],
    expired: [],
    failed: [],
  },
  entryEffects: {
    held: ["notify_owner_held"],
    failed: ["notify_owner_failed"],
    expired: ["notify_owner_expired"],
    sent: ["queue_outbound_message"],
  },
  actions: capabilityActions<ScheduledMessageState>({
    pending: [{ action: "edit", capability: "conversations.send" }, { action: "cancel", capability: "conversations.send" }],
    held: [{ action: "edit", capability: "conversations.send" }, { action: "cancel", capability: "conversations.send" }],
  }),
});
