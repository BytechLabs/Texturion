/**
 * #722, phase 4: one PostHog event per state change, `state_transition`, with
 * the machine, the move and what caused it. `expected` is false when the move
 * is not an edge of the shared definition: for a machine a provider owns
 * (Stripe, Telnyx) the mirror still takes the provider's word, and this is how
 * an unexpected move is seen rather than silently absorbed.
 */
export interface MachineEdges {
  id: string;
  transitions: Readonly<Record<string, readonly string[]>>;
}

export function stateTransitionProperties(
  machine: MachineEdges,
  from: string,
  to: string,
  cause: string,
): Record<string, unknown> {
  return {
    machine: machine.id,
    from,
    to,
    cause,
    expected: (machine.transitions[from] ?? []).includes(to),
  };
}
