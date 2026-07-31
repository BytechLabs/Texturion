/**
 * #315 gate lint, in the ImeContractLintTest idiom: a rank is not a permission
 * model, and a new route must not be ABLE to ship on one.
 *
 * `requireRole("admin")` and `requireRole("owner")` are converted — every one
 * of them now names the axis it means (`team.manage`, `numbers.manage`,
 * `settings.manage`, `history.read`, `contacts.bulk`, `workspace.own`). This
 * fails the build if one comes back, because the presets that close the
 * bookkeeper and read-only gaps are not on the owner ⊃ admin ⊃ member line,
 * and a rank gate refuses them wholesale rather than asking the right question.
 *
 * `requireRole("member")` is deliberately still allowed. Those 91 routes mean
 * "any active member", and they split two ways — some read, some send as the
 * business. They get converted by hand, route by route, when the read-only
 * observer lands; converting them mechanically would be a guess about which
 * half each one is, and guessing wrong either locks a crew out of their inbox
 * or lets an observer text a customer.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CAPABILITIES } from "@loonext/shared";

const ROUTES_DIR = join(import.meta.dirname, "..", "routes");

function routeSources(): { name: string; src: string }[] {
  return readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((name) => ({
      name,
      src: readFileSync(join(ROUTES_DIR, name), "utf8"),
    }));
}

describe("route gates ask for a capability, not a rank", () => {
  it("finds the route sources (the lint itself still works)", () => {
    const sources = routeSources();
    expect(sources.length).toBeGreaterThan(20);
    // And they really are the gated ones.
    expect(sources.some((s) => s.src.includes("requireCapability("))).toBe(true);
  });

  it("no route gates on requireRole('admin')", () => {
    for (const { name, src } of routeSources()) {
      expect(
        src.includes('requireRole("admin")'),
        `${name} gates on the rank 'admin'. Use requireCapability with the ` +
          `axis it means — billing.manage, settings.manage, team.manage, ` +
          `numbers.manage, history.read or contacts.bulk (#315).`,
      ).toBe(false);
    }
  });

  it("no route gates on requireRole('owner')", () => {
    for (const { name, src } of routeSources()) {
      expect(
        src.includes('requireRole("owner")'),
        `${name} gates on the rank 'owner'. Use ` +
          `requireCapability("workspace.own") — the irreversible actions ` +
          `(overage cap, US enablement, number release, ownership transfer, ` +
          `closing the workspace) are one axis, not a rung (#315).`,
      ).toBe(false);
    }
  });

  it("every capability a route asks for is a real one", () => {
    // A typo'd capability would silently refuse EVERYONE, which reads as a
    // broken feature rather than as a permission bug.
    // DERIVED from the capability table, not listed here. The first version of
    // this test hand-listed them and went stale the moment an axis was added —
    // which is the failure mode this whole file exists to prevent.
    const known = new Set<string>(CAPABILITIES);
    let seen = 0;
    for (const { name, src } of routeSources()) {
      for (const match of src.matchAll(/requireCapability\("([^"]+)"\)/g)) {
        seen += 1;
        expect(known.has(match[1]), `${name} asks for "${match[1]}"`).toBe(true);
      }
    }
    // Guard the guard: a regex that stopped matching would pass vacuously.
    expect(seen).toBeGreaterThan(30);
  });
});
