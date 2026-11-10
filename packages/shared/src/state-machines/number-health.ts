import { defineMachine } from "./define-machine";

/**
 * Per-number delivery health (D142). The RPC returns only the numbers whose
 * state CHANGED, and the caller announces only those: the model for entry-only
 * effects.
 *
 * Phase 1 of #722: definition only, no runtime behaviour. See docs/STATE-MACHINES.md.
 */
export type NumberHealthState = "healthy" | "degraded";

export const numberHealthMachine = defineMachine<NumberHealthState>({
  id: "number_health",
  description: "Per-number delivery health (D142).",
  authority: "internal",
  db: {
    kind: "check",
    columns: [{ table: "number_health", column: "state" }],
  },
  states: ["healthy", "degraded"],
  initial: ["healthy"],
  transitions: {
    healthy: ["degraded"],
    degraded: ["healthy"],
  },
  entryEffects: {
    degraded: ["notify_owner_degraded"],
    healthy: ["notify_owner_recovered"],
  },
});
