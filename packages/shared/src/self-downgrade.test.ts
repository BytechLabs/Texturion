import { describe, expect, it } from "vitest";

import {
  capabilitiesLost,
  isDowngrade,
  losesRoleControl,
  selfDowngradeWarning,
} from "./self-downgrade";

describe("self downgrade (#538)", () => {
  it("names what an admin gives up by becoming a member", () => {
    const lost = capabilitiesLost("admin", "member");
    expect(lost).toContain("team.manage");
    expect(lost).toContain("billing.manage");
    expect(lost).not.toContain("conversations.read");
  });

  it("takes nothing away on a promotion", () => {
    // Which is what makes it safe to call on every role change rather than only
    // the ones a caller already guessed were downgrades.
    expect(capabilitiesLost("member", "admin")).toEqual([]);
    expect(isDowngrade("member", "admin")).toBe(false);
    expect(selfDowngradeWarning("member", "admin")).toBeNull();
  });

  it("takes nothing away on a sideways move", () => {
    expect(selfDowngradeWarning("admin", "admin")).toBeNull();
  });

  it("singles out losing the ability to change it back", () => {
    // THE POINT OF THE ISSUE. "You will have less access" is accepted easily and
    // correctly; "you cannot put this back yourself" is the part somebody would
    // want to know before tapping.
    expect(losesRoleControl("admin", "member")).toBe(true);
    const warning = selfDowngradeWarning("admin", "member")!;
    expect(warning).toContain("change it back");
    expect(warning).toContain("only an owner can");
  });

  it("says what things ARE, not what they are called in the code", () => {
    const warning = selfDowngradeWarning("admin", "member")!;
    expect(warning).not.toContain("team.manage");
    expect(warning).not.toContain("billing.manage");
    expect(warning).not.toContain("_");
  });

  it("names three things at most and counts the rest", () => {
    // Six revoked capabilities listed in full reads as boilerplate and gets
    // skipped, which defeats the whole point of asking.
    const warning = selfDowngradeWarning("admin", "member")!;
    expect(warning).toMatch(/and \d+ more/);
    // Three named, so the sentence stays a sentence.
    expect(warning.split(",").length).toBeLessThanOrEqual(4);
  });

  it("reads as one sentence a person would say", () => {
    const warning = selfDowngradeWarning("admin", "member")!;
    expect(warning.startsWith("You'll lose access to ")).toBe(true);
    expect(warning.endsWith(".")).toBe(true);
  });

  it("covers every role pair without throwing", () => {
    // Including the owner, whose row is immutable — the helper must still answer
    // rather than the caller having to know which pairs are reachable.
    for (const from of ["owner", "admin", "member"] as const) {
      for (const to of ["owner", "admin", "member"] as const) {
        expect(() => selfDowngradeWarning(from, to)).not.toThrow();
      }
    }
    expect(losesRoleControl("owner", "member")).toBe(true);
  });
});
