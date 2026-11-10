import { defineMachine } from "./define-machine";

/**
 * The consent ledger (contact_consent_events.state): each row is the state a
 * contact entered, and the latest row wins. Only the customer lifts a STOP
 * (opt-out is carrier truth), so revoked leaves only for express, and only
 * through the gate in runPreSendGates.
 *
 * Phase 1 of #722: definition only, no runtime behaviour. See docs/STATE-MACHINES.md.
 */
export type ConsentState = "implied" | "express" | "revoked";

/** The consent ledger (contact_consent_events.state): each row is the state a contact entered, and the latest row wins. */
export const consentMachine = defineMachine<ConsentState>({
  id: "consent",
  authority: "internal",
  db: {
    kind: "check",
    columns: [{ table: "contact_consent_events", column: "state" }],
  },
  states: ["implied", "express", "revoked"],
  initial: ["implied", "express", "revoked"],
  transitions: {
    implied: ["express", "revoked"],
    express: ["revoked"],
    revoked: ["express"],
  },
  entryEffects: {
    revoked: ["block_sends_at_gate"],
  },
});
