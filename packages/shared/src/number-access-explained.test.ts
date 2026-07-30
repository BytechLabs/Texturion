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
  sortNumberAccessExplanations,
  type NumberAccessExplanation,
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
