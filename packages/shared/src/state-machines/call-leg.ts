import { defineMachine } from "./define-machine";

/**
 * One member's leg of a call (ring, consult or transfer). In calls v3 the
 * ledger is audit-only: rows are inserted as ringing and the Durable Object
 * tracks real leg state in its own storage, so on production 125 legs are
 * still ringing on calls that have ended. The definition describes the legacy
 * RPC lifecycle (api_claim_ring_answer, api_ring_leg_failed) that
 * apps/api/src/messaging/live-call.ts still drives for transfer and consult
 * legs.
 *
 * Phase 1 of #722: definition only, no runtime behaviour. See docs/STATE-MACHINES.md.
 */
export type CallLegState = "ringing" | "answered" | "failed";

/** One member's leg of a call (ring, consult or transfer). */
export const callLegMachine = defineMachine<CallLegState>({
  id: "call_leg",
  authority: "internal",
  db: {
    kind: "check",
    columns: [{ table: "call_member_legs", column: "state" }],
  },
  states: ["ringing", "answered", "failed"],
  initial: ["ringing"],
  transitions: {
    ringing: ["answered", "failed"],
    answered: [],
    failed: [],
  },
});
