import { stateMachines } from "@loonext/shared";
import { describe, expect, it } from "vitest";

import { stateTransitionProperties } from "./state-transition";

describe("#722 state_transition", () => {
  it("names the machine, the move and its cause, and says when the move is an edge", () => {
    expect(
      stateTransitionProperties(stateMachines.subscriptionMachine, "active", "past_due", "stripe"),
    ).toEqual({
      machine: "subscription",
      from: "active",
      to: "past_due",
      cause: "stripe",
      expected: true,
    });
  });

  it("flags a move the definition does not have, for a provider-owned machine", () => {
    expect(
      stateTransitionProperties(stateMachines.subscriptionMachine, "incomplete_expired", "active", "stripe")
        .expected,
    ).toBe(false);
  });
});
