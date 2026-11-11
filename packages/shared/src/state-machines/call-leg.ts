import { defineMachine } from "./define-machine";

/**
 * One member's leg of a call (ring, consult or transfer). In calls v3 the
 * ledger is audit-only: rows are inserted as ringing and the Durable Object
 * tracks real leg state in its own storage. The definition is the RPC lifecycle
 * (api_claim_ring_answer, api_ring_leg_failed) that
 * apps/api/src/messaging/live-call.ts drives for transfer and consult legs.
 *
 * A consult leg that was answered and then drops is marked failed
 * (live-call.ts, `.neq("state", "failed")`), so answered -> failed is real.
 * The trigger `call_member_legs_transition_guard` enforces these edges (#722).
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
    answered: ["failed"],
    failed: [],
  },
});
