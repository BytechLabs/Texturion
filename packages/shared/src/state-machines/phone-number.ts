import { capabilityActions, defineMachine } from "./define-machine";

/**
 * phone_numbers.status. Written by the provisioning saga (provisioning.ts),
 * the hosted-number flow (text-enablement.ts), port activation (porting.ts),
 * port-out (portout.ts), the billing suspension (routes/billing.ts) and SQL
 * functions (claim_number_allowance reactivates suspended numbers,
 * close_out_dead_provisioning releases). Seven writers, no single owner.
 *
 * Phase 1 of #722: definition only, no runtime behaviour. See docs/STATE-MACHINES.md.
 */
export type PhoneNumberState = "provisioning" | "active" | "suspended" | "released" | "provision_failed" | "ported_out";

export const phoneNumberMachine = defineMachine<PhoneNumberState>({
  id: "phone_number",
  description: "phone_numbers.status.",
  authority: "internal",
  db: {
    kind: "enum",
    enumType: "number_status",
    columns: [{ table: "phone_numbers", column: "status" }],
  },
  states: ["provisioning", "active", "suspended", "released", "provision_failed", "ported_out"],
  initial: ["provisioning", "active"],
  transitions: {
    provisioning: ["active", "provision_failed", "released"],
    active: ["suspended", "released", "ported_out"],
    suspended: ["active", "released", "ported_out"],
    released: [],
    provision_failed: ["provisioning", "released"],
    ported_out: [],
  },
  entryEffects: {
    suspended: ["stamp_suspended_at"],
    released: ["stamp_released_at"],
    ported_out: ["stamp_ported_out_at", "alert_owner"],
  },
  actions: capabilityActions<PhoneNumberState>({
    provision_failed: [{ action: "remediate", capability: "numbers.manage" }],
  }),
});
