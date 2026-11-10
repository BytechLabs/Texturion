import { defineMachine } from "./define-machine";

/**
 * Number porting, messaging track (#50): ALLOWED_MESSAGING_TRANSITIONS in
 * porting.ts, copied verbatim. exception only leaves on real progress, never
 * back to pending.
 *
 * Phase 1 of #722: definition only, no runtime behaviour. See docs/STATE-MACHINES.md.
 */
export type PortMessagingState = "not_applicable" | "pending" | "activating" | "ported" | "exception";

/** Number porting, messaging track (#50): ALLOWED_MESSAGING_TRANSITIONS in porting.ts, copied verbatim. */
export const portMessagingMachine = defineMachine<PortMessagingState>({
  id: "port_messaging",
  authority: "provider",
  db: {
    kind: "enum",
    enumType: "port_messaging_status",
    columns: [{ table: "port_requests", column: "messaging_port_status" }],
  },
  states: ["not_applicable", "pending", "activating", "ported", "exception"],
  initial: ["not_applicable"],
  transitions: {
    not_applicable: ["pending", "activating", "ported", "exception"],
    pending: ["activating", "ported", "exception"],
    activating: ["ported", "exception"],
    ported: [],
    exception: ["activating", "ported"],
  },
  entryEffects: {
    exception: ["email_texting_delayed"],
    ported: ["enable_texting"],
  },
});
