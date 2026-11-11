import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MEMBER_ROLES } from "../capabilities";
import { QUOTE_STATUSES, canTransitionQuote } from "../quotes";
import { SCHEDULED_MESSAGE_STATUSES } from "../scheduled-send";
import {
  ALL_MACHINES,
  allowedActions,
  canTransition,
  defineMachine,
  entryEffectsFor,
  isTerminalState,
  nextStates,
  callMachine,
  calendarConnectionMachine,
  portMachine,
  portMessagingMachine,
  quoteMachine,
  registrationMachine,
  scheduledMessageMachine,
  type Machine,
} from "./index";
import { readDbVocabulary } from "./db-vocabulary";
import {
  PROD_COUNTS,
  PROD_INVARIANT_VIOLATIONS,
} from "./prod-snapshot-2026-11-10";

/**
 * #722 phase 1 — the definitions are checked against three other sources of
 * truth, so they cannot drift quietly:
 *
 *   1. the migrations (the vocabulary the database actually enforces),
 *   2. production data (every observed state is one the machine defines),
 *   3. the explicit tables that already exist in code (calls, ports,
 *      registration, quotes).
 *
 * Nothing here changes runtime behaviour. Phase 2 moves writers onto the
 * definitions; this file is what makes that move safe.
 */

const REPO = join(import.meta.dirname, "..", "..", "..", "..");

function source(path: string): string {
  return readFileSync(join(REPO, path), "utf8");
}

const asSet = (values: readonly string[]): string[] => [...new Set(values)].sort();

describe("defineMachine", () => {
  it("refuses a transition row for a state that does not exist", () => {
    expect(() =>
      defineMachine({
        id: "bad",
        authority: "internal",
        db: { kind: "none", columns: [], note: "test" },
        states: ["a", "b"],
        initial: ["a"],
        transitions: { a: ["c" as "b"], b: [] },
      }),
    ).toThrow(/c is not a state/);
  });

  it("refuses an initial state that does not exist and a missing row", () => {
    expect(() =>
      defineMachine({
        id: "bad",
        authority: "internal",
        db: { kind: "none", columns: [], note: "test" },
        states: ["a", "b"],
        initial: ["z" as "a"],
        transitions: { a: [], b: [] },
      }),
    ).toThrow(/initial state z/);
    expect(() =>
      defineMachine({
        id: "bad",
        authority: "internal",
        db: { kind: "none", columns: [], note: "test" },
        states: ["a", "b"],
        initial: ["a"],
        transitions: { a: [] } as unknown as Record<"a" | "b", never[]>,
      }),
    ).toThrow(/no transition row for b/);
  });

  it("makes a repeat pass fire nothing and an edge into a state fire its effects", () => {
    expect(entryEffectsFor(scheduledMessageMachine, "pending", "held")).toEqual([
      "notify_owner_held",
    ]);
    // The 2026-11-10 push flood: a held row is claimed again every minute.
    expect(entryEffectsFor(scheduledMessageMachine, "held", "held")).toEqual([]);
    // A brand-new record has no previous state: entering is entering.
    expect(entryEffectsFor(scheduledMessageMachine, null, "pending")).toEqual([]);
  });

  it("answers allowedActions from the role's capabilities", () => {
    // Connect comes back only after the cleanup has finished.
    expect(allowedActions(calendarConnectionMachine, "disconnected", "member")).toEqual([]);
    expect(allowedActions(calendarConnectionMachine, "revoked", "member")).toEqual(["connect"]);
    expect(allowedActions(calendarConnectionMachine, "revoked", "read_only")).toEqual([]);
    expect(allowedActions(scheduledMessageMachine, "held", "member")).toEqual(["edit", "cancel"]);
    expect(allowedActions(scheduledMessageMachine, "held", "bookkeeper")).toEqual([]);
    expect(allowedActions(scheduledMessageMachine, "sent", "owner")).toEqual([]);
  });
});

