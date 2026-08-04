/**
 * #348 — the cases Android and iOS hand-port alongside this.
 *
 * The pair that matters most is `unruled` vs `no-match`. Both end in the person
 * having or not having access without any rule naming them, they read alike at a
 * glance, and confusing them is how an owner concludes the rules are broken:
 * one means nobody has restricted the number, the other means somebody did and
 * left this person out.
 */
import { describe, expect, it } from "vitest";

import {
  numberAccessIsRestricted,
  numberAccessLevelLabel,
  numberAccessReason,
  numberAccessSelfNote,
  sortNumberAccessExplanations,
  type NumberAccessDecidedBy,
  type NumberAccessExplanation,
  type NumberAccessLevel,
} from "./number-access-explained";

describe("what they can do", () => {
  it("says it as a capability, not as a schema value", () => {
    expect(numberAccessLevelLabel("text")).toBe("Can text");
    expect(numberAccessLevelLabel("note")).toBe("Read and notes only");
    expect(numberAccessLevelLabel("none")).toBe("Hidden");
  });
});

describe("why", () => {
  it("names the rule an owner would go and edit", () => {
    expect(numberAccessReason("user", null)).toBe("A rule naming them");
    expect(numberAccessReason("role", "member")).toBe("A rule for members");
    expect(numberAccessReason("all", null)).toBe("A rule for everyone");
  });

  it("tells the two default-looking cases apart", () => {
    // The whole point. Both leave the person un-named by any rule; only one of
    // them is somebody having been left out.
    expect(numberAccessReason("unruled", null)).toBe(
      "Nobody has restricted this number",
    );
    expect(numberAccessReason("no-match", null)).toBe(
      "This number has rules, and none of them include them",
    );
    expect(numberAccessReason("unruled", null)).not.toBe(
      numberAccessReason("no-match", null),
    );
  });

  it("explains an owner's blanket access rather than leaving it mysterious", () => {
    // An owner seeing "Can text" on every number with no reason would wonder
    // whether the rules work at all.
    expect(numberAccessReason("role-override", "owner")).toBe(
      "Owners reach every number",
    );
    expect(numberAccessReason("role-override", "admin")).toBe(
      "Admins reach every number",
    );
  });

  it("survives a role rule with no principal", () => {
    // Defensive: the server always sends one, and a missing value must not
    // render "A rule for s".
    expect(numberAccessReason("role", null)).toBe("A rule for their role");
  });

  it("says a deactivated member is gone", () => {
    expect(numberAccessReason("not-a-member", null)).toBe(
      "No longer in this workspace",
    );
  });
});

describe("the order they are read in", () => {
  const row = (
    number: string,
    level: NumberAccessExplanation["level"],
  ): NumberAccessExplanation => ({
    phone_number_id: number,
    number_e164: number,
    level,
    decided_by: "unruled",
    principal: null,
  });

  it("puts what they cannot do first", () => {
    // An owner opening this is checking a suspicion, not reading a report. A
    // list that opens with six green rows buries the one red one.
    const sorted = sortNumberAccessExplanations([
      row("+15550003", "text"),
      row("+15550001", "none"),
      row("+15550002", "note"),
    ]);
    expect(sorted.map((r) => r.number_e164)).toEqual([
      "+15550001",
      "+15550002",
      "+15550003",
    ]);
  });

  it("orders by number inside each group", () => {
    // So comparing two members puts the same numbers in the same places.
    const sorted = sortNumberAccessExplanations([
      row("+15550009", "text"),
      row("+15550004", "text"),
    ]);
    expect(sorted.map((r) => r.number_e164)).toEqual(["+15550004", "+15550009"]);
  });

  it("does not mutate the input", () => {
    const rows = [row("+15550002", "text"), row("+15550001", "none")];
    sortNumberAccessExplanations(rows);
    expect(rows[0].number_e164).toBe("+15550002");
  });

  it("knows which levels are a restriction", () => {
    expect(numberAccessIsRestricted("text")).toBe(false);
    expect(numberAccessIsRestricted("note")).toBe(true);
    expect(numberAccessIsRestricted("none")).toBe(true);
  });
});

/**
 * #286 — the same seven clauses, read by the person they are about.
 *
 * SV-1 is the one that matters. A member-facing copy of these sentences would
 * be a second wording of one security rule, which is the #437 failure this
 * file exists to prevent — so "you" and "them" are a parameter and the switch
 * is walked once.
 */
describe("#286 reading your own access", () => {
  it("SV-1: every reason has a self-reading, and the default is unchanged", () => {
    const kinds: NumberAccessDecidedBy[] = [
      "user",
      "role",
      "all",
      "no-match",
      "unruled",
      "role-override",
      "not-a-member",
    ];
    for (const kind of kinds) {
      // Nothing throws and nothing comes back empty: a missing branch here is
      // a blank line under a number on somebody's screen.
      expect(numberAccessReason(kind, null, "self").length).toBeGreaterThan(0);
      // And the owner-facing wording is byte-identical to before the parameter
      // existed, since that screen shipped in #348 and nobody asked for it to
      // change.
      expect(numberAccessReason(kind, null)).toBe(
        numberAccessReason(kind, null, "other"),
      );
    }
    expect(numberAccessReason("user", null, "self")).toBe("A rule naming you");
    expect(numberAccessReason("user", null)).toBe("A rule naming them");
    expect(numberAccessReason("no-match", null, "self")).toMatch(/include you$/);
  });

  it("SV-2: a role rule reads the same either way, because it names the role", () => {
    // "A rule for members" is already about the rule rather than the person,
    // so rewording it for the self view would make it worse.
    expect(numberAccessReason("role", "member", "self")).toBe("A rule for members");
    expect(numberAccessReason("role", "member")).toBe("A rule for members");
  });

  it("SV-3: the note says how much is hidden, and that it is deliberate", () => {
    // #286: silent absence is the worse failure. A member who cannot see a
    // line reads it as the app being broken, and resolves that by asking the
    // owner — which is the cost this sentence removes.
    const note = numberAccessSelfNote([
      row("text"),
      row("none"),
      row("none"),
      row("note"),
    ]);
    expect(note).toContain("2 numbers are hidden");
    expect(note).toContain("1 is read-only");
    expect(note).toMatch(/deliberate/i);
    expect(note).toMatch(/not the app failing/i);
  });

  it("SV-3b: a member who reaches everything is told nothing", () => {
    // The pair. A paragraph reassuring somebody about a problem they do not
    // have is furniture, and furniture is not read.
    expect(numberAccessSelfNote([row("text"), row("text")])).toBeNull();
    expect(numberAccessSelfNote([])).toBeNull();
  });

  it("SV-4: one of each reads as singular", () => {
    const note = numberAccessSelfNote([row("none"), row("note")]);
    expect(note).toContain("1 number is hidden");
    expect(note).toContain("1 is read-only");
  });
});

function row(level: NumberAccessLevel): NumberAccessExplanation {
  return {
    phone_number_id: `n-${level}-${Math.random()}`,
    number_e164: "+12125550100",
    level,
    decided_by: "unruled",
    principal: null,
  };
}
