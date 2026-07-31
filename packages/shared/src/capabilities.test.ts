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
    // The exhaustive cross-product: for each (role, minimum) pair, the rank
    // answer and the capability answer must agree. This is the check that lets
    // a gate conversion be mechanical.
    const gateCapability: Record<MemberRole, Capability> = {
      member: "conversations.read",
      admin: "settings.manage",
      owner: "workspace.own",
    };
    for (const role of MEMBER_ROLES) {
      for (const minimum of MEMBER_ROLES) {
        expect(
          roleHasCapability(role, gateCapability[minimum]),
          `${role} vs requireRole("${minimum}")`,
        ).toBe(roleSatisfiesRank(role, minimum));
      }
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

  it("splits read from send — the read-only gap #315 exists to close", () => {
    // Today no role has read without send, which is exactly why a read-only
    // observer has no representation. The MODEL can express it; the preset
    // that uses it comes next.
    expect(CAPABILITIES).toContain("conversations.read");
    expect(CAPABILITIES).toContain("conversations.send");
    const noRoleIsReadOnly = MEMBER_ROLES.every(
      (r) =>
        roleHasCapability(r, "conversations.read") ===
        roleHasCapability(r, "conversations.send"),
    );
    expect(noRoleIsReadOnly).toBe(true);
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
