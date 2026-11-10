import { capabilityActions, defineMachine } from "./define-machine";

/**
 * A text scheduled for later, including appointment reminders (#325, #237). A
 * claim is a LEASE (claimed_at), not a state: a due row is claimed every
 * minute whether pending or held. Hold and failure notices are entry effects
 * and must not repeat. The 2026-11-10 push flood was this machine: the held
 * notice ran on every claim. scheduled-send.ts now compares the claimed row
 * against the new hold (alreadyHeldFor); phase 2 moves that comparison into
 * the RPC so it cannot be skipped.
 *
 * Phase 1 of #722: definition only, no runtime behaviour. See docs/STATE-MACHINES.md.
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
