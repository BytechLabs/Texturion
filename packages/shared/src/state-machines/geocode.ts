import { defineMachine } from "./define-machine";

/**
 * Setting or editing an address resets its state to pending. Clearing it sets
 * no_address.
 *
 * Phase 1 of #722: definition only, no runtime behaviour. See docs/STATE-MACHINES.md.
 */
export type GeocodeState = "pending" | "ok" | "failed" | "no_address";

export const geocodeMachine = defineMachine<GeocodeState>({
  id: "geocode",
  authority: "internal",
  db: {
    kind: "check",
    columns: [{ table: "contacts", column: "geocode_status" }, { table: "tasks", column: "geocode_status" }],
  },
  states: ["pending", "ok", "failed", "no_address"],
  initial: ["pending", "no_address"],
  transitions: {
    pending: ["ok", "failed", "no_address"],
    ok: ["pending", "no_address"],
    failed: ["pending", "no_address"],
    no_address: ["pending"],
  },
});
