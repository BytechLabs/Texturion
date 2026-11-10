import {
  roleHasCapability,
  type Capability,
  type MemberRole,
} from "../capabilities";

/**
 * #722 phase 1 — one typed shape for every lifecycle in the product.
 *
 * Only calls had an explicit transition table before this
 * (`apps/api/src/calls/transitions.ts`); registration, ports and quotes had a
 * private one each, and everything else was a scattering of `.update({ status })`
 * calls. This file is the shared vocabulary: a machine is DATA (states, the
 * allowed edges, the effects that belong to ENTERING a state, and what a role
 * may do from a state), and three questions are answered by functions over it:
 *
 *   canTransition(machine, from, to)      may this edge be taken?
 *   entryEffectsFor(machine, from, to)    which effects does THIS edge fire?
 *   allowedActions(machine, state, role)  what may this person do next?
 *
 * Phase 1 changes no runtime behaviour: nothing imports these definitions yet.
 * They are checked against the migrations and against production data by the
 * tests next to them, so phase 2 can move writers onto them knowing the
 * vocabulary is already true.
 */

/**
 * Who decides the next state.
 *
 *   internal  our code; an illegal edge should be REFUSED.
 *   provider  a carrier or Stripe; the edge already happened, so an
 *             unexpected one must be RECORDED and ignored for effects, never
 *             refused (refusing a webhook makes the provider retry for hours).
 *   derived   no column; the state is computed from timestamps or flags.
 */
export type Authority = "internal" | "provider" | "derived";

export interface DbColumn {
  table: string;
  column: string;
}

/**
 * How the database pins the vocabulary today.
 *
 *   check    a CHECK constraint lists the values
 *   enum     a Postgres enum type
 *   none     the column is free text (or there is no column): the doc says so
 *            and the test fails if a constraint appears without this changing
 */
export interface MachineDb {
  kind: "check" | "enum" | "none";
  columns: readonly DbColumn[];
  enumType?: string;
  /** The constraint also accepts NULL (legacy rows written before the column). */
  nullable?: boolean;
  /** Required for `none`: why there is no constraint. */
  note?: string;
}

export interface MachineDefinition<S extends string> {
  id: string;
  authority: Authority;
  db: MachineDb;
  states: readonly S[];
  /** The states a new record may start in. */
  initial: readonly S[];
  /** Every edge, written as "what may follow what". A self edge is a repeat pass. */
  transitions: Readonly<Record<NoInfer<S>, readonly NoInfer<S>[]>>;
  /**
   * Effects that belong to ENTERING a state. They fire on an edge from a
   * different state and never on a self edge: `entryEffectsFor` enforces it.
   */
  entryEffects?: Readonly<Partial<Record<NoInfer<S>, readonly string[]>>>;
  /**
   * States the database admits that no writer produces today. Listed so the
   * vocabulary matches the constraint and the gap is visible, not hidden.
   */
  unwritten?: readonly NoInfer<S>[];
  /** What a role may do from a state. Phase 3 makes UI and API read this. */
  actions?: (state: NoInfer<S>, role: MemberRole) => readonly string[];
}

export interface Machine<S extends string> {
  readonly id: string;
  readonly authority: Authority;
  readonly db: MachineDb;
  readonly states: readonly S[];
  readonly initial: readonly S[];
  readonly transitions: Readonly<Record<S, readonly S[]>>;
  readonly entryEffects: Readonly<Partial<Record<S, readonly string[]>>>;
  readonly unwritten: readonly S[];
  readonly actions: (state: S, role: MemberRole) => readonly string[];
}

/**
 * Validate and freeze a definition. Throws at import time on a malformed one,
 * so a typo in a transition table fails every test that touches the package
 * instead of one a reviewer has to remember to run.
 */
export function defineMachine<const S extends string>(
  definition: MachineDefinition<S>,
): Machine<S> {
  const known = new Set<string>(definition.states);
  const fail = (message: string): never => {
    throw new Error(`state machine ${definition.id}: ${message}`);
  };
  if (known.size !== definition.states.length) fail("duplicate state");
  for (const state of definition.initial) {
    if (!known.has(state)) fail(`initial state ${state} is not a state`);
  }
  const edges = definition.transitions as Record<string, readonly string[]>;
  for (const state of definition.states) {
    if (!(state in edges)) fail(`no transition row for ${state}`);
  }
  for (const [from, targets] of Object.entries(edges)) {
    if (!known.has(from)) fail(`transition row for unknown state ${from}`);
    for (const to of targets) {
      if (!known.has(to)) fail(`${from} -> ${to}: ${to} is not a state`);
    }
  }
  for (const state of definition.unwritten ?? []) {
    if (!known.has(state)) fail(`unwritten state ${state} is not a state`);
  }
  for (const state of Object.keys(definition.entryEffects ?? {})) {
    if (!known.has(state)) fail(`entry effects for unknown state ${state}`);
  }
  if (definition.db.kind === "enum" && !definition.db.enumType) {
    fail("an enum-backed machine names its enum type");
  }
  if (definition.db.kind === "none" && !definition.db.note) {
    fail("a machine with no database constraint says why");
  }
  return Object.freeze({
    id: definition.id,
    authority: definition.authority,
    db: definition.db,
    states: definition.states,
    initial: definition.initial,
    transitions: definition.transitions as Machine<S>["transitions"],
    entryEffects: (definition.entryEffects ?? {}) as Machine<S>["entryEffects"],
    unwritten: definition.unwritten ?? [],
    actions: (definition.actions ?? (() => [])) as Machine<S>["actions"],
  });
}

/** May the record move from `from` to `to`? A self edge is a repeat pass. */
export function canTransition<S extends string>(
  machine: Machine<S>,
  from: S,
  to: S,
): boolean {
  return machine.transitions[from]?.includes(to) ?? false;
}

/** The states reachable from `state` in one step. */
export function nextStates<S extends string>(
  machine: Machine<S>,
  state: S,
): readonly S[] {
  return machine.transitions[state] ?? [];
}

/** A state with no way out. */
export function isTerminalState<S extends string>(
  machine: Machine<S>,
  state: S,
): boolean {
  return nextStates(machine, state).every((next) => next === state);
}

/**
 * The effects the edge `from -> to` fires.
 *
 * Empty for a self edge, by construction. That is the rule the 2026-11-10 push
 * flood broke: a held scheduled text was claimed every minute and its notice
 * ran on every claim. Routing every effect through this function makes "a
 * second pass sends nothing" a property of the data, not of each caller's care.
 */
export function entryEffectsFor<S extends string>(
  machine: Machine<S>,
  from: S | null,
  to: S,
): readonly string[] {
  if (from === to) return [];
  return machine.entryEffects[to] ?? [];
}

/** What `role` may do to a record in `state`. Empty when nothing. */
export function allowedActions<S extends string>(
  machine: Machine<S>,
  state: S,
  role: MemberRole,
): readonly string[] {
  return machine.actions(state, role);
}

export interface CapabilityAction {
  action: string;
  capability: Capability;
}

/**
 * Build an `actions` function from a per-state table of
 * (action, capability) pairs. The capability is the one the route that
 * performs the action already requires, so the table and the server agree by
 * construction once phase 3 lands.
 */
export function capabilityActions<S extends string>(
  table: Readonly<Partial<Record<S, readonly CapabilityAction[]>>>,
): (state: S, role: MemberRole) => readonly string[] {
  return (state, role) =>
    (table[state] ?? [])
      .filter((entry) => roleHasCapability(role, entry.capability))
      .map((entry) => entry.action);
}
