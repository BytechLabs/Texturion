import { capabilityActions, defineMachine } from "./define-machine";

/**
 * messages.status for texts. NULL for internal notes (direction note, 17 rows
 * on production), so the machine is about inbound and outbound texts only.
 * markSent only moves queued to sent (never regress), but the
 * message.finalized handler (apps/api/src/messaging/status.ts) writes the
 * final status keyed on telnyx_message_id with no from-state guard, so a late
 * replay can regress delivered to sent. failed to queued is the retry claim
 * (claim_message_retry).
 *
 * Phase 1 of #722: definition only, no runtime behaviour. See docs/STATE-MACHINES.md.
 */
export type MessageState = "received" | "queued" | "sent" | "delivered" | "failed";

/** messages.status for texts. */
export const messageMachine = defineMachine<MessageState>({
  id: "message",
  authority: "provider",
  db: {
    kind: "enum",
    enumType: "message_status",
    columns: [{ table: "messages", column: "status" }],
  },
  states: ["received", "queued", "sent", "delivered", "failed"],
  initial: ["received", "queued"],
  transitions: {
    received: [],
    queued: ["sent", "delivered", "failed"],
    sent: ["delivered", "failed"],
    delivered: [],
    failed: ["queued"],
  },
  entryEffects: {
    queued: ["dispatch_to_carrier"],
    delivered: ["posthog_message_outcome", "meter_usage_once"],
    failed: ["posthog_message_outcome", "enqueue_webhook_message_failed"],
  },
  actions: capabilityActions<MessageState>({
    failed: [{ action: "retry", capability: "conversations.send" }],
  }),
});
