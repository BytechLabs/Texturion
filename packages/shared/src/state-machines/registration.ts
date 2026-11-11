import { capabilityActions, defineMachine } from "./define-machine";

/**
 * US 10DLC brand and campaign registration.
 * apps/api/src/telnyx/registration.ts already has this table
 * (ALLOWED_TRANSITIONS) and applies it to carrier webhooks; draft to submitted
 * is the submit route. Rejected is terminal in the table; whether a rejected
 * registration can be fixed and resubmitted is not decided anywhere in code
 * that writes status, an open question for phase 2 (see Unclassified in the
 * doc).
 *
 * Phase 1 of #722: definition only, no runtime behaviour. See docs/STATE-MACHINES.md.
 */
export type RegistrationState = "draft" | "submitted" | "pending" | "approved" | "rejected" | "suspended";

/** US 10DLC brand and campaign registration. */
export const registrationMachine = defineMachine<RegistrationState>({
  id: "registration",
  authority: "provider",
  db: {
    kind: "enum",
    enumType: "registration_status",
    columns: [{ table: "messaging_registrations", column: "status" }],
  },
  states: ["draft", "submitted", "pending", "approved", "rejected", "suspended"],
  initial: ["draft"],
  transitions: {
    draft: ["submitted"],
    submitted: ["pending", "approved", "rejected"],
    pending: ["approved", "rejected"],
    approved: ["suspended"],
    // A fixed registration is resubmitted (the rejected-resubmit path, capped
    // by MAX_CAMPAIGN_SUBMISSIONS), and a suspended one is reactivated after a
    // paid resubscribe (MAX_CAMPAIGN_REACTIVATIONS). Both send it back to review.
    rejected: ["submitted"],
    suspended: ["approved", "rejected", "submitted"],
  },
  entryEffects: {
    approved: ["stamp_approved_at", "submit_campaign_after_brand"],
    suspended: ["email_suspension_notice"],
    rejected: ["email_rejection_notice"],
  },
  actions: capabilityActions<RegistrationState>({
    draft: [{ action: "edit", capability: "numbers.manage" }, { action: "submit", capability: "numbers.manage" }],
  }),
});