describe("every machine", () => {
  it("has a unique id", () => {
    const ids = ALL_MACHINES.map((machine) => machine.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe.each(ALL_MACHINES.map((machine) => [machine.id, machine as Machine<string>] as const))(
    "%s",
    (_id, machine) => {
      it("can reach every written state from a starting state", () => {
        const seen = new Set<string>(machine.initial);
        const queue = [...machine.initial];
        while (queue.length > 0) {
          const state = queue.shift() as string;
          for (const next of nextStates(machine, state)) {
            if (!seen.has(next)) {
              seen.add(next);
              queue.push(next);
            }
          }
        }
        // States the constraint admits but no writer produces are declared
        // `unwritten` on the definition; anything else must be reachable.
        const unreachable = machine.states.filter(
          (state) => !seen.has(state) && !machine.unwritten.includes(state),
        );
        expect(unreachable).toEqual([]);
      });

      it("fires no effect on a second pass over the same state", () => {
        for (const state of machine.states) {
          expect(entryEffectsFor(machine, state, state)).toEqual([]);
        }
      });

      it("fires effects only for states it defines", () => {
        for (const state of Object.keys(machine.entryEffects)) {
          expect(machine.states).toContain(state);
        }
      });

      it("offers actions only to roles that hold the capability, for every state", () => {
        for (const state of machine.states) {
          const owner = allowedActions(machine, state, "owner");
          for (const role of MEMBER_ROLES) {
            for (const action of allowedActions(machine, state, role)) {
              expect(owner).toContain(action);
            }
          }
        }
      });

      it("treats a terminal state as one with no way out", () => {
        for (const state of machine.states) {
          if (isTerminalState(machine, state)) {
            for (const other of machine.states) {
              if (other !== state) expect(canTransition(machine, state, other)).toBe(false);
            }
          }
        }
      });
    },
  );
});

describe("the database agrees with every definition", () => {
  const vocabulary = readDbVocabulary();

  describe.each(ALL_MACHINES.map((machine) => [machine.id, machine as Machine<string>] as const))(
    "%s",
    (_id, machine) => {
      if (machine.db.kind === "check") {
        it.each(machine.db.columns.map((c) => [`${c.table}.${c.column}`] as const))(
          "%s: the check constraint lists exactly the machine's states",
          (key) => {
            const check = vocabulary.checks.get(key);
            expect(check, `no check constraint found for ${key}`).toBeDefined();
            expect(asSet(check?.values ?? [])).toEqual(asSet(machine.states));
            expect(check?.nullable ?? false).toBe(machine.db.nullable ?? false);
          },
        );
      }

      if (machine.db.kind === "enum") {
        it(`the enum ${machine.db.enumType} lists exactly the machine's states`, () => {
          const values = vocabulary.enums.get(machine.db.enumType ?? "");
          expect(values, `no enum ${machine.db.enumType} found`).toBeDefined();
          expect(asSet(values ?? [])).toEqual(asSet(machine.states));
        });
      }

      if (machine.db.kind === "none") {
        it.each(machine.db.columns.map((c) => [`${c.table}.${c.column}`] as const))(
          "%s: has no value-list constraint, as the definition says",
          (key) => {
            // If this fails the database has started pinning the vocabulary.
            // Change `db.kind` on the definition and the doc, then compare.
            expect(vocabulary.checks.get(key)).toBeUndefined();
          },
        );
      }
    },
  );
});

describe("production data fits the definitions (snapshot 2026-11-10)", () => {
  const byId = new Map(ALL_MACHINES.map((machine) => [machine.id, machine as Machine<string>]));

  it("has a snapshot for every machine and no snapshot for an unknown one", () => {
    expect(asSet(Object.keys(PROD_COUNTS))).toEqual(asSet([...byId.keys()]));
  });

  it("only observes states the machine defines", () => {
    for (const [id, columns] of Object.entries(PROD_COUNTS)) {
      const machine = byId.get(id);
      expect(machine, id).toBeDefined();
      for (const [column, counts] of Object.entries(columns)) {
        for (const state of Object.keys(counts)) {
          if (state === "NULL") continue;
          expect(machine?.states, `${id} ${column} holds ${state}`).toContain(state);
        }
      }
    }
  });

  it("observes NULL only on a machine that is meant to have it", () => {
    const withNull: string[] = [];
    for (const [id, columns] of Object.entries(PROD_COUNTS)) {
      for (const counts of Object.values(columns)) {
        if ("NULL" in counts) withNull.push(id);
      }
    }
    // calls before v3, notes with no delivery status, a number never ported.
    expect(asSet(withNull)).toEqual(["call", "message", "port"]);
  });

  it("names every machine an invariant violation is filed against", () => {
    for (const violation of PROD_INVARIANT_VIOLATIONS) {
      expect(byId.has(violation.machine)).toBe(true);
      expect(violation.rows).toBeGreaterThan(0);
    }
  });
});

describe("the definitions agree with the explicit tables that already exist", () => {
  it("call: the states and the terminal set match transitions.ts", () => {
    const text = source("apps/api/src/calls/transitions.ts");
    const list = (name: string): string[] => {
      const match = new RegExp(`export const ${name}[^=]*=\\s*\\[([^\\]]*)\\]`).exec(text);
      return [...(match?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
    };
    expect(asSet(list("CALL_STATES"))).toEqual(asSet(callMachine.states));
    expect(asSet(list("TERMINAL_STATES"))).toEqual(
      asSet(callMachine.states.filter((state) => state.startsWith("ended_"))),
    );
    // The reducer treats every ended_* state as final except two upgrade edges.
    expect(nextStates(callMachine, "ended_missed")).toEqual(["ended_voicemail", "ended_answered"]);
  });

  it("quote: matches QUOTE_STATUSES and canTransitionQuote exactly", () => {
    expect(asSet(quoteMachine.states)).toEqual(asSet(QUOTE_STATUSES));
    for (const from of QUOTE_STATUSES) {
      for (const to of QUOTE_STATUSES) {
        expect(canTransition(quoteMachine, from, to), `${from} -> ${to}`).toBe(
          canTransitionQuote(from, to),
        );
      }
    }
  });

  it("scheduled message: matches SCHEDULED_MESSAGE_STATUSES", () => {
    expect(asSet(scheduledMessageMachine.states)).toEqual(asSet(SCHEDULED_MESSAGE_STATUSES));
  });

  // Both port tables and the registration table are object literals in
  // source. Evaluating the literal is the only reading that cannot drift from
  // what the webhook handlers actually enforce.
  const literalTable = (path: string, name: string): Record<string, string[]> => {
    const text = source(path);
    const start = text.indexOf(`const ${name}`);
    expect(start, `${name} in ${path}`).toBeGreaterThan(-1);
    const open = text.indexOf("{", text.indexOf("=", start));
    let depth = 0;
    let end = open;
    for (let i = open; i < text.length; i += 1) {
      if (text[i] === "{") depth += 1;
      if (text[i] === "}") depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
    return new Function(`return ${text.slice(open, end + 1)}`)() as Record<string, string[]>;
  };

  it("port: matches ALLOWED_STATUS_TRANSITIONS in porting.ts", () => {
    const table = literalTable("apps/api/src/telnyx/porting.ts", "ALLOWED_STATUS_TRANSITIONS");
    expect(asSet(Object.keys(table))).toEqual(asSet(portMachine.states));
    for (const state of portMachine.states) {
      expect(asSet(nextStates(portMachine, state)), state).toEqual(asSet(table[state] ?? []));
    }
  });

  it("port messaging: matches ALLOWED_MESSAGING_TRANSITIONS in porting.ts", () => {
    const table = literalTable("apps/api/src/telnyx/porting.ts", "ALLOWED_MESSAGING_TRANSITIONS");
    expect(asSet(Object.keys(table))).toEqual(asSet(portMessagingMachine.states));
    for (const state of portMessagingMachine.states) {
      expect(asSet(nextStates(portMessagingMachine, state)), state).toEqual(asSet(table[state] ?? []));
    }
  });

  it("registration: matches ALLOWED_TRANSITIONS in registration.ts, plus the submit route's edges", () => {
    const table = literalTable("apps/api/src/telnyx/registration.ts", "ALLOWED_TRANSITIONS");
    expect(asSet(Object.keys(table))).toEqual(asSet(registrationMachine.states));
    // The submit route, not a carrier webhook, sends a registration to review:
    // the first submission, a resubmit after a fix, and a reactivation.
    const SUBMITTED_FROM = new Set(["draft", "rejected", "suspended"]);
    for (const state of registrationMachine.states) {
      const expected = [
        ...(table[state] ?? []),
        ...(SUBMITTED_FROM.has(state) ? ["submitted"] : []),
      ];
      expect(asSet(nextStates(registrationMachine, state)), state).toEqual(asSet(expected));
    }
  });
});
