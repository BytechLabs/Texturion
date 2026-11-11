import { capabilityActions, defineMachine } from "./define-machine";

/**
 * Hosted-messaging orders for enabling texting on an existing landline
 * (text-enablement.ts). mapHostedStatus maps Telnyx's status to ours; resubmit
 * resets an action-required or failed order to pending; cancelled is guarded
 * by .neq("status","cancelled") on the saga's writes.
 *
 * Phase 1 of #722: definition only, no runtime behaviour. See docs/STATE-MACHINES.md.
 */
export type TextEnablementState = "pending" | "action-required" | "in-progress" | "completed" | "failed" | "cancelled";

/** Hosted-messaging orders for enabling texting on an existing landline (text-enablement.ts). */
export const textEnablementMachine = defineMachine<TextEnablementState>({
  id: "text_enablement",
  authority: "provider",
  db: {
    kind: "enum",
    enumType: "text_enablement_status",
    columns: [{ table: "text_enablement_orders", column: "status" }],
  },
  states: ["pending", "action-required", "in-progress", "completed", "failed", "cancelled"],
  initial: ["pending"],
  transitions: {
    pending: ["in-progress", "action-required", "completed", "failed", "cancelled"],
    "action-required": ["pending", "in-progress", "completed", "failed", "cancelled"],
    "in-progress": ["action-required", "completed", "failed", "cancelled"],
    // Releasing the number ends its hosted order, completed or not.
    completed: ["cancelled"],
    failed: ["pending", "cancelled"],
    cancelled: [],
  },
  actions: capabilityActions<TextEnablementState>({
    "action-required": [{ action: "upload_documents", capability: "numbers.manage" }, { action: "resubmit", capability: "numbers.manage" }, { action: "cancel", capability: "workspace.own" }],
    // PUT /:id/documents accepts pending, action-required and failed;
    // POST /:id/resubmit failed and action-required; POST /:id/cancel refuses
    // only completed and cancelled.
    failed: [{ action: "upload_documents", capability: "numbers.manage" }, { action: "resubmit", capability: "numbers.manage" }, { action: "cancel", capability: "workspace.own" }],
    pending: [{ action: "upload_documents", capability: "numbers.manage" }, { action: "cancel", capability: "workspace.own" }],
    "in-progress": [{ action: "cancel", capability: "workspace.own" }],
  }),
});
