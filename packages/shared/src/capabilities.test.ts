/**
 * #315: the capability model must say EXACTLY what the rank says today.
 *
 * That equivalence is the point of landing the model before converting any
 * gates. 138 `requireRole` call sites get rewritten against this table, and
 * that is only safe if the table provably reproduces the current behaviour —
 * asserting it in a docblock would not survive the first edit.
 */
import { describe, expect, it } from "vitest";

import {
  CAPABILITIES,
  MEMBER_ROLES,
  capabilitiesOf,
  roleHasCapability,
  roleSatisfiesRank,
  type Capability,
  type MemberRole,
} from "./capabilities";

describe("the model reproduces today's rank exactly", () => {
  it("owner ⊃ admin ⊃ member, as capability sets", () => {
    const member = new Set(capabilitiesOf("member"));
    const admin = new Set(capabilitiesOf("admin"));
    const owner = new Set(capabilitiesOf("owner"));
    for (const cap of member) {
      expect(admin.has(cap), `admin must keep ${cap}`).toBe(true);
    }
    for (const cap of admin) {
      expect(owner.has(cap), `owner must keep ${cap}`).toBe(true);
    }
    // Strictly bigger at each step, or the roles would be indistinguishable.
    expect(admin.size).toBeGreaterThan(member.size);
    expect(owner.size).toBeGreaterThan(admin.size);
  });

  it("every rank gate resolves the same way under both models", () => {
    // The exhaustive cross-product over the THREE ORIGINAL roles: for each
    // (role, minimum) pair, the rank answer and the capability answer must
    // agree. This is what let the gate conversion be mechanical.
    //
    // Scoped to those three on purpose. A preset that is not on the line is
    // precisely a role the two models DISAGREE about — read_only carries
    // conversations.read and satisfies no rank at all — and that divergence is
    // the feature, not a regression. The rank's remaining job is to refuse
    // such a role at any gate that still asks for one; `rankRefusesOffLine`
    // below is what pins that.
    const HIERARCHY = ["owner", "admin", "member"] as const;
    const gateCapability: Record<(typeof HIERARCHY)[number], Capability> = {
      member: "conversations.read",
      admin: "settings.manage",
      owner: "workspace.own",
    };
    for (const role of HIERARCHY) {
      for (const minimum of HIERARCHY) {
        expect(
          roleHasCapability(role, gateCapability[minimum]),
          `${role} vs requireRole("${minimum}")`,
        ).toBe(roleSatisfiesRank(role, minimum));
      }
    }
  });

  it("the rank refuses every role that is not on the line", () => {
    // The safety property the incremental conversion rested on, now with a
    // real role to test it with rather than a cast.
    for (const minimum of ["owner", "admin", "member"] as MemberRole[]) {
      expect(
        roleSatisfiesRank("read_only", minimum),
        `read_only vs requireRole("${minimum}")`,
      ).toBe(false);
    }
  });

  it("owner alone holds the irreversible capability", () => {
    // Overage cap, US enablement, number release, ownership transfer, closing
    // the workspace. These are not delegation problems.
    expect(roleHasCapability("owner", "workspace.own")).toBe(true);
    expect(roleHasCapability("admin", "workspace.own")).toBe(false);
    expect(roleHasCapability("member", "workspace.own")).toBe(false);
  });

  it("a member gets the inbox and the baseline, and nothing of the business", () => {
    // workspace.access is the boot baseline every role has (the company record
    // the app loads on, your own notification prefs, leaving). The point of
    // pinning the exact set is that widening a member happens on purpose.
    expect(capabilitiesOf("member").sort()).toEqual(
      [
        "conversations.note",
        "conversations.read",
        "conversations.send",
        "workspace.access",
      ].sort(),
    );
  });

  it("an admin gets billing, settings, team, numbers and history", () => {
    for (const cap of [
      "billing.manage",
      "settings.manage",
      "team.manage",
      "numbers.manage",
      "history.read",
    ] as Capability[]) {
      expect(roleHasCapability("admin", cap), cap).toBe(true);
      expect(roleHasCapability("member", cap), cap).toBe(false);
    }
  });
});

describe("the model is well-formed", () => {
  it("every capability belongs to at least one role", () => {
    // An unreachable capability is a gate nobody can pass.
    for (const cap of CAPABILITIES) {
      const holders = MEMBER_ROLES.filter((r) => roleHasCapability(r, cap));
      expect(holders.length, `${cap} is held by nobody`).toBeGreaterThan(0);
    }
  });

  it("every role's capabilities are known ones", () => {
    for (const role of MEMBER_ROLES) {
      for (const cap of capabilitiesOf(role)) {
        expect(CAPABILITIES).toContain(cap);
      }
    }
  });

  it("no role lists a capability twice", () => {
    for (const role of MEMBER_ROLES) {
      const caps = capabilitiesOf(role);
      expect(new Set(caps).size, `${role} has duplicates`).toBe(caps.length);
    }
  });

  it("an unknown role carries nothing, and does not throw", () => {
    // Real rather than theoretical: the database enum can grow a value ahead
    // of a deployed client, and a role arrives here as data from a row.
    // Indexing the table blindly threw a TypeError, which a gate turns into a
    // 500 — an error page where the honest answer is "no".
    const unknown = "bookkeeper" as unknown as MemberRole;
    expect(() => roleHasCapability(unknown, "billing.manage")).not.toThrow();
    expect(roleHasCapability(unknown, "billing.manage")).toBe(false);
    expect(capabilitiesOf(unknown)).toEqual([]);
    for (const minimum of MEMBER_ROLES) {
      expect(roleSatisfiesRank(unknown, minimum), minimum).toBe(false);
    }
  });

  it("hands out a copy, so a caller cannot edit the table", () => {
    const first = capabilitiesOf("member");
    first.push("billing.manage");
    expect(capabilitiesOf("member")).not.toContain("billing.manage");
  });

  it("read without send now has a role — the #315 gap is closed", () => {
    // This test used to assert the GAP: no role had read without send, which
    // is exactly why an observer had no representation and why owners shared
    // logins instead. It now asserts the opposite, which is the whole point of
    // the preset.
    expect(roleHasCapability("read_only", "conversations.read")).toBe(true);
    expect(roleHasCapability("read_only", "conversations.send")).toBe(false);
    expect(roleHasCapability("read_only", "conversations.note")).toBe(false);
  });

  it("a read-only observer can see the work and change nothing", () => {
    // The exact set, because widening an observer must happen on purpose.
    expect(capabilitiesOf("read_only").sort()).toEqual(
      ["conversations.read", "workspace.access"].sort(),
    );
    // And nothing of the business, which is the other half of "observer".
    for (const cap of [
      "billing.manage",
      "settings.manage",
      "team.manage",
      "numbers.manage",
      "contacts.bulk",
      "workspace.own",
    ] as Capability[]) {
      expect(roleHasCapability("read_only", cap), cap).toBe(false);
    }
  });

  it("splits billing from settings — the bookkeeper gap", () => {
    // Same shape: the axes are separate in the model, and no preset yet takes
    // one without the other. That preset is the next commit.
    const noRoleSplitsThem = MEMBER_ROLES.every(
      (r) =>
        roleHasCapability(r, "billing.manage") ===
        roleHasCapability(r, "settings.manage"),
    );
    expect(noRoleSplitsThem).toBe(true);
  });
});
