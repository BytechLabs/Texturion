import { capabilityActions, defineMachine } from "./define-machine";

/**
 * Number porting, voice track. The table is ALLOWED_STATUS_TRANSITIONS in
 * apps/api/src/telnyx/porting.ts, copied verbatim.
 * phone_numbers.porting_status carries the same vocabulary (a mirror of the
 * port request). claimPortRow writes only while the row still holds the values
 * this run read and reports whether this run changed it, so the webhook or
 * cron loser sends nothing: the pattern to copy for every machine.
 *
 * Phase 1 of #722: definition only, no runtime behaviour. See docs/STATE-MACHINES.md.
 */
export type PortState = "draft" | "in-process" | "submitted" | "exception" | "foc-date-confirmed" | "activation-in-progress" | "ported" | "cancel-pending" | "cancelled";

/** Number porting, voice track. */
export const portMachine = defineMachine<PortState>({
  id: "port",
  authority: "provider",
  db: {
    kind: "enum",
    enumType: "port_status",
    columns: [{ table: "port_requests", column: "status" }, { table: "phone_numbers", column: "porting_status" }],
    nullable: true,
  },
  states: ["draft", "in-process", "submitted", "exception", "foc-date-confirmed", "activation-in-progress", "ported", "cancel-pending", "cancelled"],
  initial: ["draft"],
  transitions: {
    draft: ["in-process", "submitted", "exception", "cancel-pending", "cancelled"],
    "in-process": ["submitted", "exception", "foc-date-confirmed", "activation-in-progress", "ported", "cancel-pending", "cancelled"],
    submitted: ["exception", "foc-date-confirmed", "activation-in-progress", "ported", "cancel-pending", "cancelled"],
    exception: ["submitted", "in-process", "foc-date-confirmed", "activation-in-progress", "ported", "cancel-pending", "cancelled"],
    "foc-date-confirmed": ["activation-in-progress", "ported", "exception", "cancel-pending", "cancelled"],
    "activation-in-progress": ["ported", "exception", "cancel-pending", "cancelled"],
    ported: [],
    "cancel-pending": ["cancelled"],
    cancelled: [],
  },
  entryEffects: {
    ported: ["activate_number", "email_ported"],
    exception: ["email_port_exception"],
    cancelled: ["release_reservation"],
  },
  actions: capabilityActions<PortState>({
    draft: [{ action: "edit", capability: "numbers.manage" }, { action: "submit", capability: "numbers.manage" }, { action: "cancel", capability: "workspace.own" }],
    exception: [{ action: "fix_and_resubmit", capability: "numbers.manage" }, { action: "cancel", capability: "workspace.own" }],
    submitted: [{ action: "cancel", capability: "workspace.own" }],
    "in-process": [{ action: "cancel", capability: "workspace.own" }],
  }),
});
